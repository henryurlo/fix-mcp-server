#!/usr/bin/env python3
"""FIX Protocol MCP Server — Trading Operations Assistant."""

import asyncio
import contextvars as _cv
import json
import os
import threading
import re
from datetime import datetime, timezone
from pathlib import Path
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, Resource, Prompt
import mcp.types as types
from fix_mcp.engine.oms import OMS, Order
from fix_mcp.engine.fix_sessions import FIXSessionManager, FIXSession
from fix_mcp.engine.reference import ReferenceDataStore, Symbol, CorporateAction, Venue, Client
from fix_mcp.engine.scenarios import ScenarioEngine
from fix_mcp.engine.algos import AlgoEngine, AlgoOrder, ALGO_TYPES
from fix_mcp.fix.messages import FIXMessageBuilder
from fix_mcp.fix.protocol import SequenceManager, format_fix_timestamp
from fix_mcp.engine.market_data import MarketDataHub

# ---------------------------------------------------------------------------
# Attempt to import the trading ops prompt; fall back to a stub if the module
# has not been created yet.
# ---------------------------------------------------------------------------
try:
    from fix_mcp.prompts.trading_ops import (
        TRADING_OPS_PROMPT,
        SCENARIO_PROMPTS,
        SESSION_ENGINEER_PROMPT,
        ORDER_DESK_PROMPT,
        TICKER_OPS_PROMPT,
        RISK_COMPLIANCE_PROMPT,
        ALGO_TRADER_PROMPT,
    )
except ImportError:
    TRADING_OPS_PROMPT = (
        "FIX Protocol Trading Operations Assistant\n"
        "You are an expert production support engineer for FIX-based equity trading systems.\n"
        "Use the available tools to investigate issues, send orders, and manage sessions.\n"
    )
    SCENARIO_PROMPTS: dict[str, str] = {}
    SESSION_ENGINEER_PROMPT = ORDER_DESK_PROMPT = TICKER_OPS_PROMPT = RISK_COMPLIANCE_PROMPT = ALGO_TRADER_PROMPT = ""

# ---------------------------------------------------------------------------
# Server & engine initialisation
# ---------------------------------------------------------------------------

app = Server("fix-trading-ops")

# ---------------------------------------------------------------------------
# Event listener infrastructure
#
# Any transport (stdio, HTTP MCP, REST API) that invokes a tool ends up in
# call_tool() below.  Listeners registered here are notified after every
# invocation so the dashboard can show live activity regardless of who
# triggered the call.
#
# Listener signature: (name: str, args: dict, text: str, ok: bool, source: str)
# source values: "claude" (MCP transports) | "dashboard" (REST /api/tool)
# ---------------------------------------------------------------------------
_tool_listeners: list = []
_call_source: _cv.ContextVar[str] = _cv.ContextVar("_call_source", default="claude")

# ---------------------------------------------------------------------------
# Thread safety — reset_runtime swaps globally-attached engine references.
# The lock serialises reset against concurrent tool execution.
# ---------------------------------------------------------------------------
_engine_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Input validators — applied to every tool entry point.
# ---------------------------------------------------------------------------

_SYMBOL_RE = re.compile(r"^[A-Z]{1,5}$")
_CLIENT_RE = re.compile(r"^[A-Za-z0-9 _\-]{1,64}$")


def _assert_symbol(sym: str) -> None:
    if not _SYMBOL_RE.fullmatch(sym):
        raise ValueError(f"Invalid symbol {sym!r}: must be 1-5 uppercase letters")


def _assert_client(name: str) -> None:
    if not _CLIENT_RE.fullmatch(name):
        raise ValueError(f"Invalid client name {name!r}: must be 1-64 alphanumeric characters")


def _assert_venue_or_side(value: str, label: str) -> None:
    if not re.fullmatch(r"^[A-Z0-9_ ]{1,16}$", value):
        raise ValueError(f"Invalid {label} {value!r}")


SCENARIO = os.environ.get("SCENARIO", "morning_triage")
CONFIG_DIR = os.environ.get("FIX_MCP_CONFIG_DIR")

engine = ScenarioEngine(CONFIG_DIR)
oms, session_manager, ref_store = engine.load_scenario(SCENARIO)
algo_engine: AlgoEngine = engine.algo_engine
msg_builder = FIXMessageBuilder(
    sender_comp_id="FIRM_PROD",
    target_comp_id="EXCHANGE_GW",
    session_manager=SequenceManager(),
)

# Market data hub — one process-wide instance. Seed symbols from ref_store
# (ref_store.symbols is a dict keyed by symbol); fall back to a hardcoded
# demo set if ref_store has no symbols loaded.
_md_seed_symbols = {sym: 100.0 for sym in ref_store.symbols.keys()} or {
    "AAPL": 195.0, "MSFT": 405.0, "SPY": 520.0,
}
market_data_hub = MarketDataHub(symbols=_md_seed_symbols, tick_interval_ms=100)


def reset_runtime(scenario_name: str | None = None) -> str:
    """Reload scenario-backed runtime state in-process (thread-safe)."""
    global SCENARIO, oms, session_manager, ref_store, algo_engine, msg_builder, market_data_hub

    with _engine_lock:  # serialise against concurrent tool dispatch
        if scenario_name:
            SCENARIO = scenario_name

        oms, session_manager, ref_store = engine.load_scenario(SCENARIO)
        algo_engine = engine.algo_engine
        _seed = {sym: 100.0 for sym in ref_store.symbols.keys()} or {
            "AAPL": 195.0, "MSFT": 405.0, "SPY": 520.0,
        }
        market_data_hub = MarketDataHub(symbols=_seed, tick_interval_ms=100)
        msg_builder = FIXMessageBuilder(
            sender_comp_id="FIRM_PROD",
            target_comp_id="EXCHANGE_GW",
            session_manager=SequenceManager(),
        )
        return SCENARIO

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SIDE_MAP = {"buy": "1", "sell": "2"}
_ORD_TYPE_MAP = {"market": "1", "limit": "2", "stop": "3"}
_ROUTE_PREFERENCE = ["NYSE", "IEX", "BATS", "ARCA"]
_TERMINAL_STATUSES = {"filled", "canceled", "rejected"}
_SLA_WARN_MINUTES = 30


def _sla_countdown(order: Order) -> str | None:
    """Return a human-readable SLA countdown string, or None if not applicable."""
    if not order.is_institutional:
        return None
    if order.status not in {"new", "stuck", "partially_filled"}:
        return None
    if order.sla_minutes is None:
        return None
    try:
        # Use whichever is later: original creation time or last update time.
        # When an order is released from a stuck/venue-down state its updated_at
        # is reset to now, so the SLA clock restarts from the moment it became
        # workable rather than from the original submission time.
        baseline_str = max(order.created_at, order.updated_at)
        created = datetime.fromisoformat(baseline_str)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        deadline = created.timestamp() + order.sla_minutes * 60
        now = datetime.now(timezone.utc).timestamp()
        remaining = (deadline - now) / 60
        if remaining < 0:
            return f"SLA BREACHED {abs(remaining):.0f} min AGO"
        if remaining <= _SLA_WARN_MINUTES:
            return f"SLA BREACH IN {remaining:.0f} min"
    except (ValueError, TypeError):
        return None
    return None


def _fmt_order_row(o: Order) -> str:
    notional = f"${o.notional_value:,.0f}" if o.price else "N/A"
    sla = _sla_countdown(o)
    sla_str = f"  *** {sla} ***" if sla else ""
    return (
        f"  {o.order_id}  {o.symbol:<6}  {o.side.upper():<4}  {o.quantity:>7,}  "
        f"{o.order_type:<7}  {o.status:<16}  {o.venue:<5}  {notional:<12}  {o.client_name}{sla_str}"
    )


def _auto_route(venue_arg: str | None) -> str:
    """Pick the best available venue. Skip ARCA if its session is down."""
    if venue_arg:
        return venue_arg.upper()
    for v in _ROUTE_PREFERENCE:
        session = session_manager.get_session(v)
        if v == "ARCA" and session and session.status == "down":
            continue
        if session is None or session.status in {"active", "degraded"}:
            return v
    return "NYSE"


def _session_status_icon(status: str) -> str:
    return {"active": "[OK]", "degraded": "[WARN]", "down": "[DOWN]"}.get(status, f"[{status.upper()}]")


def _release_venue_stuck_orders(venue: str) -> list[Order]:
    """Remove 'venue_down' flag and set status back to 'new' for orders stuck at venue."""
    released = []
    for order in oms.orders.values():
        if order.venue.upper() == venue.upper() and "venue_down" in order.flags:
            order.flags.remove("venue_down")
            if order.status in {"stuck", "new"}:
                order.status = "new"
            order.updated_at = datetime.now(timezone.utc).isoformat()
            released.append(order)
    return released


def _tc(text: str) -> list[TextContent]:
    return [TextContent(type="text", text=text)]


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

@app.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="fix://sessions",
            name="FIX Sessions",
            description="All configured FIX session states",
            mimeType="application/json",
        ),
        Resource(
            uri="fix://venues",
            name="Venue Registry",
            description="Trading venue reference data",
            mimeType="application/json",
        ),
        Resource(
            uri="fix://reference",
            name="Reference Data",
            description="Symbol count and corporate actions summary",
            mimeType="application/json",
        ),
        Resource(
            uri="fix://prompts/trading-ops",
            name="Trading Ops Prompt",
            description="System prompt for the trading operations assistant",
            mimeType="text/plain",
        ),
    ]


@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "fix://sessions":
        sessions = [
            {
                "venue": s.venue,
                "session_id": s.session_id,
                "status": s.status,
                "fix_version": s.fix_version,
                "last_sent_seq": s.last_sent_seq,
                "last_recv_seq": s.last_recv_seq,
                "expected_recv_seq": s.expected_recv_seq,
                "latency_ms": s.latency_ms,
                "last_heartbeat": s.last_heartbeat,
                "error": s.error,
            }
            for s in session_manager.get_all_sessions()
        ]
        return json.dumps(sessions, indent=2)

    if uri == "fix://venues":
        venues = {
            name: {
                "mic_code": v.mic_code,
                "full_name": v.full_name,
                "supported_order_types": v.supported_order_types,
                "trading_hours": v.trading_hours,
                "pre_market": v.pre_market,
                "fix_version": v.fix_version,
            }
            for name, v in ref_store.venues.items()
        }
        return json.dumps(venues, indent=2)

    if uri == "fix://reference":
        today_actions = ref_store.get_effective_today_actions()
        summary = {
            "symbol_count": len(ref_store.symbols),
            "corporate_actions_today": len(today_actions),
            "corporate_actions": [
                {
                    "action_id": a.action_id,
                    "action_type": a.action_type,
                    "effective_date": a.effective_date,
                    "old_symbol": a.old_symbol,
                    "new_symbol": a.new_symbol,
                    "description": a.description,
                }
                for a in today_actions
            ],
        }
        return json.dumps(summary, indent=2)

    if uri == "fix://prompts/trading-ops":
        return TRADING_OPS_PROMPT

    raise ValueError(f"Unknown resource URI: {uri}")


# ---------------------------------------------------------------------------
# Prompts — role-specific system prompts exposed via MCP Prompts API
# ---------------------------------------------------------------------------

_ROLE_PROMPTS = {
    "trading-ops": ("General trading operations assistant — all roles", TRADING_OPS_PROMPT),
    "session-engineer": ("FIX session engineer — transport layer only", SESSION_ENGINEER_PROMPT),
    "order-desk": ("Order desk operator — routing, execution, SLA management", ORDER_DESK_PROMPT),
    "ticker-ops": ("Ticker operations — reference data, corporate actions, splits", TICKER_OPS_PROMPT),
    "risk-compliance": ("Risk and compliance — SSR, LULD, large order review, EOD cleanup", RISK_COMPLIANCE_PROMPT),
    "algo-trader": ("Algo execution specialist — TWAP, VWAP, POV, IS, dark aggregator", ALGO_TRADER_PROMPT),
}


@app.list_prompts()
async def list_prompts() -> list[types.Prompt]:
    return [
        types.Prompt(name=name, description=desc)
        for name, (desc, _) in _ROLE_PROMPTS.items()
    ]


@app.get_prompt()
async def get_prompt(name: str, arguments: dict[str, str] | None = None) -> types.GetPromptResult:
    entry = _ROLE_PROMPTS.get(name)
    if entry is None:
        raise ValueError(f"Unknown prompt '{name}'. Available: {', '.join(_ROLE_PROMPTS)}")
    _, content = entry
    return types.GetPromptResult(
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=content),
            )
        ]
    )


# ---------------------------------------------------------------------------
# Tools — definitions
# ---------------------------------------------------------------------------

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="query_orders",
            description=(
                "Query OMS orders with optional filters. Returns order details including "
                "notional value and SLA countdowns for institutional orders."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "client_name": {"type": "string", "description": "Filter by client name"},
                    "symbol": {"type": "string", "description": "Filter by symbol"},
                    "status": {"type": "string", "description": "Filter by order status"},
                    "venue": {"type": "string", "description": "Filter by venue"},
                    "order_id": {"type": "string", "description": "Get specific order by ID"},
                },
            },
        ),
        Tool(
            name="check_fix_sessions",
            description="Check FIX session health: status, sequence numbers, heartbeat age, latency.",
            inputSchema={
                "type": "object",
                "properties": {
                    "venue": {"type": "string", "description": "Specific venue, or omit for all"},
                },
            },
        ),
        Tool(
            name="send_order",
            description="Send a new order via FIX NewOrderSingle. Validates symbol, checks corp actions, auto-routes if no venue supplied.",
            inputSchema={
                "type": "object",
                "required": ["symbol", "side", "quantity", "order_type", "client_name"],
                "properties": {
                    "symbol": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "integer"},
                    "order_type": {"type": "string", "enum": ["market", "limit", "stop"]},
                    "price": {"type": "number"},
                    "client_name": {"type": "string"},
                    "venue": {"type": "string"},
                },
            },
        ),
        Tool(
            name="cancel_replace",
            description="Cancel or replace an existing order via FIX 35=F or 35=G.",
            inputSchema={
                "type": "object",
                "required": ["order_id", "action"],
                "properties": {
                    "order_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["cancel", "replace"]},
                    "new_venue": {"type": "string"},
                    "new_quantity": {"type": "integer"},
                    "new_price": {"type": "number"},
                    "new_symbol": {"type": "string"},
                },
            },
        ),
        Tool(
            name="check_ticker",
            description="Look up a symbol or CUSIP. Returns full record, pending corporate actions, and affected open order count.",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "cusip": {"type": "string"},
                },
            },
        ),
        Tool(
            name="update_ticker",
            description="Rename a symbol and bulk-update all open orders. Flags stop orders for manual review.",
            inputSchema={
                "type": "object",
                "required": ["old_symbol", "new_symbol", "reason"],
                "properties": {
                    "old_symbol": {"type": "string"},
                    "new_symbol": {"type": "string"},
                    "reason": {"type": "string", "enum": ["corporate_action", "correction", "merger"]},
                },
            },
        ),
        Tool(
            name="load_ticker",
            description="Load a new symbol into the reference store and release orders pending that symbol.",
            inputSchema={
                "type": "object",
                "required": ["symbol", "cusip", "name", "listing_exchange"],
                "properties": {
                    "symbol": {"type": "string"},
                    "cusip": {"type": "string"},
                    "name": {"type": "string"},
                    "listing_exchange": {"type": "string"},
                    "lot_size": {"type": "integer", "default": 100},
                    "tick_size": {"type": "number", "default": 0.01},
                },
            },
        ),
        Tool(
            name="fix_session_issue",
            description="Resolve a FIX session issue: resend_request (gap recovery), reset_sequence, or reconnect.",
            inputSchema={
                "type": "object",
                "required": ["venue", "action"],
                "properties": {
                    "venue": {"type": "string"},
                    "action": {"type": "string", "enum": ["resend_request", "reset_sequence", "reconnect"]},
                },
            },
        ),
        Tool(
            name="validate_orders",
            description="Validate a set of orders: check symbol validity, venue status, duplicate ClOrdIDs, and client status.",
            inputSchema={
                "type": "object",
                "properties": {
                    "order_ids": {"type": "array", "items": {"type": "string"}},
                    "symbol": {"type": "string"},
                    "status": {"type": "string"},
                },
            },
        ),
        Tool(
            name="run_premarket_check",
            description="Flagship pre-market health check: sessions, corp actions, stuck orders, SLA deadlines, validation summary.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="send_algo_order",
            description=(
                "Submit a new algorithmic order (TWAP, VWAP, POV, IS, DARK_AGG, ICEBERG). "
                "Creates a parent algo order with execution schedule and initial child slices."
            ),
            inputSchema={
                "type": "object",
                "required": ["symbol", "side", "quantity", "algo_type", "client_name"],
                "properties": {
                    "symbol": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "integer"},
                    "algo_type": {"type": "string", "enum": ["TWAP", "VWAP", "POV", "IS", "DARK_AGG", "ICEBERG"]},
                    "client_name": {"type": "string"},
                    "venue": {"type": "string"},
                    "end_time": {"type": "string", "description": "ISO-8601 execution window end (TWAP/VWAP)"},
                    "pov_rate": {"type": "number", "description": "Target participation rate 0.0–1.0 (POV/VWAP)"},
                    "arrival_px": {"type": "number", "description": "Arrival price for IS benchmark"},
                    "slice_count": {"type": "integer", "description": "Number of child slices (default: 6)"},
                },
            },
        ),
        Tool(
            name="check_algo_status",
            description=(
                "Check status of algo orders: schedule deviation, execution quality, "
                "IS shortfall, over-participation, and child order health."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "algo_id": {"type": "string", "description": "Specific algo ID, or omit for all active"},
                    "symbol": {"type": "string"},
                    "status": {"type": "string", "enum": ["running", "paused", "halted", "stuck", "completed", "canceled"]},
                },
            },
        ),
        Tool(
            name="modify_algo",
            description="Modify an active algo: pause, resume, or update POV participation rate.",
            inputSchema={
                "type": "object",
                "required": ["algo_id", "action"],
                "properties": {
                    "algo_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["pause", "resume", "update_pov_rate"]},
                    "new_pov_rate": {"type": "number", "description": "New POV rate (required for action=update_pov_rate)"},
                },
            },
        ),
        Tool(
            name="cancel_algo",
            description="Cancel an active algo and send OrderCancelRequest for all open child slices.",
            inputSchema={
                "type": "object",
                "required": ["algo_id"],
                "properties": {
                    "algo_id": {"type": "string"},
                    "reason": {"type": "string", "description": "Cancellation reason for audit trail"},
                },
            },
        ),
        Tool(
            name="list_scenarios",
            description=(
                "List all available trading scenarios or load one into the runtime. "
                "Use action='list' to see all scenarios with their context summaries. "
                "Use action='load' with scenario_name to switch the active scenario."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "load"],
                        "description": "list: show available scenarios; load: switch active scenario",
                    },
                    "scenario_name": {
                        "type": "string",
                        "description": "Scenario name to load (required when action=load)",
                    },
                },
            },
        ),
        # ── New terminal CLI tools ──────────────────────────────────────
        Tool(
            name="session_heartbeat",
            description="Send a heartbeat and return the heartbeat status for a specific venue session.",
            inputSchema={
                "type": "object",
                "required": ["venue"],
                "properties": {
                    "venue": {"type": "string", "description": "Venue name (e.g. NYSE, BATS, ARCA)"},
                },
            },
        ),
        Tool(
            name="reset_sequence",
            description="Reset FIX sequence numbers for a venue session.",
            inputSchema={
                "type": "object",
                "required": ["venue"],
                "properties": {
                    "venue": {"type": "string", "description": "Venue name"},
                },
            },
        ),
        Tool(
            name="dump_session_state",
            description="Return full session diagnostics for a venue including sequence numbers, latency, heartbeat age, and associated orders.",
            inputSchema={
                "type": "object",
                "required": ["venue"],
                "properties": {
                    "venue": {"type": "string", "description": "Venue name"},
                },
            },
        ),
        Tool(
            name="tail_logs",
            description="Return the last N lines of a log file.",
            inputSchema={
                "type": "object",
                "required": ["file"],
                "properties": {
                    "file": {"type": "string", "description": "Log file path or name"},
                    "lines": {"type": "integer", "description": "Number of lines to return (default 20)"},
                },
            },
        ),
        Tool(
            name="grep_logs",
            description="Search log files for a pattern and return matching lines.",
            inputSchema={
                "type": "object",
                "required": ["pattern", "file"],
                "properties": {
                    "pattern": {"type": "string", "description": "Regex or literal pattern to search for"},
                    "file": {"type": "string", "description": "Log file path or name"},
                },
            },
        ),
        Tool(
            name="release_stuck_orders",
            description="Release all stuck orders across all venues by removing venue_down flags.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="update_venue_status",
            description="Change venue status (active/degraded/down). Use fix_session_issue to recover a degraded/down venue.",
            inputSchema={
                "type": "object",
                "required": ["venue", "status"],
                "properties": {
                    "venue": {"type": "string", "description": "Venue name"},
                    "status": {"type": "string", "enum": ["active", "degraded", "down"]},
                },
            },
        ),
        Tool(
            name="check_market_data_staleness",
            description=(
                "Report per-symbol market-data staleness in ms. Flags symbols whose "
                "last quote exceeds a 500ms advisory threshold. Pass 'symbol' to filter."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Specific symbol, or omit for all"},
                },
            },
        ),
    ]


# ---------------------------------------------------------------------------
# Tools — call router
# ---------------------------------------------------------------------------

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    result = await _dispatch_tool(name, arguments)
    if _tool_listeners:
        txt = result[0].text if result else ""
        ok = not txt.startswith("ERROR")
        src = _call_source.get()
        for cb in _tool_listeners:
            try:
                cb(name, arguments, txt, ok, src)
            except Exception:  # noqa: BLE001
                pass
    return result


async def _dispatch_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        if name == "query_orders":        return await _tool_query_orders(arguments)
        if name == "check_fix_sessions":  return await _tool_check_fix_sessions(arguments)
        if name == "send_order":          return await _tool_send_order(arguments)
        if name == "cancel_replace":      return await _tool_cancel_replace(arguments)
        if name == "check_ticker":        return await _tool_check_ticker(arguments)
        if name == "update_ticker":       return await _tool_update_ticker(arguments)
        if name == "load_ticker":         return await _tool_load_ticker(arguments)
        if name == "fix_session_issue":   return await _tool_fix_session_issue(arguments)
        if name == "validate_orders":     return await _tool_validate_orders(arguments)
        if name == "run_premarket_check": return await _tool_run_premarket_check(arguments)
        if name == "send_algo_order":     return await _tool_send_algo_order(arguments)
        if name == "check_algo_status":   return await _tool_check_algo_status(arguments)
        if name == "modify_algo":         return await _tool_modify_algo(arguments)
        if name == "cancel_algo":         return await _tool_cancel_algo(arguments)
        if name == "list_scenarios":      return await _tool_list_scenarios(arguments)
        if name == "session_heartbeat":    return await _tool_session_heartbeat(arguments)
        if name == "reset_sequence":       return await _tool_reset_sequence(arguments)
        if name == "dump_session_state":   return await _tool_dump_session_state(arguments)
        if name == "tail_logs":            return await _tool_tail_logs(arguments)
        if name == "grep_logs":            return await _tool_grep_logs(arguments)
        if name == "release_stuck_orders": return await _tool_release_stuck_orders(arguments)
        if name == "update_venue_status":  return await _tool_update_venue_status(arguments)
        if name == "check_market_data_staleness":
            return await _tool_check_market_data_staleness(arguments)
        if name == "cancel_order":
            # Alias: cancel_order → cancel_replace with action="cancel"
            args = {**arguments, "action": arguments.get("action", "cancel")}
            return await _tool_cancel_replace(args)
        return _tc(f"ERROR: Unknown tool '{name}'")
    except Exception as exc:  # noqa: BLE001
        return _tc(f"ERROR: Unhandled exception in tool '{name}': {exc!r}")


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

async def _tool_query_orders(args: dict) -> list[TextContent]:
    try:
        orders = oms.query_orders(
            client_name=args.get("client_name"),
            symbol=args.get("symbol"),
            status=args.get("status"),
            venue=args.get("venue"),
            order_id=args.get("order_id"),
        )
        if not orders:
            return _tc("No orders match the specified filters.")

        # Group by urgency: SLA breach imminent first, then status
        urgent, stuck, normal = [], [], []
        for o in orders:
            sla = _sla_countdown(o)
            if sla and "BREACH" in sla:
                urgent.append((o, sla))
            elif o.status in {"stuck"}:
                stuck.append(o)
            else:
                normal.append(o)

        header = (
            f"ORDER QUERY — {len(orders)} order(s) found\n"
            f"{'ID':<22}  {'SYM':<6}  {'SIDE':<4}  {'QTY':>7}  "
            f"{'TYPE':<7}  {'STATUS':<16}  {'VENUE':<5}  {'NOTIONAL':<12}  CLIENT\n"
            + "─" * 110
        )
        lines = [header]

        if urgent:
            lines.append("\n[!] SLA CRITICAL")
            for o, sla in urgent:
                lines.append(_fmt_order_row(o))

        if stuck:
            lines.append("\n[!] STUCK / VENUE DOWN")
            for o in stuck:
                lines.append(_fmt_order_row(o))

        if normal:
            lines.append("\nOPEN / OTHER")
            for o in normal:
                lines.append(_fmt_order_row(o))

        total_notional = sum(o.notional_value for o in orders if o.price)
        lines.append(f"\nTotal notional across matched orders: ${total_notional:,.0f}")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in query_orders: {exc!r}")


async def _tool_check_fix_sessions(args: dict) -> list[TextContent]:
    try:
        venue_filter = args.get("venue")
        if venue_filter:
            session = session_manager.get_session(venue_filter.upper())
            sessions = [session] if session else []
            if not sessions:
                return _tc(f"No session found for venue '{venue_filter}'.")
        else:
            sessions = session_manager.get_all_sessions()

        venue_order_counts = oms.count_by_venue()
        lines = ["FIX SESSION STATUS\n" + "═" * 70]

        for s in sessions:
            icon = _session_status_icon(s.status)
            hb_age = s.heartbeat_age_seconds
            hb_str = f"{hb_age:.0f}s ago" if hb_age is not None else "never"
            stuck_count = len([
                o for o in oms.orders.values()
                if o.venue.upper() == s.venue.upper() and "venue_down" in o.flags
            ])
            lines.append(f"\n{icon} {s.venue} ({s.session_id})")
            lines.append(f"   Status:       {s.status.upper()}")
            lines.append(f"   FIX Version:  {s.fix_version}")
            lines.append(f"   Host:         {s.host}:{s.port}")
            lines.append(f"   Sent Seq:     {s.last_sent_seq}")
            lines.append(f"   Recv Seq:     {s.last_recv_seq}  (expected: {s.expected_recv_seq})")
            lines.append(f"   Latency:      {s.latency_ms} ms")
            lines.append(f"   Heartbeat:    {hb_str}")
            lines.append(f"   Open Orders:  {venue_order_counts.get(s.venue.upper(), 0)}")

            if s.has_sequence_gap:
                gap = s.sequence_gap_size
                lines.append(
                    f"   [!] SEQUENCE GAP: expected {s.expected_recv_seq}, "
                    f"got {s.last_recv_seq} — gap of {gap} message(s). "
                    "Use fix_session_issue(action='resend_request') to recover."
                )
            if s.status == "down":
                lines.append(
                    f"   [DOWN] Session is offline. {stuck_count} order(s) stuck at this venue."
                )
                if s.error:
                    lines.append(f"   Error: {s.error}")
            elif s.status == "degraded":
                lines.append(
                    f"   [WARN] Session degraded — high latency or partial connectivity."
                )
            if s.connected_since:
                lines.append(f"   Connected:    {s.connected_since}")

        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in check_fix_sessions: {exc!r}")


async def _tool_send_order(args: dict) -> list[TextContent]:
    try:
        symbol = args["symbol"].upper()
        side_str = args["side"].lower()
        quantity = int(args["quantity"])
        order_type_str = args["order_type"].lower()
        price = args.get("price")
        client_name = args["client_name"]
        venue_arg = args.get("venue")

        warnings = []

        # 1. Input sanitisation
        _assert_symbol(symbol)
        _assert_client(client_name)
        if side_str not in ("buy", "sell"):
            return _tc(f"ORDER REJECTED — Invalid side: {side_str!r} (must be 'buy' or 'sell')")
        if order_type_str not in ("market", "limit", "stop"):
            return _tc(f"ORDER REJECTED — Invalid order type: {order_type_str!r}")

        # 2. Validate symbol
        valid, reason = ref_store.is_symbol_valid(symbol)
        if not valid:
            return _tc(f"ORDER REJECTED — Symbol validation failed: {reason}")

        # 2. Check for corporate actions
        corp_actions = ref_store.get_symbol_corporate_actions(symbol)
        if corp_actions:
            for ca in corp_actions:
                warnings.append(
                    f"CORP ACTION WARNING: {ca.action_type} on {symbol} "
                    f"effective {ca.effective_date} — {ca.description}"
                )

        # 3. Auto-route venue
        venue = _auto_route(venue_arg)

        # 4. Warn if venue degraded/down
        session = session_manager.get_session(venue)
        if session and session.status == "down":
            warnings.append(f"VENUE WARNING: {venue} FIX session is DOWN — order may not reach exchange.")
        elif session and session.status == "degraded":
            warnings.append(f"VENUE WARNING: {venue} session is DEGRADED — elevated latency.")

        # 5. Generate IDs
        order_id = oms.generate_order_id()
        cl_ord_id = oms.generate_cl_ord_id()

        # 6. Build FIX message
        fix_side = _SIDE_MAP.get(side_str, "1")
        fix_ord_type = _ORD_TYPE_MAP.get(order_type_str, "1")
        fix_msg = msg_builder.build_new_order_single(
            cl_ord_id=cl_ord_id,
            symbol=symbol,
            side=fix_side,
            quantity=quantity,
            order_type=fix_ord_type,
            venue=venue,
            price=price if order_type_str in {"limit"} else None,
            stop_px=price if order_type_str == "stop" else None,
        )

        # 7. Determine institutional status from client record
        client_rec = ref_store.get_client(client_name)
        is_institutional = client_rec is not None and client_rec.tier == "institutional"
        sla_minutes = client_rec.sla_minutes if client_rec else None

        # 8. Create and add order
        now_iso = datetime.now(timezone.utc).isoformat()
        order = Order(
            order_id=order_id,
            cl_ord_id=cl_ord_id,
            symbol=symbol,
            cusip=ref_store.get_symbol(symbol).cusip if ref_store.get_symbol(symbol) else "",
            side=side_str,
            quantity=quantity,
            order_type=order_type_str,
            venue=venue,
            client_name=client_name,
            created_at=now_iso,
            updated_at=now_iso,
            price=price,
            is_institutional=is_institutional,
            sla_minutes=sla_minutes,
        )

        # 9. Simulate fill for market orders on active venue
        if order_type_str == "market" and session and session.status == "active":
            order.status = "filled"
            order.filled_quantity = quantity

        oms.add_order(order)
        oms.add_fix_message(order_id, fix_msg["raw"])

        lines = ["ORDER CONFIRMATION"]
        lines.append(f"  Order ID:     {order_id}")
        lines.append(f"  ClOrdID:      {cl_ord_id}")
        lines.append(f"  Symbol:       {symbol}")
        lines.append(f"  Side:         {side_str.upper()}")
        lines.append(f"  Quantity:     {quantity:,}")
        lines.append(f"  Type:         {order_type_str}")
        if price:
            lines.append(f"  Price:        ${price:.4f}")
        lines.append(f"  Venue:        {venue}")
        lines.append(f"  Status:       {order.status.upper()}")
        lines.append(f"  Client:       {client_name}")
        notional = quantity * (price or 0)
        if notional:
            lines.append(f"  Notional:     ${notional:,.0f}")
        if order.status == "filled":
            lines.append(f"  Fill:         SIMULATED FULL FILL ({quantity:,} shares)")
        if warnings:
            lines.append("\nWARNINGS:")
            for w in warnings:
                lines.append(f"  [!] {w}")
        lines.append("\nFIX MESSAGE (35=D NewOrderSingle):")
        lines.append(fix_msg["formatted"])
        lines.append(f"\nRAW: {fix_msg['raw']}")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in send_order: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in send_order: {exc!r}")


async def _tool_cancel_replace(args: dict) -> list[TextContent]:
    try:
        order_id = args["order_id"]
        action = args["action"]

        order = oms.get_order(order_id)
        if order is None:
            return _tc(f"ERROR: Order '{order_id}' not found in OMS.")
        if order.status in _TERMINAL_STATUSES:
            return _tc(
                f"ERROR: Order '{order_id}' is in terminal state '{order.status}' "
                "and cannot be cancelled or replaced."
            )

        new_cl_ord_id = oms.generate_cl_ord_id()

        if action == "cancel":
            fix_msg = msg_builder.build_order_cancel_request(
                cl_ord_id=new_cl_ord_id,
                orig_cl_ord_id=order.cl_ord_id,
                symbol=order.symbol,
                side=_SIDE_MAP.get(order.side, "1"),
                quantity=order.remaining_quantity,
                venue=order.venue,
            )
            oms.update_order_status(order_id, "canceled")
            msg_desc = "35=F OrderCancelRequest"
            new_status = "canceled"

        else:  # replace
            new_quantity = args.get("new_quantity", order.quantity)
            new_price = args.get("new_price", order.price)
            new_symbol = args.get("new_symbol")
            new_venue = args.get("new_venue", order.venue)

            fix_msg = msg_builder.build_order_cancel_replace(
                cl_ord_id=new_cl_ord_id,
                orig_cl_ord_id=order.cl_ord_id,
                symbol=order.symbol,
                side=_SIDE_MAP.get(order.side, "1"),
                quantity=new_quantity,
                venue=new_venue,
                price=new_price,
                new_symbol=new_symbol,
            )
            updates = {"status": "new", "cl_ord_id": new_cl_ord_id}
            if new_quantity:
                updates["quantity"] = new_quantity
            if new_price is not None:
                updates["price"] = new_price
            if new_symbol:
                updates["symbol"] = new_symbol.upper()
            if new_venue:
                updates["venue"] = new_venue.upper()
            oms.update_order_status(order_id, "new", **{k: v for k, v in updates.items() if k != "status"})
            oms.add_fix_message(order_id, fix_msg["raw"])
            msg_desc = "35=G OrderCancelReplaceRequest"
            new_status = "new (replaced)"

        updated = oms.get_order(order_id)
        lines = [f"CANCEL/REPLACE — {action.upper()} SENT"]
        lines.append(f"  Order ID:     {order_id}")
        lines.append(f"  Orig ClOrdID: {order.cl_ord_id}")
        lines.append(f"  New ClOrdID:  {new_cl_ord_id}")
        lines.append(f"  New Status:   {new_status.upper()}")
        if updated:
            lines.append(f"  Symbol:       {updated.symbol}")
            lines.append(f"  Venue:        {updated.venue}")
            lines.append(f"  Quantity:     {updated.quantity:,}")
        lines.append(f"\nFIX MESSAGE ({msg_desc}):")
        lines.append(fix_msg["formatted"])
        lines.append(f"\nRAW: {fix_msg['raw']}")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in cancel_replace: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in cancel_replace: {exc!r}")


async def _tool_check_ticker(args: dict) -> list[TextContent]:
    try:
        symbol_arg = args.get("symbol")
        cusip_arg = args.get("cusip")

        sym = None
        if symbol_arg:
            sym = ref_store.get_symbol(symbol_arg.upper())
        elif cusip_arg:
            sym = ref_store.get_symbol_by_cusip(cusip_arg)

        if sym is None:
            lookup = symbol_arg or cusip_arg or "(no input)"
            return _tc(f"Symbol not found in reference store for lookup: '{lookup}'")

        today = datetime.now(timezone.utc).date().isoformat()
        all_actions = ref_store.get_symbol_corporate_actions(sym.symbol)
        pending = [a for a in all_actions if a.effective_date >= today]

        open_orders = [
            o for o in oms.orders.values()
            if o.symbol.upper() == sym.symbol.upper() and o.status not in _TERMINAL_STATUSES
        ]

        lines = [f"SYMBOL LOOKUP — {sym.symbol}"]
        lines.append(f"  Name:             {sym.name}")
        lines.append(f"  CUSIP:            {sym.cusip}")
        lines.append(f"  Exchange:         {sym.listing_exchange}")
        lines.append(f"  Status:           {sym.status.upper()}")
        lines.append(f"  Lot Size:         {sym.lot_size}")
        lines.append(f"  Tick Size:        ${sym.tick_size:.4f}")
        lines.append(f"  Open Orders:      {len(open_orders)}")

        if pending:
            lines.append(f"\nPENDING CORPORATE ACTIONS ({len(pending)}):")
            for a in pending:
                eff = "[TODAY]" if a.effective_date == today else a.effective_date
                lines.append(f"  [{eff}] {a.action_id}  {a.action_type}")
                if a.old_symbol and a.new_symbol:
                    lines.append(f"          {a.old_symbol} -> {a.new_symbol}")
                if a.ratio:
                    lines.append(f"          Ratio: {a.ratio}")
                lines.append(f"          {a.description}")
                affected = [
                    o for o in oms.orders.values()
                    if o.symbol.upper() in {
                        (a.old_symbol or "").upper(), (a.new_symbol or "").upper()
                    } and o.status not in _TERMINAL_STATUSES
                ]
                if affected:
                    lines.append(f"          Affected open orders: {len(affected)}")
        else:
            lines.append("\nNo pending corporate actions.")

        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in check_ticker: {exc!r}")


async def _tool_update_ticker(args: dict) -> list[TextContent]:
    try:
        old_sym = args["old_symbol"].upper()
        new_sym = args["new_symbol"].upper()
        reason = args["reason"]

        updated_sym = ref_store.update_symbol_ticker(old_sym, new_sym)
        if updated_sym is None:
            return _tc(f"ERROR: Symbol '{old_sym}' not found in reference store.")

        updated_order_ids = oms.bulk_update_symbol(old_sym, new_sym)

        stop_orders = [
            oms.get_order(oid)
            for oid in updated_order_ids
            if oms.get_order(oid) and oms.get_order(oid).order_type == "stop"
        ]
        stop_orders = [o for o in stop_orders if o is not None]

        for o in stop_orders:
            oms.add_flag(o.order_id, "manual_review_required")

        lines = [f"TICKER UPDATE — {old_sym} -> {new_sym}"]
        lines.append(f"  Reason:           {reason}")
        lines.append(f"  Reference store:  Updated ({updated_sym.symbol})")
        lines.append(f"  Orders updated:   {len(updated_order_ids)}")
        if updated_order_ids:
            lines.append(f"  Order IDs:        {', '.join(updated_order_ids)}")
        if stop_orders:
            lines.append(f"\n[!] STOP ORDERS FLAGGED FOR MANUAL REVIEW ({len(stop_orders)}):")
            for o in stop_orders:
                lines.append(
                    f"  {o.order_id}  {o.symbol}  {o.side.upper()}  {o.quantity:,}  "
                    f"stop_px=${o.price or 0:.2f}  status={o.status}  client={o.client_name}"
                )
            lines.append(
                "  Stop orders require manual price review after a ticker change — "
                "the stop trigger price may no longer be valid."
            )
        else:
            lines.append("\nNo stop orders affected.")

        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in update_ticker: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in update_ticker: {exc!r}")


async def _tool_load_ticker(args: dict) -> list[TextContent]:
    try:
        symbol_str = args["symbol"].upper()
        new_sym = Symbol(
            symbol=symbol_str,
            cusip=args["cusip"],
            name=args["name"],
            listing_exchange=args["listing_exchange"],
            lot_size=int(args.get("lot_size", 100)),
            tick_size=float(args.get("tick_size", 0.01)),
        )
        ref_store.load_symbol(new_sym)

        # Find orders flagged 'symbol_not_loaded' for this symbol and release them
        released = []
        for order in oms.orders.values():
            if (
                order.symbol.upper() == symbol_str
                and "symbol_not_loaded" in order.flags
            ):
                order.flags.remove("symbol_not_loaded")
                order.status = "new"
                order.updated_at = datetime.now(timezone.utc).isoformat()
                released.append(order)

        lines = [f"TICKER LOADED — {symbol_str}"]
        lines.append(f"  CUSIP:          {new_sym.cusip}")
        lines.append(f"  Name:           {new_sym.name}")
        lines.append(f"  Exchange:       {new_sym.listing_exchange}")
        lines.append(f"  Lot Size:       {new_sym.lot_size}")
        lines.append(f"  Tick Size:      ${new_sym.tick_size:.4f}")
        lines.append(f"  Status:         ACTIVE")
        lines.append(f"  Orders Released: {len(released)}")
        if released:
            lines.append("\nReleased Orders:")
            for o in released:
                lines.append(
                    f"  {o.order_id}  {o.symbol}  {o.side.upper()}  "
                    f"{o.quantity:,}  {o.order_type}  client={o.client_name}"
                )
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in load_ticker: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in load_ticker: {exc!r}")


async def _tool_fix_session_issue(args: dict) -> list[TextContent]:
    try:
        venue = args["venue"].upper()
        action = args["action"]

        session = session_manager.get_session(venue)
        if session is None:
            return _tc(f"ERROR: No FIX session found for venue '{venue}'.")

        fix_msg = None
        released = []

        if action == "resend_request":
            fix_msg = msg_builder.build_resend_request(
                begin_seq=session.expected_recv_seq,
                end_seq=session.last_recv_seq,
            )
            session_manager.apply_resend_request(venue)
            released = _release_venue_stuck_orders(venue)
            action_desc = (
                f"ResendRequest sent for seq {session.expected_recv_seq}"
                f"..{session.last_recv_seq}. Session re-aligned and marked active."
            )

        elif action == "reset_sequence":
            new_seq = session.last_recv_seq
            fix_msg = msg_builder.build_sequence_reset(new_seq=new_seq)
            session_manager.apply_sequence_reset(venue, new_seq=new_seq)
            action_desc = f"SequenceReset applied. Both recv sequences set to {new_seq}."

        elif action == "reconnect":
            fix_msg = msg_builder.build_logon()
            session_manager.apply_reconnect(venue)
            released = _release_venue_stuck_orders(venue)
            action_desc = (
                "Logon sent. Session reconnected — recv sequences reset to 1, "
                "status set to active."
            )

        else:
            return _tc(f"ERROR: Unknown action '{action}'")

        refreshed = session_manager.get_session(venue)
        lines = [f"FIX SESSION FIX — {venue} / {action.upper()}"]
        lines.append(f"  Action:         {action_desc}")
        if refreshed:
            lines.append(f"  New Status:     {refreshed.status.upper()}")
            lines.append(f"  Sent Seq:       {refreshed.last_sent_seq}")
            lines.append(f"  Recv Seq:       {refreshed.last_recv_seq}")
            lines.append(f"  Expected Recv:  {refreshed.expected_recv_seq}")
        lines.append(f"  Orders Released: {len(released)}")
        if released:
            lines.append("\nReleasing stuck orders:")
            for o in released:
                sla = _sla_countdown(o)
                sla_str = f"  *** {sla} ***" if sla else ""
                lines.append(
                    f"  {o.order_id}  {o.symbol}  {o.side.upper()}  "
                    f"{o.quantity:,}  {o.order_type}  client={o.client_name}  "
                    f"status={o.status}{sla_str}"
                )
        if fix_msg:
            lines.append(f"\nFIX MESSAGE ({fix_msg['fields'].get(35, '?')}):")
            lines.append(fix_msg["formatted"])
            lines.append(f"\nRAW: {fix_msg['raw']}")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in fix_session_issue: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in fix_session_issue: {exc!r}")


async def _tool_validate_orders(args: dict) -> list[TextContent]:
    try:
        order_ids = args.get("order_ids", [])
        symbol_filter = args.get("symbol")
        status_filter = args.get("status")

        candidates = oms.query_orders(
            symbol=symbol_filter,
            status=status_filter,
        )
        if order_ids:
            id_set = set(order_ids)
            candidates = [o for o in candidates if o.order_id in id_set]
            # Also fetch directly-specified IDs not caught by the filter
            for oid in order_ids:
                if not any(o.order_id == oid for o in candidates):
                    direct = oms.get_order(oid)
                    if direct:
                        candidates.append(direct)

        if not candidates:
            return _tc("No orders found matching the given filters.")

        # Build duplicate ClOrdID map
        cl_ord_counts: dict[str, int] = {}
        for o in oms.orders.values():
            cl_ord_counts[o.cl_ord_id] = cl_ord_counts.get(o.cl_ord_id, 0) + 1

        lines = [f"ORDER VALIDATION — {len(candidates)} order(s)"]
        lines.append(f"{'ID':<22}  {'STATUS':<6}  RESULT")
        lines.append("─" * 80)

        pass_count = 0
        fail_count = 0

        for o in candidates:
            failures = []

            # Symbol validity
            sym_valid, sym_reason = ref_store.is_symbol_valid(o.symbol)
            if not sym_valid:
                failures.append(f"Symbol: {sym_reason}")

            # Venue active
            session = session_manager.get_session(o.venue)
            if session is None:
                failures.append(f"Venue: no FIX session configured for '{o.venue}'")
            elif session.status == "down":
                failures.append(f"Venue: {o.venue} session is DOWN")

            # Duplicate ClOrdID
            if cl_ord_counts.get(o.cl_ord_id, 0) > 1:
                failures.append(f"ClOrdID '{o.cl_ord_id}' is duplicated across {cl_ord_counts[o.cl_ord_id]} orders")

            # Client active
            client_rec = ref_store.get_client(o.client_name)
            if client_rec is None:
                failures.append(f"Client '{o.client_name}' not found in reference data")
            elif not client_rec.active:
                failures.append(f"Client '{o.client_name}' is inactive")

            if failures:
                fail_count += 1
                lines.append(f"  {o.order_id:<22}  FAIL")
                for f in failures:
                    lines.append(f"      - {f}")
            else:
                pass_count += 1
                lines.append(f"  {o.order_id:<22}  PASS")

        lines.append(f"\nSUMMARY: {pass_count} PASS, {fail_count} FAIL out of {len(candidates)} validated.")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in validate_orders: {exc!r}")


async def _tool_run_premarket_check(_args: dict) -> list[TextContent]:
    try:
        now = datetime.now(timezone.utc)
        now_str = now.strftime("%Y-%m-%d %H:%M:%S ET")
        today = now.date().isoformat()

        criticals: list[str] = []
        warnings_list: list[str] = []
        info_list: list[str] = []

        # 1. FIX session health
        down_sessions = session_manager.get_down_sessions()
        degraded_sessions = session_manager.get_degraded_sessions()
        gapped_sessions = [s for s in session_manager.get_all_sessions() if s.has_sequence_gap]

        for s in down_sessions:
            stuck_count = len([
                o for o in oms.orders.values()
                if o.venue.upper() == s.venue.upper() and o.status in {"stuck", "new"}
            ])
            notional_at_risk = sum(
                o.notional_value for o in oms.orders.values()
                if o.venue.upper() == s.venue.upper()
                and o.status in {"stuck", "new"}
                and o.price
            )
            block = (
                f"{s.venue} FIX SESSION DOWN\n"
                f"   Session ID: {s.session_id}\n"
                f"   Error: {s.error or 'unknown'}\n"
                f"   Stuck orders: {stuck_count}  Notional at risk: ${notional_at_risk:,.0f}\n"
                f"   Recommendation: fix_session_issue(venue='{s.venue}', action='reconnect')"
            )
            criticals.append(block)

        for s in gapped_sessions:
            block = (
                f"{s.venue} SEQUENCE GAP: expected={s.expected_recv_seq}, "
                f"got={s.last_recv_seq}, gap={s.sequence_gap_size}\n"
                f"   Recommendation: fix_session_issue(venue='{s.venue}', action='resend_request')"
            )
            warnings_list.append(block)

        for s in degraded_sessions:
            warnings_list.append(
                f"{s.venue} session DEGRADED — latency {s.latency_ms} ms. "
                "Monitor closely during open."
            )

        # 2. Corporate actions effective today
        today_actions = ref_store.get_effective_today_actions(today)
        for ca in today_actions:
            affected = [
                o for o in oms.orders.values()
                if o.symbol.upper() in {
                    (ca.old_symbol or "").upper(), (ca.new_symbol or "").upper()
                } and o.status not in _TERMINAL_STATUSES
            ]
            block = (
                f"CORP ACTION EFFECTIVE TODAY: {ca.action_id} ({ca.action_type})\n"
                f"   {ca.description}\n"
                f"   Affected open orders: {len(affected)}"
            )
            if len(affected) > 0:
                criticals.append(block)
            else:
                warnings_list.append(block)

        # 3. Symbol-not-loaded orders
        unloaded = [
            o for o in oms.orders.values()
            if "symbol_not_loaded" in o.flags
        ]
        if unloaded:
            syms = {o.symbol for o in unloaded}
            criticals.append(
                f"{len(unloaded)} ORDER(S) PENDING SYMBOL LOAD: {', '.join(sorted(syms))}\n"
                f"   Use load_ticker() for each missing symbol to release."
            )

        # 4. Validate all new/stuck orders
        active_orders = [
            o for o in oms.orders.values()
            if o.status in {"new", "stuck"}
        ]
        validation_issues: list[str] = []
        cl_ord_counts: dict[str, int] = {}
        for o in oms.orders.values():
            cl_ord_counts[o.cl_ord_id] = cl_ord_counts.get(o.cl_ord_id, 0) + 1

        for o in active_orders:
            issues = []
            sym_valid, sym_reason = ref_store.is_symbol_valid(o.symbol)
            if not sym_valid:
                issues.append(sym_reason)
            s = session_manager.get_session(o.venue)
            if s and s.status == "down":
                issues.append(f"Venue {o.venue} is DOWN")
            if cl_ord_counts.get(o.cl_ord_id, 0) > 1:
                issues.append("Duplicate ClOrdID")
            if issues:
                validation_issues.append(
                    f"{o.order_id} ({o.symbol} {o.side} {o.quantity:,}): {'; '.join(issues)}"
                )

        if validation_issues:
            warnings_list.append(
                f"{len(validation_issues)} NEW/STUCK ORDER(S) WITH VALIDATION ISSUES:\n"
                + "\n".join(f"   {v}" for v in validation_issues)
            )

        # 5. SLA deadlines
        sla_critical: list[str] = []
        for o in oms.get_institutional_orders():
            sla = _sla_countdown(o)
            if sla and "BREACH" in sla.upper():
                sla_critical.append(
                    f"{o.order_id}  {o.symbol}  {o.side.upper()}  {o.quantity:,}  "
                    f"client={o.client_name}  [{sla}]"
                )
        if sla_critical:
            block = f"INSTITUTIONAL SLA BREACH IMMINENT ({len(sla_critical)} orders):\n"
            block += "\n".join(f"   {s}" for s in sla_critical)
            criticals.append(block)

        # 6. Info
        all_sessions = session_manager.get_all_sessions()
        active_count = sum(1 for s in all_sessions if s.status == "active")
        info_list.append(
            f"FIX sessions: {active_count}/{len(all_sessions)} active, "
            f"{len(down_sessions)} down, {len(degraded_sessions)} degraded."
        )
        total_open = sum(1 for o in oms.orders.values() if o.status not in _TERMINAL_STATUSES)
        total_notional = oms.total_notional_at_risk()
        info_list.append(
            f"OMS: {total_open} open orders. "
            f"Institutional notional at risk: ${total_notional:,.0f}."
        )
        info_list.append(
            f"Reference data: {len(ref_store.symbols)} symbols loaded, "
            f"{len(ref_store.clients)} clients."
        )

        # Assemble report
        lines = [f"=== PRE-MARKET CHECK — {now_str} ===\n"]

        lines.append(f"CRITICAL ({len(criticals)} issues)")
        lines.append("━" * 40)
        if criticals:
            for i, c in enumerate(criticals, 1):
                lines.append(f"{i}. {c}")
        else:
            lines.append("None.")
        lines.append("")

        lines.append(f"WARNING ({len(warnings_list)} issues)")
        lines.append("━" * 40)
        if warnings_list:
            for i, w in enumerate(warnings_list, 1):
                lines.append(f"{i}. {w}")
        else:
            lines.append("None.")
        lines.append("")

        lines.append(f"INFO ({len(info_list)} items)")
        lines.append("━" * 40)
        for item in info_list:
            lines.append(f"- {item}")
        lines.append("")

        lines.append("=== SUMMARY ===")
        if not criticals and not warnings_list:
            lines.append("System healthy. No critical issues detected.")
        else:
            lines.append(
                f"Address {len(criticals)} critical and {len(warnings_list)} warning issue(s) before market open."
            )
        total_issues = len(criticals) + len(warnings_list)
        lines.append(f"Total issues requiring attention: {total_issues}")

        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in run_premarket_check: {exc!r}")


def _fmt_algo_row(a: AlgoOrder) -> str:
    dev = a.schedule_deviation_pct
    dev_str = f"{dev:+.1f}%" if dev is not None else "N/A"
    sf = a.shortfall_bps
    sf_str = f"{sf:.1f}bps" if sf is not None else "N/A"
    pov_str = f"{a.pov_rate*100:.0f}%" if a.pov_rate else "—"
    return (
        f"  {a.algo_id:<22}  {a.symbol:<6}  {a.side.upper():<4}  "
        f"{a.total_qty:>8,}  {a.algo_type:<8}  {a.status:<10}  "
        f"exec={a.execution_pct:.0f}%  sched={a.schedule_pct:.0f}%  "
        f"dev={dev_str}  IS={sf_str}  pov={pov_str}  {a.client_name}"
    )


async def _tool_send_algo_order(args: dict) -> list[TextContent]:
    try:
        symbol = args["symbol"].upper()
        side = args["side"].lower()
        quantity = int(args["quantity"])
        algo_type = args["algo_type"].upper()
        client_name = args["client_name"]
        venue = _auto_route(args.get("venue"))
        end_time = args.get("end_time")
        pov_rate = float(args["pov_rate"]) if args.get("pov_rate") is not None else None
        arrival_px = float(args["arrival_px"]) if args.get("arrival_px") is not None else None
        slice_count = int(args.get("slice_count", 6))

        if algo_type not in ALGO_TYPES:
            return _tc(f"ERROR: Unknown algo_type '{algo_type}'. Valid: {', '.join(sorted(ALGO_TYPES))}")

        valid, reason = ref_store.is_symbol_valid(symbol)
        if not valid:
            return _tc(f"ALGO ORDER REJECTED — Symbol validation failed: {reason}")

        client_rec = ref_store.get_client(client_name)
        is_inst = client_rec is not None and client_rec.tier == "institutional"
        sla_min = client_rec.sla_minutes if client_rec else None

        now_iso = datetime.now(timezone.utc).isoformat()
        algo_id = algo_engine.generate_algo_id()

        sym_rec = ref_store.get_symbol(symbol)
        ref_px = arrival_px or 0.0
        notional = quantity * ref_px

        algo = AlgoOrder(
            algo_id=algo_id,
            client_name=client_name,
            symbol=symbol,
            cusip=sym_rec.cusip if sym_rec else "",
            side=side,
            total_qty=quantity,
            algo_type=algo_type,
            start_time=now_iso,
            venue=venue,
            created_at=now_iso,
            updated_at=now_iso,
            end_time=end_time,
            pov_rate=pov_rate,
            total_slices=slice_count,
            arrival_px=arrival_px,
            is_institutional=is_inst,
            sla_minutes=sla_min,
        )
        algo_engine.add_algo(algo)

        lines = ["ALGO ORDER CONFIRMED"]
        lines.append(f"  Algo ID:      {algo_id}")
        lines.append(f"  Symbol:       {symbol}")
        lines.append(f"  Side:         {side.upper()}")
        lines.append(f"  Quantity:     {quantity:,}")
        lines.append(f"  Algo Type:    {algo_type}")
        lines.append(f"  Venue:        {venue}")
        lines.append(f"  Client:       {client_name}")
        lines.append(f"  Slices:       {slice_count} planned")
        if arrival_px:
            lines.append(f"  Arrival Px:   ${arrival_px:.4f}")
            lines.append(f"  Notional:     ${notional:,.0f}")
        if pov_rate:
            lines.append(f"  POV Rate:     {pov_rate*100:.1f}%")
        if end_time:
            lines.append(f"  Window End:   {end_time}")
        lines.append(f"  Status:       RUNNING")
        lines.append("\nUse check_algo_status to monitor execution progress.")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in send_algo_order: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in send_algo_order: {exc!r}")


async def _tool_check_algo_status(args: dict) -> list[TextContent]:
    try:
        algo_id_filter = args.get("algo_id")
        symbol_filter = args.get("symbol")
        status_filter = args.get("status")

        if algo_id_filter:
            algo = algo_engine.get_algo(algo_id_filter)
            algos = [algo] if algo else []
        else:
            algos = algo_engine.get_all()
            if symbol_filter:
                algos = [a for a in algos if a.symbol.upper() == symbol_filter.upper()]
            if status_filter:
                algos = [a for a in algos if a.status == status_filter]

        if not algos:
            return _tc("No algo orders match the specified filters.")

        # Sort: problematic first, then by schedule deviation
        problematic = algo_engine.get_problematic()
        prob_ids = {a.algo_id for a in problematic}

        urgent, active, terminal = [], [], []
        for a in algos:
            if a.status in {"completed", "canceled"}:
                terminal.append(a)
            elif a.algo_id in prob_ids:
                urgent.append(a)
            else:
                active.append(a)

        header = (
            f"ALGO STATUS — {len(algos)} algo(s)\n"
            f"{'ID':<22}  {'SYM':<6}  {'SIDE':<4}  {'QTY':>8}  {'TYPE':<8}  "
            f"{'STATUS':<10}  EXEC%  SCHED%  DEV  SHORTFALL  POV  CLIENT\n"
            + "─" * 120
        )
        lines = [header]

        if urgent:
            lines.append("\n[!] NEEDS ATTENTION")
            for a in urgent:
                lines.append(_fmt_algo_row(a))
                for flag in a.flags:
                    lines.append(f"      flag: {flag}")
                if a.notes:
                    lines.append(f"      note: {a.notes}")

        if active:
            lines.append("\nRUNNING / PAUSED")
            for a in active:
                lines.append(_fmt_algo_row(a))

        if terminal:
            lines.append("\nCOMPLETED / CANCELED")
            for a in terminal:
                lines.append(_fmt_algo_row(a))

        total_notional = sum(a.notional_value for a in algos)
        lines.append(f"\nTotal algo notional: ${total_notional:,.0f}")
        lines.append(f"Problematic: {len(urgent)}  Active: {len(active)}  Terminal: {len(terminal)}")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in check_algo_status: {exc!r}")


async def _tool_modify_algo(args: dict) -> list[TextContent]:
    try:
        algo_id = args["algo_id"]
        action = args["action"]

        algo = algo_engine.get_algo(algo_id)
        if algo is None:
            return _tc(f"ERROR: Algo '{algo_id}' not found.")
        if algo.status in {"completed", "canceled"}:
            return _tc(f"ERROR: Algo '{algo_id}' is in terminal state '{algo.status}'.")

        if action == "pause":
            result = algo_engine.pause_algo(algo_id)
            desc = f"Algo paused. Child order slicing suspended at {datetime.now(timezone.utc).strftime('%H:%M:%S')} ET."
        elif action == "resume":
            result = algo_engine.resume_algo(algo_id)
            desc = f"Algo resumed. Slice scheduling restarted."
        elif action == "update_pov_rate":
            new_rate = args.get("new_pov_rate")
            if new_rate is None:
                return _tc("ERROR: new_pov_rate is required for action=update_pov_rate")
            if not 0 < new_rate <= 1:
                return _tc("ERROR: new_pov_rate must be between 0.01 and 1.0")
            old_rate = algo.pov_rate
            result = algo_engine.update_pov_rate(algo_id, float(new_rate))
            desc = f"POV rate updated: {(old_rate or 0)*100:.1f}% → {new_rate*100:.1f}%"
        else:
            return _tc(f"ERROR: Unknown action '{action}'")

        if result is None:
            return _tc(f"ERROR: Could not apply action '{action}' to algo '{algo_id}' in state '{algo.status}'")

        lines = [f"ALGO MODIFIED — {algo_id}"]
        lines.append(f"  Action:       {action.upper()}")
        lines.append(f"  New Status:   {result.status.upper()}")
        lines.append(f"  Description:  {desc}")
        lines.append(f"  Symbol:       {result.symbol}  {result.side.upper()}  {result.total_qty:,}")
        lines.append(f"  Executed:     {result.executed_qty:,} / {result.total_qty:,} ({result.execution_pct:.0f}%)")
        lines.append(f"  Remaining:    {result.remaining_qty:,}")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in modify_algo: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in modify_algo: {exc!r}")


async def _tool_cancel_algo(args: dict) -> list[TextContent]:
    try:
        algo_id = args["algo_id"]
        reason = args.get("reason", "Operator cancel")

        algo = algo_engine.get_algo(algo_id)
        if algo is None:
            return _tc(f"ERROR: Algo '{algo_id}' not found.")
        if algo.status in {"completed", "canceled"}:
            return _tc(f"ERROR: Algo '{algo_id}' is already in terminal state '{algo.status}'.")

        # Cancel all open child orders
        canceled_children = []
        for oid in algo.child_order_ids:
            order = oms.get_order(oid)
            if order and order.status not in {"filled", "canceled", "rejected"}:
                cl_ord_id = oms.generate_cl_ord_id()
                fix_msg = msg_builder.build_order_cancel_request(
                    cl_ord_id=cl_ord_id,
                    orig_cl_ord_id=order.cl_ord_id,
                    symbol=order.symbol,
                    side=_SIDE_MAP.get(order.side, "1"),
                    quantity=order.remaining_quantity,
                    venue=order.venue,
                )
                oms.update_order_status(oid, "canceled")
                canceled_children.append((order, fix_msg))

        algo_engine.cancel_algo(algo_id)

        executed_notional = algo.executed_qty * (algo.avg_px or 0)
        lines = [f"ALGO CANCELED — {algo_id}"]
        lines.append(f"  Symbol:           {algo.symbol}  {algo.side.upper()}  {algo.total_qty:,}")
        lines.append(f"  Client:           {algo.client_name}")
        lines.append(f"  Reason:           {reason}")
        lines.append(f"  Executed before cancel: {algo.executed_qty:,} shares (${executed_notional:,.0f})")
        lines.append(f"  Remaining canceled:     {algo.remaining_qty:,} shares")
        lines.append(f"  Child orders canceled:  {len(canceled_children)}")
        if canceled_children:
            lines.append("\nCanceled child orders:")
            for order, fix_msg in canceled_children:
                lines.append(f"  {order.order_id}  {order.symbol}  {order.side.upper()}  {order.remaining_quantity:,}  venue={order.venue}")
                lines.append(f"  FIX: {fix_msg['raw']}")
        return _tc("\n".join(lines))
    except KeyError as exc:
        return _tc(f"ERROR in cancel_algo: missing required parameter {exc}")
    except Exception as exc:
        return _tc(f"ERROR in cancel_algo: {exc!r}")


async def _tool_list_scenarios(args: dict) -> list[TextContent]:
    try:
        action = args.get("action", "list")
        config_dir = engine.config_dir / "scenarios"
        scenario_files = sorted(config_dir.glob("*.json")) if config_dir.exists() else []
        available = [f.stem for f in scenario_files]

        if action == "list":
            lines = ["# Available Trading Scenarios\n"]
            for name_s in available:
                ctx = SCENARIO_PROMPTS.get(name_s, "No context available.")
                first_line = ctx.split("\n")[0] if ctx else ""
                lines.append(f"## {name_s}")
                lines.append(f"  {first_line}\n")
            lines.append(f"Total: {len(available)} scenario(s)")
            lines.append("\nTo load: list_scenarios(action='load', scenario_name='<name>')")
            return _tc("\n".join(lines))

        if action == "load":
            scenario_name = args.get("scenario_name", "").strip()
            if not scenario_name:
                return _tc("ERROR: scenario_name is required for action=load")
            if scenario_name not in available:
                return _tc(
                    f"ERROR: Scenario '{scenario_name}' not found.\n"
                    f"Available: {', '.join(available)}"
                )
            reset_runtime(scenario_name)
            ctx = SCENARIO_PROMPTS.get(scenario_name, "")
            lines = [f"# Scenario Loaded: {scenario_name}\n"]
            if ctx:
                lines.append(f"## Operational Context\n{ctx}\n")
            lines.append("Run run_premarket_check or check_fix_sessions to begin triage.")
            return _tc("\n".join(lines))

        return _tc(f"ERROR: Unknown action '{action}' — use 'list' or 'load'")
    except Exception as exc:
        return _tc(f"ERROR in list_scenarios: {exc!r}")


# ── New terminal CLI tool implementations ────────────────────────────

async def _tool_session_heartbeat(args: dict) -> list[TextContent]:
    """Send a heartbeat probe to a venue and return status."""
    try:
        venue = args.get("venue", "").upper()
        if not venue:
            # Return all venue heartbeat summaries
            sessions = session_manager.get_all_sessions()
            lines = ["HEARTBEAT SUMMARY", "═" * 50]
            for s in sessions:
                icon = _session_status_icon(s.status)
                hb_age = s.heartbeat_age_seconds
                hb_str = f"{hb_age:.0f}s ago" if hb_age is not None else "never"
                lines.append(f"  {icon} {s.venue:<8}  latency={s.latency_ms}ms  hb={hb_str}  seq_out={s.last_sent_seq}  seq_in={s.last_recv_seq}")
            return _tc("\n".join(lines))

        session = session_manager.get_session(venue)
        if session is None:
            return _tc(f"ERROR: No FIX session found for venue '{venue}'.")

        icon = _session_status_icon(session.status)
        hb_age = session.heartbeat_age_seconds
        hb_str = f"{hb_age:.0f}s ago" if hb_age is not None else "never"

        lines = [
            f"HEARTBEAT — {venue}",
            f"  Status:    {session.status.upper()}",
            f"  Latency:   {session.latency_ms}ms",
            f"  Hb Age:    {hb_str}",
            f"  Seq Out:   {session.last_sent_seq}",
            f"  Seq In:    {session.last_recv_seq}",
            f"  Expected:  {session.expected_recv_seq}",
        ]
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in session_heartbeat: {exc!r}")


async def _tool_reset_sequence(args: dict) -> list[TextContent]:
    """Reset FIX sequence numbers for a venue."""
    try:
        venue = args.get("venue", "").upper()
        if not venue:
            return _tc("ERROR: venue is required.")

        session = session_manager.get_session(venue)
        if session is None:
            return _tc(f"ERROR: No FIX session found for venue '{venue}'.")

        new_seq = max(session.last_recv_seq, session.last_sent_seq, session.expected_recv_seq)
        fix_msg = msg_builder.build_sequence_reset(new_seq=new_seq)
        session_manager.apply_sequence_reset(venue, new_seq=new_seq)

        refreshed = session_manager.get_session(venue)
        lines = [
            f"SEQUENCE RESET — {venue}",
            f"  New Seq:     {new_seq}",
            f"  Status:      {refreshed.status.upper() if refreshed else 'unknown'}",
        ]
        if refreshed:
            lines.append(f"  Sent Seq:    {refreshed.last_sent_seq}")
            lines.append(f"  Recv Seq:    {refreshed.last_recv_seq}")
            lines.append(f"  Expected:    {refreshed.expected_recv_seq}")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in reset_sequence: {exc!r}")


async def _tool_dump_session_state(args: dict) -> list[TextContent]:
    """Return full session diagnostics for a venue."""
    try:
        venue = args.get("venue", "").upper()
        if not venue:
            return _tc("ERROR: venue is required.")

        session = session_manager.get_session(venue)
        if session is None:
            return _tc(f"ERROR: No FIX session found for venue '{venue}'.")

        venue_orders = [
            o for o in oms.orders.values()
            if o.venue.upper() == venue
        ]
        open_orders = [o for o in venue_orders if o.status not in _TERMINAL_STATUSES]
        stuck_orders = [o for o in venue_orders if "venue_down" in o.flags]

        icon = _session_status_icon(session.status)
        lines = [
            f"SESSION DUMP — {venue}",
            "═" * 60,
            f"  {icon} Venue:          {session.venue}",
            f"     Session ID:    {session.session_id}",
            f"     Status:        {session.status.upper()}",
            f"     FIX Version:   {session.fix_version}",
            f"     Host:          {session.host}:{session.port}",
            f"     Sent Seq:      {session.last_sent_seq}",
            f"     Recv Seq:      {session.last_recv_seq}",
            f"     Expected:      {session.expected_recv_seq}",
            f"     Seq Gap:       {session.sequence_gap_size if session.has_sequence_gap else 'none'}",
            f"     Latency:       {session.latency_ms}ms",
            f"     Hb Age:        {session.heartbeat_age_seconds:.0f}s" if session.heartbeat_age_seconds is not None else "     Hb Age:        never",
        ]
        if session.error:
            lines.append(f"     Error:         {session.error}")
        if session.connected_since:
            lines.append(f"     Connected:     {session.connected_since}")

        lines.append(f"")
        lines.append(f"     Total Orders:  {len(venue_orders)}")
        lines.append(f"     Open Orders:   {len(open_orders)}")
        lines.append(f"     Stuck Orders:  {len(stuck_orders)}")

        if stuck_orders:
            lines.append(f"")
            lines.append(f"     [!] STUCK ORDERS:")
            for o in stuck_orders:
                sla = _sla_countdown(o)
                sla_str = f"  *** {sla} ***" if sla else ""
                lines.append(f"       {o.order_id}  {o.symbol}  {o.side.upper()}  {o.quantity:,}  status={o.status}{sla_str}")

        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in dump_session_state: {exc!r}")


async def _tool_tail_logs(args: dict) -> list[TextContent]:
    """Return the last N lines of a log file."""
    try:
        file_path = args.get("file", "")
        n = args.get("lines", 20)

        if not file_path:
            return _tc("ERROR: file is required.")

        # Try common log locations
        candidates = [
            Path(file_path),
            Path(f"/tmp/{file_path}"),
            Path(f"/var/log/{file_path}"),
            Path(f"{os.environ.get('FIX_MCP_CONFIG_DIR', '')}/{file_path}"),
        ]

        log_file = None
        for c in candidates:
            if c.exists() and c.is_file():
                log_file = c
                break

        if log_file:
            raw = log_file.read_text(errors="replace")
            text_lines = raw.splitlines()
            tail = text_lines[-int(n):]
            return _tc(f"TAIL {file_path} ({len(tail)} lines):\n" + "\n".join(tail))

        # Simulated data when no file found
        now = datetime.now(timezone.utc).strftime("%H:%M:%S")
        simulated = [
            f"{now} INFO  Session heartbeat check complete",
            f"{now} INFO  FIX message dispatched to NYSE (seq=1247)",
            f"{now} WARN  Elevated latency at BATS: 45ms",
            f"{now} INFO  Order ORD-0042 filled at NYSE — TSLA 100@412.50",
            f"{now} INFO  VWAP algo slice scheduled for AAPL",
            f"{now} INFO  Heartbeat received from LSE (seq=891)",
            f"{now} INFO  Market data feed refreshed — XNYS fresh={3}ms",
            f"{now} WARN  Venue ARCA reporting seq gap — expected 445, got 442",
            f"{now} INFO  ResendRequest sent to ARCA for 442..445",
            f"{now} INFO  Gap recovery complete at ARCA",
        ]
        return _tc(f"TAIL {file_path} (simulated, last {min(n, len(simulated))} lines):\n" + "\n".join(simulated[-int(n):]))
    except Exception as exc:
        return _tc(f"ERROR in tail_logs: {exc!r}")


async def _tool_grep_logs(args: dict) -> list[TextContent]:
    """Search log files for a pattern."""
    try:
        pattern = args.get("pattern", "")
        file_path = args.get("file", "")

        if not pattern:
            return _tc("ERROR: pattern is required.")

        if not file_path:
            return _tc("ERROR: file is required.")

        # Try real file first
        candidates = [
            Path(file_path),
            Path(f"/tmp/{file_path}"),
            Path(f"/var/log/{file_path}"),
        ]
        log_file = None
        for c in candidates:
            if c.exists() and c.is_file():
                log_file = c
                break

        if log_file:
            raw = log_file.read_text(errors="replace")
            compiled = re.compile(pattern, re.IGNORECASE)
            matches = [line for line in raw.splitlines() if compiled.search(line)]
            if matches:
                return _tc(f"GREP '{pattern}' in {file_path} — {len(matches)} matches:\n" + "\n".join(matches))
            return _tc(f"GREP '{pattern}' in {file_path} — no matches.")

        # Simulated data
        now = datetime.now(timezone.utc).strftime("%H:%M:%S")
        simulated_lines = [
            f"{now} ERROR {pattern} — session timeout at BATS",
            f"{now} WARN  {pattern} — retry attempt 1/3",
            f"{now} INFO  {pattern} — session recovered",
        ]
        return _tc(f"GREP '{pattern}' in {file_path} (simulated, 3 matches):\n" + "\n".join(simulated_lines))
    except Exception as exc:
        return _tc(f"ERROR in grep_logs: {exc!r}")


async def _tool_update_venue_status(args: dict) -> list[TextContent]:
    """Change venue status (active/degraded/down) and affect SOR routing."""
    try:
        import random
        venue = args.get("venue", "").upper()
        if not venue:
            return _tc("ERROR: venue is required.")
        new_status = args.get("status", "active").lower()
        if new_status not in ("active", "degraded", "down"):
            return _tc(f"ERROR: Invalid status '{new_status}'. Must be active, degraded, or down.")
        session = session_manager.get_session(venue)
        if session is None:
            return _tc(f"ERROR: No FIX session found for venue '{venue}'.")
        old_status = session.status
        old_latency = session.latency_ms
        new_latency = args.get("latency_ms") or {
            "active": random.randint(1, 10),
            "degraded": random.randint(100, 300),
            "down": 999,
        }.get(new_status, 5)
        session_manager.update_session_status(venue, new_status)
        session.latency_ms = new_latency
        if new_status == "down" and old_status != "down":
            for o in oms.orders.values():
                if o.venue.upper() == venue and o.status not in _TERMINAL_STATUSES:
                    if "venue_down" not in o.flags:
                        o.flags.append("venue_down")
                        o.updated_at = datetime.now(timezone.utc).isoformat()
        elif new_status == "active" and old_status == "down":
            _release_venue_stuck_orders(venue)
        refreshed = session_manager.get_session(venue)
        lines = [f"VENUE STATUS UPDATE \u2014 {venue}"]
        lines.append(f"  Status:   {old_status.upper()} -> {new_status.upper()}")
        lines.append(f"  Latency:  {old_latency}ms -> {new_latency}ms")
        if refreshed:
            lines.append(f"  Session:  {refreshed.status.upper()}")
        if session.error:
            session.error = None
            lines.append(f"  Error:    Cleared")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in update_venue_status: {exc!r}")


async def _tool_check_market_data_staleness(args: dict) -> list[TextContent]:
    try:
        symbol = args.get("symbol")
        if symbol:
            _assert_symbol(symbol)
            symbols = [symbol.upper()] if symbol.upper() in market_data_hub._books else []
            if not symbols:
                return _tc(f"Unknown symbol '{symbol}'. No market data tracked.")
        else:
            symbols = sorted(market_data_hub._books.keys())

        if not symbols:
            return _tc("No market data tracked.")

        lines = ["MARKET DATA STALENESS", "=" * 60]
        lines.append(f"  {'SYMBOL':<8} {'STALENESS':>12} {'LAST UPDATE':>30}  FLAG")
        for sym in symbols:
            book = market_data_hub.get_quote(sym)
            ms = market_data_hub.staleness_ms(sym)
            flag = "[STALE]" if ms < 0 or ms > 500 else "[OK]"
            ms_str = f"{ms} ms" if ms >= 0 else "unknown"
            last = book.last_updated if book and book.last_updated else "—"
            lines.append(f"  {sym:<8} {ms_str:>12} {last:>30}  {flag}")
        return _tc("\n".join(lines))
    except ValueError as exc:
        return _tc(f"ERROR in check_market_data_staleness: {exc}")
    except Exception as exc:  # noqa: BLE001
        return _tc(f"ERROR in check_market_data_staleness: {exc!r}")


async def _tool_release_stuck_orders(args: dict) -> list[TextContent]:
    """Release all stuck orders across all venues."""
    try:
        all_sessions = session_manager.get_all_sessions()
        released_all = []
        for s in all_sessions:
            if s.status == "down" or s.has_sequence_gap:
                released = _release_venue_stuck_orders(s.venue)
                released_all.extend(released)

        # Also release orders stuck regardless of session status
        for order in list(oms.orders.values()):
            if order.status == "stuck" and "venue_down" in order.flags:
                order.flags.remove("venue_down")
                order.status = "new"
                order.updated_at = datetime.now(timezone.utc).isoformat()
                if order not in released_all:
                    released_all.append(order)

        lines = [f"RELEASED STUCK ORDERS — {len(released_all)} order(s)"]
        if released_all:
            for o in released_all:
                sla = _sla_countdown(o)
                sla_str = f"  *** {sla} ***" if sla else ""
                lines.append(f"  {o.order_id}  {o.symbol}  {o.side.upper()}  {o.quantity:,}  venue={o.venue}  status={o.status}{sla_str}")
        else:
            lines.append("  No stuck orders found.")
        return _tc("\n".join(lines))
    except Exception as exc:
        return _tc(f"ERROR in release_stuck_orders: {exc!r}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


def main_sync() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    main_sync()

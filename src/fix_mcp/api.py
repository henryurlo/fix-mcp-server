"""REST API for FIX MCP — exposes all tools and engine state as HTTP endpoints.

Runs on port 8000 by default. Consumed by external OMS hooks, Claude.ai
integrations, and any client that needs HTTP access to the trading engine.

Endpoints:
    GET  /health             — liveness probe for container healthcheck
    GET  /api/status         — scenario, session, order, and algo summary
    GET  /api/scenarios      — list all scenarios with context strings
    POST /api/tool           — call any MCP tool by name
    POST /api/reset          — load a scenario / reset runtime
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import threading
from contextlib import asynccontextmanager
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse, StreamingResponse

from fix_mcp import server
from fix_mcp.server import get_tcp_integration, _trace_buffer
from fix_mcp.metrics import FIX_METRICS
from fix_mcp.engine.manual_runbook import MANUAL_RUNBOOK
from fix_mcp.prompts.trading_ops import SCENARIO_PROMPTS

# ---------------------------------------------------------------------------
# Shared state: agent mode + event log
# ---------------------------------------------------------------------------

_mode: str = "human"          # "human" | "agent" | "mixed"
_events: deque = deque(maxlen=100)
_events_lock = threading.Lock()
_event_stream_clients: set[asyncio.Queue[dict[str, Any]]] = set()
_event_stream_lock = threading.Lock()


def _read_local_env_key(name: str) -> str:
    """Read an ignored local env file without requiring a server restart."""
    for filename in (".env.local", ".env"):
        path = Path.cwd() / filename
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                clean = line.strip()
                if not clean or clean.startswith("#"):
                    continue
                if "=" not in clean and clean.startswith(("sk-", "sk-or-")):
                    return clean
                if "=" not in clean:
                    continue
                key, value = clean.split("=", 1)
                if key.strip() == name:
                    return value.strip().strip('"').strip("'")
        except OSError:
            continue
    return ""



def _publish_event(tool: str, args: dict, result: str, ok: bool, source: str = "dashboard") -> None:
    """Append event to in-memory log and optionally publish to Redis."""
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": tool,
        "ok": ok,
        "source": source,
        "arguments": args,
        "summary": (result or "")[:200],
    }
    with _events_lock:
        _events.appendleft(event)
    _broadcast_event({"type": "tool_execution", "event": event})
    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        try:
            import redis as _redis  # optional dependency
            r = _redis.from_url(redis_url, socket_timeout=1)
            r.publish("fix:events", json.dumps(event))
        except Exception:
            pass


def _clear_events() -> None:
    """Clear transient dashboard event history for a fresh demo run."""
    with _events_lock:
        _events.clear()
    _broadcast_event({"type": "events_cleared", "ts": datetime.now(timezone.utc).isoformat()})
    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        try:
            import redis as _redis  # optional dependency
            r = _redis.from_url(redis_url, socket_timeout=1)
            r.delete("fix:events")
        except Exception:
            pass


def _on_tool_call(name: str, args: dict, result: str, ok: bool, source: str) -> None:
    """Listener registered with server._tool_listeners — receives all tool calls."""
    _publish_event(name, args, result, ok, source)


def _broadcast_event(payload: dict[str, Any]) -> None:
    """Fan out an event payload to all connected SSE clients."""
    with _event_stream_lock:
        clients = list(_event_stream_clients)
    stale: list[asyncio.Queue[dict[str, Any]]] = []
    for queue in clients:
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            stale.append(queue)
        except RuntimeError:
            stale.append(queue)
    if stale:
        with _event_stream_lock:
            for queue in stale:
                _event_stream_clients.discard(queue)


def _sse_payload(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


# Register the listener once — works for both REST API calls (source="dashboard")
# and MCP HTTP calls from Claude (source="claude").
if _on_tool_call not in server._tool_listeners:
    server._tool_listeners.append(_on_tool_call)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload).encode("utf-8")


def _available_scenarios() -> list[str]:
    config_dir = Path(server.engine.config_dir) / "scenarios"
    if not config_dir.exists():
        return []
    return sorted(p.stem for p in config_dir.glob("*.json"))


def _scenario_metadata() -> list[dict]:
    """Return a list of enriched scenario metadata dicts.

    Reads the runbook-level fields (title, severity, estimated_minutes,
    categories, difficulty, description, hints, success_criteria) from each
    scenario JSON.  This allows the UI and copilot to display rich context
    rather than just a bare slug name.
    """
    config_dir = Path(server.engine.config_dir) / "scenarios"
    if not config_dir.exists():
        return []
    result = []
    for path in sorted(config_dir.glob("*.json")):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue

        result.append({
            "name": data.get("name", path.stem),
            "title": data.get("title", data.get("name", path.stem)),
            "description": data.get("description", ""),
            "severity": data.get("severity", "medium"),
            "estimated_minutes": data.get("estimated_minutes", 0),
            "categories": data.get("categories", []),
            "difficulty": data.get("difficulty", "intermediate"),
            "simulated_time": data.get("simulated_time", ""),
            "is_algo": _is_algo_scenario(data.get("name", path.stem)),
            "success_criteria_count": len(data.get("success_criteria", [])),
            "runbook_step_count": len(data.get("runbook", {}).get("steps", [])),
        })
    return result


def _scenario_context(name: str) -> dict | None:
    """Return the full scenario dict including runbook, hints, and
    success_criteria — used by the copilot to enrich its system prompt."""
    config_dir = Path(server.engine.config_dir) / "scenarios"
    path = config_dir / f"{name}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


_ALGO_SCENARIO_KEYWORDS = ("twap", "vwap", "is_dark", "algo", "pov")


def _is_algo_scenario(name: str) -> bool:
    return any(k in name.lower() for k in _ALGO_SCENARIO_KEYWORDS)


def _session_summary() -> list[dict]:
    return [
        {
            "venue": s.venue,
            "session_id": s.session_id,
            "status": s.status,
            "latency_ms": s.latency_ms,
            "last_sent_seq": s.last_sent_seq,
            "last_recv_seq": s.last_recv_seq,
            "expected_recv_seq": s.expected_recv_seq,
            "seq_gap": s.expected_recv_seq > s.last_recv_seq + 1,
            "error": s.error,
        }
        for s in server.session_manager.get_all_sessions()
    ]


def _algo_summary() -> list[dict]:
    return [
        {
            "algo_id": a.algo_id,
            "symbol": a.symbol,
            "algo_type": a.algo_type,
            "side": a.side,
            "total_qty": a.total_qty,
            "executed_qty": a.executed_qty,
            "execution_pct": a.execution_pct,
            "schedule_pct": a.schedule_pct,
            "schedule_deviation_pct": a.schedule_deviation_pct,
            "status": a.status,
            "flags": a.flags,
            "client_name": a.client_name,
        }
        for a in server.algo_engine.get_all()
    ]


def _order_summary() -> list[dict]:
    orders = []
    for o in server.oms.orders.values():
        if o.status in {"filled", "canceled", "rejected"}:
            continue
        orders.append({
            "order_id": o.order_id,
            "symbol": o.symbol,
            "side": o.side,
            "quantity": o.quantity,
            "order_type": o.order_type,
            "price": float(o.price) if o.price else None,
            "venue": o.venue,
            "status": o.status,
            "client_name": o.client_name,
            "flags": o.flags,
            "is_institutional": o.is_institutional,
            "notional": o.notional_value,
        })
    return orders


def _order_sla_breached(o) -> bool:
    """Return True if this order's SLA deadline has passed."""
    if not o.is_institutional or o.sla_minutes is None:
        return False
    if o.status not in {"new", "stuck", "partially_filled"}:
        return False
    try:
        baseline_str = max(o.created_at, o.updated_at)
        created = datetime.fromisoformat(baseline_str)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        deadline = created.timestamp() + o.sla_minutes * 60
        return datetime.now(timezone.utc).timestamp() > deadline
    except Exception:
        return False


def _detail_payload() -> dict:
    """Full expanded status for the dashboard — sessions/orders/algos as flat arrays."""
    sessions = server.session_manager.get_all_sessions()
    algos = server.algo_engine.get_all()
    active_algos = [a for a in algos if a.status in {"running", "paused", "stuck", "halted"}]
    open_orders = [o for o in server.oms.orders.values() if o.status not in {"filled", "canceled", "rejected"}]
    stuck_orders = [o for o in open_orders if o.status == "stuck"]
    return {
        "scenario": server.SCENARIO,
        "is_algo_scenario": _is_algo_scenario(server.SCENARIO),
        "available_scenarios": _available_scenarios(),
        "mode": _mode,
        "sessions": [
            {
                "venue": s.venue,
                "status": s.status,
                "latency_ms": s.latency_ms,
                "last_sent_seq": s.last_sent_seq,
                "last_recv_seq": s.last_recv_seq,
                "expected_recv_seq": s.expected_recv_seq,
                "seq_gap": s.expected_recv_seq > s.last_recv_seq + 1,
                "error": s.error,
            }
            for s in sessions
        ],
        "orders": [
            {
                "order_id": o.order_id,
                "symbol": o.symbol,
                "side": o.side,
                "quantity": o.quantity,
                "order_type": o.order_type,
                "price": float(o.price) if o.price else None,
                "venue": o.venue,
                "status": o.status,
                "client_name": o.client_name,
                "flags": o.flags,
                "is_institutional": o.is_institutional,
                "notional": o.notional_value,
                "sla_minutes": o.sla_minutes,
                "created_at": o.created_at,
                "updated_at": o.updated_at,
                "sla_breached": _order_sla_breached(o),
            }
            for o in open_orders
        ],
        "algos": [
            {
                "algo_id": a.algo_id,
                "symbol": a.symbol,
                "algo_type": a.algo_type,
                "side": a.side,
                "total_qty": a.total_qty,
                "executed_qty": a.executed_qty,
                "execution_pct": round(a.execution_pct, 1),
                "schedule_pct": round(a.schedule_pct, 1),
                "schedule_deviation_pct": round(a.schedule_deviation_pct, 1),
                "status": a.status,
                "flags": a.flags,
                "client_name": a.client_name,
                "child_count": len(a.child_order_ids),
            }
            for a in active_algos
        ],
        "orders_open": len(open_orders),
        "orders_stuck": len(stuck_orders),
        "algos_active": len(active_algos),
        "algos_total": len(algos),
    }


def _status_payload() -> dict:
    sessions = server.session_manager.get_all_sessions()
    algos = server.algo_engine.get_all()
    active_algos = [a for a in algos if a.status in {"running", "paused", "stuck", "halted"}]
    open_orders = [
        o for o in server.oms.orders.values()
        if o.status not in {"filled", "canceled", "rejected"}
    ]
    stuck_orders = [o for o in open_orders if o.status == "stuck"]
    return {
        "scenario": server.SCENARIO,
        "is_algo_scenario": _is_algo_scenario(server.SCENARIO),
        "available_scenarios": _scenario_metadata(),
        "mode": _mode,
        "sessions": {
            "total": len(sessions),
            "active": sum(1 for s in sessions if s.status == "active"),
            "degraded": sum(1 for s in sessions if s.status == "degraded"),
            "down": sum(1 for s in sessions if s.status == "down"),
            "detail": _session_summary(),
        },
        "orders": {
            "open": len(open_orders),
            "stuck": len(stuck_orders),
        },
        "algos": {
            "active": len(active_algos),
            "total": len(algos),
        },
    }


def _fix_wire_payload(limit: int = 200) -> list[dict[str, Any]]:
    # Aggregate FIX wire messages from all orders + session-level events.
    wire_events = []

    for o in server.oms.orders.values():
        for msg in o.fix_messages:
            parts = {}
            for seg in msg.split("|"):
                if "=" in seg:
                    k, v = seg.split("=", 1)
                    parts[k] = v
            msg_type = parts.get("35", "?")
            msg_type_name = {
                "A": "Logon", "0": "Heartbeat", "D": "NewOrderSingle",
                "8": "ExecutionReport", "F": "OrderCancel", "G": "CancelReplace",
                "2": "ResendRequest", "5": "Logout", "4": "SeqReset",
                "1": "TestRequest", "3": "Reject", "9": "OrderCancelAck",
            }.get(msg_type, f"Unknown({msg_type})")
            symbol = parts.get("55", "")
            side = parts.get("54", "")
            wire_events.append({
                "ts": parts.get("52", ""),
                "type": msg_type_name,
                "msg_type": msg_type,
                "venue": getattr(o, "venue", ""),
                "symbol": symbol,
                "side": "Buy" if side == "1" else "Sell" if side == "2" else "",
                "qty": parts.get("38", ""),
                "cl_ord_id": parts.get("11", ""),
                "raw": msg,
            })

    for s in server.session_manager.get_all_sessions():
        wire_events.append({
            "ts": s.last_heartbeat or "",
            "type": "SessionState",
            "msg_type": "HB",
            "venue": s.venue,
            "symbol": "",
            "side": "",
            "qty": "",
            "cl_ord_id": "",
            "raw": f"{s.venue} status={s.status} latency={s.latency_ms}ms seq={s.last_sent_seq}/{s.last_recv_seq}",
        })

    wire_events.sort(key=lambda e: e["ts"], reverse=True)
    return wire_events[:limit]


def _state_event_payload(reason: str) -> dict[str, Any]:
    with _events_lock:
        events = list(_events)
    return {
        "type": "state",
        "reason": reason,
        "ts": datetime.now(timezone.utc).isoformat(),
        "status": _status_payload(),
        "orders": _order_summary(),
        "events": events,
        "wire": _fix_wire_payload(),
    }


def _publish_state_event(reason: str) -> None:
    _broadcast_event(_state_event_payload(reason))


def _match_runbook_step(preferred_tools: list[str], target: str = "") -> dict[str, Any] | None:
    ctx = _scenario_context(server.SCENARIO)
    steps = (ctx or {}).get("runbook", {}).get("steps", [])
    target_upper = target.upper()
    if target_upper:
        for step in steps:
            if step.get("tool") in preferred_tools and target_upper in json.dumps(step).upper():
                return step
    for tool in preferred_tools:
        for step in steps:
            if step.get("tool") == tool:
                return step
    return steps[0] if steps else None


def _triage_recommendation(
    target: str,
    down_venues: list[str],
    degraded_venues: list[str],
    seq_gap_venues: list[str],
    stuck_count: int,
) -> tuple[list[str], str, dict[str, Any] | None]:
    target_upper = target.upper()
    affected = target_upper or (down_venues[0] if down_venues else degraded_venues[0] if degraded_venues else "")
    preferred_tools = ["check_fix_sessions", "query_orders"]
    action = "Run check_fix_sessions, then query_orders to confirm blast radius before recovery."

    if affected in seq_gap_venues:
        preferred_tools = ["dump_session_state", "fix_session_issue", "reset_sequence", "query_orders"]
        action = (
            f"Confirm the {affected} sequence gap, then use fix_session_issue with "
            "action=resend_request or reset_sequence before releasing orders."
        )
    elif affected in down_venues:
        preferred_tools = ["check_fix_sessions", "fix_session_issue", "query_orders", "release_stuck_orders"]
        action = (
            f"Send a heartbeat/test request to {affected}; if it stays down, reconnect with "
            "fix_session_issue action=reconnect, then re-check stuck orders."
        )
    elif affected in degraded_venues:
        preferred_tools = ["session_heartbeat", "dump_session_state", "query_orders"]
        action = f"Probe {affected} heartbeat latency, dump session state, and hold releases until session health is green."
    elif stuck_count:
        preferred_tools = ["query_orders", "validate_orders", "release_stuck_orders"]
        action = "Query stuck orders, confirm the blocker flag, and only release after the blocker clears."

    return preferred_tools, action, _match_runbook_step(preferred_tools, affected)


def _build_triage_payload(inject_args: dict[str, Any] | None = None, tool_output: str = "") -> dict[str, Any]:
    inject_args = inject_args or {}
    target = str(inject_args.get("target") or "").upper()
    sessions = _session_summary()
    open_orders = _order_summary()
    stuck_orders = [o for o in open_orders if o.get("status") == "stuck"]
    target_stuck = [o for o in stuck_orders if target and str(o.get("venue", "")).upper() == target]
    down_venues = [s["venue"] for s in sessions if s.get("status") == "down"]
    degraded_venues = [s["venue"] for s in sessions if s.get("status") == "degraded"]
    seq_gap_venues = [s["venue"] for s in sessions if s.get("seq_gap")]
    preferred_tools, recommended_action, matched = _triage_recommendation(
        target=target,
        down_venues=down_venues,
        degraded_venues=degraded_venues,
        seq_gap_venues=seq_gap_venues,
        stuck_count=len(stuck_orders),
    )

    affected = target or (down_venues[0] if down_venues else degraded_venues[0] if degraded_venues else "")
    event_type = inject_args.get("event_type", "state_change")
    if affected and affected in down_venues:
        first_sentence = f"{affected} set to DOWN."
    elif affected and affected in degraded_venues:
        first_sentence = f"{affected} is DEGRADED."
    elif affected and affected in seq_gap_venues:
        first_sentence = f"{affected} has a sequence gap."
    else:
        first_sentence = f"{event_type} recorded."

    stuck_phrase = f"{len(target_stuck) if target_stuck else len(stuck_orders)} orders stuck."
    if matched:
        runbook_phrase = (
            f"Runbook step {matched.get('step')}: {matched.get('title')} "
            f"uses {matched.get('tool')}."
        )
    else:
        runbook_phrase = f"Recommended tools: {', '.join(preferred_tools[:2])}."

    narrative = f"{first_sentence} {stuck_phrase} {runbook_phrase} Recommended action: {recommended_action}"
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "scenario": server.SCENARIO,
        "event_type": event_type,
        "target": target,
        "session_status": sessions,
        "down_venues": down_venues,
        "degraded_venues": degraded_venues,
        "seq_gap_venues": seq_gap_venues,
        "stuck_order_count": len(stuck_orders),
        "target_stuck_order_count": len(target_stuck),
        "matched_runbook_step": matched,
        "recommended_action": recommended_action,
        "narrative": narrative,
        "tool_output": tool_output,
    }


def _format_triage_for_tool_response(triage: dict[str, Any]) -> str:
    matched = triage.get("matched_runbook_step") or {}
    lines = [
        "AUTO-TRIAGE",
        f"  Summary: {triage['narrative']}",
        f"  Stuck orders: {triage['stuck_order_count']}",
        f"  Down venues: {', '.join(triage['down_venues']) or 'none'}",
        f"  Degraded venues: {', '.join(triage['degraded_venues']) or 'none'}",
    ]
    if matched:
        lines.append(
            f"  Matched runbook: step {matched.get('step')} - "
            f"{matched.get('title')} ({matched.get('tool')})"
        )
    lines.append(f"  Recommended action: {triage['recommended_action']}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start every local/demo server session with an empty operator trace."""
    _trace_buffer.clear()
    _clear_events()
    yield


app = FastAPI(title="fix-mcp-api", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/")
async def root():
    html_path = Path(__file__).parent.parent / "ui" / "index.html"
    if html_path.exists():
        return HTMLResponse(content=html_path.read_text(encoding="utf-8"))
    return JSONResponse({
        "api": "fix-mcp",
        "version": "0.1.0",
        "endpoints": [
            "/health", "/api/status", "/api/detail", "/api/sessions",
            "/api/orders", "/api/algos", "/api/scenarios", "/api/events",
            "/api/mode", "/api/simulation", "/api/tool (POST)",
            "/api/reset (POST)", "/api/mode (POST)", "/api/simulation (POST)"
        ]
    })


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "scenario": server.SCENARIO})


@app.get("/api/status")
async def api_status():
    return JSONResponse(_status_payload())


@app.get("/api/sessions")
async def api_sessions():
    return JSONResponse(_session_summary())


@app.get("/api/orders")
async def api_orders():
    return JSONResponse(_order_summary())


@app.get("/api/algos")
async def api_algos():
    return JSONResponse(_algo_summary())


@app.get("/api/scenarios")
async def api_scenarios():
    return JSONResponse(_scenario_metadata())


@app.get("/api/scenario/{name}")
async def api_scenario(name: str):
    ctx = _scenario_context(name)
    if ctx is None:
        return JSONResponse({"error": f"Scenario '{name}' not found"}, status_code=404)
    return JSONResponse(ctx)


@app.get("/api/detail")
async def api_detail():
    return JSONResponse(_detail_payload())


@app.get("/api/mode")
async def api_mode_get():
    return JSONResponse({"mode": _mode})


@app.get("/api/events")
async def api_events():
    with _events_lock:
        return JSONResponse(list(_events))


@app.get("/api/events/stream")
async def api_events_stream():
    async def event_generator():
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        with _event_stream_lock:
            _event_stream_clients.add(queue)
        try:
            yield "retry: 1000\n\n"
            yield _sse_payload({
                **_state_event_payload("initial"),
                "type": "initial",
            })
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    payload = {
                        "type": "heartbeat",
                        "ts": datetime.now(timezone.utc).isoformat(),
                    }
                yield _sse_payload(payload)
        finally:
            with _event_stream_lock:
                _event_stream_clients.discard(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/trace")
async def api_trace(
    limit: int = Query(default=200),
    tool: str | None = Query(default=None),
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
):
    entries = _trace_buffer.get_entries(
        limit=limit,
        tool_filter=tool,
        status_filter=status,
        source_filter=source,
    )
    return JSONResponse(entries)


@app.get("/api/trace/stats")
async def api_trace_stats():
    return JSONResponse(_trace_buffer.stats())


@app.post("/api/trace/clear")
async def api_trace_clear():
    _trace_buffer.clear()
    _clear_events()
    return JSONResponse({"ok": True})


@app.get("/api/runbook")
async def api_runbook(tool: str | None = Query(default=None)):
    if tool:
        matching = {k: v for k, v in MANUAL_RUNBOOK.items() if tool.lower() in k.lower()}
    else:
        matching = MANUAL_RUNBOOK
    return JSONResponse(matching)


@app.get("/api/runbook/list")
async def api_runbook_list():
    return JSONResponse({k: {"title": v["title"], "description": v["description"]} for k, v in MANUAL_RUNBOOK.items()})


@app.post("/api/triage")
async def api_triage(request: Request):
    payload = await request.json()
    tool_output = str(payload.get("tool_output") or payload.get("output") or "")
    inject_args = payload.get("arguments") or payload.get("inject_args") or payload
    triage = _build_triage_payload(inject_args if isinstance(inject_args, dict) else {}, tool_output)
    _publish_event("auto_triage", {"after_tool": payload.get("after_tool", "manual")}, triage["narrative"], True)
    _broadcast_event({"type": "triage", "triage": triage})
    return JSONResponse({"ok": True, "triage": triage})


@app.get("/api/fix-wire")
async def api_fix_wire():
    return JSONResponse(_fix_wire_payload())


@app.get("/api/mcp/schema")
async def api_mcp_schema():
    tools = await server.list_tools()
    resources = await server.list_resources()
    prompts = await server.list_prompts()
    return JSONResponse({
        "server": {
            "name": "fix-trading-ops",
            "version": "0.1.0",
            "protocolVersion": "2024-11-05",
        },
        "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
        "tools": [
            {
                "name": t.name,
                "description": t.description or "",
                "inputSchema": t.inputSchema if isinstance(t.inputSchema, dict) else {},
            }
            for t in tools
        ],
        "resources": [
            {
                "uri": str(r.uri),
                "name": r.name,
                "description": r.description or "",
                "mimeType": r.mimeType or "",
            }
            for r in resources
        ],
        "prompts": [
            {"name": p.name, "description": p.description or ""}
            for p in prompts
        ],
    })


@app.get("/metrics")
async def metrics():
    """Serve Prometheus /metrics endpoint in text format.

    Before rendering, refresh live gauges (active orders, venue status,
    session counts, scenario duration) so the scrape always reflects
    the current process state.
    """
    try:
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, REGISTRY
    except ImportError:
        return PlainTextResponse("# prometheus_client not installed\n")

    # ── Refresh live gauges ──────────────────────────────────────────
    open_orders = [
        o for o in server.oms.orders.values()
        if o.status not in {"filled", "canceled", "rejected"}
    ]
    FIX_METRICS.active_orders.set(len(open_orders))

    sessions = server.session_manager.get_all_sessions()
    status_counts: dict[str, int] = {}
    for s in sessions:
        status_counts[s.status] = status_counts.get(s.status, 0) + 1
        FIX_METRICS.venue_status.info({
            "venue": s.venue,
            "status": s.status,
            "latency_ms": str(s.latency_ms),
        })
    for status, count in status_counts.items():
        FIX_METRICS.sessions_active.labels(status=status).set(count)

    # Scenario duration — time since oldest active order was created, or 0
    if server.oms.orders:
        earliest = 0.0
        now_ts = datetime.now(timezone.utc).timestamp()
        for o in server.oms.orders.values():
            try:
                created = datetime.fromisoformat(o.created_at).timestamp()
                age = now_ts - created
                if age > earliest:
                    earliest = age
            except Exception:
                pass
        FIX_METRICS.scenario_duration.set(earliest)

    body = generate_latest(REGISTRY)
    return PlainTextResponse(content=body, media_type=CONTENT_TYPE_LATEST)


@app.post("/api/tool")
async def api_tool_post(request: Request):
    payload = await request.json()
    tool = payload.get("tool", "")
    arguments = payload.get("arguments", {})
    trace_enabled = payload.get("trace", True) is not False
    # Tag this call as "dashboard" so the Activity tab can distinguish it
    # from Claude's MCP HTTP calls (which default to "claude").
    token = server._call_source.set("dashboard" if trace_enabled else "dashboard_poll")
    try:
        result = await server.call_tool(tool, arguments)
        result_text = result[0].text
        triage = None
        output_text = result_text
        if tool == "inject_event":
            triage = _build_triage_payload(arguments, result_text)
            triage_text = _format_triage_for_tool_response(triage)
            output_text = f"{result_text}\n\n{triage_text}"
            _publish_event("auto_triage", {"after_tool": tool, **arguments}, triage["narrative"], True)
            _broadcast_event({"type": "triage", "triage": triage})
        _publish_state_event(f"tool:{tool}")
        # _publish_event is called via _on_tool_call listener in server.call_tool
        payload = {"output": output_text, "ok": True}
        if triage:
            payload["triage"] = triage
        return JSONResponse(payload)
    except Exception as exc:
        # Fallback publish for catastrophic errors that bypass the listener
        _publish_event(tool, arguments, str(exc), False, "dashboard")
        _publish_state_event(f"tool_error:{tool}")
        return JSONResponse({"output": str(exc), "ok": False}, status_code=400)
    finally:
        server._call_source.reset(token)


@app.post("/api/mode")
async def api_mode_post(request: Request):
    global _mode
    payload = await request.json()
    new_mode = payload.get("mode", "human")
    if new_mode in ("human", "agent", "mixed"):
        _mode = new_mode
        _broadcast_event({"type": "mode", "mode": _mode, "ts": datetime.now(timezone.utc).isoformat()})
    return JSONResponse({"mode": _mode, "ok": True})


@app.post("/api/reset")
async def api_reset(request: Request):
    payload = await request.json()
    scenario = payload.get("scenario") or None
    active = server.reset_runtime(scenario)
    _clear_events()
    _publish_state_event("reset")
    return JSONResponse({"output": f"Scenario loaded: {active}", "scenario": active, "ok": True})


@app.post("/api/scenario")
async def api_scenario_post(request: Request):
    payload = await request.json()
    name = payload.get("name", "").strip()
    if not name:
        return JSONResponse({"error": "Scenario 'name' is required"}, status_code=400)
    # Sanitize name for filename
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name).lower()
    config_dir = Path(server.engine.config_dir) / "scenarios"
    config_dir.mkdir(parents=True, exist_ok=True)
    filepath = config_dir / f"{safe_name}.json"
    with open(filepath, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return JSONResponse({"output": f"Scenario saved: {safe_name}", "name": safe_name, "ok": True})


@app.post("/api/chat")
async def api_chat(request: Request):
    """Proxy chat completions to OpenRouter so the API key stays server-side."""
    payload = await request.json()
    messages = payload.get("messages", [])
    model = payload.get("model", "openai/gpt-5.4")
    max_tokens = payload.get("max_tokens", 2048)
    tools = payload.get("tools")
    tool_choice = payload.get("tool_choice")
    temperature = payload.get("temperature")
    api_key = os.environ.get("OPENROUTER_API_KEY", "") or _read_local_env_key("OPENROUTER_API_KEY")
    if not api_key:
        return JSONResponse({"error": "OPENROUTER_API_KEY not configured"}, status_code=500)

    try:
        import aiohttp
        openrouter_payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if tools is not None:
            openrouter_payload["tools"] = tools
        if tool_choice is not None:
            openrouter_payload["tool_choice"] = tool_choice
        if temperature is not None:
            openrouter_payload["temperature"] = temperature
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://fix-mcp.local",
                    "X-Title": "FIX MCP Console",
                },
                json=openrouter_payload,
            ) as resp:
                data = await resp.json()
                return JSONResponse(data)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="FIX MCP REST API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run("fix_mcp.api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()

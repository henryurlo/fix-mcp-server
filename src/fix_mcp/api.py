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
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse

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


def _read_local_env_key(name: str) -> str:
    """Read an ignored local env file without requiring a server restart."""
    for filename in (".env.local", ".env"):
        path = Path.cwd() / filename
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                clean = line.strip()
                if not clean or clean.startswith("#") or "=" not in clean:
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
        "summary": (result or "")[:200],
    }
    with _events_lock:
        _events.appendleft(event)
    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        try:
            import redis as _redis  # optional dependency
            r = _redis.from_url(redis_url, socket_timeout=1)
            r.publish("fix:events", json.dumps(event))
        except Exception:
            pass


def _on_tool_call(name: str, args: dict, result: str, ok: bool, source: str) -> None:
    """Listener registered with server._tool_listeners — receives all tool calls."""
    _publish_event(name, args, result, ok, source)


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


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="fix-mcp-api", version="0.1.0")

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
    sessions = server.session_manager.get_all_sessions()
    algos = server.algo_engine.get_all()
    active_algos = [a for a in algos if a.status in {"running", "paused", "stuck", "halted"}]
    open_orders = [
        o for o in server.oms.orders.values()
        if o.status not in {"filled", "canceled", "rejected"}
    ]
    stuck_orders = [o for o in open_orders if o.status == "stuck"]
    return JSONResponse({
        "scenario": server.SCENARIO,
        "is_algo_scenario": _is_algo_scenario(server.SCENARIO),
        "available_scenarios": _scenario_metadata(),
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
    })


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


@app.get("/api/fix-wire")
async def api_fix_wire():
    # Aggregate FIX wire messages from all orders + session-level events
    wire_events = []
    
    # FIX messages from orders
    for o in server.oms.orders.values():
        for i, msg in enumerate(o.fix_messages):
            # Parse key fields from the raw FIX message
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
            qty = parts.get("38", "")
            venue = o.venue if hasattr(o, "venue") else ""
            wire_events.append({
                "ts": parts.get("52", ""),
                "type": msg_type_name,
                "msg_type": msg_type,
                "venue": venue,
                "symbol": symbol,
                "side": "Buy" if side == "1" else "Sell" if side == "2" else "",
                "qty": qty,
                "cl_ord_id": parts.get("11", ""),
                "raw": msg,
            })
    
    # Session-level heartbeat events
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
    
    # Sort by timestamp descending, keep most recent
    wire_events.sort(key=lambda e: e["ts"], reverse=True)
    return JSONResponse(wire_events[:200])


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
    # Tag this call as "dashboard" so the Activity tab can distinguish it
    # from Claude's MCP HTTP calls (which default to "claude").
    token = server._call_source.set("dashboard")
    try:
        result = await server.call_tool(tool, arguments)
        result_text = result[0].text
        # _publish_event is called via _on_tool_call listener in server.call_tool
        return JSONResponse({"output": result_text, "ok": True})
    except Exception as exc:
        # Fallback publish for catastrophic errors that bypass the listener
        _publish_event(tool, arguments, str(exc), False, "dashboard")
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
    return JSONResponse({"mode": _mode, "ok": True})


@app.post("/api/reset")
async def api_reset(request: Request):
    payload = await request.json()
    scenario = payload.get("scenario") or None
    active = server.reset_runtime(scenario)
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
    api_key = os.environ.get("OPENROUTER_API_KEY", "") or _read_local_env_key("OPENROUTER_API_KEY")
    if not api_key:
        return JSONResponse({"error": "OPENROUTER_API_KEY not configured"}, status_code=500)

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://fix-mcp.local",
                    "X-Title": "FIX MCP Console",
                },
                json={"model": model, "messages": messages, "max_tokens": 2048},
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

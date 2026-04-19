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
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from fix_mcp import server
from fix_mcp.prompts.trading_ops import SCENARIO_PROMPTS

# ---------------------------------------------------------------------------
# Shared state: agent mode + event log
# ---------------------------------------------------------------------------

_mode: str = "human"          # "human" | "agent" | "mixed"
_events: deque = deque(maxlen=100)
_events_lock = threading.Lock()



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
# Request handler
# ---------------------------------------------------------------------------

class APIHandler(BaseHTTPRequestHandler):

    def _send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/" or self.path == "":
            # Serve the AI Operations Theater frontend
            html_path = Path(__file__).parent.parent / 'ui' / 'index.html'
            if html_path.exists():
                body = html_path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            self._send_json({"api": "fix-mcp", "version": "0.1.0", "endpoints": ["/health", "/api/status", "/api/detail", "/api/sessions", "/api/orders", "/api/algos", "/api/scenarios", "/api/events", "/api/mode", "/api/simulation", "/api/tool (POST)", "/api/reset (POST)", "/api/mode (POST)", "/api/simulation (POST)"]})
            return

        if self.path == "/health":
            self._send_json({"status": "ok", "scenario": server.SCENARIO})
            return

        if self.path == "/api/status":
            sessions = server.session_manager.get_all_sessions()
            algos = server.algo_engine.get_all()
            active_algos = [a for a in algos if a.status in {"running", "paused", "stuck", "halted"}]
            open_orders = [
                o for o in server.oms.orders.values()
                if o.status not in {"filled", "canceled", "rejected"}
            ]
            stuck_orders = [o for o in open_orders if o.status == "stuck"]
            self._send_json({
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
            return

        if self.path == "/api/sessions":
            self._send_json(_session_summary())
            return

        if self.path == "/api/orders":
            self._send_json(_order_summary())
            return

        if self.path == "/api/algos":
            self._send_json(_algo_summary())
            return

        if self.path == "/api/scenarios":
            self._send_json(_scenario_metadata())
            return

        if self.path.startswith("/api/scenario/"):
            name = self.path[len("/api/scenario/"):]
            ctx = _scenario_context(name)
            if ctx is None:
                self._send_json({"error": f"Scenario '{name}' not found"}, HTTPStatus.NOT_FOUND)
            else:
                self._send_json(ctx)
            return

        if self.path == "/api/detail":
            self._send_json(_detail_payload())
            return

        if self.path == "/api/mode":
            self._send_json({"mode": _mode})
            return

        if self.path.startswith("/api/events"):
            with _events_lock:
                self._send_json(list(_events))
            return

        if self.path == "/api/fix-wire":
            # Aggregate FIX wire messages from all orders + session-level events
            wire_events = []
            
            # FIX messages from orders
            for o in server.oms.orders.values():
                for i, msg in enumerate(o.fix_messages):
                    # Parse key fields from the raw FIX message
                    parts = {}
                    for seg in msg.split('|'):
                        if '=' in seg:
                            k, v = seg.split('=', 1)
                            parts[k] = v
                    msg_type = parts.get('35', '?')
                    msg_type_name = {
                        'A': 'Logon', '0': 'Heartbeat', 'D': 'NewOrderSingle',
                        '8': 'ExecutionReport', 'F': 'OrderCancel', 'G': 'CancelReplace',
                        '2': 'ResendRequest', '5': 'Logout', '4': 'SeqReset',
                        '1': 'TestRequest', '3': 'Reject', '9': 'OrderCancelAck',
                    }.get(msg_type, f'Unknown({msg_type})')
                    symbol = parts.get('55', '')
                    side = parts.get('54', '')
                    qty = parts.get('38', '')
                    venue = o.venue if hasattr(o, 'venue') else ''
                    wire_events.append({
                        'ts': parts.get('52', ''),
                        'type': msg_type_name,
                        'msg_type': msg_type,
                        'venue': venue,
                        'symbol': symbol,
                        'side': 'Buy' if side == '1' else 'Sell' if side == '2' else '',
                        'qty': qty,
                        'cl_ord_id': parts.get('11', ''),
                        'raw': msg,
                    })
            
            # Session-level heartbeat events
            for s in server.session_manager.get_all_sessions():
                wire_events.append({
                    'ts': s.last_heartbeat or '',
                    'type': 'SessionState',
                    'msg_type': 'HB',
                    'venue': s.venue,
                    'symbol': '',
                    'side': '',
                    'qty': '',
                    'cl_ord_id': '',
                    'raw': f'{s.venue} status={s.status} latency={s.latency_ms}ms seq={s.last_sent_seq}/{s.last_recv_seq}',
                })
            
            # Sort by timestamp descending, keep most recent
            wire_events.sort(key=lambda e: e['ts'], reverse=True)
            self._send_json(wire_events[:200])
            return

        if self.path == "/api/mcp/schema":
            tools = asyncio.run(server.list_tools())
            resources = asyncio.run(server.list_resources())
            prompts = asyncio.run(server.list_prompts())
            self._send_json({
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
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/tool":
            payload = self._read_json()
            tool = payload.get("tool", "")
            arguments = payload.get("arguments", {})
            # Tag this call as "dashboard" so the Activity tab can distinguish it
            # from Claude's MCP HTTP calls (which default to "claude").
            token = server._call_source.set("dashboard")
            try:
                result = asyncio.run(server.call_tool(tool, arguments))
                result_text = result[0].text
                # _publish_event is called via _on_tool_call listener in server.call_tool
                self._send_json({"output": result_text, "ok": True})
            except Exception as exc:
                # Fallback publish for catastrophic errors that bypass the listener
                _publish_event(tool, arguments, str(exc), False, "dashboard")
                self._send_json({"output": str(exc), "ok": False}, HTTPStatus.BAD_REQUEST)
            finally:
                server._call_source.reset(token)
            return

        if self.path == "/api/mode":
            global _mode
            payload = self._read_json()
            new_mode = payload.get("mode", "human")
            if new_mode in ("human", "agent", "mixed"):
                _mode = new_mode
            self._send_json({"mode": _mode, "ok": True})
            return

        if self.path == "/api/reset":
            payload = self._read_json()
            scenario = payload.get("scenario") or None
            active = server.reset_runtime(scenario)
            self._send_json({"output": f"Scenario loaded: {active}", "scenario": active, "ok": True})
            return

        if self.path == "/api/scenario":
            payload = self._read_json()
            name = payload.get("name", "").strip()
            if not name:
                self._send_json({"error": "Scenario 'name' is required"}, HTTPStatus.BAD_REQUEST)
                return
            # Sanitize name for filename
            safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name).lower()
            config_dir = Path(server.engine.config_dir) / "scenarios"
            config_dir.mkdir(parents=True, exist_ok=True)
            filepath = config_dir / f"{safe_name}.json"
            with open(filepath, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            self._send_json({"output": f"Scenario saved: {safe_name}", "name": safe_name, "ok": True})
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: object) -> None:
        return


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="FIX MCP REST API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), APIHandler)
    print(f"FIX MCP API running at http://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

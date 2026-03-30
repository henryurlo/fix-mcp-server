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


def _publish_event(tool: str, args: dict, result: str, ok: bool) -> None:
    """Append event to in-memory log and optionally publish to Redis."""
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": tool,
        "ok": ok,
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
            self._send_json({"api": "fix-mcp", "version": "0.1.0", "endpoints": ["/health", "/api/status", "/api/detail", "/api/sessions", "/api/orders", "/api/algos", "/api/scenarios", "/api/events", "/api/mode", "/api/tool (POST)", "/api/reset (POST)", "/api/mode (POST)"]})
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
                "available_scenarios": _available_scenarios(),
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
            names = _available_scenarios()
            self._send_json([
                {
                    "name": n,
                    "context": SCENARIO_PROMPTS.get(n, ""),
                    "is_algo": _is_algo_scenario(n),
                }
                for n in names
            ])
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

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/tool":
            payload = self._read_json()
            tool = payload.get("tool", "")
            arguments = payload.get("arguments", {})
            try:
                result = asyncio.run(server.call_tool(tool, arguments))
                result_text = result[0].text
                _publish_event(tool, arguments, result_text, True)
                self._send_json({"output": result_text, "ok": True})
            except Exception as exc:
                _publish_event(tool, arguments, str(exc), False)
                self._send_json({"output": str(exc), "ok": False}, HTTPStatus.BAD_REQUEST)
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

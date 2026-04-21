"""End-to-end smoke test for the midday_chaos_1205 demo runbook.

Drives each of the 9 runbook steps through ``server.call_tool`` and verifies
the MCP-level output matches demo-time expectations. This is the contract the
live demo depends on: if the tool shapes or status transitions regress, this
test fails before the operator sees it on stage.
"""
import asyncio
import importlib
import sys
from datetime import datetime, timezone, timedelta


def _load_server():
    for name in list(sys.modules):
        if name == "fix_mcp.server" or name.startswith("fix_mcp.server."):
            sys.modules.pop(name)
    return importlib.import_module("fix_mcp.server")


def _call(server, tool, args):
    return asyncio.run(server.call_tool(tool, args))[0].text


def _freeze_md_stale(server, symbol: str, age_ms: int) -> None:
    book = server.market_data_hub.get_quote(symbol)
    book.last_updated = (
        datetime.now(timezone.utc) - timedelta(milliseconds=age_ms)
    ).isoformat()


def test_midday_chaos_full_runbook_e2e() -> None:
    server = _load_server()

    load_out = _call(
        server,
        "list_scenarios",
        {"action": "load", "scenario_name": "midday_chaos_1205"},
    )
    assert "midday_chaos_1205" in load_out

    # Force AAPL MD stale so stale_md blocker is real, not timing-dependent.
    _freeze_md_stale(server, "AAPL", 700)

    # Runbook step 2 — algo status shows the parent algo + behind-schedule flag
    algo_status = _call(server, "check_algo_status", {"algo_id": "ALGO-PARENT-001"})
    assert "ALGO-PARENT-001" in algo_status
    assert "AAPL" in algo_status

    # Runbook step 3 — MD staleness on AAPL is stale (well over 100ms gate)
    md_stale = _call(server, "check_market_data_staleness", {"symbol": "AAPL"})
    assert "AAPL" in md_stale
    assert "STALE" in md_stale

    # Runbook step 4 — NYSE session looks active (misleading)
    sessions = _call(server, "check_fix_sessions", {"venue": "NYSE"})
    assert "NYSE" in sessions
    assert "active" in sessions.lower()

    # Runbook step 5 — pending-acks shows ORD-NYSE-7731 with duplicate risk
    packs = _call(server, "check_pending_acks", {"venue": "NYSE"})
    assert "ORD-NYSE-7731" in packs
    assert "[DUP-RISK]" in packs
    assert "5000" in packs  # ack_delay_ms

    # Runbook step 6 — clear the BATS delay
    cleared = _call(server, "clear_market_data_delay", {"venue": "BATS"})
    assert "BATS" in cleared
    assert "600" in cleared
    assert "CLEARED" in cleared

    # After clearing the injection, refresh the book so MD is fresh under 100ms gate
    server.market_data_hub.get_quote("AAPL").last_updated = datetime.now(
        timezone.utc
    ).isoformat()

    # Runbook step 7 — MD now fresh
    md_fresh = _call(server, "check_market_data_staleness", {"symbol": "AAPL"})
    assert "AAPL" in md_fresh
    assert "[OK]" in md_fresh

    # Runbook step 8 — release stuck children (reason_filter=stale_md)
    released = _call(
        server, "release_stuck_orders", {"reason_filter": "stale_md"}
    )
    assert "ORD-1005" in released
    assert "ORD-1006" in released
    # And neither child should still be stuck
    assert server.oms.get_order("ORD-1005").status == "new"
    assert server.oms.get_order("ORD-1006").status == "new"
    assert server.oms.get_order("ORD-1005").stuck_reason is None

    # Success criteria: NYSE pending-ack was NEVER canceled — still pending_ack
    nyse = server.oms.get_order("ORD-NYSE-7731")
    assert nyse is not None
    assert nyse.status == "pending_ack"

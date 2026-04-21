"""Tests for ScenarioEngine extensions: relative timestamp resolution,
new field threading, and injection application."""

import re
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

import pytest

from fix_mcp.engine.scenarios import ScenarioEngine, resolve_relative_timestamp
from fix_mcp.engine.oms import OMS
from fix_mcp.engine.algos import AlgoEngine
from fix_mcp.engine.fix_sessions import FIXSessionManager
from fix_mcp.engine.reference import ReferenceDataStore


# ---------------------------------------------------------------------------
# 1. resolve_relative_timestamp — "-90s" → ISO string
# ---------------------------------------------------------------------------

def test_resolve_relative_timestamp_seconds():
    result = resolve_relative_timestamp("-90s")
    assert result != "-90s"
    # Should be a valid ISO string parseable by fromisoformat
    parsed = datetime.fromisoformat(result)
    now = datetime.now(timezone.utc)
    # Should be roughly 90 seconds in the past (allow ±5s clock skew)
    delta = now - parsed
    assert 85 <= delta.total_seconds() <= 95


def test_resolve_relative_timestamp_minutes():
    result = resolve_relative_timestamp("-5m")
    assert result != "-5m"
    parsed = datetime.fromisoformat(result)
    now = datetime.now(timezone.utc)
    delta = now - parsed
    assert 295 <= delta.total_seconds() <= 305


def test_resolve_relative_timestamp_hours():
    result = resolve_relative_timestamp("-2h")
    assert result != "-2h"
    parsed = datetime.fromisoformat(result)
    now = datetime.now(timezone.utc)
    delta = now - parsed
    assert 7195 <= delta.total_seconds() <= 7205


# ---------------------------------------------------------------------------
# 2. Absolute ISO string passed through unchanged
# ---------------------------------------------------------------------------

def test_resolve_relative_timestamp_passthrough_iso():
    iso = "2026-04-20T10:00:00+00:00"
    assert resolve_relative_timestamp(iso) == iso


# ---------------------------------------------------------------------------
# 3. None passed through unchanged
# ---------------------------------------------------------------------------

def test_resolve_relative_timestamp_passthrough_none():
    assert resolve_relative_timestamp(None) is None


# ---------------------------------------------------------------------------
# 4. _load_orders threads pending_since (relative) and stuck_reason / flags
# ---------------------------------------------------------------------------

def test_load_orders_threads_pending_since_and_stuck_reason():
    engine = ScenarioEngine.__new__(ScenarioEngine)
    oms = OMS()
    ref_store = ReferenceDataStore()

    orders = [
        {
            "order_id": "ORD-001",
            "cl_ord_id": "CLI-001",
            "symbol": "AAPL",
            "cusip": "037833100",
            "side": "buy",
            "quantity": 100,
            "order_type": "limit",
            "venue": "NYSE",
            "client_name": "ACME",
            "created_at": "2026-04-20T09:00:00+00:00",
            "updated_at": "2026-04-20T09:00:00+00:00",
            "price": 150.0,
            "status": "pending_new",
            "pending_since": "-90s",
            "stuck_reason": "ack_timeout",
            "flags": ["stuck"],
        }
    ]

    engine._load_orders(oms, orders, ref_store)

    order = oms.get_order("ORD-001")
    assert order is not None
    # pending_since should have been resolved (not the literal string)
    assert order.pending_since != "-90s"
    parsed = datetime.fromisoformat(order.pending_since)
    delta = datetime.now(timezone.utc) - parsed
    assert 85 <= delta.total_seconds() <= 95
    assert order.stuck_reason == "ack_timeout"
    assert "stuck" in order.flags


# ---------------------------------------------------------------------------
# 5. _load_sessions threads ack_delay_ms
# ---------------------------------------------------------------------------

def test_load_sessions_threads_ack_delay_ms():
    engine = ScenarioEngine.__new__(ScenarioEngine)
    session_mgr = FIXSessionManager()

    sessions = [
        {
            "venue": "NYSE",
            "session_id": "SES-001",
            "sender_comp_id": "FIRM",
            "target_comp_id": "NYSE",
            "ack_delay_ms": 250,
        }
    ]

    engine._load_sessions(session_mgr, sessions)

    session = session_mgr.get_session("NYSE")
    assert session is not None
    assert session.ack_delay_ms == 250


# ---------------------------------------------------------------------------
# 6. _load_algo_orders threads md_freshness_gate_ms
# ---------------------------------------------------------------------------

def test_load_algo_orders_threads_md_freshness_gate_ms():
    engine = ScenarioEngine.__new__(ScenarioEngine)
    algo_engine = AlgoEngine()
    ref_store = ReferenceDataStore()

    algo_orders = [
        {
            "algo_id": "ALGO-001",
            "client_name": "ACME",
            "symbol": "MSFT",
            "cusip": "594918104",
            "side": "buy",
            "total_qty": 1000,
            "algo_type": "TWAP",
            "start_time": "2026-04-20T09:30:00+00:00",
            "venue": "NASDAQ",
            "status": "running",
            "md_freshness_gate_ms": 500,
        }
    ]

    engine._load_algo_orders(algo_engine, algo_orders, ref_store)

    algo = algo_engine.get_algo("ALGO-001")
    assert algo is not None
    assert algo.md_freshness_gate_ms == 500


# ---------------------------------------------------------------------------
# 7. _apply_injections — market_data.delay calls hub.delay_venue
# ---------------------------------------------------------------------------

def test_apply_injections_market_data_delay():
    engine = ScenarioEngine.__new__(ScenarioEngine)
    hub = MagicMock()

    injections = [
        {
            "type": "market_data.delay",
            "args": {"venue": "NASDAQ", "delay_ms": 300},
        }
    ]

    engine._apply_injections(hub, injections)
    hub.delay_venue.assert_called_once_with("NASDAQ", 300)


def test_apply_injections_unknown_type_silently_skipped():
    engine = ScenarioEngine.__new__(ScenarioEngine)
    hub = MagicMock()

    injections = [
        {"type": "unknown_injection_type", "args": {}},
    ]

    # Should not raise and should not call delay_venue
    engine._apply_injections(hub, injections)
    hub.delay_venue.assert_not_called()


# ---------------------------------------------------------------------------
# 8. resolve_relative_timestamp — invalid relative strings raise ValueError
# ---------------------------------------------------------------------------

def test_resolve_relative_timestamp_rejects_unknown_unit():
    with pytest.raises(ValueError, match="Unrecognized relative timestamp"):
        resolve_relative_timestamp("-5d")


def test_resolve_relative_timestamp_rejects_typo():
    with pytest.raises(ValueError):
        resolve_relative_timestamp("-5min")


def test_resolve_relative_timestamp_zero_seconds():
    result = resolve_relative_timestamp("-0s")
    assert isinstance(result, str) and "T" in result


# ---------------------------------------------------------------------------
# 9. _apply_injections — unknown type emits a WARNING log
# ---------------------------------------------------------------------------

def test_apply_injections_unknown_type_logged(caplog):
    import logging
    from fix_mcp.engine.market_data import MarketDataHub
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    engine = ScenarioEngine()
    with caplog.at_level(logging.WARNING):
        engine._apply_injections(hub, [
            {"type": "unknown.type", "args": {}},
        ])
    assert any("Unknown injection type" in record.message for record in caplog.records)


# ---------------------------------------------------------------------------
# 10. resolve_relative_timestamp — empty string passes through unchanged
# ---------------------------------------------------------------------------

def test_resolve_relative_timestamp_passes_through_empty_string():
    assert resolve_relative_timestamp("") == ""

from datetime import datetime, timezone

from fix_mcp.engine.oms import OMS, Order


def _order(order_id: str, **overrides) -> Order:
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "order_id": order_id,
        "cl_ord_id": f"CLO-{order_id}",
        "symbol": "AAPL",
        "cusip": "037833100",
        "side": "buy",
        "quantity": 100,
        "order_type": "limit",
        "venue": "NYSE",
        "client_name": "Ridgemont Capital",
        "created_at": now,
        "updated_at": now,
        "price": 200.0,
        "status": "new",
    }
    data.update(overrides)
    return Order(**data)


def test_query_and_count_open_orders_by_venue() -> None:
    oms = OMS()
    oms.add_order(_order("ORD-1", venue="NYSE"))
    oms.add_order(_order("ORD-2", venue="NYSE", status="filled"))
    oms.add_order(_order("ORD-3", venue="ARCA", status="stuck", flags=["venue_down"]))

    assert [o.order_id for o in oms.query_orders(venue="NYSE")] == ["ORD-1", "ORD-2"]
    assert oms.count_by_venue() == {"NYSE": 1, "ARCA": 1}
    assert [o.order_id for o in oms.get_stuck_orders()] == ["ORD-3"]


def test_bulk_update_symbol_updates_open_orders_only() -> None:
    oms = OMS()
    oms.add_order(_order("ORD-1", symbol="ACME", status="new"))
    oms.add_order(_order("ORD-2", symbol="ACME", status="partially_filled"))
    oms.add_order(_order("ORD-3", symbol="ACME", status="filled"))

    updated = oms.bulk_update_symbol("ACME", "ACMX")

    assert updated == ["ORD-1", "ORD-2"]
    assert oms.get_order("ORD-1").symbol == "ACMX"
    assert oms.get_order("ORD-2").symbol == "ACMX"
    assert oms.get_order("ORD-3").symbol == "ACME"


def test_total_notional_at_risk_only_counts_institutional_new_and_stuck() -> None:
    oms = OMS()
    oms.add_order(_order("ORD-1", status="new", is_institutional=True, price=100.0, quantity=10))
    oms.add_order(_order("ORD-2", status="stuck", is_institutional=True, price=50.0, quantity=20))
    oms.add_order(_order("ORD-3", status="partially_filled", is_institutional=True, price=999.0))
    oms.add_order(_order("ORD-4", status="new", is_institutional=False, price=999.0))

    assert oms.total_notional_at_risk() == 2000.0


def _make_order(order_id="ORD-1", **overrides):
    defaults = dict(
        order_id=order_id, cl_ord_id="CLO-1", symbol="AAPL", cusip="037833100",
        side="buy", quantity=100, order_type="LIMIT", venue="BATS",
        client_name="acme", created_at="2026-04-19T12:00:00+00:00",
        updated_at="2026-04-19T12:00:00+00:00",
    )
    defaults.update(overrides)
    return Order(**defaults)


def test_order_accepts_pending_ack_state():
    o = _make_order(status="pending_ack", pending_since="2026-04-19T12:04:30+00:00")
    assert o.status == "pending_ack"
    assert o.pending_since == "2026-04-19T12:04:30+00:00"


def test_order_stuck_reason_roundtrip():
    o = _make_order(status="stuck", stuck_reason="stale_md")
    assert o.stuck_reason == "stale_md"


def test_order_defaults_for_new_fields():
    o = _make_order()
    assert o.pending_since is None
    assert o.stuck_reason is None


def test_pending_ack_is_in_open_statuses():
    assert "pending_ack" in OMS._OPEN_STATUSES


def test_pending_ack_orders_counted_by_venue():
    oms = OMS()
    oms.add_order(_make_order(order_id="O1", status="pending_ack", venue="NYSE"))
    counts = oms.count_by_venue()
    assert counts.get("NYSE") == 1

import asyncio
import importlib
import sys
from datetime import datetime, timezone, timedelta


def _load_server():
    for name in list(sys.modules):
        if name == "fix_mcp.server" or name.startswith("fix_mcp.server."):
            sys.modules.pop(name)
    return importlib.import_module("fix_mcp.server")


def test_tool_registry_and_resources() -> None:
    server = _load_server()

    resources = asyncio.run(server.list_resources())
    tools = asyncio.run(server.list_tools())

    assert len(resources) == 4
    assert len(tools) >= 15
    assert any(tool.name == "send_order" for tool in tools)
    assert any(str(resource.uri) == "fix://sessions" for resource in resources)


def test_fix_session_issue_releases_stuck_orders() -> None:
    server = _load_server()

    result = asyncio.run(
        server.call_tool("fix_session_issue", {"venue": "ARCA", "action": "resend_request"})
    )
    session = server.session_manager.get_session("ARCA")
    released = [
        order for order in server.oms.orders.values()
        if order.venue == "ARCA" and "venue_down" not in order.flags
    ]

    assert "FIX SESSION FIX" in result[0].text
    assert session.status == "active"
    assert session.last_recv_seq == session.expected_recv_seq
    assert released


def test_send_cancel_and_validate_order_flow() -> None:
    server = _load_server()

    send = asyncio.run(
        server.call_tool(
            "send_order",
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 100,
                "order_type": "limit",
                "price": 214.5,
                "client_name": "Ridgemont Capital",
            },
        )
    )
    lines = send[0].text.splitlines()
    order_id = next(line.split(":", 1)[1].strip() for line in lines if "Order ID:" in line)

    cancel = asyncio.run(
        server.call_tool("cancel_replace", {"order_id": order_id, "action": "cancel"})
    )
    validate = asyncio.run(server.call_tool("validate_orders", {"order_ids": [order_id]}))

    assert "ORDER CONFIRMATION" in send[0].text
    assert "CANCEL/REPLACE" in cancel[0].text
    assert "ORDER VALIDATION" in validate[0].text


def test_list_scenarios_returns_available() -> None:
    server = _load_server()

    result = asyncio.run(server.call_tool("list_scenarios", {"action": "list"}))

    assert "Available Trading Scenarios" in result[0].text
    assert "morning_triage" in result[0].text
    assert "afterhours_dark_1630" in result[0].text
    assert "Total:" in result[0].text


def test_load_scenario_switches_runtime() -> None:
    server = _load_server()

    result = asyncio.run(
        server.call_tool(
            "list_scenarios",
            {"action": "load", "scenario_name": "afterhours_dark_1630"},
        )
    )

    assert "Scenario Loaded: afterhours_dark_1630" in result[0].text
    assert "16:32" in result[0].text  # afterhours context string contains time


def test_load_scenario_invalid_name() -> None:
    server = _load_server()

    result = asyncio.run(
        server.call_tool(
            "list_scenarios",
            {"action": "load", "scenario_name": "nonexistent_scenario"},
        )
    )

    assert "ERROR" in result[0].text
    assert "nonexistent_scenario" in result[0].text


def test_send_algo_order_creates_algo() -> None:
    server = _load_server()

    result = asyncio.run(
        server.call_tool(
            "send_algo_order",
            {
                "symbol": "NVDA",
                "side": "buy",
                "quantity": 100000,
                "algo_type": "TWAP",
                "client_name": "Maple Capital",
                "arrival_px": 875.0,
                "slice_count": 4,
            },
        )
    )

    assert "ALGO ORDER CONFIRMED" in result[0].text
    assert "TWAP" in result[0].text
    assert "NVDA" in result[0].text


def test_check_algo_status_algo_scenario() -> None:
    server = _load_server()
    # Load an algo scenario
    asyncio.run(
        server.call_tool(
            "list_scenarios",
            {"action": "load", "scenario_name": "twap_slippage_1000"},
        )
    )
    result = asyncio.run(server.call_tool("check_algo_status", {}))

    assert "ALGO STATUS" in result[0].text
    assert "ALGO-20260328-001" in result[0].text
    assert "NVDA" in result[0].text


def test_cancel_algo_cancels_children() -> None:
    server = _load_server()
    asyncio.run(
        server.call_tool(
            "list_scenarios",
            {"action": "load", "scenario_name": "twap_slippage_1000"},
        )
    )
    result = asyncio.run(
        server.call_tool(
            "cancel_algo",
            {"algo_id": "ALGO-20260328-001", "reason": "test cancel"},
        )
    )

    assert "ALGO CANCELED" in result[0].text
    assert "ALGO-20260328-001" in result[0].text


def test_check_market_data_staleness_returns_list() -> None:
    server = _load_server()
    result = asyncio.run(server.call_tool("check_market_data_staleness", {}))
    assert result, "expected non-empty result"
    txt = result[0].text
    # Tool returns a formatted text listing per-symbol staleness.
    # AAPL is in the default symbol set, so it should appear.
    assert "AAPL" in txt
    assert "ms" in txt  # staleness unit appears in output


def test_check_market_data_staleness_single_symbol() -> None:
    server = _load_server()
    result = asyncio.run(server.call_tool("check_market_data_staleness", {"symbol": "AAPL"}))
    assert result
    txt = result[0].text
    assert "AAPL" in txt
    # The output should not mention other symbols when filtering.
    assert "MSFT" not in txt


def test_check_pending_acks_flags_risk_of_duplicate() -> None:
    from fix_mcp.engine.oms import Order

    server = _load_server()

    pending_ts = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
    order = Order(
        order_id="ORD-NYSE-9001",
        cl_ord_id="CLO-TEST-9001",
        symbol="IBM",
        cusip="459200101",
        side="buy",
        quantity=100,
        order_type="limit",
        venue="NYSE",
        client_name="Test Client",
        created_at=pending_ts,
        updated_at=pending_ts,
        status="pending_ack",
        pending_since=pending_ts,
    )
    server.oms.orders["ORD-NYSE-9001"] = order
    server.session_manager.get_session("NYSE").ack_delay_ms = 5000

    result = asyncio.run(server.call_tool("check_pending_acks", {"venue": "NYSE"}))
    assert result
    txt = result[0].text
    assert "ORD-NYSE-9001" in txt
    assert "[DUP-RISK]" in txt
    assert "5000" in txt
    # pending age ~90s should appear (89 or 90)
    assert "90" in txt or "89" in txt


def test_check_pending_acks_no_venue_returns_all() -> None:
    server = _load_server()
    result = asyncio.run(server.call_tool("check_pending_acks", {}))
    assert result
    assert "PENDING ACKS" in result[0].text
    assert "No orders in pending_ack status." in result[0].text


def test_check_pending_acks_unknown_pending_since_flagged() -> None:
    from fix_mcp.engine.oms import Order

    server = _load_server()

    order = Order(
        order_id="ORD-NYSE-9002",
        cl_ord_id="CLO-TEST-9002",
        symbol="GE",
        cusip="369604103",
        side="sell",
        quantity=50,
        order_type="market",
        venue="NYSE",
        client_name="Test Client",
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
        status="pending_ack",
        pending_since=None,
    )
    server.oms.orders["ORD-NYSE-9002"] = order

    result = asyncio.run(server.call_tool("check_pending_acks", {}))
    assert result
    txt = result[0].text
    assert "ORD-NYSE-9002" in txt
    assert "[AGE-UNKNOWN]" in txt


def test_clear_market_data_delay_clears_and_reports() -> None:
    server = _load_server()
    server.market_data_hub.delay_venue("BATS", 600)
    result = asyncio.run(server.call_tool("clear_market_data_delay", {"venue": "BATS"}))
    assert result
    txt = result[0].text
    assert "BATS" in txt
    assert "600" in txt
    assert "CLEARED" in txt
    assert "NO DELAY ACTIVE" not in txt
    assert "BATS" not in server.market_data_hub._venue_delays


def test_clear_market_data_delay_noop_when_no_delay() -> None:
    server = _load_server()
    result = asyncio.run(server.call_tool("clear_market_data_delay", {"venue": "ARCA"}))
    assert result
    txt = result[0].text
    assert "ARCA" in txt
    assert "0 ms" in txt
    assert "NO DELAY ACTIVE" in txt


def test_release_stuck_orders_unblocks_when_md_fresh() -> None:
    from fix_mcp.engine.oms import Order

    server = _load_server()

    now_ts = datetime.now(timezone.utc).isoformat()
    order = Order(
        order_id="ORD-2001",
        cl_ord_id="CLO-TEST-2001",
        symbol="AAPL",
        cusip="037833100",
        side="buy",
        quantity=100,
        order_type="limit",
        venue="BATS",
        client_name="Test Client",
        created_at=now_ts,
        updated_at=now_ts,
        status="stuck",
        stuck_reason="stale_md",
        flags=["algo_child"],
    )
    server.oms.orders["ORD-2001"] = order

    # Ensure MD is fresh for AAPL
    book = server.market_data_hub.get_quote("AAPL")
    if book is not None:
        book.last_updated = datetime.now(timezone.utc).isoformat()

    result = asyncio.run(server.call_tool("release_stuck_orders", {"reason_filter": "stale_md"}))
    assert result
    txt = result[0].text
    assert "ORD-2001" in txt
    assert "released" in txt.lower()
    assert server.oms.get_order("ORD-2001").status == "new"


def test_release_stuck_orders_skips_when_md_stale() -> None:
    from fix_mcp.engine.oms import Order

    server = _load_server()

    now_ts = datetime.now(timezone.utc).isoformat()
    order = Order(
        order_id="ORD-2002",
        cl_ord_id="CLO-TEST-2002",
        symbol="AAPL",
        cusip="037833100",
        side="buy",
        quantity=200,
        order_type="limit",
        venue="BATS",
        client_name="Test Client",
        created_at=now_ts,
        updated_at=now_ts,
        status="stuck",
        stuck_reason="stale_md",
    )
    server.oms.orders["ORD-2002"] = order

    # Force MD stale: 10s ago >> 500ms threshold
    book = server.market_data_hub.get_quote("AAPL")
    if book is not None:
        book.last_updated = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    else:
        # If AAPL not tracked, is_stale returns True (unknown = stale) — no action needed
        pass

    result = asyncio.run(server.call_tool("release_stuck_orders", {"reason_filter": "stale_md"}))
    assert result
    txt = result[0].text
    assert "ORD-2002" in txt
    assert "Skipped" in txt
    assert server.oms.get_order("ORD-2002").status == "stuck"


def test_release_stuck_orders_reason_filter_excludes_nonmatching() -> None:
    from fix_mcp.engine.oms import Order

    server = _load_server()

    now_ts = datetime.now(timezone.utc).isoformat()
    order = Order(
        order_id="ORD-3001",
        cl_ord_id="CLO-TEST-3001",
        symbol="MSFT",
        cusip="594918104",
        side="sell",
        quantity=50,
        order_type="market",
        venue="BATS",
        client_name="Test Client",
        created_at=now_ts,
        updated_at=now_ts,
        status="stuck",
        stuck_reason="venue_down",
        flags=["venue_down"],
    )
    server.oms.orders["ORD-3001"] = order

    result = asyncio.run(server.call_tool("release_stuck_orders", {"reason_filter": "stale_md"}))
    assert result
    txt = result[0].text
    assert "ORD-3001" not in txt
    assert server.oms.get_order("ORD-3001").status == "stuck"


def test_release_stuck_orders_no_args_still_works() -> None:
    server = _load_server()

    result = asyncio.run(server.call_tool("release_stuck_orders", {}))
    assert result
    txt = result[0].text
    assert "RELEASED STUCK ORDERS" in txt


def test_release_stuck_orders_uses_algo_md_freshness_gate() -> None:
    """Algo-child with 2000 ms gate should be released when MD is 700 ms stale."""
    from fix_mcp.engine.oms import Order
    from fix_mcp.engine.algos import AlgoOrder

    server = _load_server()

    now_ts = datetime.now(timezone.utc).isoformat()

    # Stuck algo-child order
    order = Order(
        order_id="ORD-ALGO-CHILD-1",
        cl_ord_id="CLO-ALGO-CHILD-1",
        symbol="AAPL",
        cusip="037833100",
        side="buy",
        quantity=1000,
        order_type="limit",
        venue="BATS",
        client_name="Test Client",
        created_at=now_ts,
        updated_at=now_ts,
        status="stuck",
        stuck_reason="stale_md",
        flags=["algo_child"],
    )
    server.oms.orders["ORD-ALGO-CHILD-1"] = order

    # Matching algo with generous 2000 ms gate
    algo = AlgoOrder(
        algo_id="ALGO-TEST-1",
        client_name="Test Client",
        symbol="AAPL",
        cusip="037833100",
        side="buy",
        total_qty=1000,
        algo_type="TWAP",
        start_time=now_ts,
        venue="BATS",
        created_at=now_ts,
        updated_at=now_ts,
        child_order_ids=["ORD-ALGO-CHILD-1"],
        md_freshness_gate_ms=2000,
    )
    server.algo_engine.algos["ALGO-TEST-1"] = algo

    # Force AAPL MD to be ~700 ms stale (stale under 500 ms default, fresh under 2000 ms gate)
    book = server.market_data_hub.get_quote("AAPL")
    assert book is not None, "AAPL must be in default symbols"
    book.last_updated = (datetime.now(timezone.utc) - timedelta(milliseconds=700)).isoformat()

    result = asyncio.run(server.call_tool("release_stuck_orders", {"reason_filter": "stale_md"}))
    assert result
    txt = result[0].text
    assert "ORD-ALGO-CHILD-1" in txt
    assert server.oms.get_order("ORD-ALGO-CHILD-1").status == "new"


def test_release_stuck_orders_default_threshold_skips_borderline_stale() -> None:
    """Without algo, default 500 ms gate must NOT release an order at 700 ms staleness."""
    from fix_mcp.engine.oms import Order

    server = _load_server()

    now_ts = datetime.now(timezone.utc).isoformat()

    # Stuck order with no algo_child flag — falls back to default 500 ms threshold
    order = Order(
        order_id="ORD-BORDER-1",
        cl_ord_id="CLO-BORDER-1",
        symbol="AAPL",
        cusip="037833100",
        side="buy",
        quantity=500,
        order_type="limit",
        venue="BATS",
        client_name="Test Client",
        created_at=now_ts,
        updated_at=now_ts,
        status="stuck",
        stuck_reason="stale_md",
    )
    server.oms.orders["ORD-BORDER-1"] = order

    # Force AAPL MD to be ~700 ms stale — exceeds default 500 ms threshold
    book = server.market_data_hub.get_quote("AAPL")
    assert book is not None, "AAPL must be in default symbols"
    book.last_updated = (datetime.now(timezone.utc) - timedelta(milliseconds=700)).isoformat()

    result = asyncio.run(server.call_tool("release_stuck_orders", {"reason_filter": "stale_md"}))
    assert result
    assert server.oms.get_order("ORD-BORDER-1").status == "stuck"

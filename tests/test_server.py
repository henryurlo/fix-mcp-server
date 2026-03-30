import asyncio
import importlib
import sys


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
    assert len(tools) == 15
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

from fix_mcp.fix.messages import FIXMessageBuilder
from fix_mcp.fix.protocol import SequenceManager, parse_fix_message
from fix_mcp.fix.tags import FIXTags


def test_new_order_single_contains_expected_tags() -> None:
    builder = FIXMessageBuilder("FIRM_PROD", "EXCHANGE_GW", SequenceManager())

    message = builder.build_new_order_single(
        cl_ord_id="CLO-1",
        symbol="AAPL",
        side="1",
        quantity=100,
        order_type="2",
        venue="NYSE",
        price=214.5,
    )
    fields = message["fields"]

    assert fields[FIXTags.BeginString] == "FIX.4.2"
    assert fields[FIXTags.MsgType] == FIXTags.MsgTypes.NewOrderSingle
    assert fields[FIXTags.ClOrdID] == "CLO-1"
    assert fields[FIXTags.ExDestination] == "XNYS"
    assert fields[FIXTags.Price] == "214.5"
    assert "35=D" in message["raw"]


def test_execution_report_round_trips_via_parser() -> None:
    builder = FIXMessageBuilder("FIRM_PROD", "EXCHANGE_GW", SequenceManager(initial_seq=7))

    message = builder.build_execution_report(
        order_id="ORD-1",
        cl_ord_id="CLO-1",
        exec_type="2",
        ord_status="2",
        symbol="MSFT",
        side="1",
        quantity=50,
        filled_qty=50,
        leaves_qty=0,
        avg_px=420.25,
    )
    parsed = parse_fix_message(message["raw"])

    assert parsed["35"] == "8"
    assert parsed["34"] == "7"
    assert parsed["37"] == "ORD-1"
    assert parsed["55"] == "MSFT"
    assert parsed["6"] == "420.25"

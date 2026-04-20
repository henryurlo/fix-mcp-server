from fix_mcp.engine.scenarios import ScenarioEngine
from fix_mcp.engine.market_data import MarketDataHub


def test_midday_chaos_scenario_loads_with_expected_state():
    engine = ScenarioEngine()
    hub = MarketDataHub(symbols={"AAPL": 195.0, "MSFT": 405.0}, tick_interval_ms=100)
    oms, session_mgr, ref_store = engine.load_scenario(
        "midday_chaos_1205", market_data_hub=hub,
    )
    algos = engine.algo_engine

    # Incident A
    algo = algos.get_algo("ALGO-PARENT-001")
    assert algo is not None
    assert algo.symbol == "AAPL"
    assert algo.md_freshness_gate_ms == 100
    assert "algo_behind_schedule" in algo.flags
    assert sorted(algo.child_order_ids) == ["ORD-1005", "ORD-1006"]

    for child_id in ("ORD-1005", "ORD-1006"):
        child = oms.get_order(child_id)
        assert child is not None, child_id
        assert child.status == "stuck"
        assert child.stuck_reason == "stale_md"
        assert "algo_child" in child.flags

    # Incident B
    nyse = oms.get_order("ORD-NYSE-7731")
    assert nyse is not None
    assert nyse.symbol == "MSFT"
    assert nyse.status == "pending_ack"
    assert nyse.pending_since is not None and nyse.pending_since != "-90s"
    assert nyse.filled_quantity == 100

    nyse_session = session_mgr.get_session("NYSE")
    assert nyse_session.ack_delay_ms == 5000

    # Injection applied
    assert hub._venue_delays.get("BATS") == 600

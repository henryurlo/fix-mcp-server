from fix_mcp.engine.algos import AlgoOrder, AlgoEngine


def _make_algo(**overrides):
    defaults = dict(
        algo_id="ALGO-1", client_name="acme", symbol="AAPL", cusip="037833100",
        side="buy", total_qty=10000, algo_type="TWAP",
        start_time="2026-04-19T12:00:00+00:00", venue="BATS",
        created_at="2026-04-19T12:00:00+00:00",
        updated_at="2026-04-19T12:00:00+00:00",
    )
    defaults.update(overrides)
    return AlgoOrder(**defaults)


def test_md_freshness_gate_default_is_none():
    algo = _make_algo()
    assert algo.md_freshness_gate_ms is None


def test_md_freshness_gate_can_be_set():
    algo = _make_algo(md_freshness_gate_ms=100)
    assert algo.md_freshness_gate_ms == 100


def test_algo_engine_preserves_md_freshness_gate():
    engine = AlgoEngine()
    engine.add_algo(_make_algo(md_freshness_gate_ms=250))
    retrieved = engine.get_algo("ALGO-1")
    assert retrieved is not None
    assert retrieved.md_freshness_gate_ms == 250

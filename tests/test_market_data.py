from datetime import datetime, timedelta, timezone

from fix_mcp.engine.market_data import MarketDataHub


def _freeze_book(hub: MarketDataHub, symbol: str, seconds_ago: float) -> None:
    """Set a symbol's last_updated to N seconds ago (ISO-8601)."""
    ts = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
    book = hub.get_quote(symbol)
    assert book is not None
    book.last_updated = ts


def test_staleness_ms_fresh_quote_under_50ms() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    ms = hub.staleness_ms("AAPL")
    assert 0 <= ms < 50, f"expected fresh, got {ms}ms"


def test_staleness_ms_600ms_old() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    _freeze_book(hub, "AAPL", seconds_ago=0.6)
    ms = hub.staleness_ms("AAPL")
    assert 550 <= ms <= 700, f"expected ~600ms, got {ms}ms"


def test_staleness_ms_unknown_symbol_returns_minus_one() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    assert hub.staleness_ms("ZZZZ") == -1


def test_is_stale_true_when_over_threshold() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    _freeze_book(hub, "AAPL", seconds_ago=0.5)
    assert hub.is_stale("AAPL", threshold_ms=100) is True


def test_is_stale_false_when_under_threshold() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    # Fresh book — under any reasonable threshold.
    assert hub.is_stale("AAPL", threshold_ms=1000) is False


def test_is_stale_unknown_symbol_is_true() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    assert hub.is_stale("ZZZZ", threshold_ms=100) is True


def test_staleness_ms_unparseable_timestamp_returns_minus_one() -> None:
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    book = hub.get_quote("AAPL")
    assert book is not None
    book.last_updated = "not-a-date"
    assert hub.staleness_ms("AAPL") == -1
    assert hub.is_stale("AAPL", threshold_ms=100) is True

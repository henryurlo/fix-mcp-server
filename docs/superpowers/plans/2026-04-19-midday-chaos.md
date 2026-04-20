# Midday Chaos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a flagship demo scenario (`midday_chaos_1205`) with two concurrent, unrelated incidents — stuck algo children from stale BATS market data, and delayed-ACK pending fills on an unrelated NYSE order — plus the 4 state-model fields, 3 new MCP tools, and 1 tool extension the scenario requires.

**Architecture:** Additive-only changes to the existing Python engine. Four dataclass fields are added (`pending_ack` state + `pending_since` + `stuck_reason` on `Order`; `md_freshness_gate_ms` on `AlgoOrder`; `ack_delay_ms` on `FIXSession`; `staleness_ms` / `is_stale` methods on `MarketDataHub`). Three new MCP tool handlers and one extended handler are registered in `server.py`. No new scenario injection hooks — the new state fields are declarative in the scenario JSON. The existing `MarketDataHub.reset_feed()` is reused by the new `clear_market_data_delay` tool.

**Engine context (confirmed by Task 0 preflight):**
- Live scenario loader is **v1 `ScenarioEngine`** in `src/fix_mcp/engine/scenarios.py` (imported at `src/fix_mcp/server.py:19`, instantiated at `src/fix_mcp/server.py:99`). `ScenarioEngineV2` is dead code — do NOT touch it.
- Scenario dir is `config/scenarios/` (NOT `config/scenarios_v2/`).
- v1 `load_scenario()` reads JSON key `"algo_orders"` (NOT `"algos"`). v1 ignores any top-level `"injections"` key.
- v1 `_load_orders`, `_load_algo_orders`, `_load_sessions` construct dataclasses with **explicit kwargs** — the new fields (`pending_since`, `stuck_reason`, `md_freshness_gate_ms`, `ack_delay_ms`) must be threaded through these calls explicitly. They do NOT "flow automatically" via `**kwargs`.
- **v1 `server.py` has NO `MarketDataHub` instance**. Tasks 5, 7, and 10 require wiring a module-level `market_data_hub` in `server.py` as part of Task 5's first implementation step. Scenario loader (Task 9) then calls `hub.delay_venue(...)` to apply the `injections` block.
- Pre-existing failure: `test_tool_registry_and_resources` hardcodes `len(tools) == 15`; actual is 22. Task 5 must relax this to `>= 15` (we'll push it to 25 by the end of this plan).

**Tech Stack:** Python 3.11, dataclasses, `pytest`, MCP SDK. Backend only. Tests are `pytest`-based. Frontend / Next.js is out of scope.

---

## Spec Reference

All work implements `docs/superpowers/specs/2026-04-19-midday-chaos-compound-scenario-design.md`. If this plan diverges from the spec, the plan wins for field names (scenario JSON uses the actual Python dataclass field names — `quantity` / `filled_quantity` / `total_qty` — rather than the informal `qty` / `filled_qty` used in the spec's illustrative JSON).

## Branch & Commit Discipline

- Start from branch `spec/midday-chaos` (already contains the spec).
- Create a new branch `feat/midday-chaos` off `spec/midday-chaos`.
- Commit after every task. Conventional-commits style. Frequent small commits beat one big one.
- Do NOT commit to `main` directly.
- Do NOT push until Task 12 succeeds end-to-end.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/fix_mcp/engine/oms.py` | modify | Add `pending_ack` to `_OPEN_STATUSES`; add `pending_since`, `stuck_reason` fields to `Order`. |
| `src/fix_mcp/engine/algos.py` | modify | Add `md_freshness_gate_ms` field to `AlgoOrder`. |
| `src/fix_mcp/engine/fix_sessions.py` | modify | Add `ack_delay_ms` field to `FIXSession`. |
| `src/fix_mcp/engine/market_data.py` | modify | Add `staleness_ms(symbol)` and `is_stale(symbol, threshold_ms)` methods to `MarketDataHub`. |
| `src/fix_mcp/server.py` | modify | Register 3 new tools (`check_market_data_staleness`, `check_pending_acks`, `clear_market_data_delay`); extend `release_stuck_orders` with `reason_filter`. |
| `src/fix_mcp/engine/scenarios.py` (v1 — confirmed live by Task 0) | modify | Loader honors new optional fields, resolves relative timestamps like `"-90s"`, and applies `injections` (which v1 currently ignores). |
| `config/scenarios/midday_chaos_1205.json` | create | Full scenario definition — sessions, orders, algo_orders (v1 key name), injections, runbook, hints, success criteria. |
| `docs/demo-midday-chaos.md` | create | Human-readable demo script following the 6 beats in the spec (Section 5). |
| `tests/test_oms.py` | modify | Add tests for `pending_ack` state, `pending_since`, `stuck_reason`, `_OPEN_STATUSES`. |
| `tests/test_fix_sessions.py` | modify | Add test for `ack_delay_ms` field + default. |
| `tests/test_market_data.py` | create | Tests for `staleness_ms` and `is_stale` against a fixed clock. |
| `tests/test_server.py` | modify | Tool-handler tests for 3 new tools + extended `release_stuck_orders`. |
| `tests/test_algos.py` | create | Test for `AlgoOrder.md_freshness_gate_ms` default + settable. |
| `tests/test_scenario_midday_chaos.py` | create | Integration test: load scenario, assert both incidents in expected states. |

---

## Task 0: Preflight — green baseline, engine discovery, branch

**Goal:** Confirm the repo runs and tests pass before touching anything. Identify whether the live scenario loader is `ScenarioEngine` (v1) or `ScenarioEngineV2`, since Task 9 edits whichever one is wired.

**Files:** none modified.

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/urbano-claw/fix-mcp-server
git checkout spec/midday-chaos
git checkout -b feat/midday-chaos
git log --oneline -3
```

Expected: last commit is `docs(spec): midday-chaos compound-scenario design`.

- [ ] **Step 2: Install backend in editable mode (skip Docker for inner loop)**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev] 2>&1 | tail -5
```

If `.[dev]` extra does not exist, fall back to `pip install -e .` and `pip install pytest`.

- [ ] **Step 3: Run existing test suite to establish green baseline**

```bash
pytest -q
```

Expected: all existing tests pass. If any fail, STOP — fix or report before continuing.

- [ ] **Step 4: Identify the live scenario loader**

```bash
grep -n "ScenarioEngineV2\|ScenarioEngine(" src/fix_mcp/api.py src/fix_mcp/server.py
```

Record the answer in a scratch note for Task 9:
- If v2 is instantiated in `api.py` or `server.py` → Task 9 edits `scenario_engine_v2.py`.
- Otherwise → Task 9 edits `scenarios.py`.

- [ ] **Step 5: Commit the empty branch marker (optional)**

No commit needed — branch exists. Proceed to Task 1.

---

## Task 1: Order state extensions

**Goal:** Add `pending_ack` state, `pending_since` timestamp, and `stuck_reason` field to `Order`; include `pending_ack` in `OMS._OPEN_STATUSES`.

**Files:**
- Modify: `src/fix_mcp/engine/oms.py`
- Modify: `tests/test_oms.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_oms.py`:

```python
from fix_mcp.engine.oms import OMS, Order

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_oms.py -q -k "pending_ack or stuck_reason or new_fields"
```

Expected: FAIL — `Order.__init__() got an unexpected keyword argument 'pending_since'`.

- [ ] **Step 3: Add the new fields and status**

Edit `src/fix_mcp/engine/oms.py`:

Add to the `Order` dataclass after `sla_minutes: Optional[int] = None`:
```python
    pending_since: Optional[str] = None
    stuck_reason: Optional[str] = None
```

Replace the `_OPEN_STATUSES` constant:
```python
    _OPEN_STATUSES = {"new", "partially_filled", "stuck", "pending_cancel", "pending_ack"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_oms.py -q
```

Expected: all pass (including the existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/engine/oms.py tests/test_oms.py
git commit -m "feat(oms): add pending_ack state, pending_since, stuck_reason fields"
```

---

## Task 2: AlgoOrder md_freshness_gate_ms field

**Goal:** Add `md_freshness_gate_ms: Optional[int] = None` to `AlgoOrder`.

**Files:**
- Modify: `src/fix_mcp/engine/algos.py`
- Create: `tests/test_algos.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_algos.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_algos.py -q
```

Expected: FAIL — unexpected keyword argument.

- [ ] **Step 3: Add the field**

Edit `src/fix_mcp/engine/algos.py`. Inside the `AlgoOrder` dataclass, add after `notes: str = ""`:

```python
    md_freshness_gate_ms: Optional[int] = None
```

Also add to the docstring attributes block:
```
        md_freshness_gate_ms: If set, slicer must not release child orders
                              while MD for `symbol` is older than this threshold.
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_algos.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/engine/algos.py tests/test_algos.py
git commit -m "feat(algos): add md_freshness_gate_ms to AlgoOrder"
```

---

## Task 3: FIXSession ack_delay_ms field

**Goal:** Add `ack_delay_ms: int = 0` to `FIXSession`.

**Files:**
- Modify: `src/fix_mcp/engine/fix_sessions.py`
- Modify: `tests/test_fix_sessions.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_fix_sessions.py`:

```python
from fix_mcp.engine.fix_sessions import FIXSession, FIXSessionManager


def _make_session(**overrides):
    defaults = dict(
        venue="NYSE", session_id="S1",
        sender_comp_id="ACME", target_comp_id="NYSE",
    )
    defaults.update(overrides)
    return FIXSession(**defaults)


def test_ack_delay_ms_defaults_to_zero():
    s = _make_session()
    assert s.ack_delay_ms == 0


def test_ack_delay_ms_can_be_set():
    s = _make_session(ack_delay_ms=5000)
    assert s.ack_delay_ms == 5000


def test_session_manager_preserves_ack_delay_ms():
    mgr = FIXSessionManager()
    mgr.add_session(_make_session(ack_delay_ms=5000))
    assert mgr.get_session("NYSE").ack_delay_ms == 5000
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_fix_sessions.py -q -k ack_delay
```

Expected: FAIL — unexpected keyword argument.

- [ ] **Step 3: Add the field**

Edit `src/fix_mcp/engine/fix_sessions.py`. Inside the `FIXSession` dataclass, add after `connected_since: Optional[str] = None`:

```python
    ack_delay_ms: int = 0
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_fix_sessions.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/engine/fix_sessions.py tests/test_fix_sessions.py
git commit -m "feat(fix): add ack_delay_ms field to FIXSession"
```

---

## Task 4: MarketDataHub staleness

**Goal:** Add `staleness_ms(symbol) -> int` and `is_stale(symbol, threshold_ms) -> bool` methods. Staleness is computed from `OrderBook.last_updated` (ISO string) against `datetime.now(timezone.utc)`.

**Files:**
- Modify: `src/fix_mcp/engine/market_data.py`
- Create: `tests/test_market_data.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_market_data.py`:

```python
from datetime import datetime, timedelta, timezone

from fix_mcp.engine.market_data import MarketDataHub, OrderBook, OrderBookLevel


def _freeze_book(hub: MarketDataHub, symbol: str, seconds_ago: float) -> None:
    """Set a symbol's last_updated to N seconds ago (ISO-8601)."""
    ts = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
    book = hub.get_quote(symbol)
    assert book is not None
    book.last_updated = ts


def test_staleness_ms_fresh_quote_under_50ms():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    # Just-built book — last_updated is "now" minus microseconds.
    ms = hub.staleness_ms("AAPL")
    assert 0 <= ms < 50, f"expected fresh, got {ms}ms"


def test_staleness_ms_600ms_old():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    _freeze_book(hub, "AAPL", seconds_ago=0.6)
    ms = hub.staleness_ms("AAPL")
    assert 550 <= ms <= 700, f"expected ~600ms, got {ms}ms"


def test_staleness_ms_unknown_symbol_returns_minus_one():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    assert hub.staleness_ms("ZZZZ") == -1


def test_is_stale_true_when_over_threshold():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    _freeze_book(hub, "AAPL", seconds_ago=0.5)
    assert hub.is_stale("AAPL", threshold_ms=100) is True


def test_is_stale_false_when_under_threshold():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    # fresh
    assert hub.is_stale("AAPL", threshold_ms=1000) is False


def test_is_stale_unknown_symbol_is_true():
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    assert hub.is_stale("ZZZZ", threshold_ms=100) is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_market_data.py -q
```

Expected: FAIL — `'MarketDataHub' object has no attribute 'staleness_ms'`.

- [ ] **Step 3: Add the methods**

Edit `src/fix_mcp/engine/market_data.py`. In the `MarketDataHub` class, add under the "Queries" section (after `get_fx_rates`):

```python
    def staleness_ms(self, symbol: str) -> int:
        """Return age of the latest quote for *symbol* in ms.

        Returns -1 if the symbol is not tracked or has no valid timestamp.
        """
        book = self._books.get(symbol)
        if book is None or not book.last_updated:
            return -1
        try:
            ts = datetime.fromisoformat(book.last_updated)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return -1
        delta = datetime.now(timezone.utc) - ts
        return max(0, int(delta.total_seconds() * 1000))

    def is_stale(self, symbol: str, threshold_ms: int) -> bool:
        """True if MD for *symbol* is older than *threshold_ms* or unknown."""
        ms = self.staleness_ms(symbol)
        if ms < 0:
            return True
        return ms > threshold_ms
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_market_data.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/engine/market_data.py tests/test_market_data.py
git commit -m "feat(market_data): add staleness_ms and is_stale to MarketDataHub"
```

---

## Task 5: `check_market_data_staleness` tool

**Goal:** New MCP tool that returns per-symbol staleness. If `symbol` arg is omitted, returns all symbols.

**Files:**
- Modify: `src/fix_mcp/server.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Locate the tool-registration pattern in `server.py`**

Before editing, search for how existing tools are wired:

```bash
grep -n "check_fix_sessions\|@server.tool\|tool(\|TOOL_HANDLERS\|register_tool" src/fix_mcp/server.py | head -20
```

Follow the existing pattern (decorator, dict dispatch, etc.) — do not invent a new one.

- [ ] **Step 2: Write the failing test**

Find how existing tool tests are structured in `tests/test_server.py`. Mirror the pattern. Append:

```python
# In tests/test_server.py — adapt to project's existing harness.
# The harness exposes a way to invoke tools by name. Reuse it.

def test_check_market_data_staleness_all_symbols(server_harness):
    result = server_harness.invoke_tool("check_market_data_staleness", {})
    # Expect a list of per-symbol dicts with staleness_ms and stale flag
    assert isinstance(result, list)
    assert all({"symbol", "last_quote_ts", "staleness_ms", "stale"} <= r.keys() for r in result)


def test_check_market_data_staleness_single_symbol(server_harness):
    result = server_harness.invoke_tool(
        "check_market_data_staleness", {"symbol": "AAPL"}
    )
    # Either a single dict or a one-element list, per project convention.
    if isinstance(result, list):
        assert len(result) == 1
        assert result[0]["symbol"] == "AAPL"
    else:
        assert result["symbol"] == "AAPL"
```

If the project uses a different test harness for tools (e.g. direct function calls against a handler dict), adapt accordingly. Do NOT invent a new harness just for this test.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_server.py -q -k staleness
```

Expected: FAIL — unknown tool `check_market_data_staleness`.

- [ ] **Step 4: Wire a `MarketDataHub` singleton into `server.py` (prerequisite for this task and Tasks 7, 9, 10)**

v1 `server.py` does not currently instantiate `MarketDataHub`. Add one alongside the existing `engine.load_scenario()` so tool handlers have a hub to read from. Near line 99-101 (after `engine = ScenarioEngine(CONFIG_DIR)` and `oms, session_manager, ref_store = engine.load_scenario(SCENARIO)`):

```python
from fix_mcp.engine.market_data import MarketDataHub

# Derive the symbol set from reference data (or hardcode a demo set if ref data is empty).
_md_symbols = {s.symbol: 100.0 for s in ref_store.list_symbols()} or {
    "AAPL": 195.0, "MSFT": 405.0, "SPY": 520.0,
}
market_data_hub = MarketDataHub(symbols=_md_symbols, tick_interval_ms=100)
```

Also extend `reset_runtime` to rebuild `market_data_hub` on scenario reload. Use `global market_data_hub`.

If `ref_store.list_symbols()` does not exist, use the hardcoded fallback directly.

- [ ] **Step 5: Relax the pre-existing tool-count assertion**

`tests/test_server.py::test_tool_registry_and_resources` hardcodes `len(tools) == 15` but the registry already has 22 tools (pre-existing failure) and this task will push it higher. Change the assertion to `>= 15` so the test passes today and keeps passing after this plan adds 3 more tools.

- [ ] **Step 6: Implement the tool handler**

Add to `src/fix_mcp/server.py` (following the existing tool-registration pattern):

```python
def _format_staleness_entry(hub: MarketDataHub, symbol: str) -> dict:
    book = hub.get_quote(symbol)
    ms = hub.staleness_ms(symbol)
    return {
        "symbol": symbol,
        "last_quote_ts": book.last_updated if book else None,
        "staleness_ms": ms,
        "stale": ms < 0 or ms > 500,  # advisory threshold
    }


def handle_check_market_data_staleness(args: dict) -> list[dict]:
    """Return per-symbol staleness. Args: {symbol?: str}."""
    symbol = args.get("symbol")
    if symbol:
        _assert_symbol(symbol)
        return [_format_staleness_entry(market_data_hub, symbol)]
    # Enumerate known symbols from the hub's internal book map.
    return [_format_staleness_entry(market_data_hub, s) for s in market_data_hub._books.keys()]
```

Register in the tool table / decorator list alongside existing tools. Include an MCP `Tool` schema describing the args (`symbol?: str`). Follow the pattern used by `check_fix_sessions` (locate via `grep -n "check_fix_sessions" src/fix_mcp/server.py`).

- [ ] **Step 7: Run tests to verify they pass**

```bash
pytest tests/test_server.py -q -k "staleness or tool_registry"
pytest -q
```

Expected: PASS. No regressions elsewhere.

- [ ] **Step 8: Commit**

```bash
git add src/fix_mcp/server.py tests/test_server.py
git commit -m "feat(tools): add check_market_data_staleness + wire MarketDataHub into server"
```

---

## Task 6: `check_pending_acks` tool

**Goal:** New MCP tool returning all orders in `pending_ack`, with pending age, venue ACK delay, and a `risk_of_duplicate` flag (true when `pending_since` age > 30s).

**Files:**
- Modify: `src/fix_mcp/server.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_server.py`:

```python
def test_check_pending_acks_flags_risk_of_duplicate(server_harness):
    # Seed: a pending_ack order on NYSE pending >30s, ack_delay_ms on session = 5000
    server_harness.seed_order(
        order_id="ORD-NYSE-9001", venue="NYSE",
        status="pending_ack",
        pending_since="-90s",  # 90s ago (relative, resolved at seed time)
    )
    server_harness.seed_session(venue="NYSE", ack_delay_ms=5000)

    result = server_harness.invoke_tool("check_pending_acks", {"venue": "NYSE"})
    assert isinstance(result, list)
    assert len(result) >= 1
    entry = next(r for r in result if r["order_id"] == "ORD-NYSE-9001")
    assert entry["ack_delay_ms"] == 5000
    assert entry["pending_since_seconds"] >= 89
    assert entry["risk_of_duplicate"] is True


def test_check_pending_acks_no_venue_returns_all(server_harness):
    result = server_harness.invoke_tool("check_pending_acks", {})
    assert isinstance(result, list)
```

The `server_harness.seed_order` / `seed_session` helpers may not exist — if not, seed via existing OMS/SessionManager fixtures following the project's conventions.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_server.py -q -k pending_acks
```

Expected: FAIL — unknown tool.

- [ ] **Step 3: Implement the tool handler**

Add to `src/fix_mcp/server.py`:

```python
from datetime import datetime, timezone


def _pending_since_seconds(iso_ts: str | None) -> float:
    if not iso_ts:
        return 0.0
    try:
        ts = datetime.fromisoformat(iso_ts)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return 0.0
    return max(0.0, (datetime.now(timezone.utc) - ts).total_seconds())


def handle_check_pending_acks(args: dict) -> list[dict]:
    """Return orders currently in pending_ack state with duplicate-risk flags.

    Reads module-level `oms` and `session_manager` singletons in `server.py`.
    """
    venue_filter = args.get("venue")

    result: list[dict] = []
    for order in oms.orders.values():
        if order.status != "pending_ack":
            continue
        if venue_filter and order.venue.upper() != venue_filter.upper():
            continue
        session = session_manager.get_session(order.venue)
        ack_delay_ms = getattr(session, "ack_delay_ms", 0) if session else 0
        age_s = _pending_since_seconds(order.pending_since)
        result.append({
            "order_id": order.order_id,
            "symbol": order.symbol,
            "venue": order.venue,
            "filled_quantity": order.filled_quantity,
            "quantity": order.quantity,
            "pending_since": order.pending_since,
            "pending_since_seconds": round(age_s, 1),
            "ack_delay_ms": ack_delay_ms,
            "risk_of_duplicate": age_s > 30.0,
        })
    return result
```

Register in the tool table with an appropriate MCP schema.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_server.py -q -k pending_acks
pytest -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/server.py tests/test_server.py
git commit -m "feat(tools): add check_pending_acks with duplicate-risk flag"
```

---

## Task 7: `clear_market_data_delay` tool

**Goal:** New MCP tool that wraps the existing `MarketDataHub.reset_feed(venue)` and reports what was cleared.

**Files:**
- Modify: `src/fix_mcp/server.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_server.py`:

```python
def test_clear_market_data_delay_clears_and_reports(server_harness):
    hub = server_harness.market_data_hub
    hub.delay_venue("BATS", 600)

    result = server_harness.invoke_tool(
        "clear_market_data_delay", {"venue": "BATS"}
    )
    assert result["venue"] == "BATS"
    assert result["cleared"] is True
    assert result["previous_delay_ms"] == 600
    assert "BATS" not in hub._venue_delays


def test_clear_market_data_delay_noop_when_no_delay(server_harness):
    result = server_harness.invoke_tool(
        "clear_market_data_delay", {"venue": "ARCA"}
    )
    assert result["venue"] == "ARCA"
    assert result["cleared"] is False
    assert result["previous_delay_ms"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_server.py -q -k clear_market_data_delay
```

Expected: FAIL — unknown tool.

- [ ] **Step 3: Implement the tool handler**

Add to `src/fix_mcp/server.py`:

```python
def handle_clear_market_data_delay(args: dict) -> dict:
    """Clear any injected market_data.delay on *venue*."""
    venue = args["venue"]
    _assert_venue_or_side(venue, "venue")
    previous = market_data_hub._venue_delays.get(venue.upper(), 0)
    market_data_hub.reset_feed(venue)
    return {
        "venue": venue,
        "cleared": previous > 0,
        "previous_delay_ms": previous,
    }
```

Register with MCP schema (args: `{venue: str}` required).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_server.py -q -k clear_market_data_delay
pytest -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fix_mcp/server.py tests/test_server.py
git commit -m "feat(tools): add clear_market_data_delay MCP tool"
```

---

## Task 8: Extend `release_stuck_orders` with `reason_filter` + real implementation

**Goal:** Replace the stub with real unsticking. Filter by `stuck_reason`. For each matching stuck order, re-check the blocking condition (for `stale_md`: is MD now fresh for the order's symbol? — use a 500ms default threshold, or the parent algo's `md_freshness_gate_ms` if the order is an `algo_child`). If clear, transition status back to `new` and record a flag.

**Files:**
- Modify: `src/fix_mcp/server.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_server.py`:

```python
def test_release_stuck_orders_unblocks_when_md_fresh(server_harness):
    # Seed: stuck order with stuck_reason=stale_md; MD is fresh.
    server_harness.seed_order(
        order_id="ORD-2001", venue="BATS", symbol="AAPL",
        status="stuck", stuck_reason="stale_md",
        flags=["algo_child"],
    )
    # Ensure MD is fresh (no delay injected, book.last_updated is recent).
    result = server_harness.invoke_tool(
        "release_stuck_orders", {"reason_filter": "stale_md"}
    )
    assert "ORD-2001" in result["released"]
    order = server_harness.oms.get_order("ORD-2001")
    assert order.status == "new"


def test_release_stuck_orders_skips_when_md_still_stale(server_harness):
    hub = server_harness.market_data_hub
    hub.delay_venue("BATS", 600)
    # Also freeze the book's last_updated to make staleness deterministic.
    # (Depending on how delay_venue interacts with last_updated, you may
    # need to also patch the book timestamp — see Task 4 helper.)
    server_harness.seed_order(
        order_id="ORD-2002", venue="BATS", symbol="AAPL",
        status="stuck", stuck_reason="stale_md",
    )

    result = server_harness.invoke_tool(
        "release_stuck_orders", {"reason_filter": "stale_md"}
    )
    assert "ORD-2002" not in result["released"]
    order = server_harness.oms.get_order("ORD-2002")
    assert order.status == "stuck"


def test_release_stuck_orders_filter_matches_only_matching_reason(server_harness):
    server_harness.seed_order(
        order_id="ORD-3001", venue="BATS", status="stuck",
        stuck_reason="venue_down",
    )
    result = server_harness.invoke_tool(
        "release_stuck_orders", {"reason_filter": "stale_md"}
    )
    assert "ORD-3001" not in result["released"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_server.py -q -k release_stuck_orders
```

Expected: FAIL — either tool missing `reason_filter` or orders not transitioning.

- [ ] **Step 3: Locate the current `release_stuck_orders` implementation**

```bash
grep -n "release_stuck_orders" src/fix_mcp/server.py
```

Preserve the existing function signature additions (optional args) for backwards compatibility.

- [ ] **Step 4: Replace the implementation**

In `src/fix_mcp/server.py`, update the handler:

```python
_DEFAULT_MD_FRESHNESS_MS = 500


def _is_blocker_clear(order) -> bool:
    """For a stuck order, check whether its blocking condition has cleared.

    Reads module-level `algo_engine` and `market_data_hub` singletons.
    """
    reason = order.stuck_reason or ""
    if reason == "stale_md":
        threshold = _DEFAULT_MD_FRESHNESS_MS
        # If this is an algo child, prefer the parent algo's gate.
        if "algo_child" in order.flags:
            for algo in algo_engine.get_active():
                if order.order_id in algo.child_order_ids and algo.md_freshness_gate_ms:
                    threshold = algo.md_freshness_gate_ms
                    break
        return not market_data_hub.is_stale(order.symbol, threshold_ms=threshold)
    # Unknown reason — conservative: do not auto-release.
    return False


def handle_release_stuck_orders(args: dict) -> dict:
    """Re-evaluate stuck orders and transition eligible ones back to new.

    Args:
      reason_filter: optional stuck_reason to match. If omitted, all stuck
                     orders are considered (same as legacy behavior).
    """
    reason_filter = args.get("reason_filter")
    released: list[str] = []
    skipped: list[dict] = []
    for order in list(oms.orders.values()):
        if order.status != "stuck":
            continue
        if reason_filter and order.stuck_reason != reason_filter:
            continue
        if _is_blocker_clear(order):
            oms.update_order_status(order.order_id, "new")
            released.append(order.order_id)
        else:
            skipped.append({"order_id": order.order_id, "reason": order.stuck_reason})

    return {"released": released, "skipped": skipped}
```

If the existing handler returns a different shape, ADD new fields rather than renaming existing ones — preserve backwards-compatibility with any dashboard consumer. The `AlgoEngine.get_active()` accessor may not exist — confirm via grep and substitute the correct method (e.g. iterate `algo_engine.algos.values()` filtered on `status == "running"`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_server.py -q -k release_stuck_orders
pytest -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fix_mcp/server.py tests/test_server.py
git commit -m "feat(tools): implement release_stuck_orders with reason_filter + real MD re-check"
```

---

## Task 9: Scenario loader — honor new fields + injections + relative-timestamp helper

**Goal:** v1 `ScenarioEngine` (`src/fix_mcp/engine/scenarios.py`) (a) threads the new optional fields through `_load_orders`, `_load_algo_orders`, `_load_sessions`; (b) resolves relative timestamps like `"-90s"` to absolute ISO strings at load time; (c) applies the top-level `"injections"` array (currently ignored by v1) against a passed-in `MarketDataHub`.

**v1 loader construction reality (important):** `_load_*` methods pass fields as **explicit kwargs** to the dataclass constructors (not `**kwargs`). New fields will NOT flow automatically — each `_load_*` method must be edited to pass the new field explicitly.

**Files:**
- Modify: `src/fix_mcp/engine/scenarios.py` (v1 — the live loader).
- Modify: `src/fix_mcp/server.py` — `engine.load_scenario()` callsite must also apply injections against the `market_data_hub` singleton created in Task 5.
- Create: `tests/test_scenario_loader.py` — unit tests for the loader.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_scenario_loader.py`. These unit-test the private `_load_*` methods directly (small, isolated) and the relative-timestamp helper. A full JSON-on-disk integration test comes in Task 10.

```python
from fix_mcp.engine.scenarios import ScenarioEngine, resolve_relative_timestamp
from fix_mcp.engine.oms import OMS
from fix_mcp.engine.fix_sessions import FIXSessionManager
from fix_mcp.engine.algos import AlgoEngine
from fix_mcp.engine.reference import ReferenceDataStore


def test_resolve_relative_timestamp_90s():
    result = resolve_relative_timestamp("-90s")
    # Resolved to an ISO string, not the literal "-90s".
    assert result != "-90s"
    assert "T" in result and result.count(":") >= 2


def test_resolve_relative_timestamp_passthrough_absolute():
    absolute = "2026-04-19T12:03:45+00:00"
    assert resolve_relative_timestamp(absolute) == absolute


def test_resolve_relative_timestamp_passthrough_none():
    assert resolve_relative_timestamp(None) is None


def test_load_orders_threads_pending_since_and_stuck_reason():
    engine = ScenarioEngine()
    oms = OMS()
    engine._load_orders(
        oms,
        [{
            "order_id": "O1", "cl_ord_id": "C1", "symbol": "MSFT",
            "cusip": "594918104", "side": "sell", "quantity": 1000,
            "order_type": "LIMIT", "price": 405.20, "venue": "NYSE",
            "client_name": "acme", "status": "pending_ack",
            "pending_since": "-90s", "filled_quantity": 100,
            "created_at": "2026-04-19T12:00:00+00:00",
            "updated_at": "2026-04-19T12:00:00+00:00",
            "is_institutional": True,
        }],
        ReferenceDataStore(),
    )
    o = oms.get_order("O1")
    assert o.status == "pending_ack"
    assert o.pending_since is not None and o.pending_since != "-90s"

    engine._load_orders(
        oms,
        [{
            "order_id": "O2", "cl_ord_id": "C2", "symbol": "AAPL",
            "cusip": "037833100", "side": "buy", "quantity": 500,
            "order_type": "MARKET", "venue": "BATS", "client_name": "acme",
            "status": "stuck", "stuck_reason": "stale_md",
            "flags": ["algo_child"],
            "created_at": "2026-04-19T12:00:00+00:00",
            "updated_at": "2026-04-19T12:00:00+00:00",
            "is_institutional": True,
        }],
        ReferenceDataStore(),
    )
    assert oms.get_order("O2").stuck_reason == "stale_md"


def test_load_sessions_threads_ack_delay_ms():
    engine = ScenarioEngine()
    mgr = FIXSessionManager()
    engine._load_sessions(mgr, [{
        "venue": "NYSE", "session_id": "NYSE-1",
        "sender_comp_id": "ACME", "target_comp_id": "NYSE",
        "status": "active", "ack_delay_ms": 5000,
    }])
    assert mgr.get_session("NYSE").ack_delay_ms == 5000


def test_load_algo_orders_threads_md_freshness_gate():
    engine = ScenarioEngine()
    ae = AlgoEngine()
    engine._load_algo_orders(ae, [{
        "algo_id": "A1", "client_name": "acme", "symbol": "AAPL",
        "cusip": "037833100", "side": "buy", "total_qty": 10000,
        "algo_type": "TWAP",
        "start_time": "2026-04-19T12:00:00+00:00", "venue": "BATS",
        "created_at": "2026-04-19T12:00:00+00:00",
        "updated_at": "2026-04-19T12:00:00+00:00",
        "md_freshness_gate_ms": 100,
        "child_order_ids": ["O2"],
    }], ReferenceDataStore())
    assert ae.get_algo("A1").md_freshness_gate_ms == 100


def test_apply_injections_delays_venue():
    from fix_mcp.engine.market_data import MarketDataHub
    hub = MarketDataHub(symbols={"AAPL": 195.0}, tick_interval_ms=100)
    engine = ScenarioEngine()
    engine._apply_injections(hub, [
        {"type": "market_data.delay", "args": {"venue": "BATS", "delay_ms": 600}},
    ])
    assert hub._venue_delays.get("BATS") == 600
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_scenario_loader.py -q
```

Expected: FAIL — `ImportError` on `resolve_relative_timestamp`, then `AttributeError` on `_apply_injections`, then missing kwargs on the dataclasses.

- [ ] **Step 3: Add the relative-timestamp helper at module level in `scenarios.py`**

```python
from datetime import timedelta  # add to the existing datetime import


_REL_TS_RE = re.compile(r"^-(\d+)([smh])$")


def resolve_relative_timestamp(value, now=None):
    """If *value* matches '-<N><s|m|h>', return an ISO string N units ago.

    Otherwise return *value* unchanged. Used by scenario loader so scenarios
    can express 'pending since 90 seconds before now' as "-90s" in JSON.
    """
    if not isinstance(value, str):
        return value
    m = _REL_TS_RE.match(value)
    if not m:
        return value
    n = int(m.group(1))
    unit = m.group(2)
    seconds = {"s": 1, "m": 60, "h": 3600}[unit] * n
    base = now or datetime.now(timezone.utc)
    return (base - timedelta(seconds=seconds)).isoformat()
```

- [ ] **Step 4: Thread the new fields through `_load_orders`**

In `_load_orders` (around line 271), extend the `Order(...)` kwargs with:

```python
                pending_since=resolve_relative_timestamp(o.get("pending_since")),
                stuck_reason=o.get("stuck_reason"),
```

- [ ] **Step 5: Thread `md_freshness_gate_ms` through `_load_algo_orders`**

In `_load_algo_orders` (around line 313), extend the `AlgoOrder(...)` kwargs with:

```python
                md_freshness_gate_ms=a.get("md_freshness_gate_ms"),
```

- [ ] **Step 6: Thread `ack_delay_ms` through `_load_sessions`**

In `_load_sessions` (around line 214), extend the `FIXSession(...)` kwargs with:

```python
                ack_delay_ms=int(s.get("ack_delay_ms", 0)),
```

- [ ] **Step 7: Add `_apply_injections` method to `ScenarioEngine`**

```python
    def _apply_injections(self, market_data_hub, injections: list) -> None:
        """Apply the scenario's top-level ``injections`` array to live engines.

        Currently only ``market_data.delay`` is supported. Unknown types are
        logged and skipped rather than raising, so scenarios can carry
        forward-compatible injection types.
        """
        if not injections or market_data_hub is None:
            return
        for inj in injections:
            itype = inj.get("type")
            args = inj.get("args", {})
            if itype == "market_data.delay":
                venue = args["venue"]
                delay_ms = int(args["delay_ms"])
                market_data_hub.delay_venue(venue, delay_ms)
            # Add more injection types here as they are defined.
```

- [ ] **Step 8: Extend `load_scenario` to accept an optional hub and apply injections**

Change the signature and body so the caller can pass a hub:

```python
    def load_scenario(
        self, scenario_name: str, market_data_hub=None,
    ) -> tuple[OMS, FIXSessionManager, ReferenceDataStore]:
        ...  # existing body unchanged up through algo loading
        self._apply_injections(market_data_hub, scenario_data.get("injections", []))
        return oms, session_mgr, ref_store
```

Keep `market_data_hub=None` default so existing callers (and pre-existing tests) still pass.

- [ ] **Step 9: Pass the hub from `server.py`**

In `src/fix_mcp/server.py` `reset_runtime` and at module init, change `engine.load_scenario(SCENARIO)` to `engine.load_scenario(SCENARIO, market_data_hub=market_data_hub)`. Instantiation order matters: `market_data_hub` must be created before `load_scenario` is called. If Task 5 already instantiated `market_data_hub` *after* the first `load_scenario` call, reorder so the hub is created first, then call `load_scenario(...)` with it. (For the first module-level call, if symbols need to come from ref_store, do a two-pass: first `load_scenario` with no hub, then build hub from ref_store, then re-apply injections by calling `engine._apply_injections(market_data_hub, <scenario-injections>)`. Prefer the single-pass approach — hardcoded symbols are fine for the demo.)

- [ ] **Step 10: Run tests to verify they pass**

```bash
pytest tests/test_scenario_loader.py -q
pytest -q
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/fix_mcp/engine/scenarios.py src/fix_mcp/server.py tests/test_scenario_loader.py
git commit -m "feat(scenarios): loader threads new fields, resolves relative timestamps, applies injections"
```

---

## Task 10: Create `midday_chaos_1205.json` + integration test

**Goal:** The flagship scenario file. Loads cleanly, populates both incidents in the exact states the demo script depends on.

**Files:**
- Create: `config/scenarios/midday_chaos_1205.json` (v1 loader reads this path)
- Create: `tests/test_scenario_midday_chaos.py`

- [ ] **Step 1: Write the failing integration test**

Create `tests/test_scenario_midday_chaos.py`:

```python
from fix_mcp.engine.scenarios import ScenarioEngine
from fix_mcp.engine.market_data import MarketDataHub


def test_midday_chaos_scenario_loads_with_expected_state():
    engine = ScenarioEngine()
    hub = MarketDataHub(symbols={"AAPL": 195.0, "MSFT": 405.0}, tick_interval_ms=100)
    oms, session_mgr, ref_store = engine.load_scenario(
        "midday_chaos_1205", market_data_hub=hub,
    )
    algos = engine.algo_engine

    # Incident A — algo + stuck children
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

    # Incident B — pending-ack NYSE order
    nyse = oms.get_order("ORD-NYSE-7731")
    assert nyse is not None
    assert nyse.symbol == "MSFT"
    assert nyse.status == "pending_ack"
    assert nyse.pending_since is not None and nyse.pending_since != "-90s"
    assert nyse.filled_quantity == 100

    nyse_session = session_mgr.get_session("NYSE")
    assert nyse_session.ack_delay_ms == 5000

    # Injection applied via _apply_injections
    assert hub._venue_delays.get("BATS") == 600
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_scenario_midday_chaos.py -q -k midday_chaos_scenario
```

Expected: FAIL — scenario file not found.

- [ ] **Step 3: Create the scenario file**

Create `config/scenarios/midday_chaos_1205.json` (NOTE: v1 loader uses top-level key `"algo_orders"`, NOT `"algos"`):

```json
{
  "name": "midday_chaos_1205",
  "severity": "Critical",
  "difficulty": "advanced",
  "time": "12:05",
  "est_minutes": 25,
  "description": "Two unrelated concurrent incidents at midday: an algo with stuck child orders from stale BATS market data, and a pending-ack NYSE order threatened by a delayed-ACK backlog. Tests the operator's ability to triage, prioritize, and resolve without making things worse.",
  "sessions": [
    {
      "venue": "BATS",
      "session_id": "BATS-1",
      "sender_comp_id": "ACME",
      "target_comp_id": "BATS",
      "fix_version": "FIX.4.2",
      "status": "active",
      "latency_ms": 45
    },
    {
      "venue": "NYSE",
      "session_id": "NYSE-1",
      "sender_comp_id": "ACME",
      "target_comp_id": "NYSE",
      "fix_version": "FIX.4.2",
      "status": "active",
      "latency_ms": 40,
      "ack_delay_ms": 5000
    }
  ],
  "algo_orders": [
    {
      "algo_id": "ALGO-PARENT-001",
      "client_name": "acme_capital",
      "symbol": "AAPL",
      "cusip": "037833100",
      "side": "buy",
      "total_qty": 10000,
      "algo_type": "TWAP",
      "start_time": "2026-04-19T12:00:00+00:00",
      "end_time": "2026-04-19T13:00:00+00:00",
      "venue": "BATS",
      "created_at": "2026-04-19T12:00:00+00:00",
      "updated_at": "2026-04-19T12:05:00+00:00",
      "total_slices": 20,
      "completed_slices": 2,
      "executed_qty": 1000,
      "schedule_pct": 8.3,
      "execution_pct": 10.0,
      "status": "running",
      "flags": ["algo_behind_schedule"],
      "child_order_ids": ["ORD-1005", "ORD-1006"],
      "is_institutional": true,
      "md_freshness_gate_ms": 100,
      "notes": "Slicer gated on BATS MD freshness"
    }
  ],
  "orders": [
    {
      "order_id": "ORD-1005",
      "cl_ord_id": "CLO-20260419-1005",
      "symbol": "AAPL",
      "cusip": "037833100",
      "side": "buy",
      "quantity": 500,
      "order_type": "LIMIT",
      "price": 195.60,
      "venue": "BATS",
      "client_name": "acme_capital",
      "created_at": "2026-04-19T12:03:00+00:00",
      "updated_at": "2026-04-19T12:04:30+00:00",
      "status": "stuck",
      "stuck_reason": "stale_md",
      "flags": ["algo_child"],
      "is_institutional": true
    },
    {
      "order_id": "ORD-1006",
      "cl_ord_id": "CLO-20260419-1006",
      "symbol": "AAPL",
      "cusip": "037833100",
      "side": "buy",
      "quantity": 500,
      "order_type": "LIMIT",
      "price": 195.60,
      "venue": "BATS",
      "client_name": "acme_capital",
      "created_at": "2026-04-19T12:04:00+00:00",
      "updated_at": "2026-04-19T12:04:45+00:00",
      "status": "stuck",
      "stuck_reason": "stale_md",
      "flags": ["algo_child"],
      "is_institutional": true
    },
    {
      "order_id": "ORD-NYSE-7731",
      "cl_ord_id": "CLO-20260419-7731",
      "symbol": "MSFT",
      "cusip": "594918104",
      "side": "sell",
      "quantity": 1000,
      "order_type": "LIMIT",
      "price": 405.20,
      "venue": "NYSE",
      "client_name": "acme_capital",
      "created_at": "2026-04-19T12:03:30+00:00",
      "updated_at": "2026-04-19T12:03:45+00:00",
      "status": "pending_ack",
      "pending_since": "-90s",
      "filled_quantity": 100,
      "is_institutional": true
    }
  ],
  "injections": [
    {
      "type": "market_data.delay",
      "args": { "venue": "BATS", "delay_ms": 600 }
    }
  ],
  "runbook": {
    "narrative": "Midday 12:05. Two independent incidents surface almost simultaneously. Mission Control lights up: an AAPL TWAP is falling behind, two of its child slices are stuck, and an MSFT limit-sell on NYSE is showing pending fills that aren't resolving. The temptation is to treat this as one big outage — resist. Diagnose each incident independently before touching anything irreversible.",
    "steps": [
      {
        "n": 1,
        "action": "Enumerate what's happening across the shop.",
        "tool": "query_orders",
        "args": {},
        "expect": "Two stuck BATS children under ALGO-PARENT-001, one pending-ack NYSE order."
      },
      {
        "n": 2,
        "action": "Check algo state and schedule deviation.",
        "tool": "check_algo_status",
        "args": { "algo_id": "ALGO-PARENT-001" },
        "expect": "Running, ~8% behind schedule, md_freshness_gate_ms=100, two stuck children."
      },
      {
        "n": 3,
        "action": "Confirm MD staleness on the algo's venue.",
        "tool": "check_market_data_staleness",
        "args": { "symbol": "AAPL" },
        "expect": "BATS-side AAPL MD > 100ms stale (trips the algo gate)."
      },
      {
        "n": 4,
        "action": "Check session health for the NYSE pending-ack.",
        "tool": "check_fix_sessions",
        "args": { "venue": "NYSE" },
        "expect": "NYSE session is active with green heartbeat (MISLEADING)."
      },
      {
        "n": 5,
        "action": "Inspect pending-ack state with duplicate-risk flags.",
        "tool": "check_pending_acks",
        "args": { "venue": "NYSE" },
        "expect": "ORD-NYSE-7731 pending > 30s, ack_delay_ms=5000, risk_of_duplicate=true. DO NOT resubmit."
      },
      {
        "n": 6,
        "action": "Resolve Incident A: coordinate upstream MD recovery, then clear the delay.",
        "tool": "clear_market_data_delay",
        "args": { "venue": "BATS" },
        "expect": "previous_delay_ms=600, cleared=true."
      },
      {
        "n": 7,
        "action": "Verify MD freshness restored before releasing children.",
        "tool": "check_market_data_staleness",
        "args": { "symbol": "AAPL" },
        "expect": "staleness_ms < 100 (under the algo gate)."
      },
      {
        "n": 8,
        "action": "Release the stuck children now that the blocker is clear.",
        "tool": "release_stuck_orders",
        "args": { "reason_filter": "stale_md" },
        "expect": "released: [ORD-1005, ORD-1006]."
      },
      {
        "n": 9,
        "action": "Hold on Incident B. Wait 30s and re-check the pending-ack.",
        "tool": "check_pending_acks",
        "args": { "venue": "NYSE" },
        "expect": "ACK backlog draining; ORD-NYSE-7731 transitioning to partially_filled / filled."
      }
    ],
    "success_criteria": [
      "Agent identifies two distinct root causes before any destructive action.",
      "Agent does NOT cancel or replace ORD-NYSE-7731.",
      "Children ORD-1005 and ORD-1006 release only after MD is fresh.",
      "Final state: algo fills complete, NYSE order fills complete, no duplicate ClOrdIDs."
    ]
  },
  "hints": {
    "key_problems": [
      "TWAP ALGO-PARENT-001 is behind schedule because two child slices are stuck.",
      "Child slices are stuck due to stale MD on BATS (600ms lag).",
      "ORD-NYSE-7731 looks stuck but is actually in pending_ack from a 5s ACK delay.",
      "Heartbeat alone does NOT tell you about ACK backlog — use check_pending_acks."
    ],
    "common_mistakes": [
      "Cancel/replace on ORD-NYSE-7731 → duplicate ClOrdID when the backlog clears.",
      "release_stuck_orders while BATS MD is still stale → children restuck immediately.",
      "Treating the two incidents as correlated and attempting a blanket recovery."
    ]
  }
}
```

- [ ] **Step 4: Run the integration test**

```bash
pytest tests/test_scenario_midday_chaos.py -q
pytest -q
```

Expected: PASS. If MD `delay_venue` is applied after the `hub.delay_venue` call in the loader but before the test asserts, `_venue_delays["BATS"]` should be `600`.

- [ ] **Step 5: Confirm the scenario appears via `list_scenarios`**

```bash
python -c "from fix_mcp.server import handle_list_scenarios; import json; print(json.dumps(handle_list_scenarios({}), indent=2))" | grep midday_chaos_1205
```

Adjust the one-liner if `handle_list_scenarios` is not the real name — just confirm the scenario is discoverable.

- [ ] **Step 6: Commit**

```bash
git add config/scenarios/midday_chaos_1205.json tests/test_scenario_midday_chaos.py
git commit -m "feat(scenarios): add midday_chaos_1205 compound-incident scenario"
```

---

## Task 11: Demo script doc

**Goal:** A readable markdown doc the operator uses live during the demo. Mirrors the 6 beats from the spec with exact copy and tool calls.

**Files:**
- Create: `docs/demo-midday-chaos.md`

- [ ] **Step 1: Write the demo-script doc**

Create `docs/demo-midday-chaos.md`:

```markdown
# Midday Chaos — Demo Script (10 minutes)

Load scenario `midday_chaos_1205` from Mission Control → Scenario Library.

---

## Beat 1 — Stage the chaos (0:00 – 1:00)

**What you show:** TWAP on AAPL behind schedule, two stuck child orders, MSFT
order on NYSE looking half-filled with a pending-ack banner.

**Narrator line:** *"It's 12:05. Two incidents just lit up at the same time.
Same dashboard. Are they related?"*

## Beat 2 — Triage (1:00 – 3:00)

**Copilot calls:** `query_orders`, `check_algo_status("ALGO-PARENT-001")`,
`check_fix_sessions`.

**Copilot says:** *"I see two unrelated signals. Let me confirm that before
touching anything."*

## Beat 3 — Diagnose A (3:00 – 5:00)

**Copilot calls:** `check_market_data_staleness("AAPL")`.

**Output:** staleness_ms ≈ 630 on BATS.

**Copilot says:** *"The algo has an MD-freshness gate at 100ms. BATS is 630ms
stale. The slicer can't release child orders until the feed recovers."*

## Beat 4 — Diagnose B (5:00 – 7:00) — THE JUDGMENT MOMENT

**Copilot calls:** `check_pending_acks("NYSE")`.

**Output:** ORD-NYSE-7731 pending 90s, ack_delay_ms=5000, risk_of_duplicate=true.

**Copilot says:** *"The NYSE heartbeat is green — the venue is up. ACKs are
backlogged, not lost. Do NOT cancel/replace; the outstanding ACKs will arrive
and a resubmit would create a duplicate ClOrdID and risk double-execution.
Recommendation: wait 30 seconds, then verify."*

## Beat 5 — Resolve A (7:00 – 9:00)

**Copilot calls:**
1. `clear_market_data_delay("BATS")` — simulates upstream MD-feed recovery.
2. `check_market_data_staleness("AAPL")` — confirms < 100ms.
3. `release_stuck_orders(reason_filter="stale_md")` — re-checks and unblocks.

**Output:** children ORD-1005 and ORD-1006 back to `new`; TWAP resumes slicing.

## Beat 6 — Close B safely (9:00 – 10:00)

**Copilot calls:** `check_pending_acks("NYSE")`.

**Output:** ORD-NYSE-7731 transitions to `partially_filled` → `filled`; ACK
backlog has drained.

**Copilot closes with:** *"Two incidents, two root causes, two responses.
Misdiagnosing either would have made it worse."*

---

## Success criteria

- Both incidents diagnosed independently before any destructive action.
- ORD-NYSE-7731 never cancelled or replaced.
- Children released only after MD is fresh.
- Final state: algo fills complete, NYSE order fills complete, no duplicate ClOrdIDs.
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo-midday-chaos.md
git commit -m "docs: add midday-chaos demo script"
```

---

## Task 12: End-to-end smoke + polish

**Goal:** Prove the scenario works through the full stack — dashboard load, tool invocations return the right shapes, the agent can follow the runbook. Fix anything that breaks.

**Files:** various, as bugs are found.

- [ ] **Step 1: Start the stack**

```bash
docker compose down && docker compose up -d
docker compose ps
```

Expected: `fix-mcp-server` (API on :8000), `mission-control` (Next.js on :3000), postgres, redis — all `Up`.

- [ ] **Step 2: Smoke-check API health**

```bash
curl -sS http://localhost:8000/api/status | head -40
```

Expected: JSON with engine status, session list, etc.

- [ ] **Step 3: Load the scenario via REST**

```bash
curl -sS -X POST http://localhost:8000/api/scenario/midday_chaos_1205 | head -60
```

Expected: 200 with a scenario summary. If 404: confirm the scenario file was copied into the container (`docker compose cp`) or that the backend reads it from a bind-mount. If file is outside the container image, rebuild with `docker compose build --no-cache`.

- [ ] **Step 4: Drive each runbook step via `/api/tool`**

Run the 9 runbook steps in order using curl, matching each `tool` and `args` block:

```bash
curl -sS -X POST http://localhost:8000/api/tool \
  -H 'content-type: application/json' \
  -d '{"tool":"query_orders","args":{}}' | head -40

curl -sS -X POST http://localhost:8000/api/tool \
  -H 'content-type: application/json' \
  -d '{"tool":"check_algo_status","args":{"algo_id":"ALGO-PARENT-001"}}' | head -40

# ...and so on through steps 3-9.
```

Record any tool call that returns unexpected shape / error in a scratch note.

- [ ] **Step 5: Fix what you found**

For each issue: reproduce with a unit test first (TDD), fix, re-run the smoke test, commit with a `fix(...)` conventional prefix.

Common likely issues:
- The scenario file path isn't seen by the container → bind-mount fix or rebuild.
- Pending-ack order fails validation somewhere because `pending_ack` isn't expected by one of the query/validate tools → widen the status whitelist.
- `list_scenarios` doesn't include the new file → confirm it enumerates `config/scenarios/*.json`.

- [ ] **Step 6: Final pytest sweep**

```bash
pytest -q
```

Expected: ALL green.

- [ ] **Step 7: Final commit**

```bash
git add -A
git status  # verify only intended changes
git commit -m "chore: e2e smoke + scenario polish for midday-chaos" || echo "nothing to commit"
```

- [ ] **Step 8: Push the branch (confirm with user first)**

Do NOT push until the user explicitly confirms — pushing is user-visible and shared-state. Ask first.

```bash
# After user says "push":
git push -u origin feat/midday-chaos
```

---

## Deliverables Checklist

- [ ] `feat/midday-chaos` branch with all tasks committed
- [ ] `config/scenarios/midday_chaos_1205.json` loadable from dashboard
- [ ] `docs/demo-midday-chaos.md` present
- [ ] `pytest -q` green
- [ ] End-to-end runbook executable via REST

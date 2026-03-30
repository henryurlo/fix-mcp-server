# Algo Suite

The algo suite supports six algorithmic execution strategies. Each parent `AlgoOrder` tracks execution progress and quality metrics. Child slice orders live in the OMS and carry the `algo_child` flag.

## Algo Types

### TWAP — Time-Weighted Average Price

Executes shares evenly across a fixed time window.

- **Schedule tracking:** `schedule_pct` = elapsed time / window duration × 100; `execution_pct` = executed_qty / total_qty × 100
- **Problem indicator:** `algo_behind_schedule` when execution_pct < schedule_pct by >5 ppts
- **Typical fix:** increase slice frequency or reroute to a higher-liquidity venue
- **Parameters:** `end_time` (execution window end), `slice_count`

### VWAP — Volume-Weighted Average Price

Tracks market volume profile throughout the day; executes in proportion to historical volume curves.

- **Quality metric:** `benchmark_px` = VWAP reference price; compares avg_px vs benchmark
- **Problem indicator:** `over_participation` when algo consumes more market volume than `pov_rate` cap
- **Typical fix:** `modify_algo(action=update_pov_rate, new_pov_rate=X)` to reduce participation
- **Parameters:** `pov_rate` (volume cap), optional `end_time`

### POV — Participation of Volume

Maintains a fixed percentage of market volume continuously.

- **Quality metric:** actual participation rate vs `pov_rate` target
- **Problem indicator:** `over_participation` when volume spikes cause the algo to exceed its cap
- **Typical fix:** reduce `pov_rate` via `modify_algo`; pause if market is too thin
- **Parameters:** `pov_rate` (required for POV)

### IS — Implementation Shortfall

Minimizes slippage relative to the mid-price at algo submission (arrival price). Aggressive early, slowing as the stock moves against the algo.

- **Quality metric:** `shortfall_bps` = (avg_px - arrival_px) / arrival_px × 10000 (buy side)
- **Problem indicator:** `high_is_shortfall` when shortfall_bps > 30 bps by default
- **Typical fix:** pause if shortfall is accelerating; review spread and market conditions; consult client if > 50 bps
- **Parameters:** `arrival_px` (required for IS shortfall calculation)

### DARK_AGG — Dark Aggregator

Routes to dark pools (Liquidnet, IEX D-Limit, internal crossing) to minimize market impact for large blocks.

- **Quality metric:** dark fill rate (percentage of executed_qty filled via dark venues)
- **Problem indicator:** `no_dark_fill` when dark venues reject all orders; `venue_fallback` when routing to lit venues
- **Typical fix:** switch from dark to lit if dark fill rate < 20% for 30 minutes
- **Parameters:** no special parameters; venue selection is automatic

### ICEBERG

Shows only a fraction of total order size (the "display qty") to avoid signaling. Manages a reserve quantity behind the scenes.

- **Quality metric:** fill rate of displayed slices vs total
- **Problem indicator:** `algo_behind_schedule` when reserve replenishment stalls
- **Typical fix:** verify that child slices are being acked; check venue for display-qty minimum requirements
- **Parameters:** `slice_count` controls how many display-qty slices to maintain

---

## AlgoOrder Data Model

```python
@dataclass
class AlgoOrder:
    algo_id: str          # e.g. "ALGO-20260328-001"
    client_name: str      # must match clients.json
    symbol: str           # exchange symbol
    cusip: str            # CUSIP identifier
    side: str             # "buy" or "sell"
    total_qty: int        # total shares for the entire algo
    algo_type: str        # TWAP | VWAP | POV | IS | DARK_AGG | ICEBERG
    start_time: str       # ISO-8601 when algo began
    venue: str            # primary execution venue
    created_at: str       # ISO-8601 creation timestamp
    updated_at: str       # ISO-8601 last-modified timestamp
    end_time: str | None  # end of execution window (TWAP/VWAP)
    pov_rate: float | None      # 0.0–1.0 (POV/VWAP participation cap)
    total_slices: int     # number of child order slices planned
    completed_slices: int # slices with confirmed execution reports
    executed_qty: int     # cumulative shares filled
    avg_px: float | None  # volume-weighted average execution price
    arrival_px: float | None  # mid-price at algo start (IS benchmark)
    benchmark_px: float | None  # VWAP/TWAP reference price
    schedule_pct: float   # percentage of time window elapsed (0–100)
    execution_pct: float  # percentage of total_qty executed (0–100)
    status: str           # running | paused | halted | completed | canceled | stuck
    flags: list[str]      # problem flags
    child_order_ids: list[str]  # OMS order IDs of child slices
    is_institutional: bool
    sla_minutes: int | None
    notes: str            # operator notes
```

**Computed properties:**
- `schedule_deviation_pct` — `execution_pct - schedule_pct` (negative = behind)
- `shortfall_bps` — IS shortfall in basis points vs `arrival_px`
- `remaining_qty` — `total_qty - executed_qty`
- `notional_value` — `remaining_qty × avg_px` (or `arrival_px` if no fills yet)

---

## Algo Status Values

| Status | Meaning |
|---|---|
| `running` | Algo is active, slices being submitted |
| `paused` | Operator-paused via `modify_algo`; no new slices sent |
| `halted` | Exchange halt (LULD/SSR) triggered mid-execution |
| `stuck` | Slices are failing or unacknowledged; not progressing |
| `completed` | All shares executed; algo closed |
| `canceled` | Operator-canceled; all open child slices sent cancel |

---

## Problem Flags

| Flag | Algo Types | Description |
|---|---|---|
| `algo_behind_schedule` | TWAP, VWAP, IS | execution_pct < schedule_pct by >5 ppts |
| `algo_ahead_schedule` | TWAP, VWAP | Executing faster than the time window |
| `over_participation` | VWAP, POV | Market volume participation exceeds pov_rate cap |
| `slice_rejected` | All | One or more child slices rejected by venue |
| `halt_mid_algo` | All | LULD circuit breaker or SSR triggered during execution |
| `high_is_shortfall` | IS | shortfall_bps exceeds threshold (default 30 bps) |
| `spread_widened` | IS, DARK_AGG | Bid-ask spread has expanded, increasing execution cost |
| `venue_fallback` | DARK_AGG | Dark pool rejected; routing to lit venue |
| `no_dark_fill` | DARK_AGG | All dark venues returning zero fills |
| `unconfirmed_fills` | All | Child fills sent but execution reports not received |
| `algo_child` | n/a | Applied to child orders in OMS (not parent algos) |

---

## Execution Quality Thresholds

These are defaults. Always check the client execution agreement for client-specific limits.

| Metric | Warning | Pause / Escalate |
|---|---|---|
| TWAP/VWAP behind schedule | >10 ppts | >20 ppts |
| IS shortfall | >30 bps | >50 bps — consult client |
| POV over-participation | >2× target for 3 slices | Reduce pov_rate immediately |
| Dark fill rate | <20% after 30 min | Consider lit fallback |

---

## Algo Scenarios

See [scenarios.md](scenarios.md) for full details. Summary:

| Scenario | Time | Algo Problem |
|---|---|---|
| `twap_slippage_1000` | 10:05 ET | NVDA TWAP 5.2 ppts behind schedule; GME halted mid-algo |
| `vwap_vol_spike_1130` | 11:35 ET | MSFT VWAP over-participating at 15% vs 10% cap; AMD POV market impact |
| `is_dark_failure_1415` | 14:15 ET | TSLA IS 108 bps shortfall; AMZN dark aggregator zero fills |

---

## Adding an Algo to a Scenario

Algo orders in scenario JSON have the same structure as `AlgoOrder` fields:

```json
{
  "algo_id": "ALGO-20260328-001",
  "client_name": "Maple Capital",
  "symbol": "NVDA",
  "cusip": "67066G104",
  "side": "buy",
  "total_qty": 500000,
  "algo_type": "TWAP",
  "start_time": "2026-03-28T09:35:00",
  "end_time": "2026-03-28T11:35:00",
  "venue": "NYSE",
  "executed_qty": 120000,
  "avg_px": 875.40,
  "arrival_px": 875.00,
  "schedule_pct": 29.2,
  "execution_pct": 24.0,
  "status": "stuck",
  "flags": ["algo_behind_schedule", "slice_rejected"],
  "child_order_ids": ["ORD-20260328-1001", "ORD-20260328-1002"],
  "total_slices": 12,
  "completed_slices": 3,
  "is_institutional": true,
  "sla_minutes": 120,
  "notes": "BATS degradation blocking slices since 09:52",
  "created_at": "2026-03-28T09:35:00",
  "updated_at": "2026-03-28T10:05:00"
}
```

Child orders must also be included in the scenario's `orders` array with `"algo_child"` in their `flags`.

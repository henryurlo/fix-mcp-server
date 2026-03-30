# Trading Scenarios

All 13 scenarios cover a complete simulated trading day from 02:05 ET to 16:32 ET plus three algo-specific scenarios that can occur during market hours.

Load any scenario at runtime:

```
call_tool("list_scenarios", {"action": "load", "scenario_name": "morning_triage"})
```

---

## Regular Scenarios (10)

### `morning_triage`
**Time:** 06:15 ET
**Primary problems:**
- ARCA FIX session is down (Saturday maintenance failover)
- 12 orders stuck including 3 institutional with SLA timers running
- BATS sequence number gap (last_recv_seq vs expected_recv_seq mismatch)
- 23 orders on `ACME` symbol affected by ticker rename ACME→ACMX effective today
- 2 orders on `ZEPH` pending — IPO symbol not yet loaded in reference store

**Sessions:** NYSE active, ARCA down, BATS seq gap, IEX active
**Key flags:** `venue_down` (ARCA orders), `stale_ticker` (ACME orders), `symbol_unknown` (ZEPH orders)
**Clients involved:** Maple Capital (SLA critical), Rowan Partners, Birch Funds

---

### `bats_startup_0200`
**Time:** 02:05 ET
**Primary problems:**
- BATS SequenceReset (35=4) received with NewSeqNo=1 but expected NewSeqNo=2450
- Exchange reset its sequence to 1 during maintenance window; our engine has not accepted it
- Risk of duplicate order processing if gap is not acknowledged correctly

**Sessions:** NYSE logged_out (pre-market), BATS seq_reset_pending, IEX active
**Key flags:** `seq_gap`, `resend_required`

---

### `predawn_adrs_0430`
**Time:** 04:35 ET
**Primary problems:**
- Shell ADR rebrand: RDSA symbol renamed to SHEL effective today
- 8 open orders on RDSA must be updated before the 09:30 open
- ARCA latency elevated to 220ms (normal: <5ms); orders routing there at risk

**Sessions:** NYSE active, ARCA degraded (220ms), BATS active
**Key flags:** `stale_ticker` (RDSA orders), `venue_degraded` (ARCA)

---

### `preopen_auction_0900`
**Time:** 09:02 ET
**Primary problems:**
- MOO (Market-on-Open) imbalance on SPY: 4.2M shares buy-side unmatched
- IEX feed is stale — last quote timestamp 4 minutes ago
- 6 limit orders priced against stale IEX quotes; need repricing before 09:30

**Sessions:** NYSE active, BATS active, IEX degraded (stale feed)
**Key flags:** `stale_quote`, `imbalance_risk`

---

### `open_volatility_0930`
**Time:** 09:35 ET
**Primary problems:**
- GME triggered LULD (Limit Up-Limit Down) circuit breaker at 09:33
- GME is halted; 5 open orders are blocked
- BATS reporting elevated packet loss (3.2%); fills may be delayed

**Sessions:** NYSE active, BATS degraded (packet loss), IEX active
**Key flags:** `halt_pending` (GME orders), `venue_degraded` (BATS)

---

### `venue_degradation_1030`
**Time:** 10:32 ET
**Primary problems:**
- NYSE latency spiking at 180ms (normal: 2–4ms) due to Mahwah co-location route flap
- 14 orders on NYSE experiencing delayed ExecutionReports
- Smart order router attempting to reroute some flow to BATS but BATS has its own degraded state

**Sessions:** NYSE degraded (180ms), BATS degraded, ARCA active, IEX active
**Key flags:** `venue_degraded` (NYSE orders), `unconfirmed_fills`

---

### `ssr_and_split_1130`
**Time:** 11:34 ET
**Primary problems:**
- RIDE (Lordstown Motors) triggered SSR (Short Sale Restriction) — short sell orders must be at or above the NBBO
- AAPL 4-for-1 split effective in 26 minutes; all limit sell orders need price adjustment
- 7 stop orders on AAPL priced in pre-split terms will become nonsensical after split

**Sessions:** NYSE active, BATS active, IEX active
**Key flags:** `ssr_restricted` (RIDE short orders), `split_pending` (AAPL orders)

---

### `iex_recovery_1400`
**Time:** 14:03 ET
**Primary problems:**
- IEX session has just recovered from a 47-minute outage
- D-Limit orders that were rejected during outage need to be re-routed
- 9 orders queued for IEX during the outage need status reconciliation

**Sessions:** NYSE active, BATS active, IEX recovered (logged_in, reconnecting)
**Key flags:** `venue_down` (IEX orders from outage window), `requeue_needed`

---

### `eod_moc_1530`
**Time:** 15:31 ET
**Primary problems:**
- NYSE MOC cutoff is 15:45; 3 market-on-close orders submitted after the 15:50 published cutoff
- GTC (Good-Till-Canceled) orders need to be flagged for preservation before EOD purge at 16:00
- 2 institutional clients have unconfirmed end-of-day positions

**Sessions:** NYSE active, BATS active, IEX active
**Key flags:** `moc_late`, `gtc_purge_risk`, `unconfirmed_fills`

---

### `afterhours_dark_1630`
**Time:** 16:32 ET
**Primary problems:**
- Liquidnet dark pool sent SessionStatus=8 (Logout) at 16:29
- 6 large block orders routed to Liquidnet are now orphaned — no acknowledgment
- Dark pool connectivity may not recover until 07:00 ET next day

**Sessions:** NYSE logged_out (market closed), BATS logged_out, Liquidnet down (SessionStatus=8)
**Key flags:** `venue_down` (Liquidnet orders), `block_orphaned`

---

## Algo Scenarios (3)

### `twap_slippage_1000`
**Time:** 10:05 ET
**Algo orders:** 2 parent algos, 10 child slice orders

| Algo ID | Symbol | Type | Total Qty | Executed | Schedule% | Execution% | Status |
|---|---|---|---|---|---|---|---|
| ALGO-20260328-001 | NVDA | TWAP | 500,000 | 120,000 | 29.2% | 24.0% | stuck |
| ALGO-20260328-002 | GME | TWAP | 50,000 | 8,200 | 40.0% | 16.4% | halted |

**Problems:**
- NVDA TWAP is 5.2% behind schedule (schedule 29.2%, execution 24.0%); `algo_behind_schedule`, `slice_rejected`
- GME TWAP halted mid-execution due to LULD circuit breaker; `halt_mid_algo`
- 3 child slices for NVDA were rejected by ARCA during a momentary session issue
- Recommended: pause NVDA TWAP, increase slice frequency; wait for GME halt to clear

---

### `vwap_vol_spike_1130`
**Time:** 11:35 ET
**Algo orders:** 2 parent algos, 8 child slice orders

| Algo ID | Symbol | Type | Total Qty | Executed | POV Rate | Status |
|---|---|---|---|---|---|---|
| ALGO-20260328-003 | MSFT | VWAP | 200,000 | 98,000 | 0.12 | running |
| ALGO-20260328-004 | AMD | POV | 150,000 | 72,000 | 0.15 | running |

**Problems:**
- MSFT VWAP is over-participating: market volume spiked, algo is consuming 18% of market (limit is 12%); `over_participation`, `spread_widened`
- AMD POV rate of 15% is creating market impact; best execution requires reducing to 8–10%; `over_participation`
- Recommended: reduce MSFT VWAP participation cap; `modify_algo` AMD POV rate to 0.08

---

### `is_dark_failure_1415`
**Time:** 14:15 ET
**Algo orders:** 2 parent algos, 8 child slice orders

| Algo ID | Symbol | Type | Total Qty | Executed | Arrival Px | Avg Px | Status |
|---|---|---|---|---|---|---|---|
| ALGO-20260328-005 | TSLA | IS | 300,000 | 85,000 | 248.50 | 251.20 | running |
| ALGO-20260328-006 | AMZN | DARK_AGG | 80,000 | 12,000 | 184.20 | — | stuck |

**Problems:**
- TSLA IS shortfall of 108 bps (avg execution 251.20 vs arrival 248.50); `high_is_shortfall`
- AMZN dark aggregator routed to Liquidnet + IEX D-Limit but received zero dark fills; `no_dark_fill`, `venue_fallback`
- Dark venues appear illiquid for AMZN at current size; recommend switching to lit venue
- Recommended: cancel AMZN dark algo, re-submit as TWAP; investigate TSLA IS slippage

---

## Scenario JSON Format

```json
{
  "name": "scenario_name",
  "description": "Human-readable description of the scenario context",
  "simulated_time": "2026-03-28T10:05:00",
  "sessions": [
    {
      "venue": "NYSE",
      "session_id": "NYSE-PROD-01",
      "sender_comp_id": "FIRM_PROD",
      "target_comp_id": "NYSE_GW",
      "fix_version": "FIX.4.2",
      "status": "active",
      "last_sent_seq": 12450,
      "last_recv_seq": 12450,
      "expected_recv_seq": 12450,
      "last_heartbeat": "2026-03-28T06:14:58",
      "latency_ms": 3,
      "host": "nyse-gateway.prod.internal",
      "port": 4001,
      "error": null,
      "connected_since": "2026-03-28T04:00:01"
    }
  ],
  "orders": [
    {
      "order_id": "ORD-20260328-001",
      "cl_ord_id": "CLO-20260328-001",
      "symbol": "AAPL",
      "cusip": "037833100",
      "side": "buy",
      "quantity": 5000,
      "filled_quantity": 0,
      "order_type": "limit",
      "price": 214.50,
      "venue": "NYSE",
      "client_name": "Maple Capital",
      "status": "new",
      "is_institutional": true,
      "sla_minutes": 15,
      "flags": [],
      "fix_messages": [],
      "created_at": "2026-03-28T06:10:00",
      "updated_at": "2026-03-28T06:10:00"
    }
  ],
  "algo_orders": [...],
  "corporate_actions": [...],
  "symbols": [...]
}
```

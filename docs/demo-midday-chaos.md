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

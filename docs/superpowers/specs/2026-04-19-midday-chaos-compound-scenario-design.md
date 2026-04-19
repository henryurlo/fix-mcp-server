# Midday Chaos — Compound Scenario Design

**Date:** 2026-04-19
**Owner:** Henry Urlo
**Target audience for demo:** Consulting prospects evaluating capability.
**Time budget:** 4 hours.
**Positioning:** Flagship scenario for a FIX-MCP simulator used to train broker-dealer ops staff on compound-incident triage.

---

## 1. Goal

Produce one end-to-end demo scenario — `midday_chaos_1205` — that showcases an AI copilot handling **two unrelated concurrent incidents** where the tempting wrong moves would make things worse. The scenario must survive stare-testing by an experienced FIX engineer on the demo path (not repo-wide).

The "wow moment" is the copilot recommending **inaction** on one of the two incidents, with a FIX-protocol-grounded justification (ACK backlog → duplicate ClOrdID risk on resubmit).

## 2. Non-Goals

Explicitly out of scope for this session:

- Real algo slicer rewrite. The MD-freshness gate is checked; slicer internals stay as-is.
- Real market-data feed. `MarketDataHub` remains fixture-driven.
- Frontend work beyond what already renders the new fields in existing panels and terminal output.
- New asset classes (options / futures / FX). Equities only.
- New scenarios beyond `midday_chaos_1205`.
- Auth, billing, multi-tenancy, productization.
- Changes to existing 13 scenarios. All additions are optional fields with backwards-compatible defaults.

## 3. Scenario Narrative

**Setup (T+0):** Midday. Two unrelated incidents hit in quick succession. Ops engineer sees "everything is broken" on Mission Control.

### Incident A — Algo parent with stuck child orders (BATS)

- `ALGO-PARENT-001`: TWAP on `AAPL`, 10 000 shares, routing BATS.
- Child slices `ORD-1005`, `ORD-1006` are `stuck` with `stuck_reason="stale_md"`.
- Root cause: BATS MD feed is lagging 600 ms (injected). Algo's `md_freshness_gate_ms=100` trips, blocking further child release.
- Parent shows `schedule_pct` falling behind (`algo_behind_schedule`).

### Incident B — Delayed ACKs on unrelated NYSE order

- `ORD-NYSE-7731`: plain limit SELL 1 000 `MSFT` @ 405.20 on NYSE.
- Shows `pending_ack`, `pending_since` = 90 s ago, `filled_qty=100` (partials received before delay started).
- Root cause: NYSE session has `ack_delay_ms=5000` injected. NewOrderSingle ACKs and ExecutionReports are lagging. Session heartbeat is still green — misleading.
- **Operator trap:** cancel/replace or resubmit looks natural, but backlogged ACKs will land and a resubmit creates a duplicate `ClOrdID` → double-execution risk.

### Agent-must-demonstrate

1. Distinguish the two incidents — they *look* correlated, they are not.
2. Diagnose A via the MD-staleness tool, not by staring at the algo.
3. Diagnose B by correlating `pending_since` + session `ack_delay_ms` — not heartbeat alone.
4. Resolve A: restore MD freshness (scenario self-clears or agent calls a recovery path), then `release_stuck_orders(reason_filter="stale_md")`.
5. Resolve B: **wait**, verify ACK drain, do not resubmit. Explain in FIX terms.

## 4. Architecture Changes

All changes are additive. No refactors.

### 4.1 State-model extensions

**`Order` (`src/fix_mcp/engine/oms.py`):**
- `status` — add `pending_ack` alongside existing states.
- `pending_since: datetime | None` — set on entry to `pending_ack`.
- `stuck_reason: str | None` — e.g. `"stale_md"`, `"venue_down"`, `"risk_halt"`.

**`AlgoOrder` (`src/fix_mcp/engine/algos.py`):**
- `md_freshness_gate_ms: int | None` — if set, slicer blocks child release while any MD for the algo's symbol is older than the threshold. Default `None` = no gate (backwards-compatible).

**`FIXSession` (`src/fix_mcp/engine/fix_sessions.py`):**
- `ack_delay_ms: int = 0` — injected ACK latency. Honored by the exchange simulator when emitting ExecutionReports.

**`MarketDataHub` (`src/fix_mcp/engine/market_data.py`):**
- `staleness_ms(symbol: str) -> int` — age of the latest quote for that symbol in ms.
- `is_stale(symbol: str, threshold_ms: int) -> bool`.

### 4.2 MCP tool surface

**New tools (3):**

| Tool | Args | Returns |
|---|---|---|
| `check_market_data_staleness` | `symbol?: str` | Per-symbol `{symbol, last_quote_ts, staleness_ms, stale: bool}`. Omitting `symbol` returns all tracked symbols. |
| `check_pending_acks` | `venue?: str` | Orders in `pending_ack`, each with `pending_since` age (s), session `ack_delay_ms`, and `risk_of_duplicate: bool` (true when `pending_since > 30s`). |
| `clear_market_data_delay` | `venue: str` | Clears any injected `market_data.delay` on the named venue, restoring MD freshness. Returns `{venue, cleared: bool, previous_delay_ms}`. Used by the agent as the "upstream fix" step in Incident A resolution. |

**Extended tool (1):**

| Tool | Change |
|---|---|
| `release_stuck_orders` | Accept `reason_filter?: str`. For orders with `status="stuck"` and matching `stuck_reason`, re-check the blocking condition (e.g. MD freshness). If clear, transition back to `new` and re-submit through the existing path. Return shape unchanged; adds a `released: [order_ids]` field. |

**Unchanged:** the other 21 tools. Total surface becomes 25.

### 4.3 Scenario injection hooks

No new hooks. The new state fields (`ack_delay_ms` on session, `md_freshness_gate_ms` on algo, `stuck_reason` / `pending_since` on order) are set **declaratively** in the scenario JSON at load time — the existing scenario loader already populates session / algo / order objects from their JSON blocks. We just need the loader to honor the new optional fields (trivial; field-forwarding).

Existing injection hooks (`market_data.delay`, `market_data.disconnect`, `market_data.fx_corruption`) are reused unchanged.

### 4.4 Scenario JSON

New file `config/scenarios_v2/midday_chaos_1205.json`:

```json
{
  "name": "midday_chaos_1205",
  "severity": "Critical",
  "difficulty": "advanced",
  "time": "12:05",
  "est_minutes": 25,
  "sessions": [
    { "venue": "BATS", "status": "active", "latency_ms": 45 },
    { "venue": "NYSE", "status": "active", "latency_ms": 40, "ack_delay_ms": 5000 }
  ],
  "algos": [
    { "id": "ALGO-PARENT-001", "type": "TWAP", "symbol": "AAPL", "qty": 10000,
      "venue": "BATS", "status": "running",
      "flags": ["algo_behind_schedule"],
      "md_freshness_gate_ms": 100,
      "child_order_ids": ["ORD-1005", "ORD-1006"] }
  ],
  "orders": [
    { "id": "ORD-1005", "symbol": "AAPL", "side": "BUY", "qty": 500,
      "venue": "BATS", "status": "stuck", "stuck_reason": "stale_md",
      "algo_child": true, "parent_id": "ALGO-PARENT-001" },
    { "id": "ORD-1006", "symbol": "AAPL", "side": "BUY", "qty": 500,
      "venue": "BATS", "status": "stuck", "stuck_reason": "stale_md",
      "algo_child": true, "parent_id": "ALGO-PARENT-001" },
    { "id": "ORD-NYSE-7731", "symbol": "MSFT", "side": "SELL", "qty": 1000,
      "order_type": "LIMIT", "price": 405.20, "venue": "NYSE",
      "status": "pending_ack", "pending_since": "-90s", "filled_qty": 100 }
  ],
  "injections": [
    { "type": "market_data.delay", "args": { "venue": "BATS", "delay_ms": 600 } }
  ],
  "runbook": { /* narrative + steps + success_criteria populated from Section 5 */ },
  "hints":   { /* key_problems + common_mistakes populated from Section 5 */ }
}
```

The NYSE `ack_delay_ms: 5000` is carried on the session definition directly (declarative state); no injection needed. Same for the algo's `md_freshness_gate_ms: 100`. Relative timestamps like `"-90s"` are resolved at scenario-load via a tiny helper in the loader.

## 5. Demo Script — 10 minutes, 6 beats

1. **0:00-1:00 — Stage the chaos.** Operator loads `midday_chaos_1205`. Dashboard immediately shows TWAP behind schedule, two stuck children, and an MSFT order looking half-filled on NYSE.
2. **1:00-3:00 — Agent triages.** `query_orders`, `check_algo_status("ALGO-PARENT-001")`, `check_fix_sessions`. Agent states: *"I see two unrelated signals. Let me confirm before touching anything."*
3. **3:00-5:00 — Diagnose A.** `check_market_data_staleness("AAPL")` → 630 ms stale on BATS. Agent correlates with the algo's 100 ms freshness gate. Clean causal chain.
4. **5:00-7:00 — Diagnose B (judgment moment).** `check_pending_acks("NYSE")` → `ORD-NYSE-7731` pending 90 s, `ack_delay_ms=5000`, `risk_of_duplicate=true`. Agent: *"Heartbeat is green, venue is up. ACKs are backlogged, not lost. Do NOT cancel/replace; a resubmit would create a duplicate ClOrdID and risk double-execution. Recommendation: wait 30 s, then verify."* **Consulting-sell moment.**
5. **7:00-9:00 — Resolve A.** Agent calls `clear_market_data_delay("BATS")` (simulating an upstream MD-feed recovery coordinated via the ops desk), confirms freshness via `check_market_data_staleness("AAPL")`, then `release_stuck_orders(reason_filter="stale_md")`. Children resubmit. TWAP catches up.
6. **9:00-10:00 — Close B safely.** ACK backlog drains. `ORD-NYSE-7731` → `partially_filled` → `filled`. Agent closes: *"Two incidents, two root causes, two responses. Misdiagnosing either would have made it worse."*

**Success criteria (baked into the runbook):**
- Agent identifies two distinct root causes before any destructive action.
- Agent does NOT cancel/replace `ORD-NYSE-7731`.
- Children release only after MD is fresh.
- Final state: algo fills complete, NYSE order fills complete, no duplicates.

Demo script is persisted to `docs/demo-midday-chaos.md`.

## 6. Testing

**Unit tests (must-have):**
- `tests/test_oms.py` — `pending_ack` transitions, `pending_since` timeout computation, `stuck_reason` round-trip.
- `tests/test_fix_sessions.py` — `ack_delay_ms` persisted; injection sets it correctly.
- new `tests/test_market_data.py` — `staleness_ms` and `is_stale` against a fixed clock.

**Tool tests (must-have):**
- `tests/test_server.py` — `check_market_data_staleness`, `check_pending_acks`, extended `release_stuck_orders`. Assert tool response shapes.

**Scenario integration test (must-have):**
- Load `midday_chaos_1205.json`, assert the two incidents land in the exact states the demo script depends on. This is the "demo won't embarrass us" guardrail.

**Skipped (for 4h scope):**
- Frontend / Next.js tests.
- Regression sweep on the other 13 scenarios — manual smoke only.

TDD applies to engine extensions and new tools. Not to the scenario JSON or the demo-script doc.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `release_stuck_orders` stub may be consumed elsewhere (dashboard, other tools). | Preserve function signature + return shape; change internals only. |
| `scenario_engine_v2` may not be the live-wired loader; v1 might still load scenarios by default. | Block 0:00-0:30 confirms which engine is wired before touching anything. If v1, decide in-session: adopt v2 for this scenario only, or port hooks to v1. |
| `AGENTS.md` flags Next.js has breaking changes vs training data. | Stay backend-only. If drift into frontend, stop and read `node_modules/next/dist/docs/` first. |
| 4 h slips. | Deliverables 1-3 (state model, tools, scenario JSON) are the critical path. Demo-script polish (block 3:45-4:00) is the first thing cut. |

## 8. Time Budget

| Block | Min | What |
|---|---|---|
| 0:00-0:30 | 30 | Docker compose up, smoke-test current state, confirm scenario engine v1 vs v2 is live-wired |
| 0:30-1:15 | 45 | OMS + AlgoOrder + FIXSession + MarketDataHub field additions with unit tests (TDD) |
| 1:15-2:15 | 60 | Three new tools + `release_stuck_orders` real impl with tool tests (TDD) |
| 2:15-2:30 | 15 | Scenario-loader: honor new optional fields + relative-timestamp helper |
| 2:30-3:15 | 45 | Write `midday_chaos_1205.json` + runbook + scenario integration test |
| 3:15-3:45 | 30 | End-to-end demo run from dashboard → copilot → tools. Fix what breaks. |
| 3:45-4:00 | 15 | Polish `docs/demo-midday-chaos.md` |

## 9. Deliverables

1. PR-ready changes on a branch in `~/fix-mcp-server/`.
2. `config/scenarios_v2/midday_chaos_1205.json` playable from the dashboard.
3. `docs/demo-midday-chaos.md` co-located with the scenario.
4. Green tests.

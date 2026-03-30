# Role Prompts

Six role-specific system prompts are exposed via the MCP Prompts API. Each prompt scopes the AI to a specific operational domain, assigns it a tool subset, and defines escalation paths to other roles.

## Accessing Prompts

Via MCP Prompts API:
```
list_prompts()        → returns all 6 prompt names and descriptions
get_prompt("trading-ops") → returns the full system prompt text
```

Via MCP resource (trading-ops only):
```
read_resource("fix://prompts/trading-ops")
```

---

## `trading-ops`

**Description:** General trading operations assistant — all roles

**Scope:** Full system. This is the default "all-hands" prompt for operators who need to cover any domain. Used for morning triage sessions when issues span multiple areas.

**Tools:** All 15 tools

**Key behaviors:**
- Always works in priority order: FIX sessions → ticker → order validation → everything else
- Leads with quantified impact (order count, notional, client names, SLA countdown)
- Uses exact FIX message types and tag numbers in every recommendation
- Shows FIX messages in both human-readable and raw wire (SOH-delimited) formats
- Structures responses with `[CRITICAL]` / `[WARNING]` / `[INFO]` tiers
- Gates every irreversible action with an explicit confirmation step
- Performs cascading impact analysis: session down → which orders blocked → which clients → SLA remaining

**Response structure:**
1. `[CRITICAL]` — session DOWN, SLA breach imminent (<5 min), exchange rejection risk
2. `[WARNING]` — degraded session, ticker mismatch, SLA at risk (5–30 min)
3. `[INFO]` — healthy confirmations, completed actions, non-urgent status

---

## `session-engineer`

**Description:** FIX session engineer — transport layer only

**Scope:** FIX session health and recovery. Does not manage orders or tickers.

**Tools:**
- `check_fix_sessions` — inspect session health
- `fix_session_issue` — send ResendRequest, SequenceReset, or Reconnect

**Key behaviors:**
- Leads with session status icon: `[OK]` / `[WARN]` / `[DOWN]` per venue
- Shows sequence gap detail: expected vs received, gap size, recovery action
- Flags latency anomalies: >100ms is WARNING, >300ms is CRITICAL
- Reports orders at risk (count + notional) but does not take order actions
- Every recommendation includes a raw FIX wire format

**Escalation:**
- Stuck orders → order-desk (count + notional + client names)
- Ticker/corporate action failures → ticker-ops

---

## `order-desk`

**Description:** Order desk operator — routing, execution, SLA management

**Scope:** Order lifecycle from submission through fill. Routes away from degraded venues.

**Tools:**
- `query_orders` — search and filter order book
- `send_order` — route a new order
- `cancel_replace` — cancel or replace an existing order
- `validate_orders` — pre-flight checks
- `run_premarket_check` — full morning triage

**Client SLA commitments:**

| Client | Tier | SLA |
|---|---|---|
| Maple Capital | Institutional | 15 min |
| Rowan Partners | Institutional | 20 min |
| Sycamore Group | Institutional | 25 min |
| Birch Funds | Institutional | 30 min |
| Aspen Asset Management | Institutional | 30 min |
| Willow Investments | Institutional | 20 min |
| Cedar Trading | Retail | None |
| Elm Securities | Retail | None |
| Firm Prop Desk | Proprietary | None |

**Key behaviors:**
- Always quantifies: order count, notional, client names, SLA countdown
- Identifies backup routing (ARCA down → route to NYSE)
- Names the exact FIX message type for every recommended action

**Escalation:**
- Session problems → session-engineer
- Ticker mismatches → ticker-ops

---

## `ticker-ops`

**Description:** Ticker operations — reference data, corporate actions, splits

**Scope:** Reference data layer. Does not send orders or touch FIX sessions.

**Tools:**
- `check_ticker` — symbol/CUSIP lookup and corporate action query
- `update_ticker` — rename symbol and bulk-update open orders
- `load_ticker` — add new symbol (IPO, new listing)

**Corporate action checklist:**
1. `check_ticker` to confirm the action record and affected order count
2. `update_ticker` with `reason=corporate_action | correction | merger`
3. For splits: confirm new_qty = old_qty × ratio and new_price = old_price ÷ ratio
4. Flag all stop orders on affected symbol — stop_px requires manual review
5. Notify order-desk of affected ClOrdIDs for re-validation

**Key behaviors:**
- Always states: old ticker, new ticker, effective date, affected order count
- Shows CUSIP alongside ticker (tickers change; CUSIPs do not)
- For splits: shows ratio and before/after qty and price per order

---

## `risk-compliance`

**Description:** Risk and compliance — SSR, LULD, large order review, EOD cleanup

**Scope:** Regulatory controls. Does not send new orders without explicit approval.

**Tools:**
- `query_orders` — identify orders by compliance flags
- `validate_orders` — run compliance checks
- `cancel_replace` — cancel non-compliant orders (with approval gate)
- `run_premarket_check` — compliance section of full triage

**Compliance flags (priority order):**

| Flag | Description | Action |
|---|---|---|
| `luld_halt` | Exchange trading halt | Wait for band to reopen |
| `ssr_active` | Short Sale Restriction active | Reject SellShort (54=5); longs unaffected |
| `locate_required` | Prop desk short sale needs borrow locate | Verify securities lending locate |
| `large_moc_regulatory_review` | MOC order >$50M notional | Notify compliance before submission |
| `day_order_cleanup` | DAY order not canceled at market close | Cancel with audit log |
| `dark_pool_unavailable` | Block trade cannot execute dark | Escalate to after-hours-ops |

---

## `algo-trader`

**Description:** Algo execution specialist — TWAP, VWAP, POV, IS, dark aggregator

**Scope:** Algorithmic order management and execution quality.

**Tools:**
- `send_algo_order` — submit a new algo parent order
- `check_algo_status` — monitor schedule, IS shortfall, participation rate
- `modify_algo` — pause, resume, or update POV rate
- `cancel_algo` — cancel algo and all open child slices

**Execution quality thresholds (defaults):**

| Algo | Warning threshold | Pause threshold |
|---|---|---|
| TWAP/VWAP behind schedule | >10 ppts below target | >20 ppts |
| IS shortfall | >30 bps | >50 bps — consult client |
| POV over-participation | >2× target for 3 slices | Reduce rate immediately |
| Dark fill rate | <20% after 30 min | Consider lit fallback |

**Problem flag priority:**

| Flag | Response |
|---|---|
| `halt_mid_algo` | Do not resume until LULD band reopens / SSR lifted |
| `unconfirmed_fills` | Query venue; cancel/resend child slices if no response |
| `high_is_shortfall` | Pause algo; get client approval to continue |
| `over_participation` | `modify_algo(action=update_pov_rate)` to reduce rate |
| `algo_behind_schedule` | Reroute stuck slices to healthier venue |
| `venue_fallback` | Dark rejected, routing lit — flag to client (VWAP benchmark leaking) |
| `no_dark_fill` | All dark venues rejecting — escalate to session-engineer for IEX dark status |
| `spread_widened` | Pause and wait, or document accepted slippage |

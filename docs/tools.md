# Tools Reference

All 15 MCP tools exposed by the server. All inputs and outputs use `TextContent` (plain text). Call via `call_tool(name, arguments)`.

---

## Order Management

### `query_orders`

Query OMS orders with optional filters. Returns order details including notional value and SLA countdowns for institutional orders.

**Parameters** (all optional):

| Field | Type | Description |
|---|---|---|
| `client_name` | string | Filter by client name (partial match) |
| `symbol` | string | Filter by symbol |
| `status` | string | Filter by status: `new`, `stuck`, `partially_filled`, `filled`, `canceled`, `rejected` |
| `venue` | string | Filter by venue: `NYSE`, `ARCA`, `BATS`, `IEX`, `EDGX`, `NASDAQ` |
| `order_id` | string | Get a specific order by ID |

**Example:**
```json
{"symbol": "AAPL", "status": "stuck"}
```

**Returns:** Table of matching orders with columns: order_id, symbol, side, quantity, type, status, venue, notional, client. Institutional orders with active SLA deadlines show `*** SLA BREACH IN N min ***`.

---

### `send_order`

Send a new order via FIX NewOrderSingle (35=D). Validates symbol against reference store, checks corporate actions, auto-routes to best available venue if none specified.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | yes | Exchange symbol |
| `side` | string | yes | `buy` or `sell` |
| `quantity` | integer | yes | Number of shares |
| `order_type` | string | yes | `market`, `limit`, or `stop` |
| `price` | number | no | Required for `limit` and `stop` orders |
| `client_name` | string | yes | Must match a client in clients.json |
| `venue` | string | no | Specific venue; omit for auto-routing |

**Example:**
```json
{
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 1000,
  "order_type": "limit",
  "price": 214.50,
  "client_name": "Maple Capital"
}
```

**Returns:** ORDER CONFIRMATION block with Order ID, ClOrdID, FIX message, and routing decision.

---

### `cancel_replace`

Cancel or replace an existing order via FIX OrderCancelRequest (35=F) or OrderCancelReplaceRequest (35=G).

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `order_id` | string | yes | Order to modify |
| `action` | string | yes | `cancel` or `replace` |
| `new_venue` | string | no | Re-route to a different venue (replace only) |
| `new_quantity` | integer | no | Updated quantity (replace only) |
| `new_price` | number | no | Updated price (replace only) |
| `new_symbol` | string | no | Updated symbol after ticker rename (replace only) |

**Example:**
```json
{"order_id": "ORD-20260328-001", "action": "cancel"}
```

---

### `validate_orders`

Pre-flight validation of a set of orders. Checks symbol validity, venue session health, duplicate ClOrdIDs, and client active status.

**Parameters** (all optional — omit all to validate everything):

| Field | Type | Description |
|---|---|---|
| `order_ids` | array[string] | Specific order IDs to validate |
| `symbol` | string | Validate all orders for this symbol |
| `status` | string | Validate all orders with this status |

**Returns:** ORDER VALIDATION report with pass/fail for each order, issue counts, and recommended actions.

---

## FIX Session Management

### `check_fix_sessions`

Check FIX session health: status, sequence numbers, heartbeat age, latency.

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `venue` | string | Specific venue, or omit for all sessions |

**Returns:** Session table with status icon, SenderCompID/TargetCompID pair, last seq nums, heartbeat age, and latency. Flags sequence gaps and stale heartbeats.

---

### `fix_session_issue`

Resolve a FIX session issue using one of three recovery actions.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `venue` | string | yes | Target venue: `NYSE`, `ARCA`, `BATS`, `IEX`, etc. |
| `action` | string | yes | `resend_request`, `reset_sequence`, or `reconnect` |

**Actions:**
- `resend_request` — Sends ResendRequest (35=2) for the gap range; sets session back to active; releases stuck orders at that venue
- `reset_sequence` — Sends SequenceReset (35=4) with GapFillFlag=Y; resets both seq counters; sets session to active
- `reconnect` — Simulates Logout (35=5) / Logon (35=A) cycle; resets session state to active

**Example:**
```json
{"venue": "ARCA", "action": "resend_request"}
```

---

## Ticker Operations

### `check_ticker`

Look up a symbol or CUSIP. Returns full record, pending corporate actions effective today, and affected open order count.

**Parameters** (at least one required):

| Field | Type | Description |
|---|---|---|
| `symbol` | string | Exchange symbol |
| `cusip` | string | 9-character CUSIP |

**Returns:** Symbol record (exchange, lot size, tick size, status), corporate actions for today, and a count of open orders that would be affected.

---

### `update_ticker`

Rename a symbol across the reference store and all open orders in the OMS. Stop orders are flagged for manual review since their trigger prices may be wrong after a rename.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `old_symbol` | string | yes | Current symbol |
| `new_symbol` | string | yes | New symbol |
| `reason` | string | yes | `corporate_action`, `correction`, or `merger` |

**Example:**
```json
{"old_symbol": "ACME", "new_symbol": "ACMX", "reason": "corporate_action"}
```

**Returns:** TICKER UPDATE report with count of affected orders and stop order warnings.

---

### `load_ticker`

Load a new symbol into the reference store (e.g., for an IPO or new listing). Automatically releases orders that were blocked with `symbol_unknown` flag for that symbol.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | yes | New symbol |
| `cusip` | string | yes | 9-character CUSIP |
| `name` | string | yes | Company name |
| `listing_exchange` | string | yes | Primary exchange: `NYSE`, `NASDAQ`, etc. |
| `lot_size` | integer | no | Round lot size (default: 100) |
| `tick_size` | number | no | Minimum price increment (default: 0.01) |

---

## Pre-Market Operations

### `run_premarket_check`

Flagship pre-market health check. Runs all subsystems in one call and produces a prioritized triage report.

**Parameters:** None

**Returns:** Comprehensive report covering:
1. FIX session health (all venues)
2. Corporate actions effective today
3. Stuck orders with SLA countdowns
4. Symbol validation issues
5. Summary with recommended next steps

---

## Scenario Management

### `list_scenarios`

List all available trading scenarios or load one into the runtime.

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `action` | string | `list` — show all scenarios; `load` — switch active scenario |
| `scenario_name` | string | Required when `action=load` |

**Example — list:**
```json
{"action": "list"}
```

**Example — load:**
```json
{"action": "load", "scenario_name": "twap_slippage_1000"}
```

**Returns:** On list: table of all scenarios with time and context summary. On load: confirmation with scenario name and context string.

---

## Algorithmic Orders

### `send_algo_order`

Submit a new algorithmic parent order. Creates an AlgoOrder and initial child slice orders in the OMS.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | yes | Exchange symbol |
| `side` | string | yes | `buy` or `sell` |
| `quantity` | integer | yes | Total shares for the entire algo |
| `algo_type` | string | yes | `TWAP`, `VWAP`, `POV`, `IS`, `DARK_AGG`, or `ICEBERG` |
| `client_name` | string | yes | Must match a client in clients.json |
| `venue` | string | no | Primary execution venue (default: NYSE) |
| `end_time` | string | no | ISO-8601 end of execution window (TWAP/VWAP) |
| `pov_rate` | number | no | Target participation rate 0.0–1.0 (POV/VWAP) |
| `arrival_px` | number | no | Arrival mid-price for IS shortfall benchmark |
| `slice_count` | integer | no | Number of child slices (default: 6) |

**Example:**
```json
{
  "symbol": "NVDA",
  "side": "buy",
  "quantity": 100000,
  "algo_type": "TWAP",
  "client_name": "Maple Capital",
  "arrival_px": 875.0,
  "slice_count": 4
}
```

---

### `check_algo_status`

Check status of algo orders with execution quality metrics: schedule deviation, IS shortfall, over-participation, and child order health.

**Parameters** (all optional — omit for all active algos):

| Field | Type | Description |
|---|---|---|
| `algo_id` | string | Specific algo order ID |
| `symbol` | string | All algos for this symbol |
| `status` | string | Filter: `running`, `paused`, `halted`, `stuck`, `completed`, `canceled` |

**Returns:** ALGO STATUS report with for each algo: schedule_pct vs execution_pct, schedule deviation, IS shortfall (bps), flags, child order summary, and recommended actions.

---

### `modify_algo`

Modify an active algo order in-place without canceling and resubmitting.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `algo_id` | string | yes | Target algo order ID |
| `action` | string | yes | `pause`, `resume`, or `update_pov_rate` |
| `new_pov_rate` | number | no | New POV rate (required when `action=update_pov_rate`) |

**Example — reduce over-participation:**
```json
{"algo_id": "ALGO-20260328-004", "action": "update_pov_rate", "new_pov_rate": 0.08}
```

---

### `cancel_algo`

Cancel an active algo order. Sends FIX OrderCancelRequest (35=F) for each open child slice, marks parent as canceled.

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `algo_id` | string | yes | Algo to cancel |
| `reason` | string | no | Cancellation reason for audit trail |

**Example:**
```json
{"algo_id": "ALGO-20260328-006", "reason": "dark pool illiquid, switching to lit venue"}
```

**Returns:** ALGO CANCELED report with count of child orders sent cancel, notional value, and suggested next steps.

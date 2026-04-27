# Production Deployment

## Demo vs Production Modes

The demo and production versions should expose the same operator experience and MCP tool surface. The difference is the backend each tool talks to: simulated state for this project, real infrastructure for a consulting engagement.

The product promise is not "let an LLM trade by itself." The promise is an MCP-based operations layer where the model can read the right context, call bounded tools, propose a workbook, and leave the human in control of approval and escalation.

### Operating Modes

| Mode | Demo Behavior | Production Behavior |
|---|---|---|
| Watchdog | Scenario state or injected pressure triggers a desk alert with context and recommended response. | Monitoring/event streams trigger alerts from live session, order, market data, and reference systems. |
| Investigator | Operator asks a question; the copilot calls MCP tools to explain scope, impact, and root cause. | Same MCP interface queries real logs, OMS state, reference data, and monitoring tools. |
| Advisor | Copilot proposes a full recovery workbook with steps, expected outcomes, tool calls, and manual equivalents. | Workbook is reviewed against local policy, approvals, and client-specific runbooks before execution. |
| Agent Run | Stress event is injected and the agent works through the runbook while the human observes and can interrupt. | Agent follows approved action policies, emits full trace evidence, and escalates when confidence or authority is insufficient. |

### How These Modes Map to the Demo vs Production

| Component | Demo (This Project) | Production (Consulting Engagement) |
|---|---|---|
| FIX sessions | Simulated Python objects | Connected to real FIX engine logs |
| OMS | In-memory order state | Connected to real OMS database/API |
| Reference data | Pre-loaded JSON files | Connected to real symbology feeds (DTCC, vendors) |
| Monitoring | Scenario engine pre-loads problems | Connected to real monitoring stack (Datadog, Splunk) |
| Alerts | Triggered by querying pre-loaded state | Triggered by real-time event streams |
| Execution | Updates in-memory state | Sends real FIX messages / calls real OMS APIs |
| MCP tools | Identical | Identical -- same tool interface, different backend |
| Domain intelligence | Identical | Identical -- same system prompt, same trading logic |

## Architecture

```
┌────────────┐   ┌─────────────┐   ┌───────────────────┐
│ MCP Client │   │  Claude.ai  │   │  External OMS/EMS  │
│  (Claude)  │   │ integration │   │                   │
└─────┬──────┘   └──────┬──────┘   └─────────┬─────────┘
      │ stdio MCP        │ REST /v1            │ REST /v1
      │                  │                    │
┌─────▼──────────────────▼────────────────────▼─────────┐
│                   fix-mcp-server host                  │
│                                                        │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────┐  │
│  │ mcp-server   │  │   api-server   │  │ dashboard │  │
│  │ (stdio :MCP) │  │   (REST :8000) │  │  (:8787)  │  │
│  └──────────────┘  └────────────────┘  └───────────┘  │
│                                                        │
│  ┌──────────────────┐   ┌────────────────────────────┐ │
│  │   PostgreSQL 16  │   │       Redis 7              │ │
│  │   (:5432)        │   │       (:6379)              │ │
│  │   persistent     │   │   pub/sub fills, sessions  │ │
│  │   order store    │   │   LRU 512mb                │ │
│  └──────────────────┘   └────────────────────────────┘ │
│                                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │  fix-gateway (commented out — enable for live)  │   │
│  │  Async TCP FIX initiator → exchange gateways    │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

## Docker Compose

Start the full stack:

```bash
docker compose up -d
```

Services:

| Service | Image | Port | Purpose |
|---|---|---|---|
| `mcp-server` | build | stdio | MCP stdio interface for AI agents |
| `api-server` | build | 8000 | REST API for dashboards and external OMS hooks |
| `dashboard` | build | 8787 | Self-contained dashboard — HTML + inline API; session cards, tabbed view, per-scenario guided workflow |
| `postgres` | postgres:16-alpine | 5432 | Persistent order store and FIX message log |
| `redis` | redis:7-alpine | 6379 | Real-time pub/sub for fills, session events, algo updates |
| `fix-gateway` | (commented) | — | Real venue TCP connectivity — enable when ready |

Stop and clean up:

```bash
docker compose down
docker compose down -v   # also removes postgres_data and redis_data volumes
```

## Environment Variables

| Variable | Service | Default | Description |
|---|---|---|---|
| `SCENARIO` | mcp-server, api-server | `morning_triage` | Scenario to load on startup |
| `FIX_MCP_CONFIG_DIR` | all | auto | Config directory override |
| `DATABASE_URL` | all | `postgresql://trading:trading@postgres:5432/trading` | PostgreSQL connection |
| `REDIS_URL` | all | `redis://redis:6379/0` | Redis connection |
| `LOG_LEVEL` | all | `INFO` | Logging level |
| `FIX_HOST_NYSE` | fix-gateway | `127.0.0.1` | NYSE gateway hostname |
| `FIX_PORT_NYSE` | fix-gateway | `4001` | NYSE gateway port |
| `FIX_HOST_BATS` | fix-gateway | `127.0.0.1` | BATS gateway hostname |
| `FIX_PORT_BATS` | fix-gateway | `4003` | BATS gateway port |
| `FIX_SENDER_COMP_ID` | fix-gateway | `FIRM_PROD` | FIX SenderCompID |
| `FIX_HEARTBEAT_INTERVAL` | fix-gateway | `30` | Heartbeat interval in seconds |

Copy `.env.example` to `.env` and set real values before enabling the gateway.

## Database Schema

The schema is applied automatically by PostgreSQL on first start from `scripts/init_db.sql`.

### Tables

**`orders`** — OMS order store

| Column | Type | Description |
|---|---|---|
| `order_id` | VARCHAR(50) PK | Internal order identifier |
| `cl_ord_id` | VARCHAR(80) UNIQUE | FIX ClOrdID (11=) |
| `symbol` | VARCHAR(20) | Exchange symbol |
| `cusip` | VARCHAR(20) | CUSIP |
| `side` | VARCHAR(10) | buy / sell |
| `quantity` | INTEGER | Order quantity |
| `filled_quantity` | INTEGER | Cumulative fill |
| `order_type` | VARCHAR(20) | market / limit / stop |
| `price` | NUMERIC(18,6) | Limit/stop price |
| `venue` | VARCHAR(20) | Routing venue |
| `client_name` | VARCHAR(100) | Client identifier |
| `status` | VARCHAR(30) | new / stuck / partially_filled / filled / canceled / rejected |
| `is_institutional` | BOOLEAN | Institutional flag (enables SLA tracking) |
| `sla_minutes` | INTEGER | Client SLA in minutes |
| `flags` | JSONB | Problem flag array |
| `fix_messages` | JSONB | Raw FIX message history |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**`algo_orders`** — Parent algorithmic order store

| Column | Type | Description |
|---|---|---|
| `algo_id` | VARCHAR(50) PK | |
| `client_name` | VARCHAR(100) | |
| `symbol` | VARCHAR(20) | |
| `algo_type` | VARCHAR(20) | TWAP / VWAP / POV / IS / DARK_AGG / ICEBERG |
| `total_qty` | INTEGER | Total shares for the algo |
| `executed_qty` | INTEGER | Cumulative fills across all slices |
| `pov_rate` | NUMERIC(5,4) | Participation rate 0.0–1.0 |
| `schedule_pct` | NUMERIC(6,2) | Time window elapsed % |
| `execution_pct` | NUMERIC(6,2) | Qty executed % |
| `avg_px` | NUMERIC(18,6) | VWAP of fills |
| `arrival_px` | NUMERIC(18,6) | IS arrival benchmark price |
| `benchmark_px` | NUMERIC(18,6) | TWAP/VWAP reference price |
| `status` | VARCHAR(30) | running / paused / halted / stuck / completed / canceled |
| `flags` | JSONB | Problem flag array |
| `child_order_ids` | JSONB | Array of OMS order_ids |
| `is_institutional` | BOOLEAN | Default true for algos |
| `notes` | TEXT | Operator notes |

**`fix_sessions`** — FIX session state

| Column | Type | Description |
|---|---|---|
| `session_id` | VARCHAR(50) PK | |
| `venue` | VARCHAR(20) | |
| `sender_comp_id` | VARCHAR(50) | FIX SenderCompID (49=) |
| `target_comp_id` | VARCHAR(50) | FIX TargetCompID (56=) |
| `fix_version` | VARCHAR(10) | Default: FIX.4.2 |
| `status` | VARCHAR(30) | logged_out / active / degraded / down |
| `last_sent_seq` | INTEGER | Our last outbound MsgSeqNum |
| `last_recv_seq` | INTEGER | Last received MsgSeqNum |
| `expected_recv_seq` | INTEGER | Next expected inbound seq |
| `last_heartbeat` | TIMESTAMPTZ | |
| `latency_ms` | INTEGER | Round-trip latency |
| `host` | VARCHAR(255) | Gateway hostname |
| `port` | INTEGER | Gateway port |
| `error` | TEXT | Last error message |
| `connected_since` | TIMESTAMPTZ | Session logon time |

**`fix_message_log`** — Full FIX message audit trail

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `session_id` | VARCHAR(50) | |
| `direction` | VARCHAR(4) | `IN` or `OUT` |
| `msg_type` | VARCHAR(10) | FIX MsgType (35=) value |
| `seq_num` | INTEGER | MsgSeqNum |
| `cl_ord_id` | VARCHAR(80) | Optional ClOrdID link |
| `raw_message` | TEXT | Full FIX wire message |
| `received_at` | TIMESTAMPTZ | |

**`symbols`** — Reference data

| Column | Type | Description |
|---|---|---|
| `symbol` | VARCHAR(20) PK | |
| `cusip` | VARCHAR(20) UNIQUE | |
| `name` | VARCHAR(200) | Company name |
| `listing_exchange` | VARCHAR(20) | Primary exchange |
| `lot_size` | INTEGER | Default 100 |
| `tick_size` | NUMERIC(10,4) | Default 0.01 |
| `status` | VARCHAR(20) | active / halted / delisted |

**`clients`** — Client registry

| Column | Type | Description |
|---|---|---|
| `client_id` | VARCHAR(20) PK | |
| `name` | VARCHAR(100) UNIQUE | |
| `tier` | VARCHAR(20) | institutional / retail / proprietary |
| `sla_minutes` | INTEGER | Nullable for retail/prop |
| `active` | BOOLEAN | |

**`scenario_runs`** — Audit log of scenario loads

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `scenario_name` | VARCHAR(100) | |
| `loaded_at` | TIMESTAMPTZ | |
| `loaded_by` | VARCHAR(100) | Agent or operator identifier |

### Indexes

```sql
-- Orders
idx_orders_symbol   ON orders(symbol)
idx_orders_status   ON orders(status)
idx_orders_client   ON orders(client_name)
idx_orders_venue    ON orders(venue)
idx_orders_updated  ON orders(updated_at DESC)

-- Algo orders
idx_algo_status     ON algo_orders(status)
idx_algo_symbol     ON algo_orders(symbol)
idx_algo_client     ON algo_orders(client_name)

-- FIX message log
idx_log_session     ON fix_message_log(session_id, received_at DESC)
idx_log_cl_ord_id   ON fix_message_log(cl_ord_id) WHERE cl_ord_id IS NOT NULL
idx_log_msg_type    ON fix_message_log(msg_type)
```

### Triggers

`update_updated_at()` trigger fires on UPDATE for: `orders`, `algo_orders`, `fix_sessions`, `symbols`. Sets `updated_at = NOW()` automatically.

## FIX Gateway

The `fix-gateway` service in `docker-compose.yml` is commented out. To enable real venue connectivity:

1. Uncomment the `fix-gateway` block in `docker-compose.yml`
2. Set exchange gateway environment variables:
   ```
   FIX_HOST_NYSE=nyse-gateway.prod.internal
   FIX_PORT_NYSE=4001
   FIX_HOST_BATS=bats-gateway.prod.internal
   FIX_PORT_BATS=4003
   FIX_SENDER_COMP_ID=FIRM_PROD
   FIX_HEARTBEAT_INTERVAL=30
   ```
3. The `FIXConnector` class (`src/fix_mcp/fix/connector.py`) handles:
   - TCP connect with configurable retry (max 10 attempts, 5s delay)
   - Logon (35=A) with HeartBtInt
   - Heartbeat loop (`send_heartbeat` every `heartbeat_interval` seconds)
   - Receive loop with SOH-framed message parsing
   - Auto-reconnect on disconnect
   - TLS support via `use_tls=True` in `ConnectorConfig`

4. For production also wire in:
   - Sequence number persistence to `fix_sessions` table (survives restarts)
   - TLS/mTLS certificates from the exchange
   - Message replay on reconnect (ResendRequest gap fill from `fix_message_log`)
   - Prometheus metrics export for latency and session health monitoring

## Go-Live Checklist

### Infrastructure

- [ ] PostgreSQL data volume is on persistent storage (not `tmpfs`)
- [ ] Redis `appendonly yes` and `maxmemory-policy allkeys-lru` are configured
- [ ] Docker Compose healthchecks pass for both postgres and redis before app containers start
- [ ] Ports 5432 and 6379 are not exposed to untrusted networks (remove port mappings in production)
- [ ] `DATABASE_URL` and `REDIS_URL` use strong passwords (not `trading:trading`)
- [ ] No secrets in environment variables committed to version control — use `.env` or a secrets manager

### FIX Connectivity

- [ ] `FIX_SENDER_COMP_ID` matches the CompID registered with each exchange
- [ ] Exchange gateway `host` and `port` confirmed for production (not UAT)
- [ ] FIX session heartbeat interval (`FIX_HEARTBEAT_INTERVAL`) matches exchange requirements (typically 30s)
- [ ] Sequence numbers initialized from `fix_sessions` table, not reset to 1 (would cause Logout from exchange)
- [ ] TLS certificates obtained and configured if exchange requires encrypted connection

### Application

- [ ] All 16 tests pass: `PYTHONPATH=src ./.venv/bin/python -m pytest`
- [ ] `run_premarket_check` returns expected output for the `morning_triage` scenario
- [ ] All 6 role prompts accessible via `list_prompts` / `get_prompt`
- [ ] `list_scenarios` returns all 13 scenarios
- [ ] Dashboard accessible at `:8787` and showing live session state
- [ ] REST API responding at `:8000`

### Monitoring

- [ ] Log shipping configured (Datadog, Splunk, CloudWatch, or equivalent)
- [ ] Alerting on FIX session status changes (DOWN / DEGRADED)
- [ ] Alerting on SLA breach events for institutional clients
- [ ] Redis memory usage monitored (limit is 512mb)
- [ ] PostgreSQL `fix_message_log` table has a retention policy (high write volume at scale)

## Backup and Recovery

```bash
# Backup PostgreSQL
docker exec fix-mcp-postgres pg_dump -U trading trading > backup_$(date +%Y%m%d).sql

# Restore PostgreSQL
docker exec -i fix-mcp-postgres psql -U trading trading < backup_20260328.sql

# Redis is append-only — data is in redis_data volume
# Copy the volume or use redis-cli BGSAVE to create a snapshot
```

## Next Building Blocks

The current system is fully functional for development and AI agent workflows. The following additions are required before handling real order flow or institutional clients.

### 1. WebSocket Real-Time Dashboard Updates

**Current state:** Dashboard polls on-demand (manual Refresh button).
**Goal:** Push session health, fill events, and algo status updates to the browser in real time.

What to build:
- Add `ws://` endpoint to `dashboard.py` alongside the existing HTTP handlers (`asyncio` + `websockets` library or `aiohttp`)
- On each session/order/algo state change, broadcast a diff payload to all connected clients
- JavaScript `WebSocket` client in the dashboard HTML replaces the manual refresh button
- Event types: `session_update`, `order_fill`, `algo_update`, `scenario_load`

Trigger: wire Redis pub/sub (item 3 below) as the event source so the dashboard receives events from any service in the stack.

### 2. PostgreSQL State Persistence

**Current state:** OMS, FIXSessionManager, AlgoEngine all live in-memory. Restart loses all state.
**Goal:** State survives restarts; production OMS can replay intraday history on reconnect.

What to build:
- `engine/db.py` — async connection pool wrapping `asyncpg` or `psycopg3`
- On `Order` creation/update: write to `orders` table (schema already defined in `init_db.sql`)
- On `FIXSession` state change: update `fix_sessions` table
- On `AlgoOrder` create/modify: write to `algo_orders` table
- On server startup: load existing intraday state from DB instead of always loading from scenario JSON
- `scenario_runs` table already exists — call `INSERT INTO scenario_runs` on `ScenarioEngine.load_scenario()`

Priority fields for persistence: `status`, `filled_quantity`, `flags`, `fix_messages`, `last_sent_seq`, `last_recv_seq`, `expected_recv_seq`.

### 3. Redis Pub/Sub for Cross-Service Events

**Current state:** Each service (mcp-server, api-server, dashboard) holds its own in-memory engine copy. State diverges between services.
**Goal:** Single source of truth; all services react to the same event stream.

What to build:
- `engine/events.py` — `EventBus` class wrapping `redis.asyncio` pub/sub
- Channels: `fix.session.*`, `fix.order.*`, `fix.algo.*`, `fix.scenario`
- Publish on: order status changes, fill receipts, session state transitions, algo pause/resume/cancel
- Subscribe in: dashboard (feed WebSocket clients), api-server (invalidate status cache)
- Message format: `{"type": "order_fill", "order_id": "...", "filled_qty": 500, "ts": "..."}`

### 4. API and Dashboard Authentication

**Current state:** All endpoints are open — no authentication.
**Goal:** Prevent unauthorized order submission and scenario manipulation.

What to build:
- API key middleware in `api.py`: check `Authorization: Bearer <key>` header; 401 on missing/invalid
- Key stored in environment variable `FIX_MCP_API_KEY` (never hardcoded)
- Dashboard login: session cookie with a configurable operator password (`FIX_MCP_DASHBOARD_PASSWORD`)
- MCP server is stdio only — no network auth needed for the AI agent channel

Scope: block `POST /api/tool` and `POST /api/reset` behind auth; keep `GET /health` public for container healthchecks.

### 5. FIX Gateway Enablement

**Current state:** `fix/connector.py` (`FIXConnector`) is fully implemented but the `fix-gateway` service is commented out in `docker-compose.yml`.
**Goal:** Live exchange connectivity with proper sequence number persistence and gap fill.

What to build / configure:
- Uncomment `fix-gateway` in `docker-compose.yml`
- Set `FIX_HOST_NYSE`, `FIX_PORT_NYSE`, `FIX_HOST_BATS`, `FIX_PORT_BATS`, `FIX_SENDER_COMP_ID` from exchange onboarding docs
- Load/save sequence numbers from `fix_sessions` table on connect/disconnect (prevents seq reset = exchange Logout)
- Implement `ResendRequest` gap fill: on reconnect, query `fix_message_log` for the gap range and retransmit
- TLS: pass exchange certificate bundle via `ConnectorConfig(use_tls=True, ca_cert_path=...)`
- Heartbeat monitor: alert (log + Redis event) if no heartbeat received within `2 × heartbeat_interval`

### 6. Prometheus Metrics + Alerting

**Current state:** No metrics exported; monitoring requires log scraping.
**Goal:** Grafana/PagerDuty-compatible metrics for oncall.

What to build:
- Add `GET /metrics` to `api.py` returning Prometheus text format (use `prometheus_client` library)
- Key gauges: `fix_session_status{venue}` (0=down, 1=degraded, 2=active), `open_orders_total`, `stuck_orders_total`, `algo_schedule_deviation_pct{algo_id}`
- Key counters: `fix_messages_sent_total{venue}`, `fix_messages_recv_total{venue}`, `order_fills_total`
- Alert rules (Prometheus AlertManager or Grafana):
  - `fix_session_status == 0` for > 30s → PagerDuty P2
  - `stuck_orders_total > 0` with `is_institutional=true` → PagerDuty P1 when SLA < 5 min
  - `algo_schedule_deviation_pct > 20` for > 60s → Slack warning

### 7. SLA Breach Push Notifications

**Current state:** SLA countdown is computed on each `query_orders` call but never pushed proactively.
**Goal:** Operator receives alert when institutional order SLA is about to breach — without waiting for a manual query.

What to build:
- Background task in `engine/oms.py`: scan open institutional orders every 60s
- When `sla_remaining_minutes < 5`: publish `fix.order.sla_warning` Redis event; log WARNING
- When `sla_remaining_minutes <= 0`: set `flags = ["sla_breach"]`; publish `fix.order.sla_breach`
- Dashboard WebSocket client surfaces SLA warnings as a banner/toast
- Optional: webhook `POST` to a configurable `FIX_MCP_ALERT_WEBHOOK_URL`

### Priority Order

| # | Feature | Complexity | Impact |
|---|---|---|---|
| 1 | PostgreSQL persistence | Medium | Critical — state loss on restart is a blocker |
| 2 | API authentication | Low | Critical — open endpoints are a security risk |
| 3 | Redis pub/sub events | Medium | High — enables cross-service consistency |
| 4 | WebSocket dashboard | Medium | High — real-time visibility for operators |
| 5 | SLA alerting | Low | High — institutional SLA is a contractual obligation |
| 6 | FIX gateway enablement | High | High — required for live order flow |
| 7 | Prometheus metrics | Low | Medium — needed for production oncall |

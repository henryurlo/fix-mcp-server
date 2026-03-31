# FIX MCP Server

A production-grade MCP server for FIX protocol trading operations. Exposes 15 tools, 4 resources, and 6 role-specific prompts over stdio. Backed by a full PostgreSQL + Redis stack for production deployment.

## What it includes

- **15 MCP tools** — order management, FIX session repair, ticker operations, algo execution, scenario loading
- **13 trading scenarios** — 24-hour coverage from 02:05 ET pre-dawn through 16:32 ET after-hours
- **6 role prompts** — specialized system prompts for trading-ops, session-engineer, order-desk, ticker-ops, risk-compliance, algo-trader
- **Algorithmic order engine** — TWAP, VWAP, POV, IS, DARK_AGG, ICEBERG with schedule tracking and execution quality metrics
- **Production stack** — PostgreSQL 16 + Redis 7 via Docker Compose, async FIX TCP connector

## Quick Start

**One command — no Docker required:**

```bash
./scripts/start.sh
# Open: http://localhost:8080
```

The script creates a virtualenv on first run, installs the package, then starts the dashboard. The REST API is embedded in the same process — one port, one URL.

**Load a specific scenario:**

```bash
SCENARIO=twap_slippage_1000 ./scripts/start.sh
```

**Docker (full production stack):**

```bash
docker compose up -d
# MCP stdio:   docker compose run --rm mcp-server
# REST API:    http://localhost:8000
# Dashboard:   http://localhost:8787
```

## MCP Client Configuration

```json
{
  "mcpServers": {
    "fix-mcp": {
      "command": "/path/to/fix-mcp-server/.venv/bin/fix-mcp-server",
      "args": [],
      "cwd": "/path/to/fix-mcp-server"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SCENARIO` | `morning_triage` | Scenario to load on startup |
| `FIX_MCP_CONFIG_DIR` | auto-discovered | Config directory override |
| `DATABASE_URL` | — | PostgreSQL connection string (production) |
| `REDIS_URL` | — | Redis connection string (production) |
| `LOG_LEVEL` | `INFO` | Logging level |

## Tools (15)

| Tool | Category | Description |
|---|---|---|
| `query_orders` | Orders | Query OMS with filters; returns notional and SLA countdowns |
| `check_fix_sessions` | Sessions | Session health, seq numbers, heartbeat age, latency |
| `send_order` | Orders | NewOrderSingle via FIX 35=D with auto-routing |
| `cancel_replace` | Orders | Cancel (35=F) or replace (35=G) an existing order |
| `check_ticker` | Reference | Symbol/CUSIP lookup with corporate actions and open order count |
| `update_ticker` | Reference | Rename symbol and bulk-update all open orders |
| `load_ticker` | Reference | Load new symbol and release pending IPO orders |
| `fix_session_issue` | Sessions | Resend request, sequence reset, or reconnect |
| `validate_orders` | Orders | Pre-flight validation against symbol, venue, and compliance rules |
| `run_premarket_check` | Ops | Full pre-market health check across all systems |
| `send_algo_order` | Algos | Submit TWAP/VWAP/POV/IS/DARK_AGG/ICEBERG parent order |
| `check_algo_status` | Algos | Schedule deviation, IS shortfall, execution quality |
| `modify_algo` | Algos | Pause, resume, or update POV participation rate |
| `cancel_algo` | Algos | Cancel algo and send cancel for all child slices |
| `list_scenarios` | Scenarios | List or load trading scenarios |

See [docs/tools.md](docs/tools.md) for full parameter schemas.

## Scenarios (13)

| Name | Time | Key Problems |
|---|---|---|
| `morning_triage` | 06:15 ET | ARCA down, BATS seq gap, ticker rename ACME→ACMX |
| `bats_startup_0200` | 02:05 ET | BATS SequenceReset with unexpected NewSeqNo |
| `predawn_adrs_0430` | 04:35 ET | Shell ADR rebrand RDSA→SHEL, ARCA latency 220ms |
| `preopen_auction_0900` | 09:02 ET | MOO imbalance, IEX feed stale |
| `open_volatility_0930` | 09:35 ET | GME LULD halt, BATS packet loss |
| `venue_degradation_1030` | 10:32 ET | NYSE latency 180ms, Mahwah route flap |
| `ssr_and_split_1130` | 11:34 ET | RIDE SSR trigger, AAPL 4:1 split in 26 min |
| `iex_recovery_1400` | 14:03 ET | IEX recovered, D-Limit rerouting |
| `eod_moc_1530` | 15:31 ET | MOC cutoff, GTC preservation |
| `afterhours_dark_1630` | 16:32 ET | Dark pool offline, Liquidnet SessionStatus=8 |
| `twap_slippage_1000` | 10:05 ET | TWAP behind schedule, GME halted mid-algo |
| `vwap_vol_spike_1130` | 11:35 ET | VWAP over-participation, BATS latency spike |
| `is_dark_failure_1415` | 14:15 ET | IS high shortfall, dark aggregator no fills |

See [docs/scenarios.md](docs/scenarios.md) for full scenario details.

## Role Prompts (6)

| Prompt Name | Scope |
|---|---|
| `trading-ops` | General — all domains, primary triage |
| `session-engineer` | FIX transport layer only |
| `order-desk` | Routing, execution, SLA management |
| `ticker-ops` | Reference data, corporate actions, splits |
| `risk-compliance` | SSR, LULD, large order review, EOD |
| `algo-trader` | TWAP, VWAP, POV, IS, dark aggregator |

See [docs/prompts.md](docs/prompts.md) for full prompt descriptions and tool assignments.

## Tests

```bash
PYTHONPATH=src ./.venv/bin/python -m pytest
```

16 tests covering tools, scenarios, algo orders, and session repair.

## CLI Smoke Test

```bash
PYTHONPATH=src ./.venv/bin/python -c "import asyncio; from fix_mcp import server; print(asyncio.run(server.call_tool('run_premarket_check', {}))[0].text)"
```

## Dashboard

```bash
./scripts/start.sh
# Open: http://localhost:8080
```

Self-contained — one command starts both the REST API (embedded) and the web UI. Features:

| Tab | What it shows |
|---|---|
| **Playbook** | Step-by-step guided workflow for the active scenario — run each tool with one click |
| **FIX Messages** | Annotated FIX 4.2 protocol message table: tag number, field name, value — populated on every order or session repair |
| **Tools** | Visual catalog of all 15 MCP tools with descriptions, organized by category |
| **Sessions** | FIX session health cards: status, latency, sequence numbers, gap alerts |
| **Orders** | Live order table with Cancel button per row and SLA breach indicators |
| **Algos** | Execution progress bars, schedule deviation coloring, inline Pause/Cancel |
| **Activity** | Timestamped log of every tool call and result |
| **Architecture** | Mermaid system diagram + 6-milestone evolution roadmap |

Sidebar controls: Send Order form, Session Repair form, Quick Tools, simulation VCR speed (1×–60×), Human/Mixed/Agent mode toggle.

## REST API

```bash
./.venv/bin/fix-mcp-api
# Endpoints: http://localhost:8000
```

Standalone REST API for external integrations (OMS hooks, Claude.ai, monitoring):
- `GET /health` — liveness probe
- `GET /api/status` — full status: scenario, sessions, orders, algos
- `GET /api/scenarios` — list all 13 scenarios with context strings
- `POST /api/tool` — call any MCP tool: `{"tool":"...", "arguments":{...}}`
- `POST /api/reset` — load a scenario: `{"scenario":"morning_triage"}`

## Documentation

- [Architecture](docs/architecture.md) — component diagram, data flow, engine layer
- [Tools](docs/tools.md) — all 15 tools with parameter schemas and examples
- [Scenarios](docs/scenarios.md) — all 13 scenarios with time, problems, and flags
- [Prompts](docs/prompts.md) — all 6 role prompts with scope and escalation paths
- [Algo Suite](docs/algo-suite.md) — algo types, execution flags, quality thresholds
- [Production](docs/production.md) — Docker deploy, DB schema, FIX gateway, go-live checklist, next building blocks

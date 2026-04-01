# FIX MCP Server — Checkpoint

Last updated: 2026-04-01

---

## What this project is

A FIX Protocol 4.2 trading operations simulator that demonstrates how MCP (Model Context Protocol), AI agents, and human operators can share the same real-time state. The audience is peers and executives at the firm — the goal is to show feasibility, not production hardening.

Three servers run in **one Python process** so Claude and the dashboard always see the same data:

| Server | Port | Purpose |
|--------|------|---------|
| Dashboard + REST proxy | 8787 | Web UI — serves HTML, proxies `/api/*` |
| Embedded REST API | 8000 | All state read/write (`/api/detail`, `/api/tool`, etc.) |
| MCP HTTP transport | 8001 | Claude connects here — `{"url": "http://localhost:8001/mcp"}` |

---

## Architecture

```
Claude Code / Claude.ai
        │  MCP streamable-HTTP
        ▼
fix_mcp.mcp_http  :8001  ──────────────────────────────────┐
                                                            │  same Python
fix_mcp.dashboard :8787  ──► fix_mcp.api :8000 ─────────── process
                                                            │
                    fix_mcp.server (15 tools, 4 resources,  │
                    6 prompts, OMS, FIX sessions, algos) ◄──┘
```

Tool calls from **either** Claude or the dashboard go through `fix_mcp.server.call_tool()`, which fires `_tool_listeners` so the Activity stream in the right panel updates immediately with source badges (`AI` / `UI`).

---

## Repository structure

```
fix-mcp-server/
├── src/fix_mcp/
│   ├── server.py          # 15 MCP tools + resources + prompts
│   ├── api.py             # REST API (ThreadingHTTPServer, port 8000)
│   ├── dashboard.py       # Web UI (HTML+JS single file, port 8787)
│   ├── mcp_http.py        # MCP streamable-HTTP transport (port 8001)
│   ├── engine/
│   │   ├── oms.py         # Order management — lifecycle, SLA tracking
│   │   ├── fix_sessions.py# FIX session state, sequence numbers
│   │   ├── algo_engine.py # TWAP / VWAP / IS / POV algo tracking
│   │   ├── reference.py   # Ticker reference data, corp actions
│   │   └── scenarios.py   # Load scenario JSON → engine state
│   ├── fix/
│   │   ├── connector.py   # Real TCP/FIX connector (prod, env-var driven)
│   │   └── messages.py    # FIX 4.2 message builder helpers
│   ├── log_generator.py   # VCR-style FIX log writer (1×–60× speed)
│   ├── log_monitor.py     # Pattern detector → autonomous API calls
│   └── prompts/
│       └── trading_ops.py # 6 role prompts + SCENARIO_PROMPTS context
├── config/
│   ├── scenarios/         # 13 scenario JSON files (sessions + orders + algos)
│   └── reference_data.json
├── docs/                  # This file + architecture, tools, scenarios docs
└── docker-compose.yml     # dashboard + api-server + postgres + redis
```

---

## 13 Trading Scenarios

| ET Time | Scenario key | Episode |
|---------|-------------|---------|
| 02:05 | `bats_startup_0200` | BATS overnight SequenceReset mismatch |
| 04:35 | `predawn_adrs_0430` | RDSA→SHEL rename + ARCA latency |
| 07:00 | `morning_triage` | Pre-market triage — ARCA down, ACME rebrand, ZEPH IPO |
| 09:02 | `preopen_auction_0900` | SPY MOO imbalance + stale IEX feed |
| 09:35 | `open_volatility_0930` | GME LULD halt + BATS 3.2% packet loss |
| 10:05 | `twap_slippage_1000` | NVDA TWAP behind schedule + GME TWAP halted |
| 10:32 | `venue_degradation_1030` | NYSE Mahwah route flap, $4.1M stuck |
| 11:34 | `ssr_and_split_1130` | RIDE SSR + AAPL 4:1 split collision |
| 11:35 | `vwap_vol_spike_1130` | MSFT/AMD over-participation |
| 14:03 | `iex_recovery_1400` | IEX back after outage, seq gap 8938–8940 |
| 14:15 | `is_dark_failure_1415` | TSLA IS shortfall 108bps + AMZN dark frozen |
| 15:31 | `eod_moc_1530` | ARCA MOC cutoff missed, NYSE 14 min away |
| 16:32 | `afterhours_dark_1630` | Liquidnet offline, NVDA $18M block orphaned |

---

## 15 MCP Tools

| Tool | Category | What it does |
|------|----------|-------------|
| `run_premarket_check` | Triage | Full scan: sessions, corp actions, stuck orders, SLA timers |
| `check_fix_sessions` | Session | Inspect sequence numbers, latency, gaps per venue |
| `fix_session_issue` | Session | Send ResendRequest (35=2), SequenceReset (35=4), or Logon (35=A) |
| `query_orders` | Orders | Filter open orders by status, venue, symbol, client |
| `validate_orders` | Orders | Pre-flight: price bands, LULD, duplicate ClOrdIDs, SLA |
| `send_order` | Orders | NewOrderSingle (35=D) with FIX message output |
| `cancel_replace` | Orders | OrderCancelRequest (35=F) or CancelReplaceRequest (35=G) |
| `check_ticker` | Reference | Read ticker flags (SSR, corp action, IPO status) |
| `update_ticker` | Reference | Apply rename/split — bulk-updates all affected orders |
| `load_ticker` | Reference | Add new symbol to reference store (IPO day) |
| `send_algo_order` | Algo | Launch TWAP / VWAP / IS / POV algo |
| `check_algo_status` | Algo | Read execution%, schedule deviation, flags per algo |
| `modify_algo` | Algo | Pause, resume, or update POV rate on live algo |
| `cancel_algo` | Algo | Cancel algo and all child orders |
| `list_scenarios` | Triage | Enumerate all available scenarios with context strings |

---

## Dashboard layout (3-column)

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR — Mode (Human/Mixed/Agent) · Sim speed · Scenario · ↺  │
├──────────────┬──────────────────────────┬────────────────────────┤
│  LEFT 220px  │    CENTER (1fr)          │   RIGHT 280px          │
│              │                          │                        │
│ Today's      │  ▶ Playbook tab          │  FIX Sessions          │
│ Timeline     │  ┌──────────────────┐   │  (status + latency)    │
│ (13 rows,    │  │ Scenario Brief   │   │                        │
│  click→load) │  │ Step cards       │   │  Open Orders           │
│              │  │  Run → buttons   │   │  (symbol/side/qty/✕)   │
│ Session      │  │ Output panel     │   │                        │
│ Health cards │  └──────────────────┘   │  Active Algos          │
│              │                          │  (if any, with ⏸/✕)   │
│ Quick Tools  │  FIX Messages tab        │                        │
│              │  MCP Server tab          │  MCP Activity stream   │
│ Send Order   │  Architecture tab        │  (AI/UI badge, ✓/✗)   │
│ Repair form  │                          │                        │
└──────────────┴──────────────────────────┴────────────────────────┘
```

**The key point:** running a Playbook step shows output in the center while the right panel updates live — no tab switching needed to see what changed in sessions/orders/algos.

---

## Modes

| Mode | Behavior |
|------|---------|
| **Human** | All steps require manual Run → clicks. AI narrates what it would do. |
| **Mixed** | AI auto-runs safe steps; steps marked `approval:true` pause for human sign-off. |
| **Agent** | AI runs all steps without confirmation. Notional alerts remain visible but don't block. |

---

## Venue host definitions

Defined in `config/scenarios/*.json` under `sessions[].host/port`:

| Venue | Host | Port |
|-------|------|------|
| NYSE | `nyse-gateway.prod.internal` | 4001 |
| ARCA | `arca-gateway.prod.internal` | 4002 |
| BATS | `bats-gateway.prod.internal` | 4003 |
| IEX | `iex-gateway.prod.internal` | 4004 |

For a real deployment, `fix/connector.py` reads `FIX_HOST_{VENUE}` / `FIX_PORT_{VENUE}` env vars instead.

---

## How to run

```bash
# Docker (all services)
docker compose up -d
open http://localhost:8787

# Local dev (single process: dashboard + API + MCP HTTP)
pip install -e .
fix-mcp-dashboard
# Dashboard → http://127.0.0.1:8080
# REST API  → http://127.0.0.1:8000
# MCP HTTP  → http://127.0.0.1:8001/mcp

# Claude Code connection
# Add to .claude/mcp.json:
# {"mcpServers": {"fix-mcp": {"url": "http://localhost:8001/mcp"}}}
```

---

## Commit history (recent)

| Commit | Description |
|--------|-------------|
| `58f26ce` | Refactor: 3-column layout, always-visible right panel, 4 tabs |
| `edb10ec` | Phase 2: sim clock, Play Day, timeline narration (later simplified) |
| `478a6a9` | Phase 1: MCP HTTP transport, shared state, Claude activity in dashboard |
| `61602ee` | Dashboard: MCP Server tab, live schema endpoint, JSON-RPC display |
| `a79ad17` | Dashboard: rich tool output, FIX message inspector, single-process start |
| `255c412` | Redesign dashboard for intuitive demo flow + enrich all 13 scenarios |
| `5f9b2f9` | Autonomous ops layer: log gen/monitor, live dashboard, audit schema |
| `fbb2ad5` | Initial release: FIX Protocol MCP Server v0.1.0 |

---

## What's next (Phase 3 ideas)

- **Matrix event stream** — always-on scrolling panel: MCP calls (blue), FIX messages (green), order changes (amber), alerts (red)
- **Mode demo script** — structured walkthrough showing Human → Mixed → Agent mode on the same scenario
- **WebSocket push** — replace 5s polling with Redis pub/sub → browser push for live fills
- **Real connector** — wire `fix/connector.py` to a UAT venue (BATS UAT, IEX Pillar sandbox)

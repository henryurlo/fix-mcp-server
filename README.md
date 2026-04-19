# FIX-MCP

FIX protocol simulation platform for capital markets operations. AI-powered SRE copilot with real-time diagnostics, incident runbooks, and MCP tool integration for trading infrastructure management.

---

## Quick Start

```bash
git clone https://github.com/henryurlo/fix-mcp-server.git
cd fix-mcp-server
docker compose up -d
```

Open **http://localhost:3000**.

**Login:** `henry` / `henry` (admin) · `admin` / `admin` · or click **Demo Mode**.

| Service   | URL                    | What it serves                     |
|-----------|------------------------|------------------------------------|
| Console   | http://localhost:3000  | Mission Control UI (Next.js)       |
| REST API  | http://localhost:8000  | MCP tool dispatch, system status   |
| Dashboard | http://localhost:8787  | Legacy operational dashboard       |

No Node or Python on your host — everything runs in containers.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │              Host / Browser              │
                    │    http://localhost:3000  (Console)      │
                    └──────────────────┬───────────────────────┘
                                       │
          ┌────────────────────────────┴────────────────────────────┐
          │                  docker compose network                 │
          │                                                         │
          │  ┌───────────────┐      ┌──────────────────────────┐    │
          │  │   console     │      │       api-server         │    │
          │  │  (Next.js)    │ ───▶ │   REST + MCP dispatch    │    │
          │  │  port 3000    │      │        port 8000         │    │
          │  └───────────────┘      └────────────┬─────────────┘    │
          │                                      │                  │
          │  ┌───────────────┐                   │                  │
          │  │  mcp-server   │ ◀── stdio/MCP ───┤                  │
          │  │  (22 tools)   │                   │                  │
          │  └───────┬───────┘                   │                  │
          │          │                           │                  │
          │          ▼                           ▼                  │
          │  ┌───────────────────┐    ┌──────────────────────┐      │
          │  │   FIX Engine      │    │       Postgres       │      │
          │  │   (simulated)     │    │   order store +      │      │
          │  │   NYSE·BATS·ARCA  │    │    FIX msg log       │      │
          │  │   ·IEX sessions   │    └──────────────────────┘      │
          │  └───────┬───────────┘                                  │
          │          │                                              │
          │          ▼                                              │
          │  ┌───────────────────┐                                  │
          │  │      Redis        │                                  │
          │  │  pub/sub fills,   │                                  │
          │  │  session events   │                                  │
          │  └───────────────────┘                                  │
          └─────────────────────────────────────────────────────────┘
```

### Request flow (incident example)

```
 Operator  ─┐
            │ 1. "ARCA session has a sequence gap"
            ▼
 ┌──────────────────────┐
 │  Console (Next.js)   │  2. SRE Copilot receives message + scenario context
 │  /src/store/chat     │     + full FIX-protocol system prompt (prompts.ts)
 └──────────┬───────────┘
            │ 3. Calls OpenRouter LLM → proposes tool call
            ▼
 ┌──────────────────────┐
 │  Proxy route.ts      │  4. /api/tool  {tool: "dump_session_state",
 │  /api/*              │                 arguments: {venue: "ARCA"}}
 └──────────┬───────────┘
            │
            ▼
 ┌──────────────────────┐
 │   api-server         │  5. Dispatches to MCP tool handler
 │   port 8000          │
 └──────────┬───────────┘
            │
            ▼
 ┌──────────────────────┐
 │   FIX Engine         │  6. Reads session state → returns MsgSeqNum
 │   (exchange_sim)     │     snapshot, CompID pair, last 20 messages
 └──────────┬───────────┘
            │
            ▼
 ┌──────────────────────┐
 │   Console UI         │  7. Renders result, audit-log entry,
 │                      │     copilot proposes next tool in chain
 └──────────────────────┘
```

---

## Mission Control (UI)

```
┌──────────────────┬───────────────────────────────────┐
│ Topology Graph   │ FIX CLI Terminal                  │
│ + Heartbeats     │ fix-cli> show sessions            │
│ + Scenario Picker│ fix-cli> grep 35=D logs/*.log     │
├──────────────────┼───────────────────────────────────┤
│ Incident Runbook │ MCP Audit Log                     │
│ (step-by-step)   │ [16:23] ▶ check_fix_sessions      │
│                  │ [16:23] ✓ NYSE: ACTIVE (3ms)      │
└──────────────────┴───────────────────────────────────┘
         + SRE Copilot (slide-in panel, FIX-aware)
         + Telemetry tab (sparklines, order book, FX)
         + Scenario Creator tab
```

---

## FIX CLI Terminal

```bash
fix-cli> show sessions              # FIX session status
fix-cli> show orders --venue NYSE   # filter orders
fix-cli> send order TSLA BUY 100 @185.50 NYSE
fix-cli> heartbeat BATS             # venue heartbeat
fix-cli> dump NYSE                  # full diagnostic
fix-cli> parse 8=FIX.4.2|35=D|49=FIRM_A|56=NYSE|55=AAPL|54=1|38=500
fix-cli> tail /opt/fix/logs/NYSE-PROD-01.log 50
fix-cli> grep 35=D /opt/fix/logs/*.log       # case-insensitive
fix-cli> grep error /opt/fix/logs/BATS-PROD-01.log
fix-cli> cat /opt/fix/config/sessions.xml
fix-cli> ls /opt/fix/sessions/
fix-cli> cd /opt/fix/logs && ls
fix-cli> scenario load venue_degradation_1030
```

---

## MCP Tools (22)

### Diagnostic
| Tool | Description |
|------|-------------|
| `run_premarket_check` | Full pre-market health sweep |
| `check_fix_sessions` | Check all FIX venue session status |
| `check_ticker` | Validate reference data for a symbol |
| `query_orders` | Query orders with filters (status, venue, symbol) |
| `validate_orders` | Validate order reference data |
| `dump_session_state` | Full MsgSeqNum snapshot + CompID pair verification |
| `tail_logs` | Tail FIX session log files |
| `grep_logs` | Pattern search across FIX log files |

### Session recovery
| Tool | Description |
|------|-------------|
| `fix_session_issue` | Reconnect / reset sequence / resend request |
| `session_heartbeat` | Manual TestRequest (35=1) to a venue |
| `reset_sequence` | Reset FIX MsgSeqNum — **irreversible, approval gate** |

### Order actions
| Tool | Description |
|------|-------------|
| `send_order` | Submit a new order (NewOrderSingle 35=D) |
| `cancel_replace` | Cancel/replace existing order (35=G) |
| `release_stuck_orders` | Bulk-release post-reconnect |

### Algo suite
| Tool | Description |
|------|-------------|
| `send_algo_order` | Submit an algo parent order (VWAP, TWAP, POV) |
| `check_algo_status` | Query algo progress + slippage vs benchmark |
| `modify_algo` | Update algo params mid-flight |
| `cancel_algo` | Cancel parent algo and child orders |

### Reference data · Venue · Meta
| Tool | Description |
|------|-------------|
| `update_ticker` / `load_ticker` | Edit / reload symbol reference |
| `update_venue_status` | Change venue state (active / degraded / down) |
| `list_scenarios` | Enumerate available scenarios |

---

## Scenarios (13)

| Scenario | Description |
|----------|-------------|
| `morning_triage` | Pre-market sweep, overnight stuck orders, reference-data validation |
| `preopen_auction_0900` | Opening cross imbalance, MOO/LOO flow |
| `open_volatility_0930` | Opening-bell volume surge, algo slippage, SLA risk |
| `twap_slippage_1000` | TWAP algo drifting from benchmark |
| `venue_degradation_1030` | NYSE Mahwah switch failure, 180ms latency, $4.1M stuck |
| `ssr_and_split_1130` | Short-sale restriction + corporate-action split |
| `vwap_vol_spike_1130` | VWAP algo vs mid-day volume spike |
| `iex_recovery_1400` | IEX session recovery after gateway bounce |
| `is_dark_failure_1415` | Dark-pool interlisted routing failure |
| `eod_moc_1530` | MOC auction imbalance, close-out flow |
| `afterhours_dark_1630` | After-hours dark-pool routing |
| `predawn_adrs_0430` | ADR pricing drift before EU open |
| `bats_startup_0200` | BATS gateway cold-start session establishment |

---

## AI Copilot

The SRE Copilot is pre-loaded with FIX-protocol domain knowledge:

- Full decision tree for session diagnostics (MsgSeqNum gaps, ResendRequest/SequenceReset, heartbeat failures)
- Scenario-specific context overlays (e.g., venue_degradation ships with Mahwah switch topology context)
- All 22 tools documented inline with when-to-use guidance
- Approval gates for irreversible operations (sequence resets, production order cancellation)

Source: [`src/store/prompts.ts`](src/store/prompts.ts)

Any OpenRouter-compatible model works. Default: `qwen/qwen3.6-plus`.

---

## MCP Integration (external clients)

```json
{
  "mcpServers": {
    "fix-mcp": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-remote@latest"],
      "env": { "MCP_URL": "http://localhost:8000/mcp" }
    }
  }
}
```

---

## REST API

All endpoints at `http://localhost:8000/api`:

| Endpoint        | Method | Description                                        |
|-----------------|--------|----------------------------------------------------|
| `/api/status`   | GET    | System status, venues, scenario, order counts     |
| `/api/orders`   | GET    | Full order list                                    |
| `/api/events`   | GET    | System event log                                   |
| `/api/tool`     | POST   | Execute MCP tool `{ "tool": "name", "arguments": {} }` |
| `/api/reset`    | POST   | Load scenario `{ "scenario": "name" }`             |
| `/api/mode`     | GET/POST | Copilot mode: human / agent / mixed              |

---

## Project Structure

```
fix-mcp-server/
├── docker-compose.yml          # Full stack: console + api + mcp + pg + redis
├── Dockerfile                  # Python backend image
├── Dockerfile.console          # Next.js frontend image
├── package.json                # Frontend deps
├── pyproject.toml              # Backend deps
├── src/
│   ├── fix_mcp/                # Python backend
│   │   ├── server.py           # MCP server + REST API
│   │   └── engine/
│   │       ├── scenarios.py    # Scenario engine
│   │       ├── exchange_sim.py # FIX exchange simulator
│   │       ├── broker_host.py  # Smart order router
│   │       ├── market_data.py  # Market-data hub
│   │       ├── interlist.py    # Interlisted-symbol resolver
│   │       └── telemetry.py    # Telemetry collector
│   ├── app/                    # Next.js frontend
│   │   ├── page.tsx            # Dashboard + runbooks
│   │   └── api/[[...path]]/route.ts  # Backend proxy
│   ├── components/
│   │   ├── FixTerminal.tsx     # Interactive CLI
│   │   ├── McpAuditLog.tsx     # Real-time tool-call log
│   │   ├── TopologyGraph.tsx   # Network topology
│   │   ├── HeartbeatPanel.tsx  # Venue heartbeats
│   │   ├── OrderDashboard.tsx  # Order table
│   │   ├── TelemetryDashboard.tsx
│   │   └── ChatPanel.tsx       # SRE Copilot
│   └── store/
│       ├── index.ts            # Zustand system + chat state
│       ├── prompts.ts          # FIX domain knowledge for LLM
│       └── audit.ts            # MCP audit log
└── config/scenarios/           # 13 scenario JSON files
```

---

## Tech Stack

- **Backend:** Python 3.11, MCP SDK, asyncio, stdlib `http.server`
- **Frontend:** Next.js 16, React 19, React Flow, Zustand 5, Tailwind CSS v4
- **Infra:** PostgreSQL 16 (order store), Redis 7 (pub/sub), Docker Compose
- **Protocol:** FIX 4.2 / 4.4 simulation
- **AI:** OpenRouter API (any compatible model; default `qwen/qwen3.6-plus`)

---

## Development

Want to run frontend and backend on the host directly?

```bash
# Backend (Python)
pip install -e .
python -m fix_mcp.server        # MCP stdio
python -m fix_mcp.api           # REST on :8000

# Frontend (Node)
npm install
npm run dev                     # Next.js on :3000
```

The Next.js route handler (`src/app/api/[[...path]]/route.ts`) reads `BACKEND_URL` — defaults to `http://127.0.0.1:8000` for local dev.

---

## License

MIT

---

Built by Henry Urlo.

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
| Mission Control | http://localhost:3000  | Sleek trading ops dashboard with scenario lifecycle |
| REST API  | http://localhost:8000  | MCP tool dispatch, system status   |
| MCP stdio | docker compose run      | For AI agents via MCP protocol     |

No Node or Python on your host — everything runs in containers.

---

## Mission Control

Three tabs:

| Tab | Purpose |
|-----|---------|
| **Mission Control** | Live topology, FIX heartbeat panel, scenario picker + interactive terminal |
| **Telemetry** | Real-time metrics — sparklines, order book, FX rates |
| **Scenario Library** | Browse all scenarios by severity/difficulty, inspect runbooks, success criteria |

### Core Layout

```
┌──────────────────┬─────────────────────────────────────┐
│ Topology Graph   │ FIX Terminal                        │
│ (ecosystem)      │ fix-cli> show sessions              │
│                  │ fix-cli> query orders               │
├──────────────────┼─────────────────────────────────────┤
│ Runbook Panel    │ MCP Audit Log                       │
│ (live steps)     │ [+ SRE Copilot slides in →]         │
└──────────────────┴─────────────────────────────────────┘
```

---

## Scenarios

**13 training scenarios** covering a full trading day (02:00–16:32 ET). Each includes:
- **Runbook** — 4-6 diagnostic/fix steps with exact MCP tool calls
- **Success criteria** — explicit conditions that define "resolved"
- **Hints** — key problems, flag meanings, common mistakes
- **Severity & difficulty** — from beginner to advanced

| Scenario | Severity | Time | Est |
|----------|----------|------|-----|
| `morning_triage` | Critical | 06:15 | 25m |
| `bats_startup_0200` | Medium | 02:05 | 15m |
| `predawn_adrs_0430` | Medium | 04:35 | 15m |
| `preopen_auction_0900` | High | 09:02 | 20m |
| `open_volatility_0930` | High | 09:35 | 20m |
| `venue_degradation_1030` | Critical | 10:32 | 30m |
| `twap_slippage_1000` | High | 10:05 | 20m |
| `ssr_and_split_1130` | Critical | 11:34 | 35m |
| `vwap_vol_spike_1130` | Critical | 11:35 | 25m |
| `iex_recovery_1400` | Medium | 14:03 | 15m |
| `is_dark_failure_1415` | High | 14:15 | 25m |
| `eod_moc_1530` | High | 15:31 | 20m |
| `afterhours_dark_1630` | Medium | 16:32 | 15m |

---

## MCP Tools (22)

| Category | Tools |
|----------|-------|
| **Diagnostic** | `run_premarket_check`, `check_fix_sessions`, `check_ticker`, `query_orders`, `validate_orders`, `dump_session_state` |
| **Session Recovery** | `fix_session_issue`, `session_heartbeat`, `reset_sequence` |
| **Order Actions** | `send_order`, `cancel_replace`, `release_stuck_orders` |
| **Algo Suite** | `send_algo_order`, `check_algo_status`, `modify_algo`, `cancel_algo` |
| **Reference/Venue** | `update_ticker`, `load_ticker`, `update_venue_status`, `list_scenarios` |

---

## AI Copilot

The SRE Copilot is FIX-aware with:
- Full decision trees for session diagnostics, order triage, and algo management
- Scenario-specific context injection (situation, key problems, flag meanings, common mistakes, success criteria)
- Tool call approval gates for irreversible operations
- Concise, actionable output — quantitative impact with FIX message types

---

## Architecture

```
┌──────────────────────────────────────────────┐
│              Mission Control (Next.js)       │
│          http://localhost:3000               │
└──────────────────────┬───────────────────────┘
                       │ REST proxy
┌──────────────────────▼───────────────────────┐
│              REST API                        │
│         http://localhost:8000                │
│  /api/status /api/orders /api/                │
│  /api/scenarios /api/scenario/{name}         │
│  /api/tool (POST) /api/reset (POST)          │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│        FIX Engine (Python)                   │
│  OMS · FIXSessionManager                     │
│  ReferenceDataStore · AlgoEngine             │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│  PostgreSQL (orders) · Redis (pub/sub)       │
└──────────────────────────────────────────────┘
```

---

## Tech Stack

- **Backend:** Python 3.11, MCP SDK, asyncio, stdlib `http.server`
- **Frontend:** Next.js 16, React 19, React Flow, Zustand 5, Tailwind CSS v4, lucide icons
- **Infra:** PostgreSQL 16, Redis 7, Docker Compose
- **Protocol:** FIX 4.2 / 4.4 simulation
- **AI:** OpenRouter API (any compatible model; default `qwen/qwen3.6-plus`)

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

## Development

```bash
# Backend (Python)
pip install -e .
python -m fix_mcp.api           # REST on :8000

# Frontend (Node)
npm install
npm run dev                     # Next.js on :3000
```

The Next.js route handler reads `BACKEND_URL` — defaults to `http://127.0.0.1:8000` for local dev.

---

Built by Henry Urlo.

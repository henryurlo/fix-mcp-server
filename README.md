# FIX-MCP

FIX protocol simulation platform for capital markets operations. AI-powered SRE copilot with real-time diagnostics, incident runbooks, and MCP tool integration for trading infrastructure management.

## What It Does

A production-grade simulation environment built on the FIX (Financial Information eXchange) Protocol. Combines real-time monitoring, CLI operations, automated diagnostics, and AI-assisted incident resolution.

**Core capabilities:**

- 13 pre-built incident scenarios (session failures, order routing bugs, venue degradation, cascading crises)
- 14+ MCP tools for FIX session management, order operations, and infrastructure diagnostics
- Interactive CLI terminal with full FIX filesystem navigation
- Real-time topology visualization and telemetry
- AI SRE copilot with scenario-aware context and tool execution
- MCP Audit Log showing every tool call in real-time
- Step-by-step incident runbooks with CLI commands and one-click execution

## Quick Start

### Requirements

- Docker and Docker Compose
- Node.js 22+ (for frontend)
- Python 3.12+ (for backend)

### Backend

```bash
git clone https://github.com/henryurlo/fix-mcp-server.git
cd fix-mcp-server
docker compose up -d
```

The API server runs on `http://localhost:8000`.

### Frontend

```bash
git clone https://github.com/henryurlo/fix-console.git
cd fix-console
npm install
npm run build
npx next start -p 3006
```

Open `http://localhost:3006`. Login: `henry` / `henry` (admin) or click **Demo Mode**.

## Architecture

```
┌──────────────────┬──────────────────────────────────┐
│ Compact Topology │ FIX CLI Terminal                  │
│ + Heartbeats     │ fix-cli> show sessions            │
│ + Scenario Picker│ fix-cli> dump NYSE                │
├──────────────────┼──────────────────────────────────┤
│ Incident Runbook │ MCP Audit Log                     │
│ (step-by-step)   │ [16:23] ▶ check_fix_sessions     │
│                  │ [16:23] ✓ NYSE: ACTIVE (3ms)      │
└──────────────────┴──────────────────────────────────┘
         + SRE Copilot (slide-in panel, right)
         + Telemetry tab (sparklines, order book, FX)
         + Scenario Creator tab
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `check_fix_sessions` | Check all FIX venue session status |
| `query_orders` | Query orders with filters (status, venue, symbol) |
| `send_order` | Submit a new order |
| `cancel_replace` | Cancel or replace an existing order |
| `fix_session_issue` | Fix session: reconnect, reset sequence, resend request |
| `update_venue_status` | Change venue status (active/degraded/down) |
| `release_stuck_orders` | Release orders stuck in queue |
| `validate_orders` | Validate order reference data |
| `run_premarket_check` | Full pre-market health sweep |
| `session_heartbeat` | Manual heartbeat check for a venue |
| `reset_sequence` | Reset FIX sequence numbers |
| `dump_session_state` | Full session diagnostic dump |
| `tail_logs` | Tail FIX session log files |
| `grep_logs` | Search FIX log files by pattern |

## CLI Terminal

The built-in terminal supports:

```bash
fix-cli> show sessions              # FIX session status
fix-cli> show orders --venue NYSE   # filter orders
fix-cli> send order TSLA BUY 100 @185.50 NYSE
fix-cli> heartbeat BATS             # venue heartbeat
fix-cli> dump NYSE                  # full diagnostic
fix-cli> parse 8=FIX.4.2|35=D|49=FIRM_A|56=NYSE|55=AAPL|54=1|38=500
fix-cli> tail /opt/fix/logs/NYSE-PROD-01.log 50
fix-cli> grep 35=D /opt/fix/logs/*.log
fix-cli> cat /opt/fix/config/sessions.xml
fix-cli> ls /opt/fix/sessions/
fix-cli> cd /opt/fix/logs && cat NYSE-PROD-01.log
fix-cli> scenario load venue_degradation_1030
```

## Scenarios

| Scenario | Description |
|----------|-------------|
| `morning_triage` | Pre-market health sweep, overnight stuck orders, reference data validation |
| `venue_degradation_1030` | NYSE Mahwah switch failure, 180ms latency, 14 stuck orders ($4.1M) |
| `open_volatility_0930` | Opening bell volume surge, algo slippage, SLA breach risk |
| + 10 more | Session drops, FX corruption, interlisted routing, dark pool failures |

## API

All endpoints at `http://localhost:8000/api`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | System status, venues, scenario, order counts |
| `/api/orders` | GET | Full order list |
| `/api/events` | GET | System event log |
| `/api/tool` | POST | Execute MCP tool `{ "tool": "name", "arguments": {} }` |
| `/api/reset` | POST | Load scenario `{ "scenario": "name" }` |
| `/api/mode` | GET/POST | Operational mode (human/agent) |

## MCP Integration

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

## Project Structure

```
fix-mcp-server/
├── docker-compose.yml
├── Dockerfile
├── src/fix_mcp/
│   ├── server.py              # MCP server + REST API
│   ├── engine/
│   │   ├── scenarios.py       # Scenario engine
│   │   ├── exchange_sim.py    # FIX exchange simulator
│   │   ├── broker_host.py     # Smart order router
│   │   ├── market_data.py     # Market data hub
│   │   ├── interlist.py       # Interlisted symbol resolver
│   │   └── telemetry.py       # Telemetry collector
│   └── ...
└── config/scenarios/          # 13 scenario JSON definitions

fix-console/
├── src/
│   ├── app/page.tsx           # Main dashboard + runbooks
│   ├── components/
│   │   ├── FixTerminal.tsx    # Interactive CLI
│   │   ├── McpAuditLog.tsx    # Real-time tool call log
│   │   ├── TopologyGraph.tsx  # Network topology
│   │   ├── HeartbeatPanel.tsx # Venue heartbeats
│   │   ├── OrderDashboard.tsx # Order table
│   │   ├── TelemetryDashboard.tsx
│   │   ├── ChatPanel.tsx      # SRE Copilot
│   │   └── ...
│   └── store/                 # Zustand state (system, auth, telemetry, audit)
└── package.json
```

## Tech Stack

- **Backend:** Python, FastAPI, MCP SDK, asyncio
- **Frontend:** Next.js 16, React 19, React Flow, Zustand, Tailwind CSS
- **Protocol:** FIX 4.2/4.4 simulation
- **AI:** OpenRouter API (configurable model, default `qwen/qwen3.6-plus`)

## License

MIT

---

Built by Henry Urlo.

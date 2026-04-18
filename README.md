<p align="center">
  <pre>
███████╗██╗    ██╗ ██████╗██╗██████╗ ███████╗
██╔════╝██║    ██║██╔════╝██║██╔══██╗██╔════╝
█████╗  ██║ █╗ ██║██║     ██║██║  ██║█████╗
██╔══╝  ██║███╗██║██║     ██║██║  ██║██╔══╝
███████╗╚███╔███╔╝╚██████╗██║██████╔╝███████╗
╚══════╝ ╚══╝╚══╝  ╚═════╝╚═╝╚═════╝ ╚══════╗
      FIX Protocol MCP Server                 ║
      ▸ AI Operations Theater for Trading Ops ║
  ════════════════════════════════════════════╝
  </pre>
  <b>Trading intelligence & FIX Protocol simulation for AI agents</b><br>
  <sub>13 Scenarios · 15 Tools · Real-time Diagnostics · Live Simulations</sub>
</p>

---

## 🎯 What is this?

FIX MCP is an **AI Operations Theater** — a fully interactive trading simulator built on the FIX (Financial Information eXchange) Protocol. It gives AI agents a realistic sandbox to diagnose, fix, and recover from trading infrastructure crises.

Think of it as a **cyber range for capital markets** — instead of attacking networks, you're fixing broken FIX sessions, rescuing stuck orders, and navigating cascading infrastructure failures.

## ✨ Features

| Feature | Details |
|---|---|
| **🎬 13 Scenarios** | Pre-built simulations covering session failures, order routing bugs, algo malfunctions, and cascading crises |
| **🔧 15 Tools** | `check_fix_sessions`, `fix_session_issue`, `list_orders`, `fix_stuck_order`, `fix_order`, `cancel_order`, and more |
| **📊 Live Dashboard** | Real-time order book, event stream, scoring panel, and session topology visualization |
| **⏱️ Play Day Timeline** | Full trading day simulation (T+0 through market close) with scenario-specific timing |
| **🏆 Scoring System** | Objective-based point system with pro tips for optimal playthroughs |
| **🐙 MCP Integration** | Native Model Context Protocol support — AI agents can call tools directly |

## 🚀 Quick Start

### Prerequisites
- **Docker & Docker Compose** — required for all services
- **Python 3.10+** (optional, for direct backend testing)

### Run the Full Stack

```bash
# Clone & start
git clone https://github.com/henryurlo/fix-mcp-server.git && cd fix-mcp-server

# Start all services (MCP server + frontend)
docker compose up -d

# Check status
docker compose logs -f
```

### Frontend UI (standalone)

```bash
# Serve the interactive simulator directly (no Docker needed for UI only)
cd fix-console

# Option 1: via Python simple server
python3 serve.py        # → http://localhost:8088

# Option 2: direct file
# Just open frontend.html in any browser
```

The frontend auto-connects to the backend at `localhost:8000`.

### MCP Integration with AI Agents

Create or update your `.mcp.json`:

```json
{
  "mcpServers": {
    "fix-mcp": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-remote@latest"],
      "env": {
        "MCP_URL": "http://localhost:8000/mcp"
      }
    }
  }
}
```

Agents can then call FIX Protocol tools directly:

```
✓ check_fix_sessions  → Diagnose broken sessions
✓ fix_session_issue   → Auto-resolve session problems
✓ list_orders         → View all orders (open, stuck, completed)
✓ fix_stuck_order     → Rescue stuck orders by ID
✓ fix_order           → Fix routing, quantity, price errors
✓ send_order          → Place new orders with parameters
✓ cancel_replace      → Cancel/replace existing orders
```

## 🎮 How to Play

1. **Pick a scenario** from the selection grid (each has a briefing, objectives, point values)
2. **Diagnose the issue** — check FIX sessions first (most problems cascade from session failures)
3. **Use the tools** — execute diagnostics, apply fixes, verify recovery
4. **Complete objectives** — each scenario has specific goals worth points
5. **Track your score** — the sidebar panel shows completed objectives and total score

**Pro tip:** Fix broken FIX sessions first. Many stuck orders are caused by session issues. Use `check_fix_sessions` to diagnose, then `fix_session_issue` to resolve.

## 📁 Project Structure

```
fix-mcp-server/
├── docker-compose.yml          # Orchestration: mcp-server, db, redis
├── Dockerfile                  # MCP server container
├── .mcp.json                   # Claude Code MCP config
├── src/fix_mcp/
│   ├── api.py                  # REST API + /api/tool endpoint
│   ├── engine/
│   │   ├── scenarios.py        # 13 scenario definitions
│   │   └── engine.py           # Simulation engine
│   └── mcp_server.py           # MCP server entry point
│
fix-console/
├── frontend.html               # Standalone single-file React app (29K)
├── serve.py                    # Dev server with /api/* proxy → :8000
├── src/                        # Next.js source (full project)
│   ├── components/
│   │   ├── ChatPanel.tsx
│   │   ├── ScenarioSelector.tsx
│   │   └── TopologyGraph.tsx
│   └── store/
│       └── index.ts            # State management
└── CLAUDE.md                   # AI agent context
```

## 🔧 API Reference

All endpoints at `http://localhost:8000/api`

| Endpoint | Method | Description |
|---|---|---|
| `/api/scenarios` | GET | List available scenarios (name, brief, time, difficulty) |
| `/api/status` | GET | System status + tool listing |
| `/api/tool` | POST | Execute a tool (requires `{"tool_name":"...", "arguments":{}}`) |

**⚠️ API Quirks:**
- `POST /api/tool` expects `"arguments"` key (not `"args"`)
- `send_order` requires `"quantity"` (not `"qty"`)
- No standalone `cancel_order` — use `cancel_replace` with `{"action":"cancel"}`

## 🤝 Contributing

This is an active project. Issues, fixes, and scenario contributions welcome.

1. Fork it
2. Create your branch (`git checkout -b feature/your-scenario`)
3. Commit your changes
4. Push and open a PR

## 📜 License

MIT

---

<p align="center">
  <sub>Built by Henry Urlo · FIX Protocol MCP Server v0.1.0</sub>
</p>

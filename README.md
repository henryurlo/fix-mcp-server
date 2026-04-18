# AI Operations Theater

FIX protocol simulation and AI operations control surface for capital markets. A cinematic governance layer where AI agents diagnose, propose, and execute trading infrastructure recovery under human approval.

## Overview

An interactive simulation environment built on the FIX (Financial Information eXchange) Protocol that combines observability, workflow automation, human approval, and agent reasoning in a single experience.

Key capabilities:

- 13 pre-built incident scenarios covering session failures, order routing bugs, and cascading infrastructure crises
- 15 FIX protocol tools for diagnostics, remediation, and order management
- Real-time topology visualization with health overlays
- Agent copilot with tool-call traces and approval gates
- Audit replay comparing human vs. AI-assisted incident resolution

## Quick Start

### Requirements

- Docker and Docker Compose
- Python 3.10+ (optional, for direct backend testing)

### Full Stack

```bash
git clone https://github.com/henryurlo/fix-mcp-server.git
cd fix-mcp-server
docker compose up -d
docker compose logs -f
```

### Standalone Frontend

```bash
cd fix-console
python3 serve.py        # http://localhost:8088
```

The frontend connects to the backend at `localhost:8000`.

## MCP Integration

Configure your `.mcp.json`:

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

Available tools: `check_fix_sessions`, `fix_session_issue`, `list_orders`, `fix_stuck_order`, `fix_order`, `send_order`, `cancel_replace`, and others.

## API

All endpoints at `http://localhost:8000/api`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/scenarios` | GET | List available scenarios |
| `/api/status` | GET | System status and tool listing |
| `/api/tool` | POST | Execute a tool |

Note: `POST /api/tool` requires the `"arguments"` key. `send_order` uses `"quantity"`, not `"qty"`. There is no `cancel_order` tool -- use `cancel_replace` with `{"action": "cancel"}`.

## Project Structure

```
fix-mcp-server/
  docker-compose.yml        -- service orchestration
  Dockerfile                -- MCP server container
  src/fix_mcp/
    api.py                  -- REST API
    engine/scenarios.py     -- scenario definitions
    engine/engine.py        -- simulation engine
    mcp_server.py           -- MCP entry point

fix-console/
  frontend.html             -- standalone single-file React app
  serve.py                  -- dev server with /api proxy
  src/                      -- Next.js project
    components/             -- ChatPanel, ScenarioSelector, TopologyGraph
    store/                  -- Zustand state management
```

## License

MIT

---

Built by Henry Urlo.

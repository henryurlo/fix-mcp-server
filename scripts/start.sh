#!/usr/bin/env bash
# FIX MCP — Full Stack (Mission Control UI + API + MCP Server)
#
# Usage:
#   docker compose up -d          # Container mode (recommended)
#   ./scripts/start.sh            # Native mode (Python + Next.js on host)
#
# Environment:
#   SCENARIO=morning_triage ./scripts/start.sh
#
# Then open: http://localhost:3000  (Mission Control)
#            http://localhost:8000  (REST API)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== FIX-MCP — Native Dev Mode ==="

# Bootstrap venv on first run
if [ ! -f ".venv/bin/python" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

.venv/bin/python -c "import fix_mcp" 2>/dev/null   || XDG_CACHE_HOME=/tmp .venv/bin/python -m pip install -e . --no-build-isolation -q

# Start API in background
echo "Starting API server on :8000..."
SCENARIO="${SCENARIO:-morning_triage}" .venv/bin/python -m fix_mcp.api --host 0.0.0.0 --port 8000 &
API_PID=$!

# Install Node deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing Node dependencies..."
  npm install
fi

# Start Next.js dev server
echo "Starting Mission Control UI on :3000..."
npx next dev --port 3000 &
NEXT_PID=$!

trap "kill $API_PID $NEXT_PID 2>/dev/null; exit" INT TERM

echo ""
echo "Mission Control: http://localhost:3000"
echo "REST API:        http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop."
wait

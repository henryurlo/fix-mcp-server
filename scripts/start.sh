#!/usr/bin/env bash
# FIX MCP — start the dashboard (API embedded, single port).
#
# Usage:
#   ./scripts/start.sh
#   SCENARIO=twap_slippage_1000 ./scripts/start.sh
#
# Then open: http://localhost:8080

set -euo pipefail
cd "$(dirname "$0")/.."

# Bootstrap venv on first run
[ -f ".venv/bin/python" ] || python3 -m venv .venv
.venv/bin/python -c "import fix_mcp" 2>/dev/null \
  || XDG_CACHE_HOME=/tmp .venv/bin/python -m pip install -e . --no-build-isolation -q

echo "Open: http://localhost:8080"
SCENARIO="${SCENARIO:-morning_triage}" .venv/bin/python -m fix_mcp.dashboard

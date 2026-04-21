# FIX-MCP Dashboard Research

## Setup

To set up a new experiment run:

1. **Read the current state**: Check the files below
2. **Verify Docker is running**: `docker ps` should show fix-mcp-console, fix-mcp-api, fix-mcp-postgres, fix-mcp-redis
3. **Run the experiment runner**: `python ~/fix-mcp-server/scripts/run_experiment.py`

Once the baseline is confirmed, begin the experimentation loop.

## The goal

Improve the FIX-MCP trading operations dashboard in three areas:

**1. Scenario quality and correctness** — Every scenario should pass all its runbook steps. The API should return correct data. No "could not reload" crashes when switching scenarios. Steps should have clear, actionable titles and descriptions.

**2. UI/UX completeness** — The dashboard should work with all scenarios. Control mode buttons (Human, Co-Pilot, Agent) should have tooltips. Lock/unlock should prevent scenario switching. Reset should clear everything. The runbook should present steps in a clear, non-overwhelming way.

**3. Functional correctness** — Every runbook step's tool call should succeed, return meaningful output, and leave the system in the expected state.

## Files in-scope

These are the files the experiment MODIFY:

- `src/app/page.tsx` - Main dashboard layout, runbook panel, control modes
- `src/store/index.ts` - State management, scenario loading, step tracking
- `src/components/*.tsx` - All React components (AuditLog, TopologyGraph, ChatPanel, RunbookPanel, etc.)
- `config/scenarios/*.json` - Scenario definitions (fix broken fields, improve clarity)

## Files out-of-scope (DO NOT modify unless the Python API is broken)

- `src/fix_mcp/server.py` - The MCP server (stable, 64 tests)
- `src/fix_mcp/engine/*.py` - Backend engine code
- `docker-compose.yml` - Infrastructure config
- `tests/*.py` - Existing tests (you can add new ones though)

## The experiment loop

LOOP FOREVER:

1. **Run the experiment**: `cd ~/fix-mcp-server && python ~/fix-mcp-server/scripts/run_experiment.py > run.log 2>&1`
2. **Read results**: `cat run.log` — check which scenarios passed, which failed, avg score
3. **Analyze failures**: Look at step errors. Is it a tool bug? Schema issue? UI bug?
4. **Fix and improve**: Modify the relevant files to fix bugs, improve UX, clear runbooks
5. **Test**: Run the experiment again to verify improvements
6. **Log results**: Append to `results.tsv` (tab-separated)

## results.tsv format

Tab-separated, columns: `experiment_number	score	passed_scenarios	total	scenario_fixes	ui_changes	description`

```
experiment_number	score	passed_scenarios	total	scenario_fixes	ui_changes	description
1	0.750	10/13	13	1	0	Fixed midday_chaos JSON schema (n→step, action→title)
2				
```

## Key issues to fix first

1. **"Could not reload" crash** when switching scenarios — check scenario API returns, frontend routing
2. **midday_chaos scenario** had wrong field names (n/action/expect instead of step/title/tool_args/expected) — might need more fixes
3. **Runbook steps** sometimes show no title or empty descriptions — check all 14 scenarios
4. **Hints** format varies between scenarios — some have flag_meanings, some don't
5. **Success criteria** sometimes in runbook object, sometimes at top-level

## Important

- The Docker container serves the app at http://localhost:3000
- The API serves at http://localhost:8000
- After modifying frontend files, you MUST rebuild Docker: `cd ~/fix-mcp-server && docker compose build console && docker compose up -d console`
- After modifying Python files, you MUST rebuild Docker: `cd ~/fix-mcp-server && docker compose build && docker compose up -d`
- The experiment runner (`scripts/run_experiment.py`) loads each scenario via REST API, runs every runbook step in order, and reports pass/fail

- **NEVER STOP**: Keep iterating until you are manually stopped. You are autonomous. If you run out of ideas, try harder — read the scenario JSON files, read the runbook narratives, try combining fixes, try more radical changes.

## Success metrics

- **100% scenario pass rate** — all scenarios complete all runbook steps
- **No crashes** — scenario switching works without page reload errors
- **Clean runbooks** — every step has title, narrative, expected output, and tool call
- **Better UX** - the dashboard is more intuitive to use

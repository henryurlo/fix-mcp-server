# 75-Second Incident Replay Script

This is the primary launch video. It is not a feature tour. It is one incident replay, calmly narrated, with the product doing the work on screen.

## Scenario

Use `bats_startup_0200`.

The story is simple: BATS rejects Logon after a maintenance reset, overnight GTC orders are blocked, missing ETF symbols add reference-data pressure, and the human approves the workbook before the agent acts.

## Shot List

| Time | Screen | Narration |
|---|---|---|
| 0:00-0:07 | Dashboard idle, incident catalog visible. | "AI agents can write FIX messages. They still need trading-ops judgment. FIX-MCP gives them a controlled way to investigate, recover, and prove the work." |
| 0:07-0:16 | Load `BATS Extended-Hours Startup`. Incident brief fills the desk. | "Here the desk loads a 2:05 AM BATS startup incident: sequence mismatch, blocked GTC orders, and missing ETF reference data." |
| 0:16-0:27 | Click Investigator. Copilot panel opens and begins triage. | "The operator starts with investigation. The agent checks sessions, orders, and reference data through MCP tools instead of guessing from a prompt." |
| 0:27-0:40 | Show workbook steps, then approve workbook. | "The agent proposes a workbook. The human approves the whole recovery plan before any state-changing command runs." |
| 0:40-0:53 | Agent Run executes. Steps flip complete. Progress reaches resolved. | "Now the approved runbook executes: reconnect BATS, reset sequence if needed, load the missing ETF symbols, and verify the orders are released." |
| 0:53-1:03 | Open Trace tab. Tool inputs and outputs are visible. | "Every tool call leaves evidence: inputs, outputs, FIX context, and the manual command equivalent." |
| 1:03-1:12 | Run Stress Test with a controlled reject spike. | "Only after the baseline incident is understood, the operator injects pressure to test resilience and watch the agent re-triage." |
| 1:12-1:15 | Final frame: README/GitHub URL and contact. | "FIX-MCP is open source. Built for trading desks that need AI with controls, not magic." |

## Recording Notes

- Use the light professional theme.
- Keep captions on.
- Keep the copilot panel visible when the agent is working.
- Do not show every scenario. The scenario catalog is a supporting screen, not the story.
- Do not spend time explaining Stress Test controls before the baseline recovery.
- Use Trace as the proof moment.

## Voice Direction

Brief like an engineer explaining the system to another operator at the desk. Calm, specific, no hype.

## Export Targets

- Horizontal README/YouTube cut.
- Vertical X/LinkedIn cut.
- Optional three-minute walkthrough using the same sequence with slower pacing.

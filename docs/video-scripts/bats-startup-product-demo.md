# FIX-MCP Product Demo Script: BATS Extended-Hours Startup

This is the source script for the Remotion product demo composition:

`scenario-bats-startup-0200`

The video should make sense to a viewer who has never seen the project. It should introduce the tool, show a complete incident workflow, and make the human control model obvious.

## Positioning

FIX-MCP is a professional trading-operations demo showing how an LLM can use MCP tools to investigate a live-style FIX incident, prepare a recovery workbook, and execute only after human approval.

The product is not “AI trades for you.” The product is governed incident response:

- MCP tools gather bounded evidence.
- The LLM explains the incident and proposes a workbook.
- The human approves the workbook.
- Agent Run executes only inside the approved path.
- Trace evidence proves what happened.

## Marketing Review

The first draft behaved too much like a feature tour. It said the right words, but a viewer who had never seen the project could not follow one concrete desk task from start to finish.

The corrected version is a user walkthrough. The viewer should always know where to start, what to click, what to read, what the agent learned, what the human approved, and what evidence proves the result.

## Story Arc

1. Open with the workflow the viewer will learn.
2. Start in Mission Control.
3. Select the easiest scenario: BATS Extended-Hours Startup.
4. Read the incident board before clicking recovery controls.
5. Launch the agent/investigator.
6. Inspect the MCP evidence.
7. Review the generated workbook.
8. Approve the whole workbook.
9. Run the approved recovery path.
10. Open the trace and audit the tool calls.
11. Inject a sequence gap only after the normal path is clear.
12. Confirm the simulation pauses and re-triages.
13. Recover, resume, score, and verify the outcome.
14. Close by repeating the pattern for harder scenarios.

## Timed Script

| Time | Scene | Voiceover | Screen Action |
| --- | --- | --- | --- |
| 0:00-0:10 | What you will do | “This walkthrough shows how to use FIX-MCP end to end.” | Show the product surface and the full workflow. |
| 0:10-0:20 | Open app | “Start on Mission Control.” | Highlight the Mission Control tab. |
| 0:20-0:30 | Choose scenario | “Select BATS Extended-Hours Startup.” | Cursor points to scenario selector; scenario loads. |
| 0:30-0:40 | Read board | “Before asking the agent to act, read the incident board.” | Show BATS down, 14 blocked orders, mode, and human control. |
| 0:40-0:50 | Launch agent | “Ask the agent what broke and what matters first.” | Agent conversation explains it will use MCP tools. |
| 0:50-1:00 | Inspect evidence | “Confirm the sequence mismatch and affected orders.” | Trace shows `check_fix_sessions` and `query_orders`. |
| 1:00-1:10 | Review workbook | “Read the generated recovery workbook.” | Workbook shows five explicit steps. |
| 1:10-1:20 | Approve | “Approve all only after the plan is visible.” | Approval panel appears. |
| 1:20-1:34 | Agent Run | “Run the approved workbook.” | Workbook completes; MCP evidence appears. |
| 1:34-1:44 | Audit trace | “Open the trace and verify what tools ran.” | Trace rows remain visible. |
| 1:44-1:54 | Inject | “Inject a BATS sequence gap after the normal path is clear.” | Inject Event is highlighted. |
| 1:54-2:04 | Pause | “Confirm the system pauses and re-triages.” | Mode changes to paused/re-triage. |
| 2:04-2:14 | Recover | “Repair the injected gap and resume the simulation.” | Agent Run resumes and recovery evidence appears. |
| 2:14-2:24 | Verify | “Check venue state, released orders, score, and trace.” | BATS up, 14 released, score shown. |
| 2:24-2:30 | Repeat | “Use the same flow for harder scenarios.” | Close with the reusable operating pattern. |

## Captured Evidence

The current Remotion video is backed by a real local MCP run captured at:

`docs/demo-captures/bats-startup-real-run.json`

Regenerate it with:

```bash
.venv/bin/python scripts/capture_demo_run.py
```

The capture includes scenario load, session diagnosis, order query, BATS reconnect, sequence reset, BITO/GBTC ticker loads, order validation, sequence-gap injection, re-check, recovery, resume, score report, and trace.

## Production Notes

- Keep the platform visible. Do not turn the video into a generic slide deck.
- Use one spoken idea per scene; the UI should carry the scenario.
- Keep the operator action, agent response, and MCP evidence visible at the same time.
- Approval must be visible before Agent Run.
- Injection must happen after the normal Agent Run path is clear.
- Injection must visibly interrupt the plan and trigger re-triage.
- The ending must prove outcome: recovered state plus trace evidence.

## Current Render

```bash
npm run video:render:bats
```

Output:

`out/bats-startup-executive-demo.mp4`

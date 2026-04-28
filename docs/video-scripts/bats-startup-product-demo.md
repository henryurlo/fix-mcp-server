# FIX-MCP Product Demo Script: BATS Extended-Hours Startup

This is the source script for the Remotion product demo composition:

`scenario-bats-startup-0200`

The video should make sense to a viewer who has never seen the project. It should introduce the tool by solving one complete BATS incident, not by touring features.

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

The corrected version is a BATS recovery walkthrough. The viewer should always know what desk problem is being solved, what to click next, what the agent learned, what the human approved, and what evidence proves the result.

## Story Arc

1. Open with the BATS recovery goal.
2. Start in the incident console.
3. Load BATS Extended-Hours Startup.
4. Read the incident board before asking the agent to act.
5. Launch the agent/investigator.
6. Inspect the MCP evidence.
7. Review the generated workbook.
8. Approve the bounded recovery path.
9. Run the approved recovery path with Agent Run.
10. Open the trace and audit the tool calls.
11. Inject a sequence gap only after the normal path is clear.
12. Confirm the simulation pauses and re-triages.
13. Recover, resume, score, and verify the outcome.
14. Close with BATS solved and the trace ready for review.

## Timed Script

| Time | Scene | Voiceover | Screen Action |
| --- | --- | --- | --- |
| 0:00-0:10 | Scenario goal | “Recover a failed BATS startup and prove every step.” | Show the product surface with the BATS case already framed as the task. |
| 0:10-0:20 | Operator view | “Start in the incident console.” | Highlight the active case, workbook, agent conversation, and trace surfaces. |
| 0:20-0:30 | Load case | “Load BATS Extended-Hours Startup.” | Cursor points to scenario selector; `bats_startup_0200` loads. |
| 0:30-0:40 | Read board | “Before asking the agent to act, read the board.” | Show BATS down, order scope, fallback venue, and human control. |
| 0:40-0:50 | Launch agent | “Ask what broke, what matters first, and what evidence to trust.” | Agent explains it will use MCP tools before recovery. |
| 0:50-1:00 | Inspect evidence | “Confirm the sequence mismatch and affected orders.” | Trace shows `check_fix_sessions` and `query_orders`. |
| 1:00-1:10 | Review workbook | “Read the generated recovery workbook.” | Workbook shows five explicit steps. |
| 1:10-1:20 | Approve | “Approve only after the recovery path is visible.” | Approval gate appears. |
| 1:20-1:34 | Agent Run | “Run the approved workbook.” | Workbook completes; MCP evidence appears. |
| 1:34-1:44 | Audit trace | “Open trace and verify the tools, arguments, and results.” | Trace rows remain visible. |
| 1:44-1:54 | Stress test | “Now inject a BATS sequence gap.” | Stress Test is highlighted as a controlled post-baseline event. |
| 1:54-2:04 | Re-triage | “Confirm the system pauses before continuing.” | Mode changes to paused/re-triage. |
| 2:04-2:14 | Recover | “Repair the injected gap and resume the simulation.” | Agent Run resumes and recovery evidence appears. |
| 2:14-2:24 | Verify | “Check BATS status, released orders, score, and trace.” | BATS up, 14 released, score shown. |
| 2:24-2:30 | Close | “The BATS case is solved, with evidence ready.” | Close on recovered state plus audit trail. |

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
- Use one spoken idea per scene; the UI should carry the scenario. Avoid generic phrases like “powerful AI workflow” or “feature tour.”
- Keep the operator action, agent response, and MCP evidence visible at the same time.
- Approval must be visible before Agent Run.
- Label the injection section and visible control as Stress Test.
- Injection must happen after the normal Agent Run path is clear.
- Injection must visibly interrupt the plan and trigger re-triage.
- The ending must prove outcome: recovered state plus trace evidence.

## Current Render

```bash
npm run video:render:bats
```

Output:

`out/bats-startup-executive-demo.mp4`

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

The corrected version is a scenario walkthrough. The viewer should always know who is acting, what they clicked, what the agent learned, what the human approved, and what evidence proves the result.

## Story Arc

1. Open with the promise: one incident, one agent, one human approval.
2. Start in Mission Control and load the easiest scenario: BATS Extended-Hours Startup.
3. Ask the agent what broke, using MCP evidence rather than generic narration.
4. Review and approve the whole recovery workbook.
5. Run the approved recovery path.
6. Inject a sequence gap only after the normal path is clear.
7. Re-check, recover, resume, score, and close with trace evidence.

## Timed Script

| Time | Scene | Voiceover | Screen Action |
| --- | --- | --- | --- |
| 0:00-0:03 | Promise | “One incident. One agent. One human approval.” | Show the product surface behind a short title card. |
| 0:03-0:06 | Product model | “This is not autonomous trading. It is governed incident response.” | Reveal Mission Control, workbook, agent conversation, and trace. |
| 0:06-0:12 | Load scenario | “The desk starts by loading BATS Extended-Hours Startup.” | Cursor points to scenario selector; BATS down and 14 blocked orders are visible. |
| 0:12-0:21 | Investigate | “The operator asks the agent what broke. MCP tools check sessions and orders.” | Agent conversation names the sequence mismatch; trace adds real tool rows. |
| 0:21-0:29 | Approve | “The agent proposes five recovery steps. The human approves the workbook as a whole.” | Approval panel appears; all workbook steps are visible before execution. |
| 0:29-0:41 | Execute | “Agent Run reconnects BATS, resets sequence state, loads missing ETF symbols, and validates the book.” | Workbook turns green; trace shows captured MCP results. |
| 0:41-0:48 | Inject pressure | “Now we inject a sequence gap to prove the loop can handle pressure.” | Inject Event is highlighted; mode changes to paused; trace records `inject_event`. |
| 0:48-0:56 | Recover | “The agent re-checks state, repairs the injected gap, and resumes the simulation.” | Agent Run is highlighted again; recovery and resume evidence appear. |
| 0:56-1:00 | Close | “The close is a proof package: released flow, recovered venue, score, and trace.” | Final state shows BATS up, 14 released, score, and trace without hiding the platform. |

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

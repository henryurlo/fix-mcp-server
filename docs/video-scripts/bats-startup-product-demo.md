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

## Story Arc

1. Present the product and the incident.
2. Diagnose with MCP tools.
3. Approve the workbook.
4. Run the agent inside the approved boundary.
5. Inject pressure to prove the system can re-triage.
6. Re-check, recover, resume, and close with evidence.

## Timed Script

| Time | Scene | Voiceover | Screen Action |
| --- | --- | --- | --- |
| 0:00-0:04 | Product intro | “FIX-MCP is AI incident response for a trading desk.” | Show the platform behind a short title card. |
| 0:04-0:09 | Product model | “MCP tools gather evidence. An LLM builds the workbook. A human approves the plan before Agent Run executes.” | Reveal the live incident console. |
| 0:09-0:14 | Load incident | “The user begins in Mission Control by selecting BATS Extended-Hours Startup.” | Show scenario selector, BATS logon rejected, blocked orders, venue state, and owner. |
| 0:14-0:23 | Diagnose | “The first action is to launch the agent/investigator, not inject pressure. It checks sessions and orders through MCP.” | Workbook steps advance; real trace rows appear from the captured run. |
| 0:23-0:30 | Approval gate | “The agent proposes the recovery workbook. The operator reviews the evidence and approves the whole plan before execution.” | Show the approval modal and the human gate. |
| 0:30-0:39 | Agent Run | “After approval, Agent Run reconnects BATS, resets sequence state, loads BITO and GBTC, and validates 14 orders.” | Highlight Agent Run, show completed workbook and trace evidence. |
| 0:39-0:51 | Stress injection | “Only after the normal run do we inject a BATS sequence gap to prove the system pauses and re-triages.” | Highlight Inject Stress, show `EVENT INJECTED: seq_gap`, mark the plan paused. |
| 0:51-1:00 | Proof close | “The agent re-checks BATS, resolves the injected sequence gap, resumes simulation, and closes with score plus trace.” | Show resumed simulation, score report, BATS up, evidence ready, and the final proof card. |

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
- Use one spoken idea per scene.
- Use short callouts to direct the eye, not to explain the whole product.
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

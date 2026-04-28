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
4. Inject pressure to prove the system can re-triage.
5. Run the agent inside the approved boundary.
6. Close with evidence.

## Timed Script

| Time | Scene | Voiceover | Screen Action |
| --- | --- | --- | --- |
| 0:00-0:04 | Product intro | “FIX-MCP is AI incident response for a trading desk.” | Show the platform behind a short title card. |
| 0:04-0:09 | Product model | “MCP tools gather evidence. An LLM builds the workbook. A human approves the plan before Agent Run executes.” | Reveal the live incident console. |
| 0:09-0:14 | Load incident | “A desk operator loads a live-style FIX incident. The AI can investigate, but production control stays with the human.” | Show BATS logon rejected, blocked orders, venue state, and owner. |
| 0:14-0:23 | Diagnose | “Instead of guessing from an alert, the workflow checks sessions, affected orders, and reference data through bounded tools.” | Workbook steps advance; trace rows appear. |
| 0:23-0:30 | Approval gate | “The agent proposes the recovery workbook. The operator reviews the evidence and approves the whole plan before execution.” | Show the approval modal and the human gate. |
| 0:30-0:39 | Stress injection | “Now we inject new pressure. The important behavior is that the plan pauses and re-triages instead of blindly continuing.” | Highlight Inject Stress, show reject spike, mark later steps as paused. |
| 0:39-0:51 | Agent Run | “After approval, Agent Run completes the simulated recovery steps and records each MCP tool result in the trace.” | Highlight Agent Run, show completed workbook and trace evidence. |
| 0:51-1:00 | Proof close | “The final state shows released flow, venue recovery, and an audit trail a human can review.” | Show released orders, BATS up, evidence ready, and the final proof card. |

## Production Notes

- Keep the platform visible. Do not turn the video into a generic slide deck.
- Use one spoken idea per scene.
- Use short callouts to direct the eye, not to explain the whole product.
- Approval must be visible before Agent Run.
- Injection must visibly interrupt the plan.
- The ending must prove outcome: recovered state plus trace evidence.

## Current Render

```bash
npm run video:render:bats
```

Output:

`out/bats-startup-executive-demo.mp4`

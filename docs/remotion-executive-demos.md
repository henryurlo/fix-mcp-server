# Remotion Executive Scenario Demos

FIX-MCP uses Remotion to turn each trading-desk scenario into an executive-facing visual brief.

The goal is not to make a marketing video. The goal is to let a viewer see:

- the incident pressure
- the affected desk component
- the MCP evidence path
- where the human approves the workbook
- how an injected stress event changes the situation
- how Agent Run stays inside the approved workflow

## Preview

```bash
npm run video:studio
```

Open the Remotion Studio URL and select any composition named `scenario-*`.
Scenario IDs use hyphens, for example `scenario-bats-startup-0200`.

## Render

Render the default executive demo:

```bash
npm run video:render
```

Render the BATS startup scenario:

```bash
npm run video:render:bats
```

Rendered files are written to `out/`.

## Scenario Story Structure

The scenario presentation data lives in `src/remotion/scenarioStories.ts`.

The product-video script for the BATS walkthrough lives in:

`docs/video-scripts/bats-startup-product-demo.md`

The real MCP capture for that walkthrough lives in:

`docs/demo-captures/bats-startup-real-run.json`

Regenerate it with:

```bash
.venv/bin/python scripts/capture_demo_run.py
```

The Remotion composition follows the script and capture directly: each phase has a scene label, a voiceover line, a visual callout, a required platform action, and captured tool evidence.

Each story contains:

- `executiveAngle`: why the scenario matters to a financial-professional audience
- `situation`: the opening state
- `systemImpact`: what is at risk
- `mcpEvidence`: what the tools prove
- `humanDecision`: where approval is required
- `injector`: which stress event to use
- `agentRun`: what the autonomous path may do after approval
- `outcome`: the executive close

When a new scenario is added under `config/scenarios`, add a matching story entry so it can be previewed and rendered.

## Storyboard Contract

Each scenario demo must walk the viewer through the desk workflow, not merely summarize the incident.

Required beats:

1. **Desk opening** — show scenario time, severity, affected component, open orders, venue/client/regulatory pressure, and the first alert.
2. **System map** — show the relationship between the operator, LLM copilot, MCP tools, FIX/OMS state, and trace evidence.
3. **Baseline diagnosis** — walk through the runbook step by step: tool call, evidence returned, narrowed cause, and state impact.
4. **Human approval gate** — make approval visually explicit. The agent may propose; the human decides.
5. **Injection branch** — interrupt the baseline path with a controlled stress event and show what changed and what did not.
6. **Agent Run branch** — show bounded execution of approved steps with visible trace rows, tool names, result badges, and stop/re-triage behavior.
7. **Executive close** — show before/after state, residual risk, and why the demo proves governed automation rather than autonomous trading.

Acceptance criteria:

- The injection event is visible in the video, not only mentioned in copy.
- The approval gate is visible before Agent Run.
- Tool evidence is shown as a trace/workbook surface.
- The video makes clear that production authority remains with the human.
- The composition can be rendered for every scenario listed by `npm run video:compositions`.

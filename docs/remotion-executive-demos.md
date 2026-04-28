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

# FIX-MCP Review Workflow

Use this workflow when asking Claude Code, Codex, or another coding agent to critique or improve the project. It borrows the multi-lens review style from product/design/engineering operating systems, but keeps the guidance specific to FIX-MCP.

## Mission

FIX-MCP is an open-source professional demo for showing how MCP lets an AI agent work with trading-desk systems through explicit tools, runbooks, evidence, and human approval.

The project should never feel like a toy trading game. It should feel like a small but credible command center for operations leaders, trading technologists, SRE teams, and AI practitioners.

## Review Lenses

### Product / CEO

Ask:

- Does the first screen explain why MCP matters for a trading desk?
- Is the human-in-the-loop posture obvious?
- Can a financial professional understand the consulting path from demo to production?
- Does the demo show a clear before/after improvement over manual log diving?

### Design

Ask:

- Does the UI feel like an operational tool rather than a marketing page or game?
- Are Watchdog, Investigator, Advisor, and Agent Run visible as workflow modes?
- Can the operator see what the AI plans to do before it acts?
- Are trace, evidence, and manual-command equivalents easy to inspect?

### Engineering

Ask:

- Are MCP tools bounded, auditable, and named clearly?
- Is simulated state separated from production integration assumptions?
- Can the same tool interface be backed by real FIX logs, OMS APIs, reference feeds, and monitoring systems later?
- Are stress events, scenario state, and runbook execution deterministic enough for demos?

### QA / Demo Readiness

Ask:

- Can a fresh user run the demo without setup confusion?
- Does at least one flagship scenario show alert, investigation, workbook approval, execution, and verification?
- Do UI labels avoid unsupported claims about live trading readiness?
- Is every action visible in trace or evidence output?

## Suggested Prompt

```text
Review FIX-MCP as a professional open-source demo for MCP on a trading desk.

Evaluate it through four lenses:
1. Product/CEO: narrative, audience fit, consulting pitch.
2. Design: operational clarity, professional tone, workflow visibility.
3. Engineering: MCP boundaries, simulated-vs-production separation, integration path.
4. QA/demo readiness: can the demo be shown live without confusion?

Do not recommend game-like mechanics or decorative UI.
Prioritize human-in-the-loop approval, workbook execution, traceability, and credible trading operations language.
Return the top risks, the highest-impact fixes, and a short implementation plan.
```


# FIX-MCP Operator Demo Flow

This document defines the UX flow for presenting FIX-MCP to financial professionals. The product should feel like a trading operations console, not a game or academy.

## Design Reference

Professional trading and OMS/EMS platforms emphasize:

- Dense, scan-friendly information
- Clear ownership and approval states
- Blotter-style lists over decorative cards
- Alerts tied to operational impact
- Audit trails, timestamps, and exportable evidence
- Fast switching across instruments, venues, orders, and incidents

FIX-MCP should borrow those patterns while staying focused on MCP, LLM-assisted diagnosis, human approval, and simulated desk recovery.

## Primary User Flow

1. **Load an incident**
   - User selects any scenario category directly: beginner, intermediate, advanced, venue, order, reference data, algo, or market event.
   - No scenario should be locked behind another scenario.

2. **Brief the room**
   - User explains the incident, affected venue/orders/symbols, and what success means.
   - The case brief should show operational facts, not training language.

3. **Run Investigator**
   - User opens the copilot and asks for impact, root cause, first action, and evidence needed.
   - If no LLM key is configured, the UI should make that obvious without pretending the agent worked.

4. **Approve the workbook**
   - User reviews the full recovery plan.
   - User can run one step at a time or approve the whole workbook.
   - Every step must map to an MCP tool and a manual desk command.

5. **Review trace evidence**
   - Trace is the proof surface and should be easy to reach.
   - The demo should show tool name, arguments, output, latency, source, and success/failure.

6. **Inject controlled pressure**
   - Injection is used after the baseline incident is understood.
   - The UI must explain what the selected event changes before the user injects it.
   - After injection, the copilot should be asked to re-triage and update the plan.

7. **Close the incident**
   - Completion should be serious: incident resolved, evidence captured, workbook complete.
   - Avoid stars, trophies, celebratory language, or anything that feels like a game.

## LLM Test Script

Use this script for each flagship scenario when an OpenRouter key is configured:

1. Load the scenario.
2. Open Copilot in Human mode.
3. Ask: `Summarize the incident, impact, root cause hypothesis, first action, and evidence you need.`
4. Run Investigator.
5. Approve Workbook.
6. Open Trace and verify tool calls were recorded.
7. Inject one stress event appropriate to the scenario.
8. Ask: `The system state changed. Re-triage, explain the new blast radius, and tell me whether the original workbook is still valid.`
9. Confirm the LLM does not claim authority to perform unapproved production actions.
10. Confirm the final state has a completed workbook and evidence.

## Flagship Scenario Matrix

| Scenario Type | Recommended Scenario | Injection To Test | What The User Should See |
|---|---|---|---|
| FIX session recovery | BATS Extended-Hours Startup | `seq_gap` on BATS | LLM notices sequence mismatch and prioritizes session recovery. |
| Venue outage | Venue Degradation / IEX Recovery | `venue_outage` on affected venue | Orders become stuck and trace shows recovery tooling. |
| Market halt | LULD / Open Volatility | `luld` on active symbol | LLM treats halt as market structure event, not infrastructure failure. |
| Order rejects | Morning Triage / BATS Startup | `reject_spike` on desk | LLM re-triages rejects and separates new pressure from base incident. |
| SLA pressure | EOD / MOC / Institutional scenario | `sla_breach` on client or desk | LLM escalates approval and client communication. |
| Compound incident | Midday Chaos | One additional venue or SLA event | LLM updates scope instead of blindly continuing the old plan. |


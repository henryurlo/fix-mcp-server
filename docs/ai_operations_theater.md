# AI Operations Theater — Product North Star

> **Product frame.** This is not a monitoring dashboard. It is a cinematic control surface for FIX/trading incidents where an audience can watch infrastructure fail, see an agent understand the blast radius, compare human versus AI-assisted execution, and approve or deny actions through a governed chat interface.

## Demo story (one sentence)

A venue or FIX path degrades, the system visualizes the failure, the agent explains what is happening, proposes the next step, the human approves, and the system heals — every action auditable.

## Product goal

Prove that the author can design AI-native operational systems that combine observability, workflow automation, human approval, and agent reasoning in one experience. The real product is **the narrative of governed AI operations**, not the graph, the chatbot, or the playbook alone.

---

## Four screens (not one dashboard)

| Screen | Purpose | What the audience should feel |
|---|---|---|
| **Topology** | Live map of hosts, FIX sessions, apps, services, dependencies | "This system is alive and complex" |
| **Incident Workspace** | One scenario at a time — root cause, impact, recommended actions, evidence | "This is controlled, not chaotic" |
| **Agent Copilot** | Chat with the system, view tool calls, approvals, reasoning trace | "The AI is actually operating, not pretending" |
| **Audit Replay** | Timeline of what happened in human mode vs agent mode | "This is safe, reviewable, enterprise-ready" |

---

## Topology screen (visual centerpiece)

Stack: **React Flow** for interactive node-and-edge graph.

Graph contents:
- Hosts/containers as parent clusters
- Applications inside each host — FIX engine, MCP server, dashboards, API layer
- External venues and counterparties as edge nodes
- Connection lines with animated traffic
- Health overlays — green healthy, amber degraded, red failed
- Edge failures pulse when a session drops or latency spikes

Design as a **war room**, not a network admin console: center canvas visually dominant, status cards floating lightly around it.

---

## Incident Workspace

When a failure is selected from topology, open a focused panel with:

1. **Incident summary** — e.g. "NYSE ARCA after-hours logoff abnormal, dark route stranded, cancel cleanup incomplete."
2. **Impact summary** — affected symbols, sessions, open orders, algos at risk
3. **Evidence** — FIX logs, session state, last successful messages, sequence issues
4. **Recommended plan** — ordered steps from the playbook
5. **Action controls** — simulate, approve, execute, rollback, escalate
6. **Verification** — post-action checks and health restoration

A top-of-panel toggle switches between:
- **Human Playbook Mode** — operator manually executes each step
- **Agent Mode** — agent proposes and executes with approval gates

This is where the human-vs-agent narrative happens.

---

## Agent Copilot

Lives as a right-side dock or expandable panel. Backend: **OpenRouter chat completions API** through a thin server proxy (OpenAI-compatible).

Chat UX supports:
- "What is failing right now?"
- "Why is ARCA red?"
- "Show impacted orders."
- "What would the human playbook do?"
- "Propose the safest remediation."
- "Run step 2 after approval."

Every response paired with a structured trace:
- Tool called
- Arguments
- Result
- Confidence
- Approval required or not
- Next recommended action

This is how the bot feels operational, not decorative.

---

## Layout architecture

Three-zone shell:

- **Left rail** — incidents, scenarios, filters, system mode, market session
- **Center canvas** — topology by default, incident detail when focused
- **Right rail** — agent copilot, action trace, approvals, recent events

Slim global header:
- Mode toggle — Human / Agent
- Environment — Demo / Sim / Live-like
- Session health counters
- "Start scenario" command
- Token entry button for OpenRouter session activation

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (already scaffolded) |
| UI | Tailwind + **shadcn/ui** for polished operational components |
| Graph | **React Flow** (already in `package.json`) |
| Tables | **TanStack Table** for orders, FIX messages, audit logs |
| Charts | Lightweight sparklines only where trend matters |
| Chat backend | OpenRouter chat completions via thin server proxy |
| Tool orchestration | Existing MCP server as the action layer |

---

## Demo flow (the spine)

1. Topology is healthy.
2. One venue/session turns amber, then red.
3. Connection edge pulses, affected apps highlight.
4. Incident Workspace auto-focuses.
5. Agent explains root cause and impacted orders.
6. Human toggles between manual playbook and AI mode.
7. Agent proposes remediation through MCP tools.
8. Human approves.
9. Tool calls execute and appear in trace.
10. Health returns to green, audit replay updates.

---

## DEMO PATH V1 — what to build first

**Discipline:** one killer demo path, not ten features at once. One failure, one topology, one chat workflow, one approval loop, one visible recovery. A narrower prototype that lands is worth more than a broader one that drifts.

**The V1 scenario is `afterhours_dark_1630`**: NYSE ARCA after-hours logoff abnormal, dark route stranded, cancel cleanup incomplete. Already implemented in the MCP scenario library — use it.

**V1 scope checklist:**

- [ ] Topology screen with ~8 nodes (host, fix-mcp-server, fix-mcp-api, fix-mcp-dashboard, postgres, redis, ARCA venue, dark-pool venue) and edges
- [ ] Health states driven by `/api/status` polling — green/amber/red
- [ ] Triggering `afterhours_dark_1630` turns ARCA edge red and pulses
- [ ] Incident Workspace opens on click, shows the five sections above from MCP tools
- [ ] Copilot dock with OpenRouter-backed chat; every agent turn carries a tool-call trace
- [ ] Mode toggle — Human Playbook walks steps manually; Agent Mode proposes them with approve/deny buttons
- [ ] Approval gate — clicking approve dispatches the MCP tool call, result flows into trace
- [ ] Audit Replay — the same incident replayed from log, side-by-side human vs agent timeline

**Out of scope for V1** (explicitly defer):
- Other 12 scenarios in the library
- Multi-incident queueing
- Live venue connections (keep everything simulated)
- User accounts / RBAC
- Persistence of audit replays across sessions
- Mobile responsive layout
- Dark-mode theming polish

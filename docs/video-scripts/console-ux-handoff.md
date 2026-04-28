# Console UX Handoff: Desk Workflow, Stress Test, Agent Run

Scope: product rationale for the console changes now implemented in `src/app/page.tsx` and `src/components/FixTerminal.tsx`.

## Findings

The top Desk Workflow block duplicates the Operator Rail, repeats the same baseline/stress sequence, and consumes vertical space above the actual case workbook. It is instruction-heavy but not stateful enough to earn the space.

Stress Test/Inject has three names in the console: `Stress lab`, `Stress Lab Controls`, and `Inject Event`. The behavior is sound, but the language makes it feel like a random fault button instead of a deliberate post-baseline validation step.

Agent Run sits beside `Approve Workbook`, but `Approve Workbook` also executes the workbook through `runWorkbook('advisor')`. That makes the distinction between approval, guided execution, and autonomous bounded execution hard to explain in a demo.

## Exact Recommendations

Replace the top Desk Workflow card with a compact `Current Operation` strip, or remove it entirely and let the Operator Rail own the workflow. The useful replacement is a single-row status strip directly under the four metrics:

`Current operation: Baseline diagnosis`
`Next: Run Investigator`
`Gate: Agent Run locked until workbook approval`
`Proof: Trace rows update after each MCP call`

When all baseline steps are done, change the strip to:

`Current operation: Stress Test ready`
`Next: Inject BATS sequence gap`
`Gate: Re-triage required before resume`
`Proof: Inject event appears in Trace`

If a richer replacement is needed, use a narrow `Scenario Proof` band instead of a three-card workflow block:

`Incident` shows scenario time, venue, and order scope.
`Decision` shows the next human decision.
`Evidence` shows the latest MCP tool/result.
`Control` shows whether Agent Run is locked, approved, running, paused, or complete.

Rename the visible stress concept to `Stress Test` everywhere except low-level tool names. Button text should be `Run Stress Test`. Helper text: `Available after baseline recovery. Injects a controlled state change and requires re-triage.`

Split approval from execution in copy and controls:

Because the current control executes steps immediately, rename it to `Approve & Run` so the behavior is honest during a live demo.

`Agent Run` should carry the explicit bounded behavior. Preferred label: `Agent Run: Execute Approved Steps`. Preferred helper text: `Runs only approved workbook steps. Stops on new state, failed evidence, or required human approval.`

Make disabled states explanatory in-place, not only in `title` attributes. For Stress Test, show `Locked until baseline complete`. For Agent Run, show `Approve workbook first` when there is no approved plan.

## Suggested Operator Rail Copy

Baseline section:

`Investigator`
`Ask the agent to diagnose and produce evidence. No recovery action runs.`

`Approve & Run`
`Execute the human-approved recovery path with visible MCP output.`

`Agent Run`
`Execute approved steps and write evidence to Trace.`

Stress Test section:

`Stress Test`
`Inject a controlled state change after baseline recovery. The agent must pause and re-triage.`

`Configure Stress Test`
`Choose the injected event type and target.`

# FIX-MCP Launch Package

This is the execution plan for turning the current working demo into a credible launch asset.

## Verdict

The product is technically credible. The launch layer needs to communicate that faster:

- Lead with the trading-ops gap, not a category description.
- Show the dashboard immediately.
- Demo one incident replay, not a feature tour.
- Make install, proof, author credibility, and consulting CTA obvious.

## What Has Been Fixed In This Pass

- README now opens with the wedge: agents can write FIX, but need trading-ops intelligence.
- README includes a dashboard visual at `docs/img/dashboard-demo.png`.
- README includes a clear audience section.
- README features one end-to-end BATS startup walkthrough.
- README removes local home-directory MCP config paths.
- README adds author credibility and consulting CTA.
- Added `CHANGELOG.md`.
- Added `LICENSE`.
- Added release workflow for Python artifacts and GHCR Docker image publishing.
- Added repeatable release preflight script at `scripts/check_release_ready.sh`.
- Added issue templates for `Roadmap to v0.2` and `Help wanted: live demo deployment`.
- Added the 75-second incident replay script at `docs/video-scripts/75-second-incident-replay.md`.
- Fixed the Compose console healthcheck so it works in the Node Alpine container.

## Remaining Launch Checklist

### Packaging

- Configure PyPI Trusted Publishing or publish the built artifact manually.
- Tag `v0.1.0` after `./scripts/check_release_ready.sh` passes.
- Confirm the release workflow publishes the GHCR image from the tag.

### Visuals

- Record a real dashboard GIF for the README hero.
- Capture a real MCP client screenshot calling `check_fix_sessions`.
- Export the 75-second horizontal demo cut for README and YouTube.
- Export a vertical cut for X/LinkedIn.

### Distribution

- Deploy a read-only live dashboard.
- Submit to the MCP registry or relevant MCP server index.
- Add GitHub topics:
  `mcp`, `fix-protocol`, `model-context-protocol`, `trading-systems`, `oms`, `quickfix`, `algo-trading`, `claude-desktop`, `fintech`, `broker-dealer`.
- Open two public issues using the templates in `.github/ISSUE_TEMPLATE`:
  `Roadmap to v0.2` and `Help wanted: live demo deployment`.

### Launch Posts

- X thread with video in post one.
- LinkedIn post aimed at broker-dealer ops, OMS vendors, and fintech AI builders.
- Hacker News Show post.
- Targeted posts or comments in relevant MCP and trading-system communities.
- Ten direct messages to trusted trading-ops / OMS / fintech contacts.

## Demo Rule

Do not film a feature tour.

Film one incident replay:

1. Load the incident.
2. Ask the agent to triage.
3. Show the tool calls.
4. Approve the workbook.
5. Run the fix.
6. Open the trace.
7. Inject pressure only after the baseline is understood.
8. Recover and prove final state.

The dashboard doing real work is the proof.

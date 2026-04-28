# FIX-MCP Release Checklist

Use this checklist when preparing a public release. The goal is to keep launch work boring, repeatable, and evidence-backed.

## Preflight

```bash
./scripts/check_release_ready.sh
```

This runs Python tests, the Next.js production build, and a Python package build.

## Local Docker Smoke Test

```bash
docker compose up --build
```

Open `http://localhost:3000`, load `bats_startup_0200`, run the recovery workbook, open Trace, then use Stress Lab only after the baseline incident is understood.

If Docker access is not available in the current shell, run the command from a terminal that can access the Docker daemon.

## Tag

```bash
git tag -a v0.1.0 -m "FIX-MCP v0.1.0"
git push origin v0.1.0
```

The `Release` workflow builds the Python distribution artifact and pushes the Docker image to GHCR for tagged releases.

## PyPI

Preferred path: configure PyPI Trusted Publishing for this repository, then add a publish job to `.github/workflows/release.yml`.

Manual fallback:

```bash
python -m pip install --upgrade twine
python -m twine upload dist/*
```

## Repository Signals

Add GitHub topics:

```text
mcp, fix-protocol, model-context-protocol, trading-systems, oms,
quickfix, algo-trading, claude-desktop, fintech, broker-dealer
```

Open two launch issues using the templates in `.github/ISSUE_TEMPLATE`:

- `Roadmap to v0.2`
- `Help wanted: live demo deployment`

## Demo Assets

- README hero screenshot or GIF.
- 75-second horizontal product walkthrough.
- Vertical cut for X and LinkedIn.
- Screenshot of an MCP client calling `check_fix_sessions`.

## Launch Order

1. Push tag and confirm CI/release workflow.
2. Confirm Docker image is visible in GHCR.
3. Confirm README visual loads on GitHub.
4. Publish the video.
5. Post launch thread and LinkedIn post.
6. Send direct outreach to trusted trading-ops, OMS, and fintech contacts.

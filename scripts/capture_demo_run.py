#!/usr/bin/env python3
"""Capture a real FIX-MCP scenario run for product videos and docs.

This script does not invent demo copy. It loads a scenario into the Python
engine, executes the same MCP tools a user would see in the UI, and writes the
actual tool responses to JSON so Remotion and docs can reference real evidence.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "docs" / "demo-captures" / "bats-startup-real-run.json"


def _load_server():
    for name in list(sys.modules):
        if name == "fix_mcp.server" or name.startswith("fix_mcp.server."):
            sys.modules.pop(name)
    return importlib.import_module("fix_mcp.server")


def _trim(text: str, limit: int = 1200) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n..."


def _summary(text: str) -> str:
    clean = [line.strip() for line in text.splitlines() if line.strip()]
    for line in clean:
        if line.startswith(("#", "FIX ", "ORDER ", "TICKER ", "EVENT ", "SCENARIO ", "TRACE ")):
            return line.strip("# ").strip()
    return clean[0] if clean else ""


def _extract_orders(text: str) -> int | None:
    match = re.search(r"ORDER QUERY .*?(\d+) order", text)
    if match:
        return int(match.group(1))
    match = re.search(r"Orders Released:\s*(\d+)", text)
    if match:
        return int(match.group(1))
    return None


async def _call(server: Any, tool: str, arguments: dict[str, Any], note: str) -> dict[str, Any]:
    result = await server.call_tool(tool, arguments)
    output = result[0].text
    return {
        "tool": tool,
        "arguments": arguments,
        "note": note,
        "summary": _summary(output),
        "output": output,
        "short_output": _trim(output),
        "orders_observed": _extract_orders(output),
    }


async def capture_bats_startup() -> dict[str, Any]:
    server = _load_server()
    scenario = "bats_startup_0200"
    steps = [
        ("list_scenarios", {"action": "load", "scenario_name": scenario}, "User starts from the scenario picker."),
        ("check_fix_sessions", {}, "Investigator checks all venues before recommending action."),
        ("query_orders", {}, "Investigator quantifies affected order flow."),
        ("fix_session_issue", {"venue": "BATS", "action": "reconnect"}, "Workbook step attempts BATS reconnection."),
        ("fix_session_issue", {"venue": "BATS", "action": "reset_sequence"}, "Workbook step resets the BATS sequence."),
        (
            "load_ticker",
            {
                "symbol": "BITO",
                "cusip": "05557R500",
                "name": "ProShares Bitcoin Strategy ETF",
                "listing_exchange": "NYSE",
            },
            "Workbook step loads BITO reference data.",
        ),
        (
            "load_ticker",
            {
                "symbol": "GBTC",
                "cusip": "389637509",
                "name": "Grayscale Bitcoin Trust ETF",
                "listing_exchange": "NYSE",
            },
            "Workbook step loads GBTC reference data.",
        ),
        ("validate_orders", {}, "Agent verifies the book after session and symbol recovery."),
        ("inject_event", {"event_type": "seq_gap", "target": "BATS", "details": "demo pressure test after workbook approval"}, "Operator injects pressure to prove re-triage."),
        ("check_fix_sessions", {"venue": "BATS"}, "Agent re-checks BATS after injection instead of blindly continuing."),
        ("fix_session_issue", {"venue": "BATS", "action": "reset_sequence"}, "Agent resolves the injected sequence gap inside the approved boundary."),
        ("resume_simulation", {"notes": "BATS sequence gap resolved and trace reviewed."}, "Operator resumes the simulated desk after recovery."),
        ("score_scenario", {}, "Scenario closes with an auditable score report."),
        ("get_trace", {"limit": 20}, "Trace proves the tool path used by the walkthrough."),
    ]

    captured = []
    for tool, arguments, note in steps:
        captured.append(await _call(server, tool, arguments, note))

    return {
        "scenario": scenario,
        "title": "BATS Extended-Hours Startup",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "Source-of-truth run for the product walkthrough video. Outputs are real MCP tool responses from the local simulation engine.",
        "operator_walkthrough": [
            "Start in Mission Control and select BATS Extended-Hours Startup.",
            "Run Investigator to inspect FIX sessions and quantify blocked orders.",
            "Review the proposed workbook before execution.",
            "Approve the full workbook as the human operator.",
            "Run Agent Run to execute bounded MCP steps.",
            "Inject a BATS sequence gap to prove the agent pauses and re-triages.",
            "Resolve the injected issue and close with trace evidence.",
        ],
        "steps": captured,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default="bats_startup_0200", choices=["bats_startup_0200"])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    payload = asyncio.run(capture_bats_startup())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {args.out.relative_to(ROOT)}")
    print(f"Captured {len(payload['steps'])} real MCP tool calls")


if __name__ == "__main__":
    main()

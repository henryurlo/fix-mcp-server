#!/usr/bin/env python3
"""Run the FIX MCP morning triage workflow in a single persistent process."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from fix_mcp import server


async def _call(name: str, arguments: dict[str, Any]) -> str:
    result = await server.call_tool(name, arguments)
    return result[0].text


async def run_workflow(step: str) -> None:
    if step in {"all", "check"}:
        print("\n=== PRE-MARKET CHECK ===\n")
        print(await _call("run_premarket_check", {}))

    if step in {"all", "repair"}:
        print("\n=== REPAIR ARCA SESSION ===\n")
        print(await _call("fix_session_issue", {"venue": "ARCA", "action": "resend_request"}))

    if step in {"all", "recheck"}:
        print("\n=== PRE-MARKET CHECK AFTER REPAIR ===\n")
        print(await _call("run_premarket_check", {}))

    if step in {"all", "order"}:
        print("\n=== SEND ORDER ===\n")
        print(
            await _call(
                "send_order",
                {
                    "symbol": "AAPL",
                    "side": "buy",
                    "quantity": 100,
                    "order_type": "limit",
                    "price": 214.5,
                    "client_name": "Ridgemont Capital",
                },
            )
        )

    if step in {"all", "corp"}:
        print("\n=== SEND CORPORATE ACTION ORDER ===\n")
        print(
            await _call(
                "send_order",
                {
                    "symbol": "ACME",
                    "side": "buy",
                    "quantity": 50,
                    "order_type": "market",
                    "client_name": "Ridgemont Capital",
                },
            )
        )


async def list_tools() -> None:
    tools = await server.list_tools()
    payload = [{"name": tool.name, "schema": tool.inputSchema} for tool in tools]
    print(json.dumps(payload, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description="FIX MCP workflow runner")
    parser.add_argument(
        "step",
        nargs="?",
        default="all",
        choices=["all", "check", "repair", "recheck", "order", "corp", "list-tools"],
        help="Workflow step to run",
    )
    args = parser.parse_args()

    if args.step == "list-tools":
        asyncio.run(list_tools())
        return

    asyncio.run(run_workflow(args.step))


if __name__ == "__main__":
    main()

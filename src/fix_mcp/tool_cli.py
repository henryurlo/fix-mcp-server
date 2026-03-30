"""Generic CLI wrapper around FIX MCP tools."""

from __future__ import annotations

import argparse
import asyncio
import json

from fix_mcp import server


async def _run() -> None:
    parser = argparse.ArgumentParser(description="Run a FIX MCP tool from the command line")
    parser.add_argument("tool", help="Tool name, e.g. run_premarket_check or query_orders")
    parser.add_argument(
        "--args",
        default="{}",
        help='JSON arguments object, e.g. \'{"venue":"ARCA","action":"resend_request"}\'',
    )
    parsed = parser.parse_args()

    try:
        arguments = json.loads(parsed.args)
        if not isinstance(arguments, dict):
            raise ValueError("arguments must decode to a JSON object")
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Invalid --args JSON: {exc}") from exc

    result = await server.call_tool(parsed.tool, arguments)
    print(result[0].text)


def main() -> None:
    asyncio.run(_run())

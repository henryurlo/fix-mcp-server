"""MCP streamable HTTP transport — one process, shared state.

Runs alongside the dashboard and REST API in the same Python process so all
three share the same OMS, session_manager, and algo_engine objects.

Claude Desktop / Claude Code connects with:
    {"mcpServers": {"fix-mcp": {"url": "http://localhost:8001/mcp"}}}

When Claude calls a tool, the listener registered in api.py publishes the
event to the dashboard Activity stream with source="claude".
"""
from __future__ import annotations

import contextlib
import threading
from collections.abc import AsyncIterator

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

from fix_mcp import server as _mcp_module


def _create_asgi_app() -> Starlette:
    session_manager = StreamableHTTPSessionManager(app=_mcp_module.app)

    @contextlib.asynccontextmanager
    async def _lifespan(app: Starlette) -> AsyncIterator[None]:  # noqa: ARG001
        async with session_manager.run():
            yield

    async def _handle_mcp(scope, receive, send) -> None:  # noqa: ANN001
        await session_manager.handle_request(scope, receive, send)

    async def _root(request: Request) -> JSONResponse:  # noqa: ARG001
        return JSONResponse({
            "server": "fix-trading-ops",
            "transport": "streamable-http",
            "mcp_endpoint": "/mcp",
            "scenario": _mcp_module.SCENARIO,
        })

    return Starlette(
        lifespan=_lifespan,
        routes=[
            Route("/", _root),
            Mount("/mcp", app=_handle_mcp),
        ],
    )


def start_in_thread(host: str = "0.0.0.0", port: int = 8001) -> None:
    """Start the MCP HTTP server in a daemon thread.

    Shares the same process (and therefore the same OMS/session state) as the
    dashboard and embedded REST API.  Tool calls made by Claude update the same
    in-memory state that the dashboard polls.
    """
    import uvicorn  # available as a transitive dep of mcp>=1.26.0

    asgi_app = _create_asgi_app()
    config = uvicorn.Config(
        app=asgi_app,
        host=host,
        port=port,
        log_level="warning",
        loop="asyncio",
    )
    server_instance = uvicorn.Server(config)
    t = threading.Thread(target=server_instance.run, daemon=True, name="fix-mcp-http")
    t.start()

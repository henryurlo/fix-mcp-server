"""TCP Integration — wire BrokerHost + ExchangeSimulators into MCP tool dispatch.

Starts a BrokerHost on port 8001 and one ExchangeSimulator per reference-data
venue on their assigned ports.  When send_order is called and TCP mode is
active, the order goes through the real FIX TCP path and the dashboard receives
actual FIX wire responses instead of the dict-based in-memory simulation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from fix_mcp.engine.broker_host import BrokerHost
from fix_mcp.engine.exchange_sim import ExchangeSimulator

logger = logging.getLogger(__name__)

# Standard port bases — matches the ports in config/venues.json where possible
_EXCHANGE_PORT_BASE = 9001


class TCPIntegration:
    """Lives in-process as a singleton.  Wraps a BrokerHost, ExchangeSimulators,
    and a background event-loop thread so the sync MCP stack can call into
    async TCP code."""

    def __init__(
        self,
        venues: Optional[dict[str, dict[str, Any]]] = None,
        symbols: Optional[dict[str, float]] = None,
    ) -> None:
        """
        Args:
            venues: Mapping ``{venue_name: {mic, port, ...}}`` from reference
                data, or ``None`` to auto-populate from symbols.
            symbols: ``{symbol: base_price}`` seed for each exchange.
        """
        self._symbols = symbols or {
            "AAPL": 195.50,
            "GOOG": 141.80,
            "MSFT": 417.50,
            "AMZN": 185.30,
            "JPM": 199.00,
        }
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[Any] = None
        self._broker: Optional[BrokerHost] = None
        self._exchanges: dict[str, ExchangeSimulator] = {}
        self._is_running = False

    # ------------------------------------------------------------------ #
    # Lifecycle                                                          #
    # ------------------------------------------------------------------ #

    def start(self) -> None:
        """Create an event-loop thread, instantiate simulators, and start
        the acceptors.  Returns immediately — the loop runs in a daemon
        background thread."""
        if self._is_running:
            return

        self._loop = asyncio.new_event_loop()

        # Run everything on the background loop
        self._loop.create_task(self._startup())

        # Start the loop in a daemon thread
        import threading

        def _run() -> None:
            asyncio.set_event_loop(self._loop)  # type: ignore[arg-type]
            self._loop.run_forever()

        self._loop_thread = threading.Thread(name="fix-tcp-loop", target=_run, daemon=True)
        self._loop_thread.start()

        # Wait briefly for acceptors to bind
        for _ in range(30):
            if self._is_running:
                break
            time.sleep(0.05)

        if not self._is_running:
            logger.warning("TCPIntegration: acceptors may not be ready")

    def stop(self) -> None:
        """Shut down all TCP acceptors and stop the background loop."""
        if not self._is_running or self._loop is None:
            return

        async def _shutdown() -> None:
            if self._broker:
                await self._broker.stop()
            for ex in self._exchanges.values():
                await ex.stop()
            self._loop.call_soon_threadsafe(self._loop.stop)  # type: ignore[arg-type]

        asyncio.run_coroutine_threadsafe(_shutdown(), self._loop)
        self._is_running = False
        if self._loop_thread:
            self._loop_thread.join(timeout=3)

    async def _startup(self) -> None:
        """Create exchanges and the broker."""
        exch: dict[str, Any] = {}
        port = _EXCHANGE_PORT_BASE
        for mic, sym_dict in [
            ("XNYS", self._symbols),
            ("IEXG", self._symbols),
            ("BATS", self._symbols),
            ("ARCA", self._symbols),
        ]:
            sim = ExchangeSimulator(venue_mic=mic, port=port + list(exch).index(mic) if mic in exch else port, symbols=sym_dict)
            # Use incrementing ports
            sim.port = port + len(exch)
            exch[mic] = sim
            asyncio.ensure_future(sim.start())
            port += 1

        self._exchanges = exch

        self._broker = BrokerHost(
            client_port=8001,
            exchanges=exch,
        )
        await self._broker.start()
        self._is_running = True
        logger.info("TCPIntegration started (broker :8001, %d venues)", len(exch))

    # ------------------------------------------------------------------ #
    # Order routing via TCP path                                         #
    # ------------------------------------------------------------------ #

    async def route_order_tcp(
        self,
        symbol: str,
        side: str,          # \"1\"=buy, \"2\"=sell
        quantity: int,
        order_type: str,    # \"1\"=market, \"2\"=limit, \"3\"=stop
        cl_ord_id: str,
        price: Optional[float] = None,
    ) -> Optional[str]:
        """Route an order through the BrokerHost TCP path.

        Returns the raw FIX ExecutionReport string from the venue, or ``None``.
        """
        if self._broker is None:
            return None

        # Build a raw pipe-delimited FIX NewOrderSingle (35=D)
        parts = [
            f"8=FIX.4.2",
            "9=0",             # body length placeholder
            "35=D",
            f"34={self._broker._client_seq}",
            "49=CLIENT",
            f"52={self._ts()}",
            "56=BROKER",
            f"11={cl_ord_id}",
            f"55={symbol}",
            f"54={side}",
            f"38={quantity}",
            f"40={order_type}",
        ]
        if price is not None:
            parts.append(f"44={price:.2f}")

        raw = "|".join(parts)
        reply = await self._broker.route_order(raw)
        return reply

    def submit_order_sync(
        self,
        symbol: str,
        side: str,
        quantity: int,
        order_type: str,
        cl_ord_id: str,
        price: Optional[float] = None,
        timeout: float = 5.0,
    ) -> Optional[str]:
        """Synchronous wrapper for :meth:`route_order_tcp`.

        Blocks the calling thread until the TCP reply arrives or *timeout* seconds
        elapse.  Callers on the MCP dispatch thread should use this.
        """
        if not self._is_running or self._loop is None:
            return None

        future = asyncio.run_coroutine_threadsafe(
            self.route_order_tcp(symbol, side, quantity, order_type, cl_ord_id, price),
            self._loop,
        )
        try:
            return future.result(timeout=timeout)
        except Exception:
            logger.exception("TCP route_order timed out or errored")
            return None

    # ------------------------------------------------------------------ #
    # Accessors                                                          #
    # ------------------------------------------------------------------ #

    @property
    def broker(self) -> Optional[BrokerHost]:
        return self._broker

    @property
    def exchanges(self) -> dict[str, ExchangeSimulator]:
        return dict(self._exchanges)

    @property
    def is_running(self) -> bool:
        return self._is_running

    @staticmethod
    def _ts() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S")

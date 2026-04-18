"""ExchangeSimulator — asyncio FIX engine simulator per venue.

Implements a FIX 4.2 subset:
  Logon(A), Heartbeat(0), NewOrderSingle(D), ExecutionReport(8),
  MarketDataSnapshotFullRefresh(W), Logout(F)

Each exchange runs on a unique TCP port and generates realistic
bid/ask quotes for configured symbols using a random-walk price model.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Price-model defaults ---------------------------------------------------
DEFAULT_TICK_SIZE = 0.01
DEFAULT_SPREAD_MIN = 0.01
DEFAULT_SPREAD_MAX = 0.05
DEFAULT_WALK_PCT = 0.0005  # ±0.05 %

# ── FIX 4.2 message type constants ----------------------------------------
MSG_LOGON = "A"
MSG_HEARTBEAT = "0"
MSG_NEW_ORDER_SINGLE = "D"
MSG_EXECUTION_REPORT = "8"
MSG_MARKET_DATA = "W"
MSG_LOGOUT = "F"


@dataclass
class Quote:
    """Single-side quote (bid or ask) for a symbol."""
    price: float
    size: int


@dataclass
class MarketState:
    """Current simulated market state for one symbol."""
    symbol: str
    base_price: float
    current_mid: float
    tick_size: float = DEFAULT_TICK_SIZE
    bids: list[Quote] = field(default_factory=list)
    asks: list[Quote] = field(default_factory=list)


class ExchangeSimulator:
    """Simulated FIX 4.2 exchange acceptor.

    Provides asyncio TCP server that accepts client connections, responds to
    FIX 4.2 messages, and publishes market-data snapshots at a configurable
    cadence.

    Args:
        venue_mic: Four-letter MIC code identifying the venue (e.g. "XNYS").
        port: TCP port to listen on (default 9001+).
        symbols: Mapping ``{symbol: base_price}`` to seed with.
        md_interval_ms: Milliseconds between market-data updates (default 100).
    """

    def __init__(
        self,
        venue_mic: str,
        port: int = 9001,
        symbols: Optional[dict[str, float]] = None,
        md_interval_ms: int = 100,
    ) -> None:
        self.venue_mic = venue_mic
        self.port = port
        self.md_interval_ms = md_interval_ms

        # Market state
        self._markets: dict[str, MarketState] = {}
        default_symbols = symbols or self._default_symbols()
        for sym, base_price in default_symbols.items():
            self._markets[sym] = MarketState(symbol=sym, base_price=base_price, current_mid=base_price)

        # Connection tracking
        self._readers: list[asyncio.StreamReader] = []
        self._writers: list[asyncio.StreamWriter] = []
        self._connection_lock = asyncio.Lock()
        self._server: Optional[asyncio.Server] = None

        # Sequence numbers (global per connection, simplified)
        self._in_seq = 0
        self._out_seq = 0

        # Fault injection state
        self._fault: Optional[str] = None
        self._fault_params: dict = {}
        self._msg_hold_until: float = 0.0

        # Heartbeat tracking
        self._last_heartbeat: float = time.monotonic()

        # Task handles
        self._md_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------ #
    # Lifecycle                                                           #
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        """Start the asyncio TCP acceptor and the market-data publisher."""
        self._server = await asyncio.start_server(
            self._handle_client, "0.0.0.0", self.port
        )
        self._md_task = asyncio.ensure_future(self._publish_market_data())
        logger.info(
            "ExchangeSimulator[%s] started on port %d with %d symbols",
            self.venue_mic,
            self.port,
            len(self._markets),
        )

    async def stop(self) -> None:
        """Gracefully stop the acceptor, close all clients, cancel tasks."""
        if self._md_task is not None:
            self._md_task.cancel()
            try:
                await self._md_task
            except asyncio.CancelledError:
                pass
            self._md_task = None

        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

        async with self._connection_lock:
            for w in self._writers:
                w.close()
                try:
                    await w.wait_closed()
                except Exception:
                    pass
            self._writers.clear()
            self._readers.clear()

        logger.info("ExchangeSimulator[%s] stopped", self.venue_mic)

    # ------------------------------------------------------------------ #
    # Fault injection                                                     #
    # ------------------------------------------------------------------ #

    def inject_fault(self, fault_type: str, params: Optional[dict] = None) -> None:
        """Inject a fault into the simulator.

        Args:
            fault_type: One of ``"delay"``, ``"disconnect"``, ``"corrupt"``.
            params: Optional dict with fault-specific parameters.
        """
        self._fault = fault_type
        self._fault_params = params or {}

        if fault_type == "delay" and "hold_ms" in self._fault_params:
            self._msg_hold_until = time.monotonic() + self._fault_params["hold_ms"] / 1000
        elif fault_type == "disconnect":
            # Schedule disconnect of all clients on next tick
            asyncio.ensure_future(self._disconnect_all())

    async def _disconnect_all(self) -> None:
        """Disconnect every active client writer."""
        async with self._connection_lock:
            for w in self._writers:
                w.close()
            self._writers.clear()
            self._readers.clear()

    def clear_fault(self) -> None:
        """Clear any active fault injection."""
        self._fault = None
        self._fault_params = {}
        self._msg_hold_until = 0.0

    # ------------------------------------------------------------------ #
    # Client handler                                                      #
    # ------------------------------------------------------------------ #

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.Writer
    ) -> None:
        """Serve a single accepted TCP connection."""
        async with self._connection_lock:
            self._readers.append(reader)
            self._writers.append(writer)

        addr = writer.get_extra_info("peername", "unknown")
        logger.info("ExchangeSimulator[%s] accepted client from %s", self.venue_mic, addr)

        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                msg = line.decode("utf-8", errors="replace").strip()
                if not msg:
                    continue

                # Fault: delay
                if self._fault == "delay" and time.monotonic() < self._msg_hold_until:
                    await asyncio.sleep(self._msg_hold_until - time.monotonic())

                # Fault: corrupt
                if self._fault == "corrupt":
                    msg = self._corrupt_bytes(msg)

                reply = await self._process_message(msg)
                if reply is not None:
                    writer.write(reply.encode("utf-8") + b"\n")
                    await writer.drain()

        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            async with self._connection_lock:
                if reader in self._readers:
                    self._readers.remove(reader)
                if writer in self._writers:
                    self._writers.remove(writer)
            writer.close()

    # ------------------------------------------------------------------ #
    # Message dispatch                                                    #
    # ------------------------------------------------------------------ #

    async def _process_message(self, raw: str) -> Optional[str]:
        """Route a single FIX message to the appropriate handler.

        Returns a FIX-formatted reply string (or None for no reply).
        """
        # Parse message type (between SOH-separated 35= tag)
        msg_type = self._extract_tag(raw, "35")
        if msg_type is None:
            return None

        self._last_heartbeat = time.monotonic()

        if msg_type == MSG_LOGON:
            return self._build_logon_ack(raw)
        elif msg_type == MSG_HEARTBEAT:
            return self._build_heartbeat_ack()
        elif msg_type == MSG_NEW_ORDER_SINGLE:
            return await self._handle_new_order(raw)
        elif msg_type == MSG_LOGOUT:
            return self._build_logout_ack()
        # Everything else: heart-beat back the original
        return self._build_heartbeat_ack()

    # ------------------------------------------------------------------ #
    # FIX helpers                                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_tag(raw: str, tag: str) -> Optional[str]:
        """Extract a tag value from pipe-delimited FIX string."""
        for segment in raw.split("|"):
            parts = segment.split("=", 1)
            if len(parts) == 2 and parts[0].strip() == tag:
                return parts[1].strip()
        return None

    def _build_logon_ack(self, request: str) -> str:
        """Acknowledge a FIX 4.2 Logon."""
        self._out_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=A|34={self._out_seq}|49={self.venue_mic}|"
            f"52={self._ts()}|56={self._extract_tag(request, '49') or 'CLIENT'}|"
            f"98=0|108=30|10=000"
        )

    def _build_heartbeat_ack(self) -> str:
        self._out_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=0|34={self._out_seq}|49={self.venue_mic}|"
            f"52={self._ts()}|10=000"
        )

    def _build_logout_ack(self) -> str:
        self._out_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=F|34={self._out_seq}|49={self.venue_mic}|"
            f"52={self._ts()}|10=000"
        )

    async def _handle_new_order(self, raw: str) -> str:
        """Accept a NewOrderSingle and immediately fill it."""
        self._out_seq += 1
        symbol = self._extract_tag(raw, "55") or "UNKNOWN"
        qty = int(self._extract_tag(raw, "38") or "100")
        side = self._extract_tag(raw, "54") or "1"
        order_type = self._extract_tag(raw, "40") or "1"
        cl_ord_id = self._extract_tag(raw, "11") or ""

        price = self._markets[symbol].current_mid if symbol in self._markets else 0.0

        self._out_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=8|34={self._out_seq}|49={self.venue_mic}|"
            f"52={self._ts()}|56=CLIENT|11={cl_ord_id}|55={symbol}|54={side}|"
            f"38={qty}|40={order_type}|39=1|150=1|31={price:.2f}|"
            f"14={qty}|550={self.venue_mic}|10=000"
        )

    @staticmethod
    def _corrupt_bytes(raw: str) -> str:
        """Corrupt a random character to simulate data corruption."""
        if not raw:
            return raw
        idx = random.randint(0, len(raw) - 1)
        corrupted = list(raw)
        corrupted[idx] = "#"
        return "".join(corrupted)

    @staticmethod
    def _ts() -> str:
        """Current UTC timestamp in FIX format yyyyMMdd-HH:mm:ss."""
        return datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S")

    # ------------------------------------------------------------------ #
    # Market-data loop                                                    #
    # ------------------------------------------------------------------ #

    async def _publish_market_data(self) -> None:
        """Periodically update the price model for all symbols."""
        interval = self.md_interval_ms / 1000
        while True:
            try:
                for state in self._markets.values():
                    self._walk_price(state)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Market-data tick failed")
            await asyncio.sleep(interval)

    def _walk_price(self, state: MarketState) -> None:
        """Update the mid price with a random-walk step."""
        change = random.gauss(0, DEFAULT_WALK_PCT * state.current_mid)
        state.current_mid += change
        state.current_mid = round(state.current_mid, 2)
        if state.current_mid <= 0:
            state.current_mid = state.base_price

        spread = random.uniform(DEFAULT_SPREAD_MIN, DEFAULT_SPREAD_MAX)
        bid_px = round(state.current_mid - spread / 2, 2)
        ask_px = round(state.current_mid + spread / 2, 2)

        depth = 5
        state.bids = [
            Quote(price=round(bid_px - i * DEFAULT_TICK_SIZE, 2), size=random.randint(100, 5000))
            for i in range(depth)
        ]
        state.asks = [
            Quote(price=round(ask_px + i * DEFAULT_TICK_SIZE, 2), size=random.randint(100, 5000))
            for i in range(depth)
        ]

    # ------------------------------------------------------------------ #
    # Accessors                                                           #
    # ------------------------------------------------------------------ #

    def get_quote(self, symbol: str) -> Optional[MarketState]:
        """Return the current MarketState for *symbol*."""
        return self._markets.get(symbol)

    def get_all_quotes(self) -> list[MarketState]:
        """Return a list of all current market states."""
        return list(self._markets.values())

    def get_status(self) -> dict:
        """Return a status dict for monitoring."""
        return {
            "venue": self.venue_mic,
            "port": self.port,
            "running": self._server is not None,
            "connected_clients": len(self._writers),
            "symbols": list(self._markets.keys()),
            "fault_active": self._fault,
            "last_heartbeat_age": round(time.monotonic() - self._last_heartbeat, 3),
        }

    @staticmethod
    def _default_symbols() -> dict[str, float]:
        """Fallback symbols when none are provided."""
        return {
            "AAPL": 195.50,
            "GOOG": 141.80,
            "MSFT": 417.50,
            "AMZN": 185.30,
            "JPM": 199.00,
        }

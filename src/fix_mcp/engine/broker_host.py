"""BrokerHost — central FIX broker.

Accepts client FIX connections as an acceptor, initiates connections
to ExchangeSimulator venues, and provides smart order routing based
on best available price. Integrates with the OMS and publishes
events to Redis pub/sub.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


class BrokerHost:
    """Central FIX broker / smart order router.

    Acts as an acceptor for downstream clients and as an initiator
    to upstream exchange simulators. Routes orders to the venue with
    the best price (lowest ask for buys, highest bid for sells).

    Args:
        client_port: TCP port to accept client connections (default 8001).
        exchanges: Mapping ``{mic: ExchangeSimulator}`` of upstream venues.
        interlist_resolver: Optional ``InterlistResolver`` for symbol mapping.
        redis_client: Optional ``redis.asyncio.Redis`` instance.
    """

    def __init__(
        self,
        client_port: int = 8001,
        exchanges: Optional[dict[str, Any]] = None,
        interlist_resolver: Optional[Any] = None,
        redis_client: Optional[Any] = None,
        market_data_hub: Optional[Any] = None,
    ) -> None:
        self.client_port = client_port
        self._exchanges: dict[str, Any] = exchanges or {}
        self._resolver = interlist_resolver
        self._redis = redis_client
        self._md = market_data_hub

        # OMS instance imported here to avoid circular import at module level
        self._oms: Optional[Any] = None

        # Session state
        self._client_seq: int = 0
        self._is_running = False
        self._server: Optional[asyncio.Server] = None

        # Routing stats
        self._routed_count = 0
        self._routing_log: list[dict[str, Any]] = []

    @property
    def oms(self) -> Any:
        """Lazy-initialise the OMS."""
        if self._oms is None:
            from fix_mcp.engine.oms import OMS
            self._oms = OMS()
        return self._oms

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start accepting client connections and connect to exchanges."""
        self._is_running = True
        self._server = await asyncio.start_server(
            self._handle_client, "0.0.0.0", self.client_port,
        )
        logger.info("BrokerHost started on port %d (%d venues)",
                     self.client_port, len(self._exchanges))

    async def stop(self) -> None:
        """Stop accepting clients and disconnect from all venues."""
        self._is_running = False
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        logger.info("BrokerHost stopped")

    # ------------------------------------------------------------------
    # Client acceptor
    # ------------------------------------------------------------------

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.AsyncStreamWrite,
    ) -> None:
        """Serve a single client FIX connection."""
        addr = writer.get_extra_info("peername", "unknown")
        logger.info("BrokerHost: client connected from %s", addr)
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                msg = line.decode("utf-8", errors="replace").strip()
                if not msg:
                    continue
                reply = await self._route_client_message(msg)
                if reply is not None:
                    writer.write(reply.encode("utf-8") + b"\n")
                    await writer.drain()
        except asyncio.CancelledError:
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _route_client_message(self, raw: str) -> Optional[str]:
        """Route a single incoming FIX message to the appropriate handler."""
        msg_type = self._extract_tag(raw, "35")
        if msg_type is None:
            return None

        if msg_type == "A":
            return self._build_acceptor_ack(raw)
        elif msg_type == "0":
            return self._build_heartbeat()
        elif msg_type == "D":
            return await self.route_order(raw)
        elif msg_type == "F":
            return self._build_ack()
        else:
            return self._build_heartbeat()

    # ------------------------------------------------------------------ #
    # Smart order routing                                                  #
    # ------------------------------------------------------------------ #

    async def route_order(self, raw: str) -> Optional[str]:
        """Route a NewOrderSingle to the best venue.

        Best venue = lowest ask for buy (side=1), highest bid for sell (side=2).

        Args:
            raw: The raw FIX message string (pipe-delimited).

        Returns:
            A FIX ExecutionReport string or None.
        """
        symbol = self._extract_tag(raw, "55") or "UNKNOWN"
        side = self._extract_tag(raw, "54") or "1"
        cl_ord_id = self._extract_tag(raw, "11") or ""

        # Resolve symbol for each venue
        best_mic: Optional[str] = None
        best_price: Optional[float] = None

        for mic, exchange in self._exchanges.items():
            venue_sym = symbol
            if self._resolver:
                venue_sym = self._resolver.resolve(symbol, mic)

            state = exchange.get_quote(venue_sym)
            if state is None:
                continue

            if side == "1":
                # Buy — lowest ask, top of book
                price = state.asks[0].price if state.asks else None
                if price is not None:
                    if best_price is None or price < best_price:
                        best_price = price
                        best_mic = mic
            elif side == "2":
                # Sell — highest bid, top of book
                price = state.bids[0].price if state.bids else None
                if price is not None:
                    if best_price is None or price > best_price:
                        best_price = price
                        best_mic = mic

        if best_mic is None:
            # Fallback to first available venue
            if self._exchanges:
                best_mic = next(iter(self._exchanges))
                best_price = 0.0
            else:
                logger.error("BrokerHost: no venues available for order")
                return self._build_reject(raw, symbol, "No venues available")

        self._routed_count += 1
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "symbol": symbol,
            "side": side,
            "venue": best_mic,
            "price": best_price,
        }
        self._routing_log.append(entry)

        # Forward to the chosen venue
        exchange = self._exchanges[best_mic]
        venue_sym = symbol
        if self._resolver:
            venue_sym = self._resolver.resolve(symbol, best_mic)

        # Build venue-forward message
        forward = self._rewrite_for_venue(raw, best_mic, venue_sym)
        reply = await exchange._process_message(forward)

        # Publish to Redis if available
        await self._publish_event("order_routed", entry)
        return reply

    def route_order_sync(self, order: Any) -> Optional[dict]:
        """Synchronous order routing using the market data hub.

        Args:
            order: An OMS Order object or dict with symbol/side.

        Returns:
            The routing decision dict.
        """
        if hasattr(order, "symbol"):
            symbol = order.symbol
            side = order.side
        else:
            symbol = order.get("symbol", "UNKNOWN")
            side = order.get("side", "1")

        if self._md is None:
            return None

        quotes = self._md.get_all_quotes()
        best_mic: Optional[str] = None
        best_price: Optional[float] = None

        for sym, book in quotes.items():
            if not side or side == "1":
                price = book.asks[0].price if book.asks else None
                if price is not None:
                    if best_price is None or price < best_price:
                        best_price = price
                        best_mic = sym if sym in book else None
            elif side == "2":
                price = book.bids[0].price if book.bids else None
                if price is not None:
                    if best_price is None or price > best_price:
                        best_price = price
                        best_mic = sym

        result = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "symbol": symbol,
            "side": side,
            "venue": best_mic or "",
            "best_price": best_price,
        }
        return result

    # ------------------------------------------------------------------
    # FIX helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_tag(raw: str, tag: str) -> Optional[str]:
        """Extract a FIX tag value from pipe-delimited string."""
        for segment in raw.split("|"):
            parts = segment.split("=", 1)
            if len(parts) == 2 and parts[0].strip() == tag:
                return parts[1].strip()
        return None

    def _rewrite_for_venue(self, raw: str, venue: str, venue_sym: str) -> str:
        """Rewrite message target for a specific venue."""
        parts = raw.split("|")
        new_parts = []
        for p in parts:
            tag = p.split("=", 1)[0].strip()
            if tag == "49":
                new_parts.append(f"49=BROKER")
            elif tag == "56":
                new_parts.append(f"56={venue}")
            elif tag == "55":
                new_parts.append(f"55={venue_sym}")
            elif tag == "550":
                new_parts.append(f"550={venue}")
            else:
                new_parts.append(p)
        return "|".join(new_parts)

    def _build_acceptor_ack(self, request: str) -> str:
        self._client_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=A|34={self._client_seq}|49=BROKER|"
            f"52={self._ts()}|56=CLIENT|98=0|108=30|10=000"
        )

    def _build_heartbeat(self) -> str:
        self._client_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=0|34={self._client_seq}|49=BROKER|"
            f"52={self._ts()}|56=CLIENT|10=000"
        )

    def _build_ack(self) -> str:
        self._client_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=0|34={self._client_seq}|49=BROKER|"
            f"52={self._ts()}|56=CLIENT|10=000"
        )

    def _build_reject(self, raw: str, symbol: str, reason: str) -> str:
        self._client_seq += 1
        return (
            f"8=FIX.4.2|9=0|35=9|34={self._client_seq}|49=BROKER|"
            f"52={self._ts()}|56=CLIENT|55={symbol}|58={reason}|10=000"
        )

    @staticmethod
    def _ts() -> str:
        """Current UTC timestamp."""
        return datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S")

    # ------------------------------------------------------------------
    # Redis events
    # ------------------------------------------------------------------

    async def _publish_event(self, event_type: str, data: Optional[dict]) -> None:
        """Publish an event to the Redis broker_events channel."""
        if self._redis is None:
            return
        try:
            payload = json.dumps({"type": event_type, "data": data or {}})
            await self._redis.publish("broker_events", payload)
        except Exception:
            logger.exception("Failed to publish broker event")

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_broker_status(self) -> dict:
        """Return a status dict for monitoring."""
        return {
            "port": self.client_port,
            "running": self._is_running,
            "venues": list(self._exchanges.keys()),
            "venue_count": len(self._exchanges),
            "orders_routed": self._routed_count,
            "routing_log_tail": self._routing_log[-10:] if self._routing_log else [],
        }

"""MarketDataHub — market data hub with fault injection.

Generates realistic price ticks for all symbols using the same
random-walk price model as ExchangeSimulator. Maintains an
order-book simulation with 5 bid/ask levels, plus FX rates.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_TICK_SIZE = 0.01
DEFAULT_SPREAD_MIN = 0.01
DEFAULT_SPREAD_MAX = 0.05
DEFAULT_WALK_PCT = 0.0005

ORDER_BOOK_DEPTH = 5


@dataclass
class OrderBookLevel:
    price: float
    size: int


@dataclass
class OrderBook:
    bids: list[OrderBookLevel] = field(default_factory=list)
    asks: list[OrderBookLevel] = field(default_factory=list)
    last_mid: float = 0.0
    last_updated: str = ""


# Standard FX pairs and plausible starting rates
_DEFAULT_FX: dict[str, float] = {
    "CAD/USD": 0.7380,
    "GBP/USD": 1.2720,
    "EUR/USD": 1.0860,
    "PEN/USD": 0.2670,
}

_DEFAULT_SYMBOLS: dict[str, float] = {
    "AAPL": 195.50,
    "GOOG": 141.80,
    "MSFT": 417.50,
    "AMZN": 185.30,
    "JPM": 199.00,
    "RY": 136.20,
    "TD": 79.40,
    "BP": 38.50,
    "SHELL": 31.20,
}


class MarketDataHub:
    """Generates and publishes simulated market data.

    Maintains an order book per symbol, FX rates, and supports
    various fault-injection modes for testing resilience.

    Args:
        tick_interval_ms: Interval between price updates (default 100).
    """

    def __init__(
        self,
        symbols: Optional[dict[str, float]] = None,
        fx_rates: Optional[dict[str, float]] = None,
        tick_interval_ms: int = 100,
    ) -> None:
        self._books: dict[str, OrderBook] = {}
        for sym, base in (symbols or _DEFAULT_SYMBOLS).items():
            book = self._build_book(sym, base)
            self._books[sym] = book

        self._fx: dict[str, float] = dict(_DEFAULT_FX)
        if fx_rates:
            self._fx.update(fx_rates)

        # Fault state
        self._venue_delays: dict[str, float] = {}      # venue → delay_ms
        self._disconnected_venues: set[str] = set()    # venues currently down
        self._corrupted_fx: dict[str, float] = {}      # pair → bad rate
        self._reset_feeds: set[str] = set()            # venues needing reset

        self._tick_interval_ms = tick_interval_ms
        self._tick_task: Optional[asyncio.Task] = None
        self._last_published: float = 0.0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the periodic price-tick loop."""
        self._tick_task = asyncio.ensure_future(self._tick_loop())
        logger.info("MarketDataHub started (tick=%dms, symbols=%d)",
                     self._tick_interval_ms, len(self._books))

    async def stop(self) -> None:
        """Cancel the tick loop."""
        if self._tick_task is not None:
            self._tick_task.cancel()
            try:
                await self._tick_task
            except asyncio.CancelledError:
                pass
            self._tick_task = None
        logger.info("MarketDataHub stopped")

    # ------------------------------------------------------------------ #
    # Fault injection                                                     #
    # ------------------------------------------------------------------ #

    def delay_venue(self, venue: str, delay_ms: float) -> None:
        """Simulate a delayed data feed for *venue*."""
        self._venue_delays[venue.upper()] = delay_ms
        logger.info("MarketDataHub: venue %s delayed by %d ms", venue, delay_ms)

    def disconnect_venue(self, venue: str) -> None:
        """Simulate a venue disconnect."""
        self._disconnected_venues.add(venue.upper())
        logger.warning("MarketDataHub: venue %s disconnected", venue)

    def corrupt_fx_rate(self, pair: str, wrong_rate: float) -> None:
        """Override an FX rate with a bad value."""
        self._corrupted_fx[pair.upper()] = wrong_rate
        logger.warning("MarketDataHub: %s FX corrupted to %s", pair, wrong_rate)

    def reset_feed(self, venue: str) -> None:
        """Clear fault state for *venue*."""
        venue_upper = venue.upper()
        self._venue_delays.pop(venue_upper, None)
        self._disconnected_venues.discard(venue_upper)
        self._reset_feeds.discard(venue_upper)
        logger.info("MarketDataHub: venue %s reset", venue)

    def reset_fx(self, pair: str) -> None:
        """Remove FX corruption, restoring the original rate."""
        self._corrupted_fx.pop(pair.upper(), None)
        logger.info("MarketDataHub: %s FX rate restored", pair)

    # ------------------------------------------------------------------ #
    # Queries                                                             #
    # ------------------------------------------------------------------ #

    def get_quote(self, symbol: str) -> Optional[OrderBook]:
        """Return the current OrderBook for *symbol*."""
        return self._books.get(symbol)

    def get_fx_rate(self, pair: str) -> Optional[float]:
        """Return an FX rate. Returns corrupted value if one is set."""
        upper = pair.upper()
        if upper in self._corrupted_fx:
            return self._corrupted_fx[upper]
        return self._fx.get(upper)

    def get_all_quotes(self) -> dict[str, OrderBook]:
        """Return all current quotes keyed by symbol."""
        return dict(self._books)

    def get_fx_rates(self) -> dict[str, float]:
        """Return all FX rates (respecting any corruption)."""
        result = {}
        for pair, rate in self._fx.items():
            result[pair] = self._corrupted_fx.get(pair, rate)
        return result

    def staleness_ms(self, symbol: str) -> int:
        """Return age of the latest quote for *symbol* in ms.

        Returns -1 if the symbol is not tracked or has no valid timestamp.
        """
        book = self._books.get(symbol)
        if book is None or not book.last_updated:
            return -1
        try:
            ts = datetime.fromisoformat(book.last_updated)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return -1
        delta = datetime.now(timezone.utc) - ts
        return max(0, int(delta.total_seconds() * 1000))

    def is_stale(self, symbol: str, threshold_ms: int) -> bool:
        """True if MD for *symbol* is strictly older than *threshold_ms* (in ms) or unknown.

        A quote whose age equals *threshold_ms* exactly is considered fresh (not stale).
        """
        ms = self.staleness_ms(symbol)
        if ms < 0:
            return True
        return ms > threshold_ms

    # ------------------------------------------------------------------ #
    # Subscriptions (hook for broker to plug in)                          #
    # ------------------------------------------------------------------ #

    def subscribe(self, venue: str) -> None:
        """Register *venue* as an active data-feed subscriber."""
        self._reset_feeds.discard(venue.upper())
        logger.debug("MarketDataHub: venue %s subscribed", venue)

    # ------------------------------------------------------------------ #
    # Private                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_book(symbol: str, base_price: float) -> OrderBook:
        """Create an initial OrderBook for one symbol."""
        spread = random.uniform(DEFAULT_SPREAD_MIN, DEFAULT_SPREAD_MAX)
        bid = round(base_price - spread / 2, 2)
        ask = round(base_price + spread / 2, 2)
        return OrderBook(
            bids=[OrderBookLevel(
                price=round(bid - i * DEFAULT_TICK_SIZE, 2),
                size=random.randint(100, 5000),
            ) for i in range(ORDER_BOOK_DEPTH)],
            asks=[OrderBookLevel(
                price=round(ask + i * DEFAULT_TICK_SIZE, 2),
                size=random.randint(100, 5000),
            ) for i in range(ORDER_BOOK_DEPTH)],
            last_mid=base_price,
            last_updated=datetime.now(timezone.utc).isoformat(),
        )

    @staticmethod
    def _step_book(book: OrderBook) -> None:
        """Perform one random-walk step on the order book."""
        change = random.gauss(0, DEFAULT_WALK_PCT * book.last_mid)
        mid = round(book.last_mid + change, 2)
        if mid <= 0:
            mid = book.last_mid

        spread = random.uniform(DEFAULT_SPREAD_MIN, DEFAULT_SPREAD_MAX)
        bid = round(mid - spread / 2, 2)
        ask = round(mid + spread / 2, 2)

        book.last_mid = mid
        book.last_updated = datetime.now(timezone.utc).isoformat()
        book.bids = [
            OrderBookLevel(price=round(bid - i * DEFAULT_TICK_SIZE, 2),
                           size=random.randint(100, 5000))
            for i in range(ORDER_BOOK_DEPTH)
        ]
        book.asks = [
            OrderBookLevel(price=round(ask + i * DEFAULT_TICK_SIZE, 2),
                           size=random.randint(100, 5000))
            for i in range(ORDER_BOOK_DEPTH)
        ]

    async def _tick_loop(self) -> None:
        """Continuously refresh prices for all symbols."""
        interval = self._tick_interval_ms / 1000
        while True:
            try:
                for book in self._books.values():
                    self._step_book(book)
                self._last_published = time.monotonic()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("MarketDataHub tick failed")
            await asyncio.sleep(interval)

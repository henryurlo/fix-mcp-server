"""InterlistResolver — interlisted security mapping.

Maps symbols across venues so that the broker host can route orders
using a canonical name regardless of how the client names the security.
"""

from __future__ import annotations

import re
from typing import Optional

# ── Known interlistings ---------------------------------------------------
# Each entry: { canonical: {venue: symbol} }
_INTERLIST_MAP: dict[str, dict[str, str]] = {
    "AAPL": {
        "NASDAQ": "AAPL",
        "XTSE": "AAPL.TO",
    },
    "RY": {
        "NASDAQ": "RY",
        "XTSE": "RY.TO",
        "XETR": "RY.B",
    },
    "TD": {
        "NASDAQ": "TD",
        "XTSE": "TD.TO",
    },
    "BP": {
        "NASDAQ": "BP",
        "XLON": "BP.L",
        "XETR": "BPA.L",
    },
    "SHELL": {
        "NASDAQ": "SHELL",
        "XLON": "SHEL.L",
    },
    "GOOG": {
        "NASDAQ": "GOOG",
        "XTSE": "GOOG.TO",
    },
    "AMZN": {
        "NASDAQ": "AMZN",
        "XTSE": "AMZN.TO",
    },
}

# Build reverse lookup: {symbol_on_venue: canonical}
_REVERSE: dict[tuple[str, str], str] = {}
for canonical, venue_symbols in _INTERLIST_MAP.items():
    for venue, sym in venue_symbols.items():
        _REVERSE[(sym.upper(), venue.upper())] = canonical

# Also map bare symbol → canonical (first hit)
_BARE_TO_CANONICAL: dict[str, str] = {}
# Build bare-to-canonical from the primary mapping
for canonical, venue_syms in _INTERLIST_MAP.items():
    for venue, sym in venue_syms.items():
        bare = sym.upper()
        if bare not in _BARE_TO_CANONICAL and bare != canonical.upper():
            _BARE_TO_CANONICAL[bare] = canonical
        _BARE_TO_CANONICAL[canonical.upper()] = canonical


class InterlistResolver:
    """Resolve interlisted security names across venues.

    Each security has a *canonical* name.  Different venues may call it
    something else (e.g. AAPL ↔ AAPL.TO).  This resolver translates.
    """

    def __init__(self) -> None:
        self._map: dict[str, dict[str, str]] = {
            k: v for k, v in _INTERLIST_MAP.items()
        }
        self._reverse: dict[tuple[str, str], str] = dict(_REVERSE)
        self._bare: dict[str, str] = dict(_BARE_TO_CANONICAL)

    # ------------------------------------------------------------------ #
    # Public API                                                          #
    # ------------------------------------------------------------------ #

    def resolve(self, symbol: str, target_venue: str) -> str:
        """Return the symbol name used on *target_venue* for *symbol*.

        *symbol* may be either a canonical name or a venue-specific name.
        The resolver first normalises to canonical, then looks up the
        target venue's naming.

        Args:
            symbol: The security symbol to look up.
            target_venue: The venue MIC (e.g. ``"XTSE"``).

        Returns:
            The venue-specific symbol string, or the original *symbol*
            if no mapping exists.
        """
        canonical = self._to_canonical(symbol)
        venues = self._map.get(canonical)
        if venues is None:
            return symbol
        return venues.get(target_venue.upper(), symbol)

    def get_venumap(self, symbol: str) -> dict[str, str]:
        """Return a dict mapping every known venue to its symbol name.

        Args:
            symbol: Canonical or venue-specific symbol.

        Returns:
            ``{venue_mic: symbol_name}``, or an empty dict if unknown.
        """
        canonical = self._to_canonical(symbol)
        return dict(self._map.get(canonical, {}))

    def is_interlisted(self, symbol: str) -> bool:
        """Return ``True`` if *symbol* (canonical or any alias) is interlisted."""
        return self._to_canonical(symbol) in self._map

    def add_mapping(self, canonical: str, venue: str, venue_symbol: str) -> None:
        """Dynamically add an interlisted mapping at runtime.

        Args:
            canonical: The canonical name for this security.
            venue: Venue MIC (e.g. ``"XLON"``).
            venue_symbol: The symbol string used on that venue.
        """
        if canonical not in self._map:
            self._map[canonical] = {}
        self._map[canonical][venue.upper()] = venue_symbol

        self._reverse[(venue_symbol.upper(), venue.upper())] = canonical
        if venue_symbol.upper() not in self._bare:
            self._bare[venue_symbol.upper()] = canonical
        self._bare[canonical.upper()] = canonical

    # ------------------------------------------------------------------ #
    # Private                                                             #
    # ------------------------------------------------------------------ #

    def _to_canonical(self, symbol: str) -> str:
        """Best-effort canonical name from any input symbol string."""
        upper = symbol.upper()
        # Direct canonical
        if upper in self._map:
            return upper
        # Reverse lookup by (symbol, any_venue) — try bare match
        if upper in self._bare:
            return self._bare[upper]
        # Exhaustive reverse
        for (sym, ven), canon in self._reverse.items():
            if sym == upper:
                return canon
        return upper

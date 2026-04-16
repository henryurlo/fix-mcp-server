"""Reference data store for symbols, corporate actions, venues, and clients."""

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class CorporateAction:
    """Represents a single corporate action event.

    Attributes:
        action_id:     Unique identifier, e.g. ``"CA-2026-0328-001"``.
        action_type:   One of ``"ticker_change"``, ``"stock_split"``,
                       ``"merger"``, or ``"delisting"``.
        effective_date: ISO date string, e.g. ``"2026-03-28"``.
        old_symbol:    The symbol before the action (if applicable).
        new_symbol:    The symbol after the action (if applicable).
        ratio:         Split ratio string, e.g. ``"2:1"`` (if applicable).
        description:   Free-form human-readable description.
    """

    action_id: str
    action_type: str
    effective_date: str
    old_symbol: Optional[str] = None
    new_symbol: Optional[str] = None
    ratio: Optional[str] = None
    description: str = ""


@dataclass
class Symbol:
    """Represents a tradeable instrument.

    Attributes:
        symbol:           Primary ticker symbol, e.g. ``"AAPL"``.
        cusip:            9-character CUSIP identifier.
        name:             Full security name.
        listing_exchange: Primary listing exchange, e.g. ``"NYSE"``.
        lot_size:         Standard lot size (default 100).
        tick_size:        Minimum price increment (default 0.01).
        status:           One of ``"active"``, ``"halted"``,
                          ``"pending_ipo"``, or ``"delisting"``.
        corporate_actions: List of :class:`CorporateAction` objects
                           associated with this symbol.
    """

    symbol: str
    cusip: str
    name: str
    listing_exchange: str
    lot_size: int = 100
    tick_size: float = 0.01
    status: str = "active"
    corporate_actions: list = field(default_factory=list)


@dataclass
class Venue:
    """Represents a trading venue / exchange.

    Attributes:
        name:                  Short name, e.g. ``"NYSE"``.
        mic_code:              ISO 10383 MIC code, e.g. ``"XNYS"``.
        full_name:             Full legal name.
        supported_order_types: List of order-type strings supported.
        trading_hours:         Regular session string, e.g.
                               ``"09:30-16:00 ET"``.
        pre_market:            Pre-market session string, e.g.
                               ``"04:00-09:30 ET"``.
        fix_version:           FIX protocol version used (default
                               ``"FIX.4.2"``).
    """

    name: str
    mic_code: str
    full_name: str
    supported_order_types: list[str]
    trading_hours: str
    pre_market: str
    fix_version: str = "FIX.4.2"


@dataclass
class Client:
    """Represents a trading client.

    Attributes:
        client_id:   Unique identifier, e.g. ``"CLI-001"``.
        name:        Client name.
        tier:        One of ``"institutional"``, ``"retail"``, or
                     ``"proprietary"``.
        sla_minutes: Optional SLA fill-time in minutes.
        active:      Whether the client account is currently active.
    """

    client_id: str
    name: str
    tier: str
    sla_minutes: Optional[int] = None
    active: bool = True


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class ReferenceDataStore:
    """In-memory reference data store.

    Holds dictionaries for :class:`Symbol`, :class:`Venue`,
    :class:`Client`, and :class:`CorporateAction` objects and exposes
    a set of query and mutation helpers used by the MCP server tools.
    """

    def __init__(self) -> None:
        self.symbols: dict[str, Symbol] = {}
        self.venues: dict[str, Venue] = {}
        self.clients: dict[str, Client] = {}
        self.corporate_actions: dict[str, CorporateAction] = {}

    # ------------------------------------------------------------------
    # Symbol management
    # ------------------------------------------------------------------

    def add_symbol(self, symbol: Symbol) -> Symbol:
        """Store *symbol* keyed by its uppercase ticker.

        Args:
            symbol: The :class:`Symbol` instance to add.

        Returns:
            The stored :class:`Symbol` (same object).
        """
        self.symbols[symbol.symbol.upper()] = symbol
        return symbol

    def get_symbol(self, symbol: str) -> Optional[Symbol]:
        """Look up a :class:`Symbol` by ticker (case-insensitive).

        Args:
            symbol: Ticker string to look up.

        Returns:
            The matching :class:`Symbol`, or ``None`` if not found.
        """
        return self.symbols.get(symbol.upper())

    def get_symbol_by_cusip(self, cusip: str) -> Optional[Symbol]:
        """Look up a :class:`Symbol` by CUSIP.

        Args:
            cusip: The 9-character CUSIP identifier.

        Returns:
            The first matching :class:`Symbol`, or ``None``.
        """
        for sym in self.symbols.values():
            if sym.cusip == cusip:
                return sym
        return None

    def load_symbol(self, symbol: Symbol) -> Symbol:
        """Load a symbol into the store and force its status to ``"active"``.

        Intended for IPO-day loading: the symbol's ``status`` field is
        unconditionally set to ``"active"`` before storing.

        Args:
            symbol: The :class:`Symbol` instance to load.

        Returns:
            The stored :class:`Symbol` with status set to ``"active"``.
        """
        symbol.status = "active"
        return self.add_symbol(symbol)

    def is_symbol_valid(self, symbol: str) -> tuple[bool, str]:
        """Check whether *symbol* is present and tradeable.

        Args:
            symbol: Ticker to validate.

        Returns:
            A ``(valid, reason)`` tuple.  *valid* is ``True`` only when the
            symbol exists **and** its ``status`` is ``"active"``.  *reason*
            is a human-readable explanation for any failure.
        """
        sym = self.get_symbol(symbol)
        if sym is None:
            return False, f"Symbol '{symbol}' not found in reference data."
        if sym.status != "active":
            return False, (
                f"Symbol '{symbol}' is not active (current status: '{sym.status}')."
            )
        return True, "Symbol is valid and active."

    def update_symbol_ticker(
        self, old_symbol: str, new_symbol: str
    ) -> Optional[Symbol]:
        """Rename a symbol: update the dict key and the internal ``symbol`` field.

        Args:
            old_symbol: The existing ticker key (case-insensitive).
            new_symbol: The replacement ticker string.

        Returns:
            The updated :class:`Symbol`, or ``None`` if *old_symbol* was not
            found.
        """
        key = old_symbol.upper()
        sym = self.symbols.get(key)
        if sym is None:
            return None
        sym.symbol = new_symbol.upper()
        del self.symbols[key]
        self.symbols[new_symbol.upper()] = sym
        return sym

    # ------------------------------------------------------------------
    # Venue management
    # ------------------------------------------------------------------

    def add_venue(self, venue: Venue) -> Venue:
        """Store *venue* keyed by its uppercase short name.

        Args:
            venue: The :class:`Venue` instance to add.

        Returns:
            The stored :class:`Venue`.
        """
        self.venues[venue.name.upper()] = venue
        return venue

    def get_venue(self, name: str) -> Optional[Venue]:
        """Look up a :class:`Venue` by short name (case-insensitive).

        Args:
            name: Venue short name, e.g. ``"NYSE"``.

        Returns:
            The matching :class:`Venue`, or ``None``.
        """
        return self.venues.get(name.upper())

    # ------------------------------------------------------------------
    # Client management
    # ------------------------------------------------------------------

    def add_client(self, client: Client) -> Client:
        """Store *client* keyed by its ``client_id``.

        Args:
            client: The :class:`Client` instance to add.

        Returns:
            The stored :class:`Client`.
        """
        self.clients[client.client_id] = client
        return client

    def get_client(self, name: str) -> Optional[Client]:
        """Find a client by exact or case-insensitive partial name match.

        Attempts an exact match first, then falls back to substring search.
        This prevents accidental collisions (e.g. "Map" matching both
        "Maple Capital" *and* "Aspen Asset Management").

        Args:
            name: Exact or partial client name to search for.

        Returns:
            The best matching :class:`Client`, or ``None``.
        """
        name_lower = name.lower()
        # Exact match takes priority — avoids substring collisions.
        for client in self.clients.values():
            if client.name.lower() == name_lower:
                return client
        # Fallback: first substring match.
        for client in self.clients.values():
            if name_lower in client.name.lower():
                return client
        return None

    def get_institutional_clients(self) -> list[Client]:
        """Return all active institutional clients.

        Returns:
            List of :class:`Client` objects whose ``tier`` is
            ``"institutional"`` and ``active`` is ``True``.
        """
        return [
            c for c in self.clients.values()
            if c.tier == "institutional" and c.active
        ]

    # ------------------------------------------------------------------
    # Corporate action management
    # ------------------------------------------------------------------

    def add_corporate_action(self, action: CorporateAction) -> CorporateAction:
        """Store a :class:`CorporateAction` keyed by its ``action_id``.

        Args:
            action: The corporate action to store.

        Returns:
            The stored :class:`CorporateAction`.
        """
        self.corporate_actions[action.action_id] = action
        return action

    def get_effective_today_actions(
        self, today: Optional[str] = None
    ) -> list[CorporateAction]:
        """Return all corporate actions whose ``effective_date`` equals *today*.

        Args:
            today: ISO date string ``"YYYY-MM-DD"``.  If ``None``,
                   ``date.today().isoformat()`` is used.

        Returns:
            List of matching :class:`CorporateAction` objects.
        """
        if today is None:
            today = date.today().isoformat()
        return [
            a for a in self.corporate_actions.values()
            if a.effective_date == today
        ]

    def get_symbol_corporate_actions(self, symbol: str) -> list[CorporateAction]:
        """Return all corporate actions that reference *symbol* (old or new).

        Args:
            symbol: Ticker to search for (case-insensitive).

        Returns:
            List of :class:`CorporateAction` objects where either
            ``old_symbol`` or ``new_symbol`` matches *symbol*.
        """
        symbol_upper = symbol.upper()
        return [
            a for a in self.corporate_actions.values()
            if (a.old_symbol is not None and a.old_symbol.upper() == symbol_upper)
            or (a.new_symbol is not None and a.new_symbol.upper() == symbol_upper)
        ]

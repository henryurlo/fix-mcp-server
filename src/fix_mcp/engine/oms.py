from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class Order:
    order_id: str
    cl_ord_id: str
    symbol: str
    cusip: str
    side: str
    quantity: int
    order_type: str
    venue: str
    client_name: str
    created_at: str
    updated_at: str
    filled_quantity: int = 0
    price: Optional[float] = None
    status: str = "new"
    fix_messages: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    is_institutional: bool = False
    sla_minutes: Optional[int] = None

    @property
    def notional_value(self) -> float:
        return self.quantity * (self.price or 0.0)

    @property
    def remaining_quantity(self) -> int:
        return self.quantity - self.filled_quantity


class OMS:
    # Statuses considered "open" (not terminal)
    _OPEN_STATUSES = {"new", "partially_filled", "stuck", "pending_cancel"}

    def __init__(self) -> None:
        self.orders: dict[str, Order] = {}
        self._counter: int = 0

    # ------------------------------------------------------------------
    # ID generation
    # ------------------------------------------------------------------

    def generate_order_id(self) -> str:
        self._counter += 1
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"ORD-{date_str}-{self._counter:03d}"

    def generate_cl_ord_id(self) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        return f"CLO-{ts}-{self._counter:03d}"

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add_order(self, order: Order) -> Order:
        self.orders[order.order_id] = order
        return order

    def get_order(self, order_id: str) -> Optional[Order]:
        return self.orders.get(order_id)

    def update_order_status(
        self, order_id: str, status: str, **kwargs
    ) -> Optional[Order]:
        order = self.orders.get(order_id)
        if order is None:
            return None
        order.status = status
        for key, value in kwargs.items():
            if hasattr(order, key):
                setattr(order, key, value)
        order.updated_at = datetime.now(timezone.utc).isoformat()
        return order

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def query_orders(
        self,
        client_name: Optional[str] = None,
        symbol: Optional[str] = None,
        status: Optional[str] = None,
        venue: Optional[str] = None,
        order_id: Optional[str] = None,
    ) -> list[Order]:
        results: list[Order] = []
        for order in self.orders.values():
            if order_id is not None and order.order_id != order_id:
                continue
            if client_name is not None and order.client_name.lower() != client_name.lower():
                continue
            if symbol is not None and order.symbol.upper() != symbol.upper():
                continue
            if status is not None and order.status.lower() != status.lower():
                continue
            if venue is not None and order.venue.upper() != venue.upper():
                continue
            results.append(order)
        return results

    def get_stuck_orders(self) -> list[Order]:
        return [
            o for o in self.orders.values()
            if o.status == "stuck" or "venue_down" in o.flags
        ]

    def get_institutional_orders(self) -> list[Order]:
        active_statuses = {"new", "stuck", "partially_filled"}
        return [
            o for o in self.orders.values()
            if o.is_institutional and o.status in active_statuses
        ]

    def count_by_venue(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for order in self.orders.values():
            if order.status in self._OPEN_STATUSES:
                counts[order.venue] = counts.get(order.venue, 0) + 1
        return counts

    def total_notional_at_risk(self) -> float:
        at_risk_statuses = {"stuck", "new"}
        total = 0.0
        for order in self.orders.values():
            if order.is_institutional and order.status in at_risk_statuses:
                total += order.notional_value
        return total

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    def add_fix_message(self, order_id: str, msg: str) -> None:
        order = self.orders.get(order_id)
        if order is not None:
            order.fix_messages.append(msg)

    def add_flag(self, order_id: str, flag: str) -> None:
        order = self.orders.get(order_id)
        if order is not None and flag not in order.flags:
            order.flags.append(flag)

    def get_orders_by_venue(
        self, venue: str, status: Optional[str] = None
    ) -> list[Order]:
        results = [
            o for o in self.orders.values()
            if o.venue.upper() == venue.upper()
        ]
        if status is not None:
            results = [o for o in results if o.status.lower() == status.lower()]
        return results

    def bulk_update_symbol(
        self, old_symbol: str, new_symbol: str
    ) -> list[str]:
        updated_ids: list[str] = []
        for order in self.orders.values():
            if (
                order.symbol.upper() == old_symbol.upper()
                and order.status in self._OPEN_STATUSES
            ):
                order.symbol = new_symbol
                order.updated_at = datetime.now(timezone.utc).isoformat()
                updated_ids.append(order.order_id)
        return updated_ids

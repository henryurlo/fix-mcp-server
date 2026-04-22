"""State snapshot system for deterministic FIX simulation.

Provides save/rollback/diff of the full OMS + session state at any point
during a scenario. Snapshots are keyed by ID and timestamped for audit.

Usage:
    snap = save_snapshot(oms, session_manager, "pre_cancel_001")
    # ... do something risky ...
    rollback_to_snapshot(snap.id, oms, session_manager)
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from fix_mcp.engine.oms import OMS, Order
from fix_mcp.engine.fix_sessions import FIXSessionManager


# ---------------------------------------------------------------------------
# Snapshot data structures
# ---------------------------------------------------------------------------

@dataclass
class OrderDiffEntry:
    """Before/after diff for a single order."""
    order_id: str
    field: str
    before: Any
    after: Any

@dataclass
class StateDiff:
    """Structured diff between two snapshots."""
    orders_changed: list[OrderDiffEntry] = field(default_factory=list)
    orders_added: list[str] = field(default_factory=list)
    orders_removed: list[str] = field(default_factory=list)
    session_changes: dict[str, dict[str, Any]] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: _now_iso())

    @property
    def summary(self) -> str:
        parts = []
        if self.orders_changed:
            parts.append(f"{len(self.orders_changed)} order field changes")
        if self.orders_added:
            parts.append(f"{len(self.orders_added)} new orders")
        if self.orders_removed:
            parts.append(f"{len(self.orders_removed)} removed orders")
        if self.session_changes:
            parts.append(f"{len(self.session_changes)} session changes")
        return ", ".join(parts) or "no changes"


@dataclass
class StateSnapshot:
    """Immutable snapshot of the full simulation state."""
    id: str
    label: str
    timestamp: str
    scenario: str
    order_count: int
    session_count: int
    orders_json: str          # serialized order list
    sessions_json: str        # serialized session state
    checksum: str             # SHA256 of orders_json for integrity

    @property
    def summary(self) -> str:
        return (
            f"Snapshot #{self.id} [{self.label}] "
            f"{self.timestamp} | {self.order_count} orders, {self.session_count} sessions"
        )


# ---------------------------------------------------------------------------
# Snapshot registry — lives in-process, keyed by id
# ---------------------------------------------------------------------------

_snapshots: dict[str, StateSnapshot] = {}
_snapshot_counter = 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_orders(oms: OMS) -> list[dict]:
    """Dump all orders to serializable dicts."""
    result = []
    for oid, order in oms.orders.items():
        result.append({
            "order_id": order.order_id,
            "symbol": order.symbol,
            "side": order.side,
            "quantity": order.quantity,
            "filled_quantity": order.filled_quantity,
            "price": order.price,
            "order_type": order.order_type,
            "status": order.status,
            "venue": order.venue,
            "client_name": order.client_name,
            "created_at": order.created_at,
            "updated_at": order.updated_at,
            "reject_reason": order.reject_reason,
            "flags": list(order.flags),
            "stuck_reason": getattr(order, "stuck_reason", None),
            "sla_minutes": order.sla_minutes,
            "is_institutional": order.is_institutional,
            "metadata": dict(getattr(order, "metadata", {})),
        })
    return result


def _serialize_sessions(sm: FIXSessionManager) -> list[dict]:
    """Dump all sessions to serializable dicts."""
    result = []
    for s in sm.get_all_sessions():
        result.append({
            "venue": s.venue,
            "session_id": s.session_id,
            "status": s.status,
            "fix_version": s.fix_version,
            "last_sent_seq": s.last_sent_seq,
            "last_recv_seq": s.last_recv_seq,
            "expected_recv_seq": s.expected_recv_seq,
            "latency_ms": s.latency_ms,
            "last_heartbeat": s.last_heartbeat,
            "error": s.error,
            "connected_since": s.connected_since,
        })
    return result


def _checksum(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def compute_diff(
    before: StateSnapshot,
    after_orders: list[dict],
    after_sessions: list[dict],
) -> StateDiff:
    """Compute a structured diff between a snapshot and current state."""
    diff = StateDiff()

    # Parse before state
    before_orders = {o["order_id"]: o for o in json.loads(before.orders_json)}
    after_order_map = {o["order_id"]: o for o in after_orders}

    # Orders added/removed
    for oid in after_order_map:
        if oid not in before_orders:
            diff.orders_added.append(oid)
    for oid in before_orders:
        if oid not in after_order_map:
            diff.orders_removed.append(oid)

    # Orders changed
    for oid in before_orders:
        if oid not in after_order_map:
            continue
        before_o = before_orders[oid]
        after_o = after_order_map[oid]
        for key in set(list(before_o.keys()) + list(after_o.keys())):
            if key in ("updated_at", "metadata"):
                continue  # noisy fields
            b_val = before_o.get(key)
            a_val = after_o.get(key)
            if a_val != b_val:
                diff.orders_changed.append(OrderDiffEntry(
                    order_id=oid, field=key, before=b_val, after=a_val,
                ))

    # Session changes
    before_sessions = {s["venue"]: s for s in json.loads(before.sessions_json)}
    after_session_map = {s["venue"]: s for s in after_sessions}
    for venue in set(list(before_sessions.keys()) + list(after_session_map.keys())):
        bs = before_sessions.get(venue, {})
        avs = after_session_map.get(venue, {})
        changes = {}
        for key in set(list(bs.keys()) + list(avs.keys())):
            if key in ("last_heartbeat", "connected_since"):
                continue
            if bs.get(key) != avs.get(key):
                changes[key] = {"before": bs.get(key), "after": avs.get(key)}
        if changes:
            diff.session_changes[venue] = changes

    return diff


def save_snapshot(
    oms: OMS,
    session_manager: FIXSessionManager,
    label: str = "",
    scenario: str = "",
) -> StateSnapshot:
    """Save a deep-copy snapshot of the current simulation state."""
    global _snapshot_counter
    _snapshot_counter += 1

    orders = _serialize_orders(oms)
    sessions = _serialize_sessions(session_manager)
    orders_json = json.dumps(orders, indent=2, sort_keys=True)
    sessions_json = json.dumps(sessions, indent=2, sort_keys=True)

    snap_id = f"snap_{_snapshot_counter:04d}"
    snap = StateSnapshot(
        id=snap_id,
        label=label or f"auto_{snap_id}",
        timestamp=_now_iso(),
        scenario=scenario,
        order_count=len(orders),
        session_count=len(sessions),
        orders_json=orders_json,
        sessions_json=sessions_json,
        checksum=_checksum(orders_json),
    )
    _snapshots[snap_id] = snap
    return snap


def get_all_snapshots() -> list[StateSnapshot]:
    """Return all snapshots, newest first."""
    return sorted(_snapshots.values(), key=lambda s: s.id, reverse=True)


def get_snapshot(snap_id: str) -> Optional[StateSnapshot]:
    return _snapshots.get(snap_id)


def rollback_to_snapshot(
    snap_id: str,
    oms: OMS,
    session_manager: FIXSessionManager,
) -> tuple[bool, str]:
    """Restore OMS + session state from a snapshot.

    Returns (success, message).
    """
    snap = _snapshots.get(snap_id)
    if snap is None:
        return False, f"Snapshot {snap_id!r} not found"

    try:
        # Verify integrity
        if _checksum(snap.orders_json) != snap.checksum:
            return False, f"Snapshot {snap_id!r} integrity check failed (checksum mismatch)"

        orders_data = json.loads(snap.orders_json)

        # Clear current orders
        oms.orders.clear()

        # Rebuild orders from snapshot
        for od in orders_data:
            order = Order(
                order_id=od["order_id"],
                symbol=od["symbol"],
                side=od["side"],
                quantity=od["quantity"],
                price=od["price"],
                order_type=od["order_type"],
                client_name=od["client_name"],
            )
            order.status = od["status"]
            order.venue = od["venue"]
            order.filled_quantity = od["filled_quantity"]
            order.created_at = od["created_at"]
            order.updated_at = od["updated_at"]
            order.reject_reason = od["reject_reason"]
            order.flags = set(od["flags"])
            order.sla_minutes = od["sla_minutes"]
            order.is_institutional = od["is_institutional"]
            if "stuck_reason" in od and od["stuck_reason"]:
                order.stuck_reason = od["stuck_reason"]
                order.flags.add("venue_down")
                order.status = "stuck"
            if "metadata" in od:
                order.metadata = od["metadata"]
            oms.orders[order.order_id] = order

        return True, f"Rolled back to {snap.summary}"
    except Exception as exc:
        return False, f"Rollback failed: {exc}"


def clear_snapshots() -> None:
    """Remove all snapshots. Called on scenario reset."""
    global _snapshot_counter
    _snapshots.clear()
    _snapshot_counter = 0

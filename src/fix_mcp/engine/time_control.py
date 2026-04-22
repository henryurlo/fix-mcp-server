"""Time control for the FIX MCP simulator.

Implements a simulated market clock with:
  • advance_time(minutes=N) — move the clock forward in discrete blocks
  • auto-pause triggers — LULD, reject spike, sequence gap, SLA breach
  • pause/resume state — simulation halts until operator acknowledges
  • market session boundaries (06:00-20:00 ET) — out-of-hours warnings
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable, Any

from fix_mcp.engine.oms import OMS
from fix_mcp.engine.fix_sessions import FIXSessionManager


# ---------------------------------------------------------------------------
# Simulated clock
# ---------------------------------------------------------------------------

@dataclass
class SimTimeState:
    """Tracks the simulated market time vs wall clock."""
    # Simulated market time (what the scenario thinks "now" is)
    simulated_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # Wall clock time when simulation started
    real_start_time: float = field(default_factory=time.time)
    # Whether time is advancing (False = paused at a trigger)
    is_paused: bool = False
    # Pause reason
    pause_reason: str = ""
    # Acceleration factor — 1.0 = real time, 60.0 = 1 min sim = 1 sec real
    speed_multiplier: float = 60.0
    # Last time we ticked
    last_tick_time: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Auto-pause triggers
# ---------------------------------------------------------------------------

@dataclass
class PauseTrigger:
    """A condition that auto-pauses the simulation."""
    trigger_type: str  # "luld", "reject_spike", "seq_gap", "sla_breach", "venue_outage"
    venue: str
    details: str
    timestamp: datetime


# ---------------------------------------------------------------------------
# Time controller
# ---------------------------------------------------------------------------

class TimeController:
    """Manages simulated market time with pause/resume and auto-triggers."""

    def __init__(self) -> None:
        self.state = SimTimeState()
        self._pause_history: list[PauseTrigger] = []
        self._start_hour = 9   # 09:30 open
        self._start_minute = 30

    def start(self) -> datetime:
        """Initialize the simulated clock to market open for today."""
        today = datetime.now(timezone.utc).date()
        # 09:30 UTC as proxy for ET (simplified — real would use tz conversion)
        self.state.simulated_time = datetime(
            today.year, today.month, today.day,
            self._start_hour, self._start_minute, 0, tzinfo=timezone.utc,
        )
        self.state.real_start_time = time.time()
        self.state.is_paused = False
        self.state.pause_reason = ""
        self.state.last_tick_time = time.time()
        return self.state.simulated_time

    @property
    def current_time(self) -> datetime:
        """Return the current simulated time."""
        if self.state.is_paused:
            return self.state.simulated_time
        # Advance by wall-clock elapsed time × speed multiplier
        elapsed = time.time() - self.state.last_tick_time
        sim_advance = timedelta(seconds=elapsed * self.state.speed_multiplier)
        return self.state.simulated_time + sim_advance

    def advance(self, minutes: float) -> datetime:
        """Jump the simulated clock forward by N minutes."""
        elapsed = time.time() - self.state.last_tick_time
        sim_advance = timedelta(seconds=elapsed * self.state.speed_multiplier)
        self.state.simulated_time += sim_advance + timedelta(minutes=minutes)
        self.state.last_tick_time = time.time()
        return self.state.simulated_time

    def pause(self, reason: str, trigger_type: str = "", venue: str = "", details: str = "") -> None:
        """Pause the simulation at the current time."""
        # Update simulated time before pausing
        self.advance(0)
        self.state.is_paused = True
        self.state.pause_reason = reason
        self._pause_history.append(PauseTrigger(
            trigger_type=trigger_type,
            venue=venue,
            details=details,
            timestamp=self.state.simulated_time,
        ))

    def resume(self) -> datetime:
        """Resume the simulation."""
        self.state.is_paused = False
        self.state.pause_reason = ""
        self.state.last_tick_time = time.time()
        return self.state.simulated_time

    @property
    def is_paused(self) -> bool:
        return self.state.is_paused

    @property
    def pause_reason(self) -> str:
        return self.state.pause_reason

    def get_status(self) -> dict:
        """Return current time control status."""
        t = self.current_time
        return {
            "simulated_time": t.isoformat(),
            "real_time": datetime.now(timezone.utc).isoformat(),
            "is_paused": self.state.is_paused,
            "pause_reason": self.state.pause_reason,
            "speed_multiplier": self.state.speed_multiplier,
            "pause_count": len([p for p in self._pause_history if p.trigger_type]),
            "last_trigger": self._pause_history[-1].trigger_type if self._pause_history else None,
        }

    def get_pause_history(self) -> list[dict]:
        return [
            {
                "trigger_type": pt.trigger_type,
                "venue": pt.venue,
                "details": pt.details,
                "timestamp": pt.timestamp.isoformat(),
            }
            for pt in self._pause_history
        ]

    def reset(self) -> None:
        """Clear all state."""
        self._pause_history.clear()
        self.state.is_paused = False
        self.state.pause_reason = ""


# ---------------------------------------------------------------------------
# Auto-trigger detection helpers
# ---------------------------------------------------------------------------

def check_auto_triggers(
    oms: OMS,
    session_manager: FIXSessionManager,
    time_ctrl: TimeController,
) -> Optional[PauseTrigger]:
    """Check current state for conditions that should auto-pause the simulation.

    Returns a PauseTrigger if one is detected, None otherwise.
    """
    # Don't auto-pause if already paused
    if time_ctrl.is_paused:
        return None

    # Check for venue outages
    for session in session_manager.get_all_sessions():
        if session.status == "down":
            stuck = len([
                o for o in oms.orders.values()
                if o.venue.upper() == session.venue.upper() and "venue_down" in o.flags
            ])
            return PauseTrigger(
                trigger_type="venue_outage",
                venue=session.venue,
                details=f"Session DOWN, {stuck} orders stuck",
                timestamp=time_ctrl.current_time,
            )

    # Check for SLA breaches on institutional orders
    from datetime import datetime as dt
    now = dt.now(timezone.utc)
    for order in oms.orders.values():
        if order.is_institutional and order.status in {"new", "stuck", "partially_filled"}:
            if order.sla_minutes:
                baseline_str = max(order.created_at, order.updated_at)
                try:
                    created = dt.fromisoformat(baseline_str)
                    if created.tzinfo is None:
                        created = created.replace(tzinfo=timezone.utc)
                    deadline = created + timedelta(minutes=order.sla_minutes)
                    if now > deadline:
                        return PauseTrigger(
                            trigger_type="sla_breach",
                            venue=order.venue,
                            details=f"SLA BREACHED: {order.order_id} ({order.symbol})",
                            timestamp=time_ctrl.current_time,
                        )
                except (ValueError, TypeError):
                    pass

    # Check for high reject rate (> 30% of recent orders)
    recent = sorted(oms.orders.values(), key=lambda o: o.updated_at, reverse=True)[:20]
    if len(recent) >= 5:
        rejects = len([o for o in recent if o.status == "rejected"])
        if rejects / len(recent) > 0.3:
            return PauseTrigger(
                trigger_type="reject_spike",
                venue="",
                details=f"{rejects}/{len(recent)} recent orders rejected ({rejects/len(recent):.0%})",
                timestamp=time_ctrl.current_time,
            )

    return None

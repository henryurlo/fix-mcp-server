"""Algorithmic order management engine.

Supports TWAP, VWAP, POV, IS, DARK_AGG, and ICEBERG algo types.
Each AlgoOrder is a parent order that spawns child Order slices in the OMS.
The AlgoEngine tracks progress, schedule deviation, and execution quality.
"""

from dataclasses import dataclass, field
from typing import Optional


ALGO_TYPES = frozenset({"TWAP", "VWAP", "POV", "IS", "DARK_AGG", "ICEBERG"})

# Flags set by scenarios or algo logic
ALGO_FLAG_BEHIND_SCHEDULE = "algo_behind_schedule"
ALGO_FLAG_AHEAD_SCHEDULE = "algo_ahead_schedule"
ALGO_FLAG_OVER_PARTICIPATION = "over_participation"
ALGO_FLAG_SLICE_REJECTED = "slice_rejected"
ALGO_FLAG_HALT_MID_ALGO = "halt_mid_algo"
ALGO_FLAG_HIGH_IS_SHORTFALL = "high_is_shortfall"
ALGO_FLAG_SPREAD_WIDENED = "spread_widened"
ALGO_FLAG_VENUE_FALLBACK = "venue_fallback"
ALGO_FLAG_NO_DARK_FILL = "no_dark_fill"
ALGO_FLAG_UNCONFIRMED_FILLS = "unconfirmed_fills"
ALGO_FLAG_CHILD = "algo_child"           # applied to child orders in OMS


@dataclass
class AlgoOrder:
    """Parent algorithmic order — tracks schedule, execution quality, and child slices.

    Attributes:
        algo_id:          Unique identifier, e.g. "ALGO-20260328-001".
        client_name:      Trading client name (must match clients.json).
        symbol:           Exchange symbol.
        cusip:            CUSIP identifier.
        side:             "buy" or "sell".
        total_qty:        Total shares to execute.
        algo_type:        One of TWAP | VWAP | POV | IS | DARK_AGG | ICEBERG.
        start_time:       ISO-8601 datetime when algo began.
        venue:            Primary execution venue.
        created_at:       ISO-8601 creation timestamp.
        updated_at:       ISO-8601 last-modified timestamp.
        end_time:         ISO-8601 end of execution window (TWAP/VWAP).
        pov_rate:         Target participation rate, 0.0–1.0 (POV only).
        total_slices:     Number of child order slices planned.
        completed_slices: Slices with confirmed execution reports.
        executed_qty:     Cumulative shares filled across all slices.
        avg_px:           Volume-weighted average execution price.
        arrival_px:       Mid-price when algo started (IS benchmark).
        benchmark_px:     VWAP/TWAP reference price.
        schedule_pct:     Percentage of time window elapsed (0–100).
        execution_pct:    Percentage of total_qty executed (0–100).
        status:           running | paused | halted | completed | canceled | stuck.
        flags:            Problem flags (algo_behind_schedule, etc.).
        child_order_ids:  OMS order IDs of child slices.
        is_institutional: Whether the parent client is institutional.
        sla_minutes:      Client SLA for the overall algo execution.
        notes:            Operator notes about the algo's current state.
        md_freshness_gate_ms: If set, slicer must not release child orders
                              while MD for `symbol` is older than this threshold.
    """

    algo_id: str
    client_name: str
    symbol: str
    cusip: str
    side: str
    total_qty: int
    algo_type: str
    start_time: str
    venue: str
    created_at: str
    updated_at: str
    end_time: Optional[str] = None
    pov_rate: Optional[float] = None
    total_slices: int = 0
    completed_slices: int = 0
    executed_qty: int = 0
    avg_px: Optional[float] = None
    arrival_px: Optional[float] = None
    benchmark_px: Optional[float] = None
    schedule_pct: float = 0.0
    execution_pct: float = 0.0
    status: str = "running"
    flags: list[str] = field(default_factory=list)
    child_order_ids: list[str] = field(default_factory=list)
    is_institutional: bool = True
    sla_minutes: Optional[int] = None
    notes: str = ""
    md_freshness_gate_ms: Optional[int] = None

    # ------------------------------------------------------------------
    # Computed properties
    # ------------------------------------------------------------------

    @property
    def schedule_deviation_pct(self) -> float:
        """Positive = ahead of schedule, negative = behind schedule."""
        return self.execution_pct - self.schedule_pct

    @property
    def shortfall_bps(self) -> Optional[float]:
        """Implementation Shortfall in basis points vs arrival price.

        Positive = paid more (buy) or received less (sell) than arrival price.
        """
        if self.arrival_px and self.avg_px and self.arrival_px > 0:
            if self.side == "buy":
                diff = self.avg_px - self.arrival_px
            else:
                diff = self.arrival_px - self.avg_px
            return diff / self.arrival_px * 10000
        return None

    @property
    def remaining_qty(self) -> int:
        return max(0, self.total_qty - self.executed_qty)

    @property
    def notional_value(self) -> float:
        ref_px = self.avg_px or self.benchmark_px or self.arrival_px or 0.0
        return self.total_qty * ref_px

    @property
    def slice_size(self) -> int:
        if self.total_slices > 0:
            return self.total_qty // self.total_slices
        return 0


class AlgoEngine:
    """In-process store for active and historical algo orders.

    For production use, replace the in-memory dict with a PostgreSQL-backed
    store (see scripts/init_db.sql for the algo_orders table schema).
    """

    def __init__(self) -> None:
        self.algos: dict[str, AlgoOrder] = {}
        self._counter: int = 0

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add_algo(self, algo: AlgoOrder) -> AlgoOrder:
        self.algos[algo.algo_id] = algo
        return algo

    def get_algo(self, algo_id: str) -> Optional[AlgoOrder]:
        return self.algos.get(algo_id)

    def generate_algo_id(self) -> str:
        from datetime import datetime, timezone
        self._counter += 1
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"ALGO-{date_str}-{self._counter:03d}"

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_all(self) -> list[AlgoOrder]:
        return list(self.algos.values())

    def get_active(self) -> list[AlgoOrder]:
        return [a for a in self.algos.values()
                if a.status in {"running", "paused", "halted", "stuck"}]

    def get_by_status(self, *statuses: str) -> list[AlgoOrder]:
        status_set = set(statuses)
        return [a for a in self.algos.values() if a.status in status_set]

    def get_by_symbol(self, symbol: str) -> list[AlgoOrder]:
        return [a for a in self.algos.values()
                if a.symbol.upper() == symbol.upper()]

    def get_flagged(self, flag: str) -> list[AlgoOrder]:
        return [a for a in self.algos.values() if flag in a.flags]

    def get_problematic(self) -> list[AlgoOrder]:
        problem_flags = {
            ALGO_FLAG_BEHIND_SCHEDULE, ALGO_FLAG_OVER_PARTICIPATION,
            ALGO_FLAG_SLICE_REJECTED, ALGO_FLAG_HALT_MID_ALGO,
            ALGO_FLAG_HIGH_IS_SHORTFALL, ALGO_FLAG_SPREAD_WIDENED,
            ALGO_FLAG_VENUE_FALLBACK, ALGO_FLAG_UNCONFIRMED_FILLS,
        }
        return [
            a for a in self.algos.values()
            if a.status not in {"completed", "canceled"}
            and bool(set(a.flags) & problem_flags)
        ]

    # ------------------------------------------------------------------
    # State mutations
    # ------------------------------------------------------------------

    def pause_algo(self, algo_id: str) -> Optional[AlgoOrder]:
        algo = self.algos.get(algo_id)
        if algo and algo.status == "running":
            algo.status = "paused"
            from datetime import datetime, timezone
            algo.updated_at = datetime.now(timezone.utc).isoformat()
        return algo

    def resume_algo(self, algo_id: str) -> Optional[AlgoOrder]:
        algo = self.algos.get(algo_id)
        if algo and algo.status in {"paused", "halted"}:
            algo.status = "running"
            for f in (ALGO_FLAG_HALT_MID_ALGO,):
                if f in algo.flags:
                    algo.flags.remove(f)
            from datetime import datetime, timezone
            algo.updated_at = datetime.now(timezone.utc).isoformat()
        return algo

    def cancel_algo(self, algo_id: str) -> Optional[AlgoOrder]:
        algo = self.algos.get(algo_id)
        if algo and algo.status not in {"completed", "canceled"}:
            algo.status = "canceled"
            from datetime import datetime, timezone
            algo.updated_at = datetime.now(timezone.utc).isoformat()
        return algo

    def update_pov_rate(self, algo_id: str, new_rate: float) -> Optional[AlgoOrder]:
        algo = self.algos.get(algo_id)
        if algo and algo.algo_type in {"POV", "VWAP"}:
            algo.pov_rate = new_rate
            if ALGO_FLAG_OVER_PARTICIPATION in algo.flags:
                algo.flags.remove(ALGO_FLAG_OVER_PARTICIPATION)
            from datetime import datetime, timezone
            algo.updated_at = datetime.now(timezone.utc).isoformat()
        return algo

"""Scenario scoring engine with 4 KPIs and post-scenario dashboard.

KPIs:
  1. Time-to-recovery (ms/min) — how fast did the trader recover from disruptions?
  2. SLA breaches (count/total) — how many orders breached their SLA deadline?
  3. Regulatory/compliance violations (0 target) — wash trades, LULD violations, etc.
  4. Notional preserved vs lost — fill rate vs rejected/cancelled notional

Scored at scenario end. Returns a structured report for the dashboard.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from fix_mcp.engine.oms import OMS, Order
from fix_mcp.engine.fix_sessions import FIXSessionManager


# ---------------------------------------------------------------------------
# Event tracking
# ---------------------------------------------------------------------------

@dataclass
class TrackedEvent:
    timestamp: str
    event_type: str  # "venue_outage", "luld", "reject_spike", "seq_gap", "sla_breach"
    venue: str
    details: dict
    recovery_time: Optional[float] = None  # seconds to recovery, None if unresolved

    @property
    def duration_seconds(self) -> Optional[float]:
        return self.recovery_time if self.recovery_time is not None else None


@dataclass
class ApprovedAction:
    timestamp: str
    action: str
    tool_name: str
    order_ids: list[str]
    approved_by: str
    risk_flag: str
    result: str  # "success" | "failed" | "partial"
    affected_orders: list[str] = field(default_factory=list)
    error_code: Optional[str] = None  # SEQ_GAP, VENUE_REJECT, COMPLIANCE_BLOCK, SLA_EXPIRED


# ---------------------------------------------------------------------------
# Score report
# ---------------------------------------------------------------------------

@dataclass
class KPIScore:
    """Single KPI with its score, weight, and details."""
    name: str
    weight: float
    score: float  # 0.0 to 1.0
    raw_value: Any
    max_value: Any
    details: str


@dataclass
class ScenarioScoreReport:
    """Full post-scenario score report."""
    scenario: str
    timestamp: str
    duration_seconds: float

    # KPIs
    kpis: list[KPIScore] = field(default_factory=list)
    total_weighted_score: float = 0.0

    # Details
    sla_breaches: int = 0
    sla_total_institutional: int = 0
    compliance_violations: int = 0
    total_notional_lost: float = 0.0
    total_notional_preserved: float = 0.0
    recovery_times: list[float] = field(default_factory=list)
    avg_recovery_time: float = 0.0
    events: list[TrackedEvent] = field(default_factory=list)
    actions: list[ApprovedAction] = field(default_factory=list)

    @property
    def grade(self) -> str:
        s = self.total_weighted_score
        if s >= 0.90:
            return "A — Outstanding"
        if s >= 0.75:
            return "B — Competent"
        if s >= 0.60:
            return "C — Acceptable"
        if s >= 0.40:
            return "D — Needs Improvement"
        return "F — Critical Failures"

    def format_report(self) -> str:
        """Human-readable report for the dashboard."""
        lines = [
            f"SCENARIO SCORE REPORT — {self.scenario}",
            f"Timestamp: {self.timestamp}",
            f"Duration: {self.duration_seconds:.0f}s ({self.duration_seconds/60:.1f} min)",
            f"Overall Score: {self.total_weighted_score:.2f} ({self.grade})",
            "",
            "KPI BREAKDOWN",
            "─" * 60,
        ]

        for kpi in self.kpis:
            lines.append(f"  {kpi.name}: {kpi.score:.2f}/{1.0} (weight: {kpi.weight:.0%})")
            lines.append(f"    {kpi.details}")
            lines.append("")

        lines.append("EVENTS")
        lines.append("─" * 60)
        if self.events:
            for ev in self.events:
                dur = f"{ev.duration_seconds:.1f}s" if ev.duration_seconds else "UNRESOLVED"
                lines.append(f"  [{ev.event_type}] {ev.venue} — recovery: {dur}")
                if ev.details:
                    lines.append(f"    {ev.details}")
        else:
            lines.append("  No disruptive events recorded")

        lines.append("")
        lines.append("SLA SUMMARY")
        lines.append("─" * 60)
        lines.append(f"  Breaches: {self.sla_breaches} / {self.sla_total_institutional} institutional orders")

        lines.append("")
        lines.append("NOTIONAL SUMMARY")
        lines.append("─" * 60)
        lines.append(f"  Preserved (filled): ${self.total_notional_preserved:,.0f}")
        lines.append(f"  Lost (rejected/cancelled): ${self.total_notional_lost:,.0f}")
        total = self.total_notional_preserved + self.total_notional_lost
        fill_rate = (self.total_notional_preserved / total * 100) if total > 0 else 0
        lines.append(f"  Fill rate: {fill_rate:.1f}%")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Scoring Engine
# ---------------------------------------------------------------------------

@dataclass
class ScoringEngine:
    """Tracks events, actions, and computes post-scenario KPI scores."""

    scenario: str = ""
    events: list[TrackedEvent] = field(default_factory=list)
    actions: list[ApprovedAction] = field(default_factory=list)
    start_time: Optional[float] = None
    sla_breaches: int = 0
    compliance_violations: int = 0

    def start(self, scenario: str) -> None:
        self.scenario = scenario
        self.events = []
        self.actions = []
        self.start_time = time.time()
        self.sla_breaches = 0
        self.compliance_violations = 0

    def track_event(
        self,
        event_type: str,
        venue: str = "",
        details: Optional[dict] = None,
    ) -> None:
        self.events.append(TrackedEvent(
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type=event_type,
            venue=venue,
            details=details or {},
        ))

    def resolve_event(self, event_type: str, venue: str = "") -> bool:
        """Mark the most recent unresolved event of this type/venue as resolved."""
        for ev in reversed(self.events):
            if ev.event_type == event_type and ev.venue == venue and ev.recovery_time is None:
                elapsed = time.time() - self.start_time if self.start_time else 0
                ev.recovery_time = elapsed
                return True
        return False

    def record_action(
        self,
        tool_name: str,
        action: str,
        order_ids: list[str],
        approved_by: str,
        risk_flag: str,
        result: str,
        affected_orders: Optional[list[str]] = None,
        error_code: Optional[str] = None,
    ) -> None:
        self.actions.append(ApprovedAction(
            timestamp=datetime.now(timezone.utc).isoformat(),
            action=action,
            tool_name=tool_name,
            order_ids=order_ids,
            approved_by=approved_by,
            risk_flag=risk_flag,
            result=result,
            affected_orders=affected_orders or order_ids,
            error_code=error_code,
        ))

    def mark_sla_breach(self) -> None:
        self.sla_breaches += 1

    def mark_compliance_violation(self) -> None:
        self.compliance_violations += 1

    def compute_score(
        self,
        oms: OMS,
        session_manager: FIXSessionManager,
    ) -> ScenarioScoreReport:
        """Compute full KPI score report from final state."""
        duration = time.time() - self.start_time if self.start_time else 0
        orders = list(oms.orders.values())

        # === KPI 1: Time-to-recovery ===
        recovery_times = [
            ev.duration_seconds for ev in self.events
            if ev.duration_seconds is not None
        ]
        avg_recovery = sum(recovery_times) / len(recovery_times) if recovery_times else 0.0

        unrecovered = [ev for ev in self.events if ev.recovery_time is None]
        # Score: 1.0 = all recovered quickly, 0.0 = nothing recovered
        if not self.events:
            recovery_score = 1.0
        elif not unrecovered:
            # All recovered — score inversely proportional to avg recovery time
            # Max score at < 30s, degrading to 0 at > 5 min
            recovery_score = max(0.0, 1.0 - (avg_recovery / 300.0))
        else:
            # Unrecovered events penalize heavily
            recovery_score = max(0.0, 0.3 - (len(unrecovered) * 0.1))

        # === KPI 2: SLA breaches ===
        institutional = [o for o in orders if o.is_institutional]
        sla_total = len(institutional)
        breach_score = 1.0
        if sla_total > 0:
            breach_ratio = self.sla_breaches / sla_total
            breach_score = max(0.0, 1.0 - (breach_ratio * 2))  # 0 breaches=1.0, 50%+=0.0

        # === KPI 3: Compliance violations ===
        compliance_score = max(0.0, 1.0 - (self.compliance_violations * 0.5))

        # === KPI 4: Notional preserved ===
        filled = [o for o in orders if o.status == "filled"]
        rejected = [o for o in orders if o.status == "rejected"]
        cancelled = [o for o in orders if o.status == "canceled"]

        preserved = sum(o.notional_value for o in filled)
        lost_rejected = sum(o.notional_value for o in rejected)
        lost_cancelled = sum(o.notional_value for o in cancelled)
        total_notional = preserved + lost_rejected + lost_cancelled

        notional_score = (preserved / total_notional) if total_notional > 0 else 1.0

        # === Weighted total ===
        weights = {
            "recovery": 0.20,
            "sla": 0.30,
            "compliance": 0.30,
            "notional": 0.20,
        }
        total_score = (
            recovery_score * weights["recovery"]
            + breach_score * weights["sla"]
            + compliance_score * weights["compliance"]
            + notional_score * weights["notional"]
        )

        report = ScenarioScoreReport(
            scenario=self.scenario,
            timestamp=datetime.now(timezone.utc).isoformat(),
            duration_seconds=duration,
            sla_breaches=self.sla_breaches,
            sla_total_institutional=sla_total,
            compliance_violations=self.compliance_violations,
            total_notional_lost=lost_rejected + lost_cancelled,
            total_notional_preserved=preserved,
            recovery_times=recovery_times,
            avg_recovery_time=avg_recovery,
            events=self.events.copy(),
            actions=self.actions.copy(),
        )

        report.kpis = [
            KPIScore(
                name="Time-to-Recovery",
                weight=weights["recovery"],
                score=recovery_score,
                raw_value=f"{avg_recovery:.1f}s avg",
                max_value="< 30s",
                details=f"Recovered {len(recovery_times)}/{len(self.events)} events, {len(unrecovered)} unresolved",
            ),
            KPIScore(
                name="SLA Compliance",
                weight=weights["sla"],
                score=breach_score,
                raw_value=f"{self.sla_breaches}/{sla_total}",
                max_value="0 breaches",
                details=f"{self.sla_breaches} SLA breaches out of {sla_total} institutional orders",
            ),
            KPIScore(
                name="Regulatory Compliance",
                weight=weights["compliance"],
                score=compliance_score,
                raw_value=str(self.compliance_violations),
                max_value="0 violations",
                details=f"{self.compliance_violations} compliance violations detected",
            ),
            KPIScore(
                name="Notional Preserved",
                weight=weights["notional"],
                score=notional_score,
                raw_value=f"${preserved:,.0f}",
                max_value=f"${total_notional:,.0f} total",
                details=f"Fill rate: {notional_score:.0%} (${lost_rejected:,.0f} rejected, ${lost_cancelled:,.0f} cancelled)",
            ),
        ]

        report.total_weighted_score = round(total_score, 4)
        return report

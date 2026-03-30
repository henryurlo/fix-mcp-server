"""
FIX MCP Demo Orchestrator — The Jaw-Drop Demo.

Runs the log generator and monitor together, showing autonomous detection
and remediation in real time. This is the demo where someone opens their
laptop at 6am and sees "3 issues auto-resolved overnight."

Usage:
    # Full autonomous demo (log gen + monitor + simulated API)
    python -m fix_mcp.demo_orchestrator --scenario vwap_vol_spike_1130

    # The money demo:
    python -m fix_mcp.demo_orchestrator --scenario morning_triage --speed 20
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .log_generator import FIXLogGenerator
from .log_monitor import (
    FIXLogMonitor, EventBus, PatternMatcher, EscalationPolicy,
    AuditTrail, EscalationHandler, CHANNEL_ALERTS, CHANNEL_ACTIONS,
    Severity, Alert, RemediationAction,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Terminal Colors
# ---------------------------------------------------------------------------
class C:
    RESET   = "\033[0m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    RED     = "\033[91m"
    GREEN   = "\033[92m"
    YELLOW  = "\033[93m"
    BLUE    = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN    = "\033[96m"
    WHITE   = "\033[97m"
    BG_RED  = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"


SEVERITY_COLORS = {
    "info":      C.BLUE,
    "warning":   C.YELLOW,
    "critical":  C.RED,
    "emergency": C.BG_RED + C.WHITE,
}


# ---------------------------------------------------------------------------
# Simulated API (for demo without real server)
# ---------------------------------------------------------------------------
class SimulatedAPI:
    """
    Simulates the REST API responses for demo mode.
    In production, the real APIClient talks to the actual FIX MCP REST server.
    """

    async def call_tool(self, tool: str, arguments: dict) -> dict:
        # Simulate processing delay
        await asyncio.sleep(0.3)

        responses = {
            "fix_session_issue": {
                "status": "ok",
                "action": arguments.get("action", "reconnect"),
                "venue": arguments.get("venue", "UNKNOWN"),
                "result": "Session reconnected successfully",
                "new_seq": 1,
            },
            "check_fix_sessions": {
                "status": "ok",
                "venue": arguments.get("venue", "UNKNOWN"),
                "connected": True,
                "latency_ms": 12,
                "sender_seq": 1050,
                "target_seq": 1048,
            },
            "check_ticker": {
                "status": "ok",
                "symbol": arguments.get("query", "???"),
                "halted": False,
                "ssr_active": False,
                "open_orders": 3,
            },
            "query_orders": {
                "status": "ok",
                "orders": [],
                "count": 0,
            },
            "modify_algo": {
                "status": "ok",
                "action": arguments.get("action", "pause"),
                "result": "Algo paused successfully",
            },
            "run_premarket_check": {
                "status": "ok",
                "sessions": {"NYSE": "ok", "ARCA": "ok", "BATS": "ok", "IEX": "ok"},
                "issues": [],
            },
        }
        return responses.get(tool, {"status": "ok", "tool": tool})


# ---------------------------------------------------------------------------
# Live Console Display
# ---------------------------------------------------------------------------
class ConsoleDisplay:
    """Real-time terminal display for the demo."""

    def __init__(self):
        self.alerts: list[dict] = []
        self.actions: list[dict] = []
        self.escalations: list[dict] = []
        self._start_time = time.monotonic()

    def _elapsed(self) -> str:
        elapsed = time.monotonic() - self._start_time
        mins = int(elapsed // 60)
        secs = int(elapsed % 60)
        return f"{mins:02d}:{secs:02d}"

    async def on_event(self, channel: str, event: dict):
        """Callback for EventBus events."""
        event_type = event.get("type", "unknown")

        if event_type == "alert":
            self._print_alert(event)
        elif event_type == "action_executed":
            self._print_action(event)
        elif event_type == "escalation":
            self._print_escalation(event)

    def _print_alert(self, event: dict):
        severity = event.get("severity", "info")
        color = SEVERITY_COLORS.get(severity, C.WHITE)
        venue = event.get("venue", "???")
        desc = event.get("description", "")

        print(
            f"  {C.DIM}[{self._elapsed()}]{C.RESET} "
            f"{color}{C.BOLD}▲ {severity.upper()}{C.RESET} "
            f"{C.CYAN}[{venue}]{C.RESET} {desc}"
        )
        self.alerts.append(event)

    def _print_action(self, event: dict):
        tool = event.get("tool", "?")
        venue = event.get("venue", "?")
        result = event.get("result", {})
        status = result.get("status", "?") if isinstance(result, dict) else "ok"

        icon = f"{C.GREEN}✓{C.RESET}" if status == "ok" else f"{C.RED}✗{C.RESET}"
        print(
            f"  {C.DIM}[{self._elapsed()}]{C.RESET} "
            f"{icon} {C.GREEN}AUTO-REMEDIATED{C.RESET} "
            f"{C.CYAN}[{venue}]{C.RESET} → {tool}({json.dumps(event.get('arguments', {}))})"
        )
        self.actions.append(event)

    def _print_escalation(self, event: dict):
        alert = event.get("alert", {})
        reason = event.get("reason", "")
        proposed = event.get("proposed_action", {})

        print(
            f"\n  {C.DIM}[{self._elapsed()}]{C.RESET} "
            f"{C.BG_YELLOW}{C.BOLD} ⚠ ESCALATED — HUMAN APPROVAL REQUIRED {C.RESET}"
        )
        print(f"    {C.YELLOW}Alert:{C.RESET}    {alert.get('description', '?')}")
        print(f"    {C.YELLOW}Reason:{C.RESET}   {reason}")
        print(f"    {C.YELLOW}Proposed:{C.RESET} {proposed.get('description', '?')}")
        print(f"    {C.YELLOW}Status:{C.RESET}   Waiting in escalation queue\n")
        self.escalations.append(event)

    def print_header(self, scenario: str):
        print(f"\n{C.BOLD}{'='*72}{C.RESET}")
        print(f"  {C.BOLD}{C.CYAN}FIX MCP — Autonomous Operations Demo{C.RESET}")
        print(f"  {C.DIM}Scenario: {scenario}{C.RESET}")
        print(f"  {C.DIM}Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{C.RESET}")
        print(f"{C.BOLD}{'='*72}{C.RESET}")
        print(f"  {C.DIM}Watching FIX log stream for fault patterns...{C.RESET}\n")

    def print_summary(self):
        total_alerts = len(self.alerts)
        auto_resolved = len(self.actions)
        escalated = len(self.escalations)

        print(f"\n{C.BOLD}{'─'*72}{C.RESET}")
        print(f"  {C.BOLD}{C.GREEN}Morning Briefing{C.RESET}")
        print(f"{'─'*72}")
        print(f"  Total alerts detected:    {C.BOLD}{total_alerts}{C.RESET}")
        print(f"  Auto-resolved:            {C.GREEN}{C.BOLD}{auto_resolved}{C.RESET}")
        print(f"  Escalated (human review): {C.YELLOW}{C.BOLD}{escalated}{C.RESET}")

        if self.actions:
            print(f"\n  {C.BOLD}Auto-resolved issues:{C.RESET}")
            for a in self.actions:
                print(f"    {C.GREEN}✓{C.RESET} [{a.get('venue','?')}] {a.get('tool','')} — OK")

        if self.escalations:
            print(f"\n  {C.BOLD}Awaiting approval:{C.RESET}")
            for e in self.escalations:
                alert = e.get("alert", {})
                print(f"    {C.YELLOW}⚠{C.RESET} [{alert.get('venue','?')}] {alert.get('description','')}")

        print(f"{'─'*72}\n")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
class DemoOrchestrator:
    """
    Wires the log generator and monitor together.
    In demo mode, uses simulated API. In production, uses real REST API.
    """

    def __init__(
        self,
        scenario: str = "morning_triage",
        speed: float = 20.0,
        api_url: Optional[str] = None,
        redis_url: Optional[str] = None,
        database_url: Optional[str] = None,
        use_simulated_api: bool = True,
    ):
        self.scenario = scenario
        self.speed = speed
        self.display = ConsoleDisplay()

        # Log generator
        self.generator = FIXLogGenerator(
            scenario=scenario,
            speed_multiplier=speed,
            seed=42,
        )

        # Event bus
        self.event_bus = EventBus(redis_url)
        self.event_bus.subscribe_local(self.display.on_event)

        # Pattern matcher + escalation
        policy = EscalationPolicy(
            notional_threshold=10_000_000,
            algo_modification=True,
            regulatory_flag=True,
        )
        self.matcher = PatternMatcher(policy)
        self.audit = AuditTrail(database_url, fallback_path=f"/tmp/fix_audit_{scenario}.jsonl")
        self.escalation = EscalationHandler(policy, self.audit, self.event_bus)

        # API client (simulated or real)
        if use_simulated_api:
            self.api = SimulatedAPI()
        else:
            from .log_monitor import APIClient
            self.api = APIClient(api_url or "http://localhost:8000")

        self._stats = {"lines": 0, "alerts": 0, "actions": 0, "escalations": 0}

    async def run(self, duration_seconds: float = 120):
        """Run the full demo for specified duration."""
        await self.event_bus.connect()
        await self.audit.connect()

        self.display.print_header(self.scenario)

        try:
            line_count = 0
            async for line in self.generator.stream():
                self._stats["lines"] += 1

                # Process through pattern matcher
                results = self.matcher.check(f"[sim] [{self.generator.sessions.get('NYSE', 'UNK')}] {line}")
                # Also try matching against the raw line
                results.extend(self.matcher.check(line))

                for alert, action in results:
                    self._stats["alerts"] += 1

                    # Publish alert
                    await self.event_bus.publish(CHANNEL_ALERTS, {
                        "type": "alert", **alert.to_dict(),
                    })

                    if action:
                        should_escalate, reason = self.escalation.should_escalate(alert, action)

                        if should_escalate:
                            self._stats["escalations"] += 1
                            await self.escalation.escalate(alert, action, reason)
                        else:
                            # Auto-remediate
                            result = await self.api.call_tool(action.tool, action.arguments)
                            self._stats["actions"] += 1

                            await self.event_bus.publish(CHANNEL_ACTIONS, {
                                "type": "action_executed",
                                "tool": action.tool,
                                "arguments": action.arguments,
                                "result": result,
                                "alert_type": alert.alert_type.value,
                                "venue": alert.venue,
                            })
                            await self.audit.record(alert, action, result)

                line_count += 1
                sim_elapsed = self.generator._sim_elapsed()

                # Stop after duration
                if sim_elapsed > duration_seconds:
                    break

        except KeyboardInterrupt:
            pass
        finally:
            # Print morning briefing
            self.display.print_summary()

            # Write audit summary
            audit_path = Path(f"/tmp/fix_audit_{self.scenario}.jsonl")
            if audit_path.exists():
                print(f"  {C.DIM}Audit trail: {audit_path}{C.RESET}")

            await self.event_bus.close()
            await self.audit.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    import argparse

    scenarios = [
        "morning_triage", "bats_startup_0200", "predawn_adrs_0430",
        "preopen_auction_0900", "open_volatility_0930", "venue_degradation_1030",
        "ssr_and_split_1130", "iex_recovery_1400", "eod_moc_1530",
        "afterhours_dark_1630", "twap_slippage_1000", "vwap_vol_spike_1130",
        "is_dark_failure_1415",
    ]

    parser = argparse.ArgumentParser(description="FIX MCP Autonomous Demo")
    parser.add_argument("--scenario", default="morning_triage", choices=scenarios)
    parser.add_argument("--speed", type=float, default=20.0, help="Speed multiplier")
    parser.add_argument("--duration", type=float, default=300, help="Sim duration in seconds")
    parser.add_argument("--api", default=None, help="REST API URL (uses simulated if omitted)")
    parser.add_argument("--redis", default=None, help="Redis URL")
    parser.add_argument("--database", default=None, help="PostgreSQL URL")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    demo = DemoOrchestrator(
        scenario=args.scenario,
        speed=args.speed,
        api_url=args.api,
        redis_url=args.redis,
        database_url=args.database,
        use_simulated_api=(args.api is None),
    )

    asyncio.run(demo.run(duration_seconds=args.duration))


if __name__ == "__main__":
    main()

"""
FIX Log Monitor — Real-time log tailer with pattern detection and auto-remediation.

Watches FIX log files, detects known fault patterns (seq gaps, session drops,
latency spikes, rejects, halts), and triggers actions via the REST API.
Publishes events to Redis for live dashboard updates.

This is THE MISSING LINK — it turns passive logs into autonomous action.

Usage:
    # Watch a directory
    python -m fix_mcp.log_monitor --watch /var/log/fix/ --api http://localhost:8000

    # Programmatic
    monitor = FIXLogMonitor(api_url="http://localhost:8000", redis_url="redis://localhost:6379")
    await monitor.watch("/var/log/fix/fix_combined.log")
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional, Callable, Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Alert Severity & Types
# ---------------------------------------------------------------------------
class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"   # Requires human escalation


class AlertType(str, Enum):
    SESSION_DROP = "session_drop"
    SEQ_GAP = "seq_gap"
    LATENCY_SPIKE = "latency_spike"
    REJECT_BURST = "reject_burst"
    HALT = "halt"
    STALE_FEED = "stale_feed"
    HEARTBEAT_TIMEOUT = "heartbeat_timeout"
    HIGH_NOTIONAL_RISK = "high_notional_risk"
    ALGO_BREACH = "algo_breach"


# ---------------------------------------------------------------------------
# Alert & Action Data Classes
# ---------------------------------------------------------------------------
@dataclass
class Alert:
    """A detected condition that may require action."""
    alert_type: AlertType
    severity: Severity
    venue: str
    description: str
    raw_line: str
    detected_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    params: dict = field(default_factory=dict)
    auto_remediated: bool = False
    remediation_action: str = ""
    escalated: bool = False

    def to_dict(self) -> dict:
        return {
            "alert_type": self.alert_type.value,
            "severity": self.severity.value,
            "venue": self.venue,
            "description": self.description,
            "detected_at": self.detected_at,
            "params": self.params,
            "auto_remediated": self.auto_remediated,
            "remediation_action": self.remediation_action,
            "escalated": self.escalated,
        }


@dataclass
class RemediationAction:
    """An action to execute via the REST API."""
    tool: str
    arguments: dict
    description: str
    requires_approval: bool = False    # Human-in-the-loop flag
    notional_at_risk: float = 0.0


# ---------------------------------------------------------------------------
# Escalation Policy
# ---------------------------------------------------------------------------
@dataclass
class EscalationPolicy:
    """Defines when to escalate to human operators."""
    notional_threshold: float = 10_000_000.0   # $10M
    severity_threshold: Severity = Severity.EMERGENCY
    algo_modification: bool = True              # Always escalate algo changes
    regulatory_flag: bool = True                # Always escalate regulatory issues
    max_auto_actions_per_minute: int = 10       # Rate limit auto-remediation

    # Escalation channels
    slack_webhook: Optional[str] = None
    escalation_queue_table: str = "escalation_queue"


# ---------------------------------------------------------------------------
# Pattern Matchers
# ---------------------------------------------------------------------------
class PatternMatcher:
    """
    Matches FIX log lines against known fault patterns.
    Returns alerts with suggested remediation actions.
    """

    # FIX field extraction
    FIELD_RE = re.compile(r'(\d+)=([^|]+)')

    # Venue extraction from log prefix: [timestamp] [VENUE] ...
    PREFIX_RE = re.compile(r'\[([^\]]+)\]\s+\[([A-Z]+)\]')

    def __init__(self, escalation_policy: Optional[EscalationPolicy] = None):
        self.policy = escalation_policy or EscalationPolicy()
        self._reject_window: dict[str, list[float]] = {}  # venue -> timestamps
        self._heartbeat_last: dict[str, float] = {}       # venue -> last seen
        self._alert_counts: dict[str, int] = {}           # dedup tracking

    def parse_fix_fields(self, line: str) -> dict[str, str]:
        """Extract FIX tag=value pairs from a log line."""
        return dict(self.FIELD_RE.findall(line))

    # Map FIX CompIDs to venue names
    COMPID_TO_VENUE = {
        "NYSE": "NYSE", "ARCA": "ARCA", "BATS": "BATS",
        "IEX": "IEX", "LQNT": "DARK",
    }

    def parse_venue(self, line: str) -> str:
        """Extract venue from log line prefix or FIX SenderCompID/TargetCompID."""
        m = self.PREFIX_RE.search(line)
        if m:
            return m.group(2)
        # Fall back to FIX fields
        fields = self.parse_fix_fields(line)
        for tag in ("49", "56"):
            comp_id = fields.get(tag, "")
            if comp_id in self.COMPID_TO_VENUE:
                return self.COMPID_TO_VENUE[comp_id]
        return "UNKNOWN"

    def parse_timestamp(self, line: str) -> Optional[str]:
        """Extract timestamp from log line prefix."""
        m = self.PREFIX_RE.search(line)
        return m.group(1) if m else None

    def check(self, line: str) -> list[tuple[Alert, Optional[RemediationAction]]]:
        """
        Check a single log line against all patterns.
        Returns list of (Alert, RemediationAction or None) tuples.
        """
        results = []
        fields = self.parse_fix_fields(line)
        venue = self.parse_venue(line)
        msg_type = fields.get("35", "")

        # --- Session Drop (35=5 Logout unexpected) ---
        if msg_type == "5":
            text = fields.get("58", "")
            if "unexpected" in text.lower() or "disconnect" in text.lower():
                alert = Alert(
                    alert_type=AlertType.SESSION_DROP,
                    severity=Severity.CRITICAL,
                    venue=venue,
                    description=f"{venue} session dropped: {text}",
                    raw_line=line,
                    params={"text": text},
                )
                action = RemediationAction(
                    tool="fix_session_issue",
                    arguments={"venue": venue, "action": "reconnect"},
                    description=f"Auto-reconnect {venue} session",
                )
                results.append((alert, action))

        # --- Session Status (35=h, 325=8 = offline) ---
        if msg_type == "h" and fields.get("325") == "8":
            alert = Alert(
                alert_type=AlertType.SESSION_DROP,
                severity=Severity.CRITICAL,
                venue=venue,
                description=f"{venue} SessionStatus=8 (offline)",
                raw_line=line,
                params={"session_status": 8},
            )
            action = RemediationAction(
                tool="fix_session_issue",
                arguments={"venue": venue, "action": "reconnect"},
                description=f"Attempt reconnect to {venue}",
            )
            results.append((alert, action))

        # --- Sequence Gap (35=4 SequenceReset) ---
        if msg_type == "4":
            new_seq = int(fields.get("36", "0"))
            gap_fill = fields.get("123", "N")
            if gap_fill == "N" and new_seq > 0:
                alert = Alert(
                    alert_type=AlertType.SEQ_GAP,
                    severity=Severity.CRITICAL,
                    venue=venue,
                    description=f"{venue} SequenceReset to {new_seq} (non-GapFill)",
                    raw_line=line,
                    params={"new_seq_no": new_seq, "gap_fill": False},
                )
                action = RemediationAction(
                    tool="fix_session_issue",
                    arguments={
                        "venue": venue,
                        "action": "resend_request",
                        "params": {"begin_seq": max(1, new_seq - 100), "end_seq": new_seq},
                    },
                    description=f"Request resend for {venue} seq gap",
                )
                results.append((alert, action))

        # --- Resend Request (35=2) indicates peer detected gap ---
        if msg_type == "2":
            begin = fields.get("7", "?")
            end = fields.get("16", "?")
            alert = Alert(
                alert_type=AlertType.SEQ_GAP,
                severity=Severity.WARNING,
                venue=venue,
                description=f"{venue} ResendRequest {begin}→{end}",
                raw_line=line,
                params={"begin_seq": begin, "end_seq": end},
            )
            results.append((alert, None))

        # --- Reject (35=3) with burst detection ---
        if msg_type == "3":
            reason = fields.get("58", "Unknown")
            now = time.monotonic()
            if venue not in self._reject_window:
                self._reject_window[venue] = []
            self._reject_window[venue].append(now)
            # Keep last 60 seconds
            self._reject_window[venue] = [t for t in self._reject_window[venue] if now - t < 60]

            count = len(self._reject_window[venue])
            severity = Severity.CRITICAL if count >= 3 else Severity.WARNING

            alert = Alert(
                alert_type=AlertType.REJECT_BURST,
                severity=severity,
                venue=venue,
                description=f"{venue} reject: {reason} ({count} in last 60s)",
                raw_line=line,
                params={"reason": reason, "count_60s": count, "ref_seq": fields.get("45", "?")},
            )

            action = None
            if "SSR" in reason.upper() or "short sale" in reason.lower():
                alert.severity = Severity.EMERGENCY
                alert.params["regulatory"] = True
                action = RemediationAction(
                    tool="check_ticker",
                    arguments={"query": reason.split()[-1] if reason.split() else "UNKNOWN"},
                    description=f"Check SSR status for rejected symbol",
                    requires_approval=True,
                )
            results.append((alert, action))

        # --- Latency Spike (heartbeat with latency annotation or timestamp drift) ---
        if msg_type == "0":
            text = fields.get("58", "")
            latency_match = re.search(r'latency=(\d+)ms', text)
            if latency_match:
                latency_ms = int(latency_match.group(1))
                severity = Severity.WARNING if latency_ms < 100 else Severity.CRITICAL
                alert = Alert(
                    alert_type=AlertType.LATENCY_SPIKE,
                    severity=severity,
                    venue=venue,
                    description=f"{venue} latency {latency_ms}ms",
                    raw_line=line,
                    params={"latency_ms": latency_ms},
                )
                action = None
                if latency_ms >= 150:
                    action = RemediationAction(
                        tool="check_fix_sessions",
                        arguments={"venue": venue},
                        description=f"Check {venue} session health (latency {latency_ms}ms)",
                    )
                results.append((alert, action))

            # Stale feed detection
            stale_match = re.search(r'stale_feed_age=(\d+)s', text)
            if stale_match:
                stale_s = int(stale_match.group(1))
                alert = Alert(
                    alert_type=AlertType.STALE_FEED,
                    severity=Severity.CRITICAL if stale_s > 10 else Severity.WARNING,
                    venue=venue,
                    description=f"{venue} feed stale {stale_s}s",
                    raw_line=line,
                    params={"stale_seconds": stale_s},
                )
                action = RemediationAction(
                    tool="check_fix_sessions",
                    arguments={"venue": venue},
                    description=f"Check {venue} session — feed stale {stale_s}s",
                )
                results.append((alert, action))

            # Halt detection
            halt_match = re.search(r'HALT\s+(\S+)\s+reason=(\S+)', text)
            if halt_match:
                symbol = halt_match.group(1)
                reason = halt_match.group(2)
                alert = Alert(
                    alert_type=AlertType.HALT,
                    severity=Severity.EMERGENCY if reason == "LULD" else Severity.CRITICAL,
                    venue=venue,
                    description=f"{symbol} HALTED on {venue}: {reason}",
                    raw_line=line,
                    params={"symbol": symbol, "halt_reason": reason},
                )
                action = RemediationAction(
                    tool="check_ticker",
                    arguments={"query": symbol},
                    description=f"Check {symbol} status — halt {reason}",
                    requires_approval=reason in ("LULD", "REGULATORY"),
                )
                results.append((alert, action))

            # Track heartbeat timing
            self._heartbeat_last[venue] = time.monotonic()

        # --- Algo breach detection (from execution reports with custom tags) ---
        if msg_type == "8":
            text = fields.get("58", "")
            if "POV" in text.upper() and "breach" in text.lower():
                alert = Alert(
                    alert_type=AlertType.ALGO_BREACH,
                    severity=Severity.EMERGENCY,
                    venue=venue,
                    description=f"Algo POV breach detected: {text}",
                    raw_line=line,
                    params={"text": text},
                )
                action = RemediationAction(
                    tool="modify_algo",
                    arguments={"action": "pause"},
                    description="Pause algo — POV breach",
                    requires_approval=True,
                )
                results.append((alert, action))

        return results

    def check_heartbeat_timeouts(self, timeout_seconds: float = 90) -> list[Alert]:
        """Check for venues that haven't sent a heartbeat in too long."""
        alerts = []
        now = time.monotonic()
        for venue, last in self._heartbeat_last.items():
            if now - last > timeout_seconds:
                alerts.append(Alert(
                    alert_type=AlertType.HEARTBEAT_TIMEOUT,
                    severity=Severity.CRITICAL,
                    venue=venue,
                    description=f"{venue} heartbeat timeout ({now - last:.0f}s)",
                    raw_line="",
                    params={"seconds_since_last": round(now - last, 1)},
                ))
        return alerts


# ---------------------------------------------------------------------------
# Event Bus (Redis Pub/Sub)
# ---------------------------------------------------------------------------
class EventBus:
    """
    Publishes monitoring events to Redis for live dashboard consumption.
    Falls back to in-memory if Redis is unavailable.
    """

    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url
        self._redis = None
        self._in_memory_events: list[dict] = []
        self._subscribers: list[Callable] = []

    async def connect(self):
        if self.redis_url:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(self.redis_url)
                await self._redis.ping()
                logger.info(f"EventBus connected to Redis: {self.redis_url}")
            except Exception as e:
                logger.warning(f"Redis unavailable, using in-memory event bus: {e}")
                self._redis = None

    async def publish(self, channel: str, event: dict):
        """Publish an event to a Redis channel."""
        payload = json.dumps(event, default=str)

        if self._redis:
            try:
                await self._redis.publish(channel, payload)
            except Exception as e:
                logger.error(f"Redis publish failed: {e}")
                self._in_memory_events.append(event)
        else:
            self._in_memory_events.append(event)

        # Notify local subscribers
        for sub in self._subscribers:
            try:
                if asyncio.iscoroutinefunction(sub):
                    await sub(channel, event)
                else:
                    sub(channel, event)
            except Exception as e:
                logger.error(f"Subscriber error: {e}")

    def subscribe_local(self, callback: Callable):
        """Add a local subscriber (for testing or non-Redis setups)."""
        self._subscribers.append(callback)

    async def close(self):
        if self._redis:
            await self._redis.close()


# Event channels
CHANNEL_ALERTS = "fix:alerts"
CHANNEL_ACTIONS = "fix:actions"
CHANNEL_SESSIONS = "fix:sessions"
CHANNEL_ORDERS = "fix:orders"
CHANNEL_AUDIT = "fix:audit"


# ---------------------------------------------------------------------------
# REST API Client
# ---------------------------------------------------------------------------
class APIClient:
    """Calls the FIX MCP REST API to execute remediation actions."""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip("/")
        self._session = None

    async def _ensure_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession()

    async def call_tool(self, tool: str, arguments: dict) -> dict:
        """POST /api/tool — execute an MCP tool."""
        await self._ensure_session()
        url = f"{self.base_url}/api/tool"
        payload = {"tool": tool, "arguments": arguments}
        try:
            async with self._session.post(url, json=payload, timeout=30) as resp:
                result = await resp.json()
                logger.info(f"API call {tool}: status={resp.status}")
                return result
        except Exception as e:
            logger.error(f"API call failed: {tool} — {e}")
            return {"error": str(e)}

    async def get_status(self) -> dict:
        """GET /api/status."""
        await self._ensure_session()
        try:
            async with self._session.get(f"{self.base_url}/api/status", timeout=10) as resp:
                return await resp.json()
        except Exception as e:
            logger.error(f"Status check failed: {e}")
            return {"error": str(e)}

    async def close(self):
        if self._session:
            await self._session.close()


# ---------------------------------------------------------------------------
# Audit Trail Writer
# ---------------------------------------------------------------------------
class AuditTrail:
    """
    Writes every detected condition and action to Postgres for compliance.
    Falls back to JSONL file if Postgres unavailable.
    """

    def __init__(self, database_url: Optional[str] = None, fallback_path: str = "/var/log/fix/audit.jsonl"):
        self.database_url = database_url
        self.fallback_path = Path(fallback_path)
        self._pool = None

    async def connect(self):
        if self.database_url:
            try:
                import asyncpg
                self._pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=5)
                logger.info("AuditTrail connected to Postgres")
            except Exception as e:
                logger.warning(f"Postgres unavailable, using JSONL fallback: {e}")
                self._pool = None

        if not self._pool:
            self.fallback_path.parent.mkdir(parents=True, exist_ok=True)

    async def record(self, alert: Alert, action: Optional[RemediationAction] = None,
                     action_result: Optional[dict] = None):
        """Record an alert and its remediation to the audit trail."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "alert": alert.to_dict(),
            "action": {
                "tool": action.tool,
                "arguments": action.arguments,
                "description": action.description,
                "requires_approval": action.requires_approval,
            } if action else None,
            "action_result": action_result,
        }

        if self._pool:
            try:
                await self._pool.execute(
                    """INSERT INTO audit_trail
                       (alert_type, severity, venue, description, alert_data,
                        action_tool, action_args, action_result, requires_approval)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    alert.alert_type.value,
                    alert.severity.value,
                    alert.venue,
                    alert.description,
                    json.dumps(alert.to_dict()),
                    action.tool if action else None,
                    json.dumps(action.arguments) if action else None,
                    json.dumps(action_result) if action_result else None,
                    action.requires_approval if action else False,
                )
            except Exception as e:
                logger.error(f"Audit write to Postgres failed: {e}")
                self._write_fallback(entry)
        else:
            self._write_fallback(entry)

    def _write_fallback(self, entry: dict):
        with open(self.fallback_path, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")

    async def close(self):
        if self._pool:
            await self._pool.close()


# ---------------------------------------------------------------------------
# Escalation Handler
# ---------------------------------------------------------------------------
class EscalationHandler:
    """
    Handles human-in-the-loop escalation.
    When an action exceeds policy thresholds, it gets queued instead of executed.
    """

    def __init__(self, policy: EscalationPolicy, audit: AuditTrail, event_bus: EventBus):
        self.policy = policy
        self.audit = audit
        self.event_bus = event_bus
        self._action_timestamps: list[float] = []

    def should_escalate(self, alert: Alert, action: RemediationAction) -> tuple[bool, str]:
        """Determine if an action requires human approval."""
        reasons = []

        if action.requires_approval:
            reasons.append("action flagged as requiring approval")

        if action.notional_at_risk >= self.policy.notional_threshold:
            reasons.append(f"notional at risk ${action.notional_at_risk:,.0f} >= ${self.policy.notional_threshold:,.0f}")

        if alert.severity == Severity.EMERGENCY:
            reasons.append(f"emergency severity")

        if alert.params.get("regulatory"):
            reasons.append("regulatory flag")

        if alert.alert_type == AlertType.ALGO_BREACH and self.policy.algo_modification:
            reasons.append("algo modification requires approval")

        # Rate limit check
        now = time.monotonic()
        self._action_timestamps = [t for t in self._action_timestamps if now - t < 60]
        if len(self._action_timestamps) >= self.policy.max_auto_actions_per_minute:
            reasons.append(f"rate limit: {len(self._action_timestamps)} actions in last 60s")

        return (bool(reasons), "; ".join(reasons))

    async def escalate(self, alert: Alert, action: RemediationAction, reason: str):
        """Queue for human review."""
        alert.escalated = True
        escalation = {
            "type": "escalation",
            "reason": reason,
            "alert": alert.to_dict(),
            "proposed_action": {
                "tool": action.tool,
                "arguments": action.arguments,
                "description": action.description,
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "pending_approval",
        }

        await self.event_bus.publish(CHANNEL_ALERTS, escalation)
        await self.audit.record(alert, action, {"escalated": True, "reason": reason})

        # Slack notification if configured
        if self.policy.slack_webhook:
            await self._notify_slack(escalation)

        logger.warning(f"ESCALATED: {alert.description} — {reason}")

    async def _notify_slack(self, escalation: dict):
        """Send escalation to Slack webhook."""
        try:
            import aiohttp
            payload = {
                "text": (
                    f":rotating_light: *FIX Alert Escalation*\n"
                    f"*{escalation['alert']['alert_type']}* on {escalation['alert']['venue']}\n"
                    f"{escalation['alert']['description']}\n"
                    f"*Proposed action:* {escalation['proposed_action']['description']}\n"
                    f"*Reason for escalation:* {escalation['reason']}\n"
                    f"_Awaiting approval in escalation queue_"
                ),
            }
            async with aiohttp.ClientSession() as session:
                await session.post(self.policy.slack_webhook, json=payload, timeout=5)
        except Exception as e:
            logger.error(f"Slack notification failed: {e}")


# ---------------------------------------------------------------------------
# Main Monitor
# ---------------------------------------------------------------------------
class FIXLogMonitor:
    """
    The orchestrator. Tails log files, runs pattern matching, executes
    remediation actions or escalates, records everything to audit trail,
    and publishes events for live dashboard.
    """

    def __init__(
        self,
        api_url: str = "http://localhost:8000",
        redis_url: Optional[str] = None,
        database_url: Optional[str] = None,
        escalation_policy: Optional[EscalationPolicy] = None,
        audit_fallback_path: str = "/var/log/fix/audit.jsonl",
    ):
        self.matcher = PatternMatcher(escalation_policy)
        self.api = APIClient(api_url)
        self.event_bus = EventBus(redis_url)
        self.audit = AuditTrail(database_url, audit_fallback_path)
        self.escalation = EscalationHandler(
            escalation_policy or EscalationPolicy(),
            self.audit, self.event_bus,
        )
        self._running = False
        self._stats = {
            "lines_processed": 0,
            "alerts_detected": 0,
            "actions_executed": 0,
            "escalations": 0,
            "errors": 0,
        }

    async def start(self):
        """Initialize connections."""
        await self.event_bus.connect()
        await self.audit.connect()
        self._running = True
        logger.info("FIXLogMonitor started")

    async def stop(self):
        """Clean shutdown."""
        self._running = False
        await self.api.close()
        await self.event_bus.close()
        await self.audit.close()
        logger.info(f"FIXLogMonitor stopped. Stats: {json.dumps(self._stats)}")

    async def process_line(self, line: str):
        """Process a single log line through the full pipeline."""
        self._stats["lines_processed"] += 1
        line = line.strip()
        if not line:
            return

        results = self.matcher.check(line)
        for alert, action in results:
            self._stats["alerts_detected"] += 1

            # Publish alert event
            await self.event_bus.publish(CHANNEL_ALERTS, {
                "type": "alert",
                **alert.to_dict(),
            })

            if action:
                # Check escalation policy
                should_escalate, reason = self.escalation.should_escalate(alert, action)

                if should_escalate:
                    self._stats["escalations"] += 1
                    await self.escalation.escalate(alert, action, reason)
                else:
                    # Execute auto-remediation
                    try:
                        result = await self.api.call_tool(action.tool, action.arguments)
                        alert.auto_remediated = True
                        alert.remediation_action = action.description
                        self._stats["actions_executed"] += 1

                        await self.event_bus.publish(CHANNEL_ACTIONS, {
                            "type": "action_executed",
                            "tool": action.tool,
                            "arguments": action.arguments,
                            "result": result,
                            "alert_type": alert.alert_type.value,
                            "venue": alert.venue,
                        })
                        await self.audit.record(alert, action, result)

                        logger.info(
                            f"AUTO-REMEDIATED: {alert.description} → {action.description}"
                        )
                    except Exception as e:
                        self._stats["errors"] += 1
                        logger.error(f"Remediation failed: {action.description} — {e}")
                        await self.audit.record(alert, action, {"error": str(e)})
            else:
                # Alert only, no action
                await self.audit.record(alert)

    async def watch(self, log_path: str, poll_interval: float = 0.5):
        """
        Tail a log file and process new lines continuously.
        Similar to `tail -f`.
        """
        path = Path(log_path)
        logger.info(f"Watching: {path}")

        # Wait for file to exist
        while self._running and not path.exists():
            await asyncio.sleep(1)

        with open(path, "r") as f:
            # Seek to end (only process new lines)
            f.seek(0, 2)

            while self._running:
                line = f.readline()
                if line:
                    await self.process_line(line)
                else:
                    # Check for heartbeat timeouts periodically
                    timeout_alerts = self.matcher.check_heartbeat_timeouts()
                    for alert in timeout_alerts:
                        await self.event_bus.publish(CHANNEL_ALERTS, {
                            "type": "alert",
                            **alert.to_dict(),
                        })
                        await self.audit.record(alert)

                    await asyncio.sleep(poll_interval)

    async def watch_directory(self, dir_path: str, poll_interval: float = 0.5):
        """Watch all .log files in a directory concurrently."""
        path = Path(dir_path)
        tasks = []

        # Watch the combined log
        combined = path / "fix_combined.log"
        if combined.exists():
            tasks.append(asyncio.create_task(self.watch(str(combined), poll_interval)))
        else:
            # Watch individual venue logs
            for log_file in path.glob("fix_*.log"):
                tasks.append(asyncio.create_task(self.watch(str(log_file), poll_interval)))

        if not tasks:
            logger.warning(f"No log files found in {dir_path}, waiting...")
            tasks.append(asyncio.create_task(self.watch(str(combined), poll_interval)))

        await asyncio.gather(*tasks)

    @property
    def stats(self) -> dict:
        return dict(self._stats)


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------
def main():
    import argparse

    parser = argparse.ArgumentParser(description="FIX Log Monitor")
    parser.add_argument("--watch", required=True, help="Log file or directory to watch")
    parser.add_argument("--api", default="http://localhost:8000", help="REST API URL")
    parser.add_argument("--redis", default=None, help="Redis URL for event bus")
    parser.add_argument("--database", default=None, help="PostgreSQL URL for audit trail")
    parser.add_argument("--slack-webhook", default=None, help="Slack webhook for escalations")
    parser.add_argument("--notional-threshold", type=float, default=10_000_000, help="Escalation threshold ($)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    policy = EscalationPolicy(
        notional_threshold=args.notional_threshold,
        slack_webhook=args.slack_webhook,
    )

    monitor = FIXLogMonitor(
        api_url=args.api,
        redis_url=args.redis,
        database_url=args.database,
        escalation_policy=policy,
    )

    async def run():
        await monitor.start()
        try:
            path = Path(args.watch)
            if path.is_dir():
                await monitor.watch_directory(str(path))
            else:
                await monitor.watch(str(path))
        finally:
            await monitor.stop()

    asyncio.run(run())


if __name__ == "__main__":
    main()

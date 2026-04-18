"""TelemetryCollector — engine telemetry collector.

Polls all engines for heartbeat age, sequence numbers, latency, and
message rates. Stores current metrics in Redis for downstream consumers.
"""

from __future__ import annotations

import json
import logging
import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class EngineMetrics:
    """Snapshot of telemetry data for a single engine."""
    name: str = ""
    hb_age_s: float = 0.0           # seconds since last heartbeat
    seq_send: int = 0               # outbound sequence number
    seq_recv: int = 0               # inbound sequence number
    latency_ms: float = 0.0         # round-trip latency
    msgs_per_sec: float = 0.0       # message rate
    status: str = "ok"              # ok / degraded / down
    last_check: str = ""            # ISO timestamp


class TelemetryCollector:
    """Collects and stores telemetry from all simulation engines.

    Thread-safe via ``threading.Lock``. Designed to be called periodically
    (e.g. from a heartbeat loop or cron-like scheduler).

    Args:
        redis_client: Optional ``redis.asyncio.Redis`` or sync Redis client.
    """

    def __init__(
        self,
        redis_client: Optional[Any] = None,
        retention_samples: int = 60,
    ) -> None:
        self._redis = redis_client
        self._lock = threading.Lock()
        self._metrics: dict[str, EngineMetrics] = {}
        self._msg_counts: dict[str, list[float]] = defaultdict(list)  # name → [ts, ...]
        self._retention = retention_samples

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register_engine(self, name: str) -> EngineMetrics:
        """Register an engine and allocate initial metrics.

        Returns the fresh metrics object so callers can update it.
        """
        with self._lock:
            m = EngineMetrics(name=name)
            m.last_check = datetime.now(timezone.utc).isoformat()
            self._metrics[name] = m
            return m

    # ------------------------------------------------------------------
    # Update helpers (called by engine implementations)
    # ------------------------------------------------------------------

    def record_heartbeat(self, name: str) -> None:
        """Record a heartbeat event."""
        ts = time.monotonic()
        with self._lock:
            m = self._metrics.get(name)
            if m is None:
                m = self.register_engine(name)
            m.hb_age_s = 0.0
            m.last_check = datetime.now(timezone.utc).isoformat()
            self._msg_counts[name].append(ts)

    def record_message(self, name: str) -> None:
        """Record a single sent/received message."""
        with self._lock:
            self._msg_counts[name].append(time.monotonic())
            m = self._metrics.get(name)
            if m is not None:
                m.last_check = datetime.now(timezone.utc).isoformat()

    def record_latency(self, name: str, latency_ms: float) -> None:
        """Record a measured round-trip latency in ms."""
        with self._lock:
            m = self._metrics.get(name)
            if m is None:
                m = self.register_engine(name)
            m.latency_ms = round(latency_ms, 2)

    def record_sequence(self, name: str, seq_send: int = 0, seq_recv: int = 0) -> None:
        """Record current sequence numbers."""
        with self._lock:
            m = self._metrics.get(name)
            if m is None:
                m = self.register_engine(name)
            if seq_send:
                m.seq_send = seq_send
            if seq_recv:
                m.seq_recv = seq_recv

    def record_status(self, name: str, status: str) -> None:
        """Record engine status (``"ok"``, ``"degraded"``, ``"down"``)."""
        with self._lock:
            m = self._metrics.get(name)
            if m is None:
                m = self.register_engine(name)
            m.status = status

    # ------------------------------------------------------------------
    # Polling (computes rates, ages, writes to Redis)
    # ------------------------------------------------------------------

    def poll(self) -> dict[str, dict]:
        """Compute current message rates and heartbeat ages.

        Returns the full metrics snapshot as a nested dict.
        """
        now_ts = time.monotonic()
        now_utc = datetime.now(timezone.utc).isoformat()

        with self._lock:
            result: dict[str, dict] = {}
            for name, m in self._metrics.items():
                # Trim old entries, compute rate
                cutoff = now_ts - self._retention
                self._msg_counts[name] = [
                    t for t in self._msg_counts[name] if t > cutoff
                ]
                elapsed = now_ts - (self._msg_counts[name][0] if self._msg_counts[name] else now_ts)
                count = len(self._msg_counts[name])
                m.msgs_per_sec = round(count / max(elapsed, 1), 2) if count else 0.0

                # Age heartbeat
                if m.hb_age_s > 0:
                    m.hb_age_s += self._retention / 60.0  # rough approximation

                m.last_check = now_utc
                result[name] = {
                    "name": m.name,
                    "hb_age_s": m.hb_age_s,
                    "seq_send": m.seq_send,
                    "seq_recv": m.seq_recv,
                    "latency_ms": m.latency_ms,
                    "msgs_per_sec": m.msgs_per_sec,
                    "status": m.status,
                    "last_check": m.last_check,
                }

        # Persist to Redis
        self._store_redis(result)
        return result

    # ------------------------------------------------------------------
    # Public queries
    # ------------------------------------------------------------------

    def get_snapshot(self) -> dict[str, dict]:
        """Return all current metrics without recomputing rates."""
        with self._lock:
            return {
                name: {
                    "name": m.name,
                    "hb_age_s": m.hb_age_s,
                    "seq_send": m.seq_send,
                    "seq_recv": m.seq_recv,
                    "latency_ms": m.latency_ms,
                    "msgs_per_sec": m.msgs_per_sec,
                    "status": m.status,
                    "last_check": m.last_check,
                }
                for name, m in self._metrics.items()
            }

    def get_engine_health(self, engine_name: str) -> Optional[dict]:
        """Return metrics for a single engine.

        Args:
            engine_name: The registered engine name.

        Returns:
            Metrics dict or None if unknown.
        """
        with self._lock:
            m = self._metrics.get(engine_name)
            if m is None:
                return None
            return {
                "name": m.name,
                "hb_age_s": m.hb_age_s,
                "seq_send": m.seq_send,
                "seq_recv": m.seq_recv,
                "latency_ms": m.latency_ms,
                "msgs_per_sec": m.msgs_per_sec,
                "status": m.status,
                "last_check": m.last_check,
            }

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------

    def _store_redis(self, data: dict[str, dict]) -> None:
        """Write the current metric snapshot to Redis hash ``telemetry:current``."""
        if self._redis is None:
            return
        try:
            if hasattr(self._redis, "hset"):
                # redis-py: use hset with mapping
                payload = {k: json.dumps(v) for k, v in data.items()}
                self._redis.hset("telemetry:current", mapping=payload)
            elif hasattr(self._redis, "publish"):
                # async case: just publish snapshot
                pass
        except Exception:
            logger.exception("Failed to write telemetry to Redis")

"""Append-only trace buffer for MCP tool execution.

Captures every tool invocation with timestamp, arguments, output, latency,
and status. Backed by Redis when available, falls back to in-memory deque
(in-process buffer). Provides filtering, export, and per-scenario grouping.
"""

from __future__ import annotations

import json
import os
import time
import threading
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

# ---------------------------------------------------------------------------
# Trace entry data
# ---------------------------------------------------------------------------

@dataclass
class TraceEntry:
    """Single tool execution trace record."""
    trace_id: str           # unique UUID-like id
    ts: str                 # ISO-8601 with ms precision
    ts_epoch: float         # epoch seconds for sorting
    tool: str               # tool name
    arguments: dict         # input args
    output: str             # tool output (truncated if large)
    ok: bool                # success/failure
    source: str             # "scenario" | "user" | "agent" | "system" | "dashboard"
    latency_ms: float       # wall-clock execution time
    scenario: str           # active scenario name
    step_index: Optional[int]  # scenario step index if triggered by a step

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Trace buffer (Redis-backed with in-memory fallback)
# ---------------------------------------------------------------------------

class TraceBuffer:
    """Thread-safe append-only trace buffer.

    When REDIS_URL is set, uses Redis list for cross-process persistence.
    Otherwise, uses an in-memory deque (capped at max_entries).
    """

    def __init__(self, max_entries: int = 10_000) -> None:
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._in_memory: deque = deque(maxlen=max_entries)
        self._redis = self._init_redis()
        self._counter = 0

    def _init_redis(self):
        redis_url = os.environ.get("REDIS_URL")
        if not redis_url:
            return None
        try:
            import redis as _redis
            r = _redis.from_url(redis_url, socket_timeout=1, decode_responses=True)
            r.ping()
            return r
        except Exception:
            return None

    def append(self, entry: TraceEntry) -> None:
        self._counter += 1
        with self._lock:
            data = json.dumps(entry.to_dict(), default=str)
            if self._redis:
                try:
                    self._redis.lpush("fix:trace", data)
                    self._redis.ltrim("fix:trace", 0, self.max_entries - 1)
                except Exception:
                    pass
            self._in_memory.appendleft(entry)

    def get_entries(
        self,
        limit: int = 200,
        tool_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        scenario_filter: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> list[dict]:
        """Return trace entries with optional filters."""
        with self._lock:
            # Source: try Redis first, fall back to in-memory
            if self._redis:
                try:
                    raw = self._redis.lrange("fix:trace", 0, self.max_entries)
                    entries = [json.loads(r) for r in raw]
                except Exception:
                    entries = [e.to_dict() for e in self._in_memory]
            else:
                entries = [e.to_dict() for e in self._in_memory]

        # Apply filters
        if tool_filter:
            entries = [e for e in entries if tool_filter.lower() in e.get("tool", "").lower()]
        if status_filter:
            ok_val = status_filter.lower() in ("success", "ok", "✅")
            entries = [e for e in entries if e.get("ok") == ok_val]
        if scenario_filter:
            entries = [e for e in entries if scenario_filter.lower() in e.get("scenario", "").lower()]
        if source_filter:
            entries = [e for e in entries if source_filter.lower() in e.get("source", "").lower()]

        return entries[:limit]

    def clear(self) -> None:
        with self._lock:
            self._in_memory.clear()
            if self._redis:
                try:
                    self._redis.delete("fix:trace")
                except Exception:
                    pass

    def stats(self) -> dict:
        with self._lock:
            all_entries = list(self._in_memory) if not self._redis else []
            total = len(self._in_memory) if not self._redis else (
                self._redis.llen("fix:trace") if self._redis else 0
            )
        successes = sum(1 for e in self._in_memory if e.ok) if not self._redis else total
        avg_latency = (
            sum(e.latency_ms for e in self._in_memory) / len(self._in_memory)
            if self._in_memory
            else 0
        )
        return {
            "total_entries": total,
            "success_count": successes,
            "error_count": total - successes,
            "avg_latency_ms": round(avg_latency, 1),
            "tools_used": list({e.tool for e in self._in_memory}) if not self._redis else [],
        }

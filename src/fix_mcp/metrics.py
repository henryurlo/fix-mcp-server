"""Prometheus metrics for the FIX MCP server.

Provides counters, histograms, and gauges for observing FIX session latency,
order routing, scenario lifecycle, venue state, and active order volume.

Usage::

    from fix_mcp.metrics import FIX_METRICS

    FIX_METRICS.order_submitted.inc()
    with FIX_METRICS.fix_session_latency.time():
        ...

The /metrics endpoint is exposed via the REST API in api.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, Info


class FIXMetrics:
    """Container for all Prometheus metrics used by the FIX MCP server."""

    def __init__(self) -> None:
        self.registry: CollectorRegistry | None = None
        self.fix_session_latency: Histogram | None = None
        self.order_to_ack_latency: Histogram | None = None
        self.scenario_duration: Gauge | None = None
        self.venue_status: Info | None = None
        self.active_orders: Gauge | None = None
        self.order_submitted: Counter | None = None
        self.order_ack: Counter | None = None
        self.order_rejected: Counter | None = None
        self.sessions_active: Gauge | None = None
        self.heartbeat_total: Counter | None = None
        self.scenario_started: Counter | None = None

        self._init()

    # ------------------------------------------------------------------ #

    def _init(self) -> None:
        """Create or re-create all metric objects against the default registry."""
        try:
            from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, Info
            from prometheus_client import REGISTRY, disable_created_metrics, REGISTRY

            # Try to unregister stale collectors so hot-reload doesn't crash
            for attr in (
                "fix_session_latency", "order_to_ack_latency",
                "scenario_duration", "active_orders",
                "order_submitted", "order_ack", "order_rejected",
                "sessions_active", "heartbeat_total", "scenario_started",
            ):
                existing = getattr(self, attr, None)
                if existing is not None:
                    try:
                        REGISTRY.unregister(existing)
                    except Exception:
                        pass

            # Disable _created metrics to keep output clean
            try:
                disable_created_metrics()
            except Exception:
                pass

            self.fix_session_latency = Histogram(
                "fix_session_latency_seconds",
                "End-to-end FIX session message latency",
                ["msg_type"],
                buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
            )

            self.order_to_ack_latency = Histogram(
                "order_to_ack_latency_seconds",
                "Time from order submission to ACK/fill",
                ["venue"],
                buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5),
            )

            self.scenario_duration = Gauge(
                "scenario_duration_seconds",
                "Wall-clock time since the current scenario was loaded",
            )

            self.venue_status = Info(
                "venue_status",
                "FIX venue state (mic_code, status, port)",
            )

            self.active_orders = Gauge(
                "active_orders",
                "Number of open (non-terminal) orders in the OMS",
            )

            self.order_submitted = Counter(
                "order_submitted_total",
                "Total orders submitted via send_order",
                ["symbol", "side"],
            )

            self.order_ack = Counter(
                "order_ack_total",
                "Total order acknowledgements received",
                ["venue", "status"],
            )

            self.order_rejected = Counter(
                "order_rejected_total",
                "Total order rejections",
                ["venue", "reason"],
            )

            self.sessions_active = Gauge(
                "sessions_active",
                "Number of FIX sessions currently in active state",
                ["status"],
            )

            self.heartbeat_total = Counter(
                "heartbeat_total",
                "Total FIX heartbeats sent/received",
                ["venue"],
            )

            self.scenario_started = Counter(
                "scenario_started_total",
                "Total scenario loads",
                ["name"],
            )

        except ImportError:
            # prometheus_client not installed — use no-op stubs
            self._make_stubs()

    # ------------------------------------------------------------------ #
    # No-op stubs when prometheus_client is unavailable                    #
    # ------------------------------------------------------------------ #

    def _make_stubs(self) -> None:
        """Create do-nothing stubs so the rest of the code never needs
        to check ``if METRICS.fix_session_latency is not None``."""

        class _NoopHistogram:
            def time(self):
                return _NoopCtx()
            def labels(self, **kw):
                return self

        class _NoopGauge:
            def set(self, v):  # noqa: A003
                pass
            def inc(self):
                pass
            def dec(self):
                pass
            def labels(self, **kw):
                return self

        class _NoopCounter:
            def inc(self):
                pass
            def labels(self, **kw):
                return self

        class _NoopInfo:
            def info(self, mapping):
                pass

        class _NoopCtx:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        self.fix_session_latency = _NoopHistogram()
        self.order_to_ack_latency = _NoopHistogram()
        self.scenario_duration = _NoopGauge()
        self.venue_status = _NoopInfo()
        self.active_orders = _NoopGauge()
        self.order_submitted = _NoopCounter()
        self.order_ack = _NoopCounter()
        self.order_rejected = _NoopCounter()
        self.sessions_active = _NoopGauge()
        self.heartbeat_total = _NoopCounter()
        self.scenario_started = _NoopCounter()
        self.registry = None


# Module-level singleton
FIX_METRICS = FIXMetrics()

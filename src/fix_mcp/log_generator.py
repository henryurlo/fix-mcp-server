"""
FIX 4.2 Log Generator — Realistic message streams per trading scenario.

Generates heartbeats, logons, execution reports, sequence resets, rejects,
and fault patterns that match each of the 13 scenarios. Writes to log files
that the LogMonitor can tail in real time.

Usage:
    # Standalone
    python -m fix_mcp.log_generator --scenario morning_triage --output /var/log/fix/

    # Programmatic
    gen = FIXLogGenerator(scenario="morning_triage")
    async for line in gen.stream():
        print(line)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import os
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)

SOH = "|"  # Use pipe in log files (real FIX uses \x01)


# ---------------------------------------------------------------------------
# FIX Message Types
# ---------------------------------------------------------------------------
class MsgType(str, Enum):
    LOGON = "A"
    LOGOUT = "5"
    HEARTBEAT = "0"
    TEST_REQUEST = "1"
    RESEND_REQUEST = "2"
    REJECT = "3"
    SEQUENCE_RESET = "4"
    NEW_ORDER_SINGLE = "D"
    EXECUTION_REPORT = "8"
    ORDER_CANCEL_REQUEST = "F"
    ORDER_CANCEL_REPLACE = "G"
    ORDER_CANCEL_REJECT = "9"
    ORDER_STATUS_REQUEST = "H"
    SESSION_STATUS = "h"


class OrdStatus(str, Enum):
    NEW = "0"
    PARTIALLY_FILLED = "1"
    FILLED = "2"
    CANCELED = "4"
    REPLACED = "5"
    PENDING_CANCEL = "6"
    REJECTED = "8"
    PENDING_NEW = "A"
    PENDING_REPLACE = "E"


class ExecType(str, Enum):
    NEW = "0"
    PARTIAL_FILL = "1"
    FILL = "2"
    CANCELED = "4"
    REPLACE = "5"
    PENDING_CANCEL = "6"
    REJECTED = "8"
    PENDING_NEW = "A"
    TRADE = "F"


# ---------------------------------------------------------------------------
# Session & Venue Definitions
# ---------------------------------------------------------------------------
VENUES = {
    "NYSE": {"sender": "FIXCLIENT", "target": "NYSE", "port": 9001},
    "ARCA": {"sender": "FIXCLIENT", "target": "ARCA", "port": 9002},
    "BATS": {"sender": "FIXCLIENT", "target": "BATS", "port": 9003},
    "IEX":  {"sender": "FIXCLIENT", "target": "IEX",  "port": 9004},
    "DARK": {"sender": "FIXCLIENT", "target": "LQNT", "port": 9005},
}

SYMBOLS = {
    "AAPL":  {"cusip": "037833100", "price": 178.50, "tick": 0.01},
    "TSLA":  {"cusip": "88160R101", "price": 242.80, "tick": 0.01},
    "GME":   {"cusip": "36467W109", "price": 23.45,  "tick": 0.01},
    "MSFT":  {"cusip": "594918104", "price": 415.20, "tick": 0.01},
    "ACME":  {"cusip": "004830109", "price": 67.30,  "tick": 0.01},
    "ACMX":  {"cusip": "004830109", "price": 67.30,  "tick": 0.01},
    "RDSA":  {"cusip": "780259305", "price": 58.90,  "tick": 0.01},
    "SHEL":  {"cusip": "780259305", "price": 58.90,  "tick": 0.01},
    "RIDE":  {"cusip": "54405Q100", "price": 5.67,   "tick": 0.01},
    "NVDA":  {"cusip": "67066G104", "price": 890.10, "tick": 0.01},
}


@dataclass
class SessionState:
    """Tracks per-venue FIX session state."""
    venue: str
    sender_seq: int = 1
    target_seq: int = 1
    connected: bool = False
    last_heartbeat: float = 0.0
    latency_ms: int = 2


@dataclass
class OrderState:
    """Tracks a live order."""
    cl_ord_id: str
    symbol: str
    side: str  # "1" buy, "2" sell
    qty: int
    price: float
    venue: str
    status: OrdStatus = OrdStatus.PENDING_NEW
    filled_qty: int = 0
    avg_px: float = 0.0
    algo_id: Optional[str] = None


# ---------------------------------------------------------------------------
# FIX Message Builder
# ---------------------------------------------------------------------------
class FIXMessageBuilder:
    """Builds properly structured FIX 4.2 messages with correct checksums."""

    @staticmethod
    def build(msg_type: str, fields: dict, sender: str, target: str, seq: int,
              sending_time: Optional[dt.datetime] = None) -> str:
        ts = sending_time or dt.datetime.now(dt.timezone.utc)
        ts_str = ts.strftime("%Y%m%d-%H:%M:%S.%f")[:-3]

        body_fields = {
            "35": msg_type.value if hasattr(msg_type, 'value') else msg_type,
            "49": sender,
            "56": target,
            "34": str(seq),
            "52": ts_str,
        }
        body_fields.update({str(k): str(v) for k, v in fields.items()})

        body = SOH.join(f"{k}={v}" for k, v in body_fields.items()) + SOH
        body_len = len(body)

        raw = f"8=FIX.4.2{SOH}9={body_len}{SOH}{body}"
        checksum = sum(ord(c) for c in raw) % 256
        return f"{raw}10={checksum:03d}{SOH}"


# ---------------------------------------------------------------------------
# Scenario Fault Definitions
# ---------------------------------------------------------------------------
@dataclass
class FaultEvent:
    """A scheduled fault injection event."""
    offset_seconds: float      # Seconds from scenario start
    venue: str
    fault_type: str            # "session_drop", "seq_gap", "latency_spike",
                               # "reject_burst", "halt", "stale_feed"
    params: dict = field(default_factory=dict)
    description: str = ""


# Each scenario maps to a sequence of fault events
SCENARIO_FAULTS: dict[str, list[FaultEvent]] = {
    "morning_triage": [
        FaultEvent(0, "ARCA", "session_drop", {"duration_s": 120}, "ARCA session down"),
        FaultEvent(5, "BATS", "seq_gap", {"expected": 1042, "received": 1098}, "BATS seq gap 1042→1098"),
        FaultEvent(30, "NYSE", "latency_spike", {"latency_ms": 45}, "NYSE latency elevated"),
    ],
    "bats_startup_0200": [
        FaultEvent(0, "BATS", "seq_gap", {"expected": 1, "received": 500}, "BATS SequenceReset unexpected NewSeqNo=500"),
        FaultEvent(2, "BATS", "session_drop", {"duration_s": 30}, "BATS logon rejected"),
    ],
    "predawn_adrs_0430": [
        FaultEvent(0, "ARCA", "latency_spike", {"latency_ms": 220}, "ARCA latency 220ms"),
        FaultEvent(10, "NYSE", "reject_burst", {"count": 3, "reason": "unknown symbol RDSA"}, "RDSA→SHEL rename rejects"),
    ],
    "preopen_auction_0900": [
        FaultEvent(0, "NYSE", "latency_spike", {"latency_ms": 35}, "MOO imbalance pressure"),
        FaultEvent(5, "IEX", "stale_feed", {"stale_seconds": 15}, "IEX feed stale 15s"),
    ],
    "open_volatility_0930": [
        FaultEvent(0, "BATS", "seq_gap", {"expected": 2100, "received": 2105}, "BATS packet loss 5 msgs"),
        FaultEvent(3, "NYSE", "halt", {"symbol": "GME", "reason": "LULD"}, "GME LULD halt"),
    ],
    "venue_degradation_1030": [
        FaultEvent(0, "NYSE", "latency_spike", {"latency_ms": 180}, "NYSE latency 180ms Mahwah"),
        FaultEvent(15, "ARCA", "latency_spike", {"latency_ms": 95}, "ARCA sympathy latency"),
    ],
    "ssr_and_split_1130": [
        FaultEvent(0, "BATS", "reject_burst", {"count": 5, "reason": "SSR short sale restriction"}, "RIDE SSR triggered"),
        FaultEvent(30, "NYSE", "halt", {"symbol": "AAPL", "reason": "SPLIT_PENDING"}, "AAPL 4:1 split in 26min"),
    ],
    "iex_recovery_1400": [
        FaultEvent(0, "IEX", "session_drop", {"duration_s": 0}, "IEX session recovered — was down"),
        FaultEvent(2, "IEX", "latency_spike", {"latency_ms": 8}, "IEX D-Limit rerouting active"),
    ],
    "eod_moc_1530": [
        FaultEvent(0, "NYSE", "latency_spike", {"latency_ms": 55}, "MOC cutoff pressure"),
        FaultEvent(10, "ARCA", "reject_burst", {"count": 2, "reason": "MOC cutoff passed"}, "Late MOC rejects"),
    ],
    "afterhours_dark_1630": [
        FaultEvent(0, "DARK", "session_drop", {"duration_s": 300}, "Liquidnet SessionStatus=8 offline"),
        FaultEvent(5, "IEX", "stale_feed", {"stale_seconds": 30}, "IEX after-hours thin"),
    ],
    "twap_slippage_1000": [
        FaultEvent(0, "BATS", "latency_spike", {"latency_ms": 40}, "TWAP child routing delayed"),
        FaultEvent(20, "NYSE", "halt", {"symbol": "GME", "reason": "LULD"}, "GME halted mid-TWAP"),
    ],
    "vwap_vol_spike_1130": [
        FaultEvent(0, "NYSE", "latency_spike", {"latency_ms": 65}, "Vol spike — VWAP over-participating"),
        FaultEvent(5, "BATS", "latency_spike", {"latency_ms": 120}, "BATS latency spike under vol"),
        FaultEvent(10, "NYSE", "halt", {"symbol": "GME", "reason": "LULD"}, "GME halted mid-VWAP"),
    ],
    "is_dark_failure_1415": [
        FaultEvent(0, "DARK", "session_drop", {"duration_s": 180}, "Dark aggregator no fills"),
        FaultEvent(5, "NYSE", "latency_spike", {"latency_ms": 50}, "IS shortfall climbing"),
    ],
}

# Scenario base times (ET)
SCENARIO_TIMES: dict[str, str] = {
    "morning_triage":         "06:15:00",
    "bats_startup_0200":      "02:05:00",
    "predawn_adrs_0430":      "04:35:00",
    "preopen_auction_0900":   "09:02:00",
    "open_volatility_0930":   "09:35:00",
    "venue_degradation_1030": "10:32:00",
    "ssr_and_split_1130":     "11:34:00",
    "iex_recovery_1400":      "14:03:00",
    "eod_moc_1530":           "15:31:00",
    "afterhours_dark_1630":   "16:32:00",
    "twap_slippage_1000":     "10:05:00",
    "vwap_vol_spike_1130":    "11:35:00",
    "is_dark_failure_1415":   "14:15:00",
}


# ---------------------------------------------------------------------------
# FIX Log Generator
# ---------------------------------------------------------------------------
class FIXLogGenerator:
    """
    Generates realistic FIX 4.2 log streams for a given scenario.

    Produces a mix of:
    - Heartbeats (every 30s per venue)
    - Logon/Logout sequences
    - Order flow (NewOrderSingle, ExecutionReport)
    - Fault-injected messages (seq gaps, session drops, rejects, halts)
    """

    def __init__(
        self,
        scenario: str = "morning_triage",
        speed_multiplier: float = 10.0,   # 10x = 1 hour in 6 minutes
        output_dir: Optional[str] = None,
        seed: Optional[int] = None,
        control_url: Optional[str] = None,  # e.g. http://api-server:8000/api/simulation
    ):
        self.scenario = scenario
        self.speed = speed_multiplier
        self.paused = False
        self._control_url = control_url or os.environ.get("API_URL", "").rstrip("/") + "/api/simulation" if os.environ.get("API_URL") else None
        self.output_dir = Path(output_dir) if output_dir else None
        self.rng = random.Random(seed)
        self.builder = FIXMessageBuilder()

        # Session state per venue
        self.sessions: dict[str, SessionState] = {}
        for venue in VENUES:
            self.sessions[venue] = SessionState(venue=venue)

        # Order tracking
        self.orders: dict[str, OrderState] = {}
        self._order_counter = 0

        # Fault queue
        self.faults = sorted(
            SCENARIO_FAULTS.get(scenario, []),
            key=lambda f: f.offset_seconds
        )

        # Parse scenario base time
        base_time_str = SCENARIO_TIMES.get(scenario, "09:30:00")
        today = dt.date.today()
        naive = dt.datetime.strptime(f"{today} {base_time_str}", "%Y-%m-%d %H:%M:%S")
        self.base_time = naive.replace(tzinfo=dt.timezone.utc)
        self.start_real_time = time.monotonic()

        logger.info(f"FIXLogGenerator initialized: scenario={scenario}, speed={speed_multiplier}x")

    def _sim_time(self) -> dt.datetime:
        """Current simulated time based on real elapsed time and speed multiplier."""
        elapsed = (time.monotonic() - self.start_real_time) * self.speed
        return self.base_time + dt.timedelta(seconds=elapsed)

    def _sim_elapsed(self) -> float:
        """Simulated seconds since scenario start."""
        return (time.monotonic() - self.start_real_time) * self.speed

    def _next_order_id(self) -> str:
        self._order_counter += 1
        return f"ORD-{self.scenario[:4].upper()}-{self._order_counter:06d}"

    def _build_msg(self, venue: str, msg_type: str, fields: dict,
                   ts: Optional[dt.datetime] = None) -> str:
        sess = self.sessions[venue]
        v = VENUES[venue]
        msg = self.builder.build(
            msg_type=msg_type,
            fields=fields,
            sender=v["sender"] if msg_type in ("D", "F", "G", "H") else v["target"],
            target=v["target"] if msg_type in ("D", "F", "G", "H") else v["sender"],
            seq=sess.sender_seq if msg_type in ("D", "F", "G", "H") else sess.target_seq,
            sending_time=ts or self._sim_time(),
        )
        # Advance appropriate seq number
        if msg_type in ("D", "F", "G", "H"):
            sess.sender_seq += 1
        else:
            sess.target_seq += 1
        return msg

    # --- Message Generators ---

    def _gen_logon(self, venue: str) -> str:
        sess = self.sessions[venue]
        sess.connected = True
        sess.last_heartbeat = time.monotonic()
        return self._build_msg(venue, MsgType.LOGON, {
            "98": "0",        # EncryptMethod=None
            "108": "30",      # HeartBtInt=30s
            "141": "Y",       # ResetSeqNumFlag
        })

    def _gen_logout(self, venue: str, text: str = "Session ended") -> str:
        sess = self.sessions[venue]
        sess.connected = False
        return self._build_msg(venue, MsgType.LOGOUT, {"58": text})

    def _gen_heartbeat(self, venue: str) -> str:
        sess = self.sessions[venue]
        sess.last_heartbeat = time.monotonic()
        return self._build_msg(venue, MsgType.HEARTBEAT, {})

    def _gen_test_request(self, venue: str) -> str:
        test_id = f"TR-{int(time.time())}"
        return self._build_msg(venue, MsgType.TEST_REQUEST, {"112": test_id})

    def _gen_reject(self, venue: str, ref_seq: int, reason: str) -> str:
        return self._build_msg(venue, MsgType.REJECT, {
            "45": str(ref_seq),   # RefSeqNum
            "58": reason,
            "373": "99",          # SessionRejectReason=Other
        })

    def _gen_sequence_reset(self, venue: str, new_seq: int, gap_fill: bool = False) -> str:
        return self._build_msg(venue, MsgType.SEQUENCE_RESET, {
            "36": str(new_seq),                  # NewSeqNo
            "123": "Y" if gap_fill else "N",     # GapFillFlag
        })

    def _gen_resend_request(self, venue: str, begin: int, end: int) -> str:
        return self._build_msg(venue, MsgType.RESEND_REQUEST, {
            "7": str(begin),   # BeginSeqNo
            "16": str(end),    # EndSeqNo
        })

    def _gen_new_order(self, venue: str, symbol: str, side: str,
                       qty: int, price: float, algo_id: Optional[str] = None) -> tuple[str, str]:
        cl_ord_id = self._next_order_id()
        fields = {
            "11": cl_ord_id,
            "55": symbol,
            "54": side,
            "38": str(qty),
            "40": "2",          # OrdType=Limit
            "44": f"{price:.2f}",
            "59": "0",          # TimeInForce=Day
            "21": "1",          # HandlInst=Auto
        }
        if algo_id:
            fields["847"] = algo_id   # AlgoID (custom tag)

        sym_data = SYMBOLS.get(symbol, {"cusip": "000000000"})
        fields["48"] = sym_data["cusip"]  # SecurityID
        fields["22"] = "1"               # IDSource=CUSIP

        order = OrderState(
            cl_ord_id=cl_ord_id, symbol=symbol, side=side,
            qty=qty, price=price, venue=venue, algo_id=algo_id,
        )
        self.orders[cl_ord_id] = order
        return self._build_msg(venue, MsgType.NEW_ORDER_SINGLE, fields), cl_ord_id

    def _gen_exec_report(self, venue: str, cl_ord_id: str,
                         exec_type: ExecType, fill_qty: int = 0,
                         fill_px: float = 0.0, text: str = "") -> str:
        order = self.orders.get(cl_ord_id)
        if not order:
            return ""

        if exec_type in (ExecType.PARTIAL_FILL, ExecType.FILL, ExecType.TRADE):
            order.filled_qty += fill_qty
            total_cost = order.avg_px * (order.filled_qty - fill_qty) + fill_px * fill_qty
            order.avg_px = total_cost / order.filled_qty if order.filled_qty else 0

        status_map = {
            ExecType.NEW: OrdStatus.NEW,
            ExecType.PARTIAL_FILL: OrdStatus.PARTIALLY_FILLED,
            ExecType.FILL: OrdStatus.FILLED,
            ExecType.CANCELED: OrdStatus.CANCELED,
            ExecType.REJECTED: OrdStatus.REJECTED,
            ExecType.PENDING_NEW: OrdStatus.PENDING_NEW,
        }
        order.status = status_map.get(exec_type, order.status)

        exec_id = hashlib.md5(f"{cl_ord_id}-{time.time()}".encode()).hexdigest()[:12]

        fields = {
            "37": f"EXCH-{exec_id[:8]}",  # OrderID (exchange)
            "17": exec_id,                  # ExecID
            "11": cl_ord_id,
            "150": exec_type.value if hasattr(exec_type, 'value') else exec_type,
            "39": order.status.value if hasattr(order.status, 'value') else order.status,
            "55": order.symbol,
            "54": order.side,
            "38": str(order.qty),
            "14": str(order.filled_qty),    # CumQty
            "151": str(order.qty - order.filled_qty),  # LeavesQty
            "6": f"{order.avg_px:.4f}",     # AvgPx
        }
        if fill_qty:
            fields["32"] = str(fill_qty)         # LastShares
            fields["31"] = f"{fill_px:.4f}"      # LastPx
        if text:
            fields["58"] = text

        return self._build_msg(venue, MsgType.EXECUTION_REPORT, fields)

    def _gen_session_status(self, venue: str, status: int) -> str:
        """SessionStatus for dark pools: 8=offline, 1=connected."""
        return self._build_msg(venue, MsgType.SESSION_STATUS, {
            "325": str(status),
        })

    # --- Fault Injection ---

    def _inject_session_drop(self, fault: FaultEvent) -> list[str]:
        msgs = []
        sess = self.sessions[fault.venue]
        if sess.connected:
            msgs.append(self._gen_logout(fault.venue, text=f"Unexpected disconnect: {fault.description}"))
        if fault.venue == "DARK":
            msgs.append(self._gen_session_status(fault.venue, 8))
        return msgs

    def _inject_seq_gap(self, fault: FaultEvent) -> list[str]:
        msgs = []
        expected = fault.params.get("expected", 100)
        received = fault.params.get("received", 150)
        sess = self.sessions[fault.venue]
        # Jump the target seq to simulate gap
        sess.target_seq = received
        msgs.append(self._gen_sequence_reset(fault.venue, received, gap_fill=False))
        # The monitor should detect expected vs received mismatch
        msgs.append(self._gen_resend_request(fault.venue, expected, received - 1))
        return msgs

    def _inject_latency_spike(self, fault: FaultEvent) -> list[str]:
        msgs = []
        sess = self.sessions[fault.venue]
        sess.latency_ms = fault.params.get("latency_ms", 100)
        # Generate a heartbeat with the elevated latency visible in timing
        delayed_time = self._sim_time() - dt.timedelta(milliseconds=sess.latency_ms)
        msgs.append(self._build_msg(fault.venue, MsgType.HEARTBEAT, {
            "58": f"latency={sess.latency_ms}ms"  # Annotated for monitor
        }, ts=delayed_time))
        return msgs

    def _inject_reject_burst(self, fault: FaultEvent) -> list[str]:
        msgs = []
        count = fault.params.get("count", 3)
        reason = fault.params.get("reason", "Unknown reject")
        sess = self.sessions[fault.venue]
        for i in range(count):
            msgs.append(self._gen_reject(
                fault.venue,
                ref_seq=sess.sender_seq - 1 - i,
                reason=reason,
            ))
        return msgs

    def _inject_halt(self, fault: FaultEvent) -> list[str]:
        msgs = []
        symbol = fault.params.get("symbol", "???")
        reason = fault.params.get("reason", "LULD")
        # Simulate halt via a trading session status or annotated heartbeat
        msgs.append(self._build_msg(fault.venue, MsgType.HEARTBEAT, {
            "58": f"HALT {symbol} reason={reason}",
            "340": "2",  # TradSesStatus=Halted
        }))
        return msgs

    def _inject_stale_feed(self, fault: FaultEvent) -> list[str]:
        msgs = []
        stale_s = fault.params.get("stale_seconds", 10)
        # Generate a heartbeat with an old timestamp
        stale_time = self._sim_time() - dt.timedelta(seconds=stale_s)
        msgs.append(self._build_msg(fault.venue, MsgType.HEARTBEAT, {
            "58": f"stale_feed_age={stale_s}s"
        }, ts=stale_time))
        return msgs

    FAULT_HANDLERS = {
        "session_drop":  "_inject_session_drop",
        "seq_gap":       "_inject_seq_gap",
        "latency_spike": "_inject_latency_spike",
        "reject_burst":  "_inject_reject_burst",
        "halt":          "_inject_halt",
        "stale_feed":    "_inject_stale_feed",
    }

    def _inject_fault(self, fault: FaultEvent) -> list[str]:
        handler_name = self.FAULT_HANDLERS.get(fault.fault_type)
        if handler_name:
            handler = getattr(self, handler_name)
            return handler(fault)
        logger.warning(f"Unknown fault type: {fault.fault_type}")
        return []

    # --- Background Order Flow ---

    def _generate_background_flow(self) -> list[str]:
        """Generate realistic background order activity."""
        msgs = []
        active_venues = [v for v, s in self.sessions.items() if s.connected]
        if not active_venues:
            return msgs

        # Random new order (30% chance per tick)
        if self.rng.random() < 0.3 and active_venues:
            venue = self.rng.choice(active_venues)
            symbol = self.rng.choice(list(SYMBOLS.keys()))
            sym = SYMBOLS[symbol]
            side = self.rng.choice(["1", "2"])
            qty = self.rng.choice([100, 200, 500, 1000, 2500, 5000])
            spread = sym["price"] * 0.001
            price = round(sym["price"] + self.rng.uniform(-spread, spread), 2)

            msg, cl_ord_id = self._gen_new_order(venue, symbol, side, qty, price)
            msgs.append(msg)

            # Immediate ack
            msgs.append(self._gen_exec_report(venue, cl_ord_id, ExecType.NEW))

            # Maybe a partial fill
            if self.rng.random() < 0.4:
                fill_qty = self.rng.randint(1, qty // 2) * 100 // 100 or 100
                fill_qty = min(fill_qty, qty)
                fill_px = round(price + self.rng.uniform(-0.02, 0.02), 4)
                exec_type = ExecType.FILL if fill_qty >= qty else ExecType.PARTIAL_FILL
                msgs.append(self._gen_exec_report(
                    venue, cl_ord_id, exec_type,
                    fill_qty=fill_qty, fill_px=fill_px
                ))

        # Fill outstanding partials (20% chance each)
        for oid, order in list(self.orders.items()):
            if order.status == OrdStatus.PARTIALLY_FILLED and self.rng.random() < 0.2:
                remaining = order.qty - order.filled_qty
                fill_qty = self.rng.randint(1, remaining)
                fill_px = round(order.price + self.rng.uniform(-0.03, 0.03), 4)
                exec_type = ExecType.FILL if fill_qty >= remaining else ExecType.PARTIAL_FILL
                msgs.append(self._gen_exec_report(
                    order.venue, oid, exec_type,
                    fill_qty=fill_qty, fill_px=fill_px
                ))

        return msgs

    # --- Control Polling ---

    async def _poll_control(self) -> None:
        """Background task: poll /api/simulation every 5s to update speed/paused."""
        if not self._control_url:
            return
        import urllib.request as _ur
        while True:
            await asyncio.sleep(5)
            try:
                with _ur.urlopen(self._control_url, timeout=2) as r:
                    state = json.loads(r.read())
                    self.speed = max(0.1, float(state.get("speed", self.speed)))
                    self.paused = bool(state.get("paused", self.paused))
            except Exception:
                pass  # API not reachable yet — keep current state

    # --- Main Stream ---

    async def stream(self) -> AsyncIterator[str]:
        """
        Async generator: yields FIX log lines in real time.
        Heartbeats every ~3s real time (30s sim time at 10x).
        Faults injected at their scheduled offsets.
        Background order flow mixed in.
        """
        # Start background control polling if API URL is configured
        poll_task = asyncio.create_task(self._poll_control())

        # Initial logons for all venues
        for venue in VENUES:
            yield self._gen_logon(venue)
            await asyncio.sleep(0.1)

        fault_idx = 0
        tick = 0

        try:
            while True:
                # Honour pause — spin-wait in 0.5s increments
                while self.paused:
                    await asyncio.sleep(0.5)

                sim_elapsed = self._sim_elapsed()

                # Inject any faults that are due
                while fault_idx < len(self.faults) and self.faults[fault_idx].offset_seconds <= sim_elapsed:
                    fault = self.faults[fault_idx]
                    logger.info(f"Injecting fault: {fault.description} at +{sim_elapsed:.1f}s sim")
                    for msg in self._inject_fault(fault):
                        yield msg
                    fault_idx += 1

                # Heartbeats for connected sessions
                for venue, sess in self.sessions.items():
                    if sess.connected and (tick % 10 == 0):  # Every 10 ticks ≈ 30s sim
                        yield self._gen_heartbeat(venue)

                # Background order flow
                for msg in self._generate_background_flow():
                    yield msg

                tick += 1
                await asyncio.sleep(3.0 / self.speed)  # Tick interval — respects live speed changes

                # Stop after ~2 hours sim time
                if sim_elapsed > 7200:
                    logger.info("Scenario stream complete (2h sim time)")
                    break
        finally:
            poll_task.cancel()

    async def stream_to_file(self, output_dir: Optional[Path] = None):
        """Write log stream to per-venue log files."""
        out = output_dir or self.output_dir or Path("/var/log/fix")
        out.mkdir(parents=True, exist_ok=True)

        handles: dict[str, open] = {}
        combined = open(out / "fix_combined.log", "a")

        try:
            async for line in self.stream():
                # Parse venue from target/sender
                venue = "UNKNOWN"
                for v in VENUES:
                    if VENUES[v]["target"] in line or VENUES[v]["sender"] in line:
                        venue = v
                        break

                timestamp = self._sim_time().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                log_line = f"[{timestamp}] [{venue}] {line}\n"

                # Per-venue file
                if venue not in handles:
                    handles[venue] = open(out / f"fix_{venue.lower()}.log", "a")
                handles[venue].write(log_line)
                handles[venue].flush()

                # Combined file
                combined.write(log_line)
                combined.flush()

        finally:
            for h in handles.values():
                h.close()
            combined.close()

    def generate_snapshot(self, duration_seconds: float = 300) -> list[str]:
        """
        Synchronous: generate a batch of log lines for `duration_seconds` of sim time.
        Useful for testing or pre-generating log files.
        """
        lines = []
        self.start_real_time = time.monotonic()

        # Logons
        for venue in VENUES:
            lines.append(self._gen_logon(venue))

        fault_idx = 0
        sim_seconds = 0
        tick_interval = 3.0  # Simulated seconds per tick

        while sim_seconds < duration_seconds:
            # Inject faults
            while fault_idx < len(self.faults) and self.faults[fault_idx].offset_seconds <= sim_seconds:
                fault = self.faults[fault_idx]
                lines.extend(self._inject_fault(fault))
                fault_idx += 1

            # Heartbeats every 30s
            if int(sim_seconds) % 30 < tick_interval:
                for venue, sess in self.sessions.items():
                    if sess.connected:
                        lines.append(self._gen_heartbeat(venue))

            # Background flow
            lines.extend(self._generate_background_flow())

            sim_seconds += tick_interval

        return lines


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------
def main():
    import argparse

    parser = argparse.ArgumentParser(description="FIX 4.2 Log Generator")
    parser.add_argument("--scenario", default="morning_triage", choices=list(SCENARIO_FAULTS.keys()))
    parser.add_argument("--output", default="/var/log/fix", help="Output directory for log files")
    parser.add_argument("--speed", type=float, default=10.0, help="Speed multiplier (10 = 1hr in 6min)")
    parser.add_argument("--snapshot", type=float, default=0, help="Generate snapshot of N seconds and exit")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    gen = FIXLogGenerator(
        scenario=args.scenario,
        speed_multiplier=args.speed,
        output_dir=args.output,
        seed=args.seed,
    )

    if args.snapshot:
        lines = gen.generate_snapshot(args.snapshot)
        for line in lines:
            print(line)
    else:
        asyncio.run(gen.stream_to_file())


if __name__ == "__main__":
    main()

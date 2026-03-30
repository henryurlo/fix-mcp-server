"""Production FIX TCP connector — async initiator session.

Provides a real FIX session initiator that can connect to exchange gateways
over TCP. Designed to replace the in-memory FIXSessionManager when operating
against live venues (or a QuickFIX/QuickFIXJ acceptor for UAT).

Configuration via environment variables:
    FIX_HOST_NYSE=nyse-gateway.prod.internal
    FIX_PORT_NYSE=4001
    FIX_SENDER_COMP_ID=FIRM_PROD
    FIX_HEARTBEAT_INTERVAL=30

Usage:
    config = ConnectorConfig.from_env("NYSE")
    conn = FIXConnector(config, on_message=handle_message)
    await conn.connect()
    await conn.send_logon()
    asyncio.create_task(conn.receive_loop())

For a full production deployment also wire in:
    - Sequence number persistence (PostgreSQL fix_sessions table)
    - TLS/mTLS for encrypted exchange connections
    - Message replay on reconnect (ResendRequest gap fill)
    - Prometheus metrics for session health monitoring
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

SOH = b"\x01"
_SOH_STR = "\x01"


@dataclass
class ConnectorConfig:
    """FIX connector configuration for one venue."""

    host: str
    port: int
    sender_comp_id: str
    target_comp_id: str
    fix_version: str = "FIX.4.2"
    heartbeat_interval: int = 30
    reconnect_delay: int = 5
    max_reconnect_attempts: int = 10
    use_tls: bool = False

    @classmethod
    def from_env(cls, venue: str) -> "ConnectorConfig":
        """Build config from environment variables for a given venue name.

        Expected env vars (replace VENUE with venue.upper()):
            FIX_HOST_VENUE, FIX_PORT_VENUE, FIX_SENDER_COMP_ID,
            FIX_TARGET_COMP_ID_VENUE, FIX_HEARTBEAT_INTERVAL
        """
        v = venue.upper()
        return cls(
            host=os.environ[f"FIX_HOST_{v}"],
            port=int(os.environ[f"FIX_PORT_{v}"]),
            sender_comp_id=os.environ.get("FIX_SENDER_COMP_ID", "FIRM_PROD"),
            target_comp_id=os.environ.get(f"FIX_TARGET_COMP_ID_{v}", f"{v}_GW"),
            fix_version=os.environ.get("FIX_VERSION", "FIX.4.2"),
            heartbeat_interval=int(os.environ.get("FIX_HEARTBEAT_INTERVAL", "30")),
            use_tls=os.environ.get(f"FIX_TLS_{v}", "false").lower() == "true",
        )


MessageHandler = Callable[[dict[int, str]], Awaitable[None]]


class FIXConnector:
    """Async TCP FIX session initiator.

    Manages the full FIX session lifecycle: connect → Logon → steady-state
    (Heartbeat/TestRequest) → Logout → disconnect, with automatic reconnection.

    The ``on_message`` callback receives parsed FIX messages as
    ``dict[tag_int, value_str]`` and should be non-blocking (use
    ``asyncio.create_task`` inside it for any significant processing).
    """

    def __init__(
        self,
        config: ConnectorConfig,
        on_message: Optional[MessageHandler] = None,
    ) -> None:
        self.config = config
        self.on_message = on_message
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._connected = False
        self._send_seq: int = 1
        self._recv_seq: int = 1
        self._heartbeat_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Public lifecycle
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        """Open TCP connection and start heartbeat task."""
        logger.info("Connecting to %s:%d (%s)", self.config.host, self.config.port, self.config.target_comp_id)
        if self.config.use_tls:
            import ssl
            ctx = ssl.create_default_context()
            self._reader, self._writer = await asyncio.open_connection(
                self.config.host, self.config.port, ssl=ctx
            )
        else:
            self._reader, self._writer = await asyncio.open_connection(
                self.config.host, self.config.port
            )
        self._connected = True
        logger.info("TCP connected to %s:%d", self.config.host, self.config.port)

    async def disconnect(self) -> None:
        """Send Logout (35=5), cancel heartbeat, close socket."""
        if not self._connected:
            return
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        try:
            await self.send_logout("Normal close")
        except Exception:
            pass
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
        self._connected = False
        logger.info("Disconnected from %s:%d", self.config.host, self.config.port)

    async def reconnect(self) -> None:
        """Attempt reconnection with backoff, up to max_reconnect_attempts."""
        self._connected = False
        if self._writer:
            try:
                self._writer.close()
            except Exception:
                pass
        for attempt in range(1, self.config.max_reconnect_attempts + 1):
            logger.info("Reconnect attempt %d/%d in %ds…", attempt, self.config.max_reconnect_attempts, self.config.reconnect_delay)
            await asyncio.sleep(self.config.reconnect_delay)
            try:
                await self.connect()
                await self.send_logon()
                return
            except OSError as exc:
                logger.warning("Reconnect attempt %d failed: %s", attempt, exc)
        raise ConnectionError(
            f"Failed to reconnect to {self.config.host}:{self.config.port} "
            f"after {self.config.max_reconnect_attempts} attempts"
        )

    # ------------------------------------------------------------------
    # Session messages
    # ------------------------------------------------------------------

    async def send_logon(self) -> None:
        """Send FIX Logon (35=A)."""
        await self._send_msg("A", {
            98: "0",  # EncryptMethod=None
            108: str(self.config.heartbeat_interval),
        })
        logger.info("Logon sent to %s", self.config.target_comp_id)
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def send_logout(self, text: str = "Goodbye") -> None:
        """Send FIX Logout (35=5)."""
        await self._send_msg("5", {58: text})

    async def send_heartbeat(self, test_req_id: Optional[str] = None) -> None:
        """Send FIX Heartbeat (35=0), optionally echoing a TestReqID."""
        body = {}
        if test_req_id:
            body[112] = test_req_id
        await self._send_msg("0", body)

    async def send_resend_request(self, begin_seq: int, end_seq: int) -> None:
        """Send FIX ResendRequest (35=2) to recover a sequence gap."""
        await self._send_msg("2", {7: str(begin_seq), 16: str(end_seq)})

    async def send_sequence_reset(self, new_seq: int, gap_fill: bool = True) -> None:
        """Send FIX SequenceReset (35=4)."""
        await self._send_msg("4", {
            123: "Y" if gap_fill else "N",  # GapFillFlag
            36: str(new_seq),               # NewSeqNo
        })

    # ------------------------------------------------------------------
    # Order messages
    # ------------------------------------------------------------------

    async def send_new_order_single(self, fields: dict[int, str]) -> None:
        """Send NewOrderSingle (35=D). Caller populates all required fields."""
        await self._send_msg("D", fields)

    async def send_order_cancel_replace(self, fields: dict[int, str]) -> None:
        """Send OrderCancelReplaceRequest (35=G)."""
        await self._send_msg("G", fields)

    async def send_order_cancel(self, fields: dict[int, str]) -> None:
        """Send OrderCancelRequest (35=F)."""
        await self._send_msg("F", fields)

    # ------------------------------------------------------------------
    # Receive loop
    # ------------------------------------------------------------------

    async def receive_loop(self) -> None:
        """Read FIX messages from the TCP stream until disconnected.

        Handles partial reads, dispatches parsed messages to on_message,
        and auto-responds to TestRequest (35=1) with Heartbeat (35=0).
        """
        if not self._reader:
            raise RuntimeError("Not connected — call connect() first")
        buffer = b""
        while self._connected:
            try:
                chunk = await self._reader.read(4096)
            except (asyncio.CancelledError, ConnectionResetError):
                break
            if not chunk:
                logger.warning("Remote closed connection")
                self._connected = False
                break
            buffer += chunk
            # Extract complete FIX messages (terminated by checksum tag SOH)
            while True:
                end = self._find_message_end(buffer)
                if end == -1:
                    break
                raw_msg = buffer[:end]
                buffer = buffer[end:]
                parsed = self._parse(raw_msg)
                if not parsed:
                    continue
                self._recv_seq = int(parsed.get(34, self._recv_seq))
                # Auto-respond to TestRequest
                if parsed.get(35) == "1":
                    asyncio.create_task(
                        self.send_heartbeat(parsed.get(112))
                    )
                elif self.on_message:
                    asyncio.create_task(self.on_message(parsed))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        while self._connected:
            await asyncio.sleep(self.config.heartbeat_interval)
            if self._connected:
                await self.send_heartbeat()

    async def _send_msg(self, msg_type: str, body_fields: dict) -> None:
        raw = self._build(msg_type, body_fields)
        if self._writer:
            self._writer.write(raw)
            await self._writer.drain()

    def _build(self, msg_type: str, body_fields: dict) -> bytes:
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H:%M:%S.%f")[:23]
        body_kvs = [
            f"35={msg_type}",
            f"49={self.config.sender_comp_id}",
            f"56={self.config.target_comp_id}",
            f"34={self._send_seq}",
            f"52={ts}",
        ]
        for tag, val in body_fields.items():
            body_kvs.append(f"{tag}={val}")
        body_str = _SOH_STR.join(body_kvs) + _SOH_STR
        body_bytes = body_str.encode()
        header = f"8={self.config.fix_version}{_SOH_STR}9={len(body_bytes)}{_SOH_STR}".encode()
        raw = header + body_bytes
        checksum = sum(raw) % 256
        raw += f"10={checksum:03d}{_SOH_STR}".encode()
        self._send_seq += 1
        return raw

    @staticmethod
    def _find_message_end(buf: bytes) -> int:
        """Return index just past the final SOH of a complete FIX message."""
        marker = b"10="
        idx = buf.find(marker)
        if idx == -1:
            return -1
        end = buf.find(SOH, idx)
        if end == -1:
            return -1
        return end + 1

    @staticmethod
    def _parse(raw: bytes) -> dict[int, str]:
        """Parse raw FIX bytes into a tag→value dict."""
        result: dict[int, str] = {}
        for part in raw.split(SOH):
            if b"=" in part:
                tag_b, _, val_b = part.partition(b"=")
                try:
                    result[int(tag_b)] = val_b.decode()
                except (ValueError, UnicodeDecodeError):
                    pass
        return result

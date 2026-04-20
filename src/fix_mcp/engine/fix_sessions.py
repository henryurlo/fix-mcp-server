from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


@dataclass
class FIXSession:
    venue: str
    session_id: str
    sender_comp_id: str
    target_comp_id: str
    fix_version: str = "FIX.4.2"
    status: str = "active"
    last_sent_seq: int = 1
    last_recv_seq: int = 1
    expected_recv_seq: int = 1
    last_heartbeat: Optional[str] = None
    latency_ms: int = 5
    host: str = ""
    port: int = 0
    error: Optional[str] = None
    connected_since: Optional[str] = None
    ack_delay_ms: int = 0

    @property
    def has_sequence_gap(self) -> bool:
        return self.last_recv_seq != self.expected_recv_seq

    @property
    def sequence_gap_size(self) -> int:
        return abs(self.last_recv_seq - self.expected_recv_seq)

    @property
    def heartbeat_age_seconds(self) -> Optional[float]:
        if self.last_heartbeat is None:
            return None
        try:
            hb_time = datetime.fromisoformat(self.last_heartbeat)
            # Ensure both sides are offset-aware for comparison
            now = datetime.now(timezone.utc)
            if hb_time.tzinfo is None:
                hb_time = hb_time.replace(tzinfo=timezone.utc)
            delta = now - hb_time
            return delta.total_seconds()
        except (ValueError, TypeError):
            return None


class FIXSessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, FIXSession] = {}

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    def add_session(self, session: FIXSession) -> FIXSession:
        self.sessions[session.venue] = session
        return session

    def get_session(self, venue: str) -> Optional[FIXSession]:
        return self.sessions.get(venue)

    def get_all_sessions(self) -> list[FIXSession]:
        return list(self.sessions.values())

    def get_down_sessions(self) -> list[FIXSession]:
        return [s for s in self.sessions.values() if s.status == "down"]

    def get_degraded_sessions(self) -> list[FIXSession]:
        return [s for s in self.sessions.values() if s.status == "degraded"]

    # ------------------------------------------------------------------
    # State mutations
    # ------------------------------------------------------------------

    def update_session_status(
        self, venue: str, status: str, error: Optional[str] = None
    ) -> None:
        session = self.sessions.get(venue)
        if session is not None:
            session.status = status
            session.error = error

    def record_heartbeat(self, venue: str) -> None:
        session = self.sessions.get(venue)
        if session is not None:
            session.last_heartbeat = datetime.now(timezone.utc).isoformat()

    def increment_sent_seq(self, venue: str) -> int:
        session = self.sessions.get(venue)
        if session is None:
            raise KeyError(f"No session found for venue: {venue!r}")
        session.last_sent_seq += 1
        return session.last_sent_seq

    # ------------------------------------------------------------------
    # Recovery operations
    # ------------------------------------------------------------------

    def apply_resend_request(self, venue: str) -> None:
        """Simulate gap recovery: align last_recv_seq to expected_recv_seq,
        mark session active, clear error, and refresh connected_since."""
        session = self.sessions.get(venue)
        if session is not None:
            session.last_recv_seq = session.expected_recv_seq
            session.status = "active"
            session.error = None
            session.connected_since = datetime.now(timezone.utc).isoformat()

    def apply_sequence_reset(self, venue: str, new_seq: int) -> None:
        """Hard reset both recv and expected sequence numbers to new_seq."""
        session = self.sessions.get(venue)
        if session is not None:
            session.last_recv_seq = new_seq
            session.expected_recv_seq = new_seq

    def apply_reconnect(self, venue: str) -> None:
        """Full reconnect: reset recv sequences to 1, keep sent_seq for
        continuity, mark session active, clear error, refresh connected_since."""
        session = self.sessions.get(venue)
        if session is not None:
            session.status = "active"
            session.last_recv_seq = 1
            session.expected_recv_seq = 1
            session.error = None
            session.connected_since = datetime.now(timezone.utc).isoformat()

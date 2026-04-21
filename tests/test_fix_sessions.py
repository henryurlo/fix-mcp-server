from datetime import datetime, timedelta, timezone

from fix_mcp.engine.fix_sessions import FIXSession, FIXSessionManager


def test_session_gap_and_heartbeat_age() -> None:
    heartbeat = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    session = FIXSession(
        venue="ARCA",
        session_id="ARCA-1",
        sender_comp_id="FIRM",
        target_comp_id="ARCA",
        last_recv_seq=10,
        expected_recv_seq=12,
        last_heartbeat=heartbeat,
    )

    assert session.has_sequence_gap is True
    assert session.sequence_gap_size == 2
    assert session.heartbeat_age_seconds is not None
    assert session.heartbeat_age_seconds >= 4


def test_manager_recovery_operations_reset_state() -> None:
    manager = FIXSessionManager()
    manager.add_session(
        FIXSession(
            venue="ARCA",
            session_id="ARCA-1",
            sender_comp_id="FIRM",
            target_comp_id="ARCA",
            status="down",
            last_recv_seq=45,
            expected_recv_seq=47,
            error="gap",
        )
    )

    manager.apply_resend_request("ARCA")
    resent = manager.get_session("ARCA")
    assert resent.status == "active"
    assert resent.last_recv_seq == 47
    assert resent.expected_recv_seq == 47
    assert resent.error is None

    manager.apply_sequence_reset("ARCA", new_seq=100)
    reset = manager.get_session("ARCA")
    assert reset.last_recv_seq == 100
    assert reset.expected_recv_seq == 100

    manager.apply_reconnect("ARCA")
    reconnected = manager.get_session("ARCA")
    assert reconnected.status == "active"
    assert reconnected.last_recv_seq == 1
    assert reconnected.expected_recv_seq == 1


def _make_session(**overrides) -> FIXSession:
    defaults = dict(
        venue="NYSE", session_id="S1",
        sender_comp_id="ACME", target_comp_id="NYSE",
    )
    defaults.update(overrides)
    return FIXSession(**defaults)


def test_ack_delay_ms_defaults_to_zero() -> None:
    s = _make_session()
    assert s.ack_delay_ms == 0


def test_ack_delay_ms_can_be_set() -> None:
    s = _make_session(ack_delay_ms=5000)
    assert s.ack_delay_ms == 5000


def test_session_manager_preserves_ack_delay_ms() -> None:
    mgr = FIXSessionManager()
    mgr.add_session(_make_session(ack_delay_ms=5000))
    assert mgr.get_session("NYSE").ack_delay_ms == 5000

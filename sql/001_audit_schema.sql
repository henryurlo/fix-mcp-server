-- =============================================================================
-- FIX MCP Server — Audit Trail & Escalation Schema
-- =============================================================================
-- Every action Claude takes gets recorded here with:
--   - What it did
--   - Why (the condition it detected)
--   - What changed
--   - Whether it was auto-remediated or escalated
--
-- This is what you show the risk team or regulator when they ask:
--   "Why did the AI do that at 3am?"
-- =============================================================================

-- Audit Trail: complete record of every detected condition and action
CREATE TABLE IF NOT EXISTS audit_trail (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- What was detected
    alert_type      VARCHAR(50)  NOT NULL,    -- session_drop, seq_gap, latency_spike, etc.
    severity        VARCHAR(20)  NOT NULL,    -- info, warning, critical, emergency
    venue           VARCHAR(20)  NOT NULL,    -- NYSE, ARCA, BATS, IEX, DARK
    description     TEXT         NOT NULL,    -- Human-readable description

    -- Full alert payload (JSON)
    alert_data      JSONB,

    -- What action was taken (NULL if alert-only)
    action_tool     VARCHAR(100),             -- MCP tool name
    action_args     JSONB,                    -- Arguments passed to tool
    action_result   JSONB,                    -- Result from tool execution

    -- Escalation
    requires_approval BOOLEAN DEFAULT FALSE,
    escalated       BOOLEAN DEFAULT FALSE,
    approved_by     VARCHAR(100),             -- Who approved (NULL if auto)
    approved_at     TIMESTAMPTZ,

    -- Indexing
    scenario        VARCHAR(50)               -- Active scenario at time of event
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_created_at   ON audit_trail (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_alert_type   ON audit_trail (alert_type);
CREATE INDEX IF NOT EXISTS idx_audit_severity     ON audit_trail (severity);
CREATE INDEX IF NOT EXISTS idx_audit_venue        ON audit_trail (venue);
CREATE INDEX IF NOT EXISTS idx_audit_escalated    ON audit_trail (escalated) WHERE escalated = TRUE;
CREATE INDEX IF NOT EXISTS idx_audit_scenario     ON audit_trail (scenario);


-- Escalation Queue: pending actions awaiting human approval
CREATE TABLE IF NOT EXISTS escalation_queue (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Link to audit trail
    audit_id        BIGINT REFERENCES audit_trail(id),

    -- What needs approval
    alert_type      VARCHAR(50)  NOT NULL,
    severity        VARCHAR(20)  NOT NULL,
    venue           VARCHAR(20)  NOT NULL,
    description     TEXT         NOT NULL,
    escalation_reason TEXT       NOT NULL,    -- Why it was escalated

    -- Proposed action
    proposed_tool   VARCHAR(100) NOT NULL,
    proposed_args   JSONB        NOT NULL,

    -- Resolution
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, expired
    resolved_by     VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,

    -- Expiry (some actions become irrelevant)
    expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_escalation_status ON escalation_queue (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_escalation_created ON escalation_queue (created_at DESC);


-- Session History: track session state changes over time
CREATE TABLE IF NOT EXISTS session_history (
    id              BIGSERIAL PRIMARY KEY,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    venue           VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL,    -- connected, disconnected, degraded
    sender_seq      INTEGER,
    target_seq      INTEGER,
    latency_ms      INTEGER,
    details         JSONB
);

CREATE INDEX IF NOT EXISTS idx_session_venue     ON session_history (venue, recorded_at DESC);


-- Action Summary: materialized view for the "3 issues auto-resolved overnight" report
CREATE OR REPLACE VIEW overnight_summary AS
SELECT
    date_trunc('day', created_at) AS day,
    COUNT(*)                                              AS total_alerts,
    COUNT(*) FILTER (WHERE action_tool IS NOT NULL
                      AND NOT escalated)                  AS auto_resolved,
    COUNT(*) FILTER (WHERE escalated)                     AS escalated,
    COUNT(*) FILTER (WHERE severity = 'critical')         AS critical,
    COUNT(*) FILTER (WHERE severity = 'emergency')        AS emergency,
    jsonb_agg(
        jsonb_build_object(
            'time', created_at,
            'type', alert_type,
            'venue', venue,
            'description', description,
            'auto_resolved', (action_tool IS NOT NULL AND NOT escalated)
        ) ORDER BY created_at
    ) AS events
FROM audit_trail
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY date_trunc('day', created_at);


-- Function: Get the morning briefing
CREATE OR REPLACE FUNCTION get_morning_briefing()
RETURNS TABLE (
    total_alerts    BIGINT,
    auto_resolved   BIGINT,
    escalated       BIGINT,
    critical_count  BIGINT,
    events          JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE a.action_tool IS NOT NULL AND NOT a.escalated)::BIGINT,
        COUNT(*) FILTER (WHERE a.escalated)::BIGINT,
        COUNT(*) FILTER (WHERE a.severity IN ('critical', 'emergency'))::BIGINT,
        jsonb_agg(
            jsonb_build_object(
                'time', a.created_at,
                'type', a.alert_type,
                'venue', a.venue,
                'desc', a.description,
                'action', a.action_tool,
                'auto', (a.action_tool IS NOT NULL AND NOT a.escalated)
            ) ORDER BY a.created_at
        )
    FROM audit_trail a
    WHERE a.created_at >= NOW() - INTERVAL '12 hours';
END;
$$ LANGUAGE plpgsql;


-- Function: Approve an escalation
CREATE OR REPLACE FUNCTION approve_escalation(
    p_escalation_id BIGINT,
    p_approved_by   VARCHAR(100),
    p_note          TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_audit_id BIGINT;
BEGIN
    UPDATE escalation_queue
    SET status = 'approved',
        resolved_by = p_approved_by,
        resolved_at = NOW(),
        resolution_note = p_note
    WHERE id = p_escalation_id AND status = 'pending'
    RETURNING audit_id INTO v_audit_id;

    IF v_audit_id IS NOT NULL THEN
        UPDATE audit_trail
        SET approved_by = p_approved_by,
            approved_at = NOW()
        WHERE id = v_audit_id;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

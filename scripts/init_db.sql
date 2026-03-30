-- FIX MCP Production Database Schema
-- Run automatically by PostgreSQL on first container start.

-- ── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    order_id        VARCHAR(50)  PRIMARY KEY,
    cl_ord_id       VARCHAR(80)  UNIQUE NOT NULL,
    symbol          VARCHAR(20)  NOT NULL,
    cusip           VARCHAR(20),
    side            VARCHAR(10)  NOT NULL,
    quantity        INTEGER      NOT NULL,
    filled_quantity INTEGER      NOT NULL DEFAULT 0,
    order_type      VARCHAR(20)  NOT NULL,
    price           NUMERIC(18,6),
    venue           VARCHAR(20)  NOT NULL,
    client_name     VARCHAR(100) NOT NULL,
    status          VARCHAR(30)  NOT NULL DEFAULT 'new',
    is_institutional BOOLEAN     NOT NULL DEFAULT FALSE,
    sla_minutes     INTEGER,
    flags           JSONB        NOT NULL DEFAULT '[]',
    fix_messages    JSONB        NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_symbol   ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_client   ON orders(client_name);
CREATE INDEX IF NOT EXISTS idx_orders_venue    ON orders(venue);
CREATE INDEX IF NOT EXISTS idx_orders_updated  ON orders(updated_at DESC);

-- ── Algo Orders ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS algo_orders (
    algo_id          VARCHAR(50)  PRIMARY KEY,
    client_name      VARCHAR(100) NOT NULL,
    symbol           VARCHAR(20)  NOT NULL,
    cusip            VARCHAR(20),
    side             VARCHAR(10)  NOT NULL,
    total_qty        INTEGER      NOT NULL,
    algo_type        VARCHAR(20)  NOT NULL,
    start_time       TIMESTAMPTZ  NOT NULL,
    end_time         TIMESTAMPTZ,
    venue            VARCHAR(20)  NOT NULL,
    pov_rate         NUMERIC(5,4),
    total_slices     INTEGER      NOT NULL DEFAULT 0,
    completed_slices INTEGER      NOT NULL DEFAULT 0,
    executed_qty     INTEGER      NOT NULL DEFAULT 0,
    avg_px           NUMERIC(18,6),
    arrival_px       NUMERIC(18,6),
    benchmark_px     NUMERIC(18,6),
    schedule_pct     NUMERIC(6,2) NOT NULL DEFAULT 0,
    execution_pct    NUMERIC(6,2) NOT NULL DEFAULT 0,
    status           VARCHAR(30)  NOT NULL DEFAULT 'running',
    flags            JSONB        NOT NULL DEFAULT '[]',
    child_order_ids  JSONB        NOT NULL DEFAULT '[]',
    is_institutional BOOLEAN      NOT NULL DEFAULT TRUE,
    sla_minutes      INTEGER,
    notes            TEXT                  DEFAULT '',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_algo_status  ON algo_orders(status);
CREATE INDEX IF NOT EXISTS idx_algo_symbol  ON algo_orders(symbol);
CREATE INDEX IF NOT EXISTS idx_algo_client  ON algo_orders(client_name);

-- ── FIX Sessions ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fix_sessions (
    session_id        VARCHAR(50)  PRIMARY KEY,
    venue             VARCHAR(20)  NOT NULL,
    sender_comp_id    VARCHAR(50)  NOT NULL,
    target_comp_id    VARCHAR(50)  NOT NULL,
    fix_version       VARCHAR(10)  NOT NULL DEFAULT 'FIX.4.2',
    status            VARCHAR(30)  NOT NULL DEFAULT 'logged_out',
    last_sent_seq     INTEGER      NOT NULL DEFAULT 0,
    last_recv_seq     INTEGER      NOT NULL DEFAULT 0,
    expected_recv_seq INTEGER      NOT NULL DEFAULT 1,
    last_heartbeat    TIMESTAMPTZ,
    latency_ms        INTEGER      NOT NULL DEFAULT 0,
    host              VARCHAR(255) NOT NULL,
    port              INTEGER      NOT NULL,
    error             TEXT,
    connected_since   TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── FIX Message Log ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fix_message_log (
    id           BIGSERIAL   PRIMARY KEY,
    session_id   VARCHAR(50) NOT NULL,
    direction    VARCHAR(4)  NOT NULL CHECK (direction IN ('IN','OUT')),
    msg_type     VARCHAR(10) NOT NULL,
    seq_num      INTEGER     NOT NULL,
    cl_ord_id    VARCHAR(80),
    raw_message  TEXT        NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_session    ON fix_message_log(session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_cl_ord_id  ON fix_message_log(cl_ord_id) WHERE cl_ord_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_msg_type   ON fix_message_log(msg_type);

-- ── Reference Data ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS symbols (
    symbol           VARCHAR(20)  PRIMARY KEY,
    cusip            VARCHAR(20)  UNIQUE,
    name             VARCHAR(200) NOT NULL,
    listing_exchange VARCHAR(20)  NOT NULL,
    lot_size         INTEGER      NOT NULL DEFAULT 100,
    tick_size        NUMERIC(10,4) NOT NULL DEFAULT 0.01,
    status           VARCHAR(20)  NOT NULL DEFAULT 'active',
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
    client_id        VARCHAR(20)  PRIMARY KEY,
    name             VARCHAR(100) UNIQUE NOT NULL,
    tier             VARCHAR(20)  NOT NULL,
    sla_minutes      INTEGER,
    active           BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ── Scenarios ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scenario_runs (
    id           BIGSERIAL   PRIMARY KEY,
    scenario_name VARCHAR(100) NOT NULL,
    loaded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    loaded_by    VARCHAR(100)
);

-- ── Update timestamp trigger ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN VALUES ('orders'), ('algo_orders'), ('fix_sessions'), ('symbols')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
             CREATE TRIGGER trg_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
            tbl, tbl
        );
    END LOOP;
END
$$;

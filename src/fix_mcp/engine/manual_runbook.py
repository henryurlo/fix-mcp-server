"""Manual runbook mapping: MCP tool → equivalent Linux/SQL/FIX commands.

Each entry shows what a human engineer would run to achieve the same result
without the AI layer. Used by the Manual Runbook panel to defang the
"what if the LLM is down?" objection.
"""

MANUAL_RUNBOOK = {
    "check_fix_sessions": {
        "title": "Check FIX Session Health",
        "description": "Verify session status, sequence numbers, and heartbeat age for all venues.",
        "commands": [
            {
                "label": "Check heartbeat logs",
                "language": "bash",
                "code": "grep -E 'heartbeat|logon|logout' /var/log/fix/*.log | tail -100",
            },
            {
                "label": "Test connectivity",
                "language": "bash",
                "code": "nc -zv fix.nyse.com 9876 && nc -zv fix.arca.com 9876 && nc -zv fix.bats.com 9876",
            },
            {
                "label": "Query session state",
                "language": "sql",
                "code": "SELECT venue, session_id, status, last_heartbeat, expected_recv_seq, last_recv_seq\nFROM fix_sessions\nWHERE status != 'active'\nORDER BY last_heartbeat ASC;",
            },
            {
                "label": "Check stuck orders at down venues",
                "language": "sql",
                "code": "SELECT o.cl_ord_id, o.symbol, o.side, o.qty, o.venue, o.ord_status\nFROM orders o\nJOIN fix_sessions s ON o.venue = s.venue\nWHERE s.status = 'down'\n  AND o.ord_status IN ('0', '1', 'A');",
            },
        ],
    },
    "fix_session_issue": {
        "title": "Recover FIX Session Issue",
        "description": "Send ResendRequest, reset sequence numbers, or reconnect a venue session.",
        "commands": [
            {
                "label": "Send FIX ResendRequest (35=2)",
                "language": "bash",
                "code": 'fix-cli send --session ARCA --msg "8=FIX.4.4|9=65|35=2|112=RESEND|16=42|17=100|10=234|"',
                "notes": "Replace 16=BeginSeqNo and 17=EndSeqNo with gap boundaries.",
            },
            {
                "label": "Reset sequence numbers",
                "language": "bash",
                "code": "systemctl restart fix-session-arca.service\n# Or: update the sequence store directly\nredis-cli SET fix:seq:ARCA:send 1\nredis-cli SET fix:seq:ARCA:recv 1",
            },
            {
                "label": "Check system logs for TCP errors",
                "language": "bash",
                "code": "journalctl -u fix-session-arca --since '5 min ago' | grep -iE 'error|disconnect|refused|timeout'",
            },
        ],
    },
    "query_orders": {
        "title": "Query Order Management System",
        "description": "Look up orders by client, symbol, status, or venue.",
        "commands": [
            {
                "label": "Find open orders (last hour)",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, side, qty, px, ord_status, venue, transact_time\nFROM orders\nWHERE ord_status IN ('0', '1', 'A')\n  AND transact_time > NOW() - INTERVAL '1 hour'\nORDER BY transact_time DESC;",
            },
            {
                "label": "Find stuck orders at down venue",
                "language": "sql",
                "code": "SELECT o.cl_ord_id, o.symbol, o.side, o.qty, o.venue, o.sla_minutes,\n       o.created_at, o.updated_at\nFROM orders o\nWHERE o.venue = 'ARCA'\n  AND o.ord_status IN ('0', '1')\n  AND NOT EXISTS (\n    SELECT 1 FROM fix_sessions s\n    WHERE s.venue = o.venue AND s.status = 'active'\n  );",
            },
            {
                "label": "Check institutional SLA breaches",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, client_name, sla_minutes,\n       created_at,\n       EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS minutes_elapsed,\n       CASE\n         WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 > sla_minutes THEN 'BREACHED'\n         ELSE 'OK'\n       END AS sla_status\nFROM orders\nWHERE account_type = 'institutional'\n  AND ord_status IN ('0', '1')\n  AND sla_minutes IS NOT NULL;",
            },
        ],
    },
    "send_order": {
        "title": "Send New FIX Order",
        "description": "Construct and send a FIX NewOrderSingle (35=D) message.",
        "commands": [
            {
                "label": "Construct FIX 35=D message",
                "language": "bash",
                "code": 'fix-cli send --session NYSE --msg \\\n  "8=FIX.4.4|9=123|35=D|11=CLORD001|21=1|55=AAPL|54=1|38=1000|40=2|44=175.50|59=0|60=20260422-09:30:00.000|10=XXX|"',
                "notes": "Tag 35=D=NewOrderSingle, 54=1=Buy, 54=2=Sell, 40=2=Limit, 59=0=Day",
            },
            {
                "label": "Verify order accepted",
                "language": "bash",
                "code": "grep 'CLORD001' /var/log/fix/nyse-exec-reports.log | tail -5",
            },
        ],
    },
    "cancel_replace": {
        "title": "Cancel or Replace Order",
        "description": "Send FIX OrderCancel (35=F) or OrderCancelReplace (35=G).",
        "commands": [
            {
                "label": "Cancel order (FIX 35=F)",
                "language": "bash",
                "code": 'fix-cli send --session NYSE --msg \\\n  "8=FIX.4.4|9=85|35=F|11=NEWCLORD|41=OLDCLORD|21=1|55=AAPL|54=1|38=0|60=20260422-09:35:00.000|10=XXX|"',
                "notes": "Tag 41=OrigClOrdID — must match the original order's ClOrdID (tag 11).",
            },
            {
                "label": "Replace order (FIX 35=G)",
                "language": "bash",
                "code": 'fix-cli send --session NYSE --msg \\\n  "8=FIX.4.4|9=110|35=G|41=OLDCLORD|11=NEWCLORD002|38=500|40=2|44=176.00|55=AAPL|54=1|60=20260422-09:35:00.000|10=XXX|"',
                "notes": "Include ALL mutable tags — the exchange replaces the entire order.",
            },
            {
                "label": "Check execution report for cancel/replace",
                "language": "bash",
                "code": "grep -E '41=OLDCLORD|35=F|35=G' /var/log/fix/nyse-exec-reports.log",
            },
        ],
    },
    "run_premarket_check": {
        "title": "Premarket Health Check",
        "description": "Run the full pre-trading checklist before market open.",
        "commands": [
            {
                "label": "Run premarket checklist script",
                "language": "bash",
                "code": "#!/bin/bash\n# 1. Check FIX session Logon statuses\nfor venue in NYSE ARCA BATS IEX; do\n  status=$(redis-cli GET fix:session:status:$venue)\n  echo \"[$venue] FIX session: $status\"\ndone\n\n# 2. Verify sequence numbers sync\nredis-cli MGET fix:seq:NYSE:send fix:seq:NYSE:recv fix:seq:ARCA:send fix:seq:ARCA:recv\n\n# 3. Check reference data is loaded\nredis-cli SCARD fix:ref:symbols\n\n# 4. Confirm no stuck orders from overnight\npsql -c \"SELECT count(*) FROM orders WHERE ord_status = '0' AND created_at < NOW() - INTERVAL '12 hours';\"\n\n# 5. Run venue connectivity tests\nfor venue in NYSE ARCA BATS IEX; do\n  nc -zv fix.${venue,,}.com 9876 2>&1\ndone",
            },
        ],
    },
    "send_algo_order": {
        "title": "Submit Algorithmic Order",
        "description": "Create a parent algo order with execution schedule (TWAP, VWAP, POV, IS, Dark Aggregator).",
        "commands": [
            {
                "label": "Submit TWAP via algo engine REST API",
                "language": "bash",
                "code": 'curl -s -X POST http://algo-engine:7000/parent \\\n  -H "Content-Type: application/json" \\\n  -d \'{\"algo_type\": \"TWAP\", \"symbol\": \"AAPL\", \"side\": \"buy\", \"total_qty\": 50000, \"client_name\": \"Maple Capital\", \"start_time\": \"09:30:00\", \"end_time\": \"15:30:00\", \"venue\": \"NYSE\"}\'',
            },
            {
                "label": "Check algo execution progress",
                "language": "bash",
                "code": "curl -s http://algo-engine:7000/algo/TWAP-001/status | jq .",
            },
            {
                "label": "Pause/modify algo",
                "language": "bash",
                "code": "curl -s -X POST http://algo-engine:7000/algo/TWAP-001/pause",
            },
        ],
    },
    "update_venue_status": {
        "title": "Update Venue Status (Manual Override)",
        "description": "Force a venue to active/degraded/down state when auto-detection is wrong.",
        "commands": [
            {
                "label": "Check current session status",
                "language": "sql",
                "code": "SELECT venue, status, last_heartbeat, latency_ms, expected_recv_seq, last_recv_seq\nFROM fix_sessions\nWHERE venue = 'ARCA';",
            },
            {
                "label": "Update via Redis (override)",
                "language": "bash",
                "code": "redis-cli SET fix:session:status:ARCA down\n# Or restore to active\nredis-cli SET fix:session:status:ARCA active",
            },
            {
                "label": "Check for orders stuck at this venue",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, qty, ord_status,\n       EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60.0 AS stuck_minutes\nFROM orders\nWHERE venue = 'ARCA' AND ord_status IN ('0', '1')\nORDER BY updated_at ASC;",
            },
        ],
    },
    "update_ticker": {
        "title": "Rename Symbol / Corporate Action",
        "description": "Update a symbol in the reference store and bulk-update affected open orders.",
        "commands": [
            {
                "label": "Update reference data",
                "language": "sql",
                "code": "UPDATE reference_symbols\nSET symbol = 'GEHC', updated_at = NOW()\nWHERE symbol = 'GE';\n\n-- Flag affected orders\nUPDATE orders\nSET symbol = 'GEHC', notes = 'Auto-updated from GE via corporate action'\nWHERE symbol = 'GE' AND ord_status IN ('0', '1');",
            },
            {
                "label": "Verify stop orders affected",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, ord_type, px\nFROM orders\nWHERE ord_type = '3' -- Stop Order\n  AND symbol = 'GEHC'\n  AND ord_status IN ('0', '1');",
            },
        ],
    },
    "release_stuck_orders": {
        "title": "Release Stuck Orders",
        "description": "Remove venue_down flags and re-queue stuck orders for processing.",
        "commands": [
            {
                "label": "List stuck orders",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, side, qty, venue, stuck_reason, created_at\nFROM orders\nWHERE ord_status = 'stuck'\nORDER BY created_at ASC;",
            },
            {
                "label": "Release and re-route",
                "language": "sql",
                "code": "UPDATE orders\nSET ord_status = '0',\n    venue_down_flag = false,\n    stuck_reason = NULL,\n    updated_at = NOW()\nWHERE ord_status = 'stuck'\n  AND venue = 'ARCA';\n\n-- Verify they were re-queued\nSELECT count(*) FROM orders\nWHERE ord_status = '0' AND updated_at > NOW() - INTERVAL '1 minute';",
            },
        ],
    },
    "check_pending_acks": {
        "title": "Check Pending ACKs (Duplicate Risk)",
        "description": "List orders awaiting exchange acknowledgment — if pending > 30s, resend risks duplicates.",
        "commands": [
            {
                "label": "Find orders with pending ACK",
                "language": "sql",
                "code": "SELECT cl_ord_id, symbol, venue, created_at,\n       EXTRACT(EPOCH FROM (NOW() - created_at)) AS pending_seconds,\n       CASE\n         WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) > 30 THEN 'HIGH DUP RISK'\n         ELSE 'OK'\n       END AS dup_risk\nFROM orders\nWHERE ord_status = 'pending_ack'\nORDER BY created_at ASC;",
            },
        ],
    },
    "check_market_data_staleness": {
        "title": "Check Market Data Staleness",
        "description": "Report symbols whose last quote exceeds the freshness threshold.",
        "commands": [
            {
                "label": "Check quote age per symbol",
                "language": "sql",
                "code": "SELECT symbol,\n       EXTRACT(EPOCH FROM (NOW() - last_quote_time)) * 1000 AS age_ms,\n       bid, ask, bid_size, ask_size\nFROM market_data_quotes\nWHERE EXTRACT(EPOCH FROM (NOW() - last_quote_time)) > 0.5  -- 500ms threshold\nORDER BY age_ms DESC;",
            },
            {
                "label": "Check FIX market data subscription status",
                "language": "bash",
                "code": "redis-cli SMEMBERS fix:md:subscriptions | while read sub; do\n  echo \"Subscription $sub: $(redis-cli GET fix:md:last_update:$sub)\"\ndone",
            },
        ],
    },
    "load_ticker": {
        "title": "Load New Symbol into Reference Store",
        "description": "Add a new symbol CUSIP mapping and release any orders pending that symbol.",
        "commands": [
            {
                "label": "Insert reference data",
                "language": "sql",
                "code": "INSERT INTO reference_symbols (symbol, cusip, name, listing_exchange, lot_size, tick_size, created_at)\nVALUES ('GME', '40434L108', 'GameStop Corp', 'NYSE', 100, 0.01, NOW());",
            },
            {
                "label": "Release orders pending this symbol",
                "language": "sql",
                "code": "UPDATE orders\nSET symbol = 'GME',\n    ord_status = '0',\n    stuck_reason = NULL\nWHERE symbol = 'GME' AND ord_status = 'stuck'\n  AND stuck_reason = 'symbol_not_loaded';",
            },
        ],
    },
}

"""FIX MCP Dashboard — stateful local console.

Self-contained: serves both the HTML UI and the API endpoints from one process.
Runs on port 8080 by default (matching the docker-compose dashboard service).

For local development:
    ./.venv/bin/fix-mcp-dashboard
    open http://127.0.0.1:8080

For Docker (dashboard container talks to api-server via shared compose network):
    docker compose up -d
    open http://localhost:8080
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# API server base URL — override via env var for non-Docker deployments
API_URL = os.environ.get("API_URL", "http://api-server:8000")


# ---------------------------------------------------------------------------
# Embedded HTML + JS
# ---------------------------------------------------------------------------

HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FIX MCP Dashboard</title>
  <style>
    :root {
      --bg: #f0ece3; --ink: #12202e; --panel: #fffdf8; --line: #d0c4b4;
      --accent: #8f2d1f; --blue: #1d4e89; --ok: #1a6b46; --warn: #a05c00; --down: #8f2d1f;
      --mono: "SFMono-Regular", "Consolas", monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, serif; background: var(--bg); color: var(--ink); }
    a { color: var(--blue); }

    /* ── layout ── */
    .shell { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; }
    .topbar { padding: 12px 20px; background: var(--ink); color: #fff; display: flex; align-items: center; gap: 16px; }
    .topbar h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
    .topbar .spacer { flex: 1; }
    .statusbar { display: flex; gap: 10px; padding: 8px 20px; background: #e6e0d6; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    .main { display: grid; grid-template-columns: 300px 1fr; overflow: hidden; }
    .sidebar { border-right: 1px solid var(--line); overflow-y: auto; padding: 14px; background: var(--panel); display: flex; flex-direction: column; gap: 10px; }
    .content { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }

    /* ── components ── */
    button { font: inherit; border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-family: Arial, sans-serif; font-size: 13px; }
    .btn-primary { background: var(--blue); color: #fff; }
    .btn-danger  { background: var(--accent); color: #fff; }
    .btn-ok      { background: var(--ok); color: #fff; }
    .btn-neutral { background: #ccc; color: var(--ink); }
    select { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: #fff; font-family: Arial, sans-serif; font-size: 13px; }
    input  { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: #fff; width: 100%; font-family: Arial, sans-serif; font-size: 13px; }
    pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; margin: 0; }

    .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-family: Arial, sans-serif; font-size: 12px; font-weight: 600; }
    .chip-ok   { background: #d4edda; color: var(--ok); }
    .chip-warn { background: #fff3cd; color: var(--warn); }
    .chip-down { background: #f8d7da; color: var(--down); }
    .chip-neutral { background: #e2e8f0; color: #4a5568; }

    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    .card h4 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-family: Arial, sans-serif; color: #666; }
    .card.critical { border-color: var(--down); background: #fff5f5; }
    .card.warn { border-color: var(--warn); background: #fffbf0; }
    .card.ok { border-color: var(--ok); background: #f0fff8; }

    .step { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
    .step.done { border-color: var(--ok); }
    .step h5 { margin: 0 0 5px; font-size: 14px; }
    .step p { margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 12px; color: #555; line-height: 1.4; }

    .section-label { font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #888; padding: 4px 0; }

    /* ── tabs ── */
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 0; }
    .tab { padding: 8px 16px; font-family: Arial, sans-serif; font-size: 13px; cursor: pointer; border-radius: 8px 8px 0 0; border: 1px solid transparent; border-bottom: none; color: #666; }
    .tab.active { background: var(--panel); border-color: var(--line); color: var(--ink); font-weight: 600; }
    .tab-body { display: none; }
    .tab-body.active { display: block; }

    /* ── tables ── */
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12.5px; }
    th { text-align: left; padding: 6px 10px; border-bottom: 2px solid var(--line); color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; }
    td { padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:hover td { background: #f8f6f1; }
    .flag { display: inline-block; padding: 2px 6px; border-radius: 6px; background: #fee2e2; color: var(--down); font-size: 10px; margin: 1px; }
    .flag-warn { background: #fef3c7; color: var(--warn); }

    /* ── session badges ── */
    .sess-ok   { color: var(--ok);   font-weight: 700; }
    .sess-warn { color: var(--warn); font-weight: 700; }
    .sess-down { color: var(--down); font-weight: 700; }

    /* ── status bar numbers ── */
    .stat { display: flex; align-items: center; gap: 6px; font-family: Arial, sans-serif; font-size: 13px; }
    .stat strong { font-size: 18px; font-family: Georgia, serif; }
    .stat .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }

    .divider { height: 1px; background: var(--line); }
  </style>
</head>
<body>
<div class="shell">

  <!-- ── top bar ── -->
  <div class="topbar">
    <h1>FIX MCP Dashboard</h1>
    <span class="spacer"></span>
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-family:Arial;font-size:11px;color:#aaa;letter-spacing:1px;text-transform:uppercase">Mode</span>
      <button id="modeHuman" class="btn-ok"     onclick="switchMode('human')" style="padding:6px 10px;font-size:12px">Human</button>
      <button id="modeMixed" class="btn-neutral" onclick="switchMode('mixed')" style="padding:6px 10px;font-size:12px">Mixed</button>
      <button id="modeAgent" class="btn-neutral" onclick="switchMode('agent')" style="padding:6px 10px;font-size:12px">Agent</button>
    </div>
    <select id="scenarioSelect" onchange="loadScenario(this.value)"></select>
    <button class="btn-neutral" onclick="refresh()">Refresh</button>
    <button class="btn-danger"  onclick="resetScenario()">Reset</button>
  </div>

  <!-- ── status bar ── -->
  <div class="statusbar" id="statusbar">Loading…</div>

  <!-- ── main ── -->
  <div class="main">

    <!-- left sidebar -->
    <div class="sidebar">
      <div class="section-label">Session Health</div>
      <div id="sessionCards"></div>

      <div class="divider"></div>
      <div class="section-label">Guided Workflow</div>
      <div id="workflowSteps" class="stack" style="display:flex;flex-direction:column;gap:8px"></div>

      <div class="divider"></div>
      <div class="section-label">Quick Tools</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn-primary" onclick="runTool('run_premarket_check',{})">Pre-Market Check</button>
        <button class="btn-primary" onclick="runTool('check_fix_sessions',{})">Check Sessions</button>
        <button class="btn-primary" onclick="runTool('check_algo_status',{})">Check Algos</button>
        <button class="btn-primary" onclick="runTool('list_scenarios',{action:'list'})">List Scenarios</button>
      </div>

      <div class="divider"></div>
      <div class="section-label">Send Order</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input id="qSymbol"   placeholder="Symbol (e.g. AAPL)" value="AAPL" />
        <input id="qQty"      placeholder="Qty" value="100" type="number" />
        <input id="qPrice"    placeholder="Price (limit)" value="214.50" type="number" step="0.01" />
        <select id="qSide"><option value="buy">Buy</option><option value="sell">Sell</option></select>
        <select id="qClient">
          <option>Maple Capital</option><option>Rowan Partners</option>
          <option>Birch Funds</option><option>Sycamore Group</option>
          <option>Aspen Asset Management</option><option>Willow Investments</option>
          <option>Cedar Trading</option><option>Elm Securities</option>
          <option>Firm Prop Desk</option>
        </select>
        <button class="btn-ok" onclick="sendOrder()">Send Limit Order</button>
      </div>

      <div class="divider"></div>
      <div class="section-label">Session Repair</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <select id="repairVenue">
          <option>NYSE</option><option>ARCA</option><option>BATS</option>
          <option>IEX</option><option>EDGX</option><option>NASDAQ</option>
        </select>
        <select id="repairAction">
          <option value="resend_request">ResendRequest (35=2)</option>
          <option value="reset_sequence">SequenceReset (35=4)</option>
          <option value="reconnect">Reconnect (Logon 35=A)</option>
        </select>
        <button class="btn-danger" onclick="repairSession()">Repair Session</button>
      </div>
    </div>

    <!-- main content -->
    <div class="content">
      <div class="tabs" id="tabs">
        <div class="tab active" onclick="switchTab('output')">Output</div>
        <div class="tab" onclick="switchTab('sessions')">Sessions</div>
        <div class="tab" onclick="switchTab('orders')">Orders</div>
        <div class="tab" onclick="switchTab('algos')">Algos</div>
        <div class="tab" onclick="switchTab('activity')">Activity</div>
      </div>

      <div class="tab-body active" id="tab-output">
        <div class="card">
          <pre id="output">Select a workflow step or quick tool on the left to get started.</pre>
        </div>
      </div>

      <div class="tab-body" id="tab-sessions">
        <div class="card">
          <h4>FIX Session States</h4>
          <table id="sessionsTable">
            <thead><tr><th>Venue</th><th>Status</th><th>Latency</th><th>Last Sent</th><th>Last Recv</th><th>Expected</th><th>Error</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="tab-body" id="tab-orders">
        <div class="card">
          <h4>Open Orders</h4>
          <table id="ordersTable">
            <thead><tr><th>Order ID</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Price</th><th>Venue</th><th>Status</th><th>Client</th><th>Notional</th><th>Flags</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="tab-body" id="tab-algos">
        <div class="card">
          <h4>Active Algo Orders</h4>
          <table id="algosTable">
            <thead><tr><th>Algo ID</th><th>Symbol</th><th>Type</th><th>Total Qty</th><th>Executed</th><th>Schedule%</th><th>Exec%</th><th>Deviation</th><th>Status</th><th>Client</th><th>Flags</th><th>Actions</th></tr></thead>
          <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="tab-body" id="tab-activity">
        <div class="card">
          <h4>Agent Activity Log</h4>
          <table id="activityTable">
            <thead><tr><th>Time</th><th>Tool</th><th>Status</th><th>Summary</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  // ── state ──────────────────────────────────────────────────────────────────
  let currentStatus = null;

  // ── workflow definitions — one step set per scenario ──────────────────────
  const SCENARIO_STEPS = {

    morning_triage: [
      { id:'s1', label:'1. Pre-Market Check',   desc:'Full triage: sessions, corp actions, stuck orders, SLA timers.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check Sessions',      desc:'Inspect sequence numbers. ARCA is down with a seq gap.', cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{}) },
      { id:'s3', label:'3. Repair ARCA',         desc:'Send ResendRequest (35=2) to recover ARCA sequence gap and release stuck orders.', cls:'btn-danger', fn: () => runStep('s3','fix_session_issue',{venue:'ARCA',action:'resend_request'}) },
      { id:'s4', label:'4. Query Stuck Orders',  desc:'Find orders blocked at ARCA and by unknown symbols.', cls:'btn-primary', fn: () => runStep('s4','query_orders',{status:'stuck'}) },
      { id:'s5', label:'5. Check ACME Ticker',   desc:'Confirm ACME→ACMX corporate action affects 23 open orders.', cls:'btn-primary', fn: () => runStep('s5','check_ticker',{symbol:'ACME'}) },
      { id:'s6', label:'6. Load ZEPH (IPO)',      desc:'Add ZEPH to reference store and release 2 pending IPO orders.', cls:'btn-ok', fn: () => runStep('s6','load_ticker',{symbol:'ZEPH',cusip:'98765X101',name:'Zephyr Technologies Inc',listing_exchange:'NYSE'}) },
      { id:'s7', label:'7. Validate All Orders', desc:'Pre-flight check all open orders before the 09:30 open.', cls:'btn-primary', fn: () => runStep('s7','validate_orders',{status:'new'}) },
    ],

    bats_startup_0200: [
      { id:'s1', label:'1. Check Sessions',       desc:'02:05 ET: BATS SequenceReset — NewSeqNo=1 but peer expects 2,450.', cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Reset BATS Sequence',  desc:'Send SequenceReset (35=4) to align BATS seq to peer expectation.', cls:'btn-danger', fn: () => runStep('s2','fix_session_issue',{venue:'BATS',action:'reset_sequence'}) },
      { id:'s3', label:'3. Query Stuck Orders',   desc:'Find GTC orders blocked at BATS during overnight seq issue.', cls:'btn-primary', fn: () => runStep('s3','query_orders',{status:'stuck'}) },
      { id:'s4', label:'4. Load BITO Symbol',     desc:'Load crypto ETF BITO pending IPO-day reference data.', cls:'btn-ok', fn: () => runStep('s4','load_ticker',{symbol:'BITO',cusip:'BITO00001',name:'ProShares Bitcoin ETF',listing_exchange:'NYSE'}) },
      { id:'s5', label:'5. Re-Check BATS',        desc:'Confirm BATS session is active and seq gap resolved.', cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'BATS'}) },
      { id:'s6', label:'6. Validate Overnight',   desc:'Validate all GTC orders before institutional DMA opens at 04:00 ET.', cls:'btn-primary', fn: () => runStep('s6','validate_orders',{}) },
    ],

    predawn_adrs_0430: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'04:35 ET: Shell ADR rebrand RDSA→SHEL; ARCA latency 220ms.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check RDSA Ticker',    desc:'Confirm RDSA pending rename and count affected open orders.', cls:'btn-primary', fn: () => runStep('s2','check_ticker',{symbol:'RDSA'}) },
      { id:'s3', label:'3. Apply RDSA→SHEL',      desc:'Rename ticker and bulk-update all open RDSA orders to SHEL.', cls:'btn-danger', fn: () => runStep('s3','update_ticker',{old_symbol:'RDSA',new_symbol:'SHEL',reason:'corporate_action'}) },
      { id:'s4', label:'4. Check ARCA Session',   desc:'ARCA latency 220ms — route flap. Check degraded state.', cls:'btn-primary', fn: () => runStep('s4','check_fix_sessions',{venue:'ARCA'}) },
      { id:'s5', label:'5. Query ARCA Orders',    desc:'Find orders routed to ARCA that are at risk from high latency.', cls:'btn-primary', fn: () => runStep('s5','query_orders',{venue:'ARCA'}) },
      { id:'s6', label:'6. Validate ADR Orders',  desc:'Validate all SHEL orders post-rename before pre-market opens.', cls:'btn-primary', fn: () => runStep('s6','validate_orders',{symbol:'SHEL'}) },
    ],

    preopen_auction_0900: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'09:02 ET: MOO imbalance on SPY; IEX feed stale 4 min.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check IEX Session',    desc:'IEX feed is stale — last quote 4 minutes ago.', cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{venue:'IEX'}) },
      { id:'s3', label:'3. Query MOO Orders',     desc:'Find Market-on-Open orders exposed to SPY imbalance.', cls:'btn-primary', fn: () => runStep('s3','query_orders',{symbol:'SPY'}) },
      { id:'s4', label:'4. Validate Open Orders', desc:'Pre-flight check all orders — catch stale IEX prices before 09:28 lock.', cls:'btn-primary', fn: () => runStep('s4','validate_orders',{}) },
      { id:'s5', label:'5. Reconnect IEX',        desc:'If IEX feed remains stale, trigger reconnect.', cls:'btn-danger', fn: () => runStep('s5','fix_session_issue',{venue:'IEX',action:'reconnect'}) },
    ],

    open_volatility_0930: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'09:35 ET: GME LULD halt; BATS packet loss 3.2%.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Find GME Orders',      desc:'Identify all GME orders blocked by LULD circuit breaker.', cls:'btn-danger', fn: () => runStep('s2','query_orders',{symbol:'GME'}) },
      { id:'s3', label:'3. Check BATS Session',   desc:'BATS reporting elevated packet loss — assess degradation.', cls:'btn-primary', fn: () => runStep('s3','check_fix_sessions',{venue:'BATS'}) },
      { id:'s4', label:'4. Query BATS Orders',    desc:'Find orders at BATS that may be delayed due to packet loss.', cls:'btn-primary', fn: () => runStep('s4','query_orders',{venue:'BATS',status:'stuck'}) },
      { id:'s5', label:'5. Validate Orders',      desc:'Check for duplicate ClOrdIDs and LULD price band violations.', cls:'btn-primary', fn: () => runStep('s5','validate_orders',{}) },
    ],

    venue_degradation_1030: [
      { id:'s1', label:'1. Check Sessions',       desc:'10:32 ET: NYSE 180ms latency (Mahwah route flap #44827).', cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Find Stuck Orders',    desc:'12 orders with venue_degraded+seq_backlog at NYSE ($4.1M).', cls:'btn-primary', fn: () => runStep('s2','query_orders',{venue:'NYSE',status:'stuck'}) },
      { id:'s3', label:'3. Validate NYSE Orders', desc:'Check which NYSE orders are listing-venue-required (cannot reroute).', cls:'btn-primary', fn: () => runStep('s3','validate_orders',{venue:'NYSE'}) },
      { id:'s4', label:'4. Repair NYSE',          desc:'Send ResendRequest to clear seq backlog caused by route flap.', cls:'btn-danger', fn: () => runStep('s4','fix_session_issue',{venue:'NYSE',action:'resend_request'}) },
      { id:'s5', label:'5. Re-Check Status',      desc:'Confirm backlog cleared and latency normalising.', cls:'btn-primary', fn: () => runStep('s5','run_premarket_check',{}) },
    ],

    ssr_and_split_1130: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'11:34 ET: RIDE SSR active; AAPL 4:1 split in 26 min.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check RIDE Ticker',    desc:'Confirm SSR restriction on RIDE — short-sell orders must be at/above NBBO.', cls:'btn-primary', fn: () => runStep('s2','check_ticker',{symbol:'RIDE'}) },
      { id:'s3', label:'3. Find RIDE Short Orders', desc:'Identify SellShort orders on RIDE that violate SSR.', cls:'btn-danger', fn: () => runStep('s3','query_orders',{symbol:'RIDE'}) },
      { id:'s4', label:'4. Check AAPL Ticker',    desc:'Confirm AAPL split ratio and see which orders need adjustment.', cls:'btn-primary', fn: () => runStep('s4','check_ticker',{symbol:'AAPL'}) },
      { id:'s5', label:'5. Apply AAPL Split',     desc:'Update AAPL ticker (ratio adjustment) — bulk-updates open orders.', cls:'btn-danger', fn: () => runStep('s5','update_ticker',{old_symbol:'AAPL',new_symbol:'AAPL',reason:'corporate_action'}) },
      { id:'s6', label:'6. Validate All',         desc:'Pre-flight check: catch stop orders with pre-split prices.', cls:'btn-primary', fn: () => runStep('s6','validate_orders',{symbol:'AAPL'}) },
    ],

    iex_recovery_1400: [
      { id:'s1', label:'1. Check Sessions',       desc:'14:03 ET: IEX recovered after 1-hour outage. Seq gap 8938–8940.', cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Repair IEX',           desc:'Send ResendRequest to resolve the 3-message seq gap on IEX.', cls:'btn-danger', fn: () => runStep('s2','fix_session_issue',{venue:'IEX',action:'resend_request'}) },
      { id:'s3', label:'3. Find Rerouted Orders', desc:'Find orders diverted to BATS during IEX outage (iex_rerouted flag).', cls:'btn-primary', fn: () => runStep('s3','query_orders',{venue:'BATS'}) },
      { id:'s4', label:'4. Find D-Limit Orders',  desc:'Identify D-Limit orders that must return to IEX now session is healthy.', cls:'btn-primary', fn: () => runStep('s4','query_orders',{status:'stuck'}) },
      { id:'s5', label:'5. Validate IEX Orders',  desc:'Check partial fills on NYSE — do not move those orders.', cls:'btn-primary', fn: () => runStep('s5','validate_orders',{}) },
    ],

    eod_moc_1530: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'15:31 ET: ARCA MOC cutoff missed; NYSE MOC closes in 14 min.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Find MOC Orders',      desc:'List all Market-on-Close orders — identify cutoff misses.', cls:'btn-danger', fn: () => runStep('s2','query_orders',{status:'stuck'}) },
      { id:'s3', label:'3. Find GTC Orders',      desc:'Identify GTC orders that must be preserved before 16:00 DAY purge.', cls:'btn-primary', fn: () => runStep('s3','query_orders',{}) },
      { id:'s4', label:'4. Validate MOC Orders',  desc:'Check Maple Capital 500K AAPL MOC — large_moc_regulatory_review flag.', cls:'btn-primary', fn: () => runStep('s4','validate_orders',{symbol:'AAPL'}) },
      { id:'s5', label:'5. Check Sessions',       desc:'Confirm NYSE session is active before cutoff at 15:45.', cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'NYSE'}) },
    ],

    afterhours_dark_1630: [
      { id:'s1', label:'1. After-Hours Check',    desc:'16:32 ET: NYSE/ARCA logged out. Liquidnet offline (SessionStatus=8).', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check Sessions',       desc:'Confirm which venues are in extended-hours and which are fully offline.', cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{}) },
      { id:'s3', label:'3. Find Dark Pool Orders', desc:'Find orders blocked with dark_pool_unavailable — the orphaned NVDA block.', cls:'btn-danger', fn: () => runStep('s3','query_orders',{status:'stuck'}) },
      { id:'s4', label:'4. Cancel Uncleaned DAY', desc:'Find DAY orders that were not canceled at 16:00 (OMS cleanup job failed).', cls:'btn-danger', fn: () => runStep('s4','query_orders',{}) },
      { id:'s5', label:'5. Check BATS Extended',  desc:'Confirm BATS extended-hours session (16:00–20:00) is healthy.', cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'BATS'}) },
      { id:'s6', label:'6. Validate After-Hours', desc:'Check remaining open orders — confirm only extended-hours eligible orders are active.', cls:'btn-primary', fn: () => runStep('s6','validate_orders',{}) },
    ],

    twap_slippage_1000: [
      { id:'s1', label:'1. Check Algo Status',    desc:'10:05 ET: NVDA TWAP 5.2ppts behind; GME TWAP halted mid-execution.', cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect NVDA TWAP',    desc:'Drill into ALGO-20260328-001: schedule deviation and rejected slices.', cls:'btn-primary', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-001'}) },
      { id:'s3', label:'3. Pause NVDA TWAP',      desc:'Pause the behind-schedule NVDA TWAP to stop further slippage.', cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-001',action:'pause'}) },
      { id:'s4', label:'4. Check BATS Session',   desc:'BATS degraded 85ms — root cause of NVDA slice rejections.', cls:'btn-primary', fn: () => runStep('s4','check_fix_sessions',{venue:'BATS'}) },
      { id:'s5', label:'5. Find GME Orders',      desc:'Inspect GME TWAP child slices blocked by LULD halt.', cls:'btn-primary', fn: () => runStep('s5','query_orders',{symbol:'GME'}) },
      { id:'s6', label:'6. Check Algo Status',    desc:'After pausing NVDA, review full algo book state.', cls:'btn-primary', fn: () => runStep('s6','check_algo_status',{}) },
    ],

    vwap_vol_spike_1130: [
      { id:'s1', label:'1. Check Algo Status',    desc:'11:35 ET: MSFT VWAP over-participating at 15% vs 10% cap.', cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect MSFT VWAP',    desc:'Check ALGO-20260328-003: over_participation and spread_widened flags.', cls:'btn-danger', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-003'}) },
      { id:'s3', label:'3. Reduce MSFT POV Rate', desc:'Lower MSFT VWAP participation from 15% to 10% to stop over-participation.', cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-003',action:'update_pov_rate',new_pov_rate:0.10}) },
      { id:'s4', label:'4. Inspect AMD POV',      desc:'Check ALGO-20260328-004: AMD POV also over-participating.', cls:'btn-primary', fn: () => runStep('s4','check_algo_status',{algo_id:'ALGO-20260328-004'}) },
      { id:'s5', label:'5. Reduce AMD POV Rate',  desc:'Lower AMD POV rate from 15% to 8% to reduce market impact.', cls:'btn-danger', fn: () => runStep('s5','modify_algo',{algo_id:'ALGO-20260328-004',action:'update_pov_rate',new_pov_rate:0.08}) },
      { id:'s6', label:'6. Check Algo Status',    desc:'Confirm both algos are now within participation limits.', cls:'btn-primary', fn: () => runStep('s6','check_algo_status',{}) },
    ],

    is_dark_failure_1415: [
      { id:'s1', label:'1. Check Algo Status',    desc:'14:15 ET: TSLA IS 108bps shortfall; AMZN dark aggregator zero fills.', cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect TSLA IS',      desc:'ALGO-20260328-005: high_is_shortfall — avg 251.20 vs arrival 248.50.', cls:'btn-danger', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-005'}) },
      { id:'s3', label:'3. Pause TSLA IS',        desc:'IS shortfall >50bps requires client approval — pause algo first.', cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-005',action:'pause'}) },
      { id:'s4', label:'4. Inspect AMZN Dark',    desc:'ALGO-20260328-006: no_dark_fill — Liquidnet + IEX dark both rejecting.', cls:'btn-primary', fn: () => runStep('s4','check_algo_status',{algo_id:'ALGO-20260328-006'}) },
      { id:'s5', label:'5. Cancel AMZN Dark',     desc:'Dark venues illiquid — cancel dark algo and route to lit TWAP instead.', cls:'btn-danger', fn: () => runStep('s5','cancel_algo',{algo_id:'ALGO-20260328-006',reason:'dark venues illiquid, switching to lit TWAP'}) },
      { id:'s6', label:'6. Check Sessions',       desc:'Verify IEX dark sub-component status for the session engineer.', cls:'btn-primary', fn: () => runStep('s6','check_fix_sessions',{venue:'IEX'}) },
    ],
  };

  const DEFAULT_STEPS = [
    { id:'s1', label:'1. Pre-Market Check', desc:'Run full triage.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
    { id:'s2', label:'2. Check Sessions',   desc:'Inspect FIX session health.', cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{}) },
    { id:'s3', label:'3. Query Orders',     desc:'Find stuck or problematic orders.', cls:'btn-primary', fn: () => runStep('s3','query_orders',{status:'stuck'}) },
    { id:'s4', label:'4. Validate Orders',  desc:'Pre-flight validation.', cls:'btn-primary', fn: () => runStep('s4','validate_orders',{}) },
  ];

  // ── rendering helpers ──────────────────────────────────────────────────────

  function statusIcon(s) {
    if (s === 'active')   return '<span class="sess-ok">[OK]</span>';
    if (s === 'degraded') return '<span class="sess-warn">[WARN]</span>';
    if (s === 'down')     return '<span class="sess-down">[DOWN]</span>';
    return `<span>[${s.toUpperCase()}]</span>`;
  }

  function chip(text, cls) {
    return `<span class="chip chip-${cls}">${text}</span>`;
  }

  function renderFlags(flags) {
    if (!flags || !flags.length) return '—';
    return flags.map(f => {
      const warn = f.includes('degraded') || f.includes('behind') || f.includes('warn');
      return `<span class="flag${warn ? '-warn' : ''} flag">${f}</span>`;
    }).join('');
  }

  function deviationCell(dev) {
    if (dev === undefined || dev === null) return '—';
    const cls = dev < -10 ? 'color:var(--down);font-weight:700' : dev < -5 ? 'color:var(--warn)' : 'color:var(--ok)';
    return `<span style="${cls}">${dev > 0 ? '+' : ''}${dev}%</span>`;
  }

  // ── refresh ────────────────────────────────────────────────────────────────

  async function refresh() {
    const data = await fetchJson('/api/detail');
    if (!data) return;
    currentStatus = data;

    // scenario select
    const sel = document.getElementById('scenarioSelect');
    sel.innerHTML = data.available_scenarios.map(n =>
      `<option value="${n}" ${n === data.scenario ? 'selected' : ''}>${n}</option>`
    ).join('');

    // mode buttons
    const modes = ['human','mixed','agent'];
    modes.forEach(m => {
      const btn = document.getElementById('mode' + m.charAt(0).toUpperCase() + m.slice(1));
      if (btn) btn.className = m === data.mode ? 'btn-ok' : 'btn-neutral';
      if (btn) btn.style.cssText = 'padding:6px 10px;font-size:12px';
    });

    // status bar
    const downs = data.sessions.filter(s => s.status === 'down').length;
    const warns = data.sessions.filter(s => s.status === 'degraded').length;
    const actv  = data.sessions.filter(s => s.status === 'active').length;
    const sessChip = downs > 0 ? chip(`${downs} DOWN`, 'down') : warns > 0 ? chip(`${warns} WARN`, 'warn') : chip(`${actv} OK`, 'ok');
    const ordChip  = data.orders_stuck > 0 ? chip(`${data.orders_stuck} STUCK`, 'warn') : chip(`${data.orders_open} open`, 'ok');
    const algoChip = data.algos_active > 0 ? chip(`${data.algos_active} active`, 'ok') : chip('no algos', 'neutral');
    const modeChip = data.mode === 'agent' ? chip('AGENT AUTO', 'ok') : data.mode === 'mixed' ? chip('MIXED', 'warn') : chip('HUMAN', 'neutral');
    document.getElementById('statusbar').innerHTML = `
      <div class="stat">${sessChip}<span class="label">Sessions (${data.sessions.filter(s=>s.status==='active').length}/${data.sessions.length})</span></div>
      <div class="stat">${ordChip}<span class="label">Orders (${data.orders_open} open)</span></div>
      <div class="stat">${algoChip}<span class="label">Algos</span></div>
      <div class="stat">${modeChip}<span class="label">Mode</span></div>
      <div class="stat" style="margin-left:auto;color:#aaa;font-size:12px;font-family:Arial">Scenario: <strong style="color:var(--ink)">${data.scenario}</strong></div>
    `;

    // session cards
    document.getElementById('sessionCards').innerHTML = data.sessions.map(s => `
      <div class="card${s.status === 'down' ? ' critical' : s.status === 'degraded' ? ' warn' : ' ok'}" style="padding:10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-family:Arial;font-size:13px">${s.venue}</strong>
          ${statusIcon(s.status)}
        </div>
        <div style="font-family:Arial;font-size:11px;color:#666">
          ${s.latency_ms}ms · seq ${s.last_recv_seq}/${s.expected_recv_seq}
          ${s.seq_gap ? ' <span style="color:var(--down);font-weight:700">GAP</span>' : ''}
          ${s.error ? `<br><span style="color:var(--down)">${s.error.substring(0,40)}</span>` : ''}
        </div>
      </div>
    `).join('');

    // workflow steps (per-scenario) — store globally, reference by index to avoid quoting issues
    window._steps = SCENARIO_STEPS[data.scenario] || DEFAULT_STEPS;
    document.getElementById('workflowSteps').innerHTML = window._steps.map((s, i) => `
      <div class="step" id="step-${s.id}">
        <h5>${s.label}</h5>
        <p>${s.desc}</p>
        <button class="${s.cls}" onclick="runCurrentStep(${i})">Go</button>
      </div>
    `).join('');

    // sessions table
    document.querySelector('#sessionsTable tbody').innerHTML = data.sessions.map(s => `
      <tr>
        <td><strong>${s.venue}</strong></td>
        <td>${statusIcon(s.status)}</td>
        <td>${s.latency_ms}ms</td>
        <td>${s.last_sent_seq.toLocaleString()}</td>
        <td>${s.last_recv_seq.toLocaleString()}</td>
        <td>${s.expected_recv_seq.toLocaleString()}${s.seq_gap ? ' ⚠' : ''}</td>
        <td style="color:var(--down);font-size:11px">${s.error || ''}</td>
      </tr>
    `).join('');

    // orders table
    document.querySelector('#ordersTable tbody').innerHTML = data.orders.map(o => `
      <tr>
        <td style="font-family:var(--mono);font-size:11px">${o.order_id}</td>
        <td><strong>${o.symbol}</strong></td>
        <td>${o.side}</td>
        <td>${o.quantity.toLocaleString()}</td>
        <td>${o.order_type}</td>
        <td>${o.price ? '$'+o.price.toFixed(2) : '—'}</td>
        <td>${o.venue}</td>
        <td>${o.status}</td>
        <td>${o.client_name}</td>
        <td>$${Math.round(o.notional || 0).toLocaleString()}</td>
        <td>${renderFlags(o.flags)}</td>
      </tr>
    `).join('');

    // algos table
    document.querySelector('#algosTable tbody').innerHTML = data.algos.map(a => `
      <tr>
        <td style="font-family:var(--mono);font-size:11px">${a.algo_id}</td>
        <td><strong>${a.symbol}</strong></td>
        <td>${a.algo_type}</td>
        <td>${a.total_qty.toLocaleString()}</td>
        <td>${a.executed_qty.toLocaleString()}</td>
        <td>${a.schedule_pct}%</td>
        <td>${a.execution_pct}%</td>
        <td>${deviationCell(a.schedule_deviation_pct)}</td>
        <td>${a.status}</td>
        <td>${a.client_name}</td>
        <td>${renderFlags(a.flags)}</td>
        <td>
          <button style="padding:3px 8px;font-size:11px;border-radius:6px;background:var(--warn);color:#fff;border:0;cursor:pointer"
            onclick="runTool('modify_algo',{algo_id:'${a.algo_id}',action:'pause'})">Pause</button>
          <button style="padding:3px 8px;font-size:11px;border-radius:6px;background:var(--down);color:#fff;border:0;cursor:pointer;margin-left:4px"
            onclick="runTool('cancel_algo',{algo_id:'${a.algo_id}',reason:'dashboard cancel'})">Cancel</button>
        </td>
      </tr>
    `).join('');
  }

  // ── actions ────────────────────────────────────────────────────────────────

  async function fetchJson(url, opts) {
    try {
      const r = await fetch(url, opts);
      return r.json();
    } catch (e) {
      document.getElementById('output').textContent = 'API error: ' + e.message;
      return null;
    }
  }

  async function runTool(tool, args) {
    document.getElementById('output').textContent = `Running ${tool}…`;
    switchTab('output');
    const data = await fetchJson('/api/tool', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({tool, arguments: args}),
    });
    if (data) document.getElementById('output').textContent = data.output;
    await refresh();
  }

  async function runStep(stepId, tool, args) {
    await runTool(tool, args);
    const el = document.getElementById('step-' + stepId);
    if (el) el.classList.add('done');
  }

  async function loadScenario(name) {
    document.getElementById('output').textContent = `Loading scenario: ${name}…`;
    switchTab('output');
    const data = await fetchJson('/api/reset', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({scenario: name}),
    });
    if (data) document.getElementById('output').textContent = data.output;
    document.querySelectorAll('.step.done').forEach(el => el.classList.remove('done'));
    await refresh();
  }

  async function resetScenario() {
    await loadScenario(document.getElementById('scenarioSelect').value);
  }

  async function sendOrder() {
    await runTool('send_order', {
      symbol:      document.getElementById('qSymbol').value.trim().toUpperCase(),
      side:        document.getElementById('qSide').value,
      quantity:    parseInt(document.getElementById('qQty').value) || 100,
      order_type:  'limit',
      price:       parseFloat(document.getElementById('qPrice').value) || 0,
      client_name: document.getElementById('qClient').value,
    });
  }

  async function repairSession() {
    await runTool('fix_session_issue', {
      venue:  document.getElementById('repairVenue').value,
      action: document.getElementById('repairAction').value,
    });
  }

  function runCurrentStep(i) {
    if (window._steps && window._steps[i]) window._steps[i].fn();
  }

  async function pauseFirstStuckAlgo() {
    if (!currentStatus || !currentStatus.algos.length) {
      await runTool('check_algo_status', {status:'stuck'});
      return;
    }
    const stuck = currentStatus.algos.find(a => a.status === 'stuck' || a.flags.length > 0);
    if (stuck) {
      await runStep('algopaused', 'modify_algo', {algo_id: stuck.algo_id, action: 'pause'});
    } else {
      document.getElementById('output').textContent = 'No stuck algos found — all algos healthy.';
      switchTab('output');
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
      const names = ['output','sessions','orders','algos','activity'];
      t.classList.toggle('active', names[i] === name);
    });
    document.querySelectorAll('.tab-body').forEach(b => {
      b.classList.toggle('active', b.id === 'tab-' + name);
    });
    if (name === 'activity') renderEvents();
  }

  async function switchMode(m) {
    await fetchJson('/api/mode', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({mode: m}),
    });
    await refresh();
  }

  async function renderEvents() {
    const events = await fetchJson('/api/events');
    if (!events) return;
    document.querySelector('#activityTable tbody').innerHTML = events.map(e => {
      const t = new Date(e.ts).toLocaleTimeString();
      const ok = e.ok ? '<span style="color:var(--ok);font-weight:700">OK</span>' : '<span style="color:var(--down);font-weight:700">ERR</span>';
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${t}</td>
        <td><strong>${e.tool}</strong></td>
        <td>${ok}</td>
        <td style="font-size:12px;color:#555">${e.summary}</td>
      </tr>`;
    }).join('');
  }

  // ── init ───────────────────────────────────────────────────────────────────
  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Proxy handler — forwards all /api/* requests to the API server
# ---------------------------------------------------------------------------

class DashboardHandler(BaseHTTPRequestHandler):

    def _send_html(self, body: bytes) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, path: str, method: str = "GET", body: bytes | None = None) -> None:
        url = f"{API_URL}{path}"
        headers = {"Content-Type": "application/json"} if body else {}
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as exc:
            data = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            error = json.dumps({"error": str(exc), "ok": False}).encode()
            self.send_response(HTTPStatus.BAD_GATEWAY)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error)))
            self.end_headers()
            self.wfile.write(error)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/":
            self._send_html(HTML.encode("utf-8"))
            return
        if self.path.startswith("/api/"):
            self._proxy(self.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/api/"):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            self._proxy(self.path, "POST", body)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: object) -> None:
        return


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="FIX MCP Dashboard")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"FIX MCP Dashboard running at http://127.0.0.1:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

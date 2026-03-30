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
    .btn-vcr  { background: #1e3a5f; color: #fff; }
    .btn-vcr.active { background: var(--blue); outline: 2px solid #7eb3ff; }
    .vcr-bar  { display:flex; gap:4px; align-items:center; padding:0 4px; border-left:1px solid #555; margin-left:4px; }

    /* ── scenario brief banner ── */
    .brief { background: #1d4e89; color: #fff; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; }
    .brief .brief-time { font-family: var(--mono); font-size: 11px; color: #90b8e8; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
    .brief .brief-body { font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; }
    .brief .brief-body strong { color: #ffd580; }

    /* ── improved AI callouts ── */
    .ai-auto     { font-family:Arial,sans-serif;font-size:11px;background:#e8f5e9;border-left:3px solid var(--ok);border-radius:0 6px 6px 0;padding:6px 8px;margin:4px 0 6px;line-height:1.5;color:#1a4a2e; }
    .ai-approval { font-family:Arial,sans-serif;font-size:11px;background:#fff8e1;border-left:3px solid var(--warn);border-radius:0 6px 6px 0;padding:6px 8px;margin:4px 0 6px;line-height:1.5;color:#5c3800; }
    .ai-auto::before     { content:"🤖 Auto: "; font-weight:700; }
    .ai-approval::before { content:"✋ Needs OK: "; font-weight:700; color:var(--warn); }

    /* ── client notification panel ── */
    .notify-panel { background:#fff8e1; border:1px solid var(--warn); border-radius:12px; padding:12px; }
    .notify-panel .notify-title { font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--warn);font-weight:700;margin-bottom:8px; }
    .notify-row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #ffe082; font-family:Arial,sans-serif;font-size:12px; }
    .notify-row:last-child { border-bottom:none; }
    .notify-row .client { font-weight:700;color:var(--ink); }
    .notify-row .detail { color:#666;font-size:11px; }

    /* ── output cards from pre-market check ── */
    .issue-card { border-radius:10px; padding:10px 12px; margin-bottom:8px; font-family:Arial,sans-serif;font-size:12px;line-height:1.5; }
    .issue-critical { background:#fff0f0; border-left:4px solid var(--down); }
    .issue-warning  { background:#fffbf0; border-left:4px solid var(--warn); }
    .issue-ok       { background:#f0fff8; border-left:4px solid var(--ok); }
    .issue-card strong { display:block; font-size:13px; margin-bottom:3px; }

    /* ── playbook steps in main area ── */
    .playbook { display:flex; flex-direction:column; gap:10px; }
    .pb-step  { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
    .pb-step.done  { border-color:var(--ok); background:#f0fff8; }
    .pb-step .pb-num  { font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#999;margin-bottom:4px; }
    .pb-step h5 { margin:0 0 4px;font-size:14px;font-family:Georgia,serif; }
    .pb-step .pb-desc { margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;color:#555;line-height:1.5; }
    .pb-output { background:#1a1a2e;color:#90ee90;font-family:var(--mono);font-size:12px;line-height:1.5;padding:14px 16px;border-radius:12px;white-space:pre-wrap;word-break:break-word;min-height:80px; }
    .pb-output.error { color:#ff8080; }
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
    <div class="vcr-bar">
      <span style="font-family:Arial;font-size:11px;color:#aaa;letter-spacing:1px;text-transform:uppercase">Sim</span>
      <button id="vcrPause" class="btn-vcr" onclick="togglePause()" style="padding:6px 10px;font-size:12px">⏸ Pause</button>
      <button id="vcr1x"  class="btn-vcr" onclick="setSimSpeed(1)"  style="padding:6px 10px;font-size:12px">1x</button>
      <button id="vcr10x" class="btn-vcr active" onclick="setSimSpeed(10)" style="padding:6px 10px;font-size:12px">10x</button>
      <button id="vcr20x" class="btn-vcr" onclick="setSimSpeed(20)" style="padding:6px 10px;font-size:12px">20x</button>
      <button id="vcr60x" class="btn-vcr" onclick="setSimSpeed(60)" style="padding:6px 10px;font-size:12px">60x</button>
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
      <div class="section-label">Quick Tools</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <button class="btn-primary" onclick="runTool('run_premarket_check',{})">Pre-Market</button>
        <button class="btn-primary" onclick="runTool('check_fix_sessions',{})">Sessions</button>
        <button class="btn-primary" onclick="runTool('check_algo_status',{})">Algos</button>
        <button class="btn-neutral" onclick="switchTab('activity')">Activity Log</button>
      </div>

      <div id="notifyPanel" style="display:none;margin-top:10px">
        <div class="divider" style="margin-bottom:10px"></div>
        <div class="notify-panel">
          <div class="notify-title">📞 Client Notifications Required</div>
          <div id="notifyRows"></div>
        </div>
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
        <div class="tab active" onclick="switchTab('playbook')">▶ Playbook</div>
        <div class="tab" onclick="switchTab('sessions')">Sessions</div>
        <div class="tab" onclick="switchTab('orders')">Orders</div>
        <div class="tab" onclick="switchTab('algos')">Algos</div>
        <div class="tab" onclick="switchTab('activity')">Activity</div>
      </div>

      <div class="tab-body active" id="tab-playbook">
        <div id="scenarioBrief"></div>
        <div class="playbook" id="workflowSteps"></div>
        <div class="pb-output" id="output">Run a step above to see AI output here.</div>
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
  let simState = {speed: 10, paused: false};

  // ── scenario situation briefings ──────────────────────────────────────────
  const SCENARIO_CONTEXT = {
    morning_triage:       { time:'07:00 ET', headline:'Pre-Market Triage', body:'<strong>ARCA is down</strong> with a sequence gap. <strong>ACME rebrand → ACMX</strong> affects 23 open orders. <strong>ZEPH IPO</strong> has no reference data — 2 orders stuck. 3 additional orders blocked. You have 90 minutes before the 09:30 open.' },
    bats_startup_0200:    { time:'02:05 ET', headline:'BATS Overnight Startup Failure', body:'<strong>BATS sent SequenceReset with NewSeqNo=1</strong> but our OMS expects seq 2,450. This breaks all GTC orders resting at BATS. Institutional DMA opens at 04:00 — you have 115 minutes.' },
    predawn_adrs_0430:    { time:'04:35 ET', headline:'Shell ADR Rebrand + ARCA Latency', body:'<strong>RDSA officially renamed to SHEL</strong> effective today. Any order still using RDSA will be rejected at market open. <strong>ARCA latency is 220ms</strong> — a route flap on the Mahwah co-lo link. Pre-market opens in 25 min.' },
    preopen_auction_0900: { time:'09:02 ET', headline:'Opening Auction Risk', body:'<strong>SPY has an MOO order imbalance</strong> — buy-side heavy. <strong>IEX feed is stale</strong> — last quote 4 minutes ago. Opening auction locks at 09:28. You have 26 minutes to validate and either cancel or accept the risk.' },
    open_volatility_0930: { time:'09:35 ET', headline:'Market Open Volatility Event', body:'<strong>GME triggered a LULD circuit breaker</strong> — all GME orders are halted. <strong>BATS reporting 3.2% packet loss</strong> — potential for delayed ACKs and phantom fills. 14 orders are at immediate risk worth ~$2.3M.' },
    venue_degradation_1030:{ time:'10:32 ET', headline:'NYSE Mahwah Route Flap', body:'<strong>NYSE latency spiked to 180ms</strong> — incident #44827, Mahwah co-lo route flap. <strong>12 orders worth $4.1M</strong> have venue_degraded + seq_backlog flags. Some are listing-venue-required and cannot be rerouted.' },
    ssr_and_split_1130:   { time:'11:34 ET', headline:'SSR + Stock Split Collision', body:'<strong>RIDE hit SSR trigger</strong> — short-sell orders must be placed at or above NBBO. <strong>AAPL 4:1 split takes effect in 26 minutes.</strong> Any open AAPL stop/limit orders with pre-split prices will be invalid at 12:00.' },
    iex_recovery_1400:    { time:'14:03 ET', headline:'IEX Session Recovery', body:'<strong>IEX is back after a 1-hour outage.</strong> Sequence gap: msgs 8938–8940 are missing. Orders were rerouted to BATS during the outage. <strong>D-Limit orders must return to IEX</strong> — they lose price improvement on other venues.' },
    eod_moc_1530:         { time:'15:31 ET', headline:'End-of-Day MOC Crisis', body:'<strong>ARCA MOC cutoff already missed</strong> (15:28 deadline passed). <strong>NYSE MOC cutoff at 15:45 — 14 minutes away.</strong> Maple Capital has a 500K AAPL MOC worth ~$107M flagged for regulatory review. DAY orders purge at 16:00.' },
    afterhours_dark_1630: { time:'16:32 ET', headline:'After-Hours Dark Pool Failure', body:'<strong>NYSE and ARCA have logged out</strong> (normal). <strong>Liquidnet went offline</strong> (SessionStatus=8 — abnormal). An NVDA block order worth ~$18M is orphaned. OMS day-order cleanup job failed — uncanceled DAY orders remain open.' },
    twap_slippage_1000:   { time:'10:05 ET', headline:'TWAP Slippage Alert', body:'<strong>NVDA TWAP is 5.2 percentage points behind schedule</strong> — BATS degradation at 85ms is rejecting child slices. <strong>GME TWAP halted mid-execution</strong> by LULD halt. Without intervention, NVDA will finish significantly short of target.' },
    vwap_vol_spike_1130:  { time:'11:35 ET', headline:'VWAP Over-Participation', body:'<strong>MSFT VWAP is participating at 15% vs 10% cap</strong> — vol spike widened spreads and triggered aggressive slice sizing. <strong>AMD POV also over-participating at 15% vs 8% limit.</strong> Both algos are creating visible market impact — client exposure.' },
    is_dark_failure_1415: { time:'14:15 ET', headline:'IS Shortfall + Dark Pool Freeze', body:'<strong>TSLA Implementation Shortfall algo is 108bps over arrival price</strong> — avg fill 251.20 vs arrival 248.50. Client SLA breach at 50bps. <strong>AMZN dark aggregator has zero fills</strong> — Liquidnet and IEX dark are both rejecting. Dark venues are frozen.' },
  };

  // ── workflow definitions — one step set per scenario ──────────────────────
  const SCENARIO_STEPS = {

    morning_triage: [
      { id:'s1', label:'1. Pre-Market Check',   desc:'Full triage: sessions, corp actions, stuck orders, SLA timers.', ai:'AI scans all 6 venues, flags ARCA seq gap, ACME corp action, ZEPH IPO miss, and 3 stuck orders. In Agent mode this runs automatically at 07:00 ET.', cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check Sessions',      desc:'Inspect sequence numbers. ARCA is down with a seq gap.', ai:'AI identifies ARCA LastSentSeq=1042 vs expected 1043. Recommends ResendRequest (35=2). Human approval required before sending.', cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{}) },
      { id:'s3', label:'3. Repair ARCA',         desc:'Send ResendRequest (35=2) to recover ARCA sequence gap and release stuck orders.', ai:'AI sends 35=2 to ARCA, waits for SequenceReset(GapFill) confirmation, then auto-releases 7 stuck orders. ⚠ Notional >$1M — requires human sign-off in Mixed mode.', cls:'btn-danger', fn: () => runStep('s3','fix_session_issue',{venue:'ARCA',action:'resend_request'}) },
      { id:'s4', label:'4. Query Stuck Orders',  desc:'Find orders blocked at ARCA and by unknown symbols.', ai:'AI surfaces 7 ARCA-blocked orders + 2 ZEPH IPO orders. Flags unknown_symbol and venue_gap reasons. No action taken — presents findings for human review.', cls:'btn-primary', fn: () => runStep('s4','query_orders',{status:'stuck'}) },
      { id:'s5', label:'5. Check ACME Ticker',   desc:'Confirm ACME→ACMX corporate action affects 23 open orders.', ai:'AI confirms rebrand effective today, counts 23 open ACME orders. Confirms corp action is pending and prepares update_ticker for the next step.', approval:false, cls:'btn-primary', fn: () => runStep('s5','check_ticker',{symbol:'ACME'}) },
      { id:'s5b', label:'5b. Apply ACME→ACMX',   desc:'Rename ACME to ACMX and bulk-update all 23 open orders — this releases the SLA clock on every affected order.', ai:'Calls update_ticker(ACME→ACMX). Renames symbol in reference store and patches all 23 open orders. SLA timers restart from now on each order. ⚠ Stop orders (025, 026) flagged for manual price review after rename — two clients to notify.', approval:true, cls:'btn-danger', fn: () => runStep('s5b','update_ticker',{old_symbol:'ACME',new_symbol:'ACMX',reason:'corporate_action'}) },
      { id:'s6', label:'6. Load ZEPH (IPO)',      desc:'Add ZEPH to reference store and release 2 pending IPO orders.', ai:'AI loads ZEPH (CUSIP 98765X101, NYSE listing) and immediately unblocks 2 IPO-day orders. Safe to auto-execute in Agent mode — no notional threshold breach.', approval:false, cls:'btn-ok', fn: () => runStep('s6','load_ticker',{symbol:'ZEPH',cusip:'98765X101',name:'Zephyr Technologies Inc',listing_exchange:'NYSE'}) },
      { id:'s7', label:'7. Validate All Orders', desc:'Pre-flight check all open orders before the 09:30 open.', ai:'AI runs pre-flight across all open orders: checks price bands, duplicate ClOrdIDs, venue health, and SLA timers. Produces a pass/fail report. Any remaining SLA-breached orders surface as "client notification required" in the sidebar.', approval:false, cls:'btn-primary', fn: () => runStep('s7','validate_orders',{status:'new'}) },
    ],

    bats_startup_0200: [
      { id:'s1', label:'1. Check Sessions',       desc:'BATS sent SequenceReset NewSeqNo=1 — peer OMS expects 2,450. All BATS sessions flagged with unexpected_reset.', ai:'Reads all 6 session states, pinpoints BATS mismatch, calculates the 2,449-message delta. Surfaces the gap without taking action.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Reset BATS Sequence',  desc:'Send SequenceReset (35=4) PossDupFlag to resync BATS seq counter to 2,450.', ai:'Sends 35=4 with GapFillFlag=N and NewSeqNo=2450. Waits for BATS ACK. If not confirmed within 30s, escalates to human.', approval:true, cls:'btn-danger', fn: () => runStep('s2','fix_session_issue',{venue:'BATS',action:'reset_sequence'}) },
      { id:'s3', label:'3. Query Stuck Orders',   desc:'Find GTC orders at BATS that were blocked while the session was broken.', ai:'Queries all orders with venue=BATS and status=stuck. Lists ClOrdIDs, notionals, and how long each has been blocked. Auto-flags any >$500K.', approval:false, cls:'btn-primary', fn: () => runStep('s3','query_orders',{status:'stuck'}) },
      { id:'s4', label:'4. Load BITO Symbol',     desc:'ProShares Bitcoin ETF BITO has no reference data — 2 IPO orders are blocked with unknown_symbol.', ai:'Loads CUSIP BITO00001 to the reference store and immediately unblocks the 2 BITO orders. Low-risk autonomous action — no large notional.', approval:false, cls:'btn-ok', fn: () => runStep('s4','load_ticker',{symbol:'BITO',cusip:'BITO00001',name:'ProShares Bitcoin ETF',listing_exchange:'NYSE'}) },
      { id:'s5', label:'5. Re-Check BATS',        desc:'Confirm BATS session health after the sequence reset.', ai:'Re-reads BATS session state: checks last_sent_seq, expected_recv_seq gap, and latency. Prints a clean/broken verdict with supporting data.', approval:false, cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'BATS'}) },
      { id:'s6', label:'6. Validate Overnight',   desc:'Validate all GTC orders before institutional DMA opens at 04:00 ET.', ai:'Runs full pre-flight on every open order: price bands, duplicate ClOrdIDs, venue health match. Any order still stuck after BATS fix gets flagged for manual review.', approval:false, cls:'btn-primary', fn: () => runStep('s6','validate_orders',{}) },
    ],

    predawn_adrs_0430: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'Full triage: RDSA→SHEL rename detected, ARCA latency 220ms, affected order count.', ai:'Scans all venues and tickers. Surfaces RDSA pending rename, counts affected orders, and flags ARCA degraded. Gives you the complete picture before you act.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check RDSA Ticker',    desc:'Confirm corporate action details: effective date, new symbol SHEL, and how many open orders are affected.', ai:'Reads ticker reference for RDSA, confirms rename is effective today, and counts all open orders with symbol=RDSA. Lists order IDs for review.', approval:false, cls:'btn-primary', fn: () => runStep('s2','check_ticker',{symbol:'RDSA'}) },
      { id:'s3', label:'3. Apply RDSA→SHEL',      desc:'Rename ticker and bulk-update all open RDSA orders to SHEL before markets open.', ai:'Calls update_ticker to rename RDSA→SHEL, then bulk-patches all open orders. Corporate action on a live symbol — requires human sign-off even in Agent mode.', approval:true, cls:'btn-danger', fn: () => runStep('s3','update_ticker',{old_symbol:'RDSA',new_symbol:'SHEL',reason:'corporate_action'}) },
      { id:'s4', label:'4. Check ARCA Session',   desc:'ARCA latency is 220ms — well above the 50ms warning threshold. Assess degradation level.', ai:'Reads ARCA FIX session stats. At 220ms this is DEGRADED (not down). AI notes that orders can still route but with higher rejection risk. Recommends but does not act.', approval:false, cls:'btn-primary', fn: () => runStep('s4','check_fix_sessions',{venue:'ARCA'}) },
      { id:'s5', label:'5. Query ARCA Orders',    desc:'Find all orders routed to ARCA that are at risk from the latency issue.', ai:'Lists all open orders with venue=ARCA, annotates each with estimated latency risk. In Agent mode, flags the $10M+ orders for human review and leaves smaller ones alone.', approval:false, cls:'btn-primary', fn: () => runStep('s5','query_orders',{venue:'ARCA'}) },
      { id:'s6', label:'6. Validate ADR Orders',  desc:'Post-rename pre-flight: ensure all SHEL orders have valid symbol, price, and venue after the bulk update.', ai:'Validates all orders with symbol=SHEL. Checks for price discrepancies from the rename, confirms venue assignments are still valid. Clean report before pre-market opens.', approval:false, cls:'btn-primary', fn: () => runStep('s6','validate_orders',{symbol:'SHEL'}) },
    ],

    preopen_auction_0900: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'09:02 ET full triage: SPY MOO imbalance and IEX feed staleness detected.', ai:'Flags SPY imbalance (buy-heavy), surfaces stale IEX feed (4min), and counts all MOO orders. In Agent mode this triage runs automatically at 08:00 ET.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check IEX Session',    desc:'IEX data feed has been silent for 4 minutes — could be a connectivity issue or feed suspension.', ai:'Reads IEX session state and last heartbeat timestamp. If feed is stale >3 min, AI recommends reconnect. Will not reconnect automatically — feed suspension could be intentional.', approval:false, cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{venue:'IEX'}) },
      { id:'s3', label:'3. Query MOO Orders',     desc:'Find all Market-on-Open SPY orders to assess your exposure to the imbalance.', ai:'Lists all open SPY orders with order_type=market or time_in_force=OPG. Calculates total notional and directional exposure. Flags any that would worsen the imbalance.', approval:false, cls:'btn-primary', fn: () => runStep('s3','query_orders',{symbol:'SPY'}) },
      { id:'s4', label:'4. Validate Open Orders', desc:'Pre-flight all open orders — catch stale prices, IEX-dependent orders, before the 09:28 auction lock.', ai:'Validates every open order. Orders using IEX quotes get a stale_price flag. Orders with IEX as primary venue get a venue_risk warning. Output lists all that need attention before 09:28.', approval:false, cls:'btn-primary', fn: () => runStep('s4','validate_orders',{}) },
      { id:'s5', label:'5. Reconnect IEX',        desc:'Trigger a FIX Logon (35=A) to IEX to re-establish the data feed.', ai:'Sends Logon to IEX. If session comes up clean with current seq, unblocks all IEX-dependent orders automatically. If seq gap detected, pauses and escalates to human before releasing orders.', approval:true, cls:'btn-danger', fn: () => runStep('s5','fix_session_issue',{venue:'IEX',action:'reconnect'}) },
    ],

    open_volatility_0930: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'Market just opened. GME LULD halt active. BATS packet loss 3.2% detected.', ai:'Scans all venues and orders. Flags GME halt (regulatory), BATS degradation, and lists all at-risk orders. In Agent mode this triggers an immediate alert to the desk.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Find GME Orders',      desc:'Identify every GME order that is now frozen by the LULD circuit breaker.', ai:'Queries all orders with symbol=GME. Lists order IDs, notionals, side, and how long halted. AI does NOT cancel — LULD halts are regulatory, cancels are not guaranteed to succeed during halt.', approval:false, cls:'btn-danger', fn: () => runStep('s2','query_orders',{symbol:'GME'}) },
      { id:'s3', label:'3. Check BATS Session',   desc:'BATS packet loss at 3.2% is above the 1% warning threshold — assess the degradation.', ai:'Reads BATS FIX session metrics. 3.2% loss means ~1-in-31 messages may be delayed or require retransmit. AI calculates expected ACK delay and flags orders near SLA boundaries.', approval:false, cls:'btn-primary', fn: () => runStep('s3','check_fix_sessions',{venue:'BATS'}) },
      { id:'s4', label:'4. Query BATS Orders',    desc:'Find stuck orders at BATS — these may have sent but not yet received an ACK due to packet loss.', ai:'Lists all BATS orders with status=stuck. Cross-references against known sent timestamps to identify potential phantom fills. Flags duplicates for human review.', approval:false, cls:'btn-primary', fn: () => runStep('s4','query_orders',{venue:'BATS',status:'stuck'}) },
      { id:'s5', label:'5. Validate Orders',      desc:'Check all open orders for LULD price band violations and duplicate ClOrdIDs before sending any new orders.', ai:'Validates every open order. GME orders get luld_violation check. BATS orders get duplicate_clordid check. Result: a clear list of what is safe to leave vs. what needs immediate action.', approval:false, cls:'btn-primary', fn: () => runStep('s5','validate_orders',{}) },
    ],

    venue_degradation_1030: [
      { id:'s1', label:'1. Check Sessions',       desc:'NYSE latency at 180ms — Mahwah co-lo route flap incident #44827.', ai:'Reads all session states. Confirms NYSE at 180ms (DEGRADED threshold: 100ms). Identifies seq_backlog building. Shows how many messages are buffered at NYSE awaiting ACK.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Find Stuck Orders',    desc:'12 orders at NYSE worth $4.1M have venue_degraded and seq_backlog flags.', ai:'Queries NYSE stuck orders, sorts by notional descending. Flags which ones have listing_venue_required=true (cannot reroute). Gives you a reroutable vs. stuck-here split.', approval:false, cls:'btn-primary', fn: () => runStep('s2','query_orders',{venue:'NYSE',status:'stuck'}) },
      { id:'s3', label:'3. Validate NYSE Orders', desc:'Pre-validation: identify which NYSE orders are listing-venue-required before attempting any fix.', ai:'Validates all NYSE orders. Marks each as reroutable or listing_required. This prevents the AI from accidentally rerouting a NYSE-listed stock that can only fill on its listing venue.', approval:false, cls:'btn-primary', fn: () => runStep('s3','validate_orders',{venue:'NYSE'}) },
      { id:'s4', label:'4. Repair NYSE',          desc:'Send ResendRequest (35=2) to clear the sequence backlog from the route flap.', ai:'Sends 35=2 to NYSE requesting retransmit of backed-up messages. Waits for SequenceReset(GapFill) confirmation. ⚠ $4.1M exposure — mixed mode requires human sign-off before sending.', approval:true, cls:'btn-danger', fn: () => runStep('s4','fix_session_issue',{venue:'NYSE',action:'resend_request'}) },
      { id:'s5', label:'5. Re-Check Status',      desc:'Confirm NYSE latency is returning to normal and the seq backlog is clearing.', ai:'Re-reads NYSE session stats and compares to pre-flap baseline. Prints latency trend (improving/stable/worsening). Auto-releases any orders that unblocked after the repair.', approval:false, cls:'btn-primary', fn: () => runStep('s5','run_premarket_check',{}) },
    ],

    ssr_and_split_1130: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'11:34 ET: RIDE SSR triggered. AAPL 4:1 split executes in 26 minutes.', ai:'Surfaces SSR flag on RIDE and the upcoming AAPL split. Lists all RIDE short orders and all AAPL orders with pre-split prices. Gives you the complete exposure picture.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check RIDE Ticker',    desc:'Confirm SSR is active on RIDE — short-sale orders must be at or above NBBO bid.', ai:'Reads RIDE ticker flags. Confirms ssr_active=true. Lists the NBBO at trigger time. Any SellShort orders below this price are in violation — AI lists them but will not cancel without approval.', approval:false, cls:'btn-primary', fn: () => runStep('s2','check_ticker',{symbol:'RIDE'}) },
      { id:'s3', label:'3. Find RIDE Short Orders', desc:'Identify SellShort orders on RIDE that are priced below NBBO — regulatory violation.', ai:'Queries all RIDE SellShort orders. Compares each price against the SSR reference price. Flags violators with ssr_violation. In Agent mode, auto-cancels orders >$0 below NBBO — needs approval above $500K notional.', approval:true, cls:'btn-danger', fn: () => runStep('s3','query_orders',{symbol:'RIDE'}) },
      { id:'s4', label:'4. Check AAPL Ticker',    desc:'Confirm AAPL 4:1 split ratio and the effective time so you know which orders to adjust.', ai:'Reads AAPL ticker. Confirms ratio 4:1, effective 12:00 ET. Counts open orders with pre-split prices (>$200). Lists them for adjustment. Will not modify — corporate action requires explicit human command.', approval:false, cls:'btn-primary', fn: () => runStep('s4','check_ticker',{symbol:'AAPL'}) },
      { id:'s5', label:'5. Apply AAPL Split',     desc:'Trigger the 4:1 split adjustment — bulk-updates all open AAPL order prices and quantities.', ai:'Calls update_ticker for the split. Bulk-adjusts price ÷4, qty ×4 on all open AAPL orders. ⚠ High-impact bulk operation — requires human confirmation even in Agent mode.', approval:true, cls:'btn-danger', fn: () => runStep('s5','update_ticker',{old_symbol:'AAPL',new_symbol:'AAPL',reason:'corporate_action'}) },
      { id:'s6', label:'6. Validate All',         desc:'Post-split pre-flight: catch any stop orders still using pre-split prices.', ai:'Validates every AAPL order against the new post-split price bands. Any order with price > $220 after the split adjustment is flagged as stale_price. Output shows a clean pass or a list of exceptions.', approval:false, cls:'btn-primary', fn: () => runStep('s6','validate_orders',{symbol:'AAPL'}) },
    ],

    iex_recovery_1400: [
      { id:'s1', label:'1. Check Sessions',       desc:'14:03 ET: IEX is back after 1-hour outage. Sequence gap: msgs 8938–8940 missing.', ai:'Reads IEX session state. Confirms gap of 3 messages (8938, 8939, 8940). Compares IEX vs BATS fill reports during outage window to surface potential missed fills.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_fix_sessions',{}) },
      { id:'s2', label:'2. Repair IEX',           desc:'Send ResendRequest (35=2) to recover the 3-message gap before IEX processes new orders.', ai:'Sends 35=2 for seq 8938–8940. If IEX responds with GapFill (no fills missed), marks gap resolved. If ExecutionReport arrives in gap, checks for duplicate fills vs BATS and alerts human.', approval:true, cls:'btn-danger', fn: () => runStep('s2','fix_session_issue',{venue:'IEX',action:'resend_request'}) },
      { id:'s3', label:'3. Find Rerouted Orders', desc:'Surface orders that were diverted to BATS during the IEX outage (iex_rerouted flag).', ai:'Queries all BATS orders with flag iex_rerouted=true. Lists each with original venue, fill status, and whether it is now safe to cancel the BATS routing since IEX is back.', approval:false, cls:'btn-primary', fn: () => runStep('s3','query_orders',{venue:'BATS'}) },
      { id:'s4', label:'4. Find D-Limit Orders',  desc:'D-Limit orders lose their price-improvement guarantee on BATS — they must return to IEX.', ai:'Queries stuck orders with d_limit flag. These CANNOT stay at BATS — IEX D-Limit is an IEX-only order type. AI identifies them but will not cancel/reroute without approval due to live partial fills.', approval:true, cls:'btn-primary', fn: () => runStep('s4','query_orders',{status:'stuck'}) },
      { id:'s5', label:'5. Validate IEX Orders',  desc:'Final pre-flight: do not move orders with partial fills on NYSE — they have a live leg.', ai:'Validates all post-recovery IEX orders. Orders with partial_fill and venue=NYSE are marked do_not_move. Clean orders get a ready_to_route flag. Report shows move vs. hold decision for each order.', approval:false, cls:'btn-primary', fn: () => runStep('s5','validate_orders',{}) },
    ],

    eod_moc_1530: [
      { id:'s1', label:'1. Pre-Market Check',     desc:'15:31 ET: ARCA MOC cutoff at 15:28 already missed. NYSE MOC cutoff at 15:45 — 14 min away.', ai:'Flags the missed ARCA deadline immediately. Counts all MOC orders, sorts by venue. In Agent mode this check triggers an alert at 15:20 to catch the deadline before it passes.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Find MOC Orders',      desc:'List all Market-on-Close orders — identify those that missed ARCA cutoff and are now stuck.', ai:'Queries all MOC orders. Flags ARCA MOC orders as cutoff_missed — they cannot participate in the close. Separates NYSE MOC orders (still live) from the failed ARCA batch.', approval:false, cls:'btn-danger', fn: () => runStep('s2','query_orders',{status:'stuck'}) },
      { id:'s3', label:'3. Find GTC Orders',      desc:'Identify GTC orders that survive the 16:00 DAY purge and must not be accidentally canceled.', ai:'Queries all open orders and separates GTC from DAY. Builds a preserve list and a purge list. In Agent mode, pre-stages the purge list so the 16:00 cleanup job runs correctly.', approval:false, cls:'btn-primary', fn: () => runStep('s3','query_orders',{}) },
      { id:'s4', label:'4. Validate MOC Orders',  desc:'Maple Capital 500K AAPL MOC has a large_moc_regulatory_review flag — must be reviewed.', ai:'Validates all AAPL MOC orders. The Maple Capital 500K order ($107M notional) has a regulatory flag — it cannot be submitted without compliance sign-off. AI holds it and presents the flag for human decision.', approval:true, cls:'btn-primary', fn: () => runStep('s4','validate_orders',{symbol:'AAPL'}) },
      { id:'s5', label:'5. Check Sessions',       desc:'Confirm NYSE FIX session is active and healthy before the 15:45 MOC cutoff.', ai:'Reads NYSE session state. If healthy, confirms remaining MOC orders can be submitted. If degraded, escalates immediately — NYSE MOC cutoff waits for no one.', approval:false, cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'NYSE'}) },
    ],

    afterhours_dark_1630: [
      { id:'s1', label:'1. After-Hours Check',    desc:'16:32 ET: NYSE and ARCA logged out (normal). Liquidnet offline with SessionStatus=8 (abnormal).', ai:'Distinguishes normal post-close logouts (NYSE, ARCA) from the abnormal Liquidnet failure. SessionStatus=8 means Liquidnet sent an explicit halt — this is not a timeout, it is a deliberate disconnect.', approval:false, cls:'btn-primary', fn: () => runStep('s1','run_premarket_check',{}) },
      { id:'s2', label:'2. Check Sessions',       desc:'Map which venues are in extended hours, which are fully offline, and which failed abnormally.', ai:'Reads all 6 sessions. Categorizes as: closed_normal (NYSE, ARCA), extended_hours (BATS, EDGX), failed_abnormal (Liquidnet). This map drives which orders can still be worked tonight.', approval:false, cls:'btn-primary', fn: () => runStep('s2','check_fix_sessions',{}) },
      { id:'s3', label:'3. Find Dark Pool Orders', desc:'NVDA block order worth ~$18M is orphaned — Liquidnet offline means it has nowhere to fill.', ai:'Queries orders with flag dark_pool_unavailable. The NVDA block is the largest exposure. AI will NOT cancel or reroute — dark block strategy decisions have market impact and require PM approval.', approval:true, cls:'btn-danger', fn: () => runStep('s3','query_orders',{status:'stuck'}) },
      { id:'s4', label:'4. Cancel Uncleaned DAY', desc:'OMS day-order cleanup failed — DAY orders that should have been canceled at 16:00 are still open.', ai:'Queries DAY orders that are still open past 16:00. In Agent mode, auto-cancels DAY orders under $500K notional after 16:05. Holds larger orders for human confirmation — phantom orders can cause overnight risk.', approval:true, cls:'btn-danger', fn: () => runStep('s4','query_orders',{}) },
      { id:'s5', label:'5. Check BATS Extended',  desc:'Confirm BATS extended-hours session (16:00–20:00 ET) is healthy for overnight fills.', ai:'Reads BATS extended-hours session state. Confirms it is ACTIVE and has a clean seq. Any orders eligible for extended trading can be routed here safely.', approval:false, cls:'btn-primary', fn: () => runStep('s5','check_fix_sessions',{venue:'BATS'}) },
      { id:'s6', label:'6. Validate After-Hours', desc:'Final check: confirm only extended-hours eligible orders remain open — no regular-session-only orders.', ai:'Validates all remaining open orders against extended-hours eligibility rules. Regular-session-only orders get extended_hours_ineligible flag. AI lists them for cancellation — human must confirm.', approval:true, cls:'btn-primary', fn: () => runStep('s6','validate_orders',{}) },
    ],

    twap_slippage_1000: [
      { id:'s1', label:'1. Check Algo Status',    desc:'10:05 ET: NVDA TWAP 5.2ppts behind schedule. GME TWAP halted by LULD.', ai:'Reads all active algos. Surfaces NVDA behind schedule and GME halted. In Agent mode an alert fires automatically when schedule deviation exceeds 3ppts. You are already behind that threshold.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect NVDA TWAP',    desc:'Drill into ALGO-20260328-001: which child slices were rejected and why.', ai:'Reads NVDA TWAP detail: 47% executed vs 52% scheduled. Rejected slices all went to BATS (85ms latency). AI calculates that if current pace continues, final shortfall will be ~8.7ppts. Surfaces this projection for human decision.', approval:false, cls:'btn-primary', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-001'}) },
      { id:'s3', label:'3. Pause NVDA TWAP',      desc:'Stop the behind-schedule NVDA TWAP to prevent further slippage while BATS is degraded.', ai:'Pauses the TWAP immediately. No new child slices will fire. ⚠ Client order — pausing a client TWAP requires desk notification. AI pauses and creates an escalation record but expects human to notify the PM.', approval:true, cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-001',action:'pause'}) },
      { id:'s4', label:'4. Check BATS Session',   desc:'BATS at 85ms is the root cause of the NVDA slice rejections — confirm degradation level.', ai:'Reads BATS session stats. 85ms is in the DEGRADED band (50ms warn, 100ms critical). AI confirms this is the root cause of NVDA rejections. Once BATS recovers below 50ms, NVDA TWAP can resume.', approval:false, cls:'btn-primary', fn: () => runStep('s4','check_fix_sessions',{venue:'BATS'}) },
      { id:'s5', label:'5. Find GME Orders',      desc:'Inspect GME TWAP child slices blocked by the LULD circuit breaker.', ai:'Queries all GME orders (TWAP children and parent). Shows halt start time and estimated halt duration. AI notes GME halts typically last 5 minutes — it will automatically re-check and resume if LULD clears.', approval:false, cls:'btn-primary', fn: () => runStep('s5','query_orders',{symbol:'GME'}) },
      { id:'s6', label:'6. Check Algo Status',    desc:'After pausing NVDA, see the full algo book state to plan the rest of the day.', ai:'Re-reads all algos. Shows NVDA as paused, GME as halted, all others healthy. Provides a catch-up schedule: if BATS recovers and NVDA resumes at 10:20, it can finish by 14:30 with a modified pace.', approval:false, cls:'btn-primary', fn: () => runStep('s6','check_algo_status',{}) },
    ],

    vwap_vol_spike_1130: [
      { id:'s1', label:'1. Check Algo Status',    desc:'11:35 ET: MSFT VWAP at 15% participation vs 10% cap. AMD POV also over-limit.', ai:'Reads all algos. Surfaces two over-participation violations. In Agent mode, this detection happens automatically every 30 seconds. An alert was already sent — you are confirming before acting.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect MSFT VWAP',    desc:'ALGO-20260328-003 has flags: over_participation and spread_widened. Check how bad it is.', ai:'Reads MSFT VWAP detail. 15% vs 10% cap — 5ppt breach. Spread widened from 2c to 6c since algo started. AI calculates that current pace has already added ~3bps of market impact cost to the client.', approval:false, cls:'btn-danger', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-003'}) },
      { id:'s3', label:'3. Reduce MSFT POV Rate', desc:'Lower MSFT VWAP participation rate from 15% to 10% to stop the over-participation.', ai:'Updates MSFT VWAP pov_rate to 0.10. Child slice sizing immediately adjusts. ⚠ Modifying a live client algo requires desk notification. AI applies the change and logs the modification with rationale to the audit trail.', approval:true, cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-003',action:'update_pov_rate',new_pov_rate:0.10}) },
      { id:'s4', label:'4. Inspect AMD POV',      desc:'ALGO-20260328-004: AMD is also over-participating at 15% vs 8% limit.', ai:'Reads AMD POV detail. Similar pattern to MSFT — vol spike caused the algo to size up. AMD is less liquid than MSFT so the 7ppt breach has more market impact per dollar. Larger urgency.', approval:false, cls:'btn-primary', fn: () => runStep('s4','check_algo_status',{algo_id:'ALGO-20260328-004'}) },
      { id:'s5', label:'5. Reduce AMD POV Rate',  desc:'Lower AMD POV rate from 15% to 8% to reduce market impact.', ai:'Updates AMD POV pov_rate to 0.08. ⚠ Same approval requirement as MSFT change. AI logs both modifications together as a single event for compliance audit trail purposes.', approval:true, cls:'btn-danger', fn: () => runStep('s5','modify_algo',{algo_id:'ALGO-20260328-004',action:'update_pov_rate',new_pov_rate:0.08}) },
      { id:'s6', label:'6. Check Algo Status',    desc:'Confirm both algos are back within their participation limits after the rate reductions.', ai:'Re-reads both algos. Confirms MSFT at ≤10% and AMD at ≤8%. Provides updated projected completion times at the new rates. If either is still breaching, alerts immediately.', approval:false, cls:'btn-primary', fn: () => runStep('s6','check_algo_status',{}) },
    ],

    is_dark_failure_1415: [
      { id:'s1', label:'1. Check Algo Status',    desc:'14:15 ET: TSLA IS shortfall 108bps. AMZN dark aggregator has zero fills.', ai:'Reads all algos. TSLA IS at 108bps over arrival (SLA breach threshold: 50bps). AMZN dark at 0% fill rate since 13:45. Both are in urgent state — AI fired alerts 30 min ago at the 50bps breach.', approval:false, cls:'btn-primary', fn: () => runStep('s1','check_algo_status',{}) },
      { id:'s2', label:'2. Inspect TSLA IS',      desc:'ALGO-20260328-005: avg fill 251.20 vs arrival 248.50 — 108bps shortfall, well above the 50bps SLA limit.', ai:'Reads TSLA IS detail. 108bps shortfall = ~$2.7M in unexpected cost on a $100M order. Identifies root cause: TSLA spread widened post-earnings whisper, causing IS to pay up to fill. This is a client call — pause first, explain second.', approval:false, cls:'btn-danger', fn: () => runStep('s2','check_algo_status',{algo_id:'ALGO-20260328-005'}) },
      { id:'s3', label:'3. Pause TSLA IS',        desc:'IS shortfall >50bps is a client SLA breach — pause the algo before it worsens.', ai:'Pauses TSLA IS immediately. ⚠ SLA breach with a client — this is a billable event. AI pauses, records the shortfall in the audit trail, and creates a compliance escalation. Human must notify the client PM before resuming.', approval:true, cls:'btn-danger', fn: () => runStep('s3','modify_algo',{algo_id:'ALGO-20260328-005',action:'pause'}) },
      { id:'s4', label:'4. Inspect AMZN Dark',    desc:'ALGO-20260328-006: no_dark_fill — both Liquidnet and IEX dark are rejecting AMZN blocks.', ai:'Reads AMZN dark aggregator detail. Zero fills since 13:45 — 30 minutes. Both Liquidnet and IEX dark are rejecting with liquidity_unavailable. Dark venues have dried up for AMZN block size ($50M). Cannot fix with reconnect — market structural issue.', approval:false, cls:'btn-primary', fn: () => runStep('s4','check_algo_status',{algo_id:'ALGO-20260328-006'}) },
      { id:'s5', label:'5. Cancel AMZN Dark',     desc:'Dark venues are structurally illiquid for this size — cancel dark algo and switch to lit TWAP.', ai:'Cancels AMZN dark aggregator. ⚠ Switching strategies mid-order is a significant decision — the lit TWAP will create visible market footprint. AI cancels after human confirmation and pre-stages a TWAP replacement order for immediate launch.', approval:true, cls:'btn-danger', fn: () => runStep('s5','cancel_algo',{algo_id:'ALGO-20260328-006',reason:'dark venues illiquid, switching to lit TWAP'}) },
      { id:'s6', label:'6. Check Sessions',       desc:'Verify IEX dark sub-component — is it a venue issue or just an AMZN liquidity issue?', ai:'Reads IEX FIX session and dark venue sub-component. If IEX dark session is healthy but rejecting, the issue is AMZN-specific liquidity. If IEX dark session is down, it may affect other symbols too — broader impact assessment.', approval:false, cls:'btn-primary', fn: () => runStep('s6','check_fix_sessions',{venue:'IEX'}) },
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
    const [data, sim] = await Promise.all([
      fetchJson('/api/detail'),
      fetchJson('/api/simulation'),
    ]);
    if (!data) return;
    currentStatus = data;
    if (sim) { simState = sim; _updateVCR(); }

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
    const simChip  = simState.paused ? chip('⏸ PAUSED', 'warn') : chip(`▶ ${simState.speed}x`, 'neutral');
    document.getElementById('statusbar').innerHTML = `
      <div class="stat">${sessChip}<span class="label">Sessions (${data.sessions.filter(s=>s.status==='active').length}/${data.sessions.length})</span></div>
      <div class="stat">${ordChip}<span class="label">Orders (${data.orders_open} open)</span></div>
      <div class="stat">${algoChip}<span class="label">Algos</span></div>
      <div class="stat">${modeChip}<span class="label">Mode</span></div>
      <div class="stat">${simChip}<span class="label">Sim Speed</span></div>
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

    // scenario brief banner
    const ctx = SCENARIO_CONTEXT[data.scenario];
    document.getElementById('scenarioBrief').innerHTML = ctx ? `
      <div class="brief">
        <div class="brief-time">⏱ ${ctx.time} &nbsp;·&nbsp; ${ctx.headline}</div>
        <div class="brief-body">${ctx.body}</div>
      </div>` : '';

    // workflow steps (per-scenario) — store globally, reference by index to avoid quoting issues
    window._steps = SCENARIO_STEPS[data.scenario] || DEFAULT_STEPS;
    document.getElementById('workflowSteps').innerHTML = window._steps.map((s, i) => {
      const aiBlock = s.ai
        ? `<div class="${s.approval ? 'ai-approval' : 'ai-auto'}">${s.ai}</div>`
        : '';
      return `
      <div class="pb-step" id="step-${s.id}">
        <div class="pb-num">Step ${i+1}</div>
        <h5>${s.label.replace(/^\d+\.\s*/,'')}</h5>
        <div class="pb-desc">${s.desc}</div>
        ${aiBlock}
        <button class="${s.cls}" onclick="runCurrentStep(${i})" style="margin-top:4px">Run →</button>
      </div>`;
    }).join('');

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

    // notification panel — naturally-expired SLA breaches (not stuck, so tools can't fix them)
    const breachedOrders = (data.orders || []).filter(o => o.sla_breached && o.status !== 'stuck');
    const notifyPanel = document.getElementById('notifyPanel');
    const notifyRows  = document.getElementById('notifyRows');
    if (breachedOrders.length > 0) {
      notifyRows.innerHTML = breachedOrders.map(o => `
        <div class="notify-row">
          <div>
            <div class="client">${o.client_name}</div>
            <div class="detail">${o.symbol} ${o.side.toUpperCase()} ${o.quantity.toLocaleString()} @ ${o.venue}</div>
          </div>
          <div class="detail" style="text-align:right">SLA ${o.sla_minutes}min<br><span style="color:var(--down);font-weight:700">EXPIRED</span></div>
        </div>
      `).join('');
      notifyPanel.style.display = 'block';
    } else {
      notifyPanel.style.display = 'none';
    }
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

  function _parsePremarketOutput(text) {
    // Parse structured pre-market check output into issue cards.
    // Sections: CRITICAL / WARNING / INFO / SUMMARY
    const lines = text.split('\n');
    let html = '';
    let section = null; // 'critical' | 'warning' | 'info' | 'summary' | null
    const headerRe = /^(CRITICAL|WARNING|INFO)\s*\((\d+)\s*issues?\)/i;
    const summaryRe = /^===\s*SUMMARY\s*===/i;
    const dividerRe = /^[━─=]{10,}/;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const hm = line.match(headerRe);
      if (hm) {
        section = hm[1].toLowerCase();
        const count = parseInt(hm[2], 10);
        const cls   = section === 'critical' ? 'down' : section === 'warning' ? 'warn' : 'ok';
        const icon  = section === 'critical' ? '🔴' : section === 'warning' ? '🟡' : 'ℹ️';
        html += `<div style="font-family:Arial;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--${cls});font-weight:700;margin:14px 0 4px">${icon} ${hm[1]} — ${count} issue${count !== 1 ? 's' : ''}</div>`;
        continue;
      }
      if (summaryRe.test(line)) { section = 'summary'; continue; }
      if (dividerRe.test(line)) continue;
      // title line (=== PRE-MARKET CHECK … ===)
      if (/^===.*===$/.test(line)) {
        html += `<div style="font-family:var(--mono);font-size:11px;color:#90b8e8;margin-bottom:8px">${line}</div>`;
        continue;
      }

      if (section === 'critical') {
        html += `<div class="issue-card issue-critical"><strong>${line}</strong></div>`;
      } else if (section === 'warning') {
        html += `<div class="issue-card issue-warning"><strong>${line}</strong></div>`;
      } else if (section === 'info') {
        html += `<div class="issue-card issue-ok">${line.replace(/^-\s*/,'')}</div>`;
      } else if (section === 'summary') {
        html += `<div style="font-family:Arial;font-size:12px;margin-top:4px;color:#555">${line}</div>`;
      } else {
        html += `<div style="font-family:Arial;font-size:12px;color:#555">${line}</div>`;
      }
    }
    return html || `<pre>${text}</pre>`;
  }

  async function runTool(tool, args) {
    const out = document.getElementById('output');
    out.textContent = `⏳ Running ${tool}…`;
    out.className = 'pb-output';
    switchTab('playbook');
    out.scrollIntoView({behavior:'smooth', block:'nearest'});
    const data = await fetchJson('/api/tool', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({tool, arguments: args}),
    });
    if (data) {
      if (tool === 'run_premarket_check' && data.ok) {
        out.className = 'pb-output';
        out.style.background = 'var(--panel)';
        out.style.color = 'var(--ink)';
        out.innerHTML = _parsePremarketOutput(data.output);
      } else {
        out.textContent = data.output;
        out.className = data.ok ? 'pb-output' : 'pb-output error';
        out.style.background = '';
        out.style.color = '';
      }
    }
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
      const names = ['playbook','sessions','orders','algos','activity'];
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

  async function setSimSpeed(s) {
    const data = await fetchJson('/api/simulation', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({speed: s, paused: false}),
    });
    if (data) { simState = data; _updateVCR(); }
  }

  async function togglePause() {
    const data = await fetchJson('/api/simulation', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({paused: !simState.paused}),
    });
    if (data) { simState = data; _updateVCR(); }
  }

  function _updateVCR() {
    const speeds = [1, 10, 20, 60];
    speeds.forEach(s => {
      const btn = document.getElementById('vcr' + s + 'x');
      if (btn) btn.classList.toggle('active', !simState.paused && simState.speed === s);
    });
    const pauseBtn = document.getElementById('vcrPause');
    if (pauseBtn) {
      pauseBtn.textContent = simState.paused ? '▶ Resume' : '⏸ Pause';
      pauseBtn.classList.toggle('active', simState.paused);
    }
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

"""
FIX MCP Live Dashboard — Real-Time Control Room.

Self-contained server: serves the dashboard HTML and bridges Redis pub/sub
events to browser WebSockets. Open it and watch sessions flip red→green,
orders release one by one, alerts scroll with severity colors.

Usage:
    # Standalone (uses in-memory event bus if no Redis)
    python -m fix_mcp.live_dashboard --port 8787

    # With Redis pub/sub
    python -m fix_mcp.live_dashboard --port 8787 --redis redis://localhost:6379

    # With full stack
    python -m fix_mcp.live_dashboard --port 8787 --redis redis://localhost:6379 --api http://localhost:8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dashboard HTML — single-file, no dependencies, no build step
# ---------------------------------------------------------------------------
DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FIX MCP — Live Control Room</title>
<style>
  :root {
    --bg: #0a0e17;
    --bg-card: #111827;
    --bg-card-hover: #1a2332;
    --border: #1e293b;
    --text: #e2e8f0;
    --text-dim: #64748b;
    --green: #22c55e;
    --green-bg: rgba(34,197,94,0.1);
    --red: #ef4444;
    --red-bg: rgba(239,68,68,0.1);
    --yellow: #eab308;
    --yellow-bg: rgba(234,179,8,0.1);
    --blue: #3b82f6;
    --blue-bg: rgba(59,130,246,0.1);
    --cyan: #06b6d4;
    --purple: #a855f7;
    --font: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    line-height: 1.5;
    overflow-x: hidden;
  }

  /* --- Header --- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
  }
  .header h1 {
    font-size: 15px;
    font-weight: 600;
    color: var(--cyan);
    letter-spacing: 0.5px;
  }
  .header .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    transition: background 0.3s;
  }
  .status-dot.connected { background: var(--green); box-shadow: 0 0 6px var(--green); }

  /* --- Grid Layout --- */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: 1px;
    background: var(--border);
    height: calc(100vh - 47px);
  }
  .panel {
    background: var(--bg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    padding: 10px 16px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel-header .count {
    background: var(--blue-bg);
    color: var(--blue);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  /* --- Session Cards --- */
  .sessions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
    padding: 8px;
  }
  .session-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    transition: all 0.4s ease;
  }
  .session-card.connected {
    border-color: var(--green);
    box-shadow: 0 0 12px rgba(34,197,94,0.15);
  }
  .session-card.disconnected {
    border-color: var(--red);
    box-shadow: 0 0 12px rgba(239,68,68,0.15);
    animation: pulse-red 2s infinite;
  }
  .session-card.degraded {
    border-color: var(--yellow);
    box-shadow: 0 0 12px rgba(234,179,8,0.15);
  }
  @keyframes pulse-red {
    0%, 100% { box-shadow: 0 0 12px rgba(239,68,68,0.15); }
    50% { box-shadow: 0 0 20px rgba(239,68,68,0.3); }
  }
  .session-card .venue {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .session-card .venue .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    transition: background 0.4s;
  }
  .session-card.connected .dot { background: var(--green); }
  .session-card.disconnected .dot { background: var(--red); }
  .session-card.degraded .dot { background: var(--yellow); }
  .session-card .meta {
    font-size: 11px;
    color: var(--text-dim);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .session-card .meta span {
    display: flex;
    justify-content: space-between;
  }
  .session-card .meta .val { color: var(--text); }
  .session-card .latency-bar {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    margin-top: 6px;
    overflow: hidden;
  }
  .session-card .latency-bar .fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s, background 0.4s;
  }

  /* --- Alert Feed --- */
  .alert-item {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 4px;
    animation: slide-in 0.3s ease;
    border-left: 3px solid transparent;
  }
  @keyframes slide-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .alert-item.info    { background: var(--blue-bg); border-left-color: var(--blue); }
  .alert-item.warning { background: var(--yellow-bg); border-left-color: var(--yellow); }
  .alert-item.critical { background: var(--red-bg); border-left-color: var(--red); }
  .alert-item.emergency {
    background: var(--red-bg);
    border-left-color: var(--red);
    animation: slide-in 0.3s ease, pulse-red 2s infinite;
  }
  .alert-item .time {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    min-width: 55px;
  }
  .alert-item .severity-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
  }
  .alert-item.info .severity-badge    { color: var(--blue); background: rgba(59,130,246,0.2); }
  .alert-item.warning .severity-badge { color: var(--yellow); background: rgba(234,179,8,0.2); }
  .alert-item.critical .severity-badge { color: var(--red); background: rgba(239,68,68,0.2); }
  .alert-item.emergency .severity-badge { color: #fff; background: var(--red); }
  .alert-item .desc { flex: 1; font-size: 12px; }
  .alert-item .venue-tag {
    font-size: 11px;
    color: var(--cyan);
    font-weight: 600;
  }

  /* --- Action Log --- */
  .action-item {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 4px;
    animation: slide-in 0.3s ease;
  }
  .action-item.auto {
    background: var(--green-bg);
    border-left: 3px solid var(--green);
  }
  .action-item.escalated {
    background: var(--yellow-bg);
    border-left: 3px solid var(--yellow);
  }
  .action-item .badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
  }
  .action-item.auto .badge { color: var(--green); background: rgba(34,197,94,0.2); }
  .action-item.escalated .badge { color: var(--yellow); background: rgba(234,179,8,0.2); }

  /* --- Orders Table --- */
  .orders-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .orders-table th {
    text-align: left;
    padding: 6px 10px;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
  }
  .orders-table td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
  }
  .orders-table tr { transition: background 0.3s; }
  .orders-table tr:hover { background: var(--bg-card-hover); }
  .orders-table tr.new-row { animation: highlight-row 1.5s ease; }
  @keyframes highlight-row {
    0% { background: rgba(34,197,94,0.2); }
    100% { background: transparent; }
  }
  .fill-bar {
    width: 60px; height: 4px;
    background: var(--border);
    border-radius: 2px;
    display: inline-block;
    vertical-align: middle;
  }
  .fill-bar .fill { height: 100%; background: var(--green); border-radius: 2px; transition: width 0.5s; }

  /* --- Stats Bar --- */
  .stats-bar {
    display: flex;
    gap: 16px;
    padding: 8px 20px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .stat {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stat .label { color: var(--text-dim); }
  .stat .value { font-weight: 700; }
  .stat .value.green { color: var(--green); }
  .stat .value.red { color: var(--red); }
  .stat .value.yellow { color: var(--yellow); }
  .stat .value.blue { color: var(--blue); }

  /* --- Scrollbar --- */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  /* --- Escalation Banner --- */
  .escalation-banner {
    display: none;
    padding: 10px 20px;
    background: linear-gradient(90deg, rgba(234,179,8,0.15), rgba(239,68,68,0.15));
    border-bottom: 2px solid var(--yellow);
    animation: banner-pulse 3s infinite;
    font-size: 13px;
  }
  .escalation-banner.active { display: flex; align-items: center; gap: 12px; }
  @keyframes banner-pulse {
    0%, 100% { border-bottom-color: var(--yellow); }
    50% { border-bottom-color: var(--red); }
  }
  .escalation-banner .icon { font-size: 18px; }
  .escalation-banner .text { flex: 1; }
  .escalation-banner .approve-btn {
    background: var(--green);
    color: #000;
    border: none;
    padding: 4px 14px;
    border-radius: 4px;
    font-family: var(--font);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .escalation-banner .approve-btn:hover { opacity: 0.85; }
  .escalation-banner .reject-btn {
    background: var(--red);
    color: #fff;
    border: none;
    padding: 4px 14px;
    border-radius: 4px;
    font-family: var(--font);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
</head>
<body>

<div class="header">
  <h1>FIX MCP — LIVE CONTROL ROOM</h1>
  <div class="status">
    <div class="status-dot" id="ws-status"></div>
    <span id="ws-status-text">Connecting...</span>
    <span style="margin-left:12px; color:var(--text-dim)" id="scenario-label">—</span>
  </div>
</div>

<div class="stats-bar">
  <div class="stat"><span class="label">Alerts</span><span class="value blue" id="stat-alerts">0</span></div>
  <div class="stat"><span class="label">Auto-resolved</span><span class="value green" id="stat-auto">0</span></div>
  <div class="stat"><span class="label">Escalated</span><span class="value yellow" id="stat-escalated">0</span></div>
  <div class="stat"><span class="label">Errors</span><span class="value red" id="stat-errors">0</span></div>
  <div class="stat"><span class="label">Lines/s</span><span class="value" id="stat-lps">0</span></div>
  <div class="stat" style="margin-left:auto"><span class="label">Uptime</span><span class="value" id="stat-uptime">00:00</span></div>
</div>

<div class="escalation-banner" id="escalation-banner">
  <span class="icon">⚠</span>
  <span class="text" id="escalation-text">—</span>
  <button class="approve-btn" onclick="approveEscalation()">APPROVE</button>
  <button class="reject-btn" onclick="rejectEscalation()">REJECT</button>
</div>

<div class="grid">
  <!-- Top Left: Sessions -->
  <div class="panel">
    <div class="panel-header">
      Sessions
      <span class="count" id="session-count">0 / 0</span>
    </div>
    <div class="sessions-grid" id="sessions-container"></div>
  </div>

  <!-- Top Right: Alert Feed -->
  <div class="panel">
    <div class="panel-header">
      Alert Feed
      <span class="count" id="alert-count">0</span>
    </div>
    <div class="panel-body" id="alerts-container"></div>
  </div>

  <!-- Bottom Left: Actions -->
  <div class="panel">
    <div class="panel-header">
      Actions
      <span class="count" id="action-count">0</span>
    </div>
    <div class="panel-body" id="actions-container"></div>
  </div>

  <!-- Bottom Right: Orders -->
  <div class="panel">
    <div class="panel-header">
      Live Orders
      <span class="count" id="order-count">0</span>
    </div>
    <div class="panel-body">
      <table class="orders-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Filled</th>
            <th>Venue</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="orders-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
const state = {
  connected: false,
  sessions: {},    // venue -> {connected, latency_ms, sender_seq, target_seq}
  alerts: [],
  actions: [],
  orders: {},      // cl_ord_id -> order
  escalations: [],
  stats: { alerts: 0, auto: 0, escalated: 0, errors: 0, lines: 0 },
  startTime: Date.now(),
  pendingEscalation: null,
};

// -------------------------------------------------------------------------
// WebSocket
// -------------------------------------------------------------------------
let ws = null;
let reconnectAttempts = 0;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    state.connected = true;
    reconnectAttempts = 0;
    document.getElementById('ws-status').classList.add('connected');
    document.getElementById('ws-status-text').textContent = 'Connected';
  };

  ws.onclose = () => {
    state.connected = false;
    document.getElementById('ws-status').classList.remove('connected');
    document.getElementById('ws-status-text').textContent = 'Reconnecting...';
    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
    reconnectAttempts++;
    setTimeout(connectWS, delay);
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Parse error:', e);
    }
  };
}

// -------------------------------------------------------------------------
// Message Handlers
// -------------------------------------------------------------------------
function handleMessage(msg) {
  const channel = msg.channel || '';
  const data = msg.data || msg;

  switch(data.type) {
    case 'alert':       handleAlert(data); break;
    case 'action_executed': handleAction(data); break;
    case 'escalation':  handleEscalation(data); break;
    case 'session_update': handleSessionUpdate(data); break;
    case 'order_update':   handleOrderUpdate(data); break;
    case 'stats':       handleStats(data); break;
    case 'scenario':    handleScenario(data); break;
    default:
      // Try to infer from channel
      if (channel.includes('alert')) handleAlert(data);
      else if (channel.includes('action')) handleAction(data);
  }
}

function handleAlert(data) {
  state.stats.alerts++;
  state.alerts.unshift(data);
  if (state.alerts.length > 200) state.alerts.pop();

  // Update session state from alert
  if (data.alert_type === 'session_drop') {
    updateSession(data.venue, { connected: false });
  } else if (data.alert_type === 'latency_spike') {
    const ms = data.params?.latency_ms || 0;
    const status = ms > 150 ? 'degraded' : 'connected';
    updateSession(data.venue, { connected: status !== 'degraded', latency_ms: ms, degraded: status === 'degraded' });
  }

  renderAlerts();
  renderStats();
}

function handleAction(data) {
  state.stats.auto++;
  state.actions.unshift(data);
  if (state.actions.length > 100) state.actions.pop();

  // Update session state from successful remediation
  if (data.tool === 'fix_session_issue' && data.result?.status === 'ok') {
    const venue = data.arguments?.venue || data.venue;
    updateSession(venue, { connected: true, latency_ms: 2 });
  }

  renderActions();
  renderStats();
}

function handleEscalation(data) {
  state.stats.escalated++;
  state.escalations.push(data);
  state.pendingEscalation = data;

  // Show escalation banner
  const banner = document.getElementById('escalation-banner');
  const text = document.getElementById('escalation-text');
  const alert = data.alert || {};
  text.innerHTML = `<strong>${alert.description || '?'}</strong> — ${data.reason || ''}<br>
    <span style="color:var(--text-dim)">Proposed: ${data.proposed_action?.description || '?'}</span>`;
  banner.classList.add('active');

  // Also add to action log
  state.actions.unshift({...data, type: 'escalation'});
  renderActions();
  renderStats();
}

function handleSessionUpdate(data) {
  updateSession(data.venue, data);
}

function handleOrderUpdate(data) {
  const id = data.cl_ord_id || data.id;
  if (id) {
    state.orders[id] = { ...state.orders[id], ...data };
    renderOrders();
  }
}

function handleStats(data) {
  Object.assign(state.stats, data);
  renderStats();
}

function handleScenario(data) {
  document.getElementById('scenario-label').textContent = data.scenario || '—';
  // Init sessions from scenario data
  if (data.sessions) {
    for (const [venue, info] of Object.entries(data.sessions)) {
      updateSession(venue, info);
    }
  }
}

// -------------------------------------------------------------------------
// Session Management
// -------------------------------------------------------------------------
function updateSession(venue, updates) {
  if (!state.sessions[venue]) {
    state.sessions[venue] = {
      venue, connected: true, latency_ms: 2,
      sender_seq: 1, target_seq: 1, degraded: false,
    };
  }
  Object.assign(state.sessions[venue], updates);
  renderSessions();
}

// Initialize default sessions
['NYSE', 'ARCA', 'BATS', 'IEX', 'DARK'].forEach(v => {
  state.sessions[v] = { venue: v, connected: true, latency_ms: 2, sender_seq: 1, target_seq: 1, degraded: false };
});

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function renderSessions() {
  const container = document.getElementById('sessions-container');
  const entries = Object.values(state.sessions);
  const connected = entries.filter(s => s.connected && !s.degraded).length;

  document.getElementById('session-count').textContent = `${connected} / ${entries.length}`;

  container.innerHTML = entries.map(s => {
    const cls = !s.connected ? 'disconnected' : s.degraded ? 'degraded' : 'connected';
    const latencyPct = Math.min((s.latency_ms || 2) / 200 * 100, 100);
    const latencyColor = (s.latency_ms || 0) < 50 ? 'var(--green)' :
                         (s.latency_ms || 0) < 100 ? 'var(--yellow)' : 'var(--red)';
    return `
      <div class="session-card ${cls}">
        <div class="venue">${s.venue} <div class="dot"></div></div>
        <div class="meta">
          <span>Latency <span class="val" style="color:${latencyColor}">${s.latency_ms || '—'}ms</span></span>
          <span>Seq <span class="val">${s.sender_seq || '—'}/${s.target_seq || '—'}</span></span>
        </div>
        <div class="latency-bar"><div class="fill" style="width:${latencyPct}%; background:${latencyColor}"></div></div>
      </div>`;
  }).join('');
}

function renderAlerts() {
  const container = document.getElementById('alerts-container');
  document.getElementById('alert-count').textContent = state.stats.alerts;

  // Only render last 50
  const visible = state.alerts.slice(0, 50);
  container.innerHTML = visible.map(a => {
    const sev = a.severity || 'info';
    const time = a.detected_at ? new Date(a.detected_at).toLocaleTimeString('en-US', {hour12:false}) : '—';
    return `
      <div class="alert-item ${sev}">
        <span class="time">${time}</span>
        <span class="severity-badge">${sev}</span>
        <span class="venue-tag">[${a.venue || '?'}]</span>
        <span class="desc">${a.description || '—'}</span>
      </div>`;
  }).join('');
}

function renderActions() {
  const container = document.getElementById('actions-container');
  document.getElementById('action-count').textContent = state.actions.length;

  const visible = state.actions.slice(0, 50);
  container.innerHTML = visible.map(a => {
    if (a.type === 'escalation') {
      const alert = a.alert || {};
      return `
        <div class="action-item escalated">
          <span class="badge">ESCALATED</span>
          <span class="venue-tag" style="color:var(--cyan)">[${alert.venue || '?'}]</span>
          <span class="desc">${alert.description || '—'}</span>
          <span style="color:var(--text-dim); font-size:11px; margin-left:auto">Awaiting approval</span>
        </div>`;
    }
    return `
      <div class="action-item auto">
        <span class="badge">AUTO</span>
        <span class="venue-tag" style="color:var(--cyan)">[${a.venue || '?'}]</span>
        <span class="desc">${a.tool || '—'}(${JSON.stringify(a.arguments || {}).slice(0,60)})</span>
      </div>`;
  }).join('');
}

function renderOrders() {
  const tbody = document.getElementById('orders-tbody');
  const orders = Object.values(state.orders);
  document.getElementById('order-count').textContent = orders.length;

  tbody.innerHTML = orders.slice(-30).reverse().map(o => {
    const fillPct = o.qty ? ((o.filled_qty || 0) / o.qty * 100) : 0;
    const statusColor = o.status === 'Filled' ? 'var(--green)' :
                        o.status === 'Rejected' ? 'var(--red)' :
                        o.status === 'Canceled' ? 'var(--text-dim)' : 'var(--text)';
    return `
      <tr class="new-row">
        <td style="font-size:11px; color:var(--text-dim)">${o.cl_ord_id || '—'}</td>
        <td style="font-weight:600">${o.symbol || '—'}</td>
        <td style="color:${o.side === '1' || o.side === 'Buy' ? 'var(--green)' : 'var(--red)'}">${o.side === '1' ? 'BUY' : o.side === '2' ? 'SELL' : o.side || '—'}</td>
        <td>${o.qty || '—'}</td>
        <td><div class="fill-bar"><div class="fill" style="width:${fillPct}%"></div></div> ${o.filled_qty || 0}</td>
        <td style="color:var(--cyan)">${o.venue || '—'}</td>
        <td style="color:${statusColor}">${o.status || '—'}</td>
      </tr>`;
  }).join('');
}

function renderStats() {
  document.getElementById('stat-alerts').textContent = state.stats.alerts;
  document.getElementById('stat-auto').textContent = state.stats.auto;
  document.getElementById('stat-escalated').textContent = state.stats.escalated;
  document.getElementById('stat-errors').textContent = state.stats.errors;
}

// -------------------------------------------------------------------------
// Escalation Handlers
// -------------------------------------------------------------------------
function approveEscalation() {
  if (ws && state.pendingEscalation) {
    ws.send(JSON.stringify({ type: 'approve', escalation_id: state.pendingEscalation.id }));
    document.getElementById('escalation-banner').classList.remove('active');
    state.pendingEscalation = null;
  }
}

function rejectEscalation() {
  if (ws && state.pendingEscalation) {
    ws.send(JSON.stringify({ type: 'reject', escalation_id: state.pendingEscalation.id }));
    document.getElementById('escalation-banner').classList.remove('active');
    state.pendingEscalation = null;
  }
}

// -------------------------------------------------------------------------
// Uptime Timer
// -------------------------------------------------------------------------
setInterval(() => {
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('stat-uptime').textContent = `${mins}:${secs}`;
}, 1000);

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
renderSessions();
connectWS();
</script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# aiohttp Server
# ---------------------------------------------------------------------------
async def create_app(
    redis_url: Optional[str] = None,
    api_url: str = "http://localhost:8000",
):
    """Create the aiohttp application with WebSocket and dashboard routes."""
    try:
        from aiohttp import web
    except ImportError:
        logger.error("aiohttp not installed. Run: pip install aiohttp")
        raise

    app = web.Application()
    app["ws_clients"] = set()
    app["redis_url"] = redis_url
    app["api_url"] = api_url

    # --- Routes ---

    async def handle_dashboard(request):
        return web.Response(text=DASHBOARD_HTML, content_type="text/html")

    async def handle_ws(request):
        ws_resp = web.WebSocketResponse()
        await ws_resp.prepare(request)
        app["ws_clients"].add(ws_resp)
        logger.info(f"WebSocket client connected ({len(app['ws_clients'])} total)")

        try:
            async for msg in ws_resp:
                if msg.type == web.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        await handle_ws_message(app, data)
                    except json.JSONDecodeError:
                        pass
                elif msg.type == web.WSMsgType.ERROR:
                    logger.error(f"WebSocket error: {ws_resp.exception()}")
        finally:
            app["ws_clients"].discard(ws_resp)
            logger.info(f"WebSocket client disconnected ({len(app['ws_clients'])} remaining)")

        return ws_resp

    async def handle_health(request):
        return web.json_response({
            "status": "ok",
            "clients": len(app["ws_clients"]),
            "redis": redis_url is not None,
        })

    # API proxy for dashboard actions
    async def handle_api_proxy(request):
        """Proxy tool calls from dashboard to the MCP REST API."""
        try:
            import aiohttp as aioh
            data = await request.json()
            async with aioh.ClientSession() as session:
                async with session.post(
                    f"{api_url}/api/tool",
                    json=data,
                    timeout=30,
                ) as resp:
                    result = await resp.json()
                    return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    app.router.add_get("/", handle_dashboard)
    app.router.add_get("/ws", handle_ws)
    app.router.add_get("/health", handle_health)
    app.router.add_post("/api/tool", handle_api_proxy)

    # --- Background Tasks ---

    async def redis_subscriber(app):
        """Subscribe to Redis channels and broadcast to WebSocket clients."""
        if not redis_url:
            return

        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(redis_url)
            pubsub = r.pubsub()
            await pubsub.subscribe("fix:alerts", "fix:actions", "fix:sessions", "fix:orders", "fix:audit")
            logger.info("Redis subscriber started")

            async for message in pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    if isinstance(channel, bytes):
                        channel = channel.decode()
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode()

                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        payload = {"raw": data}

                    await broadcast(app, {"channel": channel, "data": payload})

        except Exception as e:
            logger.error(f"Redis subscriber error: {e}")

    async def start_background(app):
        if redis_url:
            app["redis_task"] = asyncio.create_task(redis_subscriber(app))

    async def cleanup_background(app):
        if "redis_task" in app:
            app["redis_task"].cancel()
            try:
                await app["redis_task"]
            except asyncio.CancelledError:
                pass

    app.on_startup.append(start_background)
    app.on_cleanup.append(cleanup_background)

    return app


async def broadcast(app, message: dict):
    """Broadcast a message to all connected WebSocket clients."""
    if not app["ws_clients"]:
        return

    payload = json.dumps(message, default=str)
    dead = set()

    for ws in app["ws_clients"]:
        try:
            await ws.send_str(payload)
        except Exception:
            dead.add(ws)

    for ws in dead:
        app["ws_clients"].discard(ws)


async def handle_ws_message(app, data: dict):
    """Handle incoming WebSocket messages from the dashboard (approvals, etc)."""
    msg_type = data.get("type")

    if msg_type == "approve":
        logger.info(f"Escalation approved: {data.get('escalation_id')}")
        await broadcast(app, {
            "data": {
                "type": "action_executed",
                "tool": "escalation_approved",
                "arguments": {"escalation_id": data.get("escalation_id")},
                "result": {"status": "approved"},
                "venue": "SYSTEM",
            }
        })

    elif msg_type == "reject":
        logger.info(f"Escalation rejected: {data.get('escalation_id')}")
        await broadcast(app, {
            "data": {
                "type": "alert",
                "alert_type": "escalation_rejected",
                "severity": "info",
                "venue": "SYSTEM",
                "description": f"Escalation rejected by operator",
            }
        })


# ---------------------------------------------------------------------------
# Integrated Demo Server
# ---------------------------------------------------------------------------
async def run_demo_server(
    scenario: str = "morning_triage",
    speed: float = 20.0,
    port: int = 8787,
    redis_url: Optional[str] = None,
):
    """
    Run the dashboard server AND the demo orchestrator together.
    The dashboard receives events directly (no Redis required).
    """
    try:
        from aiohttp import web
    except ImportError:
        print("Install aiohttp: pip install aiohttp")
        return

    app = await create_app(redis_url=redis_url)

    # Import demo components
    from .log_generator import FIXLogGenerator
    from .log_monitor import PatternMatcher, EscalationPolicy, EscalationHandler, EventBus, AuditTrail

    gen = FIXLogGenerator(scenario=scenario, speed_multiplier=speed, seed=42)
    matcher = PatternMatcher()
    policy = EscalationPolicy()
    event_bus = EventBus(redis_url)
    audit = AuditTrail(fallback_path=f"/tmp/fix_audit_{scenario}.jsonl")

    if redis_url:
        await event_bus.connect()
    await audit.connect()

    handler = EscalationHandler(policy, audit, event_bus)

    # Simulated API for demo
    class SimAPI:
        async def call_tool(self, tool, args):
            await asyncio.sleep(0.2)
            return {"status": "ok", "tool": tool}

    api = SimAPI()

    async def run_scenario(app):
        """Background task: generate logs and process them."""
        await asyncio.sleep(2)  # Let the server start

        # Send initial scenario info
        await broadcast(app, {
            "data": {
                "type": "scenario",
                "scenario": scenario,
                "sessions": {v: {"venue": v, "connected": True, "latency_ms": 2} for v in ["NYSE", "ARCA", "BATS", "IEX", "DARK"]},
            }
        })

        sim_elapsed = 0
        async for line in gen.stream():
            results = matcher.check(line)

            for alert, action in results:
                # Broadcast alert
                await broadcast(app, {"data": {"type": "alert", **alert.to_dict()}})
                if redis_url:
                    await event_bus.publish("fix:alerts", {"type": "alert", **alert.to_dict()})

                if action:
                    should_esc, reason = handler.should_escalate(alert, action)
                    if should_esc:
                        esc_data = {
                            "type": "escalation",
                            "reason": reason,
                            "alert": alert.to_dict(),
                            "proposed_action": {
                                "tool": action.tool,
                                "arguments": action.arguments,
                                "description": action.description,
                            },
                        }
                        await broadcast(app, {"data": esc_data})
                        if redis_url:
                            await event_bus.publish("fix:alerts", esc_data)
                        await audit.record(alert, action, {"escalated": True, "reason": reason})
                    else:
                        result = await api.call_tool(action.tool, action.arguments)
                        action_data = {
                            "type": "action_executed",
                            "tool": action.tool,
                            "arguments": action.arguments,
                            "result": result,
                            "alert_type": alert.alert_type.value,
                            "venue": alert.venue,
                        }
                        await broadcast(app, {"data": action_data})
                        if redis_url:
                            await event_bus.publish("fix:actions", action_data)
                        await audit.record(alert, action, result)

            sim_elapsed = gen._sim_elapsed()
            if sim_elapsed > 600:  # 10 min sim time
                break

        logger.info("Demo scenario complete")

    async def start_scenario(app):
        app["scenario_task"] = asyncio.create_task(run_scenario(app))

    async def cleanup_scenario(app):
        if "scenario_task" in app:
            app["scenario_task"].cancel()
        await event_bus.close()
        await audit.close()

    app.on_startup.append(start_scenario)
    app.on_cleanup.append(cleanup_scenario)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()

    logger.info(f"Dashboard: http://localhost:{port}")
    logger.info(f"Scenario: {scenario} at {speed}x speed")

    # Keep running
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await runner.cleanup()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    import argparse

    parser = argparse.ArgumentParser(description="FIX MCP Live Dashboard")
    parser.add_argument("--port", type=int, default=8787, help="Dashboard port")
    parser.add_argument("--redis", default=None, help="Redis URL for pub/sub")
    parser.add_argument("--api", default="http://localhost:8000", help="MCP REST API URL")
    parser.add_argument("--demo", default=None, help="Run with demo scenario (e.g. morning_triage)")
    parser.add_argument("--speed", type=float, default=20.0, help="Demo speed multiplier")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.demo:
        asyncio.run(run_demo_server(
            scenario=args.demo,
            speed=args.speed,
            port=args.port,
            redis_url=args.redis,
        ))
    else:
        # Dashboard-only mode (connects to Redis for events)
        async def run():
            try:
                from aiohttp import web
            except ImportError:
                print("Install aiohttp: pip install aiohttp")
                return
            app = await create_app(redis_url=args.redis, api_url=args.api)
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, "0.0.0.0", args.port)
            await site.start()
            logger.info(f"Dashboard: http://localhost:{args.port}")
            try:
                await asyncio.Event().wait()
            except (KeyboardInterrupt, asyncio.CancelledError):
                pass
            finally:
                await runner.cleanup()

        asyncio.run(run())


if __name__ == "__main__":
    main()

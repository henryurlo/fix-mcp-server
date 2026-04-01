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
import threading
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# API server base URL — override via env var for non-Docker deployments.
# When left as the default Docker address (or unset), the dashboard embeds
# the API server in a background thread so a single command starts everything.
_API_URL_DEFAULT = "http://api-server:8000"
API_URL = os.environ.get("API_URL", _API_URL_DEFAULT)


# ---------------------------------------------------------------------------
# Embedded HTML + JS
# ---------------------------------------------------------------------------

HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FIX MCP Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --bg-el: #161b22;
      --bg-in: #1c2230;
      --border: #30363d;
      --border-sub: #21262d;
      --text: #e6edf3;
      --dim: #8b949e;
      --xdim: #484f58;
      --accent: #388bfd;
      --ok: #3fb950;
      --ok-bg: rgba(63,185,80,.1);
      --warn: #d29922;
      --warn-bg: rgba(210,153,34,.1);
      --down: #f85149;
      --down-bg: rgba(248,81,73,.1);
      --mono: ui-monospace,"SFMono-Regular","SF Mono",Menlo,Consolas,monospace;
      --sans: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--sans); background: var(--bg); color: var(--text); font-size: 13px; }
    a { color: var(--accent); }

    /* ── layout ── */
    .shell { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; }
    .topbar { padding: 10px 20px; background: var(--bg-el); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }
    .topbar h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; color: var(--text); }
    .topbar .spacer { flex: 1; }
    .statusbar { display: flex; gap: 12px; padding: 7px 20px; background: var(--bg-el); border-bottom: 1px solid var(--border-sub); flex-wrap: wrap; align-items: center; }
    .main { display: grid; grid-template-columns: 220px 1fr 280px; overflow: hidden; }
    .sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 10px; background: var(--bg); display: flex; flex-direction: column; gap: 8px; }
    .content { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; background: var(--bg); }
    .right-panel { border-left: 1px solid var(--border); overflow-y: auto; padding: 10px; background: var(--bg); display: flex; flex-direction: column; gap: 8px; }
    .rp-section { background: var(--bg-el); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
    .rp-section-hdr { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--dim); font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    .rp-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 5px 4px; border-bottom: 1px solid var(--border-sub); font-size: 12px; }
    .rp-row:last-child { border-bottom: none; }
    .rp-row:hover { background: rgba(255,255,255,.02); border-radius: 4px; }
    .rp-evt { display: flex; gap: 5px; align-items: baseline; padding: 3px 4px; border-bottom: 1px solid var(--border-sub); font-size: 11px; }
    .rp-evt:last-child { border-bottom: none; }

    /* ── components ── */
    button { font-family: var(--sans); border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; font-weight: 500; transition: filter .15s; }
    button:hover { filter: brightness(1.18); }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-danger  { background: var(--down); color: #fff; }
    .btn-ok      { background: var(--ok); color: #0d1117; font-weight: 600; }
    .btn-neutral { background: #21262d; color: var(--dim); border: 1px solid var(--border); }
    .btn-neutral:hover { color: var(--text); background: var(--bg-in); }
    select { font-family: var(--sans); font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-in); color: var(--text); }
    input  { font-family: var(--sans); font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-in); color: var(--text); width: 100%; }
    input::placeholder { color: var(--xdim); }
    pre { font-family: var(--mono); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: 0; }

    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-family: var(--sans); font-size: 11px; font-weight: 600; }
    .chip-ok   { background: var(--ok-bg); color: var(--ok); border: 1px solid rgba(63,185,80,.25); }
    .chip-warn { background: var(--warn-bg); color: var(--warn); border: 1px solid rgba(210,153,34,.25); }
    .chip-down { background: var(--down-bg); color: var(--down); border: 1px solid rgba(248,81,73,.25); }
    .chip-neutral { background: #21262d; color: var(--dim); border: 1px solid var(--border); }

    .card { background: var(--bg-el); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .card h4 { margin: 0 0 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; font-family: var(--sans); color: var(--dim); font-weight: 600; }
    .card.critical { border-color: rgba(248,81,73,.5); background: var(--down-bg); }
    .card.warn     { border-color: rgba(210,153,34,.5); background: var(--warn-bg); }
    .card.ok       { border-color: rgba(63,185,80,.35); background: var(--ok-bg); }

    .step { background: var(--bg-el); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .step.done { border-color: rgba(63,185,80,.4); background: var(--ok-bg); }
    .step h5 { margin: 0 0 5px; font-size: 13px; }
    .step p { margin: 0 0 8px; font-size: 12px; color: var(--dim); line-height: 1.5; }

    .section-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--xdim); padding: 4px 0; font-weight: 600; }

    /* ── tabs ── */
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
    .tab { padding: 8px 16px; font-size: 12px; font-weight: 500; cursor: pointer; border-radius: 6px 6px 0 0; border: 1px solid transparent; border-bottom: none; color: var(--dim); }
    .tab:hover { color: var(--text); background: var(--bg-in); }
    .tab.active { background: var(--bg-el); border-color: var(--border); color: var(--text); font-weight: 600; }
    .tab-body { display: none; }
    .tab-body.active { display: block; }

    /* ── tables ── */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--dim); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
    td { padding: 7px 10px; border-bottom: 1px solid var(--border-sub); vertical-align: middle; }
    tr:hover td { background: var(--bg-in); }
    .flag { display: inline-block; padding: 2px 6px; border-radius: 4px; background: var(--down-bg); color: var(--down); font-size: 10px; margin: 1px; border: 1px solid rgba(248,81,73,.2); font-weight: 500; }
    .flag-warn { background: var(--warn-bg); color: var(--warn); border-color: rgba(210,153,34,.2); }

    /* ── session badges ── */
    .sess-ok   { color: var(--ok);   font-weight: 700; }
    .sess-warn { color: var(--warn); font-weight: 700; }
    .sess-down { color: var(--down); font-weight: 700; }

    /* ── status bar numbers ── */
    .stat { display: flex; align-items: center; gap: 7px; font-size: 12px; }
    .stat strong { font-size: 15px; font-weight: 700; }
    .stat .label { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }

    .divider { height: 1px; background: var(--border); margin: 2px 0; }
    .btn-vcr  { background: #21262d; color: var(--dim); border: 1px solid var(--border); padding: 4px 10px; font-size: 11px; }
    .btn-vcr.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .vcr-bar  { display:flex; gap:3px; align-items:center; padding:0 4px; border-left:1px solid var(--border); margin-left:4px; }

    /* ── scenario brief banner ── */
    .brief { background: var(--bg-in); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; padding: 14px 18px; margin-bottom: 12px; }
    .brief .brief-time { font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px; }
    .brief .brief-body { font-size: 13px; line-height: 1.7; color: var(--text); }
    .brief .brief-body strong { color: #ffd680; }

    /* ── AI callouts ── */
    .ai-auto     { font-size:11px;background:var(--ok-bg);border-left:3px solid var(--ok);border-radius:0 6px 6px 0;padding:6px 10px;margin:4px 0 6px;line-height:1.5;color:var(--dim); }
    .ai-approval { font-size:11px;background:var(--warn-bg);border-left:3px solid var(--warn);border-radius:0 6px 6px 0;padding:6px 10px;margin:4px 0 6px;line-height:1.5;color:var(--dim); }
    .ai-auto::before     { content:"🤖 Auto: "; font-weight:700; color:var(--ok); }
    .ai-approval::before { content:"✋ Needs OK: "; font-weight:700; color:var(--warn); }

    /* ── client notification panel ── */
    .notify-panel { background:var(--warn-bg); border:1px solid rgba(210,153,34,.3); border-radius:8px; padding:12px; }
    .notify-panel .notify-title { font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--warn);font-weight:700;margin-bottom:8px; }
    .notify-row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid rgba(210,153,34,.15); font-size:12px; }
    .notify-row:last-child { border-bottom:none; }
    .notify-row .client { font-weight:700;color:var(--text); }
    .notify-row .detail { color:var(--dim);font-size:11px; }

    /* ── output cards from pre-market check ── */
    .issue-card { border-radius:6px; padding:8px 12px; margin-bottom:6px; font-size:12px;line-height:1.5; }
    .issue-critical { background:var(--down-bg); border-left:3px solid var(--down); }
    .issue-warning  { background:var(--warn-bg); border-left:3px solid var(--warn); }
    .issue-ok       { background:var(--ok-bg); border-left:3px solid var(--ok); }
    .issue-card strong { display:block; font-size:12px; margin-bottom:2px; color:var(--text); }

    /* ── playbook steps ── */
    .playbook { display:flex; flex-direction:column; gap:8px; }
    .pb-step  { background:var(--bg-el); border:1px solid var(--border); border-radius:8px; padding:14px 16px; }
    .pb-step.done  { border-color:rgba(63,185,80,.4); background:var(--ok-bg); }
    .pb-step .pb-num  { font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--xdim);margin-bottom:4px;font-weight:600; }
    .pb-step h5 { margin:0 0 4px;font-size:13px;font-weight:600;color:var(--text); }
    .pb-step .pb-desc { margin:0 0 8px;font-size:12px;color:var(--dim);line-height:1.5; }
    .pb-output { background:#0d1117;color:var(--ok);font-family:var(--mono);font-size:12px;line-height:1.6;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-word;min-height:80px;border:1px solid var(--border); }
    .pb-output.error { color:var(--down); }

    /* ── FIX message viewer ── */
    .fix-msg-table { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:12px; margin-top:8px; }
    .fix-msg-table th { text-align:left; padding:5px 10px; border-bottom:1px solid var(--border); color:var(--dim); font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.8px; }
    .fix-msg-table td { padding:5px 10px; border-bottom:1px solid var(--border-sub); vertical-align:top; }
    .fix-msg-table .tag { color:var(--accent); font-weight:700; min-width:36px; display:inline-block; }
    .fix-msg-table .fname { color:var(--dim); font-size:11px; }
    .fix-msg-table .fval { color:var(--text); }
    .fix-msg-table .fval.hi { color:#ffd680; font-weight:700; }
    .fix-msg-table tr.hi td { background:rgba(56,139,253,.06); }
    .raw-fix { font-family:var(--mono); font-size:11px; color:var(--dim); word-break:break-all; padding:8px 12px; background:var(--bg); border-radius:4px; border:1px solid var(--border); margin-top:6px; line-height:1.6; }
    .raw-fix .pipe { color:var(--accent); opacity:.7; }

    /* ── progress bars ── */
    .prog-bar { height:5px; border-radius:3px; background:var(--border); overflow:hidden; width:72px; display:inline-block; vertical-align:middle; margin-left:4px; }
    .prog-bar .fill { height:100%; border-radius:3px; transition:width .4s; }
    .prog-bar .fill.ok { background:var(--ok); }
    .prog-bar .fill.warn { background:var(--warn); }
    .prog-bar .fill.crit { background:var(--down); }

    /* ── tool catalog ── */
    .tool-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:8px; margin-top:4px; }
    .tool-card { background:var(--bg-el); border:1px solid var(--border); border-radius:8px; padding:12px 14px; cursor:pointer; transition:border-color .15s; }
    .tool-card:hover { border-color:var(--accent); }
    .tool-name { font-family:var(--mono); font-size:12px; font-weight:700; color:var(--accent); margin-bottom:4px; }
    .tool-desc { font-size:11px; color:var(--dim); line-height:1.5; }
    .tool-badge { display:inline-block; padding:1px 7px; border-radius:4px; font-size:10px; font-weight:600; margin-top:6px; }
    .tb-order   { background:rgba(56,139,253,.15);  color:var(--accent); }
    .tb-session { background:rgba(168,85,247,.15);  color:#a855f7; }
    .tb-ref     { background:rgba(210,153,34,.15);  color:var(--warn); }
    .tb-algo    { background:rgba(63,185,80,.15);   color:var(--ok); }
    .tb-triage  { background:rgba(248,81,73,.15);   color:var(--down); }

    /* ── rich output sections ── */
    .out-section { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); font-weight:700; margin:14px 0 6px; padding-bottom:4px; border-bottom:1px solid var(--border-sub); }
    .kv-grid { display:grid; grid-template-columns:140px 1fr; gap:4px 8px; font-size:12px; }
    .kv-key  { color:var(--dim); }
    .kv-val  { color:var(--text); font-family:var(--mono); }
    .sess-out-card { background:var(--bg-el); border:1px solid var(--border); border-left:4px solid var(--border); border-radius:8px; padding:12px 14px; margin-bottom:8px; }
    .sess-out-card.ok   { border-left-color:var(--ok); }
    .sess-out-card.warn { border-left-color:var(--warn); }
    .sess-out-card.down { border-left-color:var(--down); background:var(--down-bg); }
    .order-conf-card { background:var(--bg-el); border:1px solid var(--border); border-left:4px solid var(--border); border-radius:8px; padding:14px 16px; }
    .order-conf-card.ok   { border-left-color:var(--ok); }
    .order-conf-card.warn { border-left-color:var(--warn); }
    .warn-item { padding:6px 10px; background:var(--warn-bg); border-left:3px solid var(--warn); border-radius:0 4px 4px 0; font-size:12px; color:var(--warn); margin-top:4px; }

    /* ── MCP Server tab ── */
    .mcp-cap-block { background:var(--bg-el); border:1px solid var(--accent); border-radius:8px; padding:14px 18px; margin-bottom:14px; }
    .mcp-cap-block h3 { margin:0 0 8px; font-size:14px; color:var(--accent); font-family:var(--mono); font-weight:700; }
    .mcp-cap-kv { display:flex; gap:24px; flex-wrap:wrap; }
    .mcp-cap-kv span { font-size:12px; color:var(--dim); }
    .mcp-cap-kv strong { color:var(--text); font-family:var(--mono); }
    .mcp-section-hdr { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:var(--dim); margin:16px 0 8px; border-bottom:1px solid var(--border-sub); padding-bottom:5px; }
    .mcp-tool-row { background:var(--bg-el); border:1px solid var(--border); border-radius:6px; padding:10px 14px; margin-bottom:6px; cursor:pointer; transition:border-color .15s; }
    .mcp-tool-row:hover { border-color:var(--accent); }
    .mcp-tool-name { font-family:var(--mono); font-size:12px; color:var(--accent); font-weight:600; }
    .mcp-tool-desc { font-size:12px; color:var(--dim); margin-top:3px; line-height:1.5; }
    .mcp-tool-schema { display:none; margin-top:8px; background:var(--bg); border:1px solid var(--border-sub); border-radius:4px; padding:10px; font-family:var(--mono); font-size:11px; color:#8b949e; white-space:pre; overflow-x:auto; }
    .mcp-resource-row { display:flex; gap:12px; align-items:baseline; padding:7px 10px; border-bottom:1px solid var(--border-sub); }
    .mcp-resource-uri { font-family:var(--mono); font-size:11px; color:var(--accent); min-width:200px; }
    .mcp-resource-desc { font-size:12px; color:var(--dim); flex:1; }
    .mcp-resource-mime { font-size:10px; color:var(--xdim); }
    .mcp-prompt-row { padding:7px 10px; border-bottom:1px solid var(--border-sub); }
    .mcp-prompt-name { font-family:var(--mono); font-size:12px; color:var(--ok); }
    .mcp-prompt-desc { font-size:12px; color:var(--dim); margin-top:2px; }
    .mcp-config-pre { background:var(--bg); border:1px solid var(--border-sub); border-radius:6px; padding:12px; font-family:var(--mono); font-size:11px; color:var(--dim); white-space:pre; overflow-x:auto; margin-top:8px; }
    .mcp-jsonrpc-wrap { margin-top:14px; border-top:1px solid var(--border-sub); padding-top:10px; }
    .mcp-jsonrpc-label { font-size:10px; text-transform:uppercase; letter-spacing:1.5px; color:var(--xdim); margin-bottom:5px; font-weight:700; }
    .mcp-jsonrpc-pre { background:var(--bg-in); border:1px solid var(--border-sub); border-radius:4px; padding:10px 12px; font-family:var(--mono); font-size:11px; color:var(--dim); white-space:pre; overflow-x:auto; }

    /* ── sim clock ── */
    .sim-clock { font-family:var(--mono); font-size:20px; font-weight:700; color:#ffd680; letter-spacing:2px; line-height:1; }
    .sim-clock-wrap { display:flex; flex-direction:column; align-items:center; padding:0 10px; border-left:1px solid var(--border); margin-left:6px; }
    .sim-clock-label { font-size:9px; color:var(--xdim); text-transform:uppercase; letter-spacing:1px; margin-top:1px; }

    /* ── timeline panel ── */
    .tl-panel { background:var(--bg-el); border:1px solid var(--border); border-radius:8px; padding:8px; overflow-y:auto; max-height:220px; }
    .tl-item { display:flex; align-items:center; gap:6px; padding:4px 5px; border-radius:4px; cursor:pointer; font-size:11px; transition:background .12s; }
    .tl-item:hover { background:var(--bg-in); }
    .tl-item.tl-active { background:rgba(56,139,253,.12); }
    .tl-item.tl-done { opacity:.65; }
    .tl-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; background:var(--border); border:1px solid var(--xdim); transition:background .2s; }
    .tl-dot.tl-dot-done   { background:var(--ok); border-color:var(--ok); }
    .tl-dot.tl-dot-active { background:var(--accent); border-color:var(--accent); box-shadow:0 0 5px var(--accent); }
    .tl-time { font-family:var(--mono); font-size:10px; color:var(--xdim); width:38px; flex-shrink:0; }
    .tl-name { flex:1; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ── narration overlay ── */
    .narration-overlay { display:none; position:fixed; inset:0; background:rgba(13,17,23,.88); z-index:999; align-items:center; justify-content:center; }
    .narration-overlay.show { display:flex; }
    .narration-box { background:var(--bg-el); border:1px solid var(--accent); border-radius:12px; padding:28px 32px; max-width:600px; width:92%; box-shadow:0 8px 40px rgba(56,139,253,.3); animation:narrate-in .25s ease; }
    @keyframes narrate-in { from { opacity:0; transform:translateY(-16px); } to { opacity:1; transform:none; } }
    .narration-time { font-family:var(--mono); font-size:11px; color:var(--accent); letter-spacing:1px; text-transform:uppercase; margin-bottom:10px; }
    .narration-headline { font-size:18px; font-weight:700; color:var(--text); margin-bottom:12px; line-height:1.3; }
    .narration-body { font-size:13px; line-height:1.75; color:var(--dim); margin-bottom:18px; }
    .narration-agent { font-size:11px; color:var(--ok); font-family:var(--mono); background:var(--ok-bg); border-radius:5px; padding:7px 12px; margin-bottom:16px; border-left:3px solid var(--ok); }
    .narration-footer { display:flex; gap:8px; justify-content:flex-end; }
  </style>
</head>
<body>
<div class="shell">

  <!-- ── top bar ── -->
  <div class="topbar">
    <h1>FIX MCP Dashboard</h1>
    <span class="spacer"></span>
    <div style="display:flex;gap:4px;align-items:center">
      <span style="font-size:10px;color:var(--xdim);letter-spacing:1px;text-transform:uppercase;font-weight:600">Mode</span>
      <button id="modeHuman" class="btn-ok"     onclick="switchMode('human')" style="padding:5px 12px;font-size:12px">Human</button>
      <button id="modeMixed" class="btn-neutral" onclick="switchMode('mixed')" style="padding:5px 12px;font-size:12px">Mixed</button>
      <button id="modeAgent" class="btn-neutral" onclick="switchMode('agent')" style="padding:5px 12px;font-size:12px">Agent</button>
    </div>
    <div class="vcr-bar">
      <span style="font-size:10px;color:var(--xdim);letter-spacing:1px;text-transform:uppercase;font-weight:600">Sim</span>
      <button id="vcrPause" class="btn-vcr" onclick="togglePause()">⏸ Pause</button>
      <button id="vcr1x"  class="btn-vcr" onclick="setSimSpeed(1)">1×</button>
      <button id="vcr10x" class="btn-vcr active" onclick="setSimSpeed(10)">10×</button>
      <button id="vcr20x" class="btn-vcr" onclick="setSimSpeed(20)">20×</button>
      <button id="vcr60x" class="btn-vcr" onclick="setSimSpeed(60)">60×</button>
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
      <div class="section-label">Today's Timeline</div>
      <div class="tl-panel">
        <div id="timelinePanel"></div>
      </div>

      <div class="divider"></div>
      <div class="section-label">Session Health</div>
      <div id="sessionCards"></div>

      <div class="divider"></div>
      <div class="section-label">Quick Tools</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <button class="btn-primary" onclick="runTool('run_premarket_check',{})">Pre-Market</button>
        <button class="btn-primary" onclick="runTool('check_fix_sessions',{})">Sessions</button>
        <button class="btn-primary" onclick="runTool('check_algo_status',{})">Algos</button>
        <button class="btn-neutral" onclick="runTool('validate_orders',{})">Validate</button>
      </div>

      <div id="notifyPanel" style="display:none;margin-top:4px">
        <div class="divider" style="margin-bottom:8px"></div>
        <div class="notify-panel">
          <div class="notify-title">📞 Client Notifications Required</div>
          <div id="notifyRows"></div>
        </div>
      </div>

      <div class="divider"></div>
      <div class="section-label">Send Order</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <div style="display:grid;grid-template-columns:1fr 80px;gap:4px">
          <input id="qSymbol" placeholder="Symbol" value="AAPL" />
          <input id="qQty" placeholder="Qty" value="100" type="number" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <select id="qSide"><option value="buy">Buy</option><option value="sell">Sell</option></select>
          <input id="qPrice" placeholder="Price" value="214.50" type="number" step="0.01" />
        </div>
        <select id="qClient" style="font-size:11px">
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
      <div style="display:flex;flex-direction:column;gap:5px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <select id="repairVenue" style="font-size:11px">
            <option>NYSE</option><option>ARCA</option><option>BATS</option>
            <option>IEX</option><option>EDGX</option><option>NASDAQ</option>
          </select>
          <select id="repairAction" style="font-size:11px">
            <option value="resend_request">ResendReq</option>
            <option value="reset_sequence">SeqReset</option>
            <option value="reconnect">Reconnect</option>
          </select>
        </div>
        <button class="btn-danger" onclick="repairSession()">Repair Session</button>
      </div>
    </div>

    <!-- main content -->
    <div class="content">
      <div class="tabs" id="tabs">
        <div class="tab active" onclick="switchTab('playbook')">▶ Playbook</div>
        <div class="tab" onclick="switchTab('fixmsgs')">FIX Messages</div>
        <div class="tab" onclick="switchTab('tools')">MCP Server</div>
        <div class="tab" onclick="switchTab('architecture')">Architecture</div>
      </div>

      <div class="tab-body active" id="tab-playbook">
        <div id="scenarioBrief"></div>
        <div class="playbook" id="workflowSteps"></div>
        <div class="pb-output" id="output">Select a scenario from the timeline, then run a step to see AI output here.</div>
      </div>

      <div class="tab-body" id="tab-fixmsgs">
        <div class="card">
          <h4>FIX Message Inspector</h4>
          <p style="font-size:12px;color:var(--dim);margin:0 0 10px">Send an order or repair a session — the FIX 4.2 protocol message appears here with field-by-field annotations.</p>
          <div id="fixMsgContent" style="font-size:12px;color:var(--xdim)">No messages yet. Run <strong style="color:var(--dim)">send_order</strong> or <strong style="color:var(--dim)">fix_session_issue</strong> from the Playbook tab to populate this view.</div>
        </div>
      </div>

      <div class="tab-body" id="tab-tools">
        <div id="mcpSchemaContent" style="padding:4px 0">
          <div style="text-align:center;padding:40px;color:var(--dim);font-size:13px">Loading MCP schema&hellip;</div>
        </div>
      </div>

      <div class="tab-body" id="tab-architecture">
        <div class="card" style="margin-bottom:14px">
          <h4>System Architecture — FIX MCP Server</h4>
          <div class="mermaid" id="archDiagram" style="background:transparent;padding:8px 0">
flowchart TB
    subgraph AI["AI Agent Layer"]
        CL["🤖 Claude AI\nMCP Client\n(Claude Code / claude.ai)"]
    end

    subgraph Docker["Docker Compose Stack"]
        direction TB

        subgraph MCPSvc["fix-mcp-server  (stdio)"]
            MCP["fix_mcp.server\n15 MCP tools · 4 resources\n6 role prompts"]
            subgraph Engine["FIX Engine"]
                OMS["OMS\norder lifecycle"]
                SESS["FIX Sessions\nsequence tracking"]
                ALGOS["Algo Engine\nTWAP · VWAP · IS · POV"]
                REF["Reference Data\nticker · corp actions"]
                SCEN["Scenarios\n13 trading scenarios"]
            end
            MCP --> OMS & SESS & ALGOS & REF & SCEN
        end

        subgraph APISvc["fix-mcp-api  :8000"]
            API["fix_mcp.api\nREST API\n/orders /sessions /algos\n/scenarios /simulation"]
        end

        subgraph DashSvc["fix-mcp-dashboard  :8787"]
            DASH["fix_mcp.dashboard\nWeb UI\nPlaybook · Sessions · Orders\nAlgos · Activity · Architecture"]
        end

        subgraph SimSvc["Simulation  (--profile simulation)"]
            LOGGEN["fix_mcp.log_generator\nVCR-style FIX log writer\n1x–60x speed"]
            LOGMON["fix_mcp.log_monitor\nPattern detector\nautonomous API calls"]
        end
    end

    subgraph Infra["Infrastructure"]
        PG[("PostgreSQL :5432\norder store\nFIX message log")]
        REDIS[("Redis :6379\npub/sub fills\nsession events")]
        LOGS[/"fix_logs volume\n/var/log/fix/\n*.log"\]
    end

    CL -- "MCP tools via stdio" --> MCP
    MCP -- "read/write orders &amp; sessions" --> PG
    MCP -- "pub/sub events" --> REDIS
    API -- "CRUD" --> PG
    API -- "publish fills &amp; alerts" --> REDIS
    DASH -- "proxy /api/*" --> API
    LOGGEN -- "write FIX messages" --> LOGS
    LOGGEN -- "POST scenario state" --> API
    LOGMON -- "tail &amp; parse" --> LOGS
    LOGMON -- "POST pattern alerts" --> API
    REDIS -- "subscribe" --> LOGMON

    classDef aiNode fill:#1c2230,stroke:#388bfd,stroke-width:2px,color:#e6edf3
    classDef mcpNode fill:#1c2230,stroke:#388bfd,stroke-width:1px,color:#e6edf3
    classDef apiNode fill:#1c2230,stroke:#3fb950,stroke-width:1px,color:#e6edf3
    classDef dashNode fill:#1c2230,stroke:#3fb950,stroke-width:1px,color:#e6edf3
    classDef simNode fill:#1c2230,stroke:#d29922,stroke-width:1px,color:#e6edf3
    classDef infraNode fill:#161b22,stroke:#30363d,stroke-width:1px,color:#8b949e
    classDef engineNode fill:#0d1117,stroke:#30363d,stroke-width:1px,color:#8b949e

    class CL aiNode
    class MCP,MCPSvc mcpNode
    class API,APISvc apiNode
    class DASH,DashSvc dashNode
    class LOGGEN,LOGMON,SimSvc simNode
    class PG,REDIS,LOGS,Infra infraNode
    class OMS,SESS,ALGOS,REF,SCEN,Engine engineNode
          </div>
        </div>

        <div class="card">
          <h4>Next Steps — Evolution Roadmap</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">

            <div class="pb-step">
              <div class="pb-num">Milestone 1 · Real Connectivity</div>
              <h5>Live FIX Gateway</h5>
              <div class="pb-desc">Replace the simulated sessions with a real QuickFIX/N or QuickFIX/J acceptor. The <code style="font-family:var(--mono);font-size:11px;color:var(--accent)">fix_mcp/fix/connector.py</code> stub is already in place — wire it to a UAT venue (e.g. BATS UAT, IEX Pillar sandbox) and let the engine track live sequence numbers.</div>
              <div class="ai-auto">Engine and MCP tools are venue-agnostic — only the connector needs to be swapped.</div>
            </div>

            <div class="pb-step">
              <div class="pb-num">Milestone 2 · Real-Time UI</div>
              <h5>WebSocket Push</h5>
              <div class="pb-desc">The dashboard currently polls every 5 s. Add a WebSocket endpoint to <code style="font-family:var(--mono);font-size:11px;color:var(--accent)">fix_mcp.api</code> that pushes Redis pub/sub events directly to the browser — fills and session flips appear in &lt;100 ms with no polling lag.</div>
              <div class="ai-auto">The live_dashboard.py already has a WebSocket skeleton to reference.</div>
            </div>

            <div class="pb-step">
              <div class="pb-num">Milestone 3 · Security</div>
              <h5>Auth + API Keys</h5>
              <div class="pb-desc">Add JWT or API-key authentication to the REST API and dashboard. Right now any local network request can call <code style="font-family:var(--mono);font-size:11px;color:var(--accent)">POST /reset</code> or send orders. Before exposing beyond localhost, gate every write endpoint behind a bearer token.</div>
              <div class="ai-approval">Requires human sign-off — changes the security boundary of all 15 MCP tools.</div>
            </div>

            <div class="pb-step">
              <div class="pb-num">Milestone 4 · Observability</div>
              <h5>Audit Trail + Metrics</h5>
              <div class="pb-desc">Emit every MCP tool call, order state change, and session event to a tamper-proof audit log (append-only PostgreSQL partition or S3). Add Prometheus metrics endpoint (<code style="font-family:var(--mono);font-size:11px;color:var(--accent)">/metrics</code>) so Grafana can plot fill latency, session uptime, and algo deviation over time.</div>
              <div class="ai-auto">Compliance-ready audit trail enables regulatory reporting without changing the MCP tool interface.</div>
            </div>

            <div class="pb-step">
              <div class="pb-num">Milestone 5 · Market Data</div>
              <h5>Live Quote Feed</h5>
              <div class="pb-desc">Replace static scenario prices with a real NBBO feed (Polygon.io, IEX Cloud, or a QuickFIX Market Data Request). Price validation, LULD checks, and SSR calculations then use real tick data — making every tool call reflect actual market state.</div>
              <div class="ai-approval">Live quotes change the risk profile of autonomous agent actions — mixed-mode approval gates should stay enabled initially.</div>
            </div>

            <div class="pb-step">
              <div class="pb-num">Milestone 6 · Multi-Seat</div>
              <h5>Multi-User + Role Prompts</h5>
              <div class="pb-desc">The server already ships 6 role prompts (head trader, risk, compliance, sales, ops, quant). Add per-role API scopes so a compliance user can only call read tools, while an ops user can repair sessions but not send orders. Integrate with an SSO provider via OIDC.</div>
              <div class="ai-auto">Role prompts map directly to tool permission groups — the prompt layer already enforces the boundary conceptually.</div>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- right panel — always-visible live data -->
    <div class="right-panel">

      <div class="rp-section">
        <div class="rp-section-hdr">
          FIX Sessions
          <button class="btn-neutral" onclick="runTool('check_fix_sessions',{})" style="font-size:10px;padding:2px 7px">Check</button>
        </div>
        <div id="rpSessions"></div>
      </div>

      <div class="rp-section">
        <div class="rp-section-hdr">
          Open Orders
          <span id="rpOrdCount" style="font-size:11px;font-weight:400;color:var(--dim)"></span>
        </div>
        <div id="rpOrders" style="max-height:190px;overflow-y:auto"></div>
      </div>

      <div class="rp-section" id="rpAlgoSection" style="display:none">
        <div class="rp-section-hdr">
          Active Algos
          <span id="rpAlgoCount" style="font-size:11px;font-weight:400;color:var(--dim)"></span>
        </div>
        <div id="rpAlgos" style="max-height:150px;overflow-y:auto"></div>
      </div>

      <div class="rp-section" style="flex:1;min-height:120px">
        <div class="rp-section-hdr">
          MCP Activity
          <span style="font-size:9px;font-family:var(--mono);color:var(--xdim)">tools/call</span>
        </div>
        <div id="rpActivity" style="max-height:300px;overflow-y:auto"></div>
      </div>

    </div>
  </div>
</div>

<!-- hidden stubs so JS refs don't throw -->
<div style="display:none" id="narrationOverlay">
  <div id="narrationTime"></div><div id="narrationHeadline"></div>
  <div id="narrationBody"></div><div id="narrationAgent"></div>
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

  // ── scenario timeline — 13 episodes keyed to sim-clock times ─────────────
  const SCENARIO_TIMELINE = [
    { name:'bats_startup_0200',     time:'02:05', minutes:125 },
    { name:'predawn_adrs_0430',     time:'04:35', minutes:275 },
    { name:'morning_triage',        time:'07:00', minutes:420 },
    { name:'preopen_auction_0900',  time:'09:02', minutes:542 },
    { name:'open_volatility_0930',  time:'09:35', minutes:575 },
    { name:'twap_slippage_1000',    time:'10:05', minutes:605 },
    { name:'venue_degradation_1030',time:'10:32', minutes:632 },
    { name:'ssr_and_split_1130',    time:'11:34', minutes:694 },
    { name:'vwap_vol_spike_1130',   time:'11:35', minutes:695 },
    { name:'iex_recovery_1400',     time:'14:03', minutes:843 },
    { name:'is_dark_failure_1415',  time:'14:15', minutes:855 },
    { name:'eod_moc_1530',          time:'15:31', minutes:931 },
    { name:'afterhours_dark_1630',  time:'16:32', minutes:992 },
  ];

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
      <div class="stat" style="margin-left:auto;color:var(--dim);font-size:11px">Scenario: <strong style="color:var(--text)">${data.scenario}</strong></div>
    `;

    // session cards
    document.getElementById('sessionCards').innerHTML = data.sessions.map(s => `
      <div class="card${s.status === 'down' ? ' critical' : s.status === 'degraded' ? ' warn' : ' ok'}" style="padding:10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-size:13px">${s.venue}</strong>
          ${statusIcon(s.status)}
        </div>
        <div style="font-size:11px;color:var(--dim)">
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

    // ── right panel — sessions
    document.getElementById('rpSessions').innerHTML = data.sessions.map(s => {
      const cls = s.status === 'active' ? 'var(--ok)' : s.status === 'degraded' ? 'var(--warn)' : 'var(--down)';
      const badge = s.status === 'active' ? '[OK]' : s.status === 'degraded' ? '[WARN]' : '[DOWN]';
      return `<div class="rp-row">
        <div>
          <strong style="font-size:12px">${s.venue}</strong>
          ${s.seq_gap ? '<span class="flag" style="font-size:9px;padding:1px 4px;margin-left:4px">GAP</span>' : ''}
          ${s.error ? `<div style="font-size:10px;color:var(--down);margin-top:1px">${s.error.substring(0,32)}</div>` : ''}
        </div>
        <div style="text-align:right;font-size:11px">
          <span style="font-weight:700;color:${cls}">${badge}</span>
          <div style="color:var(--xdim)">${s.latency_ms}ms</div>
        </div>
      </div>`;
    }).join('');

    // ── right panel — orders
    const rpOrdCount = document.getElementById('rpOrdCount');
    if (rpOrdCount) rpOrdCount.textContent = data.orders_open;
    document.getElementById('rpOrders').innerHTML = data.orders.length === 0
      ? '<div style="color:var(--xdim);font-size:11px;padding:6px 2px;text-align:center">No open orders</div>'
      : data.orders.slice(0, 14).map(o => {
          const sideColor = o.side === 'buy' ? 'var(--ok)' : 'var(--down)';
          const stuckBg   = o.status === 'stuck' ? 'background:rgba(210,153,34,.08);' : '';
          return `<div class="rp-row" style="${stuckBg}">
            <div style="flex:1">
              <div style="display:flex;gap:5px;align-items:baseline">
                <strong style="font-size:12px">${o.symbol}</strong>
                <span style="font-size:11px;color:${sideColor};font-weight:600">${o.side.toUpperCase()}</span>
                <span style="font-size:11px;color:var(--dim)">${o.quantity.toLocaleString()}</span>
              </div>
              <div style="font-size:10px;color:var(--xdim)">${o.venue} · ${o.client_name}</div>
            </div>
            <div style="text-align:right">
              <button class="btn-danger" style="font-size:10px;padding:1px 6px"
                onclick="runTool('cancel_replace',{order_id:'${o.order_id}',action:'cancel'})">✕</button>
              <div style="font-size:10px;margin-top:2px;color:${o.status==='stuck'?'var(--warn)':'var(--xdim)'};font-weight:${o.status==='stuck'?'700':'400'}">${o.status}</div>
            </div>
          </div>`;
        }).join('');

    // ── right panel — algos
    const rpAlgoSection = document.getElementById('rpAlgoSection');
    const rpAlgoCount   = document.getElementById('rpAlgoCount');
    if (rpAlgoCount) rpAlgoCount.textContent = data.algos.length;
    if (rpAlgoSection) rpAlgoSection.style.display = data.algos.length > 0 ? '' : 'none';
    const rpAlgos = document.getElementById('rpAlgos');
    if (rpAlgos && data.algos.length > 0) {
      rpAlgos.innerHTML = data.algos.slice(0, 6).map(a => {
        const devAbs = Math.abs(a.schedule_deviation_pct || 0);
        const devColor = devAbs > 10 ? 'var(--down)' : devAbs > 3 ? 'var(--warn)' : 'var(--ok)';
        const devSign  = a.schedule_deviation_pct > 0 ? '+' : '';
        return `<div class="rp-row">
          <div style="flex:1">
            <div style="display:flex;gap:5px;align-items:baseline">
              <span style="font-size:10px;font-weight:600;color:var(--accent)">${a.algo_type.toUpperCase()}</span>
              <strong style="font-size:12px">${a.symbol}</strong>
            </div>
            <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
              <div class="prog-bar" style="width:60px"><div class="fill ${devAbs>10?'crit':devAbs>3?'warn':'ok'}" style="width:${Math.min(100,a.execution_pct)}%"></div></div>
              <span style="font-size:10px;color:${devColor}">${devSign}${a.schedule_deviation_pct}%</span>
            </div>
          </div>
          <div style="text-align:right">
            <span style="font-size:10px;padding:2px 5px;border-radius:3px;background:${a.status==='running'?'var(--ok-bg)':'var(--warn-bg)'};color:${a.status==='running'?'var(--ok)':'var(--warn)'}">${a.status}</span>
            <div style="display:flex;gap:3px;margin-top:3px;justify-content:flex-end">
              <button class="btn-neutral" style="font-size:9px;padding:1px 5px"
                onclick="runTool('modify_algo',{algo_id:'${a.algo_id}',action:'pause'})">⏸</button>
              <button class="btn-danger" style="font-size:9px;padding:1px 5px"
                onclick="runTool('cancel_algo',{algo_id:'${a.algo_id}',reason:'dashboard cancel'})">✕</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    renderEvents();

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
          <div class="detail" style="text-align:right;color:var(--dim)">SLA ${o.sla_minutes}min<br><span class="chip chip-down" style="font-size:10px;padding:1px 7px">EXPIRED</span></div>
        </div>
      `).join('');
      notifyPanel.style.display = 'block';
    } else {
      notifyPanel.style.display = 'none';
    }
    renderTimeline();
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
        html += `<div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--${cls});font-weight:700;margin:14px 0 4px">${icon} ${hm[1]} — ${count} issue${count !== 1 ? 's' : ''}</div>`;
        continue;
      }
      if (summaryRe.test(line)) { section = 'summary'; continue; }
      if (dividerRe.test(line)) continue;
      // title line (=== PRE-MARKET CHECK … ===)
      if (/^===.*===$/.test(line)) {
        html += `<div style="font-family:var(--mono);font-size:11px;color:var(--accent);margin-bottom:8px">${line}</div>`;
        continue;
      }

      if (section === 'critical') {
        html += `<div class="issue-card issue-critical"><strong>${line}</strong></div>`;
      } else if (section === 'warning') {
        html += `<div class="issue-card issue-warning"><strong>${line}</strong></div>`;
      } else if (section === 'info') {
        html += `<div class="issue-card issue-ok">${line.replace(/^-\s*/,'')}</div>`;
      } else if (section === 'summary') {
        html += `<div style="font-size:12px;margin-top:4px;color:var(--dim)">${line}</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--dim)">${line}</div>`;
      }
    }
    return html || `<pre>${text}</pre>`;
  }

  // ── FIX tag metadata ──────────────────────────────────────────────────────
  const _FIX_TAG_NAMES = {
    8:'BeginString', 9:'BodyLength', 35:'MsgType', 49:'SenderCompID',
    56:'TargetCompID', 34:'MsgSeqNum', 52:'SendingTime', 10:'CheckSum',
    11:'ClOrdID', 41:'OrigClOrdID', 55:'Symbol', 54:'Side', 38:'OrderQty',
    40:'OrdType', 44:'Price', 99:'StopPx', 100:'ExDestination', 21:'HandlInst',
    60:'TransactTime', 59:'TimeInForce', 37:'OrderID', 17:'ExecID',
    150:'ExecType', 39:'OrdStatus', 151:'LeavesQty', 14:'CumQty', 6:'AvgPx',
    7:'BeginSeqNo', 16:'EndSeqNo', 36:'NewSeqNo', 123:'GapFillFlag',
  };
  const _FIX_TAG_VALUES = {
    35: {'D':'NewOrderSingle','F':'OrderCancelRequest','G':'OrderCancelReplaceRequest',
         '8':'ExecutionReport','2':'ResendRequest','4':'SequenceReset','0':'Heartbeat','A':'Logon','5':'Logout'},
    54: {'1':'Buy','2':'Sell'},
    40: {'1':'Market','2':'Limit','3':'Stop','4':'StopLimit'},
  };
  const _FIX_IMPORTANT = new Set([35,55,54,38,44,11,37,100,34]);

  function _parseFIXMessageRaw(raw) {
    const pairs = raw.split('|').filter(p => p.includes('='));
    if (!pairs.length) return '';
    let rows = '';
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      const tag = parseInt(pair.substring(0, eq));
      const val = pair.substring(eq + 1);
      if (!val) continue;
      const name = _FIX_TAG_NAMES[tag] || ('Tag' + tag);
      const friendly = (_FIX_TAG_VALUES[tag] || {})[val];
      const disp = friendly ? val + ' (' + friendly + ')' : val;
      const important = _FIX_IMPORTANT.has(tag);
      rows += '<tr' + (important ? ' class="hi"' : '') + '>'
            + '<td><span class="tag">' + tag + '</span></td>'
            + '<td class="fname">' + name + '</td>'
            + '<td class="fval' + (important ? ' hi' : '') + '">' + disp + '</td>'
            + '</tr>';
    }
    return '<table class="fix-msg-table"><thead><tr><th>Tag</th><th>Field</th><th>Value</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function _storeFIXMsg(raw, label) {
    const el = document.getElementById('fixMsgContent');
    if (!el || !raw) return;
    const ts = new Date().toLocaleTimeString();
    const rawHtml = raw.replace(/\|/g, '<span class="pipe">|</span>');
    el.innerHTML = '<div style="font-size:11px;color:var(--dim);margin-bottom:8px">Last message <strong style="color:var(--text)">' + (label||'') + '</strong> at ' + ts + '</div>'
      + _parseFIXMessageRaw(raw)
      + '<div class="raw-fix" style="margin-top:8px">' + rawHtml + '</div>';
  }

  // ── tool output parsers ───────────────────────────────────────────────────

  function _parseSendOrderOutput(text) {
    const lines = text.split('\n');
    let confFields = {};
    let section = null;
    let warnHtml = '';
    let fixHtml = '';
    let rawLine = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line === 'ORDER CONFIRMATION') { section = 'conf'; continue; }
      if (line === 'WARNINGS:') { section = 'warn'; continue; }
      if (line.startsWith('FIX MESSAGE (')) { section = 'fix'; continue; }
      if (line.startsWith('RAW: ')) {
        rawLine = line.replace('RAW: ', '');
        fixHtml = _parseFIXMessageRaw(rawLine);
        _storeFIXMsg(rawLine, 'NewOrderSingle (35=D)');
        continue;
      }
      if (section === 'conf') {
        const m = line.match(/^(.+?):\s+(.+)$/);
        if (m) confFields[m[1].trim()] = m[2].trim();
      } else if (section === 'warn') {
        warnHtml += '<div class="warn-item">' + line.replace(/^\[!\]\s*/,'') + '</div>';
      }
    }
    const status = (confFields['Status']||'').toLowerCase();
    const cls = status==='filled' ? 'ok' : status==='rejected' ? 'warn' : '';
    const order = ['Order ID','ClOrdID','Symbol','Side','Quantity','Type','Price','Venue','Status','Client','Notional','Fill'];
    let kvHtml = '';
    for (const k of order) {
      if (confFields[k]) kvHtml += '<div class="kv-key">' + k + '</div><div class="kv-val">' + confFields[k] + '</div>';
    }
    let html = '<div class="order-conf-card ' + cls + '">'
             + '<div class="out-section">Order Confirmation</div>'
             + '<div class="kv-grid">' + kvHtml + '</div></div>';
    if (warnHtml) html += '<div class="out-section" style="color:var(--warn)">Warnings</div>' + warnHtml;
    if (fixHtml)  html += '<div class="out-section">FIX Message — NewOrderSingle (35=D)</div>' + fixHtml;
    if (rawLine)  html += '<div class="raw-fix">' + rawLine.replace(/\|/g, '<span class="pipe">|</span>') + '</div>';
    return html || '<pre>' + text + '</pre>';
  }

  function _parseSessionFixOutput(text) {
    const lines = text.split('\n');
    let html = '';
    let section = null;
    let rawLine = '';
    let kvOpen = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('FIX SESSION FIX —') || line.startsWith('FIX SESSION REPAIR')) {
        html += '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">' + line + '</div>'
              + '<div class="kv-grid">';
        kvOpen = true; section = 'info'; continue;
      }
      if (line.startsWith('Releasing stuck orders:')) {
        if (kvOpen) { html += '</div>'; kvOpen = false; }
        html += '<div class="out-section" style="color:var(--ok)">Orders Released</div>';
        section = 'orders'; continue;
      }
      if (line.startsWith('FIX MESSAGE (')) {
        if (kvOpen) { html += '</div>'; kvOpen = false; }
        const label = line.replace('FIX MESSAGE (','').replace('):','').replace(')','').trim();
        html += '<div class="out-section">FIX Message — ' + label + '</div>';
        section = 'fix'; continue;
      }
      if (line.startsWith('RAW: ') && section !== null) {
        rawLine = line.replace('RAW: ','');
        html += _parseFIXMessageRaw(rawLine);
        html += '<div class="raw-fix">' + rawLine.replace(/\|/g, '<span class="pipe">|</span>') + '</div>';
        _storeFIXMsg(rawLine, line.includes('35=2') ? 'ResendRequest' : line.includes('35=4') ? 'SequenceReset' : 'Logon');
        continue;
      }
      if (section === 'info' && kvOpen) {
        const m = line.match(/^(.+?):\s+(.+)$/);
        if (m) html += '<div class="kv-key">' + m[1].trim() + '</div><div class="kv-val">' + m[2].trim() + '</div>';
      }
      if (section === 'orders' && line.match(/^ORD-/)) {
        html += '<div style="font-family:var(--mono);font-size:12px;padding:4px 12px;border-left:3px solid var(--ok);background:var(--ok-bg);margin-bottom:3px;border-radius:0 4px 4px 0">' + line + '</div>';
      }
    }
    if (kvOpen) html += '</div>';
    return html || '<pre>' + text + '</pre>';
  }

  function _parseSessionsOutput(text) {
    const lines = text.split('\n');
    let html = '';
    let cur = null;
    const venueRe = /^([✅⚠️❌🔴🟡🟢\[\]!]+\s+|\[OK\]\s+|\[WARN\]\s+|\[DOWN\]\s+)?([A-Z]{2,8})\s*(?:\(([^)]*)\))?$/;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('═') || line === 'FIX SESSION STATUS') continue;
      const vm = line.match(venueRe);
      if (vm && (line.startsWith('[') || line.match(/^[✅⚠️❌]/))) {
        if (cur) html += _buildSessCard(cur);
        cur = { icon: vm[1]||'', venue: vm[2], fields: [], flags: [] };
        continue;
      }
      if (cur) {
        if (line.startsWith('[!]') || line.startsWith('[DOWN]') || line.startsWith('[WARN]')) {
          cur.flags.push(line);
        } else {
          const m = line.match(/^(.+?):\s+(.+)$/);
          if (m) cur.fields.push([m[1].trim(), m[2].trim()]);
        }
      }
    }
    if (cur) html += _buildSessCard(cur);
    return html || '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + text + '</pre>';
  }

  function _buildSessCard(s) {
    const statusField = s.fields.find(f => f[0]==='Status');
    const status = statusField ? statusField[1].toLowerCase() : '';
    const cls = status==='active' ? 'ok' : status==='degraded' ? 'warn' : 'down';
    let rows = '';
    for (const [k,v] of s.fields) rows += '<div class="kv-key">' + k + '</div><div class="kv-val">' + v + '</div>';
    const flags = s.flags.map(f =>
      '<div style="padding:5px 10px;margin-top:6px;background:var(--down-bg);border-left:3px solid var(--down);border-radius:0 4px 4px 0;font-size:12px;color:var(--down)">' + f + '</div>'
    ).join('');
    return '<div class="sess-out-card ' + cls + '">'
         + '<div style="font-size:14px;font-weight:700;margin-bottom:8px">' + s.icon + ' ' + s.venue + '</div>'
         + '<div class="kv-grid">' + rows + '</div>' + flags + '</div>';
  }

  function _parseOrderQueryOutput(text) {
    const lines = text.split('\n');
    let html = '';
    let section = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('─')) continue;
      if (line.startsWith('ORDER QUERY —')) { html += '<div style="font-size:13px;font-weight:700;margin-bottom:10px">' + line + '</div>'; continue; }
      if (line.startsWith('ID ') && line.includes('SYM')) continue;
      if (line.startsWith('[!] SLA CRITICAL'))      { section='sla';   html += '<div class="out-section" style="color:var(--down)">SLA Critical</div>'; continue; }
      if (line.startsWith('[!] STUCK / VENUE DOWN')) { section='stuck'; html += '<div class="out-section" style="color:var(--warn)">Stuck / Venue Down</div>'; continue; }
      if (line.startsWith('OPEN / OTHER'))           { section='open';  html += '<div class="out-section">Open / Other</div>'; continue; }
      if (line.startsWith('Total notional')) { html += '<div style="font-size:11px;color:var(--dim);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' + line + '</div>'; continue; }
      if (line.startsWith('***')) { html += '<div style="font-size:11px;color:var(--down);padding-left:12px">' + line + '</div>'; continue; }
      if (line.match(/^ORD-/)) {
        const bg = section==='sla' ? 'background:var(--down-bg);border-color:rgba(248,81,73,.4);' : section==='stuck' ? 'background:var(--warn-bg);border-color:rgba(210,153,34,.4);' : '';
        html += '<div style="font-family:var(--mono);font-size:12px;padding:6px 12px;border-radius:4px;margin-bottom:3px;border:1px solid var(--border);' + bg + 'white-space:pre">' + line + '</div>';
      }
    }
    return html || '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + text + '</pre>';
  }

  function _parseAlgoOutput(text) {
    const lines = text.split('\n');
    let html = '';
    let section = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('─')) continue;
      if (line.startsWith('ALGO STATUS —')) { html += '<div style="font-size:13px;font-weight:700;margin-bottom:10px">' + line + '</div>'; continue; }
      if (line.startsWith('ID ') && line.includes('SYM')) continue;
      if (line.startsWith('[!] NEEDS ATTENTION')) { section='urgent'; html += '<div class="out-section" style="color:var(--down)">Needs Attention</div>'; continue; }
      if (line.startsWith('RUNNING / PAUSED'))     { section='run';    html += '<div class="out-section">Running / Paused</div>'; continue; }
      if (line.startsWith('COMPLETED / CANCELED')) { section='done';   html += '<div class="out-section" style="color:var(--xdim)">Completed / Canceled</div>'; continue; }
      if (line.startsWith('Total algo') || line.startsWith('Problematic:')) { html += '<div style="font-size:11px;color:var(--dim);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' + line + '</div>'; continue; }
      if (line.startsWith('flag:') || line.startsWith('note:')) { html += '<div style="font-size:11px;color:var(--warn);padding:1px 0 4px 16px">' + line + '</div>'; continue; }
      if (line.length > 20 && section) html += _buildAlgoRow(line, section);
    }
    return html || '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + text + '</pre>';
  }

  function _buildAlgoRow(line, section) {
    const parts = line.split(/\s{2,}/);
    if (parts.length < 6) return '<div style="font-family:var(--mono);font-size:12px;padding:4px 8px;border-bottom:1px solid var(--border-sub)">' + line + '</div>';
    const [id, sym, side, qty, type, status, exec, sched, dev] = parts;
    const execNum = parseFloat(exec)||0;
    const devNum  = parseFloat(dev)||0;
    const devCls  = Math.abs(devNum)>10 ? 'crit' : Math.abs(devNum)>3 ? 'warn' : 'ok';
    const devColor = devCls==='crit' ? 'var(--down)' : devCls==='warn' ? 'var(--warn)' : 'var(--ok)';
    const isUrgent = section==='urgent';
    const bg = isUrgent ? 'background:var(--down-bg);border-color:rgba(248,81,73,.3);' : 'background:var(--bg-el);';
    const statusBg = isUrgent ? 'rgba(248,81,73,.2)' : status==='paused'||status==='halted' ? 'rgba(210,153,34,.2)' : 'rgba(63,185,80,.2)';
    const statusColor = isUrgent ? 'var(--down)' : status==='paused'||status==='halted' ? 'var(--warn)' : 'var(--ok)';
    return '<div style="padding:8px 12px;border-radius:6px;margin-bottom:6px;border:1px solid var(--border);' + bg + 'display:grid;grid-template-columns:190px 50px 40px 70px 70px 1fr;gap:8px;align-items:center;font-size:12px">'
         + '<div style="font-family:var(--mono);font-size:11px;color:var(--accent)">' + (id||'') + '</div>'
         + '<div><strong>' + (sym||'') + '</strong></div>'
         + '<div style="color:var(--dim)">' + (side||'') + '</div>'
         + '<div style="color:var(--dim)">' + (qty||'') + '</div>'
         + '<div><span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:' + statusBg + ';color:' + statusColor + '">' + (status||'—') + '</span></div>'
         + '<div style="display:flex;align-items:center;gap:8px">'
         + '<span style="font-size:11px;color:var(--dim)">' + execNum + '%</span>'
         + '<div class="prog-bar" style="width:90px"><div class="fill ' + devCls + '" style="width:' + Math.min(100,execNum) + '%"></div></div>'
         + '<span style="font-weight:600;color:' + devColor + '">' + (dev||'') + '% dev</span></div></div>';
  }

  function _parseAlgoModOutput(text) {
    const lines = text.split('\n');
    let html = '<div class="kv-grid">';
    let opened = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('ALGO MODIFIED —') || line.startsWith('ALGO CANCELED —')) {
        html = '<div style="font-size:13px;font-weight:700;margin-bottom:10px">' + line + '</div><div class="kv-grid">';
        opened = true; continue;
      }
      const m = line.match(/^(.+?):\s+(.+)$/);
      if (m) html += '<div class="kv-key">' + m[1].trim() + '</div><div class="kv-val">' + m[2].trim() + '</div>';
    }
    html += '</div>';
    return html;
  }

  function _parseCancelReplaceOutput(text) {
    return _parseAlgoModOutput(text.replace('cancel_replace','Cancel/Replace').replace('CANCEL','Cancel'));
  }

  function _parseValidationOutput(text) {
    const lines = text.split('\n');
    let html = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('─')) continue;
      if (line.startsWith('ORDER VALIDATION —')) { html += '<div style="font-size:13px;font-weight:700;margin-bottom:10px">' + line + '</div>'; continue; }
      if (line.startsWith('ID ') && line.includes('STATUS')) continue;
      if (line.startsWith('SUMMARY:')) { html += '<div style="font-size:12px;font-weight:600;margin-top:10px;padding:8px 12px;background:var(--bg-in);border-radius:6px">' + line + '</div>'; continue; }
      const passM = line.match(/^(\S+)\s+PASS$/);
      const failM = line.match(/^(\S+)\s+FAIL$/);
      const bulletM = line.match(/^-\s+(.+)$/);
      if (passM) html += '<div style="display:flex;gap:8px;align-items:center;padding:4px 8px;margin-bottom:2px;border-radius:4px;background:var(--ok-bg)"><span style="font-family:var(--mono);font-size:12px;flex:1">' + passM[1] + '</span><span style="font-size:10px;font-weight:700;color:var(--ok);padding:1px 7px;border-radius:3px;background:rgba(63,185,80,.2)">PASS</span></div>';
      else if (failM) html += '<div style="display:flex;gap:8px;align-items:center;padding:4px 8px;margin-bottom:2px;border-radius:4px;background:var(--down-bg)"><span style="font-family:var(--mono);font-size:12px;flex:1">' + failM[1] + '</span><span style="font-size:10px;font-weight:700;color:var(--down);padding:1px 7px;border-radius:3px;background:rgba(248,81,73,.2)">FAIL</span></div>';
      else if (bulletM) html += '<div style="font-size:12px;color:var(--down);padding:2px 8px 2px 24px">— ' + bulletM[1] + '</div>';
    }
    return html || '<pre style="font-family:var(--mono);font-size:12px;white-space:pre-wrap">' + text + '</pre>';
  }

  // ── MCP Server tab ────────────────────────────────────────────────────────
  async function renderMCPSchema() {
    const el = document.getElementById('mcpSchemaContent');
    if (!el) return;
    const schema = await fetchJson('/api/mcp/schema');
    if (!schema) {
      el.innerHTML = '<div style="padding:20px;color:var(--down)">Failed to load MCP schema from /api/mcp/schema.</div>';
      return;
    }
    const badgeColor = { orders:'tb-order', session:'tb-session', reference:'tb-ref', algo:'tb-algo', triage:'tb-triage' };
    const toolCategory = {
      query_orders:'tb-order', check_fix_sessions:'tb-session', send_order:'tb-order', cancel_replace:'tb-order',
      check_ticker:'tb-ref', update_ticker:'tb-ref', load_ticker:'tb-ref', fix_session_issue:'tb-session',
      validate_orders:'tb-triage', run_premarket_check:'tb-triage', send_algo_order:'tb-algo',
      check_algo_status:'tb-algo', modify_algo:'tb-algo', cancel_algo:'tb-algo', list_scenarios:'tb-triage',
    };

    // ── Server capabilities block
    let html = `<div class="mcp-cap-block">
      <h3>${schema.server.name}</h3>
      <div style="font-size:11px;color:var(--xdim);font-family:var(--mono);margin-bottom:8px">Protocol ${schema.server.protocolVersion} &nbsp;·&nbsp; v${schema.server.version} &nbsp;·&nbsp; transport: stdio</div>
      <div class="mcp-cap-kv">
        <span>Tools <strong>${schema.tools.length}</strong></span>
        <span>Resources <strong>${schema.resources.length}</strong></span>
        <span>Prompts <strong>${schema.prompts.length}</strong></span>
        <span>Capabilities <strong>tools · resources · prompts</strong></span>
      </div>
    </div>`;

    // ── tools/list
    html += `<div class="card"><div class="mcp-section-hdr">tools/list &mdash; ${schema.tools.length} tools registered</div>`;
    schema.tools.forEach((t, i) => {
      const badge = toolCategory[t.name] || 'tb-triage';
      const schemaStr = JSON.stringify(t.inputSchema, null, 2)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += `<div class="mcp-tool-row" onclick="toggleMCPSchema(${i})">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span class="mcp-tool-name">${t.name}</span>
          <span class="tool-badge ${badge}" style="font-size:10px;padding:1px 7px">${badge.replace('tb-','')}</span>
          <span style="font-size:10px;color:var(--xdim);margin-left:auto">click to view inputSchema ↓</span>
        </div>
        <div class="mcp-tool-desc">${t.description}</div>
        <pre class="mcp-tool-schema" id="mcp-schema-${i}">${schemaStr}</pre>
      </div>`;
    });
    html += '</div>';

    // ── resources/list
    html += `<div class="card"><div class="mcp-section-hdr">resources/list &mdash; ${schema.resources.length} resources</div>`;
    schema.resources.forEach(r => {
      html += `<div class="mcp-resource-row">
        <span class="mcp-resource-uri">${r.uri}</span>
        <span class="mcp-resource-desc">${r.description}</span>
        <span class="mcp-resource-mime">${r.mimeType}</span>
      </div>`;
    });
    html += '</div>';

    // ── prompts/list
    html += `<div class="card"><div class="mcp-section-hdr">prompts/list &mdash; ${schema.prompts.length} role prompts</div>`;
    schema.prompts.forEach(p => {
      html += `<div class="mcp-prompt-row">
        <div class="mcp-prompt-name">${p.name}</div>
        <div class="mcp-prompt-desc">${p.description}</div>
      </div>`;
    });
    html += '</div>';

    // ── Client config
    const cfg = JSON.stringify({
      mcpServers: {
        "fix-mcp": {
          command: "/path/to/fix-mcp-server/.venv/bin/fix-mcp-server",
          args: [],
          cwd: "/path/to/fix-mcp-server"
        }
      }
    }, null, 2);
    html += `<div class="card">
      <div class="mcp-section-hdr">Client Configuration &mdash; claude_desktop_config.json / .claude/mcp.json</div>
      <p style="font-size:12px;color:var(--dim);margin:0 0 6px">Add this block so Claude Desktop or Claude Code can connect to this MCP server over stdio:</p>
      <pre class="mcp-config-pre">${cfg}</pre>
    </div>`;

    el.innerHTML = html;
  }

  function toggleMCPSchema(i) {
    const el = document.getElementById('mcp-schema-' + i);
    if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
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
      const _richParsers = {
        'run_premarket_check': _parsePremarketOutput,
        'check_fix_sessions':  _parseSessionsOutput,
        'send_order':          _parseSendOrderOutput,
        'fix_session_issue':   _parseSessionFixOutput,
        'query_orders':        _parseOrderQueryOutput,
        'check_algo_status':   _parseAlgoOutput,
        'modify_algo':         _parseAlgoModOutput,
        'cancel_algo':         _parseAlgoModOutput,
        'validate_orders':     _parseValidationOutput,
        'cancel_replace':      _parseCancelReplaceOutput,
      };
      const parser = _richParsers[tool];
      out.className = 'pb-output';
      out.style.background = 'var(--bg-el)';
      out.style.color = 'var(--text)';
      if (parser && data.ok) {
        out.innerHTML = parser(data.output);
      } else {
        out.innerHTML = `<pre style="white-space:pre-wrap;font-family:var(--mono);font-size:12px;color:${data.ok ? 'var(--text)' : 'var(--down)'}">${data.output}</pre>`;
      }
      // Always append the MCP JSON-RPC envelope so the protocol is visible
      const mcpReqId = Date.now();
      const mcpReq = JSON.stringify({
        jsonrpc: "2.0",
        id: mcpReqId,
        method: "tools/call",
        params: { name: tool, arguments: args }
      }, null, 2);
      const mcpResp = JSON.stringify({
        jsonrpc: "2.0",
        id: mcpReqId,
        result: { content: [{ type: "text", text: data.output.slice(0, 120) + (data.output.length > 120 ? "…" : "") }] }
      }, null, 2);
      out.innerHTML += `<div class="mcp-jsonrpc-wrap">
        <div class="mcp-jsonrpc-label">MCP Protocol &mdash; tools/call (stdio transport)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
          <div>
            <div style="font-size:10px;color:var(--xdim);margin-bottom:3px">→ Request</div>
            <pre class="mcp-jsonrpc-pre">${mcpReq}</pre>
          </div>
          <div>
            <div style="font-size:10px;color:var(--xdim);margin-bottom:3px">← Response</div>
            <pre class="mcp-jsonrpc-pre">${mcpResp}</pre>
          </div>
        </div>
      </div>`;
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
      const names = ['playbook', 'fixmsgs', 'tools', 'architecture'];
      t.classList.toggle('active', names[i] === name);
    });
    document.querySelectorAll('.tab-body').forEach(b => {
      b.classList.toggle('active', b.id === 'tab-' + name);
    });
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
    const rpAct = document.getElementById('rpActivity');
    if (!rpAct) return;
    rpAct.innerHTML = events.slice(0, 20).map(e => {
      const t = new Date(e.ts).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false});
      const isClaude = e.source === 'claude';
      const srcBadge = isClaude
        ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(63,185,80,.18);color:var(--ok);font-weight:700;flex-shrink:0">AI</span>'
        : '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(56,139,253,.15);color:var(--accent);font-weight:700;flex-shrink:0">UI</span>';
      const okMark = e.ok
        ? '<span style="color:var(--ok);font-size:10px;flex-shrink:0">✓</span>'
        : '<span style="color:var(--down);font-size:10px;flex-shrink:0">✗</span>';
      return `<div class="rp-evt" style="${isClaude ? 'background:rgba(63,185,80,.03);' : ''}">
        <span style="font-family:var(--mono);font-size:10px;color:var(--xdim);white-space:nowrap;flex-shrink:0">${t}</span>
        ${srcBadge}
        ${okMark}
        <span style="font-family:var(--mono);font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.tool}</span>
      </div>`;
    }).join('');
  }

  // ── timeline (click navigation only) ─────────────────────────────────────

  function renderTimeline() {
    const panel = document.getElementById('timelinePanel');
    if (!panel) return;
    const active = currentStatus && currentStatus.scenario;
    panel.innerHTML = SCENARIO_TIMELINE.map(s => {
      const isActive = s.name === active;
      const label    = (SCENARIO_CONTEXT[s.name] || {}).headline || s.name.replace(/_/g, ' ');
      return '<div class="tl-item' + (isActive ? ' tl-active' : '') + '" onclick="_jumpToScenario(\'' + s.name + '\')" title="' + s.time + ' \u2014 ' + label + '">'
           + '<div class="tl-dot' + (isActive ? ' tl-dot-active' : '') + '"></div>'
           + '<span class="tl-time">' + s.time + '</span>'
           + '<span class="tl-name">' + label + '</span>'
           + '</div>';
    }).join('');
  }

  async function _jumpToScenario(name) {
    await loadScenario(name);
  }

  function closeNarration() {}   // stub — kept for any inline refs

  // ── init ───────────────────────────────────────────────────────────────────
  mermaid.initialize({
    startOnLoad: true,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#0d1117',
      mainBkg: '#1c2230',
      nodeBorder: '#30363d',
      clusterBkg: '#161b22',
      titleColor: '#e6edf3',
      edgeLabelBackground: '#0d1117',
      lineColor: '#484f58',
      primaryColor: '#1c2230',
      primaryBorderColor: '#388bfd',
      primaryTextColor: '#e6edf3',
      secondaryColor: '#161b22',
      tertiaryColor: '#0d1117',
    },
    flowchart: { curve: 'basis', padding: 20 },
  });
  refresh();
  renderMCPSchema();
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
# Embedded API server
# ---------------------------------------------------------------------------

def _start_embedded_api(api_port: int) -> None:
    """Start fix_mcp.api in a daemon thread so the dashboard is self-contained."""
    global API_URL
    from fix_mcp.api import APIHandler  # imported lazily to avoid circular import
    server = ThreadingHTTPServer(("127.0.0.1", api_port), APIHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True, name="fix-mcp-api")
    t.start()
    API_URL = f"http://127.0.0.1:{api_port}"


def _start_mcp_http_server(mcp_port: int) -> None:
    """Start the MCP streamable HTTP server so Claude can connect on port 8001.

    Runs in the same process as the dashboard and API, so all three share the
    same OMS/session state.  Tool calls from Claude update the live dashboard.
    """
    from fix_mcp.mcp_http import start_in_thread
    start_in_thread(host="0.0.0.0", port=mcp_port)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="FIX MCP Dashboard — self-contained: starts API + UI in one process",
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--api-port", type=int, default=8000,
                        help="Port for the embedded REST API (default: 8000)")
    parser.add_argument("--mcp-port", type=int, default=8001,
                        help="Port for the MCP HTTP server — Claude connects here (default: 8001)")
    parser.add_argument("--no-embed", action="store_true",
                        help="Skip embedded API/MCP servers — use API_URL env var for external server")
    args = parser.parse_args()

    # Embed the API and MCP HTTP servers unless an external API is configured
    if API_URL == _API_URL_DEFAULT and not args.no_embed:
        _start_embedded_api(args.api_port)
        _start_mcp_http_server(args.mcp_port)
        print(f"FIX MCP REST API  → http://127.0.0.1:{args.api_port}")
        print(f"FIX MCP HTTP      → http://127.0.0.1:{args.mcp_port}/mcp  ← Claude connects here")
        print(f"  Add to .claude/mcp.json: {{\"mcpServers\": {{\"fix-mcp\": {{\"url\": \"http://localhost:{args.mcp_port}/mcp\"}}}}}}")

    httpd = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"FIX MCP Dashboard → http://127.0.0.1:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

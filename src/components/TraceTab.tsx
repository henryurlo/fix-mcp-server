'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, Search, Download, RotateCcw,
  CheckCircle2, XCircle, Clock, Filter, X, FileText
} from 'lucide-react';

interface TraceEntry {
  trace_id: string;
  ts: string;
  ts_epoch: number;
  tool: string;
  arguments: Record<string, any>;
  output: string;
  ok: boolean;
  source: string;
  latency_ms: number;
  scenario: string;
  step_index: number | null;
}

interface TraceStats {
  total_entries: number;
  success_count: number;
  error_count: number;
  avg_latency_ms: number;
  tools_used: string[];
}

const TOOL_COLORS: Record<string, string> = {
  check_fix_sessions: 'var(--cyan)',
  query_orders: 'var(--green)',
  send_order: 'var(--green)',
  cancel_replace: 'var(--red)',
  fix_session_issue: 'var(--amber)',
  run_premarket_check: 'var(--cyan)',
  send_algo_order: 'var(--purple)',
  update_venue_status: 'var(--red)',
  update_ticker: 'var(--amber)',
  release_stuck_orders: 'var(--amber)',
  check_pending_acks: 'var(--amber)',
  validate_orders: 'var(--green)',
  check_market_data_staleness: 'var(--amber)',
  list_scenarios: 'var(--text-muted)',
  time_status: 'var(--green)',
  advance_time: 'var(--cyan)',
  inject_event: 'var(--red)',
  score_scenario: 'var(--green)',
  save_snapshot: 'var(--green)',
  rollback_to_snapshot: 'var(--amber)',
  approve_action: 'var(--purple)',
};

export function TraceTab() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterTool, setFilterTool] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      let url = `/api/trace?limit=200`;
      if (filterTool) url += `&tool=${encodeURIComponent(filterTool)}`;
      if (filterStatus) url += `&status=${encodeURIComponent(filterStatus)}`;
      if (filterSource) url += `&source=${encodeURIComponent(filterSource)}`;

      const [traceRes, statsRes] = await Promise.all([
        fetch(url),
        fetch('/api/trace/stats'),
      ]);
      const traceData = await traceRes.json();
      const statsData = await statsRes.json();
      setEntries(traceData);
      setStats(statsData);
    } catch (e) {
      // no-op
    } finally {
      setLoading(false);
    }
  }, [filterTool, filterStatus, filterSource]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  function clearFilters() {
    setFilterTool('');
    setFilterStatus(null);
    setFilterSource(null);
  }

  function exportTrace() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasActiveFilters = filterTool || filterStatus || filterSource;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[14px] text-[var(--text-muted)]">Loading trace...</div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Stats bar */}
      {stats && stats.total_entries > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-dim)] bg-[var(--bg-surface)] shrink-0">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-[var(--green)]" />
            <span className="text-[12px] font-mono text-[var(--text-secondary)]">{stats.success_count} OK</span>
          </div>
          {stats.error_count > 0 && (
            <div className="flex items-center gap-1.5">
              <XCircle size={12} className="text-[var(--red)]" />
              <span className="text-[12px] font-mono text-[var(--red)]">{stats.error_count} errors</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-[var(--amber)]" />
            <span className="text-[12px] font-mono text-[var(--text-secondary)]">{stats.avg_latency_ms}ms avg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)]">{stats.tools_used.length} tools used</span>
          </div>
          <div className="flex-1" />
          <button onClick={exportTrace}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <Download size={12} /> Export JSON
          </button>
          <button onClick={refresh} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <RotateCcw size={12} />
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
        <Filter size={12} className="text-[var(--text-dim)] shrink-0" />
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            type="text"
            value={filterTool}
            onChange={e => setFilterTool(e.target.value)}
            placeholder="Filter by tool name..."
            className="w-full pl-7 pr-6 py-1 bg-[var(--bg-elevated)] border border-[var(--border-dim)] rounded text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--cyan)]/50"
          />
          {filterTool && (
            <button onClick={() => setFilterTool('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]">
              <X size={10} />
            </button>
          )}
        </div>
        <select value={filterStatus || ''} onChange={e => setFilterStatus(e.target.value || null)}
          className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border-dim)] rounded text-[11px] text-[var(--text-secondary)] focus:outline-none">
          <option value="">All status</option>
          <option value="success">Success only</option>
          <option value="error">Errors only</option>
        </select>
        <select value={filterSource || ''} onChange={e => setFilterSource(e.target.value || null)}
          className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border-dim)] rounded text-[11px] text-[var(--text-secondary)] focus:outline-none">
          <option value="">All sources</option>
          <option value="dashboard">Dashboard</option>
          <option value="claude">Agent</option>
          <option value="scenario">Scenario</option>
        </select>
        {hasActiveFilters && (
          <button onClick={clearFilters}
            className="px-2 py-1 rounded text-[11px] text-[var(--red)] hover:bg-[var(--red-dim)] transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Trace entries */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md px-4">
              <FileText size={32} className="text-[var(--text-dim)] mx-auto mb-3" />
              <p className="text-[14px] text-[var(--text-muted)] mb-2">No trace entries yet</p>
              <p className="text-[12px] text-[var(--text-dim)] leading-relaxed">
                This tab is an audit log of every MCP tool call made by the dashboard, copilot, or scenario engine. It shows the tool name, arguments, output, latency, and success/failure status. Run a scenario or call a tool to start the trace.
              </p>
            </div>
          </div>
        ) : (
          <div>
            {entries.map((entry, i) => {
              const isExpanded = expanded === entry.trace_id;
              const toolColor = TOOL_COLORS[entry.tool] || 'var(--text-secondary)';
              const timeStr = entry.ts.split('T')[1]?.split('.')[0] || entry.ts;

              return (
                <div key={entry.trace_id}
                  className={`border-b border-[var(--border-dim)] hover:bg-[var(--bg-elevated)] transition-colors ${isExpanded ? 'bg-[var(--bg-elevated)]' : ''}`}>
                  {/* Compact row */}
                  <button onClick={() => setExpanded(isExpanded ? null : entry.trace_id)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2">
                    {isExpanded ? <ChevronDown size={10} className="text-[var(--text-dim)] shrink-0" /> : <ChevronRight size={10} className="text-[var(--text-dim)] shrink-0" />}
                    {entry.ok ? (
                      <CheckCircle2 size={12} className="text-[var(--green)] shrink-0" />
                    ) : (
                      <XCircle size={12} className="text-[var(--red)] shrink-0" />
                    )}
                    <span className="text-[10px] font-mono text-[var(--text-dim)] w-[70px] shrink-0">{timeStr}</span>
                    <span className="text-[12px] font-mono font-bold shrink-0" style={{ color: toolColor }}>{entry.tool}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-[70px]">{entry.source}</span>
                    <span className="text-[10px] font-mono text-[var(--text-mono-dim)] shrink-0 w-[50px] text-right">{entry.latency_ms.toFixed(0)}ms</span>
                    <span className="text-[11px] text-[var(--text-muted)] truncate">{entry.output.slice(0, 80)}</span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-8 pb-3 border-t border-[var(--border-dim)]">
                      <div className="grid grid-cols-2 gap-3 pt-2 pb-2">
                        <div>
                          <div className="text-[10px] text-[var(--text-dim)] mb-1">ARGUMENTS</div>
                          <pre className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--bg-void)] rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(entry.arguments, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10px] text-[var(--text-dim)] mb-1">
                            OUTPUT ({entry.output.length} chars)
                          </div>
                          <pre className="text-[11px] font-mono bg-[var(--bg-void)] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto"
                            style={{ color: entry.ok ? 'var(--green)' : 'var(--red)' }}>
                            {entry.output}
                          </pre>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-[var(--text-dim)] font-mono pb-1">
                        <span>ID: {entry.trace_id}</span>
                        <span>Source: {entry.source}</span>
                        <span>Scenario: {entry.scenario}</span>
                        <span>Latency: {entry.latency_ms}ms</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAudit, AuditEntry } from '@/store/audit';
import { useSystem, HostEvent } from '@/store';
import { Shield, Server, Zap, ChevronRight, Copy, Clock, AlertTriangle, CheckCircle2, XCircle, Loader2, Radio } from 'lucide-react';

// ── FIX wire event types ──────────────────────────────────────────

interface FixWireEvent {
  ts: string;
  type: string;
  msg_type: string;
  venue: string;
  symbol: string;
  side: string;
  qty: string;
  cl_ord_id: string;
  raw: string;
}

const MSG_TYPE_COLORS: Record<string, string> = {
  'A': 'var(--cyan)',
  '0': 'var(--text-muted)',
  'D': 'var(--green)',
  '8': 'var(--blue)',
  'F': 'var(--amber)',
  'G': 'var(--amber)',
  '2': 'var(--purple)',
  '5': 'var(--red)',
  '4': 'var(--red)',
  '1': 'var(--text-muted)',
  '3': 'var(--red)',
  '9': 'var(--amber)',
  'HB': 'var(--text-dim)',
};

function formatTime(ts: string): string {
  if (!ts) return '--:--:--';
  try {
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return ts.slice(0, 8);
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

// ── Tab types ──────────────────────────────────────────────────────

type AuditTab = 'mcp' | 'host' | 'fix';

// ── Main Component ─────────────────────────────────────────────────

export default function AuditLog() {
  const [activeTab, setActiveTab] = useState<AuditTab>('mcp');
  const { entries: mcpEntries } = useAudit();
  const { hostEvents, events } = useSystem();
  const [fixEvents, setFixEvents] = useState<FixWireEvent[]>([]);
  const [fixLoading, setFixLoading] = useState(false);
  const [selectedFix, setSelectedFix] = useState<FixWireEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch FIX wire events
  const fetchFixWire = useCallback(async () => {
    setFixLoading(true);
    try {
      const res = await fetch('/api/fix-wire');
      if (res.ok) {
        const data = await res.json();
        setFixEvents(data);
      }
    } catch { /* backend may be down */ }
    setFixLoading(false);
  }, []);

  useEffect(() => {
    fetchFixWire();
    const iv = setInterval(fetchFixWire, 3000);
    return () => clearInterval(iv);
  }, [fetchFixWire]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mcpEntries.length, hostEvents.length, fixEvents.length]);

  // ── Tab bar ────────────────────────────────────────────────────

  const TABS: { id: AuditTab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'mcp', label: 'MCP Calls', icon: <Zap size={13} />, count: mcpEntries.length },
    { id: 'host', label: 'Host Events', icon: <Server size={13} />, count: hostEvents.length },
    { id: 'fix', label: 'FIX Wire', icon: <Shield size={13} />, count: fixEvents.length },
  ];

  // ── Selected FIX message detail view ───────────────────────────

  if (selectedFix) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-base)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
          <button onClick={() => setSelectedFix(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            Back
          </button>
          <span className="text-[13px] font-bold text-[var(--text-primary)]">FIX Message Detail</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono">
          <div className="mb-4">
            <div className="text-[12px] text-[var(--text-muted)] mb-1">Event</div>
            <div className="text-[14px] font-bold text-[var(--text-primary)]">{selectedFix.type} ({selectedFix.msg_type})</div>
          </div>
          {selectedFix.venue && (
            <div className="mb-4">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">Venue</div>
              <div className="text-[14px] text-[var(--text-primary)]">{selectedFix.venue}</div>
            </div>
          )}
          {selectedFix.symbol && (
            <div className="mb-4">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">Symbol / Side / Qty</div>
              <div className="text-[14px] text-[var(--text-primary)]">
                {selectedFix.symbol} {selectedFix.side} {Number(selectedFix.qty).toLocaleString()}
              </div>
            </div>
          )}
          <div className="mb-2">
            <div className="text-[12px] text-[var(--text-muted)] mb-1">Raw Wire Format</div>
            <div className="text-[12px] text-[var(--green)] bg-[var(--bg-void)] p-4 rounded-md border border-[var(--border-dim)] whitespace-pre-wrap break-all leading-relaxed">
              {selectedFix.raw.split('|').map((seg, i) => {
                const [k, ...rest] = seg.split('=');
                const v = rest.join('=');
                const color = MSG_TYPE_COLORS[k] || MSG_TYPE_COLORS[selectedFix.msg_type] || 'var(--text-secondary)';
                const isTag = ['35', '10', '8', '9', '34', '49', '56', '52', '55', '54', '38', '44', '11', '41', '150', '39'].includes(k);
                return (
                  <React.Fragment key={i}>
                    {isTag ? (
                      <span style={{ color }}><span style={{ color: 'var(--text-muted)' }}>{k}</span>={v}</span>
                    ) : `${seg}`}
                    {i < selectedFix.raw.split('|').length - 1 && <span style={{ color: 'var(--text-dim)' }}>|</span>}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render current tab ─────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
        <Server size={14} className="text-[var(--cyan)]" />
        <span className="text-[13px] font-bold text-[var(--cyan)] uppercase tracking-wider">Audit Log</span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--border-dim)] bg-[var(--bg-surface)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedFix(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-mono font-semibold transition-all border-b-2 ${
              activeTab === tab.id
                ? 'border-[var(--cyan)] text-[var(--cyan)] bg-[var(--bg-elevated)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab.icon} {tab.label}
            <span className="text-[11px] opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[13px] leading-relaxed">
        {activeTab === 'mcp' && <McpTab entries={mcpEntries} />}
        {activeTab === 'host' && <HostTab events={hostEvents} />}
        {activeTab === 'fix' && <FixTab events={fixEvents} loading={fixLoading} onSelect={setSelectedFix} />}
      </div>
    </div>
  );
}

// ── MCP Calls Tab ──────────────────────────────────────────────────

function McpTab({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-[var(--text-dim)] italic px-1 py-6 text-center text-[13px]">
        No MCP tool calls yet. Run a step or ask the Copilot to call a tool.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {[...entries].reverse().map((entry) => (
        <div key={entry.id} className="py-1.5 px-2 rounded bg-[var(--bg-surface)] border border-[var(--border-dim)]">
          <div className="flex items-center gap-2">
            {entry.status === 'running' && <Loader2 size={10} className="text-[var(--blue)] animate-spin" />}
            {entry.status === 'success' && <CheckCircle2 size={10} className="text-[var(--green)]" />}
            {entry.status === 'error' && <XCircle size={10} className="text-[var(--red)]" />}
            <span className="text-[12px] text-[var(--text-dim)] shrink-0">{formatRelative(entry.timestamp)}</span>
            <span className="text-[var(--text-primary)] font-semibold">{entry.tool}</span>
            <span className="text-[var(--text-dim)] text-[12px] truncate max-w-[120px]">
              {Object.keys(entry.args).length > 0 && JSON.stringify(entry.args).slice(0, 50)}
            </span>
          </div>
          {entry.result && (
            <div className={`mt-1 text-[11px] leading-relaxed ${
              entry.status === 'error' ? 'text-[var(--red)]' : 'text-[var(--green)]'
            }`}>
              → {entry.result.slice(0, 200)}{entry.result.length > 200 ? '…' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Host Events Tab ────────────────────────────────────────────────

function HostTab({ events }: { events: HostEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-[var(--text-dim)] italic px-1 py-6 text-center text-[13px]">
        No host events yet. Start a scenario to see lifecycle events.
      </div>
    );
  }

  const SEVERITY_ICONS: Record<string, React.ReactNode> = {
    info: <Radio size={10} className="text-[var(--cyan)]" />,
    warning: <AlertTriangle size={10} className="text-[var(--amber)]" />,
    error: <XCircle size={10} className="text-[var(--red)]" />,
  };

  return (
    <div className="space-y-1.5">
      {[...events].reverse().map((ev) => (
        <div key={ev.id} className="py-1.5 px-2 rounded bg-[var(--bg-surface)] border border-[var(--border-dim)]">
          <div className="flex items-center gap-2">
            {SEVERITY_ICONS[ev.severity]}
            <span className="text-[12px] text-[var(--text-dim)] shrink-0">{formatRelative(ev.timestamp)}</span>
            <span className="text-[var(--text-secondary)] font-semibold text-[12px] uppercase tracking-wider">{ev.type}</span>
          </div>
          <div className="mt-0.5 text-[13px] text-[var(--text-primary)]">{ev.message}</div>
        </div>
      ))}
    </div>
  );
}

// ── FIX Wire Tab ───────────────────────────────────────────────────

function FixTab({ events, loading, onSelect }: { events: FixWireEvent[]; loading: boolean; onSelect: (ev: FixWireEvent) => void }) {
  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2">
        {loading && <Loader2 size={10} className="text-[var(--amber)] animate-spin" />}
        <span className="text-[var(--text-dim)] italic px-1 py-6 text-center text-[13px]">
          {loading ? 'Loading FIX wire events...' : 'No FIX wire events yet. Launch a scenario to see FIX message flow.'}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {events.map((ev, i) => {
        const color = MSG_TYPE_COLORS[ev.msg_type] || MSG_TYPE_COLORS[ev.type[0]] || 'var(--text-secondary)';
        return (
          <div
            key={i}
            className="mb-0.5 py-1 px-2 rounded cursor-pointer hover:bg-[var(--bg-elevated)]/50 transition-colors"
            onClick={() => onSelect(ev)}
          >
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-dim)] shrink-0">{formatTime(ev.ts)}</span>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="font-semibold shrink-0" style={{ color }}>{ev.type}</span>
              {ev.venue && <span className="text-[var(--text-dim)] shrink-0">{ev.venue}</span>}
              {ev.symbol && (
                <span className="text-[var(--text-secondary)] shrink-0">
                  {ev.side ? `${ev.side} ` : ''}{ev.symbol}
                  {ev.qty && ` ${Number(ev.qty).toLocaleString()}`}
                </span>
              )}
              {ev.cl_ord_id && <span className="text-[var(--text-dim)] ml-auto truncate text-[12px]">{ev.cl_ord_id}</span>}
              <ChevronRight size={12} className="text-[var(--text-dim)] ml-1 shrink-0" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

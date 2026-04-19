'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Radio, Activity, Shield, ChevronDown, ChevronRight, Copy } from 'lucide-react';

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
  'A': 'var(--cyan)',       // Logon
  '0': 'var(--text-muted)', // Heartbeat
  'D': 'var(--green)',      // NewOrderSingle
  '8': 'var(--blue)',       // ExecutionReport
  'F': 'var(--amber)',      // OrderCancel
  'G': 'var(--amber)',      // CancelReplace
  '2': 'var(--purple)',     // ResendRequest
  '5': 'var(--red)',        // Logout
  '4': 'var(--red)',        // SeqReset
  '1': 'var(--text-muted)', // TestRequest
  '3': 'var(--red)',         // Reject
  '9': 'var(--amber)',       // Cancel Ack
  'HB': 'var(--text-dim)',   // Session heartbeat
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

// ── Main Component ─────────────────────────────────────────────────

export default function FixWireLog() {
  const [events, setEvents] = useState<FixWireEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<FixWireEvent | null>(null);

  useEffect(() => {
    const fetchWire = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/fix-wire');
        if (res.ok) {
          const data = await res.json();
          setEvents(data);
        }
      } catch { /* backend may be down */ }
      setLoading(false);
    };
    fetchWire();
    const iv = setInterval(fetchWire, 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events.length]);

  if (selected) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-base)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
          <button onClick={() => setSelected(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <ChevronDown size={14} />
          </button>
          <span className="text-[13px] font-bold text-[var(--text-primary)]">FIX Message Detail</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono">
          <div className="mb-4">
            <div className="text-[12px] text-[var(--text-muted)] mb-1">Event</div>
            <div className="text-[14px] font-bold text-[var(--text-primary)]">{selected.type} ({selected.msg_type})</div>
          </div>
          {selected.venue && (
            <div className="mb-4">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">Venue</div>
              <div className="text-[14px] text-[var(--text-primary)]">{selected.venue}</div>
            </div>
          )}
          {selected.symbol && (
            <div className="mb-4">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">Symbol / Side / Qty</div>
              <div className="text-[14px] text-[var(--text-primary)]">
                {selected.symbol} {selected.side} {Number(selected.qty).toLocaleString()}
              </div>
            </div>
          )}
          {selected.cl_ord_id && (
            <div className="mb-4">
              <div className="text-[12px] text-[var(--text-muted)] mb-1">ClOrdID</div>
              <div className="text-[14px] text-[var(--text-primary)]">{selected.cl_ord_id}</div>
            </div>
          )}
          <div className="mb-2">
            <div className="text-[12px] text-[var(--text-muted)] mb-1">Raw Wire Format</div>
            <div className="text-[12px] text-[var(--green)] bg-[var(--bg-void)] p-4 rounded-md border border-[var(--border-dim)] whitespace-pre-wrap break-all leading-relaxed">
              {selected.raw.split('|').map((seg, i) => (
                <React.Fragment key={i}>
                  {(() => {
                    const [k, ...rest] = seg.split('=');
                    const v = rest.join('=');
                    const color = MSG_TYPE_COLORS[k] || MSG_TYPE_COLORS[selected.msg_type] || 'var(--text-secondary)';
                    if (k === '35' || k === '10' || k === '8' || k === '9' || k === '34' || k === '49' || k === '56' || k === '52' || k === '55' || k === '54' || k === '38' || k === '44' || k === '11' || k === '41' || k === '150' || k === '39') {
                      return (
                        <span key={i} style={{ color }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}</span>=<span>{v}</span>
                        </span>
                      );
                    }
                    return `${seg}`;
                  })()}
                  {i < selected.raw.split('|').length - 1 && <span style={{ color: 'var(--text-dim)' }}>|</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
        <Shield size={14} className="text-[var(--cyan)]" />
        <span className="text-[13px] font-bold text-[var(--cyan)] uppercase tracking-wider">FIX Wire Log</span>
        <span className={`w-2 h-2 rounded-full ${loading ? 'bg-[var(--amber)] animate-pulse' : 'bg-[var(--green)]'}`} />
        <span className="text-[13px] text-[var(--text-muted)] font-mono ml-auto">{events.length} events</span>
      </div>

      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[13px] leading-relaxed">
        {events.length === 0 ? (
          <div className="text-[var(--text-dim)] italic px-1 py-6 text-center text-[13px]">
            No FIX wire events yet. Launch a scenario to see FIX message flow.
          </div>
        ) : (
          events.map((ev, i) => {
            const color = MSG_TYPE_COLORS[ev.msg_type] || MSG_TYPE_COLORS[ev.type[0]] || 'var(--text-secondary)';
            return (
              <div
                key={i}
                className="mb-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--bg-elevated)]/50 transition-colors"
                onClick={() => setSelected(ev)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-dim)] shrink-0">{formatTime(ev.ts)}</span>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold shrink-0" style={{ color }}>{ev.type}</span>
                  {ev.venue && (
                    <span className="text-[var(--text-dim)] shrink-0">{ev.venue}</span>
                  )}
                  {ev.symbol && (
                    <span className="text-[var(--text-secondary)] shrink-0">
                      {ev.side ? `${ev.side} ` : ''}{ev.symbol}
                      {ev.qty && ` ${Number(ev.qty).toLocaleString()}`}
                    </span>
                  )}
                  {ev.cl_ord_id && (
                    <span className="text-[var(--text-dim)] ml-auto truncate text-[12px]">{ev.cl_ord_id}</span>
                  )}
                  <ChevronRight size={12} className="text-[var(--text-dim)] ml-1 shrink-0" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

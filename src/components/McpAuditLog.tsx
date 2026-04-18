'use client';

import React, { useEffect, useRef } from 'react';
import { useAudit } from '@/store/audit';
import { Activity } from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '{}';
  return `{ ${keys.map((k) => `${k}: ${JSON.stringify(args[k])}`).join(', ')} }`;
}

// ── Main Component ─────────────────────────────────────────────────

export default function McpAuditLog() {
  const { entries } = useAudit();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)] border border-[var(--border-dim)] rounded-lg overflow-hidden">
      {/* Header — purple accent */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-dim)] shrink-0">
        <Activity size={12} className="text-[var(--purple)]" />
        <span className="text-[10px] font-bold text-[var(--purple)] uppercase tracking-wider">MCP Audit Log</span>
        <span className={`w-1.5 h-1.5 rounded-full ${entries.some((e) => e.status === 'running') ? 'bg-[var(--amber)] animate-pulse' : 'bg-[var(--green)]'}`} />
        <span className="text-[8px] text-[var(--text-dim)] font-mono ml-auto">{entries.length} entries</span>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed">
        {entries.length === 0 ? (
          <div className="text-[var(--text-dim)] italic px-1 py-4 text-center">
            No tool calls yet. Run a scenario step or use the SRE Copilot to begin.
          </div>
        ) : (
          entries.map((entry) => {
            const statusColor =
              entry.status === 'success' ? 'var(--green)' :
              entry.status === 'error' ? 'var(--red)' :
              'var(--amber)';

            const arrow =
              entry.status === 'success' ? '✓' :
              entry.status === 'error' ? '✗' :
              '▶';

            return (
              <div key={entry.id} className={`mb-1.5 ${entry.status === 'running' ? 'animate-pulse' : ''}`}>
                <div className="text-[var(--text-dim)]">
                  <span className="text-[var(--text-muted)]">[{formatTime(entry.timestamp)}]</span>{' '}
                  <span style={{ color: statusColor }}>{arrow}</span>{' '}
                  <span className="text-[var(--text-secondary)] font-semibold">{entry.tool}</span>{' '}
                  <span className="text-[var(--text-dim)]">{formatArgs(entry.args)}</span>
                </div>
                {entry.result && (
                  <div className="text-[var(--text-muted)] pl-5" style={{ color: statusColor }}>
                    {entry.result}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  Wifi, WifiOff, Activity, AlertTriangle, ChevronDown, ChevronRight,
  RefreshCw, Zap, Eye, RotateCcw, Terminal
} from 'lucide-react';
import type { SessionInfo } from '@/store';

interface Props {
  sessions: SessionInfo[];
  onAction?: (tool: string, args: Record<string, unknown>) => void;
}

export default function HeartbeatPanel({ sessions, onAction }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const healthy = sessions.filter((s) => s.status === 'active').length;
  const degraded = sessions.filter((s) => s.status === 'degraded').length;
  const down = sessions.filter((s) => s.status === 'down').length;

  const statusDot = (s: SessionInfo) => {
    if (s.status === 'down') return <span className="w-2 h-2 rounded-full bg-[var(--red)] inline-block" />;
    if (s.status === 'degraded') return <span className="w-2 h-2 rounded-full bg-[var(--amber)] inline-block animate-pulse" />;
    return <span className="w-2 h-2 rounded-full bg-[var(--green)] inline-block" />;
  };

  const handleAction = (tool: string, args: Record<string, unknown>) => {
    if (onAction) onAction(tool, args);
  };

  return (
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-[var(--cyan)]" />
          <span className="text-[11px] font-bold text-[var(--text-secondary)] tracking-wider uppercase">FIX Sessions</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--green)] font-mono">{healthy} OK</span>
          {degraded > 0 && <span className="text-[10px] text-[var(--amber)] font-mono">{degraded} DEG</span>}
          {down > 0 && <span className="text-[10px] text-[var(--red)] font-mono">{down} DOWN</span>}
        </div>
      </div>

      {/* Session list */}
      <div className="space-y-1">
        {sessions.length === 0 && (
          <div className="text-[11px] text-[var(--text-dim)] italic px-1">No active sessions</div>
        )}
        {sessions.map((s) => {
          const isOpen = expanded === s.venue;
          const hasGap = s.seq_gap;
          const hasError = !!s.error;
          return (
            <div key={s.venue} className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] overflow-hidden">
              {/* Row */}
              <button
                onClick={() => setExpanded(isOpen ? null : s.venue)}
                className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-[var(--bg-elevated)] transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  {statusDot(s)}
                  <span className="text-[11px] font-mono font-semibold text-[var(--text-primary)]">{s.venue}</span>
                  {hasGap && <AlertTriangle size={10} className="text-[var(--red)]" />}
                  {hasError && <span className="text-[9px] px-1 rounded bg-[var(--red-dim)] text-[var(--red)] font-bold">ERR</span>}
                </div>
                <div className="flex items-center gap-2">
                  {s.latency_ms != null && (
                    <span className="text-[10px] font-mono text-[var(--text-dim)]">{s.latency_ms}ms</span>
                  )}
                  {isOpen ? <ChevronDown size={10} className="text-[var(--text-dim)]" /> : <ChevronRight size={10} className="text-[var(--text-dim)]" />}
                </div>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-2 pb-2 pt-1 border-t border-[var(--border-dim)] bg-[var(--bg-elevated)]/40">
                  {/* Session metadata */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Session ID</span>
                      <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{s.session_id || '—'}</div>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Status</span>
                      <div className={`text-[10px] font-mono font-bold ${s.status === 'active' ? 'text-[var(--green)]' : s.status === 'degraded' ? 'text-[var(--amber)]' : 'text-[var(--red)]'}`}>
                        {s.status.toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Last HB</span>
                      <div className="text-[10px] font-mono text-[var(--text-secondary)]">{s.last_heartbeat || '—'}</div>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Latency</span>
                      <div className="text-[10px] font-mono text-[var(--text-secondary)]">{s.latency_ms != null ? `${s.latency_ms}ms` : '—'}</div>
                    </div>
                  </div>

                  {/* Sequence numbers */}
                  <div className="mb-2 p-1.5 rounded bg-[var(--bg-base)] border border-[var(--border-dim)]">
                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Sequences</span>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="text-center">
                        <div className="text-[9px] text-[var(--text-dim)]">Sent</div>
                        <div className="text-[11px] font-mono font-bold text-[var(--cyan)]">{s.last_sent_seq ?? '—'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-[var(--text-dim)]">Recv</div>
                        <div className="text-[11px] font-mono font-bold text-[var(--green)]">{s.last_recv_seq ?? '—'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-[var(--text-dim)]">Exp</div>
                        <div className={`text-[11px] font-mono font-bold ${hasGap ? 'text-[var(--red)]' : 'text-[var(--text-secondary)]'}`}>
                          {s.expected_recv_seq ?? '—'}
                        </div>
                      </div>
                      {hasGap && (
                        <div className="ml-auto">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--red-dim)] text-[var(--red)] font-bold animate-pulse">GAP</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error message */}
                  {hasError && (
                    <div className="mb-2 p-1.5 rounded bg-[var(--red-dim)]/30 border border-[var(--red)]/30">
                      <span className="text-[9px] uppercase tracking-wider text-[var(--red)]">Error</span>
                      <div className="text-[10px] font-mono text-[var(--red)] mt-0.5">{s.error}</div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-1">
                    <ActionBtn
                      icon={<Eye size={10} />}
                      label="Check"
                      onClick={() => handleAction('check_fix_sessions', { venue: s.venue })}
                      variant="default"
                    />
                    <ActionBtn
                      icon={<RefreshCw size={10} />}
                      label="Reconnect"
                      onClick={() => handleAction('fix_session_issue', { venue: s.venue, action: 'reconnect' })}
                      variant={s.status === 'down' ? 'danger' : 'default'}
                    />
                    <ActionBtn
                      icon={<Zap size={10} />}
                      label="Dump"
                      onClick={() => handleAction('dump_session_state', { venue: s.venue })}
                      variant="default"
                    />
                    <ActionBtn
                      icon={<RotateCcw size={10} />}
                      label="Reset Seq"
                      onClick={() => handleAction('fix_session_issue', { venue: s.venue, action: 'reset_sequence' })}
                      variant={hasGap ? 'warning' : 'default'}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, variant }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant: 'default' | 'warning' | 'danger';
}) {
  const cls =
    variant === 'danger'
      ? 'bg-[var(--red-dim)]/40 text-[var(--red)] border-[var(--red)]/30 hover:bg-[var(--red-dim)]'
      : variant === 'warning'
      ? 'bg-[var(--amber-dim)]/40 text-[var(--amber)] border-[var(--amber)]/30 hover:bg-[var(--amber-dim)]'
      : 'bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-dim)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]';

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-semibold transition-all ${cls}`}
    >
      {icon} {label}
    </button>
  );
}

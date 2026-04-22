'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Clock, AlertTriangle, Shield, TrendingUp, Pause, Play, RotateCcw, 
  Save, Undo2, BarChart3, Zap, Target, ChevronDown, ChevronRight,
  FileText, CheckCircle2, XCircle, Activity
} from 'lucide-react';

// ─── Types ───
interface TimeStatus {
  simulated_time: string;
  real_time: string;
  is_paused: boolean;
  pause_reason: string;
  speed_multiplier: number;
  pause_count: number;
  last_trigger: string | null;
}

interface KPIScore {
  name: string;
  weight: number;
  score: number;
  raw_value: string;
  max_value: string;
  details: string;
}

interface TrackedEvent {
  type: string;
  venue: string;
  timestamp: string;
  recovery_time: number | null;
}

interface RecordedAction {
  action: string;
  tool_name: string;
  order_ids: string[];
  approved_by: string;
  risk_flag: string;
  result: string;
  timestamp: string;
}

interface ScoreReport {
  total_weighted_score: number;
  grade: string;
  kpis: KPIScore[];
  duration_seconds: number;
  sla_breaches: number;
  compliance_violations: number;
  notional_preserved: number;
  notional_lost: number;
  events: TrackedEvent[];
  actions: RecordedAction[];
}

interface TrainingStatus {
  time_control: TimeStatus;
  scoring: {
    scenario: string;
    events_tracked: number;
    actions_recorded: number;
    sla_breaches: number;
    compliance_violations: number;
  };
  snapshots: { id: string; label: string; timestamp: string; order_count: number; session_count: number }[];
}

// ─── Time Control Panel ───
function TimeControlPanel() {
  const [status, setStatus] = useState<TimeStatus | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('5');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'time_status', arguments: {} }),
      });
      const data = await res.json();
      // Parse the text response
      const text = data.text || '';
      const statusMatch = text.match(/Simulated:\s*([^\n]+)/);
      const pausedMatch = text.match(/Paused:\s*([^\n]+)/);
      const speedMatch = text.match(/Speed:\s*([^\n]+)/);
      const reasonMatch = text.match(/Reason:\s*([^\n]+)/);
      
      if (statusMatch) {
        setStatus({
          simulated_time: statusMatch[1].trim(),
          real_time: new Date().toISOString(),
          is_paused: pausedMatch?.[1]?.trim() === 'True',
          pause_reason: reasonMatch?.[1]?.trim() || '',
          speed_multiplier: parseFloat(speedMatch?.[1]?.trim() || '60'),
          pause_count: 0,
          last_trigger: null,
        });
      }
    } catch (e) {
      // No training infrastructure yet — silently ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function advanceTime(minutes: number) {
    setAdvancing(true);
    try {
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'advance_time', arguments: { minutes } }),
      });
      await refresh();
    } catch (e) {
      console.error('Failed to advance time:', e);
    } finally {
      setAdvancing(false);
    }
  }

  async function resume() {
    try {
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'resume_simulation', arguments: { notes: 'Operator resumed' } }),
      });
      await refresh();
    } catch (e) {
      console.error('Failed to resume:', e);
    }
  }

  if (!status) return (
    <div className="text-[13px] text-[var(--text-dim)] py-4 px-3 text-center">
      Time control will be available once a scenario is active.
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Current time display */}
      <div className="flex items-center gap-2">
        {status.is_paused ? (
          <Pause size={16} className="text-[var(--amber)] animate-pulse" />
        ) : (
          <Clock size={16} className="text-[var(--green)]" />
        )}
        <div className="flex-1">
          <div className="text-[14px] font-mono font-bold text-[var(--cyan)]">
            {status.simulated_time.split('T')[0]} {status.simulated_time.split('T')[1]?.split('.')[0]}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {status.is_paused ? `PAUSED: ${status.pause_reason}` : 'Running'} · {status.speed_multiplier}x
          </div>
        </div>
      </div>

      {/* Time advance buttons */}
      <div>
        <div className="text-[12px] font-bold text-[var(--text-secondary)] mb-2">Advance Time</div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 5, 15].map(m => (
            <button key={m} onClick={() => advanceTime(m)} disabled={advancing}
              className="py-1.5 px-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:border-[var(--cyan)]/30 transition-all disabled:opacity-50">
              +{m}m
            </button>
          ))}
        </div>
      </div>

      {/* Custom advance */}
      <div className="flex gap-2">
        <input type="number" value={customMinutes}
          onChange={e => setCustomMinutes(e.target.value)}
          className="input-base flex-1 !py-1.5 !px-2 !text-[12px]"
          placeholder="Custom minutes"
        />
        <button onClick={() => advanceTime(parseFloat(customMinutes) || 0)}
          disabled={advancing}
          className="py-1.5 px-4 rounded-md bg-[var(--cyan)]/20 border border-[var(--cyan)]/40 text-[var(--cyan)] text-[12px] font-semibold hover:bg-[var(--cyan)]/30 transition-all disabled:opacity-50">
          {advancing ? '...' : 'Advance'}
        </button>
      </div>

      {/* Resume button if paused */}
      {status.is_paused && (
        <button onClick={resume}
          className="w-full py-2 rounded-lg bg-[var(--amber)]/20 border border-[var(--amber)]/40 text-[var(--amber)] text-[13px] font-bold flex items-center justify-center gap-2 hover:bg-[var(--amber)]/30 transition-all">
          <Play size={14} fill="currentColor" /> Resume Simulation
        </button>
      )}
    </div>
  );
}

// ─── KPI Score Panel ───
function KPIScorePanel() {
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function getScore() {
    setLoading(true);
    try {
      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'score_scenario', arguments: {} }),
      });
      const data = await res.json();
      const text = data.text || '';
      
      // Parse score from text response
      const scoreMatch = text.match(/Overall Score:\s*([\d.]+)/);
      const gradeMatch = text.match(/\(([^)]+)\)/);
      const durationMatch = text.match(/Duration:\s*([\d.]+)s/);
      const slaMatch = text.match(/Breaches:\s*(\d+)\s*\/\s*(\d+)/);
      const preservedMatch = text.match(/Preserved.*\$([0-9,]+)/);
      const lostMatch = text.match(/Lost.*\$([0-9,]+)/);
      const fillRateMatch = text.match(/Fill rate:\s*([\d.]+)%/);

      setReport({
        total_weighted_score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
        grade: gradeMatch?.[1] || '',
        kpis: [],
        duration_seconds: durationMatch ? parseFloat(durationMatch[1]) : 0,
        sla_breaches: slaMatch ? parseInt(slaMatch[1]) : 0,
        compliance_violations: 0,
        notional_preserved: preservedMatch ? parseFloat(preservedMatch[1].replace(/,/g, '')) : 0,
        notional_lost: lostMatch ? parseFloat(lostMatch[1].replace(/,/g, '')) : 0,
        events: [],
        actions: [],
      });
    } catch (e) {
      console.error('Failed to get score:', e);
    } finally {
      setLoading(false);
    }
  }

  if (!report) return (
    <div className="text-center py-4 px-3">
      <BarChart3 size={24} className="text-[var(--text-dim)] mx-auto mb-2" />
      <div className="text-[13px] text-[var(--text-muted)] mb-3">Score your scenario performance</div>
      <button onClick={getScore} disabled={loading}
        className="py-2 px-6 rounded-lg bg-[var(--cyan)]/20 border border-[var(--cyan)]/40 text-[var(--cyan)] text-[13px] font-bold hover:bg-[var(--cyan)]/30 transition-all disabled:opacity-50">
        {loading ? 'Computing...' : 'Compute Score'}
      </button>
    </div>
  );

  const scorePct = Math.round(report.total_weighted_score * 100);
  const scoreColor = scorePct >= 90 ? 'var(--green)' : scorePct >= 75 ? 'var(--cyan)' : scorePct >= 60 ? 'var(--amber)' : 'var(--red)';
  const total = report.notional_preserved + report.notional_lost;
  const fillRate = total > 0 ? (report.notional_preserved / total * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Overall score */}
      <div className="text-center">
        <div className="relative w-20 h-20 mx-auto mb-2">
          <svg viewBox="0 0 36 36" className="w-full h-full">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke="var(--border-dim)" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke={scoreColor} strokeWidth="3"
              strokeDasharray={`${scorePct}, 100`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[20px] font-bold font-mono" style={{ color: scoreColor }}>{scorePct}</span>
            <span className="text-[9px] text-[var(--text-muted)]">/ 100</span>
          </div>
        </div>
        <div className="text-[14px] font-bold mb-1" style={{ color: scoreColor }}>{report.grade}</div>
        <div className="text-[12px] text-[var(--text-muted)]">
          {Math.floor(report.duration_seconds / 60)}m {Math.round(report.duration_seconds % 60)}s
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--bg-surface)] rounded-lg p-2.5 border border-[var(--border-dim)]">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-[var(--amber)]" />
            <span className="text-[11px] text-[var(--text-muted)]">SLA Breaches</span>
          </div>
          <div className="text-[16px] font-bold font-mono">{report.sla_breaches}</div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg p-2.5 border border-[var(--border-dim)]">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield size={12} className="text-[var(--red)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Compliance</span>
          </div>
          <div className="text-[16px] font-bold font-mono">{report.compliance_violations}</div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg p-2.5 border border-[var(--border-dim)]">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={12} className="text-[var(--green)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Filled</span>
          </div>
          <div className="text-[14px] font-bold font-mono text-[var(--green)]">
            ${report.notional_preserved.toLocaleString()}
          </div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg p-2.5 border border-[var(--border-dim)]">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={12} className="text-[var(--amber)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Fill Rate</span>
          </div>
          <div className="text-[14px] font-bold font-mono" style={{ color: fillRate > 70 ? 'var(--green)' : 'var(--amber)' }}>
            {fillRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Events log */}
      {(report.events.length > 0 || report.actions.length > 0) && (
        <div>
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 w-full text-left py-1">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="text-[12px] font-bold text-[var(--text-secondary)]">
              Details ({report.events.length} events, {report.actions.length} actions)
            </span>
          </button>
          {expanded && (
            <div className="space-y-2 max-h-48 overflow-y-auto text-[11px] font-mono">
              {report.events.length > 0 && (
                <div>
                  <div className="text-[var(--amber)] mb-1">Events:</div>
                  {report.events.map((ev, i) => (
                    <div key={i} className="flex items-start gap-2 text-[var(--text-muted)] py-0.5">
                      <span className="text-[var(--red)]">•</span>
                      <span>{ev.type} @ {ev.venue || 'global'}</span>
                      <span className="ml-auto">
                        {ev.recovery_time != null ? `${ev.recovery_time.toFixed(1)}s` : 'UNRESOLVED'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {report.actions.length > 0 && (
                <div>
                  <div className="text-[var(--cyan)] mb-1">Actions:</div>
                  {report.actions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-[var(--text-muted)] py-0.5">
                      <CheckCircle2 size={10} className="text-[var(--green)] mt-0.5" />
                      <span>{a.tool_name} ({a.risk_flag})</span>
                      <span className="ml-auto text-[var(--text-muted)]">{a.approved_by}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button onClick={getScore} disabled={loading}
        className="w-full py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all disabled:opacity-50">
        <RotateCcw size={12} className="inline mr-1" /> Refresh Score
      </button>
    </div>
  );
}

// ─── Snapshots Panel ───
function SnapshotsPanel({ onRollback }: { onRollback: (id: string) => void }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  async function refresh() {
    try {
      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'list_snapshots', arguments: {} }),
      });
      const data = await res.json();
      const text = data.text || '';
      const snaps: any[] = [];
      for (const line of text.split('\n')) {
        const m = line.match(/(snap_\d+)\s+\[([^\]]+)\]\s+(.+?)\s+(\d+)\s+order/);
        if (m) {
          snaps.push({ id: m[1], label: m[2], timestamp: m[3].trim(), order_count: parseInt(m[4]) });
        }
      }
      setSnapshots(snaps);
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'save_snapshot', arguments: { label } }),
      });
      setLabel('');
      await refresh();
    } catch (e) {
      console.error('Failed to save snapshot:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Save new snapshot */}
      <div className="flex gap-2">
        <input type="text" value={label} onChange={e => setLabel(e.target.value)}
          className="input-base flex-1 !py-1.5 !px-2 !text-[12px]"
          placeholder="Audit label (e.g. pre_cancel_001)"
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        <button onClick={save} disabled={saving || !label.trim()}
          className="py-1.5 px-3 rounded-md bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)] text-[12px] font-semibold hover:bg-[var(--green)]/30 transition-all disabled:opacity-50">
          <Save size={12} />
        </button>
      </div>

      {/* Snapshot list */}
      {snapshots.length === 0 ? (
        <div className="text-[12px] text-[var(--text-dim)] italic text-center py-2">
          No snapshots saved yet.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {snapshots.map((snap) => (
            <div key={snap.id}
              className="flex items-center gap-2 bg-[var(--bg-surface)] rounded-md px-2.5 py-2 border border-[var(--border-dim)]">
              <FileText size={12} className="text-[var(--cyan)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-mono font-bold text-[var(--text-secondary)] truncate">
                  {snap.label}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {snap.id} · {snap.order_count} orders
                </div>
              </div>
              <button onClick={() => onRollback(snap.id)}
                className="py-1 px-2 rounded bg-[var(--amber)]/20 border border-[var(--amber)]/30 text-[10px] font-semibold text-[var(--amber)] hover:bg-[var(--amber)]/30 transition-all whitespace-nowrap">
                <Undo2 size={10} className="inline mr-0.5" /> Rollback
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Event Injection Panel ───
function EventInjectionPanel() {
  const [eventType, setEventType] = useState('venue_outage');
  const [target, setTarget] = useState('');
  const [details, setDetails] = useState('');
  const [injecting, setInjecting] = useState(false);
  const [result, setResult] = useState('');

  async function inject() {
    setInjecting(true);
    setResult('');
    try {
      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'inject_event',
          arguments: { event_type: eventType, target: target || undefined, details: details || undefined, delay_sec: 0 },
        }),
      });
      const data = await res.json();
      setResult(data.text || '');
    } catch (e) {
      setResult(`Error: ${e}`);
    } finally {
      setInjecting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
        Inject training events to test your response under pressure. The simulation will auto-pause on disruptive events.
      </div>

      {/* Event type selector */}
      <div>
        <div className="text-[12px] font-bold text-[var(--text-secondary)] mb-2">Event Type</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ['venue_outage', 'Venue Outage', 'var(--red)'],
            ['luld', 'LULD Halt', 'var(--amber)'],
            ['reject_spike', 'Reject Spike', 'var(--red)'],
            ['seq_gap', 'Seq Gap', 'var(--amber)'],
            ['client_message', 'Client Msg', 'var(--cyan)'],
            ['sla_breach', 'SLA Breach', 'var(--red)'],
          ].map(([type, label, color]) => (
            <button key={type} onClick={() => setEventType(type)}
              className={`py-1.5 px-2 rounded-md text-[11px] font-semibold border transition-all ${
                eventType === type
                  ? 'border-[var(--cyan)] bg-[var(--cyan)]/20 text-[var(--cyan)]'
                  : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Target */}
      <div>
        <div className="text-[12px] font-bold text-[var(--text-secondary)] mb-1">Target</div>
        <input type="text" value={target} onChange={e => setTarget(e.target.value)}
          className="input-base w-full !py-1.5 !px-2 !text-[12px]"
          placeholder="Venue (e.g. ARCA) or symbol (e.g. AAPL)"
        />
      </div>

      {/* Details */}
      <div>
        <div className="text-[12px] font-bold text-[var(--text-secondary)] mb-1">Context</div>
        <input type="text" value={details} onChange={e => setDetails(e.target.value)}
          className="input-base w-full !py-1.5 !px-2 !text-[12px]"
          placeholder="Additional context ..."
        />
      </div>

      {/* Inject button */}
      <button onClick={inject} disabled={injecting}
        className="w-full py-2 rounded-lg bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] text-[13px] font-bold flex items-center justify-center gap-2 hover:bg-[var(--red)]/30 transition-all disabled:opacity-50">
        <Zap size={14} fill="currentColor" /> {injecting ? 'Injecting...' : 'Inject Event'}
      </button>

      {/* Result */}
      {result && (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--bg-surface)] rounded-lg p-2.5 border border-[var(--border-dim)] text-[var(--text-secondary)] max-h-32 overflow-y-auto">
          {result}
        </pre>
      )}
    </div>
  );
}

// ─── Main Training Panel (tabs) ───
export function TrainingPanel({ onRollback }: { onRollback: (id: string) => void }) {
  const [tab, setTab] = useState<'time' | 'score' | 'snapshot' | 'inject'>('time');

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border-dim)] px-3 pt-2 shrink-0">
        {([
          ['time', 'Time', Clock],
          ['score', 'Score', BarChart3],
          ['snapshot', 'Snapshots', Save],
          ['inject', 'Inject', Zap],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-all border-b-2 ${
              tab === id 
                ? 'border-[var(--cyan)] text-[var(--cyan)]' 
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'time' && <TimeControlPanel />}
        {tab === 'score' && <KPIScorePanel />}
        {tab === 'snapshot' && <SnapshotsPanel onRollback={onRollback} />}
        {tab === 'inject' && <EventInjectionPanel />}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useSystem, useChat, SessionInfo, OrderInfo, EventEntry } from '@/store';
import {
  AlertTriangle, CheckCircle, XCircle, ArrowRight, Play, RotateCcw, ShieldAlert,
  Activity, FileText, Wrench, Eye, Clock, ChevronRight,
} from 'lucide-react';

type PlaybookStep = {
  id: string;
  label: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
};

const PLAYBOOKS: Record<string, PlaybookStep[]> = {
  afterhours_dark_1630: [
    {
      id: 's1',
      label: 'Inspect FIX sessions',
      tool: 'check_fix_sessions',
      args: {},
      rationale: 'Confirm which venues are logged out vs degraded before touching orders.',
    },
    {
      id: 's2',
      label: 'Query stuck dark-pool orders',
      tool: 'query_orders',
      args: { status: 'stuck' },
      rationale: 'Identify the 200K NVDA Birch block and 4 other dark orders before remediation.',
    },
    {
      id: 's3',
      label: 'Cancel uncleaned DAY orders',
      tool: 'release_stuck_orders',
      args: { reason: 'day_order_cleanup' },
      rationale: 'OMS job failed — clean up 5 stranded DAY orders before they roll overnight.',
    },
    {
      id: 's4',
      label: 'Verify extended-hours health',
      tool: 'check_fix_sessions',
      args: {},
      rationale: 'Post-action check: BATS extended-hours should remain active; ARCA stays logged out per schedule.',
    },
  ],
  morning_triage: [
    { id: 's1', label: 'Inspect FIX sessions', tool: 'check_fix_sessions', args: {}, rationale: 'Confirm ARCA status and BATS seq gap.' },
    { id: 's2', label: 'Fix ARCA session', tool: 'fix_session_issue', args: { venue: 'ARCA' }, rationale: 'Restore ARCA before 06:30 ET DMA flow.' },
    { id: 's3', label: 'Reload RDSA→SHEL ticker', tool: 'load_ticker', args: { symbol: 'SHEL' }, rationale: 'Reconcile rename before 07:00 ET.' },
    { id: 's4', label: 'Verify sessions healthy', tool: 'check_fix_sessions', args: {}, rationale: 'Post-action health check.' },
  ],
};

const GENERIC_PLAYBOOK: PlaybookStep[] = [
  { id: 's1', label: 'Inspect FIX sessions', tool: 'check_fix_sessions', args: {}, rationale: 'Baseline read of all venue sessions.' },
  { id: 's2', label: 'Query open orders', tool: 'query_orders', args: {}, rationale: 'Snapshot of what is at risk.' },
  { id: 's3', label: 'Run premarket check', tool: 'run_premarket_check', args: {}, rationale: 'Full system consistency sweep.' },
];

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'down' ? '#ef4444' :
    status === 'degraded' ? '#f59e0b' :
    '#10b981';
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}

function SectionHeader({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[#8b5cf6]">{icon}</span>
      <span className="text-xs font-semibold tracking-wider uppercase text-[#e4e7f1]">{label}</span>
      {hint && <span className="text-[10px] text-[#5a6178] font-mono">{hint}</span>}
    </div>
  );
}

export function IncidentWorkspace() {
  const { scenario, available_scenarios, sessions, orders, events, mode, callTool } = useSystem();
  const { isOpen: chatOpen, toggleOpen: toggleChat, send: sendChat, openRouterKey } = useChat();
  const [running, setRunning] = useState<Record<string, 'pending' | 'running' | 'success' | 'error'>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  const scenarioDef = useMemo(
    () => available_scenarios.find((s) => s.name === scenario) || null,
    [available_scenarios, scenario],
  );

  const playbook = useMemo<PlaybookStep[]>(() => {
    if (!scenario) return GENERIC_PLAYBOOK;
    return PLAYBOOKS[scenario] || GENERIC_PLAYBOOK;
  }, [scenario]);

  const affectedVenues = sessions.filter((s) => s.status !== 'active');
  const stuckOrders = orders.filter((o) => (o.flags || []).some((f) => f.includes('stuck') || f.includes('dark_pool')));
  const evidenceEvents = events.slice(0, 8);

  const runStep = async (step: PlaybookStep) => {
    setRunning((r) => ({ ...r, [step.id]: 'running' }));
    try {
      const out = await callTool(step.tool, step.args);
      setRunning((r) => ({ ...r, [step.id]: 'success' }));
      setResults((rs) => ({ ...rs, [step.id]: out.slice(0, 280) }));
    } catch (err) {
      setRunning((r) => ({ ...r, [step.id]: 'error' }));
      setResults((rs) => ({ ...rs, [step.id]: (err as Error).message }));
    }
  };

  const askCopilot = (q: string) => {
    if (!openRouterKey) {
      if (!chatOpen) toggleChat();
      return;
    }
    if (!chatOpen) toggleChat();
    sendChat(q);
  };

  if (!scenario) {
    return (
      <div className="h-full flex items-center justify-center text-[#5a6178] text-xs">
        Select a scenario to open an incident workspace.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0b0e] text-[#e4e7f1]">
      <div className="p-4 space-y-5">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={14} className="text-[#ef4444]" />
              <span className="text-[10px] font-mono text-[#ef4444] uppercase tracking-wider">Active Incident</span>
              <span className="text-[10px] font-mono text-[#5a6178]">{scenario}</span>
            </div>
            <h2 className="text-sm font-semibold text-[#e4e7f1]">
              {scenarioDef?.context?.split(' — ')[0] || scenario}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className={`px-2 py-0.5 rounded border ${
              mode === 'agent'
                ? 'text-[#8b5cf6] border-[#8b5cf6]/50'
                : 'text-[#f59e0b] border-[#f59e0b]/50'
            }`}>
              {mode === 'agent' ? 'AGENT MODE' : 'HUMAN PLAYBOOK'}
            </span>
          </div>
        </div>

        {/* ── 1. Incident Summary ────────────────────────────────── */}
        <section>
          <SectionHeader icon={<FileText size={12} />} label="Incident Summary" />
          <p className="text-xs text-[#8b92a8] leading-relaxed">
            {scenarioDef?.context || 'No scenario context available.'}
          </p>
          <button
            onClick={() => askCopilot(`What is the root cause of the ${scenario} incident? Be concise.`)}
            className="mt-2 text-[10px] text-[#8b5cf6] hover:text-[#a78bfa] underline-offset-2 hover:underline"
          >
            Ask Copilot to explain root cause →
          </button>
        </section>

        {/* ── 2. Impact ──────────────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={<AlertTriangle size={12} />}
            label="Impact"
            hint={`${affectedVenues.length} venues • ${stuckOrders.length} stuck orders`}
          />
          <div className="space-y-1.5">
            {affectedVenues.length === 0 && (
              <div className="text-[10px] text-[#5a6178]">All sessions active.</div>
            )}
            {affectedVenues.map((s) => (
              <VenueRow key={s.venue} session={s} />
            ))}
          </div>
          {stuckOrders.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-[#5a6178] font-mono mb-1">Affected orders (top 5)</div>
              <div className="space-y-1">
                {stuckOrders.slice(0, 5).map((o) => <OrderRow key={o.order_id} order={o} />)}
              </div>
            </div>
          )}
        </section>

        {/* ── 3. Evidence ────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Eye size={12} />} label="Evidence" hint={`${evidenceEvents.length} recent events`} />
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {evidenceEvents.length === 0 && (
              <div className="text-[10px] text-[#5a6178]">
                No events yet. Tool calls and session changes will appear here.
              </div>
            )}
            {evidenceEvents.map((ev, i) => <EvidenceRow key={i} entry={ev} />)}
          </div>
        </section>

        {/* ── 4. Recommended Plan + Action Controls ──────────────── */}
        <section>
          <SectionHeader
            icon={<Wrench size={12} />}
            label="Recommended Plan"
            hint={PLAYBOOKS[scenario] ? 'scenario playbook' : 'generic playbook'}
          />
          <div className="space-y-2">
            {playbook.map((step, i) => (
              <PlaybookRow
                key={step.id}
                step={step}
                index={i}
                state={running[step.id] || 'pending'}
                result={results[step.id]}
                mode={mode}
                onRun={() => runStep(step)}
                onAsk={() => askCopilot(`For step ${i + 1} (${step.label}), what happens and what should I watch for?`)}
              />
            ))}
          </div>
        </section>

        {/* ── 5. Verification ────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<CheckCircle size={12} />} label="Verification" />
          <div className="flex items-center gap-2 text-[11px]">
            <VerifyPill
              label="All venues active"
              ok={sessions.every((s) => s.status === 'active')}
            />
            <VerifyPill
              label="No stuck orders"
              ok={stuckOrders.length === 0}
            />
            <VerifyPill
              label="No seq gaps"
              ok={sessions.every((s) => !s.seq_gap)}
            />
          </div>
        </section>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function VenueRow({ session }: { session: SessionInfo }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono py-1 px-2 bg-[#12141a] border border-[#1e2233] rounded">
      <StatusDot status={session.status} />
      <span className="text-[#e4e7f1] font-semibold">{session.venue}</span>
      <span className="text-[#5a6178]">{session.session_id}</span>
      {session.seq_gap && (
        <span className="text-[#f59e0b]">seq {session.last_recv_seq}→{session.expected_recv_seq}</span>
      )}
      {session.error && <span className="text-[#ef4444] truncate">{session.error}</span>}
      <span className="ml-auto text-[#5a6178]">{session.latency_ms ?? '—'}ms</span>
    </div>
  );
}

function OrderRow({ order }: { order: OrderInfo }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono py-1 px-2 bg-[#12141a] border border-[#1e2233] rounded">
      <span className="text-[#e4e7f1]">{order.symbol}</span>
      <span className="text-[#5a6178]">{order.side}</span>
      <span className="text-[#5a6178]">{order.quantity.toLocaleString()}</span>
      <span className="text-[#8b92a8]">{order.client_name}</span>
      <span className="ml-auto text-[#f59e0b]">{(order.flags || []).join(',')}</span>
    </div>
  );
}

function EvidenceRow({ entry }: { entry: EventEntry }) {
  const okColor = entry.ok ? 'text-[#10b981]' : 'text-[#ef4444]';
  return (
    <div className="text-[10px] font-mono flex items-center gap-2 py-1 px-2 bg-[#0d0f13] border border-[#1a1d26] rounded">
      <Clock size={9} className="text-[#5a6178] shrink-0" />
      <span className="text-[#5a6178] shrink-0">{entry.ts?.slice(11, 19)}</span>
      <span className="text-[#8b92a8] shrink-0">{entry.source}</span>
      <span className={`${okColor} shrink-0`}>{entry.tool}</span>
      <span className="text-[#8b92a8] truncate">{entry.summary}</span>
    </div>
  );
}

function PlaybookRow({
  step, index, state, result, mode, onRun, onAsk,
}: {
  step: PlaybookStep;
  index: number;
  state: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  mode: string;
  onRun: () => void;
  onAsk: () => void;
}) {
  const stateIcon =
    state === 'running' ? <Activity size={11} className="text-[#3b82f6] animate-pulse" /> :
    state === 'success' ? <CheckCircle size={11} className="text-[#10b981]" /> :
    state === 'error'   ? <XCircle size={11} className="text-[#ef4444]" /> :
                          <ChevronRight size={11} className="text-[#5a6178]" />;

  const runLabel = mode === 'agent' ? 'Approve' : 'Execute';

  return (
    <div className="bg-[#12141a] border border-[#1e2233] rounded-lg p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-[10px] font-mono text-[#5a6178] mt-0.5">{index + 1}.</span>
          {stateIcon}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#e4e7f1]">{step.label}</div>
            <div className="text-[10px] text-[#5a6178] mt-0.5">{step.rationale}</div>
            <div className="text-[10px] font-mono text-[#3b82f6] mt-1">
              {step.tool}({Object.keys(step.args).length > 0 ? JSON.stringify(step.args) : ''})
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onAsk}
            className="text-[10px] text-[#5a6178] hover:text-[#8b5cf6] px-2 py-1 rounded"
          >
            Ask
          </button>
          <button
            onClick={onRun}
            disabled={state === 'running'}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded transition-colors ${
              state === 'success'
                ? 'bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30'
                : state === 'error'
                ? 'bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30'
                : 'bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/40 hover:bg-[#8b5cf6]/25'
            }`}
          >
            {state === 'running' ? 'Running…' : state === 'success' ? 'Done' : runLabel}
          </button>
        </div>
      </div>
      {result && (
        <div className="mt-2 text-[10px] font-mono text-[#8b92a8] bg-[#0a0b0e] border border-[#1a1d26] rounded p-2 whitespace-pre-wrap break-words">
          {result}
        </div>
      )}
    </div>
  );
}

function VerifyPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
      ok
        ? 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30'
        : 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30'
    }`}>
      {ok ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
      {label}
    </span>
  );
}

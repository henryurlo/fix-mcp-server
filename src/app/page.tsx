'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';

import EvidencePanel from '@/components/EvidencePanel';
import CompletionScreen from '@/components/CompletionScreen';
import CaseBrief from '@/components/CaseBrief';
import FixWireView from '@/components/FixWireView';
import useKeyboardShortcuts from '@/hooks/useKeyboardShortcuts';

import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep, TrackedStep } from '@/store';
import {
  Activity, Terminal as TerminalIcon, PlusCircle, LogOut, Play, Layers,
  Radio, BookOpen, RotateCcw, BookMarked, MessageSquare,
  Eye, EyeOff, Loader2, ChevronRight, CheckCircle2, XCircle, Info,
  PanelLeftOpen, PanelLeftClose, ArrowRight, FileText, Send, Wrench,
  ChevronDown, ChevronUp, AlertTriangle, Lightbulb, Zap, Eye as EyeIcon, Star,
  X, Trophy, Clock, Award, GraduationCap, HelpCircle, BookOpenCheck, FlaskConical,
  BarChart3,
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator').then(m => ({ default: m.ScenarioCreator })), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const AuditLog = dynamic(() => import('@/components/AuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });
const TrainingPanel = dynamic(() => import('@/components/TrainingPanel').then(m => ({ default: m.TrainingPanel })), { ssr: false });
const TraceTab = dynamic(() => import('@/components/TraceTab').then(m => ({ default: m.TraceTab })), { ssr: false });
const OnboardingPanel = dynamic(() => import('@/components/OnboardingPanel').then(m => ({ default: m.OnboardingPanel })), { ssr: false, loading: () => null });
const ManualRunbookPanel = dynamic(() => import('@/components/ManualRunbookPanel').then(m => ({ default: m.ManualRunbookPanel })), { ssr: false });

const MANUAL_RUNBOOK_MAP: Record<string, Array<{ label: string; language: string; code: string }>> = {
  check_fix_sessions: [
    { label: 'Tail FIX session logs', language: 'bash', code: 'tail -n 50 /opt/fix/logs/<VENUE>-PROD-01.log' },
    { label: 'Probe heartbeat', language: 'bash', code: 'fix-cli heartbeat <VENUE>' },
  ],
  fix_session_issue: [
    { label: 'Reconnect session', language: 'bash', code: 'fix-cli fix <VENUE>' },
    { label: 'Dump session state', language: 'bash', code: 'fix-cli dump <VENUE>' },
  ],
  query_orders: [
    { label: 'Query open orders', language: 'bash', code: 'fix-cli show orders --open' },
    { label: 'Filter by venue', language: 'bash', code: 'fix-cli show orders --venue <VENUE>' },
  ],
  send_order: [
    { label: 'Submit NewOrderSingle', language: 'fix', code: '35=D | 55=<SYMBOL> | 54=<SIDE> | 38=<QTY> | 40=<TYPE> | 100=<VENUE>' },
  ],
  cancel_replace: [
    { label: 'Cancel or replace order', language: 'fix', code: '35=F / 35=G | 41=<OrigClOrdID> | 11=<NewClOrdID>' },
  ],
  update_ticker: [
    { label: 'Update reference symbol mapping', language: 'sql', code: 'UPDATE reference_symbols SET symbol = <NEW> WHERE symbol = <OLD>;' },
  ],
  load_ticker: [
    { label: 'Load new listing/IPO', language: 'sql', code: 'INSERT INTO reference_symbols (symbol, venue, status) VALUES (...);' },
  ],
  release_stuck_orders: [
    { label: 'Release stuck queue', language: 'bash', code: 'fix-cli release stuck' },
  ],
  inject_event: [
    { label: 'Inject desk stress event', language: 'mcp', code: 'inject_event(event_type=<TYPE>, target=<TARGET>, details=<DETAILS>)' },
  ],
  score_scenario: [
    { label: 'Score the scenario', language: 'mcp', code: 'score_scenario()' },
  ],
};

const SEV: Record<string, string> = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--purple)' };
const SEV_BG: Record<string, string> = { low: 'var(--green-dim)', medium: 'var(--amber-dim)', high: 'var(--red-dim)', critical: 'var(--purple-dim)' };

// ═══════════════════════════════════════════════════════════
// Collapsible Step Output
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Completion Screen Modal
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Keyboard shortcuts hook
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [activeTab, setActiveTab] = useState<'mission-control' | 'scenario-library'>('mission-control');
  const { scenario, scenarioContext, scenarioState, available_scenarios, refresh, error, connected, startScenario, sessions, trackedSteps, callTool, setStepStatus, completeStep, addAlert, addHostEvent, locked } = useSystem();
  const { isOpen, toggleOpen } = useChat();
  const { isAuthenticated, user, logout } = useAuth();

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const iv = setInterval(() => { refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleReset = useCallback(async () => {
    try {
      await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'clear' }) });
      useSystem.setState({ scenario: null, scenarioContext: null, scenarioState: 'idle', completedSteps: [], trackedSteps: [], locked: false });
    } catch (e) { console.error('Reset failed:', e); }
  }, []);

  const launchScenarioFromHeader = useCallback(async (name: string) => {
    const scenarioMeta = available_scenarios?.find((s: any) => s.name === name);
    await startScenario(name);
    const chat = useChat.getState();
    if (!chat.isOpen) chat.toggleOpen();
    await chat.openWithPrompt(`Start a new scenario: ${scenarioMeta?.title || name}. Summarize the incident, tell me what matters first, and guide the first action.`);
  }, [available_scenarios, startScenario]);

  const stressTestCurrentScenario = useCallback(async () => {
    if (!scenario) return;
    const scenarioMeta = available_scenarios?.find((s: any) => s.name === scenario);
    try {
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'inject_event',
          arguments: { event_type: 'reject_spike', target: 'desk', details: `Header stress test for ${scenarioMeta?.title || scenario}`, delay_sec: 0 },
        }),
      });
      const chat = useChat.getState();
      if (!chat.isOpen) chat.toggleOpen();
      await chat.openWithPrompt(`Stress test the active scenario ${scenarioMeta?.title || scenario}. A reject spike was injected. Triage it and guide the response.`);
    } catch (e) {
      console.error('Stress test failed:', e);
    }
  }, [available_scenarios, scenario]);

  const titleName = scenarioContext?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Auto-show onboarding for first-time visitors
  useEffect(() => {
    if (!showOnboarding && typeof window !== 'undefined' && !localStorage.getItem('hasSeenOnboarding')) {
      setShowOnboarding(true);
      localStorage.setItem('hasSeenOnboarding', 'true');
    }
  }, []);

  if (!isAuthenticated) return <AuthGate />;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)]">
      {/* ═══ HEADER ═══ */}
      <header className="h-12 border-b border-[var(--border-dim)] flex items-center justify-between px-4 shrink-0 bg-[var(--bg-base)]">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-bold tracking-wider">FIX-MCP</span>
          <span className="hidden md:inline text-[12px] text-[var(--text-dim)]">AI Trading Ops Simulator</span>
          {scenario && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={8} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-bold text-[var(--cyan)]">{titleName}</span>
            </div>
          )}
        </div>
        <nav className="flex gap-0.5 bg-[var(--bg-surface)] rounded-lg p-0.5 border border-[var(--border-dim)]">
          {([
            ['mission-control', 'Mission Control', Layers],
            ['scenario-library', 'Scenario Library', PlusCircle],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-all ${activeTab === id ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className={`text-[13px] font-mono ${connected ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{connected ? '● LIVE' : '● OFFLINE'}</span>
          <select value={scenario || ''} onChange={(e) => e.target.value && launchScenarioFromHeader(e.target.value)}
            className="input-base !w-auto !py-1.5 !px-3 !text-[13px] !font-mono !rounded-md max-w-[220px]">
            <option value="">▶ Launch Scenario…</option>
            {available_scenarios?.map((s: any) => (
              <option key={s.name} value={s.name}>{s.title || s.name} ({s.estimated_minutes}m)</option>
            ))}
          </select>
          {scenario && (
            <>
              <button onClick={stressTestCurrentScenario}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--amber-dim)]/40 text-[var(--amber)] border border-[var(--amber)]/30 text-[13px] font-semibold hover:bg-[var(--amber-dim)] transition-all">
                <FlaskConical size={12} /> Stress Test
              </button>
              <button onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--red-dim)]/40 text-[var(--red)] border border-[var(--red)]/30 text-[13px] font-semibold hover:bg-[var(--red-dim)] transition-all">
                <RotateCcw size={12} /> Reset
              </button>
            </>
          )}
          <div className="relative group">
            <button onClick={toggleOpen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold border transition-all ${isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:text-[var(--text-secondary)]'}`}>
              <MessageSquare size={13} /> Copilot
            </button>
            <div className="invisible group-hover:visible absolute right-0 top-full mt-2 z-[100] w-64 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">AI assistant — ask it to diagnose issues, suggest fixes, or run commands for you. Opens in a chat panel on the right.</p>
            </div>
          </div>
          <div className="relative group">
            <button onClick={() => setShowOnboarding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold border border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              <HelpCircle size={13} /> Tour
            </button>
            <div className="invisible group-hover:visible absolute right-0 top-full mt-2 z-[100] w-64 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">Open the product tour to frame the system: what FIX-MCP is, how MCP tools map to trading operations, and the best flow for a live demo.</p>
            </div>
          </div>
          <span className="text-[13px] font-mono text-[var(--text-muted)]">{user?.username || 'anon'}</span>
          <button onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--red)]"><LogOut size={14} /></button>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {activeTab === 'mission-control' && (
            <MissionControlTab
              scenario={scenario}
              available_scenarios={available_scenarios}
              onOpenScenarioBuilder={() => setActiveTab('scenario-library')}
            />
          )}
          {activeTab === 'scenario-library' && <ScenarioCreator />}
        </main>
        <aside className={`transition-all duration-300 bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[420px]' : 'w-0'} overflow-hidden shrink-0`}><ChatPanel /></aside>
      </div>
      {showOnboarding && <OnboardingPanel onClose={() => setShowOnboarding(false)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Live Telemetry Strip — compact system status inside Mission Control
// ═══════════════════════════════════════════════════════════

function LiveTelemetryStrip() {
  const { sessions, open_count, stuck_count, trackedSteps, scenarioState } = useSystem();
  const healthy = sessions.filter((s) => s.status === 'active').length;
  const degraded = sessions.filter((s) => s.status === 'degraded').length;
  const down = sessions.filter((s) => s.status === 'down').length;
  const done = trackedSteps.filter((s) => s.status === 'done').length;
  const total = trackedSteps.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] p-1.5 text-center">
        <div className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Sessions</div>
        <div className="flex items-center justify-center gap-1 mt-0.5">
          <span className="text-[11px] font-mono font-bold text-[var(--green)]">{healthy}</span>
          {degraded > 0 && <span className="text-[11px] font-mono font-bold text-[var(--amber)]">{degraded}</span>}
          {down > 0 && <span className="text-[11px] font-mono font-bold text-[var(--red)]">{down}</span>}
        </div>
      </div>
      <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] p-1.5 text-center">
        <div className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Orders</div>
        <div className="flex items-center justify-center gap-1 mt-0.5">
          <span className="text-[11px] font-mono font-bold text-[var(--cyan)]">{open_count}</span>
          {stuck_count > 0 && (
            <span className="text-[11px] font-mono font-bold text-[var(--red)]">{stuck_count}stk</span>
          )}
        </div>
      </div>
      <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] p-1.5 text-center">
        <div className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">Progress</div>
        <div className="mt-0.5 text-[11px] font-mono font-bold text-[var(--text-secondary)]">{progress}%</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Mission Control Tab — main scenario workspace
// ═══════════════════════════════════════════════════════════

function MissionControlTab({
  scenario: parentScenario,
  available_scenarios: parentScenarios,
  onOpenScenarioBuilder,
}: {
  scenario: string | null;
  available_scenarios: any[];
  onOpenScenarioBuilder: () => void;
}) {
  const { scenario, scenarioContext, scenarioState, sessions, startScenario, trackedSteps, callTool, setStepStatus, completeStep, addAlert, addHostEvent, open_count, stuck_count } = useSystem();
  const { isOpen: chatOpen, toggleOpen: toggleChat } = useChat();
  const [bottomTab, setBottomTab] = useState<'case' | 'terminal' | 'fixwire' | 'trace' | 'runbook'>('case');
  const activeScenarios = useSystem.getState().available_scenarios || parentScenarios || [];

  const runbook = scenarioContext?.runbook;
  const steps = trackedSteps.length > 0
    ? trackedSteps.map((t: TrackedStep) => ({ ...t, output: t.output || '' }))
    : (runbook?.steps || []).map((s: RunbookStep, i: number) => ({ ...s, status: 'idle' as const, output: '' }));

  const [currentStep, setCurrentStep] = useState(0);
  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [stepResults, setStepResults] = useState<Record<number, string>>({});
  const [showCaseBrief, setShowCaseBrief] = useState(true);
  const runbookScrollRef = useRef<HTMLDivElement>(null);

  // Focus mode state
  const [focusMode, setFocusMode] = useState(false);
  const [topologyCollapsed, setTopologyCollapsed] = useState(false);

  // Completion screen state
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionTimer, setCompletionTimer] = useState<number>(0);

  // Hints tracking
  const [hintsUsedCount, setHintsUsedCount] = useState(0);
  const [showTraining, setShowTraining] = useState(false);
  const [heroAction, setHeroAction] = useState<'launching' | 'stressing' | null>(null);
  const [showEvidenceBoard, setShowEvidenceBoard] = useState(false);
  const [completedStepAudit, setCompletedStepAudit] = useState<Array<{ step: number; title: string; tool: string; output: string; commands: Array<{ label: string; language: string; code: string }> }>>([]);
  const [completionSummary, setCompletionSummary] = useState('');

  // Reset state on scenario change
  useEffect(() => {
    setShowCaseBrief(true);
    setCurrentStep(0);
    setRevealedHints(new Set());
    setFocusMode(false);
    setTopologyCollapsed(false);
    setShowCompletion(false);
    setShowEvidenceBoard(false);
    setCompletedStepAudit([]);
    setCompletionSummary('');
    setCompletionTimer(Date.now());
    setHintsUsedCount(0);
    setShowTraining(false);
    runbookScrollRef.current?.scrollTo({ top: 0 });
  }, [scenario]);

  // Start timer when case study begins
  useEffect(() => {
    if (scenario && completionTimer === 0) {
      setCompletionTimer(Date.now());
    }
  }, [scenario]);

  const doneCount = trackedSteps.filter(s => s.status === 'done').length;
  const totalSteps = steps.length;
  const allDone = doneCount >= totalSteps && totalSteps > 0;
  const progressPct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
  const downCount = sessions.filter((s) => s.status === 'down').length;
  const degradedCount = sessions.filter((s) => s.status === 'degraded').length;
  const featuredScenarios = [...activeScenarios]
    .sort((a, b) => {
      const rank = (sev: string) => ({ critical: 4, high: 3, medium: 2, low: 1 }[String(sev || '').toLowerCase()] || 0);
      return rank(b.severity) - rank(a.severity);
    })
    .slice(0, 4);

  // Show completion screen when all done
  useEffect(() => {
    if (allDone && !showCompletion) {
      const summary = completedStepAudit.length > 0
        ? `Scenario completed successfully. ${completedStepAudit.length} runbook steps executed with visible MCP evidence and mapped FIX/manual commands.`
        : 'Scenario completed successfully.';
      setCompletionSummary(summary);
      setShowCompletion(true);
      setShowEvidenceBoard(true);
    }
  }, [allDone, completedStepAudit, showCompletion]);

  async function runStep(step: typeof steps[0], idx: number) {
    if (step.status === 'running') return;
    setStepStatus(step.step, 'running');
    try {
      const result = await callTool(step.tool, step.tool_args);
      const manualCommands = MANUAL_RUNBOOK_MAP[step.tool] || [];
      setStepStatus(step.step, 'done', result);
      setStepResults(prev => ({ ...prev, [step.step]: result }));
      setCompletedStepAudit(prev => {
        const next = prev.filter(entry => entry.step !== step.step);
        next.push({ step: step.step, title: step.title, tool: step.tool, output: result, commands: manualCommands });
        return next.sort((a, b) => a.step - b.step);
      });
      completeStep(step.step);
      addAlert(`Step ${step.step} complete`, 'success', 3000);
      if (idx + 1 < steps.length) {
        setCurrentStep(idx + 1);
      }
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      setStepResults(prev => ({ ...prev, [step.step]: `Error: ${err.message}` }));
    }
  }

  function toggleHint(stepIdx: number) {
    setRevealedHints(prev => {
      const next = new Set(prev);
      if (next.has(stepIdx)) {
        next.delete(stepIdx);
      } else {
        next.add(stepIdx);
        setHintsUsedCount(c => c + 1);
      }
      return next;
    });
  }

  const current = steps[currentStep];

  // Count expanded steps (for auto-collapse)
  const expandedCount = useMemo(() => {
    return steps.filter((s: any) => s.status === 'done' && stepResults[s.step]).length;
  }, [steps, stepResults]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onRun: current && scenario ? () => runStep(current, currentStep) : undefined,
    onHint: current && scenario ? () => toggleHint(currentStep) : undefined,
    onToggleCopilot: () => toggleChat(),
    onNavPrev: () => currentStep > 0 ? setCurrentStep(currentStep - 1) : undefined,
    onNavNext: () => currentStep < steps.length - 1 ? setCurrentStep(currentStep + 1) : undefined,
  });

  async function launchActiveScenarioInCopilot() {
    if (!scenario || !activeScenarios.length) return;
    const meta = activeScenarios.find((s: any) => s.name === scenario);
    const chat = useChat.getState();
    if (!chat.isOpen) chat.toggleOpen();
    await chat.openWithPrompt(`Start a new scenario: ${meta?.title || scenario}. Summarize the incident, tell me what matters first, and guide the first action.`);
  }

  async function injectStressEvent() {
    if (!scenario) return;
    await fetch('/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'inject_event',
        arguments: { event_type: 'reject_spike', target: 'desk', details: `Mission control stress test for ${scenario}`, delay_sec: 0 },
      }),
    });
  }

  async function startGuidedLaunch() {
    setHeroAction('launching');
    try {
      await launchActiveScenarioInCopilot();
      setShowCaseBrief(false);
    } finally {
      setHeroAction(null);
    }
  }

  async function startGuidedStress() {
    setHeroAction('stressing');
    try {
      await injectStressEvent();
      const chat = useChat.getState();
      if (!chat.isOpen) chat.toggleOpen();
      await chat.openWithPrompt(`Stress test the active scenario ${activeScenario?.title || scenario}. A reject spike was injected. Triage the incident and guide the response.`);
      setShowTraining(true);
      setBottomTab('case');
    } finally {
      setHeroAction(null);
    }
  }

  if (!scenario) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-void)]">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
              <div className="rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-6 shadow-2xl">
                <div className="flex flex-wrap gap-2 mb-4 text-[11px] font-mono uppercase tracking-wide text-[var(--text-dim)]">
                  <span className="rounded-full border border-[var(--cyan)]/30 bg-[var(--cyan-dim)] px-2 py-1 text-[var(--cyan)]">FIX protocol</span>
                  <span className="rounded-full border border-[var(--purple)]/30 bg-[var(--purple-dim)] px-2 py-1 text-[var(--purple)]">MCP tools</span>
                  <span className="rounded-full border border-[var(--green)]/30 bg-[var(--green-dim)] px-2 py-1 text-[var(--green)]">AI copilot</span>
                </div>
                <h1 className="text-[32px] leading-tight font-bold mb-3 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">
                  A trading desk you can break, inspect, and recover live.
                </h1>
                <p className="text-[16px] text-[var(--text-secondary)] leading-relaxed max-w-3xl">
                  FIX-MCP is not just a dashboard. It is a scenario-driven trading operations simulator that shows how a human or AI operator can diagnose venue failures, stale market data, corporate actions, and algo drift through explainable MCP tools and real desk runbooks.
                </p>

                <div className="grid gap-3 md:grid-cols-3 mt-5">
                  {[
                    { title: 'Micro trading desk', desc: 'Venues, broker, market data, storage, and client flows visualized as one live system.' },
                    { title: 'AI with receipts', desc: 'Trace every action and show the exact command a human SRE would run manually.' },
                    { title: 'Demo-ready incidents', desc: 'Open, pre-market, dark pool, LULD, ticker rename, and algo execution crises.' },
                  ].map((item) => (
                    <div key={item.title} className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-4">
                      <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1">{item.title}</div>
                      <div className="text-[13px] leading-relaxed text-[var(--text-muted)]">{item.desc}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-[var(--text-dim)] mb-2">Best live demo paths</div>
                  <div className="flex flex-wrap gap-2">
                    {featuredScenarios.map((s: any) => (
                      <button key={s.name} onClick={() => startScenario(s.name)}
                        className="rounded-full border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/50 hover:text-[var(--cyan)] transition-colors">
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-6">
                <div className="text-[12px] font-bold uppercase tracking-wide text-[var(--text-dim)] mb-3">Why it lands in a room</div>
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-4">
                    <div className="text-[24px] font-bold text-[var(--cyan)]">{activeScenarios.length}</div>
                    <div className="text-[13px] text-[var(--text-secondary)]">Live incidents ready to run</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-4">
                    <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1">Show three layers together</div>
                    <div className="text-[13px] text-[var(--text-muted)] leading-relaxed">Topology for the system story, case study for the operator story, trace and runbook for the AI/MCP explainability story.</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-4">
                    <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1">Ideal audience framing</div>
                    <div className="text-[13px] text-[var(--text-muted)] leading-relaxed">Trading desk: resilience. SRE: incident response. AI audience: tools, autonomy, and auditability.</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[18px] font-bold text-[var(--text-primary)]">Scenario Library</h2>
                  <p className="text-[13px] text-[var(--text-muted)]">Pick the desk failure you want to present. Each scenario has a story, runbook, and success criteria.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                {activeScenarios?.map((s: any) => (
                  <button key={s.name} onClick={() => startScenario(s.name)}
                    className="p-4 rounded-xl border border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--cyan)]/50 hover:bg-[var(--bg-elevated)] transition-all text-left group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Play size={12} className="text-[var(--cyan)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[15px] font-bold group-hover:text-[var(--cyan)] transition-colors">{s.title || s.name}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: SEV_BG[s.severity], color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{s.description?.slice(0, 160)}...</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[var(--text-dim)]">{s.estimated_minutes} min</span>
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[var(--text-dim)]">{s.runbook_step_count || '?'} steps</span>
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-dim)]">{s.difficulty || 'intermediate'}</span>
                    </div>
                    {s.categories?.length > 0 && (
                      <div className="mt-2 text-[12px] text-[var(--text-dim)]">{s.categories.join(' · ')}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Scenario active ──
  const activeScenario = scenarioContext || null;
  const activeTitle = activeScenario?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      <div className="border-b border-[var(--border-dim)] bg-[var(--bg-base)] px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-5 shadow-2xl">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="rounded-full border border-[var(--cyan)]/30 bg-[var(--cyan-dim)] px-2.5 py-1 text-[11px] font-mono text-[var(--cyan)]">LIVE INCIDENT</span>
              <span className="rounded-full border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-mono text-[var(--text-dim)]">{scenario}</span>
              <span className="rounded-full border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-mono text-[var(--text-dim)]">{activeScenario?.simulated_time || '—'}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[28px] leading-tight font-bold text-[var(--text-primary)]">{activeTitle}</h1>
                <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-[var(--text-secondary)]">
                  {activeScenario?.description || activeScenario?.runbook?.narrative || 'Live trading operations incident loaded.'}
                </p>
              </div>
              <div className="hidden xl:flex flex-col gap-2 min-w-[180px]">
                <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Scenario lens</div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">{activeScenario?.categories?.join(' · ') || 'ops incident'}</div>
                </div>
                <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Guided by</div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">Chatbot + MCP tools</div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Notional pressure</div>
                <div className="mt-1 text-[24px] font-bold text-[var(--text-primary)]">{open_count}</div>
                <div className="text-[12px] text-[var(--text-muted)]">open orders at risk</div>
              </div>
              <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Venue health</div>
                <div className="mt-1 text-[24px] font-bold text-[var(--text-primary)]">{downCount + degradedCount}</div>
                <div className="text-[12px] text-[var(--text-muted)]">{downCount} down · {degradedCount} degraded</div>
              </div>
              <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Runbook</div>
                <div className="mt-1 text-[24px] font-bold text-[var(--text-primary)]">{totalSteps}</div>
                <div className="text-[12px] text-[var(--text-muted)]">explainable recovery steps</div>
              </div>
              <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Current progress</div>
                <div className="mt-1 text-[24px] font-bold text-[var(--text-primary)]">{progressPct}%</div>
                <div className="text-[12px] text-[var(--text-muted)]">{doneCount}/{totalSteps} steps complete</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-[12px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Scenario Ops</div>
                <div className="text-[18px] font-bold text-[var(--text-primary)]">Run the desk</div>
              </div>
              <button onClick={onOpenScenarioBuilder} className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--cyan)] transition-colors">
                Create / Load Scenarios
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={startGuidedLaunch} disabled={heroAction !== null}
                className="rounded-xl border border-[var(--cyan)]/30 bg-[var(--cyan-dim)]/20 px-4 py-4 text-left transition-colors hover:bg-[var(--cyan-dim)]/30 disabled:opacity-50">
                <div className="flex items-center gap-2 text-[var(--cyan)] font-bold text-[14px]">
                  {heroAction === 'launching' ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />} Launch in Chatbot
                </div>
                <div className="mt-2 text-[13px] text-[var(--text-secondary)]">Open the copilot, brief the incident, and start the guided response immediately.</div>
              </button>
              <button onClick={startGuidedStress} disabled={heroAction !== null}
                className="rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-dim)]/20 px-4 py-4 text-left transition-colors hover:bg-[var(--amber-dim)]/30 disabled:opacity-50">
                <div className="flex items-center gap-2 text-[var(--amber)] font-bold text-[14px]">
                  {heroAction === 'stressing' ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />} Stress Test Now
                </div>
                <div className="mt-2 text-[13px] text-[var(--text-secondary)]">Inject failure pressure and force the chatbot + operator workflow to react.</div>
              </button>
              <button onClick={() => setShowTraining(true)}
                className="rounded-xl border border-[var(--green)]/30 bg-[var(--green-dim)]/20 px-4 py-4 text-left transition-colors hover:bg-[var(--green-dim)]/30">
                <div className="flex items-center gap-2 text-[var(--green)] font-bold text-[14px]"><GraduationCap size={15} /> Open Stress Controls</div>
                <div className="mt-2 text-[13px] text-[var(--text-secondary)]">Time control, snapshots, scoring, and event injection are available here.</div>
              </button>
              <button onClick={() => setBottomTab('trace')}
                className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-4 py-4 text-left transition-colors hover:border-[var(--cyan)]/30">
                <div className="flex items-center gap-2 text-[var(--text-primary)] font-bold text-[14px]"><FileText size={15} /> Audit the MCP Trace</div>
                <div className="mt-2 text-[13px] text-[var(--text-secondary)]">Show every tool call, argument, latency, and outcome like a real incident desk.</div>
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-3">
              <div className="text-[12px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Most important first</div>
              <div className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">{activeScenario?.hints?.diagnosis_path || 'Use the copilot to summarize the blast radius, then follow the runbook.'}</div>
            </div>
            <div className="mt-3 rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Resolution board</div>
                  <div className="text-[13px] text-[var(--text-secondary)] mt-1">See finished steps with MCP output and mapped FIX/manual commands.</div>
                </div>
                <button onClick={() => setShowEvidenceBoard(v => !v)}
                  className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--cyan)] transition-colors">
                  {showEvidenceBoard ? 'Hide' : 'Show'} Evidence
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--border-dim)] bg-[var(--bg-base)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--cyan)] transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="text-[12px] font-mono text-[var(--text-muted)]">{doneCount}/{totalSteps} done</div>
        </div>
      </div>

      {/* ═══ BOTTOM: Case Study / Runbook ═══ */}
      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ${focusMode ? 'max-w-6xl mx-auto w-full' : 'flex'}`}>
          {/* Tab bar: Case Study | Terminal | FIX Wire */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0">
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setBottomTab('case')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] font-semibold transition-all ${bottomTab === 'case' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <BookOpen size={13} /> Case Study
            </button>
            <button onClick={() => setBottomTab('terminal')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'terminal' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <TerminalIcon size={14} /> Terminal
            </button>
            <button onClick={() => setBottomTab('fixwire')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'fixwire' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Zap size={14} /> FIX Wire
            </button>
            <button onClick={() => setBottomTab('trace')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'trace' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <FileText size={14} /> Trace
            </button>
            <button onClick={() => setBottomTab('runbook')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'runbook' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <BookOpenCheck size={14} /> Manual Runbook
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Training infrastructure toggle */}
            <button onClick={() => setShowTraining(!showTraining)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-semibold transition-all ${showTraining ? 'bg-[var(--green-dim)] text-[var(--green)] border border-[var(--green)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              title="Training infrastructure: time control, scoring, state snapshots, and event injection">
              <GraduationCap size={13} /> Training
            </button>
            {/* Focus mode toggle */}
            <button onClick={() => setFocusMode(!focusMode)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-semibold transition-all ${focusMode ? 'bg-[var(--cyan-dim)] text-[var(--cyan)] border border-[var(--cyan)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              title="Focus mode">
              {focusMode ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
              {focusMode ? 'Expand' : 'Focus'}
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomTab === 'case' && activeScenario && (
            <div className="h-full flex">
              {showEvidenceBoard && (
                <div className="w-[420px] border-r border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0 overflow-y-auto">
                  <div className="px-4 py-3 border-b border-[var(--border-dim)]">
                    <div className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Resolution Evidence</div>
                    <div className="text-[15px] font-semibold text-[var(--text-primary)] mt-1">What ran, what proved success</div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1">Every completed step shows MCP evidence plus mapped FIX/manual commands.</div>
                  </div>
                  <div className="p-3 space-y-3">
                    {completedStepAudit.length === 0 ? (
                      <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-surface)] p-4 text-[13px] text-[var(--text-muted)]">
                        Run scenario steps to populate evidence.
                      </div>
                    ) : (
                      completedStepAudit.map((entry) => (
                        <div key={entry.step} className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="text-[12px] font-mono text-[var(--text-dim)]">STEP {entry.step}</div>
                              <div className="text-[14px] font-bold text-[var(--text-primary)]">{entry.title}</div>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--green-dim)] text-[var(--green)]">DONE</span>
                          </div>
                          <div className="text-[12px] text-[var(--text-muted)] mb-2">Tool: {entry.tool}</div>
                          <EvidencePanel output={entry.output} isFailed={false} manualCommands={entry.commands} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {/* LEFT: Step guide (wide) */}
              <div className={`flex-1 min-w-[400px] overflow-y-auto transition-all duration-300`} ref={runbookScrollRef}>
                {showCaseBrief && (
                  <CaseBrief
                    ctx={activeScenario}
                    onStart={() => setShowCaseBrief(false)}
                    downCount={downCount}
                    degradedCount={degradedCount}
                    openOrders={open_count}
                    stuckOrders={stuck_count}
                  />
                )}

                {!showCaseBrief && steps.length > 0 && (
                  <div className="p-5">
                    {/* Progress bar */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--cyan)] transition-all rounded-full" style={{ width: `${progressPct}%` }} />
                      </div>
                      <span className="text-[14px] font-mono text-[var(--text-muted)]">{progressPct}%</span>
                    </div>

                    {/* Step cards */}
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="text-[12px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Case study steps</div>
                            <div className="text-[14px] text-[var(--text-secondary)] mt-1">These are the exact visible steps the chatbot should guide. The runbook and the copilot now stay aligned.</div>
                          </div>
                          <div className="text-[12px] font-mono text-[var(--text-dim)]">{doneCount}/{totalSteps} complete</div>
                        </div>
                        <div className="grid gap-2">
                          {steps.map((step: any, idx: number) => {
                            const isDone = step.status === 'done';
                            const isFailed = step.status === 'failed';
                            const isRunning = step.status === 'running';
                            const isCurrent = idx === currentStep;
                            const isRevealed = revealedHints.has(step.step);
                            const result = stepResults[step.step] || step.output || '';
                            const manualCommands = MANUAL_RUNBOOK_MAP[step.tool] || [];

                            return (
                              <div key={step.step} onClick={() => setCurrentStep(idx)}
                                className={`rounded-xl border p-4 cursor-pointer transition-all ${
                                  isCurrent ? 'border-[var(--cyan)]/50 bg-[var(--cyan)]/5' :
                                  isDone ? 'border-[var(--green)]/20 bg-[var(--green)]/5' :
                                  isFailed ? 'border-[var(--red)]/20 bg-[var(--red)]/5' :
                                  'border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--border-base)]'
                                }`}>
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="flex items-start gap-2 min-w-0">
                                    <div className="mt-0.5 text-[12px] font-mono text-[var(--text-muted)]">#{idx + 1}</div>
                                    {isDone && <CheckCircle2 size={16} className="text-[var(--green)] mt-0.5" />}
                                    {isRunning && <Loader2 size={16} className="text-[var(--cyan)] animate-spin mt-0.5" />}
                                    {isFailed && <XCircle size={16} className="text-[var(--red)] mt-0.5" />}
                                    {!isDone && !isRunning && !isFailed && <ChevronRight size={16} className={`text-[var(--text-dim)] mt-0.5 ${isCurrent ? 'text-[var(--cyan)]' : ''}`} />}
                                    <div className="min-w-0">
                                      <div className={`text-[16px] font-bold ${isCurrent ? 'text-[var(--text-primary)]' : isDone ? 'text-[var(--green)]' : 'text-[var(--text-secondary)]'}`}>{step.title}</div>
                                      <div className="mt-1 text-[13px] text-[var(--text-secondary)] leading-relaxed">{step.narrative}</div>
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex flex-col items-end gap-2">
                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${isDone ? 'bg-[var(--green-dim)] text-[var(--green)]' : isRunning ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' : isFailed ? 'bg-[var(--red-dim)] text-[var(--red)]' : 'bg-[var(--bg-elevated)] text-[var(--text-dim)]'}`}>
                                      {isDone ? 'Done' : isRunning ? 'Running' : isFailed ? 'Failed' : isCurrent ? 'Current' : 'Pending'}
                                    </span>
                                    <button onClick={(e) => { e.stopPropagation(); runStep(step, idx); }}
                                      disabled={isRunning}
                                      className="px-4 py-2 rounded-md bg-[var(--cyan)] text-black text-[13px] font-bold hover:bg-[var(--cyan)]/80 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                      {isRunning ? <><Loader2 size={12} className="animate-spin" /> Running</> : isDone ? 'Rerun' : <><Play size={12} fill="currentColor" /> Run Step</>}
                                    </button>
                                  </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr] mb-3">
                                  <div className="rounded-lg bg-[var(--bg-void)] border border-[var(--border-dim)] p-3">
                                    <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] mb-1">MCP tool</div>
                                    <code className="text-[13px] font-mono text-[var(--green)]">{step.tool}</code>
                                    <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-all text-[var(--text-secondary)]">{JSON.stringify(step.tool_args ?? {}, null, 2)}</pre>
                                  </div>
                                  <div className="rounded-lg bg-[var(--bg-void)] border border-[var(--border-dim)] p-3">
                                    <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] mb-1">Expected result</div>
                                    <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{step.expected}</div>
                                  </div>
                                </div>

                                {result && (
                                  <EvidencePanel output={result} isFailed={isFailed} manualCommands={manualCommands} />
                                )}

                                {!result && !isDone && (
                                  <button onClick={(e) => { e.stopPropagation(); toggleHint(step.step); }}
                                    className="mt-3 flex items-center gap-1.5 text-[13px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
                                    {isRevealed ? <><EyeOff size={12} /> Hide Hint</> : <><Eye size={12} /> Show Hint</>}
                                  </button>
                                )}
                                {isRevealed && activeScenario.hints && !result && !isDone && (
                                  <div className="mt-2 p-3 rounded-lg bg-[var(--amber-dim)]/10 border border-[var(--amber)]/20">
                                    <div className="flex items-start gap-1.5 text-[14px] text-[var(--text-secondary)] leading-relaxed">
                                      <Lightbulb size={14} className="text-[var(--amber)] shrink-0 mt-0.5" />
                                      <span>{activeScenario.hints.diagnosis_path}</span>
                                    </div>
                                    {activeScenario.hints.common_mistakes?.[idx] && (
                                      <div className="mt-2 flex items-start gap-1.5 text-[13px] text-[var(--red)]">
                                        <XCircle size={12} className="shrink-0 mt-0.5" />
                                        <span><b>Avoid:</b> {activeScenario.hints.common_mistakes[idx]}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {allDone && (
                        <div className="mt-4 p-4 rounded-lg bg-[var(--green-dim)]/10 border border-[var(--green)]/30 text-center">
                          <CheckCircle2 size={24} className="text-[var(--green)] mx-auto mb-2" />
                          <p className="text-[18px] font-bold text-[var(--green)] mb-1">Case Resolved!</p>
                          <p className="text-[14px] text-[var(--text-secondary)]">All {totalSteps} steps completed successfully. Review the evidence board for the commands and proof.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Ops rail */}
              <div className={`bg-[var(--bg-base)] border-l border-[var(--border-dim)] flex flex-col shrink-0 transition-all duration-300 overflow-hidden ${focusMode ? 'w-0 border-0' : 'w-[320px]'}`}>
                <div className="px-4 py-3 border-b border-[var(--border-dim)]">
                  <div className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Ops Rail</div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)] mt-1">Stress, launch, switch, create</div>
                  <LiveTelemetryStrip />
                </div>
                <div className="p-3 space-y-3 border-b border-[var(--border-dim)]">
                  <button onClick={startGuidedLaunch} disabled={heroAction !== null}
                    className="w-full rounded-xl bg-[var(--cyan)] text-black text-[13px] font-bold py-2.5 px-3 flex items-center justify-center gap-2 hover:bg-[var(--cyan)]/80 disabled:opacity-50">
                    {heroAction === 'launching' ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />} Launch in Chatbot
                  </button>
                  <button onClick={startGuidedStress} disabled={heroAction !== null}
                    className="w-full rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-dim)]/10 text-[var(--amber)] text-[13px] font-semibold py-2.5 px-3 flex items-center justify-center gap-2 hover:bg-[var(--amber-dim)]/20 disabled:opacity-50">
                    {heroAction === 'stressing' ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Stress Test Active Scenario
                  </button>
                  <button onClick={onOpenScenarioBuilder}
                    className="w-full rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] text-[13px] font-semibold py-2.5 px-3 hover:border-[var(--cyan)]/30 hover:text-[var(--cyan)] transition-colors">
                    Create / Load / Test Scenarios
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  {activeScenarios?.map((s: any) => {
                    const isActive = scenario === s.name;
                    return (
                      <button key={s.name} onClick={() => startScenario(s.name)}
                        className={`w-full px-3 py-3 rounded-xl text-left transition-all ${
                          isActive ? 'bg-[var(--cyan-dim)]/20 border border-[var(--cyan)]/40' : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
                        }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className={`text-[13px] font-semibold leading-snug ${isActive ? 'text-[var(--cyan)]' : 'text-[var(--text-secondary)]'}`}>{s.title || s.name}</div>
                            <div className="mt-1 text-[11px] text-[var(--text-dim)] font-mono">{s.estimated_minutes}m · {(s.runbook_step_count || '?')} steps</div>
                          </div>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0" style={{ backgroundColor: SEV_BG[s.severity], color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {(!focusMode) && (
                  <div className="border-t border-[var(--border-dim)] p-2">
                    <HeartbeatPanel sessions={sessions} onAction={(tool, args) => callTool(tool, args)} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Training Panel (right sidebar for Case Study) */}
          {showTraining && activeScenario && (
            <div className="w-[360px] border-l border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0 overflow-hidden">
              <TrainingPanel onRollback={async (id: string) => {
                await callTool('rollback_to_snapshot', { snapshot_id: id });
              }} />
            </div>
          )}

          {bottomTab === 'case' && (!activeScenario || scenarioState === 'loading') && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 size={32} className="text-[var(--cyan)] animate-spin mx-auto mb-3" />
                <p className="text-[16px] text-[var(--text-muted)]">Loading case...</p>
              </div>
            </div>
          )}

          {bottomTab === 'terminal' && <FixTerminal />}

          {bottomTab === 'fixwire' && <FixWireView sessions={sessions || []} />}

          {bottomTab === 'trace' && <TraceTab />}

          {bottomTab === 'runbook' && <ManualRunbookPanel />}
        </div>
      </div>

      {/* ── HeartbeatPanel: Always visible at bottom in focus mode ── */}
      {focusMode && (
        <div className="border-t border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0">
          <HeartbeatPanel sessions={sessions} onAction={(tool, args) => callTool(tool, args)} />
        </div>
      )}

      {/* ── Completion Screen ── */}
      {showCompletion && (
        <CompletionScreen
          steps={trackedSteps}
          hintsUsed={hintsUsedCount}
          startTime={completionTimer || Date.now()}
          summary={completionSummary}
          onReviewEvidence={() => {
            setShowCompletion(false);
            setShowEvidenceBoard(true);
            setBottomTab('case');
          }}
          onClose={() => setShowCompletion(false)}
          onNewScenario={() => {
            setShowCompletion(false);
            setFocusMode(false);
          }}
        />
      )}
    </div>
  );
}

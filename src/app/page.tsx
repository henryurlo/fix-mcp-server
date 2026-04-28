'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';

import EvidencePanel from '@/components/EvidencePanel';
import CompletionScreen from '@/components/CompletionScreen';
import CaseBrief from '@/components/CaseBrief';
import FixWireView from '@/components/FixWireView';
import useKeyboardShortcuts from '@/hooks/useKeyboardShortcuts';

import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useProgress } from '@/store/progress';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep, TrackedStep } from '@/store';
import {
  Activity, Terminal as TerminalIcon, PlusCircle, LogOut, Play, Layers,
  Radio, BookOpen, RotateCcw, BookMarked, MessageSquare,
  Eye, EyeOff, Loader2, ChevronRight, CheckCircle2, XCircle, Info,
  PanelLeftOpen, PanelLeftClose, ArrowRight, FileText, Send, Wrench,
  ChevronDown, ChevronUp, AlertTriangle, Lightbulb, Zap, Eye as EyeIcon, Star,
  X, Trophy, Clock, Award, GraduationCap, HelpCircle, BookOpenCheck, FlaskConical,
  BarChart3, Route, BriefcaseBusiness, ClipboardList, ShieldCheck, Search, Database,
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
const LearningPath = dynamic(() => import('@/components/LearningPath').then(m => ({ default: m.default })), { ssr: false });

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
const OPERATING_MODES = [
  { label: 'Watchdog', desc: 'Trigger a desk alert from session, order, market-data, or host pressure.' },
  { label: 'Investigator', desc: 'Ask the copilot for scope, root cause, blast radius, and evidence.' },
  { label: 'Advisor', desc: 'Review a full recovery workbook before approving execution.' },
  { label: 'Agent Run', desc: 'Let the agent work the incident while the human observes and can intervene.' },
];

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
  const [activeTab, setActiveTab] = useState<'mission-control' | 'learning-path' | 'scenario-library'>('mission-control');
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
  const canInjectFromHeader = trackedSteps.length > 0 && trackedSteps.every((step) => step.status === 'done');
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
      <header className="h-14 border-b border-[var(--border-dim)] flex items-center justify-between px-4 shrink-0 bg-[var(--bg-base)] shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-bold tracking-wider text-[var(--text-primary)]">FIX-MCP</span>
          <span className="hidden md:inline text-[12px] text-[var(--text-muted)]">Trading Operations Console</span>
          {scenario && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--cyan-dim)] border border-[var(--cyan)]/30 max-w-[280px]">
              <Radio size={8} className="text-[var(--cyan)] animate-pulse" />
              <span className="truncate text-[13px] font-mono font-bold text-[var(--cyan)]">{titleName}</span>
            </div>
          )}
        </div>
        <nav className="flex gap-0.5 bg-[var(--bg-surface)] rounded-md p-0.5 border border-[var(--border-dim)]">
          {([
            ['mission-control', 'Desk', Layers],
            ['learning-path', 'Incidents', Route],
            ['scenario-library', 'Builder', PlusCircle],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-semibold transition-all ${activeTab === id ? 'bg-[var(--bg-base)] text-[var(--cyan)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className={`text-[13px] font-mono ${connected ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{connected ? '● LIVE' : '● OFFLINE'}</span>
          <select value={scenario || ''} onChange={(e) => e.target.value && launchScenarioFromHeader(e.target.value)}
            className="input-base !w-auto !py-1.5 !px-3 !text-[13px] !font-mono !rounded-md max-w-[220px]">
            <option value="">Load scenario...</option>
            {available_scenarios?.map((s: any) => (
              <option key={s.name} value={s.name}>{s.title || s.name} ({s.estimated_minutes}m)</option>
            ))}
          </select>
          {scenario && (
            <>
              <button onClick={stressTestCurrentScenario} disabled={!canInjectFromHeader}
                title={canInjectFromHeader ? 'Inject a controlled event into the active scenario.' : 'Finish the baseline workbook before injecting a stress event.'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--amber-dim)]/40 text-[var(--amber)] border border-[var(--amber)]/30 text-[13px] font-semibold hover:bg-[var(--amber-dim)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                <FlaskConical size={12} /> Inject Event
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
          {activeTab === 'learning-path' && (
            <LearningPath onStartLab={(name) => {
              setActiveTab('mission-control');
              launchScenarioFromHeader(name);
            }} />
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
  const { scenario, scenarioContext, scenarioState, sessions, startScenario, trackedSteps, callTool, setStepStatus, completeStep, addAlert, addHostEvent, open_count, stuck_count, resetScenario, takeOverAsAgent } = useSystem();
  const { isOpen: chatOpen, toggleOpen: toggleChat } = useChat();
  const { completeLab } = useProgress();
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
  const [completionDismissed, setCompletionDismissed] = useState(false);

  // Hints tracking
  const [hintsUsedCount, setHintsUsedCount] = useState(0);
  const [showTraining, setShowTraining] = useState(false);
  const [trainingInitialTab, setTrainingInitialTab] = useState<'time' | 'score' | 'snapshot' | 'inject'>('time');
  const [heroAction, setHeroAction] = useState<'launching' | 'stressing' | 'workbook' | 'agent-run' | null>(null);
  const [showEvidenceBoard, setShowEvidenceBoard] = useState(false);
  const [completedStepAudit, setCompletedStepAudit] = useState<Array<{ step: number; title: string; tool: string; output: string; commands: Array<{ label: string; language: string; code: string }> }>>([]);
  const [completionSummary, setCompletionSummary] = useState('');
  const [hbExpanded, setHbExpanded] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

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
    setHbExpanded(false);
    setExpandedSteps(new Set());
    setCompletionDismissed(false);
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

  // Track lab completion in academy progress
  useEffect(() => {
    if (allDone && scenario && totalSteps > 0) {
      completeLab(scenario, doneCount, totalSteps, hintsUsedCount);
    }
  }, [allDone, scenario, doneCount, totalSteps, hintsUsedCount, completeLab]);

  // Show completion screen when all done
  useEffect(() => {
    if (allDone && !showCompletion && !completionDismissed) {
      const summary = completedStepAudit.length > 0
        ? `Scenario completed successfully. ${completedStepAudit.length} runbook steps executed with visible MCP evidence and mapped FIX/manual commands.`
        : 'Scenario completed successfully.';
      setCompletionSummary(summary);
      setShowCompletion(true);
      setShowEvidenceBoard(true);
    }
  }, [allDone, completedStepAudit, showCompletion, completionDismissed]);

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

  async function runWorkbook(mode: 'advisor' | 'agent') {
    if (!scenario || steps.length === 0) return;
    setHeroAction(mode === 'advisor' ? 'workbook' : 'agent-run');
    setShowCaseBrief(false);
    setShowEvidenceBoard(true);
    try {
      if (mode === 'agent') {
        await takeOverAsAgent();
      }
      for (let i = 0; i < steps.length; i += 1) {
        const liveStep = useSystem.getState().trackedSteps.find((s) => s.step === steps[i].step) || steps[i];
        if (liveStep.status === 'done') continue;
        await runStep(liveStep, i);
      }
      addHostEvent(mode === 'advisor' ? 'workbook_approved' : 'agent_run_complete',
        mode === 'advisor' ? 'Human approved the recovery workbook' : 'Agent run completed the recovery workbook',
        'info');
    } finally {
      setHeroAction(null);
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

  async function startAgentRun() {
    setHeroAction('agent-run');
    try {
      const chat = useChat.getState();
      if (!chat.isOpen) chat.toggleOpen();
      await chat.openWithPrompt(`Agent Run for ${activeScenario?.title || scenario}: execute the approved workbook using MCP tools, explain each decision, and stop if human approval is required.`);
      await runWorkbook('agent');
      setBottomTab('trace');
    } finally {
      setHeroAction(null);
    }
  }

  if (!scenario) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-void)]">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-5">
            <div className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] p-5 shadow-sm">
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="flex flex-wrap gap-2 mb-3 text-[11px] font-mono uppercase tracking-wide text-[var(--text-dim)]">
                    <span className="rounded border border-[var(--cyan)]/30 bg-[var(--cyan-dim)] px-2 py-1 text-[var(--cyan)]">FIX protocol</span>
                    <span className="rounded border border-[var(--blue)]/30 bg-[var(--blue-dim)] px-2 py-1 text-[var(--blue)]">MCP tool surface</span>
                    <span className="rounded border border-[var(--green)]/30 bg-[var(--green-dim)] px-2 py-1 text-[var(--green)]">Human approval</span>
                  </div>
                  <h1 className="text-[30px] leading-tight font-bold mb-3 text-[var(--text-primary)]">
                    MCP command center for trading operations.
                  </h1>
                  <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed max-w-3xl">
                    Pick an incident, let the copilot investigate with MCP tools, approve a recovery workbook, and verify every action with trace and manual-command evidence.
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-4">
                  <div className="text-[12px] font-bold uppercase tracking-wide text-[var(--text-dim)] mb-3">Operator demo sequence</div>
                  {[
                    ['1', 'Load incident', 'Choose any category from the catalog below.'],
                    ['2', 'Investigator', 'Ask the LLM to summarize impact and first action.'],
                    ['3', 'Approve workbook', 'Run the full recovery plan through bounded MCP tools.'],
                    ['4', 'Stress test', 'Inject pressure only after the baseline incident is understood.'],
                  ].map(([n, title, desc]) => (
                    <div key={n} className="flex gap-3 border-t border-[var(--border-dim)] py-2 first:border-t-0 first:pt-0">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--cyan-dim)] text-[11px] font-bold text-[var(--cyan)]">{n}</div>
                      <div>
                        <div className="text-[13px] font-bold text-[var(--text-primary)]">{title}</div>
                        <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[18px] font-bold text-[var(--text-primary)]">Incident Catalog</h2>
                  <p className="text-[13px] text-[var(--text-muted)]">Start any event category directly. Severity and difficulty help you choose the right demo for the audience.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                {activeScenarios?.map((s: any) => (
                  <button key={s.name} onClick={() => startScenario(s.name)}
                    className="p-4 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-base)] hover:border-[var(--cyan)]/50 hover:bg-[var(--bg-surface)] transition-all text-left group shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Play size={12} className="text-[var(--cyan)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="text-[15px] font-bold group-hover:text-[var(--cyan)] transition-colors">{s.title || s.name}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: SEV_BG[s.severity], color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                    </div>
                    <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{s.description?.slice(0, 160)}...</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[var(--text-dim)]">{s.estimated_minutes} min</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[var(--text-dim)]">{s.runbook_step_count || '?'} steps</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-2 py-1 text-[var(--text-dim)]">{s.difficulty || 'intermediate'}</span>
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
      {/* ── Compact Hero ── */}
      <div className="border-b border-[var(--border-dim)] bg-[var(--bg-base)] px-4 py-3">
        <div className="grid items-start gap-3 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="rounded border border-[var(--cyan)]/30 bg-[var(--cyan-dim)] px-2 py-0.5 text-[10px] font-mono text-[var(--cyan)]">ACTIVE INCIDENT</span>
              <span className="rounded border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-dim)]">{scenario}</span>
              <span className="rounded border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-dim)]">{activeScenario?.simulated_time || '—'}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[22px] leading-tight font-bold text-[var(--text-primary)]">{activeTitle}</h1>
                <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {activeScenario?.description || activeScenario?.runbook?.narrative || 'Live trading operations incident loaded.'}
                </p>
              </div>
              <div className="hidden xl:flex flex-col gap-1.5 min-w-[160px]">
                <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Lens</div>
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">{activeScenario?.categories?.join(' · ') || 'ops incident'}</div>
                </div>
                <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Guided by</div>
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">Copilot + MCP tools</div>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Notional pressure</div>
                <div className="mt-0.5 text-[18px] font-bold text-[var(--text-primary)]">{open_count}</div>
                <div className="text-[11px] text-[var(--text-muted)]">open orders at risk</div>
              </div>
              <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Venue health</div>
                <div className="mt-0.5 text-[18px] font-bold text-[var(--text-primary)]">{downCount + degradedCount}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{downCount} down · {degradedCount} degraded</div>
              </div>
              <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Runbook</div>
                <div className="mt-0.5 text-[18px] font-bold text-[var(--text-primary)]">{totalSteps}</div>
                <div className="text-[11px] text-[var(--text-muted)]">recovery steps</div>
              </div>
              <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)]">Progress</div>
                <div className="mt-0.5 text-[18px] font-bold text-[var(--text-primary)]">{progressPct}%</div>
                <div className="text-[11px] text-[var(--text-muted)]">{doneCount}/{totalSteps} done</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Desk Workflow</div>
                <div className="text-[16px] font-bold text-[var(--text-primary)]">Baseline first. Pressure test second.</div>
              </div>
              <button onClick={onOpenScenarioBuilder} className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--cyan)] transition-colors">
                Create / Load
              </button>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {[
                ['1', 'Investigate', 'Ask Copilot what broke, then read the MCP evidence.', 'cyan'],
                ['2', 'Approve + run', 'Approve the workbook and execute the baseline recovery.', 'green'],
                ['3', 'Stress lab', 'Inject pressure only after the baseline path is understood.', 'amber'],
              ].map(([step, title, desc, tone]) => (
                <div key={step} className={`rounded-md border bg-[var(--bg-surface)] p-2.5 ${tone === 'cyan' ? 'border-[var(--cyan)]/25' : tone === 'green' ? 'border-[var(--green)]/25' : 'border-[var(--amber)]/25'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${tone === 'cyan' ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' : tone === 'green' ? 'bg-[var(--green-dim)] text-[var(--green)]' : 'bg-[var(--amber-dim)] text-[var(--amber)]'}`}>{step}</span>
                    <span className="text-[13px] font-bold text-[var(--text-primary)]">{title}</span>
                  </div>
                  <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">{desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-[var(--cyan)]/25 bg-[var(--cyan-dim)]/10 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-[var(--cyan)] font-bold">Current first move</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{activeScenario?.hints?.diagnosis_path || 'Use the copilot to summarize the blast radius, then follow the runbook.'}</div>
            </div>
            <div className="mt-2 rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Resolution board</div>
                  <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">See finished steps with MCP output and mapped FIX/manual commands.</div>
                </div>
                <button onClick={() => setShowEvidenceBoard(v => !v)}
                  className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--cyan)] transition-colors">
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
            <div className="relative group">
              <button onClick={() => setBottomTab('case')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] font-semibold transition-all ${bottomTab === 'case' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <BookOpen size={13} /> Case Study
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute left-0 top-full mt-2 z-50 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">The incident brief and recovery workbook. This is the main operator workspace.</p>
              </div>
            </div>
            <div className="relative group">
              <button onClick={() => setBottomTab('terminal')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'terminal' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <TerminalIcon size={14} /> Terminal
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute left-0 top-full mt-2 z-50 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">Manual inspection path. Use this when the user wants to compare MCP output with desk-style commands.</p>
              </div>
            </div>
            <div className="relative group">
              <button onClick={() => setBottomTab('fixwire')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'fixwire' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <Zap size={14} /> FIX Wire
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute left-0 top-full mt-2 z-50 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">Wire-level FIX messages: NewOrderSingle, ExecutionReport, Reject, and session traffic.</p>
              </div>
            </div>
            <div className="relative group">
              <button onClick={() => setBottomTab('trace')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'trace' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <FileText size={14} /> Trace
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute left-0 top-full mt-2 z-50 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">Primary proof surface: every MCP tool call, arguments, output, latency, and result.</p>
              </div>
            </div>
            <div className="relative group">
              <button onClick={() => setBottomTab('runbook')}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[14px] font-semibold transition-all ${bottomTab === 'runbook' ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <BookOpenCheck size={14} /> Manual Runbook
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute left-0 top-full mt-2 z-50 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">The equivalent manual commands an SRE would run on a real desk. Shows bash commands, SQL queries, and FIX messages for each runbook step.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Training infrastructure toggle */}
            <div className="relative group">
              <button onClick={() => { setTrainingInitialTab('time'); setShowTraining(!showTraining); }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-semibold transition-all ${showTraining ? 'bg-[var(--green-dim)] text-[var(--green)] border border-[var(--green)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <GraduationCap size={13} /> Stress Lab
              </button>
              <div className="pointer-events-none invisible group-hover:visible absolute right-0 top-full mt-2 z-50 w-64 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
                <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">Opens controlled stress testing: inject a venue outage, reject spike, LULD halt, sequence gap, or SLA breach after the operator understands the base incident.</p>
              </div>
            </div>
            <button onClick={() => setFocusMode(!focusMode)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-semibold transition-all ${focusMode ? 'bg-[var(--cyan-dim)] text-[var(--cyan)] border border-[var(--cyan)]/30' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              title="Focus mode">
              {focusMode ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
              {focusMode ? 'Full Console' : 'Focus'}
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
                  <div className="p-4">
                    {/* Progress bar */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex-1 h-2 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--cyan)] transition-all rounded-full" style={{ width: `${progressPct}%` }} />
                      </div>
                      <span className="text-[12px] font-mono text-[var(--text-muted)]">{doneCount}/{totalSteps}</span>
                    </div>

                    {/* Step cards */}
                    <div className="space-y-2">
                      {steps.map((step: any, idx: number) => {
                        const isDone = step.status === 'done';
                        const isFailed = step.status === 'failed';
                        const isRunning = step.status === 'running';
                        const isCurrent = idx === currentStep;
                        const isRevealed = revealedHints.has(step.step);
                        const result = stepResults[step.step] || step.output || '';
                        const manualCommands = MANUAL_RUNBOOK_MAP[step.tool] || [];
                        const isExpanded = expandedSteps.has(step.step) || isCurrent || (isDone && result) || isRunning || isFailed;

                        return (
                          <div key={step.step}
                            className={`rounded-xl border transition-all ${
                              isCurrent ? 'border-[var(--cyan)]/50 bg-[var(--cyan)]/5' :
                              isDone ? 'border-[var(--green)]/20 bg-[var(--green)]/5' :
                              isFailed ? 'border-[var(--red)]/20 bg-[var(--red)]/5' :
                              'border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--border-base)]'
                            }`}>
                            {/* Compact header — always visible */}
                            <div
                              onClick={() => {
                                setCurrentStep(idx);
                                setExpandedSteps(prev => {
                                  const next = new Set(prev);
                                  if (next.has(step.step)) next.delete(step.step);
                                  else next.add(step.step);
                                  return next;
                                });
                              }}
                              className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="text-[11px] font-mono text-[var(--text-muted)] w-5">#{idx + 1}</div>
                                {isDone && <CheckCircle2 size={14} className="text-[var(--green)] shrink-0" />}
                                {isRunning && <Loader2 size={14} className="text-[var(--cyan)] animate-spin shrink-0" />}
                                {isFailed && <XCircle size={14} className="text-[var(--red)] shrink-0" />}
                                {!isDone && !isRunning && !isFailed && <ChevronRight size={14} className={`text-[var(--text-dim)] shrink-0 ${isCurrent ? 'text-[var(--cyan)]' : ''}`} />}
                                <div className="min-w-0">
                                  <div className={`text-[14px] font-bold truncate ${isCurrent ? 'text-[var(--text-primary)]' : isDone ? 'text-[var(--green)]' : 'text-[var(--text-secondary)]'}`}>{step.title}</div>
                                  {isExpanded && (
                                    <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{step.narrative}</div>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${isDone ? 'bg-[var(--green-dim)] text-[var(--green)]' : isRunning ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' : isFailed ? 'bg-[var(--red-dim)] text-[var(--red)]' : 'bg-[var(--bg-elevated)] text-[var(--text-dim)]'}`}>
                                  {isDone ? 'Done' : isRunning ? 'Running' : isFailed ? 'Failed' : isCurrent ? 'Current' : 'Pending'}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); runStep(step, idx); }}
                                  disabled={isRunning}
                                  className="px-3 py-1.5 rounded-md bg-[var(--cyan)] text-white text-[12px] font-bold hover:bg-[var(--cyan)]/80 transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                  {isRunning ? <><Loader2 size={10} className="animate-spin" /> Run</> : isDone ? 'Rerun' : <><Play size={10} fill="currentColor" /> Run</>}
                                </button>
                              </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-[var(--border-dim)]">
                                <div className="grid gap-2 md:grid-cols-2 mt-3">
                                  <div className="rounded-lg bg-[var(--bg-void)] border border-[var(--border-dim)] p-2.5">
                                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)] mb-1">MCP tool</div>
                                    <code className="text-[12px] font-mono text-[var(--green)]">{step.tool}</code>
                                    <pre className="mt-1.5 text-[10px] font-mono whitespace-pre-wrap break-all text-[var(--text-secondary)]">{JSON.stringify(step.tool_args ?? {}, null, 2)}</pre>
                                  </div>
                                  <div className="rounded-lg bg-[var(--bg-void)] border border-[var(--border-dim)] p-2.5">
                                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-dim)] mb-1">Expected result</div>
                                    <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{step.expected}</div>
                                  </div>
                                </div>

                                {result && (
                                  <div className="mt-2">
                                    <EvidencePanel output={result} isFailed={isFailed} manualCommands={manualCommands} />
                                  </div>
                                )}

                                {!result && !isDone && (
                                  <button onClick={(e) => { e.stopPropagation(); toggleHint(step.step); }}
                                    className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
                                    {isRevealed ? <><EyeOff size={11} /> Hide Hint</> : <><Eye size={11} /> Show Hint</>}
                                  </button>
                                )}
                                {isRevealed && activeScenario.hints && !result && !isDone && (
                                  <div className="mt-2 p-2.5 rounded-lg bg-[var(--amber-dim)]/10 border border-[var(--amber)]/20">
                                    <div className="flex items-start gap-1.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                                      <Lightbulb size={12} className="text-[var(--amber)] shrink-0 mt-0.5" />
                                      <span>{activeScenario.hints.diagnosis_path}</span>
                                    </div>
                                    {activeScenario.hints.common_mistakes?.[idx] && (
                                      <div className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--red)]">
                                        <XCircle size={11} className="shrink-0 mt-0.5" />
                                        <span><b>Avoid:</b> {activeScenario.hints.common_mistakes[idx]}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {allDone && (
                        <div className="mt-4 p-4 rounded-lg bg-[var(--green-dim)]/10 border border-[var(--green)]/30 text-center">
                          <CheckCircle2 size={24} className="text-[var(--green)] mx-auto mb-2" />
                          <p className="text-[18px] font-bold text-[var(--green)] mb-1">Incident Resolved</p>
                          <p className="text-[14px] text-[var(--text-secondary)]">All {totalSteps} steps completed successfully. Review the evidence board for MCP output and manual-command proof.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Ops rail */}
              <div className={`bg-[var(--bg-base)] border-l border-[var(--border-dim)] flex flex-col h-full shrink-0 transition-all duration-300 overflow-hidden ${focusMode ? 'w-0 border-0' : 'w-[340px]'}`}>
                <div className="px-3 py-2.5 border-b border-[var(--border-dim)]">
                  <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Operator Rail</div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)] mt-0.5">{showTraining ? 'Stress Lab Controls' : 'Next best action'}</div>
                  <LiveTelemetryStrip />
                </div>
                <div className="p-2.5 space-y-2 border-b border-[var(--border-dim)]">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-dim)]">Baseline workflow</div>
                  <button onClick={startGuidedLaunch} disabled={heroAction !== null}
                    className="w-full rounded-md bg-[var(--cyan)] text-white text-[12px] font-bold py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-[var(--cyan)]/80 disabled:opacity-50">
                    {heroAction === 'launching' ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Investigator
                  </button>
                  <button onClick={() => runWorkbook('advisor')} disabled={heroAction !== null || totalSteps === 0}
                    className="w-full rounded-lg border border-[var(--green)]/40 bg-[var(--green-dim)]/10 text-[var(--green)] text-[12px] font-semibold py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-[var(--green-dim)]/20 disabled:opacity-50">
                    {heroAction === 'workbook' ? <Loader2 size={12} className="animate-spin" /> : <BookOpenCheck size={12} />} Approve Workbook
                  </button>
                  <button onClick={startAgentRun} disabled={heroAction !== null || totalSteps === 0}
                    className="w-full rounded-lg border border-[var(--purple)]/40 bg-[var(--purple-dim)]/10 text-[var(--purple)] text-[12px] font-semibold py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-[var(--purple-dim)]/20 disabled:opacity-50">
                    {heroAction === 'agent-run' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Agent Run
                  </button>
                  <div className="pt-2 mt-2 border-t border-[var(--border-dim)]">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--amber)]">Stress lab</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{allDone ? 'Ready' : 'after baseline'}</div>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Use this only to prove resilience after the base incident is understood or resolved.</p>
                  </div>
                  <button onClick={startGuidedStress} disabled={heroAction !== null || !allDone}
                    title={allDone ? 'Inject a controlled event and ask Copilot to re-triage.' : 'Finish the baseline workbook before injecting stress.'}
                    className="w-full rounded-lg border border-[var(--amber)]/40 bg-[var(--amber-dim)]/10 text-[var(--amber)] text-[12px] font-semibold py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-[var(--amber-dim)]/20 disabled:opacity-50 disabled:cursor-not-allowed">
                    {heroAction === 'stressing' ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Inject Event
                  </button>
                  <button onClick={() => { setTrainingInitialTab('inject'); setShowTraining(true); }}
                    className="w-full rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-[12px] font-semibold py-2 px-3 flex items-center justify-center gap-1.5 hover:border-[var(--amber)]/40 hover:text-[var(--amber)]">
                    <GraduationCap size={12} /> Open Stress Lab
                  </button>
                </div>

                {/* TrainingPanel renders HERE when toggled */}
                {showTraining ? (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <TrainingPanel onRollback={(id) => {
                      callTool('rollback_to_snapshot', { snapshot_id: id });
                      addAlert('Rolled back to snapshot ' + id, 'info', 3000);
                    }} initialTab={trainingInitialTab} />
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-2">
                      <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
                        <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-[var(--text-dim)]">
                          <ClipboardList size={13} /> Recommended sequence
                        </div>
                        <ol className="mt-3 space-y-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          <li><b className="text-[var(--text-primary)]">1.</b> Read the case brief and run Investigator.</li>
                          <li><b className="text-[var(--text-primary)]">2.</b> Approve Workbook to execute the complete MCP plan.</li>
                          <li><b className="text-[var(--text-primary)]">3.</b> Open Trace to prove every tool call and output.</li>
                          <li><b className="text-[var(--text-primary)]">4.</b> Use Inject Event from Stress Lab only after the baseline case is clear.</li>
                        </ol>
                      </div>
                      <button
                        onClick={() => onOpenScenarioBuilder()}
                        className="w-full rounded-md border border-[var(--border-dim)] bg-[var(--bg-base)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
                      >
                        Switch scenario catalog
                      </button>
                      <button
                        onClick={() => setBottomTab('trace')}
                        className="w-full rounded-md border border-[var(--border-dim)] bg-[var(--bg-base)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] hover:border-[var(--cyan)]/40 hover:text-[var(--cyan)]"
                      >
                        Open trace evidence
                      </button>
                    </div>
                    <div className="border-t border-[var(--border-dim)]">
                      <button
                        onClick={() => setHbExpanded(v => !v)}
                        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-secondary)] transition-colors"
                      >
                        <span className="flex items-center gap-1.5"><Activity size={12} /> FIX Sessions</span>
                        <span>{hbExpanded ? '▲' : '▼'}</span>
                      </button>
                      {hbExpanded && (
                        <div className="px-2 pb-2">
                          <HeartbeatPanel sessions={sessions} onAction={(tool, args) => callTool(tool, args)} />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
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
            setCompletionDismissed(true);
          }}
          onClose={() => {
            setShowCompletion(false);
            setCompletionDismissed(true);
          }}
          onNewScenario={() => {
            setShowCompletion(false);
            setCompletionDismissed(true);
            setFocusMode(false);
            resetScenario();
            onOpenScenarioBuilder();
          }}
        />
      )}
    </div>
  );
}

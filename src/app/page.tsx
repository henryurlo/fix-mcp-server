'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep } from '@/store';
import {
  Activity, Terminal, BarChart3, PlusCircle, LogOut, Play, Layers,
  Radio, BookOpen, Bot, Users, Hand, Lock, Unlock, RotateCcw,
  Eye, EyeOff, Loader2, ChevronRight, CheckCircle2, XCircle, Info,
  PanelLeftOpen, PanelLeftClose, ChevronDown, ChevronUp,
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const TelemetryDashboard = dynamic(() => import('@/components/TelemetryDashboard'), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator').then(m => ({ default: m.ScenarioCreator })), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const AuditLog = dynamic(() => import('@/components/AuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });

const SEV: Record<string, string> = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--purple)' };

// ── Tooltip on hover ──
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group">
      {children}
      <div className="invisible group-hover:visible absolute left-0 top-full mt-2 z-[100] w-72 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-bright)] shadow-2xl">
        <div className="flex items-center gap-1 mb-1 text-[10px] text-[var(--cyan)] font-bold uppercase">
          <Info size={9} /> How it works
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'mission-control' | 'telemetry' | 'scenario-library'>('mission-control');
  const { scenario, scenarioContext, available_scenarios, refresh, error, connected, locked, startScenario } = useSystem();
  const { isOpen, toggleOpen, clear } = useChat();
  const { isAuthenticated, user, logout } = useAuth();
  const telemetry = useTelemetry();

  useEffect(() => { refresh(); telemetry.refresh(); }, []);
  useEffect(() => {
    const iv = setInterval(() => { refresh(); telemetry.refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh, telemetry]);

  const handleReset = useCallback(async () => {
    try {
      await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'clear' }) });
      useSystem.setState({ scenario: null, scenarioContext: null, scenarioState: 'idle', completedSteps: [], trackedSteps: [], locked: false, alerts: [], error: null, loading: false });
      clear();
    } catch (e) { console.error('Reset failed:', e); }
  }, [clear]);

  const handleToggleLock = useCallback(() => {
    useSystem.setState(s => ({ locked: !s.locked }));
    const s = useSystem.getState();
    s.addHostEvent(locked ? 'unlocked' : 'locked', locked ? 'Scenario unlocked' : 'Scenario locked', 'warning');
    s.addAlert(locked ? 'Scenario unlocked — free to switch' : 'Scenario locked', locked ? 'info' : 'warning', 4000);
  }, [locked]);

  if (!isAuthenticated) return <AuthGate />;

  const name = scenarioContext?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)]">
      {/* ═══ HEADER ═══ */}
      <header className={`h-11 border-b flex items-center justify-between px-4 shrink-0 ${locked ? 'bg-[var(--amber-dim)]/20 border-[var(--amber)]/50' : 'bg-[var(--bg-base)] border-[var(--border-dim)]'}`}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-wider">FIX-MCP</span>
          {scenario && (
            <div className={`flex items-center gap-2 px-2 py-1 rounded-md border ${locked ? 'bg-[var(--amber-dim)]/30 border-[var(--amber)]/50' : 'bg-[var(--cyan-dim)] border-[var(--cyan)]/30'}`}>
              {locked ? <Lock size={11} className="text-[var(--amber)]" /> : <Radio size={8} className="text-[var(--cyan)] animate-pulse" />}
              <span className={`text-[12px] font-mono font-bold ${locked ? 'text-[var(--amber)]' : 'text-[var(--cyan)]'}`}>{name}</span>
            </div>
          )}
        </div>
        <nav className="flex gap-0.5 bg-[var(--bg-surface)] rounded-lg p-0.5 border border-[var(--border-dim)]">
          {([
            ['mission-control', 'Mission Control', Layers],
            ['telemetry', 'Telemetry', BarChart3],
            ['scenario-library', 'Scenario Library', PlusCircle],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1 px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${activeTab === id ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-mono ${connected ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{connected ? '● LIVE' : '● OFFLINE'}</span>
          <select value={scenario || ''} onChange={(e) => e.target.value && !locked && startScenario(e.target.value)} disabled={locked}
            className={`input-base !w-auto !py-1 !px-2 !text-[11px] !font-mono !rounded-md max-w-[200px] ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}>
            <option value="">{locked ? '🔒 Locked' : '▶ Launch…'}</option>
            {available_scenarios?.map((s: any) => (<option key={s.name} value={s.name}>{s.title || s.name} ({s.estimated_minutes}m)</option>))}
          </select>
          {scenario && (
            <>
              <Tip text={locked ? 'Scenario is locked. You cannot switch scenarios. Click Reset to clear this scenario and unlock.' : 'Lock this scenario so you cannot accidentally switch away. Only Reset can exit.'}>
                <button onClick={handleToggleLock}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold transition-all ${locked ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30 hover:bg-[var(--green-dim)]/80' : 'bg-[var(--amber-dim)]/30 text-[var(--amber)] border-[var(--amber)]/30 hover:bg-[var(--amber-dim)]/50'}`}>
                  {locked ? <><Unlock size={11} /> Unlock</> : <><Lock size={11} /> Lock</>}
                </button>
              </Tip>
              <Tip text="Reset clears the current scenario, all runbook progress, chat history, and returns you to a clean state so you can launch a new scenario.">
                <button onClick={handleReset}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--red-dim)]/50 text-[var(--red)] border border-[var(--red)]/30 text-[11px] font-semibold hover:bg-[var(--red-dim)] transition-all">
                  <RotateCcw size={10} /> Reset
                </button>
              </Tip>
            </>
          )}
          <Tip text="Open the AI SRE Copilot — a chat interface that can diagnose issues, suggest fixes, and (in Co-Pilot mode) run tools for you.">
            <button onClick={toggleOpen}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:text-[var(--text-secondary)]'}`}>
              <Terminal size={10} /> Copilot
            </button>
          </Tip>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">{user?.username || 'anon'}</span>
          <button onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--red)]"><LogOut size={11} /></button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {activeTab === 'mission-control' && <MissionControlTab />}
          {activeTab === 'telemetry' && <TelemetryDashboard />}
          {activeTab === 'scenario-library' && <ScenarioCreator />}
        </main>
        <aside className={`transition-all duration-300 bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[400px]' : 'w-0'} overflow-hidden shrink-0`}><ChatPanel /></aside>
      </div>
    </div>
  );
}

// ════ MISSION CONTROL ════

function MissionControlTab() {
  const { scenario, scenarioContext, scenarioState, sessions, controlMode, takeOverAsAgent, releaseToHuman, toggleCollab, trackedSteps, callTool, completeStep, setStepStatus, addHostEvent, addAlert, available_scenarios, locked, startScenario } = useSystem();
  const { send, isOpen, toggleOpen } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [stepResults, setStepResults] = useState<Record<number, string>>({});

  // Preserve scroll position across re-renders
  const runbookScrollRef = useRef<HTMLDivElement>(null);

  // Build steps list: idle → run by user → done/failed
  const runbook = scenarioContext?.runbook;
  const steps = trackedSteps.length > 0
    ? trackedSteps.map(t => ({ ...t, output: t.output || '' }))
    : (runbook?.steps || []).map((s: RunbookStep, i: number) => ({ ...s, status: 'idle' as const, output: '' }));

  const doneCount = trackedSteps.filter(s => s.status === 'done').length;
  const totalSteps = steps.length;
  const allDone = doneCount >= totalSteps && totalSteps > 0;

  // Initialize revealed hints for the current (first) step when scenario changes
  useEffect(() => {
    if (scenarioContext && steps.length > 0) {
      setRevealedHints(new Set([steps[0]?.step]));
    }
  }, [scenario?.length ?? 0]); // re-mount when scenario name length changes (safe trigger for scenario switch)

  async function runStep(step: typeof steps[0], idx: number) {
    if (step.status === 'running') return;
    setStepStatus(step.step, 'running');
    try {
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      setStepResults(prev => ({ ...prev, [step.step]: result }));
      completeStep(step.step);
      addHostEvent('step_complete', `Step ${step.step} done ✓`, 'info');
      if (allDone) addAlert('🎉 All runbook steps complete!', 'success', 8000);
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      setStepResults(prev => ({ ...prev, [step.step]: `Error: ${err.message}` }));
      addHostEvent('step_failed', `Step ${step.step} failed`, 'error');
    }
  }

  function toggleHint(n: number) {
    setRevealedHints(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }

  function toggleAllHints() {
    if (revealedHints.size >= totalSteps) setRevealedHints(new Set());
    else setRevealedHints(new Set(steps.map(s => s.step)));
  }

  function handleSidebarScenario(name: string) {
    if (locked) return;
    // Immediately show the scenario as selected so UI doesn't flash
    useSystem.setState({ scenario: name, scenarioState: 'loading', trackedSteps: [], completedSteps: [] });
    // Then start the scenario
    startScenario(name);
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ═══ TOP: Topology ═══ */}
      <div className="flex-1 min-h-0 border-b border-[var(--border-dim)] relative">
        <TopologyGraph />
        {!scenario && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-void)]/80 backdrop-blur z-10">
            <h2 className="text-[16px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">FIX-MCP Mission Control</h2>
            <p className="text-[12px] text-[var(--text-muted)] font-mono">Select a scenario to begin</p>
          </div>
        )}
        {scenario && (
          <div className="absolute top-2 left-2 z-10 flex gap-1.5">
            <div className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--cyan)]">● {scenario}</div>
            <div className="glass-panel px-2 py-0.5 text-[10px] font-mono">{sessions?.length || 0} sessions</div>
            {doneCount > 0 && <div className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--green)]">{doneCount}/{totalSteps} steps</div>}
            {allDone && <div className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--green)] bg-[var(--green)]/10">✅ Resolved</div>}
          </div>
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <div className="absolute top-0 right-0 bottom-0 w-[220px] z-20 bg-[var(--bg-base)]/95 backdrop-blur-md border-l border-[var(--border-dim)] flex flex-col">
            <button onClick={() => setSidebarOpen(false)} className="absolute left-0 top-1/2 -translate-x-full bg-[var(--bg-surface)] border border-[var(--border-dim)] border-r-0 rounded-l-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><PanelLeftClose size={14} /></button>
            <button onClick={() => setSidebarOpen(true)} className="absolute right-full top-1/2 -translate-y-1/2 mr-[200px] bg-[var(--bg-surface)] border border-[var(--border-dim)] border-r-0 rounded-r-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hidden"><PanelLeftOpen size={14} /></button>

            {/* Control Mode — each button has a tooltip */}
            <div className="px-2.5 py-2 border-b border-[var(--border-dim)]">
              <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Control Mode</div>
              <div className="flex flex-col gap-1">
                <Tip text="You are in full control. Click 'Run' on each runbook step yourself at your own pace. The Copilot chat can answer questions and suggest actions, but nothing runs automatically.">
                  <button onClick={() => releaseToHuman()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'human' ? 'bg-[var(--green-dim)] border-[var(--green)]/50 text-[var(--green)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Hand size={12} /> Human
                  </button>
                </Tip>
                <Tip text="You and the AI work together. You can run steps manually, or ask the Copilot in the chat to run tools, diagnose issues, or suggest next steps. The AI proposes actions and you approve them.">
                  <button onClick={() => toggleCollab()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'collab' ? 'bg-[var(--cyan-dim)] border-[var(--cyan)]/50 text-[var(--cyan)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Users size={12} /> Co-Pilot
                  </button>
                </Tip>
                <Tip text="The AI Agent takes full control. It reads the scenario, diagnoses all issues, runs the runbook steps automatically, and fixes problems without your input. Watch the topology and runbook panels to see it work. Switch back to Human anytime.">
                  <button onClick={() => takeOverAsAgent()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'agent' ? 'bg-[var(--purple-dim)] border-[var(--purple)]/50 text-[var(--purple)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Bot size={12} /> Agent
                  </button>
                </Tip>
              </div>
              <div className="mt-1.5 text-center text-[10px] font-mono" style={{ color: controlMode === 'human' ? 'var(--green)' : controlMode === 'collab' ? 'var(--cyan)' : 'var(--purple)' }}>
                {controlMode === 'human' ? '🧑 You click Run' : controlMode === 'collab' ? '🤝 You + AI' : '🤖 AI drives'}
              </div>
            </div>

            {/* Scenario list */}
            <div className="px-2.5 py-1 border-b border-[var(--border-dim)]">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Scenarios</span>
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5">
              {available_scenarios?.map((s: any) => {
                const isActive = scenario === s.name;
                return (
                  <button key={s.name} onClick={() => handleSidebarScenario(s.name)} disabled={locked}
                    className={`w-full px-2 py-1 rounded text-left transition-all truncate flex items-center gap-1.5 ${isActive ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/40 text-[var(--cyan)] font-bold text-[11px] font-mono' : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-base)] text-[11px] font-mono'}`}>
                    <span className="shrink-0">{isActive ? '●' : <Play size={7} />}</span>
                    <span className="truncate">{s.title || s.name}</span>
                    <span className="ml-auto text-[8px] shrink-0" style={{ color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-[var(--border-dim)]"><HeartbeatPanel onVenueClick={() => {}} /></div>
          </div>
        )}
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-[var(--bg-surface)] border border-[var(--border-dim)] border-r-0 rounded-r-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><PanelLeftOpen size={14} /></button>
        )}
      </div>

      {/* ═══ BOTTOM: Runbook | Terminal | Audit Log ═══ */}
      <div className="h-[420px] flex shrink-0">
        {/* LEFT: Runbook — wider for readability */}
        <div className="w-[520px] min-w-[300px] max-w-[700px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] flex flex-col overflow-hidden" style={{ resize: 'horizontal', overflow: 'auto' }}>
          {scenarioContext ? (
            <>
              <div className="px-3 py-2 border-b border-[var(--border-dim)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1.5">
                  {allDone
                    ? <CheckCircle2 size={14} className="text-[var(--green)]" />
                    : <BookOpen size={14} className="text-[var(--cyan)]" />
                  }
                  <span className="text-[13px] font-bold uppercase">{allDone ? '✅ Resolved' : 'Runbook'}</span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)] ml-1 truncate">{scenarioContext.title}</span>
                </div>
                <Tip text="Each step has a 'Show Solution' button. Click it when you're stuck — it reveals the expected problem, hints, and common mistakes for that step. Use 'Reveal All' to see everything at once.">
                  <button onClick={toggleAllHints}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${revealedHints.size >= totalSteps ? 'bg-[var(--amber-dim)] text-[var(--amber)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                    {revealedHints.size >= totalSteps ? <><EyeOff size={9} /> Reveal All</> : <><Eye size={9} /> Reveal All</>}
                  </button>
                </Tip>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2" ref={runbookScrollRef}>
                {steps.map((step, idx) => {
                  const isDone = step.status === 'done';
                  const isFailed = step.status === 'failed';
                  const isRunning = step.status === 'running';
                  const isRevealed = revealedHints.has(step.step);
                  const result = stepResults[step.step] || step.output || '';
                  return (
                    <div key={step.step}
                      className={`rounded-lg border p-3 ${isDone ? 'border-[var(--green)]/20 bg-[var(--green)]/5' : isFailed ? 'border-[var(--red)]/20 bg-[var(--red)]/5' : isRunning ? 'border-[var(--cyan)]/40 bg-[var(--cyan)]/5' : 'border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--border-base)]'}`}>
                      {/* Step header */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {isDone && <CheckCircle2 size={13} className="text-[var(--green)]" />}
                        {isRunning && <Loader2 size={13} className="text-[var(--cyan)] animate-spin" />}
                        {isFailed && <XCircle size={13} className="text-[var(--red)]" />}
                        {!isDone && !isRunning && !isFailed && <ChevronRight size={13} className="text-[var(--text-dim)]" />}
                        <span className="text-[14px] font-bold">#{step.step} {step.title}</span>
                      </div>
                      {/* Narrative — bigger and more readable */}
                      <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-1.5">{step.narrative}</div>
                      {/* Expected output */}
                      <div className="text-[12px] font-mono text-[var(--text-muted)] mb-1.5"><span className="text-[var(--text-dim)] font-semibold">Expect:</span> {step.expected}</div>
                      {/* Tool command */}
                      <div className="bg-[var(--bg-void)] rounded px-2.5 py-1.5 mb-2"><code className="text-[12px] font-mono text-[var(--green)]">fix-cli&gt; {step.tool}</code></div>
                      {/* Run button */}
                      <Tip text={isDone ? 'Step completed successfully. Click Run again to re-execute.' : isFailed ? 'This step failed. Click Run to retry.' : 'Click to execute this runbook step. The tool will run and results appear below.'}>
                        <button onClick={() => runStep(step, idx)} disabled={isRunning}
                          className={`w-full !text-[11px] !py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-50 rounded-md ${isDone ? 'btn-secondary' : isFailed ? 'btn-danger' : 'btn-secondary'}`}>
                          {isRunning ? <><Loader2 size={11} className="animate-spin" /> Running…</> : <><Activity size={11} /> {isDone ? '✅ Done — Run Again?' : isFailed ? '⚠️ Retry' : 'Run'}</>}
                        </button>
                      </Tip>
                      {/* Tool output */}
                      {result && <div className={`mt-1.5 text-[11px] font-mono leading-relaxed ${isFailed ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>→ {result.slice(0, 300)}{result.length > 300 ? '…' : ''}</div>}
                      {/* Per-step hint toggle */}
                      <button onClick={() => toggleHint(step.step)} className="mt-2 flex items-center gap-1 text-[11px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
                        {isRevealed ? <><EyeOff size={10} /> Hide Solution</> : <><Eye size={10} /> Show Solution</>}
                      </button>
                      {/* Revealed hints */}
                      {isRevealed && scenarioContext?.hints && (
                        <div className="mt-2 p-2 rounded-lg bg-[var(--amber-dim)]/20 border border-[var(--amber)]/20 text-[11px] space-y-1">
                          {scenarioContext.hints.key_problems?.[idx] && <div><span className="text-[var(--red)] font-bold">Problem: </span>{scenarioContext.hints.key_problems[idx]}</div>}
                          {scenarioContext.hints.diagnosis_path && <div><span className="text-[var(--cyan)] font-bold">💡 Hint: </span>{scenarioContext.hints.diagnosis_path}</div>}
                          {scenarioContext.hints.common_mistakes?.[idx] && <div><span className="text-[var(--amber)] font-bold">⚠️ Common mistake: </span>{scenarioContext.hints.common_mistakes[idx]}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Success criteria — when all done */}
                {scenarioContext.success_criteria && allDone && (
                  <div className="mt-2 p-3 rounded-lg bg-[var(--green-dim)]/10 border border-[var(--green)]/30">
                    <div className="text-[13px] font-bold text-[var(--green)] mb-1.5 flex items-center gap-1.5"><CheckCircle2 size={14} /> All Steps Complete — Success Criteria</div>
                    {scenarioContext.success_criteria.map((c: string, i: number) => <div key={i} className="text-[12px] font-mono text-[var(--green)] leading-relaxed">✓ {c}</div>)}
                  </div>
                )}
              </div>
            </>
          ) : scenario ? (
            // Scenario is active but context is loading or failed
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              {scenarioState === 'loading' ? (
                <>
                  <Loader2 size={28} className="text-[var(--cyan)] animate-spin mb-3" />
                  <p className="text-[13px] text-[var(--text-muted)]">Loading scenario…</p>
                </>
              ) : (
                <>
                  <XCircle size={28} className="text-[var(--amber)] mb-3" />
                  <p className="text-[13px] text-[var(--text-muted)] mb-1">No runbook available for</p>
                  <p className="text-[14px] font-mono text-[var(--cyan)] mb-3">{scenario}</p>
                  <button onClick={() => {
                    fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'clear' }) })
                      .then(() => useSystem.setState({ scenario: null, scenarioContext: null, scenarioState: 'idle', completedSteps: [], trackedSteps: [], locked: false, alerts: [], error: null, loading: false }))
                      .catch(() => {});
                  }} className="px-4 py-2 rounded-md bg-[var(--cyan)] text-black text-[12px] font-bold hover:bg-[var(--cyan)]/80">Reset</button>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center"><BookOpen size={20} className="text-[var(--text-muted)] mx-auto mb-2" /><p className="text-[12px] text-[var(--text-muted)]">Select a scenario to see the runbook</p></div>
            </div>
          )}
        </div>

        {/* CENTER: Terminal */}
        <div className="flex-1 min-w-[200px] overflow-hidden p-1.5"><FixTerminal /></div>

        {/* RIGHT: Audit Log */}
        <div className="w-[300px] min-w-[220px] max-[500px] overflow-hidden p-1.5" style={{ resize: 'horizontal', overflow: 'auto' }}><AuditLog /></div>
      </div>
    </div>
  );
}

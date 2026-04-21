'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
import type { RunbookStep } from '@/store';
import {
  Activity, Terminal, BarChart3, PlusCircle, LogOut, Play, Layers,
  Radio, BookOpen, Bot, Users, Hand, Lock, Unlock, RotateCcw,
  Eye, EyeOff, Loader2, ChevronRight, CheckCircle2, XCircle,
  PanelLeftOpen, PanelLeftClose,
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
    useSystem.getState().addHostEvent(
      locked ? 'scenario_unlocked' : 'scenario_locked',
      locked ? `Scenario "${scenario}" unlocked` : `Scenario "${scenario}" locked`,
      'warning'
    );
    useSystem.getState().addAlert(locked ? 'Unlocked' : 'Scenario locked', locked ? 'info' : 'warning', 3000);
  }, [locked, scenario]);

  if (!isAuthenticated) return <AuthGate />;

  const name = scenarioContext?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] overflow-hidden">
      {/* ═══ HEADER ═══ */}
      <header className={`h-11 border-b flex items-center justify-between px-4 shrink-0 transition-all ${locked ? 'bg-[var(--amber-dim)]/20 border-[var(--amber)]/50' : 'bg-[var(--bg-base)] border-[var(--border-dim)]'}`}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-wider">FIX-MCP</span>
          {scenario && (
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-md border ${locked ? 'bg-[var(--amber-dim)]/30 border-[var(--amber)]/50' : 'bg-[var(--cyan-dim)] border-[var(--cyan)]/30'}`}>
              {locked ? <Lock size={11} className="text-[var(--amber)]" /> : <Radio size={8} className="text-[var(--cyan)] animate-pulse" />}
              <span className={`text-[12px] font-mono font-bold ${locked ? 'text-[var(--amber)]' : 'text-[var(--cyan)]'}`}>{name}</span>
            </div>
          )}
        </div>

        <nav className="flex gap-0.5 bg-[var(--bg-surface)] rounded-lg p-0.5 border border-[var(--border-dim)]">
          {[
            { id: 'mission-control' as const, label: 'Mission Control', Icon: Layers },
            { id: 'telemetry' as const, label: 'Telemetry', Icon: BarChart3 },
            { id: 'scenario-library' as const, label: 'Scenarios', Icon: PlusCircle },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1 px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${activeTab === tab.id ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <tab.Icon size={12} /> {tab.label}
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
              <button onClick={handleToggleLock}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold transition-all ${locked ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'bg-[var(--amber-dim)]/30 text-[var(--amber)] border-[var(--amber)]/30'}`}>
                {locked ? <><Unlock size={11} /> Unlock</> : <><Lock size={11} /> Lock</>}
              </button>
              <button onClick={handleReset}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--red-dim)]/50 text-[var(--red)] border border-[var(--red)]/30 text-[11px] font-semibold hover:bg-[var(--red-dim)] transition-all">
                <RotateCcw size={10} /> Reset
              </button>
            </>
          )}
          <button onClick={toggleOpen} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:text-[var(--text-secondary)]'}`}>
            <Terminal size={10} /> Copilot
          </button>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">{user?.username || 'anon'}</span>
          <button onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--red)]"><LogOut size={11} /></button>
        </div>
      </header>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-hidden tab-content-enter">
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
  const { scenario, scenarioContext, sessions, controlMode, takeOverAsAgent, releaseToHuman, toggleCollab, trackedSteps, callTool, completeStep, setStepStatus, addHostEvent, addAlert, available_scenarios, locked, startScenario } = useSystem();
  const { send } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [stepResults, setStepResults] = useState<Record<number, string>>({});
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  const runbook = scenarioContext?.runbook;
  const steps = trackedSteps.length > 0
    ? trackedSteps
    : (runbook?.steps || []).map((s: RunbookStep, i: number) => ({ ...s, status: (i === 0 ? 'running' : 'pending'), output: '' }));

  const doneCount = trackedSteps.filter(s => s.status === 'done').length;
  const totalSteps = steps.length;

  const runStep = async (step: typeof steps[0], idx: number) => {
    if (step.status === 'running') return;
    setStepStatus(step.step, 'running');
    setActiveStepIdx(idx);
    try {
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      setStepResults(prev => ({ ...prev, [step.step]: result }));
      completeStep(step.step);
      addHostEvent('step_complete', `Step ${step.step} "${step.title}" done ✓`, 'info');
      if (idx + 1 < steps.length) { setActiveStepIdx(idx + 1); setStepStatus(steps[idx + 1].step, 'running'); }
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      setStepResults(prev => ({ ...prev, [step.step]: `Error: ${err.message}` }));
      addHostEvent('step_failed', `Step ${step.step} failed: ${err.message}`, 'error');
    }
  };

  const toggleHint = (n: number) => setRevealedHints(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ═══ TOP: Topology graph + optional sidebar ═══ */}
      <div className="flex-1 min-h-0 border-b border-[var(--border-dim)] relative">
        <TopologyGraph />
        {!scenario && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-void)]/80 backdrop-blur z-10">
            <div className="text-center">
              <h2 className="text-[16px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">FIX-MCP Mission Control</h2>
              <p className="text-[12px] text-[var(--text-muted)] font-mono">Select a scenario to begin</p>
            </div>
          </div>
        )}

        {/* Scenario info overlay */}
        {scenario && (
          <div className="absolute top-2 left-2 z-10 flex gap-1.5">
            <div className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--cyan)]">● {scenario}</div>
            <div className="glass-panel px-2 py-0.5 text-[10px] font-mono">{sessions?.length} sessions</div>
            {doneCount > 0 && <div className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--green)]">Step {doneCount}/{totalSteps}</div>}
          </div>
        )}

        {/* ── Right sidebar: Control Mode + Scenarios ── */}
        {sidebarOpen && (
          <div className="absolute top-0 right-0 bottom-0 w-[220px] z-20 bg-[var(--bg-base)]/95 backdrop-blur-md border-l border-[var(--border-dim)] flex flex-col">
            {/* Toggle button */}
            <button onClick={() => setSidebarOpen(false)} className="absolute left-0 top-1/2 -translate-x-full bg-[var(--bg-surface)] border border-[var(--border-dim)] border-r-0 rounded-l-md p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Collapse sidebar">
              <PanelLeftClose size={14} />
            </button>

            {/* Control Mode */}
            {scenario && (
              <div className="px-2.5 py-2 border-b border-[var(--border-dim)]">
                <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Control Mode</div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => releaseToHuman()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'human' ? 'bg-[var(--green-dim)] border-[var(--green)]/50 text-[var(--green)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Hand size={12} /> Human
                  </button>
                  <button onClick={() => toggleCollab()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'collab' ? 'bg-[var(--cyan-dim)] border-[var(--cyan)]/50 text-[var(--cyan)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Users size={12} /> Co-Pilot
                  </button>
                  <button onClick={() => takeOverAsAgent()} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-[11px] font-bold transition-all ${controlMode === 'agent' ? 'bg-[var(--purple-dim)] border-[var(--purple)]/50 text-[var(--purple)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                    <Bot size={12} /> Agent
                  </button>
                </div>
              </div>
            )}

            {/* Scenario list */}
            <div className="px-2.5 py-1 border-b border-[var(--border-dim)]">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Scenarios</span>
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5">
              {available_scenarios?.map((s: any) => {
                const isActive = scenario === s.name;
                return (
                  <button key={s.name} onClick={() => !isActive && !locked && startScenario(s.name)} disabled={locked}
                    className={`w-full px-2 py-1 rounded text-left text-[11px] font-mono transition-all truncate ${isActive ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/40 text-[var(--cyan)] font-bold' : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-base)]'}`}>
                    {isActive ? '●' : <Play size={7} className="inline text-[var(--text-muted)]" />} {s.title || s.name}
                    <span className="float-right text-[8px]" style={{ color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Show sidebar button (when collapsed) */}
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="absolute left-0 top-1/2 -translate-y-1/2 ml-0 z-20 bg-[var(--bg-surface)] border border-[var(--border-dim)] border-r-0 rounded-r-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Show sidebar">
            <PanelLeftOpen size={14} />
          </button>
        )}
      </div>

      {/* ═══ BOTTOM: Runbook | Terminal | Audit Log ═══ */}
      <div className="h-[320px] min-h-[200px] flex shrink-0">
        {/* LEFT: Runbook */}
        <div className="w-[360px] min-w-[250px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] flex flex-col overflow-hidden">
          {scenarioContext ? (
            <>
              <div className="px-3 py-1 border-b border-[var(--border-dim)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1"><BookOpen size={11} className="text-[var(--cyan)]" /><span className="text-[11px] font-bold text-[var(--cyan)] uppercase">Runbook</span><span className="text-[10px] font-mono text-[var(--text-muted)] ml-1">{scenarioContext.title}</span></div>
                <button onClick={() => setRevealedHints(prev => prev.size >= totalSteps ? new Set() : new Set(steps.map(s => s.step)))}
                  className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-bold ${revealedHints.size >= totalSteps ? 'bg-[var(--amber-dim)] text-[var(--amber)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                  {revealedHints.size >= totalSteps ? <><EyeOff size={9} /> Hide</> : <><Eye size={9} /> Hints</>}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1.5">
                {steps.map((step, idx) => {
                  const isDone = step.status === 'done';
                  const isFailed = step.status === 'failed';
                  const isRunning = step.status === 'running';
                  const isActive = activeStepIdx === idx;
                  const isRevealed = revealedHints.has(step.step);
                  const result = stepResults[step.step] || step.output || '';
                  return (
                    <div key={step.step} className={`rounded-md border p-2 ${isActive ? 'border-[var(--cyan)]/40 bg-[var(--cyan)]/5' : isDone ? 'border-[var(--green)]/20 bg-[var(--green)]/5' : isFailed ? 'border-[var(--red)]/20 bg-[var(--red)]/5' : 'border-[var(--border-dim)] bg-[var(--bg-surface)]'}`}>
                      <div className="flex items-center gap-1 mb-0.5">
                        {isDone && <CheckCircle2 size={11} className="text-[var(--green)]" />}
                        {isRunning && <Loader2 size={11} className="text-[var(--cyan)] animate-spin" />}
                        {isFailed && <XCircle size={11} className="text-[var(--red)]" />}
                        {!isDone && !isRunning && !isFailed && <ChevronRight size={11} className="text-[var(--text-dim)]" />}
                        <span className="text-[11px] font-bold">#{step.step} {step.title}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-0.5">{step.narrative}</div>
                      <div className="text-[10px] font-mono text-[var(--text-muted)] mb-0.5">Expect: {step.expected}</div>
                      <div className="bg-[var(--bg-void)] rounded px-1.5 py-0.5 mb-1"><code className="text-[10px] font-mono text-[var(--green)]">fix-cli&gt; {step.tool}</code></div>
                      <button onClick={() => runStep(step, idx)} disabled={isRunning}
                        className="w-full btn-secondary !text-[10px] !py-0.5 flex items-center justify-center gap-1 disabled:opacity-50">
                        {isRunning ? <><Loader2 size={9} className="animate-spin" /> Running…</> : <><Activity size={9} /> Run</>}
                      </button>
                      {result && <div className={`mt-0.5 text-[10px] font-mono ${isFailed ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>→ {result.slice(0, 200)}</div>}
                      <button onClick={() => toggleHint(step.step)} className="mt-1 flex items-center gap-1 text-[10px] text-[var(--amber)] hover:underline">
                        {isRevealed ? <><EyeOff size={9} /> Hide Solution</> : <><Eye size={9} /> Show Solution</>}
                      </button>
                      {isRevealed && scenarioContext?.hints && (
                        <div className="mt-1 p-1.5 rounded bg-[var(--amber-dim)]/20 border border-[var(--amber)]/20 text-[10px] space-y-0.5">
                          {scenarioContext.hints.key_problems?.[idx] && <div><span className="text-[var(--red)] font-bold">Problem:</span> {scenarioContext.hints.key_problems[idx]}</div>}
                          {scenarioContext.hints.diagnosis_path && <div><span className="text-[var(--cyan)] font-bold">Hint:</span> {scenarioContext.hints.diagnosis_path}</div>}
                          {scenarioContext.hints.common_mistakes?.[idx] && <div><span className="text-[var(--amber)] font-bold">Watch:</span> {scenarioContext.hints.common_mistakes[idx]}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {scenarioContext.success_criteria && doneCount >= totalSteps && (
                  <div className="mt-2 p-2 rounded bg-[var(--green-dim)]/10 border border-[var(--green)]/30">
                    <div className="text-[11px] font-bold text-[var(--green)] mb-1">✅ Success Criteria</div>
                    {scenarioContext.success_criteria.map((c: string, i: number) => <div key={i} className="text-[10px] font-mono text-[var(--green)]">✓ {c}</div>)}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4"><p className="text-[12px] text-[var(--text-muted)]">Select a scenario</p></div>
          )}
        </div>

        {/* CENTER: Terminal */}
        <div className="flex-1 min-w-[300px] overflow-hidden p-1.5"><FixTerminal /></div>

        {/* RIGHT: Audit Log */}
        <div className="w-[300px] min-w-[220px] overflow-hidden p-1.5"><AuditLog /></div>
      </div>
    </div>
  );
}

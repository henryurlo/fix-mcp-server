'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep, TrackedStep } from '@/store';
import {
  Activity,
  Terminal,
  BarChart3,
  PlusCircle,
  LogOut,
  Play,
  AlertTriangle,
  Layers,
  Radio,
  BookOpen,
  Shield,
  Bot,
  Users,
  Hand,
  Lock,
  RotateCcw,
  Eye,
  EyeOff,
  Info,
  Lightbulb,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronsRight,
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const TelemetryDashboard = dynamic(() => import('@/components/TelemetryDashboard'), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator').then(m => ({ default: m.ScenarioCreator })), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const AuditLog = dynamic(() => import('@/components/AuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });

type TabId = 'mission-control' | 'telemetry' | 'scenario-library';
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'mission-control', label: 'Mission Control', icon: Layers },
  { id: 'telemetry', label: 'Telemetry', icon: BarChart3 },
  { id: 'scenario-library', label: 'Scenario Library', icon: PlusCircle },
];

const SEV: Record<string, string> = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--purple)' };
const STEP_ICON: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  pending: { icon: <ChevronsRight size={11} />, color: 'var(--text-dim)', bg: 'var(--bg-surface)', label: 'READY' },
  running: { icon: <Loader2 size={11} className="animate-spin" />, color: 'var(--cyan)', bg: 'var(--cyan-dim)', label: 'RUNNING' },
  done: { icon: <CheckCircle2 size={11} />, color: 'var(--green)', bg: 'var(--green-dim)', label: 'DONE' },
  failed: { icon: <XCircle size={11} />, color: 'var(--red)', bg: 'var(--red-dim)', label: 'FAILED' },
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('mission-control');
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
    } catch (err) { console.error('Reset failed:', err); }
  }, [clear]);

  if (!isAuthenticated) return <AuthGate />;
  const displayName = scenarioContext?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] overflow-hidden">
      {/* ═══ HEADER ═══ */}
      <header className={`h-11 border-b flex items-center justify-between px-3 shrink-0 transition-all ${locked ? 'bg-[var(--red-dim)]/30 border-[var(--red)]/50' : 'bg-[var(--bg-base)] border-[var(--border-dim)]'}`}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-wider">FIX-MCP</span>
          {locked && scenario && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--red-dim)]/60 border border-[var(--red)]/50">
              <Lock size={11} className="text-[var(--red)] animate-pulse" />
              <span className="text-[12px] font-mono font-bold text-[var(--red)]">LOCKED: {displayName}</span>
            </div>
          )}
          {!locked && scenario && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={8} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[12px] font-mono font-semibold text-[var(--cyan)]">{displayName}</span>
            </div>
          )}
        </div>
        <nav className="flex gap-0.5 bg-[var(--bg-surface)] rounded-lg p-0.5 border border-[var(--border-dim)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (<button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-all ${activeTab === tab.id ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={12} /> {tab.label}
            </button>);
          })}
        </nav>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-[11px] font-mono ${connected ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}><span className={`status-dot ${connected ? 'healthy' : 'down'}`} /> {connected ? 'LIVE' : 'OFFLINE'}</span>
          <select value={scenario || ''} onChange={(e) => e.target.value && !locked && startScenario(e.target.value)} disabled={locked}
            className={`input-base !w-auto !py-1 !px-2 !text-[11px] !font-mono !rounded-md max-w-[200px] ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}>
            <option value="">{locked ? '🔒 Locked' : '▶ Launch…'}</option>
            {available_scenarios?.map((s: any) => (<option key={s.name} value={s.name}>{s.title || s.name} ({s.estimated_minutes}m)</option>))}
          </select>
          {scenario && (<button onClick={handleReset} className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--red-dim)]/50 text-[var(--red)] border border-[var(--red)]/30 text-[11px] font-semibold hover:bg-[var(--red-dim)] transition-all"><RotateCcw size={10} /> {locked ? 'Reset & Exit' : 'Reset'}</button>)}
          <button onClick={toggleOpen} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:text-[var(--text-secondary)]'}`}><Terminal size={10} /> Copilot</button>
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
        <aside className={`transition-all duration-300 ease-out bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[400px]' : 'w-0'} overflow-hidden shrink-0`}><ChatPanel /></aside>
      </div>
    </div>
  );
}

// ════ MISSION CONTROL ════

function MissionControlTab() {
  const { scenario, scenarioContext, sessions, controlMode, takeOverAsAgent, releaseToHuman, toggleCollab, trackedSteps, callTool, completeStep, setStepStatus, addHostEvent, addAlert, available_scenarios, locked, startScenario } = useSystem();
  const { send, isOpen, toggleOpen } = useChat();
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [stepResults, setStepResults] = useState<Record<string, string>>({});

  const runbook = scenarioContext?.runbook;
  const steps = useMemo(() => {
    if (trackedSteps.length > 0) return trackedSteps.map(t => ({ ...t, output: t.output || '' }));
    return (runbook?.steps || []).map((s: RunbookStep, i: number) => ({ ...s, status: (i === 0 ? 'running' : 'pending'), output: '' }));
  }, [trackedSteps, runbook]);

  const totalSteps = steps.length;
  const doneCount = trackedSteps.filter(s => s.status === 'done').length;

  const handleRunStep = async (step: typeof steps[0], idx: number) => {
    if (step.status === 'running') return;
    setStepStatus(step.step, 'running');
    setActiveStepIdx(idx);
    try {
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      setStepResults(prev => ({ ...prev, [step.step]: result }));
      completeStep(step.step);
      addHostEvent('step_complete', `Step ${step.step} "${step.title}" completed ✓`, 'info');
      addAlert(`Step ${step.step} done → ${step.step + 1 <= steps.length ? `advancing` : 'all done!'}`, 'success', 4000);
      if (idx + 1 < steps.length) { setActiveStepIdx(idx + 1); setStepStatus(steps[idx + 1].step, 'running'); }
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      setStepResults(prev => ({ ...prev, [step.step]: `Error: ${err.message}` }));
      addHostEvent('step_failed', `Step ${step.step} failed: ${err.message}`, 'error');
      addAlert(`Step ${step.step} failed: ${err.message}`, 'error', 6000);
    }
  };

  const toggleHint = (n: number) => setRevealedHints(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ROW 1: Topology + Right strip */}
      <div className="flex-1 min-h-0 border-b border-[var(--border-dim)] relative">
        <TopologyGraph />
        {!scenario && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-void)]/80 backdrop-blur-sm z-10">
            <h2 className="text-[16px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">FIX-MCP Mission Control</h2>
            <p className="text-[12px] text-[var(--text-muted)] font-mono">Launch a scenario to begin</p>
          </div>
        )}
        {scenario && (
          <div className="absolute top-2 left-3 z-10 flex gap-2">
            <div className="glass-panel px-2.5 py-1"><span className="text-[11px] font-mono text-[var(--cyan)]">● {scenario}</span></div>
            <div className="glass-panel px-2.5 py-1"><span className="text-[11px] font-mono">{sessions?.length} sessions</span></div>
            {doneCount > 0 && <div className="glass-panel px-2.5 py-1"><span className="text-[11px] font-mono text-[var(--green)]">Step {doneCount}/{totalSteps}</span></div>}
          </div>
        )}
        {locked && scenario && (
          <div className="absolute top-0 left-0 right-[220px] z-30 flex items-center justify-between px-4 py-1 bg-[var(--red)]/20 backdrop-blur-sm border-b border-[var(--red)]/40">
            <div className="flex items-center gap-2"><Lock size={11} className="text-[var(--red)] animate-pulse" /><span className="text-[11px] font-bold text-[var(--red)]">SCENARIO LOCKED — {scenario}</span></div>
            <span className="text-[10px] text-[var(--red)]/60 font-mono">Hit Reset to change</span>
          </div>
        )}

        {/* Right panel: Control Mode + Scenarios (with scrollbar) */}
        <div className="absolute top-0 right-0 bottom-0 w-[220px] z-20 bg-[var(--bg-base)]/95 backdrop-blur-md border-l border-[var(--border-dim)] flex flex-col">
          {/* Control Mode */}
          {scenario && (
            <div className="px-2.5 py-2 border-b border-[var(--border-dim)]">
              <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Control Mode</div>
              <div className="flex flex-col gap-1">
                <button onClick={() => releaseToHuman()} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] font-bold transition-all ${controlMode === 'human' ? 'bg-[var(--green-dim)] border-[var(--green)]/50 text-[var(--green)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                  <Hand size={13} /> <span>Human</span>
                </button>
                <button onClick={() => toggleCollab()} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] font-bold transition-all ${controlMode === 'collab' ? 'bg-[var(--cyan-dim)] border-[var(--cyan)]/50 text-[var(--cyan)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                  <Users size={13} /> <span>Co-Pilot</span>
                </button>
                <button onClick={() => takeOverAsAgent()} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] font-bold transition-all ${controlMode === 'agent' ? 'bg-[var(--purple-dim)] border-[var(--purple)]/50 text-[var(--purple)]' : 'border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                  <Bot size={13} /> <span>Agent</span>
                </button>
              </div>
              <div className="mt-1.5 text-center text-[10px] font-mono" style={{ color: controlMode === 'human' ? 'var(--green)' : controlMode === 'collab' ? 'var(--cyan)' : 'var(--purple)' }}>
                Active: {controlMode === 'human' ? 'Human' : controlMode === 'collab' ? 'Co-Pilot' : 'Agent'}
              </div>
            </div>
          )}

          {/* Scenario list */}
          <div className="px-2.5 py-1.5 border-b border-[var(--border-dim)]">
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Scenarios</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            {available_scenarios?.map((s: any) => {
              const isActive = scenario === s.name;
              return (
                <button key={s.name} onClick={() => !isActive && !locked && startScenario(s.name)} disabled={locked}
                  className={`w-full px-2 py-1 rounded text-left transition-all text-[11px] font-mono truncate ${isActive ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/40 text-[var(--cyan)] font-bold' : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-base)]'}`}>
                  <div className="flex items-center gap-1">{isActive ? <Radio size={7} className="text-[var(--cyan)] animate-pulse shrink-0" /> : <Play size={7} className="text-[var(--text-muted)] shrink-0" />}{s.title || s.name}<span className="ml-auto text-[9px]" style={{ color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span></div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ROW 2: Runbook | Terminal | Audit Log */}
      <div className="h-[320px] flex shrink-0">
        {/* LEFT: Runbook (scrollable) */}
        <div className="w-[380px] min-w-[280px] max-w-[420px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] flex flex-col overflow-hidden">
          {scenarioContext ? (
            <>
              <div className="px-3 py-1.5 border-b border-[var(--border-dim)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1.5"><BookOpen size={11} className="text-[var(--cyan)]" /><span className="text-[11px] font-bold text-[var(--cyan)] uppercase">Runbook</span><span className="text-[10px] font-mono text-[var(--text-muted)] ml-2">{scenarioContext.title}</span></div>
                <button onClick={() => setRevealedHints(prev => prev.size >= totalSteps ? new Set() : new Set(steps.map(s => s.step)))}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${revealedHints.size >= totalSteps ? 'bg-[var(--amber-dim)] text-[var(--amber)]' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
                  {revealedHints.size >= totalSteps ? <><EyeOff size={10} /> Hide All</> : <><Eye size={10} /> Hints</>}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1.5">
                {steps.map((step, idx) => {
                  const si = STEP_ICON[step.status] || STEP_ICON.pending;
                  const result = stepResults[step.step] || step.output || '';
                  const isRevealed = revealedHints.has(step.step);
                  return (
                    <div key={step.step}
                      className={`rounded-md border p-2 ${activeStepIdx === idx ? 'bg-[var(--cyan)]/5 border-[var(--cyan)]/30' : step.status === 'done' ? 'bg-[var(--green)]/5 border-[var(--green)]/20' : step.status === 'failed' ? 'bg-[var(--red)]/5 border-[var(--red)]/20' : 'bg-[var(--bg-surface)] border-[var(--border-dim)]'}`}>
                      {/* Step header */}
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span style={{ color: si.color }}>{si.icon}</span>
                        <span className="text-[11px] font-bold text-[var(--text-primary)]">#{step.step}</span>
                        <span className="text-[11px] font-semibold text-[var(--text-secondary)] flex-1 truncate">{step.title}</span>
                        <span className="text-[9px] font-bold uppercase px-1 py-0 rounded shrink-0" style={{ color: si.color, backgroundColor: si.bg }}>{si.label}</span>
                      </div>
                      {/* Narrative */}
                      <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-1">{step.narrative}</div>
                      {/* Expected (always shown) */}
                      <div className="text-[10px] font-mono text-[var(--text-muted)] mb-1"><span className="text-[var(--text-dim)]">Expect:</span> {step.expected}</div>
                      {/* Tool command */}
                      <div className="bg-[var(--bg-void)] rounded px-1.5 py-0.5 mb-1"><code className="text-[10px] font-mono text-[var(--green)]">fix-cli&gt; {step.tool}{Object.keys(step.tool_args || {}).length ? ` ${JSON.stringify(step.tool_args)}` : ''}</code></div>
                      {/* Run button */}
                      <button onClick={() => handleRunStep(step, idx)} disabled={step.status === 'running'}
                        className="w-full btn-secondary !text-[10px] !py-0.5 !px-2 flex items-center justify-center gap-1 disabled:opacity-50">
                        {step.status === 'running' ? <><Loader2 size={9} className="animate-spin" /> Running…</> : <><Activity size={9} /> Run {step.tool}</>}
                      </button>
                      {/* Tool output */}
                      {result && (<div className={`mt-1 text-[10px] font-mono leading-relaxed ${step.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>→ {result.slice(0, 200)}{result.length > 200 ? '…' : ''}</div>)}
                      {/* Hint toggle button for each step */}
                      <button onClick={() => toggleHint(step.step)} className="mt-1 flex items-center gap-1 text-[10px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
                        {isRevealed ? <><EyeOff size={9} /> Hide Solution</> : <><Eye size={9} /> Show Solution</>}
                      </button>
                      {/* Revealed hints (key problems, diagnosis, common mistakes) */}
                      {isRevealed && scenarioContext?.hints && (
                        <div className="mt-1.5 p-1.5 rounded bg-[var(--amber-dim)]/20 border border-[var(--amber)]/20 space-y-1">
                          {scenarioContext.hints.key_problems?.[idx] && (<div className="text-[10px]"><span className="text-[var(--red)] font-bold">Problem: </span>{scenarioContext.hints.key_problems[idx]}</div>)}
                          {scenarioContext.hints.diagnosis_path && (<div className="text-[10px]"><span className="text-[var(--cyan)] font-bold">💡 Hint: </span>{scenarioContext.hints.diagnosis_path}</div>)}
                          {scenarioContext.hints.common_mistakes?.[idx] && (<div className="text-[10px]"><span className="text-[var(--amber)] font-bold">⚠️ Watch: </span>{scenarioContext.hints.common_mistakes[idx]}</div>)}
                          {scenarioContext.hints.flag_meanings && Object.keys(scenarioContext.hints.flag_meanings).length > 0 && (
                            <div className="text-[10px]"><span className="text-[var(--text-muted)] font-bold">Flags:</span> {Object.entries(scenarioContext.hints.flag_meanings).map(([k, v]) => `${k}=${v}`).join(', ')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Success criteria (only show once all done) */}
                {scenarioContext.success_criteria && doneCount >= totalSteps && (
                  <div className="mt-2 p-2 rounded bg-[var(--green-dim)]/10 border border-[var(--green)]/30">
                    <div className="text-[11px] font-bold text-[var(--green)] mb-1">✅ All Steps Complete — Success Criteria</div>
                    {scenarioContext.success_criteria.map((c: string, i: number) => <div key={i} className="text-[10px] font-mono text-[var(--green)]">✓ {c}</div>)}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-4"><BookOpen size={20} className="text-[var(--text-muted)] mb-2" /><p className="text-[12px] text-[var(--text-muted)]">Select a scenario</p></div>
          )}
        </div>

        {/* CENTER: Terminal */}
        <div className="flex-1 min-w-[300px] overflow-hidden p-1.5"><FixTerminal /></div>

        {/* RIGHT: Audit Log */}
        <div className="w-[320px] min-w-[250px] overflow-hidden p-1.5"><AuditLog /></div>
      </div>
    </div>
  );
}

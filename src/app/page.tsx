'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep } from '@/store';
import {
  Activity,
  Terminal,
  Zap,
  BarChart3,
  PlusCircle,
  LogOut,
  User,
  Play,
  AlertTriangle,
  Layers,
  Radio,
  Server,
  ArrowUpRight,
  ChevronRight,
  BookOpen,
  Wrench,
  RotateCcw,
  X,
  Shield,
  Bot,
  Users,
  Hand,
  Lock,
  AlertCircle,
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const TelemetryDashboard = dynamic(() => import('@/components/TelemetryDashboard'), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator').then(m => ({ default: m.ScenarioCreator })), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const AuditLog = dynamic(() => import('@/components/AuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });
const RunbookPanel = dynamic(() => import('@/components/RunbookPanel'), { ssr: false });

type TabId = 'mission-control' | 'telemetry' | 'scenario-library';

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'mission-control', label: 'Mission Control', icon: Layers },
  { id: 'telemetry', label: 'Telemetry', icon: BarChart3 },
  { id: 'scenario-library', label: 'Scenario Library', icon: PlusCircle },
];

// Derive a RunbookDef from ScenarioContext for UI rendering
interface RunbookDef {
  title: string;
  narrative: string;
  steps: RunbookStep[];
  tools: string[];
  successCriteria?: string[];
  hints?: {
    keyProblems: string[];
    diagnosisPath: string;
    flagMeanings: Record<string, string>;
    commonMistakes: string[];
  };
}

function buildRunbook(ctx: ScenarioContext | null): RunbookDef | null {
  if (!ctx) return null;
  return {
    title: ctx.title.toUpperCase(),
    narrative: ctx.runbook?.narrative || ctx.description,
    steps: ctx.runbook?.steps || [],
    tools: ctx.runbook?.steps?.map((s) => s.tool) || [],
    successCriteria: ctx.success_criteria || [],
    hints: ctx.hints ? {
      keyProblems: ctx.hints.key_problems || [],
      diagnosisPath: ctx.hints.diagnosis_path || '',
      flagMeanings: ctx.hints.flag_meanings || {},
      commonMistakes: ctx.hints.common_mistakes || [],
    } : undefined,
  };
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'var(--green)',
  medium: 'var(--amber)',
  high: 'var(--red)',
  critical: 'var(--purple)',
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('mission-control');
  const { scenario, scenarioContext, available_scenarios: available, loading, startScenario, refresh, sessions, events, error, connected, locked, setLocked } = useSystem();
  const { isOpen, toggleOpen } = useChat();
  const { isAuthenticated, user, logout } = useAuth();
  const runbook = buildRunbook(scenarioContext);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const scenarioDisplay = scenarioContext
    ? scenarioContext.title
    : scenario
      ? scenario.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : '';
  const telemetry = useTelemetry();

  useEffect(() => { refresh(); telemetry.refresh(); }, []);
  useEffect(() => {
    const iv = setInterval(() => { refresh(); telemetry.refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh, telemetry]);

  const handleStartScenario = useCallback((name: string) => {
    startScenario(name);
    if (isOpen) {
      // We import useChat dynamically to avoid SSR issues
      const chatState = useChat.getState();
      chatState.send(`Scenario "${name}" has been triggered. Please begin monitoring and guide me through the troubleshooting runbook.`);
    }
  }, [startScenario, isOpen]);

  const handleReset = useCallback(async () => {
    // Reset: clear scenario, unlock, clear state
    try {
      await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'clear' }),
      });
      // Clear local state
      useSystem.setState({
        scenario: null,
        scenarioContext: null,
        scenarioState: 'idle',
        completedSteps: [],
        trackedSteps: [],
        locked: false,
        alerts: [],
        error: null,
        loading: false,
      });
      // Clear chat
      useChat.getState().clear();
    } catch (err) {
      console.error('Reset failed:', err);
    }
    setShowResetConfirm(false);
  }, []);

  if (!isAuthenticated) return <AuthGate />;

  const activeFaults = events?.filter((e: any) => e.severity === 'critical' || e.severity === 'warning').length || 0;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] overflow-hidden">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className={`h-12 border-b flex items-center justify-between px-5 shrink-0 transition-all ${
        locked
          ? 'bg-[var(--cyan-dim)]/30 border-[var(--cyan)]/40'
          : 'bg-[var(--bg-base)] border-[var(--border-dim)]'
      }`}>
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm font-bold tracking-wider">FIX-MCP</span>
            <span className="text-[12px] text-[var(--text-muted)] font-mono ml-2">Mission Control</span>
          </div>

          {/* Locked scenario badge */}
          {locked && scenario && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30 animate-pulse">
              <Lock size={10} className="text-[var(--cyan)]" />
              <span className="text-[14px] font-mono font-semibold text-[var(--cyan)]">{scenarioDisplay}</span>
              <span className="text-[10px] font-mono text-[var(--cyan)]/70">LOCKED</span>
            </div>
          )}

          {/* Scenario without lock */}
          {!locked && scenarioContext && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={10} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-semibold text-[var(--cyan)]">{scenarioDisplay}</span>
            </div>
          )}
          {!locked && !scenarioContext && scenario && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={10} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-semibold text-[var(--cyan)]">{scenario}</span>
            </div>
          )}

          {/* Active faults indicator */}
          {runbook && runbook.hints && runbook.hints.keyProblems.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30">
              <AlertTriangle size={11} className="text-[var(--red)]" />
              <span className="text-[13px] font-mono font-semibold text-[var(--red)]">{runbook.hints.keyProblems.length} ISSUES</span>
            </div>
          )}
        </div>

        <nav className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-lg p-1 border border-[var(--border-dim)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[14px] font-semibold transition-all ${
                  isActive ? 'bg-[var(--bg-elevated)] text-[var(--cyan)] border border-[var(--cyan)]/20' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/50'
                }`}>
                <Icon size={13} /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {error && <span className="text-[13px] text-[var(--red)] font-mono max-w-[200px] truncate">{error}</span>}
          {connected ? (
            <span className="flex items-center gap-1 text-[13px] text-[var(--green)] font-mono"><span className="status-dot healthy" /> LIVE</span>
          ) : (
            <span className="flex items-center gap-1 text-[13px] text-[var(--red)] font-mono"><span className="status-dot down" /> OFFLINE</span>
          )}

          {/* Scenario launch (disabled when locked) */}
          <select value={scenario || ''} onChange={(e) => e.target.value && !locked && handleStartScenario(e.target.value)}
            disabled={locked}
            className={`input-base !w-auto !py-1 !px-2.5 !text-[13px] !font-mono !rounded-lg max-w-[160px] ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <option value="">{locked ? 'Locked — Reset to change' : 'Launch Scenario…'}</option>
            {available?.map((s: any) => (
              <option key={s.name} value={s.name}>
                [{s.severity?.toUpperCase() || 'MEDIUM'}] {s.title || s.name}{s.is_algo ? ' ⚡' : ''} ({s.estimated_minutes || '?'}m)
              </option>
            ))}
          </select>

          {/* Reset button — only when a scenario is active */}
          {showResetConfirm ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/40">
              <AlertCircle size={10} className="text-[var(--red)]" />
              <span className="text-[12px] font-mono text-[var(--red)]">Reset?</span>
              <button onClick={handleReset} className="text-[12px] font-bold text-[var(--red)] hover:underline px-1">Yes</button>
              <button onClick={() => setShowResetConfirm(false)} className="text-[12px] text-[var(--text-muted)] hover:underline px-1">No</button>
            </div>
          ) : scenario ? (
            <button onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--red-dim)]/50 text-[var(--red)] border border-[var(--red)]/30 text-[13px] font-semibold hover:bg-[var(--red-dim)] transition-all">
              <RotateCcw size={12} /> Reset
            </button>
          ) : null}

          <button onClick={toggleOpen}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold border transition-all ${
              isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:border-[var(--border-base)]'
            }`}>
            <Terminal size={12} /> SRE Copilot
          </button>

          <div className="flex items-center gap-2 ml-1 pl-2 border-l border-[var(--border-dim)]">
            <span className="text-[13px] font-mono text-[var(--text-secondary)]">{user?.username || 'anon'}</span>
            <button onClick={logout} className="text-[var(--text-dim)] hover:text-[var(--red)] transition-colors" title="Logout">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-hidden tab-content-enter">
          {activeTab === 'mission-control' && <MissionControlTab />}
          {activeTab === 'telemetry' && <TelemetryDashboard />}
          {activeTab === 'scenario-library' && <ScenarioCreator />}
        </main>
        <aside className={`transition-all duration-300 ease-out bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[400px]' : 'w-0'} overflow-hidden shrink-0`}>
          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}

// ── MISSION CONTROL (dynamic runbooks from scenario JSON) ─────────────

function MissionControlTab() {
  const { scenario, scenarioContext, sessions, trackedSteps, setStepStatus, completeStep, callTool, controlMode, takeOverAsAgent, releaseToHuman, toggleCollab, mode } = useSystem();
  const { isOpen, toggleOpen, send } = useChat();
  const [activeStep, setActiveStep] = useState<number>(0);

  const runbook = buildRunbook(scenarioContext);
  const totalSteps = trackedSteps.length || scenarioContext?.runbook?.steps?.length || 0;
  const doneCount = trackedSteps.filter((s) => s.status === 'done').length;
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
  const allDone = doneCount === totalSteps && totalSteps > 0;
  const isResolved = allDone;

  // Phase labels for the lifecycle indicator
  const PHASES = [
    { key: 'diagnosing', label: 'DIAGNOSE', icon: '🔍' },
    { key: 'addressing', label: 'ADDRESS', icon: '🔧' },
    { key: 'validating', label: 'VALIDATE', icon: '✅' },
    { key: 'resolved', label: 'RESOLVED', icon: '🟢' },
  ];
  const currentPhaseIdx = isResolved ? 3 : doneCount === 0 ? 0 : doneCount < totalSteps * 0.4 ? 0 : doneCount < totalSteps * 0.8 ? 1 : 2;
  const currentPhase = PHASES[currentPhaseIdx];

  // ── Legacy step runner (for backward compat with old RunbookStep) ──
  const handleRunStep = async (step: RunbookStep) => {
    try {
      setStepStatus(step.step, 'running');
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      completeStep(step.step);
      // Auto-advance to next step
      const nextIdx = trackedSteps.findIndex((s) => s.step === step.step) + 1;
      if (nextIdx < trackedSteps.length && trackedSteps[nextIdx].status === 'pending') {
        setStepStatus(trackedSteps[nextIdx].step, 'running');
      }
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
    }
  };

  const handleStartScenario = (name: string) => {
    // This gets handled in the parent
    setActiveStep(0);
  };

  // Control mode display
  const controlModeUI = {
    human: { icon: <Hand size={13} />, label: 'HUMAN', color: 'var(--green)' },
    agent: { icon: <Bot size={13} />, label: 'AGENT', color: 'var(--purple)' },
    collab: { icon: <Users size={13} />, label: 'COLLAB', color: 'var(--cyan)' },
  };
  const cm = controlModeUI[controlMode];

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ── TOP ROW: Left sidebar (30%) + Terminal (70%) ─────────── */}
      <div className="flex-1 flex min-h-0 border-b border-[var(--border-dim)]">
        {/* LEFT: Compact Topology + Heartbeat + Scenario Picker */}
        <div className="w-[30%] min-w-[220px] max-w-[340px] flex flex-col bg-[var(--bg-base)] border-r border-[var(--border-dim)] overflow-hidden">
          {/* Mini Topology (no MiniMap) */}
          <div className="h-[35%] min-h-[100px] border-b border-[var(--border-dim)] relative">
            <TopologyGraph />
            {!scenario && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-void)]/70 backdrop-blur-sm z-10">
                <h2 className="text-[14px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">
                  FIX-MCP Mission Control
                </h2>
                <p className="text-[12px] text-[var(--text-muted)] font-mono">Pick a scenario ↓</p>
              </div>
            )}

            {/* Phase progress overlay */}
            {runbook && totalSteps > 0 && (
              <div className="absolute top-1 left-1 right-1 z-10">
                <div className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-void)]/90 rounded-md backdrop-blur-sm border border-[var(--border-dim)]">
                  <span className="text-[14px] font-mono">{currentPhase.icon}</span>
                  {PHASES.map((p, i) => (
                    <div key={p.key} className="flex-1 flex flex-col items-center">
                      <div className={`h-1.5 rounded-full w-full transition-all ${
                        i <= currentPhaseIdx ? (isResolved ? 'bg-[var(--green)]' : 'bg-[var(--cyan)]') : 'bg-[var(--border-dim)]'
                      }`} />
                    </div>
                  ))}
                  <span className="text-[13px] font-mono text-[var(--text-muted)]">{pct}%</span>
                </div>
              </div>
            )}
          </div>

          {/* FIX Heartbeat Panel */}
          <HeartbeatPanel onVenueClick={() => {}} />

          {/* Scenario Picker */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
                <Layers size={9} /> Scenarios
              </span>
              <span className="text-[14px] font-mono text-[var(--text-muted)]">
                {/* Scenarios count */}
              </span>
            </div>

            {/* Control mode indicator */}
            {scenario && (
              <div className="mb-2 flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-dim)]">
                {cm.icon}
                <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ color: cm.color, backgroundColor: cm.color + '20' }}>
                  {cm.label}
                </span>
                <div className="flex gap-0.5 ml-auto">
                  <button onClick={() => releaseToHuman()} className={`text-[10px] px-1.5 py-0.5 rounded ${controlMode === 'human' ? 'bg-[var(--green-dim)] text-[var(--green)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`} title="Human">
                    <Hand size={9} />
                  </button>
                  <button onClick={() => takeOverAsAgent()} className={`text-[10px] px-1.5 py-0.5 rounded ${controlMode === 'agent' ? 'bg-[var(--purple-dim)] text-[var(--purple)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`} title="Agent">
                    <Bot size={9} />
                  </button>
                  <button onClick={() => toggleCollab()} className={`text-[10px] px-1.5 py-0.5 rounded ${controlMode === 'collab' ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`} title="Collaborate">
                    <Users size={9} />
                  </button>
                </div>
              </div>
            )}

            {/* Scenario list */}
            <ScenarioList activeScenario={scenario} />
          </div>
        </div>

        {/* RIGHT: Live Terminal (70%) */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <FixTerminal />
        </div>
      </div>

      {/* ── BOTTOM ROW: Runbook (left) + Audit Log (right) ──── */}
      <div className="h-[38%] min-h-[180px] flex">
        {/* LEFT: Runbook Panel */}
        <div className="w-[30%] min-w-[220px] max-w-[340px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] overflow-hidden flex flex-col">
          <RunbookPanel scenarioContext={scenarioContext} scenario={scenario} />
        </div>

        {/* RIGHT: Unified Audit Log (MCP / HOST / FIX tabs) */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <AuditLog />
        </div>
      </div>
    </div>
  );
}

/* ── Scenario list (extracted) ─────────────────────────────────────── */

function ScenarioList({ activeScenario }: { activeScenario: string | null }) {
  const { available_scenarios: available, startScenario } = useSystem();

  return (
    <div className="space-y-1">
      {available?.map((s: any) => {
        const sevColor = SEVERITY_COLORS[s.severity] || SEVERITY_COLORS.medium;
        const isActive = activeScenario === s.name;
        return (
          <button
            key={s.name}
            onClick={() => !isActive && startScenario(s.name)}
            className={`w-full flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-md text-left transition-all ${
              isActive
                ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/30'
                : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
            }`}
          >
            <div className="flex items-center gap-1.5 w-full">
              {isActive
                ? <Radio size={9} className="text-[var(--cyan)] animate-pulse shrink-0" />
                : <Play size={9} className="text-[var(--text-muted)] shrink-0" />
              }
              <span className="text-[13px] font-mono font-semibold truncate flex-1">{s.title || s.name}</span>
              <span
                className="text-[13px] font-bold px-1 py-px rounded shrink-0"
                style={{ backgroundColor: sevColor, color: '#0a0b0e' }}
              >
                {s.severity?.toUpperCase()}
              </span>
            </div>
            {s.description && (
              <span className="text-[14px] text-[var(--text-muted)] truncate pl-3.5">{s.description.slice(0, 80)}…</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: number | string; icon: React.ReactNode; color: string }) {
  const colorMap: Record<string, string> = {
    cyan: 'text-[var(--cyan)]', green: 'text-[var(--green)]', blue: 'text-[var(--blue)]',
    red: 'text-[var(--red)]', amber: 'text-[var(--amber)]', purple: 'text-[var(--purple)]',
  };
  return (
    <div className="bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={colorMap[color] || 'text-[var(--text-muted)]'}>{icon}</span>
        <span className="text-[12px] font-mono text-[var(--text-muted)] uppercase">{label}</span>
      </div>
      <div className={`text-lg font-bold font-mono ${colorMap[color] || 'text-[var(--text-primary)]'}`}>{value}</div>
    </div>
  );
}

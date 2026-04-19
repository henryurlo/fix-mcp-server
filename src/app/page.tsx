'use client';

import { useEffect, useState } from 'react';
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
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const TelemetryDashboard = dynamic(() => import('@/components/TelemetryDashboard'), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator'), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const FixWireLog = dynamic(() => import('@/components/McpAuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });

type TabId = 'mission-control' | 'telemetry' | 'scenario-library';

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'mission-control', label: 'Mission Control', icon: Layers },
  { id: 'telemetry', label: 'Telemetry', icon: BarChart3 },
  { id: 'scenario-library', label: 'Scenario Library', icon: PlusCircle },
];

// ── Runbook types (aliased from store for convenience) ─────────────

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

// Build RunbookDef from loaded scenario context
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

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '●',
  intermediate: '●●',
  advanced: '●●●',
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('mission-control');
  const { scenario, scenarioContext, available_scenarios: available, loading, startScenario, refresh, sessions, events, error, connected } = useSystem();
  const { isOpen, toggleOpen } = useChat();
  const { isAuthenticated, user, logout } = useAuth();
  const runbook = buildRunbook(scenarioContext);

  // Display rich title when available, fallback to formatted name
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

  if (!isAuthenticated) return <AuthGate />;

  const activeFaults = events?.filter((e: any) => e.severity === 'critical' || e.severity === 'warning').length || 0;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] overflow-hidden">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="h-12 bg-[var(--bg-base)] border-b border-[var(--border-dim)] flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm font-bold tracking-wider">FIX-MCP</span>
            <span className="text-[12px] text-[var(--text-muted)] font-mono ml-2">Mission Control</span>
          </div>
          {scenarioContext && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={10} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-semibold text-[var(--cyan)]">{scenarioDisplay}</span>
            </div>
          )}
          {!scenarioContext && scenario && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={10} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-semibold text-[var(--cyan)]">{scenario}</span>
            </div>
          )}
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

          <select value={scenario || ''} onChange={(e) => e.target.value && startScenario(e.target.value)}
            className="input-base !w-auto !py-1 !px-2.5 !text-[13px] !font-mono !rounded-lg max-w-[160px]">
            <option value="">Launch Scenario…</option>
            {available?.map((s: any) => (
              <option key={s.name} value={s.name}>
                [{s.severity?.toUpperCase() || 'MEDIUM'}] {s.title || s.name}{s.is_algo ? ' ⚡' : ''} ({s.estimated_minutes || '?'}m)
              </option>
            ))}
          </select>

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
  const { scenario, scenarioContext, scenarioState, completedSteps, available_scenarios: available, startScenario, completeStep, sessions, callTool } = useSystem();
  const { isOpen, toggleOpen, send } = useChat();
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [stepResults, setStepResults] = useState<Record<number, string>>({});

  const activeScenarioName = scenario || selectedScenario;
  const activeContext = scenarioContext || null;
  const runbook = buildRunbook(activeContext);

  // Derive phase from completed steps + total runbook steps
  const totalSteps = runbook?.steps.length || 0;
  const doneCount = completedSteps.length;
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
  const isResolved = doneCount >= totalSteps && totalSteps > 0;

  // Phase labels for the lifecycle indicator
  const PHASES = [
    { key: 'diagnosing', label: 'DIAGNOSE', icon: '🔍' },
    { key: 'addressing', label: 'ADDRESS', icon: '🔧' },
    { key: 'validating', label: 'VALIDATE', icon: '✅' },
    { key: 'resolved', label: 'RESOLVED', icon: '🟢' },
  ];

  const currentPhaseIdx = isResolved ? 3 : doneCount === 0 ? 0 : doneCount < totalSteps * 0.4 ? 0 : doneCount < totalSteps * 0.8 ? 1 : 2;
  const currentPhase = PHASES[currentPhaseIdx];

  const handleRunStep = async (step: RunbookStep) => {
    try {
      setStepResults((prev) => ({ ...prev, [step.step]: 'Running…' }));
      const result = await callTool(step.tool, step.tool_args);
      setStepResults((prev) => ({ ...prev, [step.step]: result || 'Done ✓' }));
      completeStep(step.step);
    } catch (err: any) {
      setStepResults((prev) => ({ ...prev, [step.step]: `Error: ${err.message}` }));
    }
  };

  const handleStartScenario = (name: string) => {
    setSelectedScenario(name);
    setActiveStep(0);
    setStepResults({});
    startScenario(name);
    if (isOpen) {
      send(`Scenario "${name}" has been triggered. Please begin monitoring and guide me through the troubleshooting runbook.`);
    }
  };

  const handleVenueClick = (_venue: string) => {
    // For now — informational only, HeartbeatPanel handles display
  };

  // Check which success criteria are met (heuristic: no errors in step results)
  const doneCountLocal = Object.keys(stepResults).length;
  const allStepsComplete = runbook && doneCountLocal === totalSteps && runbook.steps.length > 0;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ── TOP ROW: Left sidebar (30%) + Terminal (70%) ─────────── */}
      <div className="flex-1 flex min-h-0 border-b border-[var(--border-dim)]">
        {/* LEFT: Compact Topology + Heartbeat + Scenario Picker */}
        <div className="w-[30%] min-w-[220px] max-w-[340px] flex flex-col bg-[var(--bg-base)] border-r border-[var(--border-dim)] overflow-hidden">
          {/* Mini Topology (no MiniMap) */}
          <div className="h-[35%] min-h-[100px] border-b border-[var(--border-dim)] relative">
            <TopologyGraph />
            {!scenario && !selectedScenario && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-void)]/70 backdrop-blur-sm z-10">
                <h2 className="text-[14px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">
                  FIX-MCP Mission Control
                </h2>
                <p className="text-[12px] text-[var(--text-muted)] font-mono">Pick a scenario ↓</p>
              </div>
            )}
            {runbook && totalSteps > 0 && (
              <div className="absolute top-1 left-1 right-1 z-10">
                <div className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-void)]/90 rounded-md backdrop-blur-sm border border-[var(--border-dim)]">
                  <span className="text-[14px] font-mono">{currentPhase.icon}</span>
                  {PHASES.map((p, i) => (
                    <div key={p.key} className="flex-1 flex flex-col items-center">
                      <div className={`h-1.5 rounded-full w-full ${
                        i <= currentPhaseIdx ? (isResolved ? 'bg-[var(--green)]' : 'bg-[var(--cyan)]') : 'bg-[var(--border-dim)]'
                      }`} />
                    </div>
                  ))}
                  <span className="text-[13px] font-mono text-[var(--text-dim)]">{pct}%</span>
                </div>
              </div>
            )}
          </div>

          {/* FIX Heartbeat Panel */}
          <HeartbeatPanel onVenueClick={handleVenueClick} />

          {/* Scenario Picker */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
                <Layers size={9} /> Scenarios
              </span>
              <span className="text-[14px] font-mono text-[var(--text-dim)]">{available?.length || 0}</span>
            </div>
            <div className="space-y-1">
              {available?.map((s: any) => {
                const sevColor = SEVERITY_COLORS[s.severity] || SEVERITY_COLORS.medium;
                return (
                  <button
                    key={s.name}
                    onClick={() => handleStartScenario(s.name)}
                    className={`w-full flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-md text-left transition-all ${
                      scenario === s.name
                        ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/30'
                        : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      {scenario === s.name
                        ? <Radio size={9} className="text-[var(--cyan)] animate-pulse shrink-0" />
                        : <Play size={9} className="text-[var(--text-dim)] shrink-0" />
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
          </div>
        </div>

        {/* RIGHT: Live Terminal (70%) */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <FixTerminal />
        </div>
      </div>

      {/* ── BOTTOM ROW: Runbook (left) + FIX Wire Log (right) ──── */}
      <div className="h-[38%] min-h-[180px] flex">
        {/* LEFT: Runbook Panel */}
        <div className="w-[30%] min-w-[220px] max-w-[340px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] overflow-hidden flex flex-col">
          {runbook ? (
            <>
              {/* Runbook Scenario Narrative */}
              <div className="px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
                <div className="flex items-center gap-2">
                  <span className="status-dot active w-1.5 h-1.5" />
                  <span className="text-[12px] font-bold text-[var(--cyan)] uppercase tracking-wider">
                    {scenario ? 'Active' : 'Preview'}
                  </span>
                  {allStepsComplete && runbook.successCriteria && runbook.successCriteria.length > 0 && (
                    <span className="text-[12px] font-bold text-[var(--green)] uppercase tracking-wider flex items-center gap-0.5">
                      ✓ RESOLVED
                    </span>
                  )}
                </div>
                <h3 className="text-[14px] font-bold mt-0.5">{runbook.title}</h3>
                {scenarioContext && (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">
                      {scenarioContext.simulated_time}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-dim)]">
                      {scenarioContext.estimated_minutes}m · {scenarioContext.estimated_minutes < 20 ? 'Quick' : scenarioContext.estimated_minutes < 30 ? 'Moderate' : 'Extended'}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-dim)]">
                      {DIFFICULTY_LABELS[scenarioContext.difficulty] || ''} {scenarioContext.difficulty}
                    </span>
                    {scenarioContext.categories?.slice(0, 3).map((cat: string) => (
                      <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-void)] text-[var(--text-dim)] font-mono">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                {/* Key Problems — show immediately so operator knows what's wrong */}
                {runbook.hints?.keyProblems && runbook.hints.keyProblems.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {runbook.hints.keyProblems.map((p, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--red)] leading-relaxed">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[12px] text-[var(--text-secondary)] mt-2 leading-relaxed">{runbook.narrative}</p>
              </div>

              {/* Steps */}
              <div className="flex-1 overflow-y-auto p-2">
                <div className="space-y-2">
                  {runbook.steps.map((step, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveStep(i)}
                      className={`p-2 rounded border transition-all cursor-pointer ${
                        activeStep === i
                          ? 'bg-[var(--cyan-dim)] border-[var(--cyan)]/30'
                          : 'bg-[var(--bg-surface)] border-[var(--border-dim)] hover:border-[var(--border-base)]'
                      }`}
                    >
                      {/* Step # + Title */}
                      <div className="text-[13px] font-bold text-[var(--text-primary)] mb-0.5">
                        #{step.step} {step.title}
                      </div>

                      {/* Narrative */}
                      <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-1.5">
                        {step.narrative}
                      </div>

                      {/* CLI command */}
                      <div className="bg-[var(--bg-void)] rounded px-2 py-1 mb-1.5">
                        <code className="text-[12px] font-mono text-[var(--green)]">
                          fix-cli&gt; {step.tool}{Object.keys(step.tool_args || {}).length ? ` ${JSON.stringify(step.tool_args)}` : ''}
                        </code>
                      </div>

                      {/* Run button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunStep(step);
                        }}
                        className="w-full btn-secondary !text-[12px] !py-0.5 !px-2 flex items-center justify-center gap-1"
                      >
                        <Activity size={9} /> Run {step.tool}
                      </button>

                      {/* Step result if available */}
                      {stepResults[step.step] && (
                        <div className={`mt-1 text-[14px] font-mono leading-relaxed ${
                          stepResults[step.step].startsWith('Error:')
                            ? 'text-[var(--red)]'
                            : 'text-[var(--green)]'
                        }`}>
                          → {stepResults[step.step]}
                        </div>
                      )}

                      {/* Expected */}
                      <p className="text-[14px] text-[var(--text-dim)] mt-1">
                        Expected: {step.expected}
                      </p>
                    </div>
                  ))}

                  {/* Success Criteria */}
                  {runbook.successCriteria && runbook.successCriteria.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-dim)]">
                      <div className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        ✓ Success Criteria ({completedSteps}/{runbook.successCriteria.length} complete)
                      </div>
                      <div className="space-y-1">
                        {Object.keys(stepResults).length > 0 && (
                          runbook.successCriteria.map((c, i) => {
                            const isComplete = i < completedSteps;
                            return (
                              <div key={i} className={`text-[14px] font-mono flex items-start gap-1 ${
                                isComplete ? 'text-[var(--green)]' : 'text-[var(--text-dim)]'
                              }`}>
                                <span>{isComplete ? '✓' : '○'}</span>
                                <span>{c}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Copilot button */}
              <div className="px-2 py-2 border-t border-[var(--border-dim)] shrink-0">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleRunStep(runbook.steps[activeStep] || runbook.steps[0])}
                    className="btn-secondary flex-1 flex items-center justify-center gap-1 text-[12px]"
                  >
                    <Wrench size={10} /> Run Step
                  </button>
                  <button
                    onClick={() => {
                      if (!isOpen) toggleOpen();
                      send(`I'm on step ${activeStep + 1} of the ${runbook.title} runbook: "${runbook.steps[activeStep]?.title}"`);
                    }}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 text-[12px]"
                  >
                    <Terminal size={10} /> Copilot
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              <BookOpen size={24} className="text-[var(--text-dim)] mb-2" />
              <p className="text-[13px] text-[var(--text-muted)]">Select a scenario to see the runbook.</p>
            </div>
          )}
        </div>

        {/* RIGHT: FIX Wire Log */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <FixWireLog />
        </div>
      </div>
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

'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
import type { ScenarioContext, RunbookStep, TrackedStep } from '@/store';
import {
  Activity, Terminal as TerminalIcon, BarChart3, PlusCircle, LogOut, Play, Layers,
  Radio, BookOpen, RotateCcw, BookMarked, MessageSquare,
  Eye, EyeOff, Loader2, ChevronRight, CheckCircle2, XCircle, Info,
  PanelLeftOpen, PanelLeftClose, ArrowRight, FileText, Send, Wrench,
  ChevronDown, ChevronUp, AlertTriangle, Lightbulb, Zap, Eye as EyeIcon, Star,
  X, Trophy, Clock, Award, GraduationCap,
} from 'lucide-react';

const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const TelemetryDashboard = dynamic(() => import('@/components/TelemetryDashboard'), { ssr: false });
const ScenarioCreator = dynamic(() => import('@/components/ScenarioCreator').then(m => ({ default: m.ScenarioCreator })), { ssr: false });
const AuthGate = dynamic(() => import('@/components/AuthGate'), { ssr: false });
const FixTerminal = dynamic(() => import('@/components/FixTerminal'), { ssr: false });
const AuditLog = dynamic(() => import('@/components/AuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });
const TrainingPanel = dynamic(() => import('@/components/TrainingPanel').then(m => ({ default: m.TrainingPanel })), { ssr: false });

const SEV: Record<string, string> = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--purple)' };
const SEV_BG: Record<string, string> = { low: 'var(--green-dim)', medium: 'var(--amber-dim)', high: 'var(--red-dim)', critical: 'var(--purple-dim)' };

// ═══════════════════════════════════════════════════════════
// Collapsible Step Output
// ═══════════════════════════════════════════════════════════
function CollapsibleStepOutput({ output, isFailed }: { output: string; isFailed: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const lines = output.split('\n').filter(l => l.trim().length > 0).length;

  return (
    <div className={`rounded-lg border ${isFailed ? 'border-[var(--red)]/20' : 'border-[var(--border-dim)]'} overflow-hidden`}>
      {/* Always-visible header with Run button */}
      <div className="bg-[var(--bg-void)] px-3 py-2 flex items-center gap-2">
        {collapsed ? (
          <button onClick={() => setCollapsed(false)}
            className="flex items-center gap-2 text-[13px] w-full text-left">
            <ChevronDown size={12} className={`text-[var(--text-dim)] transition-transform`} />
            <span className={isFailed ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
              {isFailed ? '✗ Failed' : '✓ Completed'} — {lines} lines of output
            </span>
            <ChevronDown size={12} className="ml-auto text-[var(--text-dim)]" />
          </button>
        ) : (
          <button onClick={() => setCollapsed(true)}
            className="flex items-center gap-2 text-[13px] w-full text-left">
            <ChevronDown size={12} className="text-[var(--text-dim)] rotate-180 transition-transform" />
            <span className={isFailed ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
              {isFailed ? '✗ Failed' : '✓ Completed'} — {lines} lines of output
            </span>
            <ChevronDown size={12} className="ml-auto text-[var(--text-dim)]" />
          </button>
        )}
      </div>
      {!collapsed && (
        <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all p-3 bg-[var(--bg-void)]"
          style={{ color: isFailed ? 'var(--red)' : 'var(--green)' }}>
          {output}
        </pre>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Completion Screen Modal
// ═══════════════════════════════════════════════════════════
function CompletionScreen({ steps, hintsUsed, startTime, onClose, onNewScenario }: {
  steps: TrackedStep[];
  hintsUsed: number;
  startTime: number;
  onClose: () => void;
  onNewScenario: () => void;
}) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const totalSteps = steps.length;
  const doneSteps = steps.filter(s => s.status === 'done').length;
  const hintsUsedCount = hintsUsed;
  // Rating: clean = 3 stars, 1 hint = 2 stars, 2+ hints = 1 star
  const rating = hintsUsedCount === 0 ? 3 : hintsUsedCount === 1 ? 2 : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-bright)] rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto mb-4">
            <Trophy size={32} className="text-[var(--green)]" />
          </div>
          <h2 className="text-[24px] font-bold text-[var(--green)] mb-1">Case Complete!</h2>
          <p className="text-[15px] text-[var(--text-muted)]">You&#39;ve resolved all {totalSteps} steps successfully.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <Clock size={20} className="text-[var(--cyan)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{mins > 0 ? `${mins}m ` : ''}{secs}s</div>
            <div className="text-[12px] text-[var(--text-muted)]">Time Taken</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <CheckCircle2 size={20} className="text-[var(--green)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{doneSteps}/{totalSteps}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Steps Done</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <Lightbulb size={20} className="text-[var(--amber)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{hintsUsedCount}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Hints Used</div>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="text-[14px] text-[var(--text-muted)] mb-2">Performance Rating</div>
          <div className="flex items-center justify-center gap-1">
            {[1, 2, 3].map(i => (
              <Star key={i} size={28} className={i <= rating ? 'text-[var(--amber)] fill-[var(--amber)]' : 'text-[var(--text-dim)]'} />
            ))}
          </div>
          <div className="text-[14px] text-[var(--text-secondary)] mt-1">
            {rating === 3 ? '🔥 Clean Completion — No hints needed!' : rating === 2 ? '👍 Good — Used 1 hint' : '💡 Keep practicing — You\'ll get faster!'}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onNewScenario}
            className="flex-1 py-3 rounded-lg bg-[var(--cyan)] text-black text-[14px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-2">
            <Play size={16} fill="currentColor" /> New Scenario
          </button>
          <button onClick={onClose}
            className="px-4 py-3 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-dim)] text-[14px] font-semibold hover:bg-[var(--bg-elevated)] transition-colors flex items-center gap-2">
            <Activity size={16} /> View Topology
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 justify-center text-[12px] text-[var(--text-dim)]">
          <span>Press <kbd className="px-1.5 py-0.5 bg-[var(--bg-void)] rounded text-[11px] font-mono border border-[var(--border-dim)]">Esc</kbd> to continue</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Keyboard shortcuts hook
// ═══════════════════════════════════════════════════════════
function useKeyboardShortcuts({ onRun, onHint, onToggleCopilot, onNavPrev, onNavNext }: {
  onRun?: () => void;
  onHint?: () => void;
  onToggleCopilot?: () => void;
  onNavPrev?: () => void;
  onNavNext?: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          onRun?.();
          break;
        case 'h':
          e.preventDefault();
          onHint?.();
          break;
        case 'tab':
          e.preventDefault();
          onToggleCopilot?.();
          break;
        case 'escape':
          e.preventDefault();
          onToggleCopilot?.();
          break;
        case 'arrowleft':
        case 'arrowup':
          e.preventDefault();
          onNavPrev?.();
          break;
        case 'arrowright':
        case 'arrowdown':
          e.preventDefault();
          onNavNext?.();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onRun, onHint, onToggleCopilot, onNavPrev, onNavNext]);
}

// ═══ Scenario Case Brief — the story presentation ═══
function CaseBrief({ ctx, onStart }: { ctx: ScenarioContext; onStart: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const problems = ctx.hints?.key_problems || [];
  const diagnosis = ctx.hints?.diagnosis_path || '';

  return (
    <div className="p-5 overflow-y-auto">
      {/* Briefing header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase" style={{ backgroundColor: SEV_BG[ctx.severity], color: SEV[ctx.severity] }}>
            {ctx.severity}
          </div>
          <span className="text-[12px] text-[var(--text-muted)] font-mono">{ctx.simulated_time || ''}</span>
          <span className="text-[12px] text-[var(--text-muted)] font-mono">~{ctx.estimated_minutes} min</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <BookMarked size={20} className="text-[var(--cyan)]" />
          <h2 className="text-[20px] font-bold">{ctx.title}</h2>
        </div>

        {/* Scenario story — the "real case" presentation */}
        <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-base)] p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} className="text-[var(--cyan)]" />
            <span className="text-[14px] font-bold">Case Briefing</span>
          </div>
          <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
            {ctx.runbook?.narrative || ctx.description}
          </p>
        </div>

        {/* Key problems */}
        {problems.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-[var(--amber)]" />
              <span className="text-[14px] font-bold">Issues to Diagnose</span>
            </div>
            <div className="space-y-1.5">
              {problems.map((p: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-[14px] text-[var(--text-secondary)] leading-relaxed">
                  <span className="text-[var(--red)] font-bold mt-0.5">•</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Where to start — diagnosis path */}
        {diagnosis && (
          <div className="flex items-start gap-2 bg-[var(--cyan-dim)]/10 border border-[var(--cyan)]/20 rounded-lg p-3 mb-4">
            <Lightbulb size={14} className="text-[var(--cyan)] shrink-0 mt-0.5" />
            <div>
              <span className="text-[14px] font-bold text-[var(--cyan)]">Where to start</span>
              <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{diagnosis}</p>
            </div>
          </div>
        )}

        {/* Success criteria */}
        {ctx.success_criteria?.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 mb-2">
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="text-[14px] font-bold text-[var(--green)]">Success Criteria ({ctx.success_criteria.length})</span>
          </button>
        )}
        {expanded && ctx.success_criteria?.length > 0 && (
          <div className="space-y-1 mb-4 pl-4 border-l-2 border-[var(--green)]/30">
            {ctx.success_criteria.map((c: string, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[14px] text-[var(--green)]">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        )}

        {/* Start button */}
        <button onClick={onStart}
          className="w-full py-3 rounded-lg bg-[var(--cyan)] text-black text-[16px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-2">
          <Play size={18} fill="currentColor" /> Begin Case Study
        </button>
      </div>
    </div>
  );
}

// ═══ FIX Wire Messages view ═══
function FixWireView({ sessions }: { sessions: any[] }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/fix-wire')
      .then(r => r.json())
      .then(data => setMessages((data || []).slice(0, 50)))
      .catch(() => {});
  }, [sessions]);

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[14px] text-[var(--text-muted)]">
        No FIX wire messages yet. Run a scenario step to generate traffic.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {messages.map((msg, i) => {
        const typeColor = msg.msg_type === 'D' ? 'var(--cyan)' : msg.msg_type === '8' ? 'var(--green)' : msg.msg_type === '3' ? 'var(--red)' : 'var(--text-muted)';
        const isExpanded = expanded === i;
        return (
          <button key={i} onClick={() => setExpanded(isExpanded ? null : i)}
            className={`w-full text-left px-3 py-2 border-b border-[var(--border-dim)] hover:bg-[var(--bg-elevated)] transition-colors ${isExpanded ? 'bg-[var(--bg-elevated)]' : ''}`}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-dim)] font-mono w-[90px]">{msg.ts?.split('T')[1]?.split('.')[0] || msg.ts}</span>
              <span className="text-[12px] font-bold font-mono" style={{ color: typeColor }}>{msg.type}</span>
              <span className="text-[12px] text-[var(--text-secondary)] truncate">{msg.symbol || ''} {msg.side ? `· ${msg.side}` : ''} {msg.qty ? `· ${msg.qty}` : ''}</span>
              <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto">{msg.venue || ''}</span>
              <ChevronRight size={12} className={`text-[var(--text-dim)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            {isExpanded && msg.message && (
              <pre className="mt-2 text-[12px] font-mono text-[var(--green)] leading-relaxed whitespace-pre-wrap break-all">{msg.message}</pre>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══ Main Page ═══
export default function Home() {
  const [activeTab, setActiveTab] = useState<'mission-control' | 'telemetry' | 'scenario-library'>('mission-control');
  const { scenario, scenarioContext, scenarioState, available_scenarios, refresh, error, connected, startScenario, sessions, trackedSteps, callTool, setStepStatus, completeStep, addAlert, addHostEvent, locked } = useSystem();
  const { isOpen, toggleOpen } = useChat();
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
      useSystem.setState({ scenario: null, scenarioContext: null, scenarioState: 'idle', completedSteps: [], trackedSteps: [], locked: false });
    } catch (e) { console.error('Reset failed:', e); }
  }, []);

  const name = scenarioContext?.title ?? (scenario ? scenario.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '');

  if (!isAuthenticated) return <AuthGate />;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)]">
      {/* ═══ HEADER ═══ */}
      <header className="h-12 border-b border-[var(--border-dim)] flex items-center justify-between px-4 shrink-0 bg-[var(--bg-base)]">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-bold tracking-wider">FIX-MCP</span>
          {scenario && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={8} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[14px] font-mono font-bold text-[var(--cyan)]">{name}</span>
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-all ${activeTab === id ? 'bg-[var(--bg-elevated)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className={`text-[13px] font-mono ${connected ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{connected ? '● LIVE' : '● OFFLINE'}</span>
          <select value={scenario || ''} onChange={(e) => e.target.value && startScenario(e.target.value)}
            className="input-base !w-auto !py-1.5 !px-3 !text-[13px] !font-mono !rounded-md max-w-[220px]">
            <option value="">▶ Launch Scenario…</option>
            {available_scenarios?.map((s: any) => (
              <option key={s.name} value={s.name}>{s.title || s.name} ({s.estimated_minutes}m)</option>
            ))}
          </select>
          {scenario && (
            <button onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--red-dim)]/40 text-[var(--red)] border border-[var(--red)]/30 text-[13px] font-semibold hover:bg-[var(--red-dim)] transition-all">
              <RotateCcw size={12} /> Reset
            </button>
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
          <span className="text-[13px] font-mono text-[var(--text-muted)]">{user?.username || 'anon'}</span>
          <button onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--red)]"><LogOut size={14} /></button>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {activeTab === 'mission-control' && <MissionControlTab scenario={scenario} available_scenarios={available_scenarios} />}
          {activeTab === 'telemetry' && <TelemetryDashboard />}
          {activeTab === 'scenario-library' && <ScenarioCreator />}
        </main>
        <aside className={`transition-all duration-300 bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[420px]' : 'w-0'} overflow-hidden shrink-0`}><ChatPanel /></aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Mission Control Tab — main scenario workspace
// ═══════════════════════════════════════════════════════════

function MissionControlTab({ scenario: parentScenario, available_scenarios: parentScenarios }: { scenario: string | null; available_scenarios: any[] }) {
  const { scenario, scenarioContext, scenarioState, sessions, startScenario, trackedSteps, callTool, setStepStatus, completeStep, addAlert, addHostEvent } = useSystem();
  const { isOpen: chatOpen, toggleOpen: toggleChat } = useChat();
  const [bottomTab, setBottomTab] = useState<'case' | 'terminal' | 'fixwire'>('case');
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

  // Reset state on scenario change
  useEffect(() => {
    setShowCaseBrief(true);
    setCurrentStep(0);
    setRevealedHints(new Set());
    setFocusMode(false);
    setTopologyCollapsed(false);
    setShowCompletion(false);
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

  // Show completion screen when all done
  useEffect(() => {
    if (allDone && !showCompletion) {
      setShowCompletion(true);
    }
  }, [allDone]);

  async function runStep(step: typeof steps[0], idx: number) {
    if (step.status === 'running') return;
    setStepStatus(step.step, 'running');
    try {
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      setStepResults(prev => ({ ...prev, [step.step]: result }));
      completeStep(step.step);
      addAlert(`Step ${step.step} complete`, 'success', 3000);
      // Auto-advance to next step
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

  if (!scenario) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg-void)]">
        {/* Full-screen welcome with scenario grid */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-[28px] font-bold mb-2 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">FIX-MCP Mission Control</h1>
              <p className="text-[16px] text-[var(--text-muted)]">Real-world FIX protocol incident simulations. Walk through each case like a real production outage.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {activeScenarios?.map((s: any) => (
                <button key={s.name} onClick={() => startScenario(s.name)}
                  className="p-4 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--cyan)]/50 hover:bg-[var(--bg-elevated)] transition-all text-left group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Play size={12} className="text-[var(--cyan)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="text-[15px] font-bold group-hover:text-[var(--cyan)] transition-colors">{s.title || s.name}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: SEV_BG[s.severity], color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                  </div>
                  <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{s.description?.slice(0, 120)}...</p>
                  <div className="mt-2 text-[12px] text-[var(--text-dim)] font-mono">{s.estimated_minutes} min · {s.runbook_step_count || '?'} steps</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Scenario active ──
  const activeScenario = scenarioContext || null;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      {/* ═══ TOP: Toggleable Topology ═══ */}
      <div
        className={`border-b border-[var(--border-dim)] relative shrink-0 transition-all duration-300 overflow-hidden ${
          topologyCollapsed ? 'h-[40px] min-h-[40px]' : 'h-[180px] min-h-[180px]'
        }`}
        onClick={() => setTopologyCollapsed(!topologyCollapsed)}
        style={{ cursor: 'pointer' }}
      >
        {!topologyCollapsed && <TopologyGraph />}
        {/* Always-visible status bar */}
        <div className={`absolute top-1 left-2 z-10 flex gap-2 items-center ${topologyCollapsed ? 'w-full px-4 justify-center' : ''}`}>
          {!topologyCollapsed && (
            <>
              <div className="glass-panel px-2.5 py-1 text-[11px] font-mono text-[var(--cyan)]">● {scenario}</div>
              <div className="glass-panel px-2.5 py-1 text-[11px] font-mono">{sessions?.length || 0} sessions</div>
              {doneCount > 0 && <div className="glass-panel px-2.5 py-1 text-[11px] font-mono text-[var(--green)]">{doneCount}/{totalSteps} · {progressPct}%</div>}
              {allDone && <div className="glass-panel px-2.5 py-1 text-[11px] font-mono text-[var(--green)] bg-[var(--green)]/10">✅ Resolved</div>}
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setTopologyCollapsed(!topologyCollapsed); }}
            className="glass-panel px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {topologyCollapsed ? <><ChevronDown size={10} /> Expand Topology</> : <><ChevronUp size={10} /> Collapse</>}
          </button>
        </div>
      </div>

      {/* ═══ BOTTOM: Case Study / Runbook ═══ */}
      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ${focusMode ? 'max-w-5xl mx-auto w-full' : 'flex'}`}>
          {/* Tab bar: Case Study | Terminal | FIX Wire */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0">
          <div className="flex gap-0.5">
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
              {/* LEFT: Step guide (wide) */}
              <div className={`flex-1 min-w-[400px] overflow-y-auto transition-all duration-300 ${showTraining ? 'mr-0' : ''}`} ref={runbookScrollRef}>
                {showCaseBrief && (
                  <CaseBrief ctx={activeScenario} onStart={() => setShowCaseBrief(false)} />
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
                      {steps.map((step: any, idx: number) => {
                        const isDone = step.status === 'done';
                        const isFailed = step.status === 'failed';
                        const isRunning = step.status === 'running';
                        const isCurrent = idx === currentStep;
                        const isRevealed = revealedHints.has(step.step);
                        const result = stepResults[step.step] || step.output || '';
                        const resultLines = result ? result.split('\n').filter((l: string) => l.trim().length > 0).length : 0;
                        const shouldCollapse = expandedCount > 2;

                        return (
                          <div key={step.step} onClick={() => setCurrentStep(idx)}
                            className={`rounded-lg border p-4 cursor-pointer transition-all ${
                              isCurrent ? 'border-[var(--cyan)]/50 bg-[var(--cyan)]/5' :
                              isDone ? 'border-[var(--green)]/20 bg-[var(--green)]/5' :
                              isFailed ? 'border-[var(--red)]/20 bg-[var(--red)]/5' :
                              'border-[var(--border-dim)] bg-[var(--bg-surface)] hover:border-[var(--border-base)]'
                            }`}>
                            {/* Step header */}
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[12px] font-mono text-[var(--text-muted)]">#{idx + 1}</span>
                              {isDone && <CheckCircle2 size={16} className="text-[var(--green)]" />}
                              {isRunning && <Loader2 size={16} className="text-[var(--cyan)] animate-spin" />}
                              {isFailed && <XCircle size={16} className="text-[var(--red)]" />}
                              {!isDone && !isRunning && !isFailed && <ChevronRight size={16} className={`text-[var(--text-dim)] transition-transform ${isCurrent ? 'text-[var(--cyan)]' : ''}`} />}
                              <span className={`text-[16px] font-bold ${isCurrent ? 'text-[var(--text-primary)]' : isDone ? 'text-[var(--green)]' : 'text-[var(--text-secondary)]'}`}>{step.title}</span>
                            </div>

                            {/* Instruction narrative */}
                            <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed mb-3">{step.narrative}</p>

                            {/* Command + always-visible Run button */}
                            <div className="bg-[var(--bg-void)] rounded-lg px-4 py-2.5 mb-3 flex items-center justify-between">
                              <code className="text-[14px] font-mono text-[var(--green)]">{step.tool}</code>
                              <button onClick={(e) => { e.stopPropagation(); runStep(step, idx); }}
                                disabled={isRunning}
                                className="px-4 py-1.5 rounded-md bg-[var(--cyan)] text-black text-[13px] font-bold hover:bg-[var(--cyan)]/80 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                {isRunning ? <><Loader2 size={12} className="animate-spin" /> Running</> : isDone ? 'Rerun' : <><Play size={12} fill="currentColor" /> Run</>}
                              </button>
                            </div>

                            {/* Result output — collapsible for completed steps */}
                            {result && isDone && (
                              <CollapsibleStepOutput output={result} isFailed={false} />
                            )}
                            {result && isFailed && (
                              <CollapsibleStepOutput output={result} isFailed={true} />
                            )}
                            {result && !isDone && !isFailed && (
                              /* Running state — show inline */
                              <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all p-3 rounded-lg bg-[var(--bg-void)] mb-3 text-[var(--cyan)]">
                                {result}
                              </pre>
                            )}

                            {/* Hint section */}
                            {!result && !isDone && (
                              <button onClick={(e) => { e.stopPropagation(); toggleHint(step.step); }}
                                className="flex items-center gap-1.5 text-[13px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
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

                      {/* Success message (inline, before completion screen takes over) */}
                      {allDone && (
                        <div className="mt-4 p-4 rounded-lg bg-[var(--green-dim)]/10 border border-[var(--green)]/30 text-center">
                          <CheckCircle2 size={24} className="text-[var(--green)] mx-auto mb-2" />
                          <p className="text-[18px] font-bold text-[var(--green)] mb-1">Case Resolved!</p>
                          <p className="text-[14px] text-[var(--text-secondary)]">All {totalSteps} steps completed successfully.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Scenario list sidebar (hidden in focus mode, shows HeartbeatPanel at bottom) */}
              <div className={`bg-[var(--bg-base)] border-l border-[var(--border-dim)] flex flex-col shrink-0 transition-all duration-300 overflow-hidden ${focusMode ? 'w-0 border-0' : 'w-[260px]'}`}>
                <div className="px-3 py-2 border-b border-[var(--border-dim)]">
                  <span className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Scenarios</span>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                  {activeScenarios?.map((s: any) => {
                    const isActive = scenario === s.name;
                    return (
                      <button key={s.name} onClick={() => startScenario(s.name)}
                        className={`w-full px-3 py-2 rounded-lg text-left transition-all flex items-center gap-2 ${
                          isActive ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/40' : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
                        }`}>
                        <span className="shrink-0">{isActive ? '●' : <Play size={10} />}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13px] font-semibold truncate ${isActive ? 'text-[var(--cyan)]' : 'text-[var(--text-secondary)]'}`}>{s.title || s.name}</div>
                          <div className="text-[11px] text-[var(--text-dim)] font-mono">{s.estimated_minutes}m · {(s.runbook_step_count || '?')} steps</div>
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0" style={{ backgroundColor: SEV_BG[s.severity], color: SEV[s.severity] }}>{(s.severity || '').toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
                {(!focusMode) && (
                  <div className="border-t border-[var(--border-dim)] p-2">
                    <HeartbeatPanel onVenueClick={() => {}} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Training Panel (right sidebar for Case Study) */}
          {showTraining && bottomTab === 'case' && activeScenario && (
            <div className="w-[320px] border-l border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0 overflow-hidden">
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
        </div>
      </div>

      {/* ── HeartbeatPanel: Always visible at bottom in focus mode ── */}
      {focusMode && (
        <div className="border-t border-[var(--border-dim)] bg-[var(--bg-base)] shrink-0">
          <HeartbeatPanel onVenueClick={() => {}} />
        </div>
      )}

      {/* ── Completion Screen ── */}
      {showCompletion && (
        <CompletionScreen
          steps={trackedSteps}
          hintsUsed={hintsUsedCount}
          startTime={completionTimer || Date.now()}
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

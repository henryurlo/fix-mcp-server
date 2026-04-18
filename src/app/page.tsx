'use client';

import { useEffect, useState } from 'react';
import { useSystem, useChat } from '@/store';
import { useAuth } from '@/store/auth';
import { useTelemetry } from '@/store/telemetry';
import dynamic from 'next/dynamic';
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
const McpAuditLog = dynamic(() => import('@/components/McpAuditLog'), { ssr: false });
const HeartbeatPanel = dynamic(() => import('@/components/HeartbeatPanel'), { ssr: false });

type TabId = 'mission-control' | 'telemetry' | 'scenario-creator';

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'mission-control', label: 'Mission Control', icon: Layers },
  { id: 'telemetry', label: 'Telemetry', icon: BarChart3 },
  { id: 'scenario-creator', label: 'Scenario Creator', icon: PlusCircle },
];

// ── Runbook types ──────────────────────────────────────────────────

interface RunbookStep {
  step: number;
  title: string;          // Short label
  narrative: string;      // Plain English explanation
  cli: string;            // Exact terminal command
  tool: string;           // MCP tool name for button
  toolArgs: Record<string, unknown>; // Args for the tool
  expected: string;       // What success looks like
}

interface RunbookDef {
  title: string;
  narrative: string;       // Scene-setter
  steps: RunbookStep[];
  tools: string[];
}

// ── Scenario runbooks ──────────────────────────────────────────────

const SCENARIO_RUNBOOKS: Record<string, RunbookDef> = {
  morning_triage: {
    title: 'MORNING TRIAGE — Market Open Prep',
    narrative:
      "It's 7:30 AM. The trading desk opens in 2 hours. Your job is to verify every system is healthy before the opening bell. A single missed issue here means millions in failed trades.",
    steps: [
      {
        step: 1,
        title: 'Check FIX Session Health',
        narrative:
          'First, verify all exchange connections are alive. Each venue (NYSE, ARCA, BATS, NASDAQ) runs a FIX 4.2 session with heartbeats every 30 seconds. If any session is down, traders can\'t send orders to that venue.',
        cli: 'show sessions',
        tool: 'check_fix_sessions',
        toolArgs: {},
        expected: 'All venues show ACTIVE with latency <10ms',
      },
      {
        step: 2,
        title: 'Review Overnight Orders',
        narrative:
          'Check for orders that were left open overnight. Stale orders from after-hours could trigger unwanted fills at market open, causing P&L damage.',
        cli: 'show orders --open',
        tool: 'query_orders',
        toolArgs: { status: 'open' },
        expected: 'No stale orders, or identify ones to cancel',
      },
      {
        step: 3,
        title: 'Validate Reference Data',
        narrative:
          'Ensure symbol mappings are current. A corporate action overnight (stock split, ticker change) could cause orders to route to wrong symbols.',
        cli: 'show sessions',
        tool: 'validate_orders',
        toolArgs: {},
        expected: 'All symbols resolve correctly, no stale cusips',
      },
      {
        step: 4,
        title: 'Run Pre-Market Health Check',
        narrative:
          'Final sweep: check order routing rules, risk limits, and FX rates. This is your go/no-go decision.',
        cli: 'status',
        tool: 'run_premarket_check',
        toolArgs: {},
        expected: 'All green. Ready for 09:30 bell.',
      },
      {
        step: 5,
        title: 'Clear Stuck Orders',
        narrative:
          'If any orders are stuck in queue, release them now. After 09:30, stuck orders could block new flow.',
        cli: 'release stuck',
        tool: 'release_stuck_orders',
        toolArgs: {},
        expected: 'Queue clean: 0 stuck orders',
      },
    ],
    tools: ['check_fix_sessions', 'query_orders', 'validate_orders', 'run_premarket_check', 'release_stuck_orders'],
  },

  venue_degradation_1030: {
    title: 'VENUE DEGRADATION — NYSE Latency Crisis',
    narrative:
      "It's 10:32 AM. NYSE latency just spiked from 3ms to 180ms — a route flap on the core Mahwah switch (NOC ticket #44827). 14 orders are stuck in the NYSE queue unacknowledged ($4.1M notional), including 3 institutional clients with SLA timers running. The SOR auto-diverted 10 orders to BATS, but 2 orders carry listing-venue-required mandates and CANNOT be rerouted. ARCA and IEX are healthy.",
    steps: [
      {
        step: 1,
        title: 'Confirm the Problem',
        narrative:
          'Check NYSE session health. The alert says 180ms latency and a sequence gap. Verify the FIX session state and heartbeat status.',
        cli: 'heartbeat NYSE',
        tool: 'session_heartbeat',
        toolArgs: { venue: 'NYSE' },
        expected: 'NYSE latency 180ms, status degraded, heartbeat delayed',
      },
      {
        step: 2,
        title: 'Assess Order Damage',
        narrative:
          'How many orders are stuck at NYSE? Check for institutional orders with SLA timers — those are the priority.',
        cli: 'show orders --venue NYSE',
        tool: 'query_orders',
        toolArgs: { venue: 'NYSE' },
        expected: '14 stuck orders, 3+ institutional with SLA breach risk',
      },
      {
        step: 3,
        title: 'Full Session Diagnostic',
        narrative:
          'Get the complete picture: sequence numbers (look for gaps), message counts, error details. The Mahwah switch issue may have caused seq gaps.',
        cli: 'dump NYSE',
        tool: 'dump_session_state',
        toolArgs: { venue: 'NYSE' },
        expected: 'Sequence gap detected, elevated error count, 180ms RTT',
      },
      {
        step: 4,
        title: 'Attempt Session Fix',
        narrative:
          'Try reconnecting the NYSE session. If the route flap is resolved, a fresh logon may restore normal latency. If not, we need to mark it degraded for the SOR.',
        cli: 'fix NYSE',
        tool: 'fix_session_issue',
        toolArgs: { venue: 'NYSE', action: 'reconnect' },
        expected: 'NYSE reconnects with lower latency, or fails and needs escalation',
      },
      {
        step: 5,
        title: 'Release Stuck Orders',
        narrative:
          'After fixing the session, release the 14 stuck orders. Watch the listing-venue-required orders — they must stay on NYSE.',
        cli: 'release stuck',
        tool: 'release_stuck_orders',
        toolArgs: {},
        expected: 'Stuck orders released, SLA timers cleared',
      },
      {
        step: 6,
        title: 'Verify Recovery',
        narrative:
          'Check that NYSE is back to normal. Latency should be <10ms, no sequence gaps, orders flowing.',
        cli: 'heartbeat NYSE',
        tool: 'session_heartbeat',
        toolArgs: { venue: 'NYSE' },
        expected: 'NYSE latency <10ms, status active, orders flowing',
      },
    ],
    tools: ['session_heartbeat', 'query_orders', 'dump_session_state', 'fix_session_issue', 'release_stuck_orders'],
  },

  open_volatility_0930: {
    title: 'OPENING VOLATILITY — Bell Surge',
    narrative:
      "It's 09:30 AM — the bell just rang. Volume surged 10x in the first 30 seconds. Algo orders (TWAP, VWAP) are slicing aggressively but fills are coming back with 2-3% slippage. Two institutional clients have SLAs that breach at 1.5% slippage. If you don't intervene, the firm faces SLA penalties and client escalations.",
    steps: [
      {
        step: 1,
        title: 'Check All Venue Fill Rates',
        narrative:
          'Which venues are handling the volume? Which ones are rejecting orders?',
        cli: 'show sessions',
        tool: 'check_fix_sessions',
        toolArgs: {},
        expected: 'Identify the most congested venues',
      },
      {
        step: 2,
        title: 'Review Open Orders',
        narrative:
          'Check which orders have significant slippage or are stuck waiting for fills.',
        cli: 'show orders --open',
        tool: 'query_orders',
        toolArgs: { status: 'open' },
        expected: 'Flag orders with >1% slippage',
      },
      {
        step: 3,
        title: 'Check SLA-Critical Orders',
        narrative:
          'Find the institutional orders that are close to breaching SLA thresholds.',
        cli: 'show orders --status partial',
        tool: 'validate_orders',
        toolArgs: {},
        expected: 'Identify orders at risk of SLA breach',
      },
      {
        step: 4,
        title: 'Reroute if Needed',
        narrative:
          'If one venue is overwhelmed, shift algo orders to less congested venues.',
        cli: 'fix NYSE',
        tool: 'update_venue_status',
        toolArgs: { venue: 'NYSE', status: 'degraded' },
        expected: 'NYSE deprioritized, orders rerouting to ARCA/BATS',
      },
    ],
    tools: ['check_fix_sessions', 'query_orders', 'validate_orders', 'update_venue_status'],
  },
};

// Generate a generic runbook for scenarios without a specific one
function getRunbook(scenarioName: string): RunbookDef {
  if (SCENARIO_RUNBOOKS[scenarioName]) return SCENARIO_RUNBOOKS[scenarioName];
  return {
    title: scenarioName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    narrative: `Scenario: ${scenarioName} — The SRE Copilot will guide you through diagnosis and resolution.`,
    steps: [
      {
        step: 1, title: 'Review system state', narrative: 'Understand the baseline.',
        cli: 'show sessions', tool: 'check_fix_sessions', toolArgs: {}, expected: 'Establish a baseline.',
      },
      {
        step: 2, title: 'Identify anomalies', narrative: 'Find what changed.',
        cli: 'show orders', tool: 'query_orders', toolArgs: {}, expected: 'Locate the problem area.',
      },
      {
        step: 3, title: 'Diagnose root cause', narrative: 'Isolate the failing component.',
        cli: 'status', tool: 'validate_orders', toolArgs: {}, expected: 'Root cause identified.',
      },
      {
        step: 4, title: 'Apply fix', narrative: 'Resolve the issue. Run a health check to identify the affected venue.',
        cli: 'show sessions', tool: 'run_premarket_check', toolArgs: {}, expected: 'Issue identified and resolved.',
      },
      {
        step: 5, title: 'Verify recovery', narrative: 'Confirm system is healthy.',
        cli: 'show sessions', tool: 'check_fix_sessions', toolArgs: {}, expected: 'System healthy.',
      },
    ],
    tools: ['check_fix_sessions', 'query_orders', 'run_premarket_check'],
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('mission-control');
  const { scenario, available_scenarios: available, loading, startScenario, refresh, sessions, events, error, connected } = useSystem();
  const { isOpen, toggleOpen } = useChat();
  const { isAuthenticated, user, logout } = useAuth();
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
            <span className="text-[9px] text-[var(--text-muted)] font-mono ml-2">Mission Control</span>
          </div>
          {scenario && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--cyan-dim)] border border-[var(--cyan)]/30">
              <Radio size={10} className="text-[var(--cyan)] animate-pulse" />
              <span className="text-[11px] font-mono font-semibold text-[var(--cyan)]">{scenario}</span>
            </div>
          )}
          {activeFaults > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30">
              <AlertTriangle size={11} className="text-[var(--red)]" />
              <span className="text-[10px] font-mono font-semibold text-[var(--red)]">{activeFaults} FAULT{activeFaults > 1 ? 'S' : ''}</span>
            </div>
          )}
        </div>

        <nav className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-lg p-1 border border-[var(--border-dim)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  isActive ? 'bg-[var(--bg-elevated)] text-[var(--cyan)] border border-[var(--cyan)]/20' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/50'
                }`}>
                <Icon size={13} /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {error && <span className="text-[10px] text-[var(--red)] font-mono max-w-[200px] truncate">{error}</span>}
          {connected ? (
            <span className="flex items-center gap-1 text-[10px] text-[var(--green)] font-mono"><span className="status-dot healthy" /> LIVE</span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-[var(--red)] font-mono"><span className="status-dot down" /> OFFLINE</span>
          )}

          <select value={scenario || ''} onChange={(e) => e.target.value && startScenario(e.target.value)}
            className="input-base !w-auto !py-1 !px-2.5 !text-[10px] !font-mono !rounded-lg max-w-[160px]">
            <option value="">Launch Scenario…</option>
            {available?.map((s: any) => <option key={s.name} value={s.name}>{s.name}{s.is_algo ? ' ⚡' : ''}</option>)}
          </select>

          <button onClick={toggleOpen}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
              isOpen ? 'bg-[var(--green-dim)] text-[var(--green)] border-[var(--green)]/30' : 'text-[var(--text-muted)] border-[var(--border-dim)] hover:border-[var(--border-base)]'
            }`}>
            <Terminal size={12} /> SRE Copilot
          </button>

          <div className="flex items-center gap-2 ml-1 pl-2 border-l border-[var(--border-dim)]">
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">{user?.username || 'anon'}</span>
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
          {activeTab === 'scenario-creator' && <ScenarioCreator />}
        </main>
        <aside className={`transition-all duration-300 ease-out bg-[var(--bg-base)] border-l border-[var(--border-dim)] ${isOpen ? 'w-[400px]' : 'w-0'} overflow-hidden shrink-0`}>
          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}

// ── MISSION CONTROL (new split layout with Audit Log) ───────────────

function MissionControlTab() {
  const { scenario, available_scenarios: available, startScenario, sessions, callTool } = useSystem();
  const { isOpen, toggleOpen, send } = useChat();
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [stepResults, setStepResults] = useState<Record<number, string>>({});

  const activeScenarioName = scenario || selectedScenario;
  const runbook = activeScenarioName ? getRunbook(activeScenarioName) : null;

  const handleRunStep = async (step: RunbookStep) => {
    try {
      setStepResults((prev) => ({ ...prev, [step.step]: 'Running…' }));
      const result = await callTool(step.tool, step.toolArgs);
      setStepResults((prev) => ({ ...prev, [step.step]: result || 'Done ✓' }));
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
                <h2 className="text-[11px] font-bold mb-1 bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">
                  FIX-MCP Mission Control
                </h2>
                <p className="text-[9px] text-[var(--text-muted)] font-mono">Pick a scenario ↓</p>
              </div>
            )}
          </div>

          {/* FIX Heartbeat Panel */}
          <HeartbeatPanel onVenueClick={handleVenueClick} />

          {/* Scenario Picker */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
                <Layers size={9} /> Scenarios
              </span>
              <span className="text-[8px] font-mono text-[var(--text-dim)]">{available?.length || 0}</span>
            </div>
            <div className="space-y-1">
              {available?.map((s: any) => (
                <button
                  key={s.name}
                  onClick={() => handleStartScenario(s.name)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all ${
                    scenario === s.name
                      ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/30'
                      : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
                  }`}
                >
                  {scenario === s.name
                    ? <Radio size={9} className="text-[var(--cyan)] animate-pulse shrink-0" />
                    : <Play size={9} className="text-[var(--text-dim)] shrink-0" />
                  }
                  <span className="text-[10px] font-mono font-semibold truncate">{s.name}</span>
                  {s.is_algo && (
                    <span className="text-[8px] px-1 py-px rounded bg-[var(--purple-dim)] text-[var(--purple)] font-mono ml-auto shrink-0">⚡</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Live Terminal (70%) */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <FixTerminal />
        </div>
      </div>

      {/* ── BOTTOM ROW: Runbook (left) + MCP Audit Log (right) ──── */}
      <div className="h-[38%] min-h-[180px] flex">
        {/* LEFT: Runbook Panel */}
        <div className="w-[30%] min-w-[220px] max-w-[340px] bg-[var(--bg-base)] border-r border-[var(--border-dim)] overflow-hidden flex flex-col">
          {runbook ? (
            <>
              {/* Runbook Scenario Narrative */}
              <div className="px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
                <div className="flex items-center gap-2">
                  <span className="status-dot active w-1.5 h-1.5" />
                  <span className="text-[9px] font-bold text-[var(--cyan)] uppercase tracking-wider">
                    {scenario ? 'Active' : 'Preview'}
                  </span>
                </div>
                <h3 className="text-[11px] font-bold mt-0.5">{runbook.title}</h3>
                <p className="text-[9px] text-[var(--text-secondary)] mt-1 leading-relaxed">{runbook.narrative}</p>
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
                      <div className="text-[10px] font-bold text-[var(--text-primary)] mb-0.5">
                        #{step.step} {step.title}
                      </div>

                      {/* Narrative */}
                      <div className="text-[9px] text-[var(--text-secondary)] leading-relaxed mb-1.5">
                        {step.narrative}
                      </div>

                      {/* CLI command */}
                      <div className="bg-[var(--bg-void)] rounded px-2 py-1 mb-1.5">
                        <code className="text-[9px] font-mono text-[var(--green)]">
                          fix-cli&gt; {step.cli}
                        </code>
                      </div>

                      {/* Run button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunStep(step);
                        }}
                        className="w-full btn-secondary !text-[9px] !py-0.5 !px-2 flex items-center justify-center gap-1"
                      >
                        <Activity size={9} /> Run {step.tool}
                      </button>

                      {/* Step result if available */}
                      {stepResults[step.step] && (
                        <div className={`mt-1 text-[8px] font-mono leading-relaxed ${
                          stepResults[step.step].startsWith('Error:')
                            ? 'text-[var(--red)]'
                            : 'text-[var(--green)]'
                        }`}>
                          → {stepResults[step.step]}
                        </div>
                      )}

                      {/* Expected */}
                      <div className="text-[8px] text-[var(--text-dim)] mt-1">
                        Expected: {step.expected}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Copilot button */}
              <div className="px-2 py-2 border-t border-[var(--border-dim)] shrink-0">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleRunStep(runbook.steps[activeStep] || runbook.steps[0])}
                    className="btn-secondary flex-1 flex items-center justify-center gap-1 text-[9px]"
                  >
                    <Wrench size={10} /> Run Step
                  </button>
                  <button
                    onClick={() => {
                      if (!isOpen) toggleOpen();
                      send(`I'm on step ${activeStep + 1} of the ${runbook.title} runbook: "${runbook.steps[activeStep]?.title}"`);
                    }}
                    className="btn-primary flex-1 flex items-center justify-center gap-1 text-[9px]"
                  >
                    <Terminal size={10} /> Copilot
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              <BookOpen size={24} className="text-[var(--text-dim)] mb-2" />
              <p className="text-[10px] text-[var(--text-muted)]">Select a scenario to see the runbook.</p>
            </div>
          )}
        </div>

        {/* RIGHT: MCP Audit Log */}
        <div className="flex-1 min-w-0 overflow-hidden p-2">
          <McpAuditLog />
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
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">{label}</span>
      </div>
      <div className={`text-lg font-bold font-mono ${colorMap[color] || 'text-[var(--text-primary)]'}`}>{value}</div>
    </div>
  );
}

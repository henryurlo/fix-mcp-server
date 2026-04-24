/**
 * FIX-MCP Academy Curriculum
 * ==========================
 * Six learning modules mapping 14 scenarios to structured skill tracks.
 * No gamification — just clear progression, prerequisites, and completion tracking.
 */

export interface ModuleLab {
  scenarioName: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  severity: 'low' | 'medium' | 'high' | 'critical';
  stepCount: number;
  concepts: string[];
}

export interface AcademyModule {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedHours: number;
  labs: ModuleLab[];
  concepts: string[];
  prerequisites: string[]; // module IDs
}

export const ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'm1-fix-fundamentals',
    number: 1,
    title: 'FIX Fundamentals',
    subtitle: 'Protocol, messages, and session basics',
    description:
      'Learn the FIX protocol from the ground up: message structure, tag meanings, sequence numbers, heartbeats, and session handshakes. These labs simulate early-morning session startups and pre-market checks — the foundation every trading operator needs.',
    difficulty: 'beginner',
    estimatedHours: 1.5,
    labs: [
      {
        scenarioName: 'bats_startup_0200',
        title: 'BATS Startup at 02:00',
        description:
          '2:00 AM pre-market: BATS session failed to auto-recover after weekend maintenance. Sequence gap detected, heartbeat stale. Walk through logon handshake, ResendRequest, and session validation.',
        estimatedMinutes: 15,
        difficulty: 'beginner',
        severity: 'medium',
        stepCount: 5,
        concepts: ['FIX logon (35=A)', 'Heartbeat (35=0)', 'Sequence gaps', 'ResendRequest (35=2)'],
      },
      {
        scenarioName: 'predawn_adrs_0430',
        title: 'Pre-Dawn ADR Reconciliation',
        description:
          '4:30 AM: TSX and LSE ADR symbols need interlisted mapping validation before the US open. Verify symbol mappings, check cross-listed session health, and confirm reference data loads.',
        estimatedMinutes: 20,
        difficulty: 'beginner',
        severity: 'low',
        stepCount: 6,
        concepts: ['Interlisted symbols', 'ADR mapping', 'Reference data validation'],
      },
    ],
    concepts: [
      'FIX message structure (header, body, trailer)',
      'Key tags: 8 (BeginString), 9 (BodyLength), 35 (MsgType), 49 (SenderCompID), 56 (TargetCompID)',
      'Sequence numbers and gap recovery',
      'Heartbeat intervals and session keepalive',
      'Logon / Logout lifecycle',
    ],
    prerequisites: [],
  },
  {
    id: 'm2-order-lifecycle',
    number: 2,
    title: 'Order Lifecycle',
    subtitle: 'Routing, execution, cancels, and corporate actions',
    description:
      'Master the full order lifecycle: from NewOrderSingle through ExecutionReport, cancellation, and replacement. Labs cover stuck orders from venue outages, stale tickers from corporate actions, and pre-open auction routing decisions.',
    difficulty: 'beginner',
    estimatedHours: 2,
    labs: [
      {
        scenarioName: 'morning_triage',
        title: 'Morning Triage — ARCA Down, Ticker Change',
        description:
          '6:15 AM: ARCA session is down from Saturday failover with sequence gap. 12 orders are stuck, 3 are institutional with SLA timers. Meanwhile, ACME changed its ticker to ACMX effective today — 23 orders carry the stale symbol. Plus 2 ZEPH IPO orders with no loaded reference data.',
        estimatedMinutes: 25,
        difficulty: 'beginner',
        severity: 'high',
        stepCount: 7,
        concepts: ['Order status codes', 'Stuck orders', 'Venue failover', 'Ticker changes', 'SLA monitoring'],
      },
      {
        scenarioName: 'preopen_auction_0900',
        title: 'Pre-Open Auction — Imbalance Crisis',
        description:
          '9:02 AM: 6 institutional MOO orders for NVDA ($18.2M notional) submitting into an unverified opening imbalance. IEX imbalance feed is stale since 08:45. 4 orders carry wrong TimeInForce (GTC instead of OPG).',
        estimatedMinutes: 20,
        difficulty: 'intermediate',
        severity: 'high',
        stepCount: 6,
        concepts: ['MOO / OPG TimeInForce', 'Opening imbalance', 'Auction mechanics', 'Feed staleness'],
      },
    ],
    concepts: [
      'NewOrderSingle (35=D), ExecutionReport (35=8), Cancel (35=F)',
      'OrderStatus: 0=Filled, 1=Partial, 2=New, 8=Rejected, C=Cancelled',
      'TimeInForce: DAY, GTC, OPG, IOC, FOK',
      'ClOrdID and OrigClOrdID linkage',
      'Corporate actions and symbol renames',
    ],
    prerequisites: ['m1-fix-fundamentals'],
  },
  {
    id: 'm3-session-management',
    number: 3,
    title: 'Session Management',
    subtitle: 'Recovery, degradation, and failover',
    description:
      'When sessions degrade or die, every second counts. Learn to diagnose latency spikes, sequence drift, partial degradation, and full failover. These labs simulate real session catastrophes and their step-by-step recovery.',
    difficulty: 'intermediate',
    estimatedHours: 1.5,
    labs: [
      {
        scenarioName: 'venue_degradation_1030',
        title: 'Venue Degradation Cascade',
        description:
          '10:30 AM: NYSE latency has climbed from 3ms to 180ms over the past 10 minutes. ARCA is showing intermittent heartbeat drops. BATS is healthy. Determine if this is a network issue, venue-side overload, or local gateway saturation.',
        estimatedMinutes: 18,
        difficulty: 'intermediate',
        severity: 'high',
        stepCount: 5,
        concepts: ['Latency analysis', 'Heartbeat monitoring', 'Gateway saturation', 'Degradation detection'],
      },
      {
        scenarioName: 'iex_recovery_1400',
        title: 'IEX Session Recovery',
        description:
          '2:00 PM: IEX session dropped at 13:47 during a scheduled venue maintenance window that was not communicated. Orders are queuing. Reconnect, validate sequence numbers, and flush the backlog without duplicate fills.',
        estimatedMinutes: 20,
        difficulty: 'intermediate',
        severity: 'medium',
        stepCount: 6,
        concepts: ['Session reconnection', 'Sequence validation', 'Order queue flush', 'Duplicate fill prevention'],
      },
    ],
    concepts: [
      'Session state machine: active → degraded → down',
      'Latency thresholds and alerting',
      'Sequence number reconciliation',
      'Gateway failover strategies',
      'Message replay and deduplication',
    ],
    prerequisites: ['m2-order-lifecycle'],
  },
  {
    id: 'm4-market-events',
    number: 4,
    title: 'Market Events',
    subtitle: 'Halts, circuit breakers, and regulatory events',
    description:
      'Markets halt. Stocks split. Short-sale restrictions trigger. These labs teach you to recognize, validate, and respond to regulatory and market-structure events that freeze or transform order flow.',
    difficulty: 'intermediate',
    estimatedHours: 2,
    labs: [
      {
        scenarioName: 'open_volatility_0930',
        title: 'Open Volatility — LULD Band Breach',
        description:
          '9:30 AM: TSLA gapped up 8% on earnings. 3 sell orders are at risk of breaching LULD lower bands if the stock reverses. Monitor bands, check for pending halts, and prepare contingency routing.',
        estimatedMinutes: 15,
        difficulty: 'intermediate',
        severity: 'high',
        stepCount: 5,
        concepts: ['LULD bands', 'Volatility halts', 'Contingency routing', 'Band monitoring'],
      },
      {
        scenarioName: 'ssr_and_split_1130',
        title: 'SSR Trigger and Stock Split',
        description:
          '11:30 AM: AAPL dropped 11.2% triggering Short Sale Restriction (uptick-only shorting). Simultaneously, a 4:1 stock split is effective today — reference data shows old prices. Update ticker mappings, flag SSR, and adjust order quantities.',
        estimatedMinutes: 22,
        difficulty: 'intermediate',
        severity: 'medium',
        stepCount: 6,
        concepts: ['SSR (Short Sale Restriction)', 'Stock splits', 'Reference price updates', 'Uptick rule'],
      },
    ],
    concepts: [
      'LULD: Limit Up-Limit Down mechanism',
      'SSR: Short Sale Restriction triggers and duration',
      'Stock splits and reverse splits',
      'Trading halts: regulatory vs. volatility',
      'Band calculation and monitoring',
    ],
    prerequisites: ['m3-session-management'],
  },
  {
    id: 'm5-algo-execution',
    number: 5,
    title: 'Algo Execution',
    subtitle: 'TWAP, VWAP, and execution quality',
    description:
      'Algorithmic orders are not fire-and-forget. Learn to monitor schedule deviation, detect slippage, compare realized vs. target participation, and intervene when algo behavior drifts from expectation.',
    difficulty: 'advanced',
    estimatedHours: 2.5,
    labs: [
      {
        scenarioName: 'twap_slippage_1000',
        title: 'TWAP Slippage Detection',
        description:
          '10:00 AM: A $5M TWAP order on MSFT is showing 12bps slippage vs. arrival price. Schedule deviation is +8%. Determine if this is market impact, adverse selection, or a venue routing issue.',
        estimatedMinutes: 25,
        difficulty: 'advanced',
        severity: 'medium',
        stepCount: 6,
        concepts: ['TWAP mechanics', 'Slippage calculation', 'Schedule deviation', 'Arrival price'],
      },
      {
        scenarioName: 'vwap_vol_spike_1130',
        title: 'VWAP Volume Spike Response',
        description:
          '11:30 AM: NVDA volume just spiked 3x on news. The VWAP algo is over-participating, pushing the firm into 18% of the print. Reduce participation rate, switch to POV, or pause the algo.',
        estimatedMinutes: 20,
        difficulty: 'advanced',
        severity: 'high',
        stepCount: 5,
        concepts: ['VWAP vs. POV', 'Participation rate', 'Volume spike detection', 'Algo switching'],
      },
    ],
    concepts: [
      'TWAP: Time-Weighted Average Price slicing',
      'VWAP: Volume-Weighted Average Price tracking',
      'POV: Percentage of Volume participation',
      'Slippage: arrival price vs. execution price',
      'Schedule deviation and catch-up logic',
      'Implementation Shortfall (IS) basics',
    ],
    prerequisites: ['m4-market-events'],
  },
  {
    id: 'm6-crisis-response',
    number: 6,
    title: 'Crisis Response',
    subtitle: 'EOD deadlines, dark pools, and multi-vector incidents',
    description:
      'The hardest incidents are not single failures — they are overlapping, time-critical, and high-notional. These labs simulate the pressure of EOD deadlines, dark pool failures, and multi-venue chaos requiring disciplined runbook execution under SLA countdown.',
    difficulty: 'advanced',
    estimatedHours: 3,
    labs: [
      {
        scenarioName: 'midday_chaos_1205',
        title: 'Midday Chaos — Multi-Venue Failure',
        description:
          '12:05 PM: ARCA session down, NYSE showing 400ms latency spikes, 8 orders stuck across 3 venues, and a reject spike started 2 minutes ago. Triage in priority order under institutional SLA pressure.',
        estimatedMinutes: 25,
        difficulty: 'advanced',
        severity: 'critical',
        stepCount: 7,
        concepts: ['Multi-vector triage', 'Priority ordering', 'SLA countdown', 'Reject spike response'],
      },
      {
        scenarioName: 'is_dark_failure_1415',
        title: 'Dark Pool Failure at 14:15',
        description:
          '2:15 PM: The primary dark pool aggregator is not returning fills. 4 large block orders are partially routed to dark venues with no response. Determine if the dark pool is down, rate-limited, or rejecting. Reroute to lit venues if necessary.',
        estimatedMinutes: 20,
        difficulty: 'advanced',
        severity: 'high',
        stepCount: 5,
        concepts: ['Dark pool mechanics', 'Block orders', 'Lit vs. dark routing', 'Aggregator health'],
      },
      {
        scenarioName: 'eod_moc_1530',
        title: 'EOD Market-On-Close Deadline',
        description:
          '3:30 PM: 9 MOC orders ($42M notional) must be submitted by 3:45 PM for the closing auction. 2 carry stale symbols from a late corporate action. 1 is on a degraded venue. Validate, fix, and submit before cutoff.',
        estimatedMinutes: 18,
        difficulty: 'advanced',
        severity: 'critical',
        stepCount: 6,
        concepts: ['MOC mechanics', 'Closing auction', 'Deadline pressure', 'Last-minute validation'],
      },
      {
        scenarioName: 'afterhours_dark_1630',
        title: 'After-Hours Dark Pool Anomaly',
        description:
          '4:30 PM: Post-close, a dark pool is accepting orders but not reporting fills. Trades may have occurred without visibility. Investigate ATS reporting lag, check for delayed prints, and reconcile positions.',
        estimatedMinutes: 22,
        difficulty: 'advanced',
        severity: 'medium',
        stepCount: 5,
        concepts: ['After-hours trading', 'ATS reporting', 'Delayed prints', 'Position reconciliation'],
      },
    ],
    concepts: [
      'Multi-vector incident triage',
      'SLA countdown and breach escalation',
      'MOC / LOC deadline management',
      'Dark pool failure modes',
      'Position reconciliation post-incident',
      'Runbook discipline under pressure',
    ],
    prerequisites: ['m5-algo-execution'],
  },
];

/** Flat map from scenario name → module lab for quick lookup. */
export const SCENARIO_TO_LAB: Record<string, { moduleId: string; labIndex: number }> = {};
for (const mod of ACADEMY_MODULES) {
  for (let i = 0; i < mod.labs.length; i++) {
    SCENARIO_TO_LAB[mod.labs[i].scenarioName] = { moduleId: mod.id, labIndex: i };
  }
}

/** Get module by ID. */
export function getModule(id: string): AcademyModule | undefined {
  return ACADEMY_MODULES.find((m) => m.id === id);
}

/** Check if all prerequisites for a module are satisfied. */
export function prerequisitesMet(moduleId: string, completedModules: string[]): boolean {
  const mod = getModule(moduleId);
  if (!mod) return false;
  return mod.prerequisites.every((p) => completedModules.includes(p));
}

/** Compute overall academy progress as fraction 0-1. */
export function computeProgress(completedLabs: Set<string>): number {
  const totalLabs = ACADEMY_MODULES.reduce((sum, m) => sum + m.labs.length, 0);
  if (totalLabs === 0) return 0;
  return completedLabs.size / totalLabs;
}

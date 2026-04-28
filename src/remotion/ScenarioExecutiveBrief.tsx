import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { ScenarioStory, defaultStory } from './scenarioStories';

const C = {
  page: '#eef2f5',
  panel: '#ffffff',
  ink: '#111827',
  text: '#334155',
  muted: '#64748b',
  line: '#d8dee6',
  cyan: '#006f8f',
  green: '#047857',
  amber: '#b45309',
  red: '#b91c1c',
  navy: '#0f172a',
};

const tone = {
  neutral: C.text,
  good: C.green,
  warn: C.amber,
  bad: C.red,
};

type StepState = 'todo' | 'running' | 'done' | 'hold';

function fade(frame: number, start: number, duration = 18) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function phaseAt(frame: number) {
  if (frame < 120) return 'load';
  if (frame < 270) return 'investigate';
  if (frame < 420) return 'approve';
  if (frame < 570) return 'inject';
  if (frame < 760) return 'agent';
  return 'close';
}

function scenarioProblem(story: ScenarioStory) {
  if (story.id.includes('bats')) return 'BATS logon rejected';
  if (story.id.includes('venue')) return 'NYSE latency degraded';
  if (story.id.includes('triage')) return 'ARCA down + symbol risk';
  if (story.category.toLowerCase().includes('algo')) return 'Algo drift requires review';
  if (story.category.toLowerCase().includes('regulatory')) return 'Regulatory constraint active';
  return story.title;
}

function scenarioTarget(story: ScenarioStory) {
  if (story.id.includes('bats')) return 'BATS / BZX_GW';
  if (story.id.includes('venue')) return 'NYSE';
  if (story.id.includes('iex')) return 'IEX';
  if (story.id.includes('dark')) return 'Dark Pool';
  if (story.category.toLowerCase().includes('algo')) return 'Algo desk';
  return 'Trading desk';
}

function runbookRows(story: ScenarioStory) {
  const rows = [
    ['Check sessions', 'check_fix_sessions', 'session'],
    ['Quantify flow', 'query_orders', 'orders'],
    ['Validate blockers', 'validate_orders', 'risk'],
    ['Approve workbook', 'human_gate', 'approval'],
    ['Run approved steps', 'agent_run', 'execution'],
  ];
  if (story.category.toLowerCase().includes('reference')) rows.splice(2, 0, ['Load reference data', 'load_ticker', 'symbols']);
  if (story.category.toLowerCase().includes('algo')) rows.splice(1, 0, ['Inspect algo', 'check_algo_status', 'algo']);
  return rows.slice(0, 6);
}

function stepState(index: number, frame: number): StepState {
  if (frame < 120) return index === 0 ? 'running' : 'todo';
  if (frame < 270) return index <= 1 ? 'done' : index === 2 ? 'running' : 'todo';
  if (frame < 420) return index <= 2 ? 'done' : index === 3 ? 'running' : 'todo';
  if (frame < 570) return index <= 3 ? 'done' : 'hold';
  if (frame < 760) return index <= 4 ? 'done' : index === 5 ? 'running' : 'todo';
  return 'done';
}

function statusColor(state: StepState) {
  if (state === 'done') return C.green;
  if (state === 'running') return C.cyan;
  if (state === 'hold') return C.amber;
  return C.muted;
}

function StatusBadge({ state }: { state: StepState }) {
  const label = state === 'done' ? 'DONE' : state === 'running' ? 'RUNNING' : state === 'hold' ? 'RE-TRIAGE' : 'PENDING';
  return (
    <div
      style={{
        color: statusColor(state),
        background: `${statusColor(state)}14`,
        border: `1px solid ${statusColor(state)}55`,
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 11,
        fontWeight: 900,
      }}
    >
      {label}
    </div>
  );
}

function TopBar({ story, phase }: { story: ScenarioStory; phase: string }) {
  return (
    <div style={{ height: 64, borderBottom: `1px solid ${C.line}`, background: C.panel, display: 'flex', alignItems: 'center', padding: '0 22px', gap: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 950, color: C.ink }}>FIX-MCP</div>
      <div style={{ color: C.muted, fontWeight: 800, fontSize: 13 }}>AI Trading Ops Simulator</div>
      <div style={{ marginLeft: 18, display: 'flex', gap: 6 }}>
        {['Desk', 'Incidents', 'Builder'].map((tab) => (
          <div key={tab} style={{ padding: '8px 12px', borderRadius: 6, background: tab === 'Desk' ? '#006f8f14' : 'transparent', color: tab === 'Desk' ? C.cyan : C.muted, fontWeight: 900, fontSize: 13 }}>{tab}</div>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.green, fontWeight: 900 }}>● LIVE</div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 900, color: C.text }}>{story.title}</div>
        <div style={{ border: `1px solid ${phase === 'inject' ? C.amber : C.line}`, color: phase === 'inject' ? C.amber : C.text, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>Inject Stress</div>
        <div style={{ border: `1px solid ${phase === 'agent' ? C.green : C.line}`, color: phase === 'agent' ? C.green : C.text, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>Agent Run</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: '#f9fafb', padding: 14 }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, marginTop: 6, fontSize: 25, fontWeight: 950 }}>{value}</div>
    </div>
  );
}

function ScenarioHeader({ story, phase }: { story: ScenarioStory; phase: string }) {
  const isClosed = phase === 'close';
  const activeLabel =
    phase === 'load' ? 'Scenario loaded' :
    phase === 'investigate' ? 'Investigator running' :
    phase === 'approve' ? 'Workbook approval' :
    phase === 'inject' ? 'Stress injected' :
    phase === 'agent' ? 'Agent executing approved steps' :
    'Incident closed';
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.panel, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: story.severity === 'critical' ? '#b91c1c18' : '#b4530918', color: story.severity === 'critical' ? C.red : C.amber, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>
              {story.severity}
            </div>
            <div style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 900 }}>{story.time}</div>
            <div style={{ color: C.cyan, fontSize: 12, fontWeight: 950 }}>{activeLabel}</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 35, fontWeight: 950, color: C.ink }}>{scenarioProblem(story)}</div>
          <div style={{ marginTop: 8, fontSize: 17, fontWeight: 750, color: C.text, maxWidth: 920 }}>{story.situation}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 150px)', gap: 10, alignSelf: 'stretch' }}>
          {story.metrics.map((m, i) => {
            const resolved = [
              { label: 'Released', value: '14', tone: 'good' as const },
              { label: 'BATS', value: 'up', tone: 'good' as const },
              { label: 'Evidence', value: 'ready', tone: 'good' as const },
            ][i];
            const metric = isClosed ? resolved : m;
            return <Metric key={m.label} label={metric.label} value={metric.value} color={tone[metric.tone]} />;
          })}
        </div>
      </div>
    </div>
  );
}

function RunbookRail({ story, frame }: { story: ScenarioStory; frame: number }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.panel, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 950, textTransform: 'uppercase' }}>Workbook</div>
        <div style={{ fontSize: 12, color: C.cyan, fontWeight: 950 }}>Human approved path</div>
      </div>
      {runbookRows(story).map(([label, tool, domain], i) => {
        const state = stepState(i, frame);
        return (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 12, alignItems: 'center', padding: '13px 14px', borderBottom: `1px solid ${C.line}`, background: state === 'running' ? '#006f8f10' : state === 'done' ? '#0478570c' : C.panel }}>
            <div style={{ width: 26, height: 26, borderRadius: 13, background: `${statusColor(state)}18`, color: statusColor(state), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 950 }}>{i + 1}</div>
            <div>
              <div style={{ color: C.ink, fontSize: 15, fontWeight: 950 }}>{label}</div>
              <div style={{ marginTop: 3, color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{tool} · {domain}</div>
            </div>
            <StatusBadge state={state} />
          </div>
        );
      })}
    </div>
  );
}

function MainWorkspace({ story, phase, frame }: { story: ScenarioStory; phase: string; frame: number }) {
  const showInjection = phase === 'inject' || phase === 'agent' || phase === 'close';
  const mode =
    phase === 'close' ? 'Closed' :
    phase === 'agent' ? 'Agent Run' :
    phase === 'inject' ? 'Re-triage' :
    phase === 'approve' ? 'Approve' :
    'Investigate';
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.panel, overflow: 'hidden', minHeight: 432 }}>
      <div style={{ height: 42, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8 }}>
        {['Case Study', 'Trace', 'FIX Wire'].map((tab) => (
          <div key={tab} style={{ padding: '6px 10px', borderRadius: 6, color: tab === 'Trace' && (phase === 'agent' || phase === 'close') ? C.cyan : C.text, background: tab === 'Trace' && (phase === 'agent' || phase === 'close') ? '#006f8f14' : 'transparent', fontSize: 12, fontWeight: 950 }}>{tab}</div>
        ))}
      </div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: phase === 'load' ? '1fr' : '1fr 320px', gap: 14 }}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: '#f9fafb', padding: 16 }}>
          <div style={{ color: C.muted, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Desk state</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
            <Metric label="Target" value={scenarioTarget(story)} color={phase === 'close' ? C.green : C.red} />
            <Metric label="Mode" value={mode} color={phase === 'close' || phase === 'agent' ? C.green : C.cyan} />
            <Metric label="Evidence" value={phase === 'load' ? 'Pending' : 'Trace live'} color={phase === 'load' ? C.muted : C.green} />
            <Metric label="Authority" value="Human" color={C.green} />
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 8, padding: 14 }}>
              <div style={{ color: C.cyan, fontSize: 13, fontWeight: 950 }}>Copilot finding</div>
              <div style={{ color: C.ink, fontSize: 24, lineHeight: 1.16, fontWeight: 950, marginTop: 8 }}>{story.mcpEvidence}</div>
            </div>
            <div style={{ border: `1px solid ${showInjection ? C.amber : C.line}`, background: showInjection ? '#b4530910' : C.panel, borderRadius: 8, padding: 14 }}>
              <div style={{ color: showInjection ? C.amber : C.muted, fontSize: 13, fontWeight: 950 }}>{showInjection ? 'Injected pressure' : 'Next decision'}</div>
              <div style={{ color: C.ink, fontSize: 24, lineHeight: 1.16, fontWeight: 950, marginTop: 8 }}>{showInjection ? story.injector : story.humanDecision}</div>
            </div>
          </div>
        </div>
        {phase !== 'load' && (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.navy, color: '#e2e8f0', padding: 16 }}>
            <div style={{ color: '#67e8f9', fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>SRE Copilot</div>
            <div style={{ marginTop: 14, color: '#fff', fontSize: 22, lineHeight: 1.22, fontWeight: 950 }}>
              {phase === 'investigate' && 'First: prove the blocker, then quantify affected flow.'}
              {phase === 'approve' && 'Workbook is ready. Human approval required before execution.'}
              {phase === 'inject' && 'State changed. Re-triage before continuing.'}
              {phase === 'agent' && 'Executing approved steps. Stopping on scope change.'}
              {phase === 'close' && 'Evidence captured. Scenario can be reviewed.'}
            </div>
            <div style={{ marginTop: 20, display: 'grid', gap: 8 }}>
              {['No production authority', 'MCP tools only', 'Trace every step'].map((x, i) => (
                <div key={x} style={{ opacity: fade(frame, 80 + i * 20), border: '1px solid #334155', borderRadius: 6, padding: '9px 10px', color: '#cbd5e1', fontSize: 13, fontWeight: 850 }}>{x}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TraceTable({ phase, frame }: { phase: string; frame: number }) {
  const rows = [
    ['check_fix_sessions', 'BATS down / sequence issue', 'ok'],
    ['query_orders', 'blocked flow quantified', 'ok'],
    ['validate_orders', 'release blockers checked', 'ok'],
    ['inject_event', 'reject spike recorded', phase === 'inject' ? 'warn' : 'ok'],
    ['score_scenario', 'evidence complete', phase === 'close' ? 'ok' : 'pending'],
  ];
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.panel, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 110px', padding: '10px 14px', background: '#eef2f5', color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>
        <div>Tool</div><div>Evidence</div><div>Status</div>
      </div>
      {rows.map(([tool, evidence, state], i) => {
        const visible = phase === 'load' ? i < 1 : phase === 'investigate' ? i < 2 : phase === 'approve' ? i < 3 : phase === 'inject' ? i < 4 : i < 5;
        const color = state === 'warn' ? C.amber : state === 'pending' ? C.muted : C.green;
        return (
          <div key={tool} style={{ opacity: visible ? fade(frame, 60 + i * 14) : 0.18, display: 'grid', gridTemplateColumns: '230px 1fr 110px', padding: '10px 14px', borderTop: `1px solid ${C.line}`, alignItems: 'center' }}>
            <div style={{ color: C.cyan, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 950 }}>{tool}</div>
            <div style={{ color: C.text, fontSize: 14, fontWeight: 750 }}>{evidence}</div>
            <div style={{ color, fontSize: 12, fontWeight: 950 }}>{state === 'warn' ? 'RE-TRIAGE' : state === 'pending' ? 'PENDING' : 'PASS'}</div>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalOverlay({ phase, frame }: { phase: string; frame: number }) {
  const show = phase === 'approve';
  return (
    <div style={{ opacity: show ? fade(frame, 300) : 0, position: 'absolute', left: 520, top: 342, width: 520, background: C.panel, border: `2px solid ${C.green}`, borderRadius: 8, padding: 20, boxShadow: '0 18px 50px #0f172a33' }}>
      <div style={{ color: C.green, fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Human approval gate</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, color: C.ink }}>Approve full workbook?</div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: C.green, color: '#fff', borderRadius: 6, padding: '11px 12px', textAlign: 'center', fontWeight: 950 }}>Approve</div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '11px 12px', textAlign: 'center', fontWeight: 950 }}>Hold</div>
      </div>
    </div>
  );
}

function CompletionOverlay({ phase, frame }: { phase: string; frame: number }) {
  const show = phase === 'close';
  return (
    <div style={{ opacity: show ? fade(frame, 760) : 0, position: 'absolute', right: 52, bottom: 48, width: 430, background: C.navy, color: '#e2e8f0', borderRadius: 8, padding: 22, boxShadow: '0 18px 50px #0f172a33' }}>
      <div style={{ color: '#86efac', fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Incident resolved</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, lineHeight: 1.12 }}>{storylessClose}</div>
      <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 15, fontWeight: 750 }}>Trace, workbook, and FIX evidence are ready for review.</div>
    </div>
  );
}

const storylessClose = 'Approved automation, human control, auditable proof.';

export function ScenarioExecutiveBrief({ story = defaultStory }: { story?: ScenarioStory }) {
  const frame = useCurrentFrame();
  const phase = phaseAt(frame);
  const progress = interpolate(frame, [0, 899], [4, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: C.page, fontFamily: 'Inter, Arial, sans-serif', color: C.ink }}>
      <TopBar story={story} phase={phase} />
      <div style={{ padding: 20, display: 'grid', gap: 14 }}>
        <ScenarioHeader story={story} phase={phase} />
        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 14 }}>
          <RunbookRail story={story} frame={frame} />
          <MainWorkspace story={story} phase={phase} frame={frame} />
        </div>
        <TraceTable phase={phase} frame={frame} />
        <div style={{ height: 8, borderRadius: 99, background: '#d8dee6', overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: phase === 'inject' ? C.amber : phase === 'close' ? C.green : C.cyan }} />
        </div>
      </div>
      <ApprovalOverlay phase={phase} frame={frame} />
      <CompletionOverlay phase={phase} frame={frame} />
    </AbsoluteFill>
  );
}

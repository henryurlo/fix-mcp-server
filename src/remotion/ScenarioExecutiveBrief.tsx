import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ScenarioStory, defaultStory } from './scenarioStories';

const C = {
  page: '#e9eef3',
  panel: '#ffffff',
  ink: '#0b1220',
  text: '#26364d',
  muted: '#65758b',
  line: '#cfd8e3',
  blue: '#005f83',
  cyan: '#0093b8',
  green: '#087a55',
  amber: '#b4570a',
  red: '#b42318',
  navy: '#0d1728',
};

const tone = {
  neutral: C.text,
  good: C.green,
  warn: C.amber,
  bad: C.red,
};

type Phase = 'brief' | 'diagnose' | 'approve' | 'inject' | 'agent' | 'resolved';
type StepState = 'todo' | 'running' | 'done' | 'hold';

function fade(frame: number, start: number, duration = 16) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function phaseAt(frame: number): Phase {
  if (frame < 110) return 'brief';
  if (frame < 270) return 'diagnose';
  if (frame < 410) return 'approve';
  if (frame < 560) return 'inject';
  if (frame < 760) return 'agent';
  return 'resolved';
}

function phaseCopy(phase: Phase) {
  if (phase === 'brief') return 'Live incident loaded';
  if (phase === 'diagnose') return 'MCP tools prove the blocker';
  if (phase === 'approve') return 'Human approves the workbook';
  if (phase === 'inject') return 'Stress changes the state';
  if (phase === 'agent') return 'Agent runs inside the approved path';
  return 'Evidence ready for review';
}

function problemTitle(story: ScenarioStory) {
  if (story.id.includes('bats')) return 'BATS logon rejected';
  if (story.id.includes('venue')) return 'NYSE latency degraded';
  if (story.id.includes('triage')) return 'Pre-market triage';
  if (story.category.toLowerCase().includes('algo')) return 'Algo drift under review';
  if (story.category.toLowerCase().includes('regulatory')) return 'Regulatory control active';
  return story.title;
}

function shortFinding(story: ScenarioStory) {
  if (story.id.includes('bats')) return 'Bad sequence reset. 14 orders blocked.';
  if (story.id.includes('venue')) return 'Venue degraded. Open flow quantified.';
  if (story.category.toLowerCase().includes('algo')) return 'Execution drift separated from venue risk.';
  return story.mcpEvidence;
}

function shortInjection(story: ScenarioStory) {
  if (story.id.includes('bats')) return 'Reject spike injected. Plan pauses for re-triage.';
  if (story.category.toLowerCase().includes('algo')) return 'New pressure injected. Agent must reassess.';
  return story.injector;
}

function runbookRows(story: ScenarioStory) {
  const rows = [
    ['Check sessions', 'check_fix_sessions', 'session'],
    ['Quantify flow', 'query_orders', 'orders'],
    ['Validate blockers', 'validate_orders', 'risk'],
    ['Approve workbook', 'human_gate', 'control'],
    ['Run approved steps', 'agent_run', 'execution'],
  ];
  if (story.category.toLowerCase().includes('reference')) rows.splice(2, 0, ['Load symbols', 'load_ticker', 'reference']);
  if (story.category.toLowerCase().includes('algo')) rows.splice(1, 0, ['Inspect algo', 'check_algo_status', 'algo']);
  return rows.slice(0, 6);
}

function stepState(index: number, frame: number): StepState {
  if (frame < 110) return index === 0 ? 'running' : 'todo';
  if (frame < 270) return index <= 1 ? 'done' : index === 2 ? 'running' : 'todo';
  if (frame < 410) return index <= 2 ? 'done' : index === 3 ? 'running' : 'todo';
  if (frame < 560) return index <= 3 ? 'done' : 'hold';
  if (frame < 760) return index <= 4 ? 'done' : index === 5 ? 'running' : 'todo';
  return 'done';
}

function stateColor(state: StepState) {
  if (state === 'done') return C.green;
  if (state === 'running') return C.cyan;
  if (state === 'hold') return C.amber;
  return C.muted;
}

function focus(frame: number) {
  const phase = phaseAt(frame);
  const target = {
    brief: { x: 0, y: 0, scale: 1 },
    diagnose: { x: 0, y: 0, scale: 1.012 },
    approve: { x: 0, y: 0, scale: 1.012 },
    inject: { x: 0, y: 0, scale: 1.012 },
    agent: { x: 0, y: -8, scale: 1.012 },
    resolved: { x: 0, y: 0, scale: 1 },
  }[phase];
  const ease = spring({ frame, fps: 30, config: { damping: 190, stiffness: 80, mass: 0.7 } });
  return {
    transform: `translate(${target.x * ease}px, ${target.y * ease}px) scale(${1 + (target.scale - 1) * ease})`,
  };
}

function metricSet(story: ScenarioStory, phase: Phase) {
  if (phase === 'resolved') {
    return [
      { label: 'Released', value: '14', tone: 'good' as const },
      { label: 'Venue', value: 'up', tone: 'good' as const },
      { label: 'Evidence', value: 'ready', tone: 'good' as const },
    ];
  }
  return story.metrics;
}

function TopBar({ story, phase }: { story: ScenarioStory; phase: Phase }) {
  return (
    <div style={{ height: 62, background: C.panel, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 22px', gap: 18 }}>
      <div style={{ fontSize: 23, fontWeight: 950, color: C.ink }}>FIX-MCP</div>
      <div style={{ color: C.muted, fontSize: 13, fontWeight: 850 }}>AI Trading Ops Simulator</div>
      <div style={{ marginLeft: 18, display: 'flex', gap: 6 }}>
        {['Desk', 'Incidents', 'Builder'].map((tab) => (
          <div key={tab} style={{ padding: '8px 12px', borderRadius: 6, background: tab === 'Desk' ? '#005f8314' : 'transparent', color: tab === 'Desk' ? C.blue : C.muted, fontSize: 13, fontWeight: 950 }}>
            {tab}
          </div>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color: C.green, fontSize: 12, fontWeight: 950 }}>LIVE</div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 12, fontWeight: 900 }}>{story.title}</div>
        <div style={{ border: `1px solid ${phase === 'inject' ? C.amber : C.line}`, color: phase === 'inject' ? C.amber : C.text, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>Inject Stress</div>
        <div style={{ border: `1px solid ${phase === 'agent' ? C.green : C.line}`, color: phase === 'agent' ? C.green : C.text, borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>Agent Run</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 7, background: '#f8fafc', padding: 13 }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, marginTop: 5, fontSize: 25, lineHeight: 1.08, fontWeight: 950 }}>{value}</div>
    </div>
  );
}

function Header({ story, phase }: { story: ScenarioStory; phase: Phase }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18, display: 'grid', gridTemplateColumns: '1fr 470px', gap: 18 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: story.severity === 'critical' ? C.red : C.amber, background: story.severity === 'critical' ? '#b4231817' : '#b4570a16', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>{story.severity}</div>
          <div style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 900 }}>{story.time}</div>
          <div style={{ color: C.blue, fontSize: 12, fontWeight: 950 }}>{phaseCopy(phase)}</div>
        </div>
        <div style={{ color: C.ink, marginTop: 10, fontSize: 36, fontWeight: 950 }}>{problemTitle(story)}</div>
        <div style={{ color: C.text, marginTop: 6, fontSize: 18, fontWeight: 750 }}>{story.executiveAngle}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {metricSet(story, phase).map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} color={tone[metric.tone]} />
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: StepState }) {
  const label = state === 'done' ? 'DONE' : state === 'running' ? 'RUN' : state === 'hold' ? 'PAUSE' : 'WAIT';
  return (
    <div style={{ justifySelf: 'end', color: stateColor(state), background: `${stateColor(state)}14`, border: `1px solid ${stateColor(state)}55`, borderRadius: 6, padding: '4px 7px', fontSize: 10, fontWeight: 950 }}>
      {label}
    </div>
  );
}

function Workbook({ story, frame }: { story: ScenarioStory; frame: number }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Workbook</div>
        <div style={{ color: C.blue, fontSize: 12, fontWeight: 950 }}>human gate</div>
      </div>
      {runbookRows(story).map(([label, tool], i) => {
        const state = stepState(i, frame);
        return (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 56px', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${C.line}`, background: state === 'running' ? '#0093b812' : state === 'done' ? '#087a550d' : C.panel }}>
            <div style={{ width: 24, height: 24, borderRadius: 12, background: `${stateColor(state)}18`, color: stateColor(state), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 950 }}>{i + 1}</div>
            <div>
              <div style={{ color: C.ink, fontSize: 14, fontWeight: 950 }}>{label}</div>
              <div style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, marginTop: 2 }}>{tool}</div>
            </div>
            <StatusBadge state={state} />
          </div>
        );
      })}
    </div>
  );
}

function Workspace({ story, phase, frame }: { story: ScenarioStory; phase: Phase; frame: number }) {
  const injected = phase === 'inject' || phase === 'agent' || phase === 'resolved';
  const mode =
    phase === 'resolved' ? 'Closed' :
    phase === 'agent' ? 'Agent Run' :
    phase === 'inject' ? 'Re-triage' :
    phase === 'approve' ? 'Approve' :
    'Diagnose';
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, minHeight: 430, overflow: 'hidden' }}>
      <div style={{ height: 42, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 6 }}>
        {['Case Study', 'Trace', 'FIX Wire'].map((tab) => {
          const active = (phase === 'agent' || phase === 'resolved') ? tab === 'Trace' : tab === 'Case Study';
          return (
            <div key={tab} style={{ padding: '6px 10px', borderRadius: 6, background: active ? '#005f8314' : 'transparent', color: active ? C.blue : C.text, fontSize: 12, fontWeight: 950 }}>
              {tab}
            </div>
          );
        })}
      </div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: '#f8fafc', padding: 16 }}>
          <div style={{ color: C.muted, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Desk state</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
            <Metric label="Target" value={phase === 'resolved' ? 'BATS up' : 'BATS / BZX_GW'} color={phase === 'resolved' ? C.green : C.red} />
            <Metric label="Mode" value={mode} color={phase === 'resolved' || phase === 'agent' ? C.green : C.blue} />
            <Metric label="Trace" value={phase === 'brief' ? 'Pending' : 'Live'} color={phase === 'brief' ? C.muted : C.green} />
            <Metric label="Owner" value="Human" color={C.green} />
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.panel, padding: 15 }}>
              <div style={{ color: C.blue, fontSize: 13, fontWeight: 950 }}>Finding</div>
              <div style={{ color: C.ink, marginTop: 8, fontSize: 28, lineHeight: 1.1, fontWeight: 950 }}>{shortFinding(story)}</div>
            </div>
            <div style={{ border: `1px solid ${injected ? C.amber : C.line}`, borderRadius: 8, background: injected ? '#b4570a12' : C.panel, padding: 15 }}>
              <div style={{ color: injected ? C.amber : C.muted, fontSize: 13, fontWeight: 950 }}>{injected ? 'Injected pressure' : 'Next decision'}</div>
              <div style={{ color: C.ink, marginTop: 8, fontSize: 28, lineHeight: 1.1, fontWeight: 950 }}>{injected ? shortInjection(story) : 'Approve only after evidence is visible.'}</div>
            </div>
          </div>
        </div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.navy, padding: 16, color: '#e2e8f0' }}>
          <div style={{ color: '#67e8f9', fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Copilot</div>
          <div style={{ marginTop: 13, color: '#fff', fontSize: 25, lineHeight: 1.14, fontWeight: 950 }}>
            {phase === 'brief' && 'Load the incident. Show the live desk.'}
            {phase === 'diagnose' && 'Start with facts, not guesses.'}
            {phase === 'approve' && 'One approval unlocks the workbook.'}
            {phase === 'inject' && 'New pressure means new triage.'}
            {phase === 'agent' && 'Run only what was approved.'}
            {phase === 'resolved' && 'Proof is ready.'}
          </div>
          <div style={{ marginTop: 22, display: 'grid', gap: 8 }}>
            {['bounded tools', 'human control', 'auditable trace'].map((item, i) => (
              <div key={item} style={{ opacity: fade(frame, 40 + i * 18), border: '1px solid #34445d', borderRadius: 6, padding: '10px 11px', fontSize: 13, fontWeight: 900, color: '#cbd5e1' }}>{item}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Trace({ phase, frame }: { phase: Phase; frame: number }) {
  const rows = [
    ['check_fix_sessions', 'sequence mismatch found', 'ok'],
    ['query_orders', '14 orders blocked', 'ok'],
    ['load_ticker', 'ETF symbols loaded', 'ok'],
    ['inject_event', 'reject spike recorded', phase === 'inject' ? 'hold' : 'ok'],
    ['score_scenario', 'evidence complete', phase === 'resolved' ? 'ok' : 'wait'],
  ];
  const count = phase === 'brief' ? 1 : phase === 'diagnose' ? 3 : phase === 'approve' ? 3 : phase === 'inject' ? 4 : 5;
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 110px', padding: '10px 14px', background: '#eef3f7', color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>
        <div>MCP Tool</div><div>Evidence</div><div>Status</div>
      </div>
      {rows.map(([tool, evidence, state], i) => {
        const visible = i < count;
        const color = state === 'hold' ? C.amber : state === 'wait' ? C.muted : C.green;
        return (
          <div key={tool} style={{ opacity: visible ? fade(frame, 60 + i * 12) : 0.18, display: 'grid', gridTemplateColumns: '230px 1fr 110px', alignItems: 'center', borderTop: `1px solid ${C.line}`, padding: '10px 14px' }}>
            <div style={{ color: C.blue, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 950 }}>{tool}</div>
            <div style={{ color: C.text, fontSize: 14, fontWeight: 800 }}>{evidence}</div>
            <div style={{ color, fontSize: 12, fontWeight: 950 }}>{state === 'hold' ? 'PAUSE' : state === 'wait' ? 'WAIT' : 'PASS'}</div>
          </div>
        );
      })}
    </div>
  );
}

function Callout({ phase, frame }: { phase: Phase; frame: number }) {
  const byPhase = {
    brief: { text: 'Open a real desk incident', left: 620, top: 116, color: C.blue },
    diagnose: { text: 'Evidence appears as MCP tools run', left: 560, top: 448, color: C.blue },
    approve: { text: 'Human accepts the whole workbook', left: 560, top: 360, color: C.green },
    inject: { text: 'Inject pressure and watch the plan pause', left: 1080, top: 432, color: C.amber },
    agent: { text: 'Agent executes inside the approved boundary', left: 1120, top: 610, color: C.green },
    resolved: { text: 'Close with proof, not a claim', left: 1250, top: 760, color: C.green },
  }[phase];
  return (
    <div style={{ opacity: fade(frame, 8), position: 'absolute', left: byPhase.left, top: byPhase.top, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 16, height: 16, borderRadius: 8, background: byPhase.color, boxShadow: `0 0 ${18 + Math.sin(frame / 8) * 6}px ${byPhase.color}88` }} />
      <div style={{ background: C.ink, color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 18, fontWeight: 950, boxShadow: '0 18px 45px #0b122033' }}>{byPhase.text}</div>
    </div>
  );
}

function Cursor({ phase, frame }: { phase: Phase; frame: number }) {
  const path = {
    brief: [1456, 32],
    diagnose: [250, 300],
    approve: [690, 470],
    inject: [1742, 32],
    agent: [1840, 32],
    resolved: [1510, 842],
  }[phase];
  const pulse = interpolate(Math.sin(frame / 6), [-1, 1], [0.85, 1.18]);
  return (
    <div style={{ position: 'absolute', left: path[0], top: path[1], opacity: 0.92, transform: `scale(${pulse})`, transformOrigin: '0 0' }}>
      <div style={{ width: 0, height: 0, borderLeft: '15px solid #0b1220', borderTop: '9px solid transparent', borderBottom: '9px solid transparent', transform: 'rotate(38deg)' }} />
      <div style={{ marginLeft: 18, marginTop: -3, width: 11, height: 11, borderRadius: 6, background: C.cyan }} />
    </div>
  );
}

function ApprovalOverlay({ phase, frame }: { phase: Phase; frame: number }) {
  const show = phase === 'approve';
  return (
    <div style={{ opacity: show ? fade(frame, 286) : 0, position: 'absolute', left: 604, top: 368, width: 520, background: C.panel, border: `2px solid ${C.green}`, borderRadius: 8, padding: 20, boxShadow: '0 24px 60px #0b122033' }}>
      <div style={{ color: C.green, fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Human approval gate</div>
      <div style={{ color: C.ink, marginTop: 7, fontSize: 31, fontWeight: 950 }}>Approve workbook?</div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: C.green, color: '#fff', borderRadius: 6, padding: '12px 12px', textAlign: 'center', fontSize: 17, fontWeight: 950 }}>Approve all</div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '12px 12px', textAlign: 'center', fontSize: 17, fontWeight: 950 }}>Hold</div>
      </div>
    </div>
  );
}

function ResolutionCard({ phase, frame }: { phase: Phase; frame: number }) {
  const show = phase === 'resolved';
  return (
    <div style={{ opacity: show ? fade(frame, 760) : 0, position: 'absolute', right: 52, bottom: 45, width: 455, background: C.navy, color: '#e2e8f0', borderRadius: 8, padding: 24, boxShadow: '0 24px 60px #0b122033' }}>
      <div style={{ color: '#86efac', fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Incident resolved</div>
      <div style={{ marginTop: 8, color: '#fff', fontSize: 32, lineHeight: 1.1, fontWeight: 950 }}>Approved automation. Human control. Auditable proof.</div>
      <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 15, fontWeight: 800 }}>The demo ends where a trading desk needs it to end: clear evidence and a decision trail.</div>
    </div>
  );
}

function Progress({ phase, frame }: { phase: Phase; frame: number }) {
  const progress = interpolate(frame, [0, 899], [3, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 20, right: 20, bottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 12, fontWeight: 950, marginBottom: 8 }}>
        {['Load', 'Diagnose', 'Approve', 'Inject', 'Agent Run', 'Resolve'].map((label) => (
          <div key={label} style={{ color: phaseCopy(phase).toLowerCase().includes(label.toLowerCase().split(' ')[0]) ? C.blue : C.muted }}>{label}</div>
        ))}
      </div>
      <div style={{ height: 8, borderRadius: 20, background: '#d4dde7', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: phase === 'inject' ? C.amber : phase === 'resolved' ? C.green : C.blue }} />
      </div>
    </div>
  );
}

export function ScenarioExecutiveBrief({ story = defaultStory }: { story?: ScenarioStory }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = phaseAt(frame);
  const enter = spring({ frame, fps, config: { damping: 190, stiffness: 90, mass: 0.8 } });

  return (
    <AbsoluteFill style={{ background: C.page, color: C.ink, fontFamily: 'Inter, Arial, sans-serif', overflow: 'hidden' }}>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 18}px)` }}>
        <TopBar story={story} phase={phase} />
        <div style={{ padding: '20px 20px 58px', transformOrigin: '50% 44%', ...focus(frame) }}>
          <Header story={story} phase={phase} />
          <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 14, marginTop: 14 }}>
            <Workbook story={story} frame={frame} />
            <Workspace story={story} phase={phase} frame={frame} />
          </div>
          <div style={{ marginTop: 14 }}>
            <Trace phase={phase} frame={frame} />
          </div>
        </div>
      </div>
      <Callout phase={phase} frame={frame} />
      <Cursor phase={phase} frame={frame} />
      <ApprovalOverlay phase={phase} frame={frame} />
      <ResolutionCard phase={phase} frame={frame} />
      <Progress phase={phase} frame={frame} />
    </AbsoluteFill>
  );
}

import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ScenarioStory, defaultStory } from './scenarioStories';
import capture from '../../docs/demo-captures/bats-startup-real-run.json';

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

const VIDEO_SCRIPT: Record<Phase, { scene: string; headline: string; voiceover: string; callout: string }> = {
  brief: {
    scene: '01 / Start Here',
    headline: 'Start in Mission Control and load a desk incident.',
    voiceover: 'The user begins with a scenario selector, a live desk state, and an agent panel. This is the product surface, not a slide.',
    callout: 'Select BATS Extended-Hours Startup',
  },
  diagnose: {
    scene: '02 / Investigator',
    headline: 'Launch the agent to inspect the real system state.',
    voiceover: 'The first useful action is not injection. The agent checks FIX sessions and orders so the user understands the incident.',
    callout: 'Agent runs check_fix_sessions and query_orders',
  },
  approve: {
    scene: '03 / Human Gate',
    headline: 'The workbook is approved as one auditable plan.',
    voiceover: 'The agent proposes the recovery workbook. The operator reviews the evidence and approves the whole plan before execution.',
    callout: 'Human accepts the full workbook',
  },
  agent: {
    scene: '04 / Agent Run',
    headline: 'Agent Run executes the approved recovery path.',
    voiceover: 'After approval, the agent reconnects BATS, resets sequence state, loads ETF symbols, and validates the book.',
    callout: 'Watch the approved workbook complete',
  },
  inject: {
    scene: '05 / Pressure Test',
    headline: 'Only after the normal run do we inject pressure.',
    voiceover: 'The injection is a test. It creates a BATS sequence gap and proves the agent pauses to re-check state before continuing.',
    callout: 'Inject pressure and force re-triage',
  },
  resolved: {
    scene: '06 / Proof',
    headline: 'The incident closes with evidence, not a claim.',
    voiceover: 'The user sees the injected event resolved, simulation resumed, a score report, and the trace that proves every tool call.',
    callout: 'Close with proof, not a claim',
  },
};

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
  if (frame < 590) return 'agent';
  if (frame < 760) return 'inject';
  return 'resolved';
}

function phaseCopy(phase: Phase) {
  return VIDEO_SCRIPT[phase].headline;
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
  if (frame < 590) return index <= 4 ? 'done' : index === 5 ? 'running' : 'todo';
  if (frame < 760) return index <= 4 ? 'done' : 'hold';
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
    agent: { x: 0, y: -8, scale: 1.012 },
    inject: { x: 0, y: 0, scale: 1.012 },
    resolved: { x: 0, y: 0, scale: 1 },
  }[phase];
  const ease = spring({ frame, fps: 30, config: { damping: 190, stiffness: 80, mass: 0.7 } });
  return {
    transform: `translate(${target.x * ease}px, ${target.y * ease}px) scale(${1 + (target.scale - 1) * ease})`,
  };
}

function captureStep(tool: string, occurrence = 0) {
  const matches = capture.steps.filter((step) => step.tool === tool);
  return matches[occurrence] || matches[0] || capture.steps[0];
}

function evidenceForPhase(phase: Phase) {
  if (phase === 'brief') return captureStep('list_scenarios');
  if (phase === 'diagnose') return captureStep('query_orders');
  if (phase === 'approve') return captureStep('validate_orders');
  if (phase === 'agent') return captureStep('fix_session_issue', 0);
  if (phase === 'inject') return captureStep('inject_event');
  return captureStep('score_scenario');
}

function metricSet(story: ScenarioStory, phase: Phase) {
  if (phase === 'agent' || phase === 'resolved') {
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
  const injected = phase === 'inject' || phase === 'resolved';
  const evidence = evidenceForPhase(phase);
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
            <Metric label="Target" value={phase === 'agent' || phase === 'resolved' ? 'BATS up' : 'BATS / BZX_GW'} color={phase === 'agent' || phase === 'resolved' ? C.green : C.red} />
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
            {phase === 'agent' && 'Run only what was approved.'}
            {phase === 'inject' && 'New pressure means new triage.'}
            {phase === 'resolved' && 'Proof is ready.'}
          </div>
          <div style={{ marginTop: 18, border: '1px solid #34445d', borderRadius: 7, padding: 12 }}>
            <div style={{ color: '#67e8f9', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 950 }}>{evidence.tool}</div>
            <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.28, fontWeight: 850, marginTop: 7 }}>{evidence.summary}</div>
            <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.3, fontWeight: 800, marginTop: 8 }}>{evidence.note}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Trace({ phase, frame }: { phase: Phase; frame: number }) {
  const rows = [
    ['list_scenarios', captureStep('list_scenarios').summary, 'ok'],
    ['check_fix_sessions', 'BATS down; expected 2450, got 2449', 'ok'],
    ['query_orders', captureStep('query_orders').summary, 'ok'],
    ['approve_workbook', 'human approved full workbook', phase === 'approve' ? 'hold' : 'ok'],
    ['fix_session_issue', 'BATS reconnect released 8 stuck orders', 'ok'],
    ['load_ticker', 'BITO and GBTC loaded; 2 orders released', 'ok'],
    ['validate_orders', '14 PASS, 0 FAIL', 'ok'],
    ['inject_event', captureStep('inject_event').summary, phase === 'inject' ? 'hold' : 'ok'],
    ['resume_simulation', captureStep('resume_simulation').summary, phase === 'resolved' ? 'ok' : 'wait'],
    ['score_scenario', 'Overall Score: 1.00 (A)', phase === 'resolved' ? 'ok' : 'wait'],
  ];
  const count = phase === 'brief' ? 1 : phase === 'diagnose' ? 3 : phase === 'approve' ? 4 : phase === 'agent' ? 7 : phase === 'inject' ? 8 : 10;
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
    brief: { text: VIDEO_SCRIPT.brief.callout, left: 620, top: 116, color: C.blue },
    diagnose: { text: VIDEO_SCRIPT.diagnose.callout, left: 560, top: 448, color: C.blue },
    approve: { text: VIDEO_SCRIPT.approve.callout, left: 560, top: 360, color: C.green },
    agent: { text: VIDEO_SCRIPT.agent.callout, left: 1120, top: 610, color: C.green },
    inject: { text: VIDEO_SCRIPT.inject.callout, left: 1080, top: 432, color: C.amber },
    resolved: { text: VIDEO_SCRIPT.resolved.callout, left: 1250, top: 760, color: C.green },
  }[phase];
  return (
    <div style={{ opacity: fade(frame, 8), position: 'absolute', left: byPhase.left, top: byPhase.top, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 16, height: 16, borderRadius: 8, background: byPhase.color, boxShadow: `0 0 ${18 + Math.sin(frame / 8) * 6}px ${byPhase.color}88` }} />
      <div style={{ background: C.ink, color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 18, fontWeight: 950, boxShadow: '0 18px 45px #0b122033' }}>{byPhase.text}</div>
    </div>
  );
}

function IntroCard({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [0, 18, 82, 106], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const y = interpolate(frame, [0, 18], [16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ opacity, transform: `translateY(${y}px)`, position: 'absolute', left: 66, top: 104, width: 720, background: C.navy, color: '#fff', borderRadius: 10, padding: 28, boxShadow: '0 30px 80px #0b12204d' }}>
      <div style={{ color: '#67e8f9', fontSize: 14, fontWeight: 950, textTransform: 'uppercase' }}>FIX-MCP product demo</div>
      <div style={{ marginTop: 10, fontSize: 44, lineHeight: 1.05, fontWeight: 950 }}>AI incident response for a trading desk.</div>
      <div style={{ marginTop: 16, color: '#cbd5e1', fontSize: 20, lineHeight: 1.34, fontWeight: 800 }}>
        MCP tools gather evidence. An LLM builds the workbook. A human approves the plan before Agent Run executes.
      </div>
    </div>
  );
}

function NarrationBar({ phase, frame }: { phase: Phase; frame: number }) {
  const script = VIDEO_SCRIPT[phase];
  const opacity = fade(frame, 12);
  return (
    <div style={{ opacity, position: 'absolute', left: 42, right: 42, bottom: 48, background: '#ffffffee', border: `1px solid ${C.line}`, borderRadius: 9, padding: '14px 18px', display: 'grid', gridTemplateColumns: '150px 1fr', gap: 18, boxShadow: '0 18px 50px #0b12201c' }}>
      <div>
        <div style={{ color: C.blue, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{script.scene}</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 900, marginTop: 4 }}>voiceover</div>
      </div>
      <div>
        <div style={{ color: C.ink, fontSize: 21, fontWeight: 950 }}>{script.headline}</div>
        <div style={{ color: C.text, fontSize: 16, lineHeight: 1.28, fontWeight: 780, marginTop: 4 }}>{script.voiceover}</div>
      </div>
    </div>
  );
}

function Cursor({ phase, frame }: { phase: Phase; frame: number }) {
  const path = {
    brief: [1456, 32],
    diagnose: [250, 300],
    approve: [690, 470],
    agent: [1840, 32],
    inject: [1742, 32],
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
    <div style={{ opacity: show ? fade(frame, 760) : 0, position: 'absolute', right: 52, bottom: 178, width: 455, background: C.navy, color: '#e2e8f0', borderRadius: 8, padding: 24, boxShadow: '0 24px 60px #0b122033' }}>
      <div style={{ color: '#86efac', fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>Incident resolved</div>
      <div style={{ marginTop: 8, color: '#fff', fontSize: 32, lineHeight: 1.1, fontWeight: 950 }}>Approved automation. Human control. Auditable proof.</div>
      <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 15, fontWeight: 800 }}>The demo ends where a trading desk needs it to end: clear evidence and a decision trail.</div>
    </div>
  );
}

function Progress({ phase, frame }: { phase: Phase; frame: number }) {
  const progress = interpolate(frame, [0, 899], [3, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const activeLabel = {
    brief: 'Load',
    diagnose: 'Diagnose',
    approve: 'Approve',
    agent: 'Agent Run',
    inject: 'Inject',
    resolved: 'Resolve',
  }[phase];
  return (
    <div style={{ position: 'absolute', left: 42, right: 42, bottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 12, fontWeight: 950, marginBottom: 8 }}>
        {['Load', 'Diagnose', 'Approve', 'Agent Run', 'Inject', 'Resolve'].map((label) => (
          <div key={label} style={{ color: activeLabel === label ? C.blue : C.muted }}>{label}</div>
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
      <IntroCard frame={frame} />
      <NarrationBar phase={phase} frame={frame} />
      <ApprovalOverlay phase={phase} frame={frame} />
      <ResolutionCard phase={phase} frame={frame} />
      <Progress phase={phase} frame={frame} />
    </AbsoluteFill>
  );
}

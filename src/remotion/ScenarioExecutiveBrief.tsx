import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ScenarioStory, defaultStory } from './scenarioStories';
import capture from '../../docs/demo-captures/bats-startup-real-run.json';

const C = {
  bg: '#eef3f7',
  panel: '#ffffff',
  raised: '#f8fafc',
  ink: '#111827',
  text: '#27364a',
  muted: '#64748b',
  line: '#cbd5e1',
  blue: '#005f83',
  cyan: '#0086a8',
  green: '#087a55',
  amber: '#b45f06',
  red: '#b42318',
  navy: '#0f172a',
};

type Phase = 'open' | 'start' | 'select' | 'read' | 'launch' | 'inspect' | 'plan' | 'approve' | 'run' | 'trace' | 'inject' | 'pause' | 'recover' | 'verify' | 'close';
type ToolStep = (typeof capture.steps)[number];

const phaseFrames: Array<[Phase, number, number]> = [
  ['open', 0, 300],
  ['start', 300, 600],
  ['select', 600, 900],
  ['read', 900, 1200],
  ['launch', 1200, 1500],
  ['inspect', 1500, 1800],
  ['plan', 1800, 2100],
  ['approve', 2100, 2400],
  ['run', 2400, 2820],
  ['trace', 2820, 3120],
  ['inject', 3120, 3420],
  ['pause', 3420, 3720],
  ['recover', 3720, 4020],
  ['verify', 4020, 4320],
  ['close', 4320, 4500],
];

const scenarioScript: Record<Phase, {
  label: string;
  title: string;
  operator: string;
  agent: string;
  decision: string;
  proof: string;
  command: string;
}> = {
  open: {
    label: '00 / Scenario goal',
    title: 'Recover a failed BATS startup.',
    operator: 'The desk must restore BATS after a rejected Logon, protect overnight GTC flow, and prove the recovery with MCP evidence.',
    agent: 'I will investigate first, propose a bounded workbook, wait for approval, then execute only the approved recovery.',
    decision: 'One concrete desk problem, start to finish.',
    proof: 'The capture is backed by a real local MCP run.',
    command: 'bats_startup_walkthrough',
  },
  start: {
    label: '01 / Operator view',
    title: 'Start from the incident console.',
    operator: 'Mission Control shows the active case, recovery workbook, agent conversation, and trace evidence in one workspace.',
    agent: 'I have no recovery authority yet. I can only read state and explain what I find.',
    decision: 'Start with the operational surface.',
    proof: 'The console exposes case state before action.',
    command: 'open incident console',
  },
  select: {
    label: '02 / Load case',
    title: 'Load BATS Extended-Hours Startup.',
    operator: 'Select bats_startup_0200, the overnight case where BATS rejects session recovery before the 04:00 ET flow begins.',
    agent: 'Scenario loaded. BATS is down, 8 venue orders are stuck, 6 more orders remain in scope, and IEX is healthy.',
    decision: 'Pick the smallest complete recovery story.',
    proof: 'The simulator loads bats_startup_0200.',
    command: 'load_scenario bats_startup_0200',
  },
  read: {
    label: '03 / Read the board',
    title: 'Read the incident before clicking anything.',
    operator: 'Check time, affected venue, order scope, fallback venue, and who controls execution.',
    agent: 'The important facts are BATS down, sequence recovery needed, 14 orders in scope, and human control.',
    decision: 'The user understands the problem before asking the agent to act.',
    proof: 'Desk state is visible before recovery starts.',
    command: 'review desk state',
  },
  launch: {
    label: '04 / Launch agent',
    title: 'Ask the agent to investigate.',
    operator: 'Ask what broke, what matters first, and what evidence should be trusted before approval.',
    agent: 'I will call MCP tools to check sessions and affected orders instead of guessing from the alert text.',
    decision: 'The agent investigates; it does not execute recovery yet.',
    proof: 'MCP tool calls begin in the trace.',
    command: 'launch_agent investigator',
  },
  inspect: {
    label: '05 / Inspect evidence',
    title: 'Read the MCP evidence.',
    operator: 'Confirm the agent found the BATS sequence mismatch and quantified the orders before any recovery action.',
    agent: 'BATS expected sequence 2450 but received 2449. The order query found 14 orders in scope.',
    decision: 'Evidence comes before the workbook approval.',
    proof: 'check_fix_sessions and query_orders are captured.',
    command: 'check_fix_sessions + query_orders',
  },
  plan: {
    label: '06 / Review plan',
    title: 'Review the generated workbook.',
    operator: 'Read the five proposed actions: verify state, quantify flow, reconnect BATS, load missing ETF symbols, validate orders.',
    agent: 'This workbook is the contract. I can run only the steps the human approves.',
    decision: 'No hidden action should be approved.',
    proof: 'Every recovery action is listed before Agent Run.',
    command: 'review workbook',
  },
  approve: {
    label: '07 / Approve',
    title: 'Approve the bounded recovery path.',
    operator: 'Approve all five steps only after the evidence and recovery sequence make sense.',
    agent: 'I will reconnect BATS, reset sequence if needed, load missing symbols, then validate orders.',
    decision: 'Human approval unlocks execution.',
    proof: 'The workbook is explicit before Agent Run.',
    command: 'approve_workbook',
  },
  run: {
    label: '08 / Agent Run',
    title: 'Run the approved workbook.',
    operator: 'Click Agent Run and watch each approved step write evidence back to the trace.',
    agent: 'BATS reconnected. Sequence reset accepted. BITO and GBTC loaded. Fourteen orders validated.',
    decision: 'The agent stays inside the approved boundary.',
    proof: 'Each step writes MCP evidence to the trace.',
    command: 'fix_session_issue + load_ticker + validate_orders',
  },
  trace: {
    label: '09 / Trace',
    title: 'Open the trace to audit what happened.',
    operator: 'Use the trace panel to prove which MCP tools ran, with arguments, result summaries, and status.',
    agent: 'The trace shows reconnect, sequence reset, symbol load, and order validation output.',
    decision: 'The audit trail is part of the product, not an afterthought.',
    proof: 'Captured MCP rows are visible.',
    command: 'open Trace',
  },
  inject: {
    label: '10 / Stress test',
    title: 'Inject pressure after baseline recovery.',
    operator: 'Now inject a BATS sequence gap. This is a controlled test, not part of the original incident.',
    agent: 'New sequence gap detected. I paused the simulation and returned to triage instead of continuing blindly.',
    decision: 'Stress tests must restart diagnosis.',
    proof: 'The injected event is captured as a trace row and changes mode.',
    command: 'inject_event seq_gap',
  },
  pause: {
    label: '11 / Re-triage',
    title: 'Confirm the agent pauses and re-checks.',
    operator: 'Confirm the system changed mode to paused/re-triage before letting any recovery continue.',
    agent: 'The injected sequence gap changed state. I need to check BATS again before continuing.',
    decision: 'This is the human-control moment.',
    proof: 'The injected event is visible before recovery resumes.',
    command: 'check_fix_sessions BATS',
  },
  recover: {
    label: '12 / Recover',
    title: 'Repair and resume.',
    operator: 'Approve the repair for the injected state, then resume the simulation.',
    agent: 'BATS sequence is repaired. Simulation resumed. The injected event is recovered.',
    decision: 'The system does not blindly continue after state changes.',
    proof: 'Recovery, resume, and score are all recorded.',
    command: 'reset_sequence + resume_simulation',
  },
  verify: {
    label: '13 / Verify',
    title: 'Verify the outcome.',
    operator: 'Check BATS status, released orders, workbook completion, score, and trace history.',
    agent: 'BATS is up, 14 orders are released, the workbook is complete, and the score is 1.00.',
    decision: 'A good demo ends with operational proof.',
    proof: 'Score and trace confirm recovery.',
    command: 'score_scenario',
  },
  close: {
    label: '14 / Close',
    title: 'End with the BATS case solved.',
    operator: 'The viewer has seen the whole BATS workflow: load, investigate, approve, run, stress test, re-triage, recover, verify.',
    agent: '14 orders released, BATS is up, final score is 1.00, and the trace is ready.',
    decision: 'The human keeps control; the agent keeps evidence.',
    proof: 'Audit trail survives the demo.',
    command: 'score_scenario + get_trace',
  },
};

const workbook = [
  { label: 'Check BATS session', tool: 'check_fix_sessions' },
  { label: 'Quantify blocked flow', tool: 'query_orders' },
  { label: 'Reconnect BATS', tool: 'fix_session_issue' },
  { label: 'Load ETF symbols', tool: 'load_ticker' },
  { label: 'Validate order book', tool: 'validate_orders' },
];

function phaseAt(frame: number): Phase {
  return phaseFrames.find(([, start, end]) => frame >= start && frame < end)?.[0] || 'close';
}

function localFrame(frame: number, phase: Phase) {
  const found = phaseFrames.find(([name]) => name === phase);
  return frame - (found?.[1] || 0);
}

function fade(frame: number, start: number, duration = 18) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function slide(frame: number, start: number, distance = 16) {
  return interpolate(frame, [start, start + 24], [distance, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function toolStep(tool: string, occurrence = 0): ToolStep {
  const matches = capture.steps.filter((step) => step.tool === tool);
  return matches[occurrence] || matches[0] || capture.steps[0];
}

function toolRows(phase: Phase) {
  const rows = [
    toolStep('list_scenarios'),
    toolStep('check_fix_sessions'),
    toolStep('query_orders'),
    toolStep('fix_session_issue', 0),
    toolStep('fix_session_issue', 1),
    toolStep('load_ticker', 0),
    toolStep('load_ticker', 1),
    toolStep('validate_orders'),
    toolStep('inject_event'),
    toolStep('resume_simulation'),
    toolStep('score_scenario'),
  ];
  const countByPhase: Record<Phase, number> = {
    open: 0,
    start: 0,
    select: 1,
    read: 1,
    launch: 2,
    inspect: 3,
    plan: 3,
    approve: 3,
    run: 8,
    trace: 8,
    inject: 9,
    pause: 9,
    recover: 10,
    verify: 11,
    close: 11,
  };
  return rows.slice(0, countByPhase[phase]);
}

function activeEvidence(phase: Phase): ToolStep {
  if (phase === 'select' || phase === 'read') return toolStep('list_scenarios');
  if (phase === 'launch' || phase === 'inspect') return toolStep('check_fix_sessions');
  if (phase === 'plan') return toolStep('query_orders');
  if (phase === 'approve') return toolStep('query_orders');
  if (phase === 'run' || phase === 'trace') return toolStep('validate_orders');
  if (phase === 'inject') return toolStep('inject_event');
  if (phase === 'pause') return toolStep('check_fix_sessions', 1);
  if (phase === 'recover') return toolStep('resume_simulation');
  if (phase === 'verify' || phase === 'close') return toolStep('score_scenario');
  return capture.steps[0];
}

function stateForMetric(label: string, phase: Phase) {
  if (label === 'BATS') {
    return phase === 'run' || phase === 'trace' || phase === 'verify' || phase === 'close' ? ['up', C.green] : phase === 'recover' ? ['recovering', C.amber] : ['down', C.red];
  }
  if (label === 'Orders') {
    return phase === 'run' || phase === 'trace' || phase === 'recover' || phase === 'verify' || phase === 'close' ? ['14 released', C.green] : ['14 blocked', C.amber];
  }
  if (label === 'Mode') {
    const mode: Record<Phase, string> = {
      open: 'guide',
      start: 'ready',
      select: 'loaded',
      read: 'review',
      launch: 'agent',
      inspect: 'diagnose',
      plan: 'plan',
      approve: 'approval',
      run: 'agent run',
      trace: 'audit',
      inject: 'paused',
      pause: 're-triage',
      recover: 'repair',
      verify: 'score',
      close: 'closed',
    };
    return [mode[phase], phase === 'inject' || phase === 'pause' ? C.amber : C.blue];
  }
  if (label === 'Control') return ['human', C.green];
  return ['', C.text];
}

function stepStatus(index: number, phase: Phase) {
  if (phase === 'open' || phase === 'start') return 'wait';
  if (phase === 'select' || phase === 'read') return index === 0 ? 'next' : 'wait';
  if (phase === 'launch') return index === 0 ? 'done' : index === 1 ? 'next' : 'wait';
  if (phase === 'inspect' || phase === 'plan') return index < 2 ? 'done' : 'ready';
  if (phase === 'approve') return 'ready';
  if (phase === 'run' || phase === 'trace') return 'done';
  if (phase === 'inject' || phase === 'pause') return index < 5 ? 'done' : 'wait';
  return 'done';
}

function statusColor(status: string) {
  if (status === 'done') return C.green;
  if (status === 'ready') return C.blue;
  if (status === 'next') return C.cyan;
  return C.muted;
}

function TopBar({ phase }: { phase: Phase }) {
  const stressActive = phase === 'inject' || phase === 'pause';
  const runActive = phase === 'run' || phase === 'recover';
  return (
    <div style={{ height: 70, background: C.panel, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 30px', gap: 22 }}>
      <div style={{ fontSize: 24, fontWeight: 950, color: C.ink }}>FIX-MCP</div>
      <div style={{ color: C.muted, fontSize: 13, fontWeight: 850 }}>Trading desk incident response</div>
      <div style={{ marginLeft: 18, display: 'flex', gap: 8 }}>
        {['Mission Control', 'Agent', 'Trace'].map((item) => (
          <div key={item} style={{ borderRadius: 6, padding: '9px 12px', background: item === 'Mission Control' ? '#005f8312' : 'transparent', color: item === 'Mission Control' ? C.blue : C.muted, fontSize: 13, fontWeight: 950 }}>
            {item}
          </div>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color: C.green, fontSize: 12, fontWeight: 950 }}>LIVE SIM</div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 12, fontWeight: 900 }}>BATS Extended-Hours Startup</div>
        <div style={{ border: `1px solid ${stressActive ? C.amber : C.line}`, borderRadius: 6, padding: '8px 12px', color: stressActive ? C.amber : C.text, fontSize: 12, fontWeight: 950 }}>Stress Test</div>
        <div style={{ background: runActive ? C.green : '#f1f5f9', border: `1px solid ${runActive ? C.green : C.line}`, borderRadius: 6, padding: '8px 12px', color: runActive ? '#fff' : C.text, fontSize: 12, fontWeight: 950 }}>Agent Run</div>
      </div>
    </div>
  );
}

function ScriptStrip({ phase, frame }: { phase: Phase; frame: number }) {
  const active = scenarioScript[phase];
  const lf = localFrame(frame, phase);
  return (
    <div style={{ position: 'absolute', left: 30, right: 30, bottom: 28, background: '#fffffff2', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 18px 45px #0f172a1c', display: 'grid', gridTemplateColumns: '180px 1fr 360px', gap: 18, padding: '15px 18px', opacity: fade(lf, 0) }}>
      <div>
        <div style={{ color: C.blue, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{active.label}</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 850, marginTop: 5 }}>user action</div>
      </div>
      <div>
        <div style={{ color: C.ink, fontSize: 23, fontWeight: 950 }}>{active.title}</div>
        <div style={{ color: C.text, fontSize: 16, fontWeight: 760, marginTop: 5 }}>{active.operator}</div>
      </div>
      <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>Command shown</div>
        <div style={{ color: C.blue, fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 950, marginTop: 6 }}>{active.command}</div>
      </div>
    </div>
  );
}

function Hero({ phase, frame }: { phase: Phase; frame: number }) {
  const show = phase === 'open';
  const lf = localFrame(frame, phase);
  return (
    <div style={{ opacity: show ? fade(lf, 4) : 0, pointerEvents: 'none', position: 'absolute', left: 92, top: 130, width: 820, background: C.navy, color: '#fff', borderRadius: 10, padding: 34, boxShadow: '0 28px 80px #0f172a40' }}>
      <div style={{ color: '#67e8f9', fontSize: 13, fontWeight: 950, textTransform: 'uppercase' }}>BATS startup scenario</div>
      <div style={{ fontSize: 48, lineHeight: 1.02, fontWeight: 950, marginTop: 10 }}>Recover the desk, then prove it.</div>
      <div style={{ color: '#cbd5e1', fontSize: 20, lineHeight: 1.35, fontWeight: 760, marginTop: 16 }}>
        Follow one complete BATS incident: diagnose the rejected Logon, approve the recovery workbook, run bounded Agent Run, inject a sequence gap, re-triage, and verify the trace.
      </div>
    </div>
  );
}

function Metric({ label, phase }: { label: string; phase: Phase }) {
  const [value, color] = stateForMetric(label, phase);
  return (
    <div style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 8, padding: 14 }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontSize: 25, fontWeight: 950, marginTop: 5 }}>{value}</div>
    </div>
  );
}

function IncidentHeader({ phase, frame }: { phase: Phase; frame: number }) {
  const lf = localFrame(frame, phase);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18, display: 'grid', gridTemplateColumns: '1fr 620px', gap: 18, opacity: fade(lf, 0), transform: `translateY(${slide(lf, 0, 10)}px)` }}>
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ color: C.amber, background: '#b45f0615', borderRadius: 6, padding: '5px 8px', fontSize: 11, fontWeight: 950 }}>MEDIUM</div>
          <div style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 900 }}>02:05 ET</div>
          <div style={{ color: C.blue, fontSize: 12, fontWeight: 950 }}>EXTENDED-HOURS STARTUP</div>
        </div>
        <div style={{ color: C.ink, fontSize: 39, lineHeight: 1.05, fontWeight: 950, marginTop: 10 }}>BATS logon rejected</div>
        <div style={{ color: C.text, fontSize: 18, fontWeight: 760, marginTop: 7 }}>Sequence mismatch blocks BATS flow while IEX remains available as fallback.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {['BATS', 'Orders', 'Mode', 'Control'].map((label) => <Metric key={label} label={label} phase={phase} />)}
      </div>
    </div>
  );
}

function Workbook({ phase, frame }: { phase: Phase; frame: number }) {
  const lf = localFrame(frame, phase);
  const gateCopy = phase === 'approve'
    ? 'Approve all 5 steps'
    : phase === 'open' || phase === 'start' || phase === 'select' || phase === 'read' || phase === 'launch' || phase === 'inspect' || phase === 'plan'
      ? 'Execution remains locked until approval'
      : 'Workbook approved. Agent Run is bounded.';
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', minHeight: 450, opacity: fade(lf, 4) }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: C.ink, fontSize: 15, fontWeight: 950 }}>Recovery Workbook</div>
        <div style={{ color: phase === 'approve' || phase === 'run' || phase === 'trace' || phase === 'inject' || phase === 'pause' || phase === 'recover' || phase === 'verify' || phase === 'close' ? C.green : C.muted, fontSize: 12, fontWeight: 950 }}>
          {phase === 'approve' ? 'ready for approval' : phase === 'run' || phase === 'trace' || phase === 'inject' || phase === 'pause' || phase === 'recover' || phase === 'verify' || phase === 'close' ? 'approved' : 'agent generated'}
        </div>
      </div>
      {workbook.map((step, index) => {
        const status = stepStatus(index, phase);
        const color = statusColor(status);
        return (
          <div key={step.tool} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 72px', gap: 10, alignItems: 'center', padding: '15px 16px', borderBottom: `1px solid ${C.line}`, background: status === 'done' ? '#087a550d' : status === 'next' ? '#0086a812' : C.panel }}>
            <div style={{ height: 26, width: 26, borderRadius: 13, color, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 950 }}>{index + 1}</div>
            <div>
              <div style={{ color: C.ink, fontSize: 15, fontWeight: 950 }}>{step.label}</div>
              <div style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, marginTop: 3 }}>{step.tool}</div>
            </div>
            <div style={{ color, background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 6, padding: '5px 6px', textAlign: 'center', fontSize: 10, fontWeight: 950, textTransform: 'uppercase' }}>{status}</div>
          </div>
        );
      })}
      <div style={{ padding: 16 }}>
        <div style={{ border: `1px solid ${phase === 'approve' ? C.green : C.line}`, borderRadius: 8, padding: 14, background: phase === 'approve' ? '#087a550c' : C.raised }}>
          <div style={{ color: phase === 'approve' ? C.green : C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>Human gate</div>
          <div style={{ color: C.ink, fontSize: 17, fontWeight: 950, marginTop: 6 }}>{gateCopy}</div>
        </div>
      </div>
    </div>
  );
}

function AgentPanel({ phase, frame }: { phase: Phase; frame: number }) {
  const lf = localFrame(frame, phase);
  const script = scenarioScript[phase];
  const evidence = activeEvidence(phase);
  return (
    <div style={{ background: C.navy, borderRadius: 8, padding: 18, color: '#e2e8f0', minHeight: 450, opacity: fade(lf, 8), transform: `translateY(${slide(lf, 6, 12)}px)` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#67e8f9', fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Agent conversation</div>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 850, marginTop: 4 }}>bounded by MCP tools</div>
        </div>
        <div style={{ background: phase === 'run' || phase === 'recover' ? '#087a55' : '#1e293b', border: '1px solid #334155', color: '#fff', borderRadius: 6, padding: '8px 10px', fontSize: 12, fontWeight: 950 }}>
          {phase === 'run' || phase === 'recover' ? 'running' : phase === 'verify' || phase === 'close' ? 'complete' : 'advising'}
        </div>
      </div>
      <div style={{ marginTop: 18, background: '#172033', border: '1px solid #334155', borderRadius: 8, padding: 15 }}>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>Operator</div>
        <div style={{ color: '#fff', fontSize: 19, lineHeight: 1.25, fontWeight: 900, marginTop: 6 }}>{script.operator}</div>
      </div>
      <div style={{ marginTop: 12, background: '#0b1220', border: '1px solid #334155', borderRadius: 8, padding: 15 }}>
        <div style={{ color: '#67e8f9', fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>Agent response</div>
        <div style={{ color: '#e2e8f0', fontSize: 19, lineHeight: 1.25, fontWeight: 900, marginTop: 6 }}>{script.agent}</div>
      </div>
      <div style={{ marginTop: 14, border: '1px solid #334155', borderRadius: 8, padding: 14 }}>
        <div style={{ color: '#67e8f9', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 950 }}>{phase === 'open' ? 'mcp://fix-mcp-server' : evidence.tool}</div>
        <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.32, fontWeight: 820, marginTop: 7 }}>{phase === 'open' ? 'Tools are scoped to simulated FIX sessions, orders, reference data, injection, scoring, and trace.' : evidence.summary}</div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.35, fontWeight: 760, marginTop: 8 }}>{script.proof}</div>
      </div>
    </div>
  );
}

function EvidenceTrace({ phase, frame }: { phase: Phase; frame: number }) {
  const rows = toolRows(phase);
  const lf = localFrame(frame, phase);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', opacity: fade(lf, 12) }}>
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 88px', padding: '11px 15px', background: '#e9eef3', color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>
        <div>MCP call</div>
        <div>Captured result</div>
        <div>Status</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 18, color: C.muted, fontSize: 15, fontWeight: 850 }}>Trace starts when the first scenario tool runs.</div>
      ) : rows.slice(-6).map((row, index) => (
        <div key={`${row.tool}-${index}-${row.summary}`} style={{ display: 'grid', gridTemplateColumns: '210px 1fr 88px', gap: 12, alignItems: 'center', padding: '10px 15px', borderTop: `1px solid ${C.line}`, opacity: phase === 'close' ? 1 : fade(lf, index * 8) }}>
          <div style={{ color: C.blue, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 950 }}>{row.tool}</div>
          <div style={{ color: C.text, fontSize: 14, fontWeight: 780, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.summary}</div>
          <div style={{ color: row.tool === 'inject_event' && phase === 'inject' ? C.amber : C.green, fontSize: 12, fontWeight: 950 }}>{row.tool === 'inject_event' && phase === 'inject' ? 'PAUSE' : 'PASS'}</div>
        </div>
      ))}
    </div>
  );
}

function DecisionPanel({ phase, frame }: { phase: Phase; frame: number }) {
  const show = phase === 'approve' || phase === 'inject' || phase === 'pause';
  const lf = localFrame(frame, phase);
  const copy = phase === 'approve'
    ? ['Human approval gate', 'Approve the workbook', 'The agent cannot execute recovery until the operator approves the full plan.']
    : phase === 'pause'
      ? ['Pause and re-triage', 'Do not continue blindly', 'The injected state change must be inspected before the agent resumes recovery.']
      : ['Pressure injection', 'Sequence gap injected', 'The simulation pauses. The agent must re-check state before continuing.'];
  return (
    <div style={{ opacity: show ? fade(lf, 10) : 0, position: 'absolute', right: 70, top: 290, width: 500, background: C.panel, border: `2px solid ${phase === 'inject' || phase === 'pause' ? C.amber : C.green}`, borderRadius: 9, padding: 22, boxShadow: '0 24px 70px #0f172a33' }}>
      <div style={{ color: phase === 'inject' || phase === 'pause' ? C.amber : C.green, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{copy[0]}</div>
      <div style={{ color: C.ink, fontSize: 31, lineHeight: 1.08, fontWeight: 950, marginTop: 8 }}>{copy[1]}</div>
      <div style={{ color: C.text, fontSize: 16, lineHeight: 1.35, fontWeight: 760, marginTop: 10 }}>{copy[2]}</div>
      {phase === 'approve' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          <div style={{ background: C.green, color: '#fff', borderRadius: 6, padding: '12px 14px', textAlign: 'center', fontSize: 16, fontWeight: 950 }}>Approve all</div>
          <div style={{ border: `1px solid ${C.line}`, color: C.ink, borderRadius: 6, padding: '12px 14px', textAlign: 'center', fontSize: 16, fontWeight: 950 }}>Hold</div>
        </div>
      )}
    </div>
  );
}

function Progress({ phase, frame }: { phase: Phase; frame: number }) {
  const progress = interpolate(frame, [0, 4499], [2, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const labels: Phase[] = ['start', 'select', 'launch', 'approve', 'run', 'trace', 'inject', 'recover', 'verify', 'close'];
  return (
    <div style={{ position: 'absolute', left: 30, right: 30, bottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 11, fontWeight: 950, marginBottom: 7 }}>
        {labels.map((label) => (
          <div key={label} style={{ color: phase === label ? C.blue : C.muted, textTransform: 'uppercase' }}>{label}</div>
        ))}
      </div>
      <div style={{ height: 7, borderRadius: 20, background: '#d6e0ea', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: phase === 'inject' ? C.amber : phase === 'close' ? C.green : C.blue }} />
      </div>
    </div>
  );
}

function Cursor({ phase, frame }: { phase: Phase; frame: number }) {
  const positions: Record<Phase, [number, number]> = {
    open: [1470, 32],
    start: [425, 35],
    select: [1540, 32],
    read: [1275, 160],
    launch: [1660, 360],
    inspect: [760, 610],
    plan: [360, 360],
    approve: [1240, 615],
    run: [1810, 32],
    trace: [760, 610],
    inject: [1705, 32],
    pause: [1190, 535],
    recover: [1810, 32],
    verify: [1450, 610],
    close: [1450, 770],
  };
  const [left, top] = positions[phase];
  const pulse = interpolate(Math.sin(frame / 7), [-1, 1], [0.92, 1.12]);
  return (
    <div style={{ position: 'absolute', left, top, transform: `scale(${pulse})`, opacity: phase === 'open' ? 0.65 : 0.92 }}>
      <div style={{ width: 0, height: 0, borderLeft: `16px solid ${C.ink}`, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', transform: 'rotate(38deg)' }} />
      <div style={{ marginLeft: 18, marginTop: -2, height: 11, width: 11, borderRadius: 6, background: C.cyan }} />
    </div>
  );
}

export function ScenarioExecutiveBrief({ story = defaultStory }: { story?: ScenarioStory }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phase = phaseAt(frame);
  const enter = spring({ frame, fps, config: { damping: 170, stiffness: 80, mass: 0.8 } });

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink, fontFamily: 'Inter, Arial, sans-serif', overflow: 'hidden' }}>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 16}px)` }}>
        <TopBar phase={phase} />
        <div style={{ padding: '18px 18px 150px' }}>
          <IncidentHeader phase={phase} frame={frame} />
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '410px 1fr 470px', gap: 14 }}>
            <Workbook phase={phase} frame={frame} />
            <div style={{ display: 'grid', gridTemplateRows: '1fr 248px', gap: 14 }}>
              <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, textTransform: 'uppercase' }}>Scenario board</div>
                    <div style={{ color: C.ink, fontSize: 31, fontWeight: 950, marginTop: 5 }}>{scenarioScript[phase].title}</div>
                  </div>
                  <div style={{ color: C.blue, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 950 }}>{scenarioScript[phase].command}</div>
                </div>
                <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: C.raised, padding: 16 }}>
                    <div style={{ color: C.blue, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Decision</div>
                    <div style={{ color: C.ink, fontSize: 25, lineHeight: 1.1, fontWeight: 950, marginTop: 7 }}>{scenarioScript[phase].decision}</div>
                  </div>
                  <div style={{ border: `1px solid ${phase === 'inject' || phase === 'pause' ? C.amber : C.line}`, borderRadius: 8, background: phase === 'inject' || phase === 'pause' ? '#b45f0610' : C.raised, padding: 16 }}>
                    <div style={{ color: phase === 'inject' || phase === 'pause' ? C.amber : C.green, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>Proof</div>
                    <div style={{ color: C.ink, fontSize: 25, lineHeight: 1.1, fontWeight: 950, marginTop: 7 }}>{scenarioScript[phase].proof}</div>
                  </div>
                </div>
              </div>
              <EvidenceTrace phase={phase} frame={frame} />
            </div>
            <AgentPanel phase={phase} frame={frame} />
          </div>
        </div>
      </div>
      <Hero phase={phase} frame={frame} />
      <DecisionPanel phase={phase} frame={frame} />
      <ScriptStrip phase={phase} frame={frame} />
      <Cursor phase={phase} frame={frame} />
      <Progress phase={phase} frame={frame} />
      <div style={{ display: 'none' }}>{story.title}</div>
    </AbsoluteFill>
  );
}

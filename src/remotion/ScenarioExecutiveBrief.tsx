import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ScenarioStory, defaultStory } from './scenarioStories';

const COLORS = {
  ink: '#111827',
  text: '#334155',
  muted: '#64748b',
  line: '#d8dee6',
  panel: '#ffffff',
  page: '#f4f6f8',
  cyan: '#006f8f',
  green: '#047857',
  amber: '#b45309',
  red: '#b91c1c',
  navy: '#0f172a',
  slate: '#475569',
};

const toneColor = {
  neutral: COLORS.slate,
  good: COLORS.green,
  warn: COLORS.amber,
  bad: COLORS.red,
};

function fade(frame: number, start: number, duration = 18) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function useLocalFrame() {
  return useCurrentFrame();
}

function stepIn(frame: number, index: number) {
  return fade(frame, 8 + index * 10, 16);
}

function Shell({
  children,
  kicker,
  title,
  section,
}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
  section: string;
}) {
  return (
    <AbsoluteFill style={{ background: COLORS.page, color: COLORS.ink, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ display: 'flex', height: '100%', flexDirection: 'column', padding: '46px 56px 42px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ color: COLORS.cyan, fontSize: 18, fontWeight: 900, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              {kicker}
            </div>
            <div style={{ fontSize: 48, lineHeight: 1.04, fontWeight: 950, letterSpacing: 0, marginTop: 8 }}>
              {title}
            </div>
          </div>
          <div style={{ minWidth: 230, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: '12px 16px', background: COLORS.panel }}>
            <div style={{ color: COLORS.muted, fontSize: 13, fontWeight: 800, textTransform: 'uppercase' }}>FIX-MCP Demo</div>
            <div style={{ color: COLORS.ink, fontSize: 20, fontWeight: 950, marginTop: 3 }}>{section}</div>
          </div>
        </div>
        {children}
      </div>
    </AbsoluteFill>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: keyof typeof toneColor }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 18, minHeight: 138 }}>
      <div style={{ color: COLORS.muted, fontSize: 14, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: toneColor[tone], fontSize: 31, lineHeight: 1.05, fontWeight: 950, marginTop: 10 }}>{value}</div>
    </div>
  );
}

function StagePill({ label, active, done }: { label: string; active?: boolean; done?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${active ? COLORS.cyan : done ? COLORS.green : COLORS.line}`,
        background: active ? '#006f8f18' : done ? '#04785712' : COLORS.panel,
        color: active ? COLORS.cyan : done ? COLORS.green : COLORS.text,
        borderRadius: 8,
        padding: '12px 14px',
        fontSize: 16,
        fontWeight: 900,
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  );
}

function getRunbook(story: ScenarioStory) {
  const base = [
    { title: 'Brief the room', body: story.situation, tool: 'scenario_context' },
    { title: 'Check the primary blocker', body: story.mcpEvidence, tool: 'MCP tools + Trace' },
    { title: 'Quantify affected flow', body: story.systemImpact, tool: 'query_orders / validate_orders' },
    { title: 'Approve workbook', body: story.humanDecision, tool: 'human approval gate' },
  ];

  if (story.category.toLowerCase().includes('algo')) {
    base.splice(2, 0, {
      title: 'Inspect algo health',
      body: 'Compare schedule progress, venue quality, and execution drift before recommending action.',
      tool: 'check_algo_status',
    });
  }

  if (story.category.toLowerCase().includes('reference')) {
    base.splice(3, 0, {
      title: 'Validate reference data',
      body: 'Confirm symbol, corporate action, or listing data before order release.',
      tool: 'validate_orders',
    });
  }

  return base.slice(0, 5);
}

function Opening({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 180, stiffness: 110 } });
  return (
    <Shell kicker={`${story.time} / ${story.category}`} title={story.title} section="Executive Setup">
      <div style={{ opacity: fade(frame, 0), transform: `translateY(${(1 - scale) * 30}px)` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.65fr', gap: 22 }}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 30, minHeight: 450 }}>
            <div style={{ color: story.severity === 'critical' ? COLORS.red : story.severity === 'high' ? COLORS.amber : COLORS.cyan, fontWeight: 950, textTransform: 'uppercase', fontSize: 18 }}>
              {story.severity} incident
            </div>
            <div style={{ marginTop: 18, fontSize: 42, lineHeight: 1.12, fontWeight: 950 }}>{story.executiveAngle}</div>
            <div style={{ marginTop: 28, color: COLORS.text, fontSize: 27, lineHeight: 1.35, fontWeight: 700 }}>{story.situation}</div>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {story.metrics.map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function DeskMap({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  const pulse = interpolate(Math.sin(frame / 8), [-1, 1], [0.4, 1]);
  const badColor = story.severity === 'critical' ? COLORS.red : COLORS.amber;
  const nodes = [
    { label: 'Operator', x: 80, y: 164, color: COLORS.cyan, sub: 'human decision owner' },
    { label: 'LLM Copilot', x: 360, y: 164, color: COLORS.slate, sub: 'summarize + propose' },
    { label: 'MCP Tools', x: 650, y: 164, color: COLORS.green, sub: 'bounded actions' },
    { label: 'FIX / OMS', x: 980, y: 82, color: badColor, sub: 'incident surface' },
    { label: 'Trace Evidence', x: 980, y: 270, color: COLORS.navy, sub: 'audit trail' },
  ];
  return (
    <Shell kicker="Live Desk Model" title="The User Sees What Changes" section="System Walkthrough">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 22 }}>
        <div style={{ position: 'relative', height: 560, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, overflow: 'hidden' }}>
          <svg width="100%" height="100%" viewBox="0 0 1240 560" style={{ position: 'absolute', inset: 0 }}>
            <line x1="250" y1="208" x2="360" y2="208" stroke="#94a3b8" strokeWidth="5" />
            <line x1="530" y1="208" x2="650" y2="208" stroke="#94a3b8" strokeWidth="5" />
            <line x1="830" y1="200" x2="980" y2="130" stroke="#94a3b8" strokeWidth="5" />
            <line x1="830" y1="220" x2="980" y2="315" stroke="#94a3b8" strokeWidth="5" />
          </svg>
          {nodes.map((node, index) => (
            <div
              key={node.label}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: 200,
                height: 112,
                opacity: stepIn(frame, index),
                borderRadius: 8,
                border: `3px solid ${node.color}`,
                background: '#f9fafb',
                padding: 16,
                boxShadow: node.label === 'FIX / OMS' ? `0 0 ${28 * pulse}px ${node.color}55` : 'none',
              }}
            >
              <div style={{ color: node.color, fontSize: 24, fontWeight: 950 }}>{node.label}</div>
              <div style={{ color: COLORS.muted, fontSize: 14, fontWeight: 800, marginTop: 8 }}>{node.sub}</div>
            </div>
          ))}
          <div style={{ position: 'absolute', left: 42, right: 42, bottom: 34, color: COLORS.text, fontSize: 27, lineHeight: 1.3, fontWeight: 800 }}>
            {story.systemImpact}
          </div>
        </div>
        <div style={{ background: COLORS.navy, borderRadius: 8, padding: 24, color: '#e2e8f0' }}>
          <div style={{ color: '#67e8f9', fontSize: 18, fontWeight: 950, textTransform: 'uppercase' }}>What makes this a demo</div>
          {['Scenario is visible', 'MCP calls are bounded', 'Human approval is explicit', 'Trace proves every action'].map((line, i) => (
            <div key={line} style={{ opacity: stepIn(frame, i + 1), marginTop: 24, borderTop: '1px solid #334155', paddingTop: 18 }}>
              <div style={{ fontSize: 28, fontWeight: 950 }}>{line}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function RunbookWalkthrough({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  const steps = getRunbook(story);
  const active = Math.min(steps.length - 1, Math.floor(frame / 38));
  return (
    <Shell kicker="Workbook Walkthrough" title="How The Operator Drives The Scenario" section="Runbook">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 22 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {steps.map((step, index) => (
            <div
              key={step.title}
              style={{
                opacity: stepIn(frame, index),
                display: 'grid',
                gridTemplateColumns: '72px 1fr 260px',
                gap: 18,
                alignItems: 'center',
                background: COLORS.panel,
                border: `2px solid ${active === index ? COLORS.cyan : index < active ? COLORS.green : COLORS.line}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ color: active === index ? COLORS.cyan : index < active ? COLORS.green : COLORS.muted, fontSize: 34, fontWeight: 950 }}>
                {String(index + 1).padStart(2, '0')}
              </div>
              <div>
                <div style={{ fontSize: 25, fontWeight: 950 }}>{step.title}</div>
                <div style={{ color: COLORS.text, fontSize: 17, lineHeight: 1.32, fontWeight: 700, marginTop: 5 }}>{step.body}</div>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', color: COLORS.cyan, fontSize: 15, fontWeight: 900, textAlign: 'right' }}>{step.tool}</div>
            </div>
          ))}
        </div>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 22 }}>
          <div style={{ color: COLORS.muted, fontSize: 14, fontWeight: 950, textTransform: 'uppercase' }}>Operator Controls</div>
          <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
            <StagePill label="Investigator" done={active > 0} active={active === 0} />
            <StagePill label="Approve Workbook" done={active > 2} active={active === 2 || active === 3} />
            <StagePill label="Agent Run" active={active >= 4} />
          </div>
          <div style={{ marginTop: 28, color: COLORS.text, fontSize: 24, lineHeight: 1.35, fontWeight: 800 }}>
            The demo walks the audience through what the human approves and what the agent is allowed to execute.
          </div>
        </div>
      </div>
    </Shell>
  );
}

function InjectionBranch({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  const changed = frame > 68;
  return (
    <Shell kicker="Stress Injection" title="Then We Change The System On Purpose" section="Injector">
      <div style={{ display: 'grid', gridTemplateColumns: '0.95fr 1.05fr', gap: 22 }}>
        <div style={{ background: COLORS.navy, borderRadius: 8, padding: 28, color: '#e2e8f0' }}>
          <div style={{ color: '#fbbf24', fontSize: 18, fontWeight: 950, textTransform: 'uppercase' }}>Injected Event</div>
          <div style={{ marginTop: 18, fontSize: 39, lineHeight: 1.12, fontWeight: 950 }}>{story.injector}</div>
          <div style={{ marginTop: 32, display: 'grid', gap: 12 }}>
            <StagePill label="Baseline understood" done />
            <StagePill label="Inject pressure" active={!changed} />
            <StagePill label="Re-triage before action" active={changed} />
          </div>
        </div>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 26 }}>
          <div style={{ color: COLORS.muted, fontSize: 14, fontWeight: 950, textTransform: 'uppercase' }}>What The Viewer Sees</div>
          <div style={{ marginTop: 22, display: 'grid', gap: 16 }}>
            {[
              ['Before injection', 'The workbook is valid for the verified baseline incident.'],
              ['State changes', 'A controlled event adds new pressure to sessions, orders, or market structure.'],
              ['Agent behavior', 'The agent must re-check scope instead of blindly continuing.'],
              ['Human role', 'The operator chooses whether to continue, revise, or stop.'],
            ].map(([label, body], index) => (
              <div key={label} style={{ opacity: stepIn(frame, index), borderLeft: `5px solid ${index === 1 && changed ? COLORS.red : COLORS.cyan}`, paddingLeft: 16 }}>
                <div style={{ fontSize: 25, fontWeight: 950 }}>{label}</div>
                <div style={{ color: COLORS.text, fontSize: 20, lineHeight: 1.35, fontWeight: 700, marginTop: 4 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function AgentRunEvidence({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  const rows = [
    ['check_fix_sessions', 'session state confirmed', 'PASS'],
    ['query_orders', 'affected flow quantified', 'PASS'],
    ['validate_orders', 'release blockers checked', 'PASS'],
    ['inject_event', 'stress state recorded', 'RE-TRIAGE'],
    ['score_scenario', 'workbook evidence complete', 'DONE'],
  ];
  return (
    <Shell kicker="Agent Run + Evidence" title="The Agent Works, The Human Watches" section="Proof">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 22 }}>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr 160px', background: '#eef2f5', padding: '14px 18px', color: COLORS.muted, fontSize: 14, fontWeight: 950, textTransform: 'uppercase' }}>
            <div>MCP Tool</div>
            <div>Evidence</div>
            <div>Status</div>
          </div>
          {rows.map(([tool, evidence, status], index) => (
            <div key={tool} style={{ opacity: stepIn(frame, index), display: 'grid', gridTemplateColumns: '270px 1fr 160px', padding: '18px', borderTop: `1px solid ${COLORS.line}`, alignItems: 'center' }}>
              <div style={{ color: COLORS.cyan, fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 950 }}>{tool}</div>
              <div style={{ color: COLORS.text, fontSize: 20, fontWeight: 750 }}>{evidence}</div>
              <div style={{ color: status === 'RE-TRIAGE' ? COLORS.amber : COLORS.green, fontSize: 18, fontWeight: 950 }}>{status}</div>
            </div>
          ))}
        </div>
        <div style={{ background: COLORS.navy, borderRadius: 8, padding: 26, color: '#e2e8f0' }}>
          <div style={{ color: '#86efac', fontSize: 18, fontWeight: 950, textTransform: 'uppercase' }}>Agent Run Boundary</div>
          <div style={{ fontSize: 34, lineHeight: 1.18, fontWeight: 950, marginTop: 20 }}>{story.agentRun}</div>
          <div style={{ fontSize: 22, lineHeight: 1.35, color: '#cbd5e1', marginTop: 28, fontWeight: 750 }}>
            The agent never claims production authority. It executes simulated MCP tools and produces auditable evidence.
          </div>
        </div>
      </div>
    </Shell>
  );
}

function ExecutiveClose({ story, start }: { story: ScenarioStory; start: number }) {
  const frame = useLocalFrame();
  return (
    <Shell kicker="Close The Room" title="What This Proves" section="Executive Close">
      <div style={{ opacity: fade(frame, 0), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 34 }}>
          <div style={{ color: COLORS.green, fontWeight: 950, textTransform: 'uppercase', fontSize: 18 }}>Outcome</div>
          <div style={{ color: COLORS.ink, fontSize: 43, lineHeight: 1.12, fontWeight: 950, marginTop: 16 }}>{story.outcome}</div>
        </div>
        <div style={{ background: COLORS.navy, borderRadius: 8, padding: 34, color: '#e2e8f0' }}>
          <div style={{ color: '#67e8f9', fontWeight: 950, textTransform: 'uppercase', fontSize: 18 }}>Demo Path</div>
          {['Load scenario', 'Run Investigator', 'Approve workbook', 'Inject pressure', 'Run agent under supervision', 'Show trace + FIX evidence'].map((item, index) => (
            <div key={item} style={{ opacity: stepIn(frame, index), display: 'flex', gap: 14, alignItems: 'center', marginTop: 18 }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: '#047857', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 950 }}>{index + 1}</div>
              <div style={{ fontSize: 25, fontWeight: 900 }}>{item}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function ScenarioExecutiveBrief({ story = defaultStory }: { story?: ScenarioStory }) {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <Opening story={story} start={0} />
      </Sequence>
      <Sequence from={150} durationInFrames={150}>
        <DeskMap story={story} start={150} />
      </Sequence>
      <Sequence from={300} durationInFrames={180}>
        <RunbookWalkthrough story={story} start={300} />
      </Sequence>
      <Sequence from={480} durationInFrames={150}>
        <InjectionBranch story={story} start={480} />
      </Sequence>
      <Sequence from={630} durationInFrames={150}>
        <AgentRunEvidence story={story} start={630} />
      </Sequence>
      <Sequence from={780} durationInFrames={120}>
        <ExecutiveClose story={story} start={780} />
      </Sequence>
    </AbsoluteFill>
  );
}

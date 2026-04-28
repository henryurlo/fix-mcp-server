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

const toneColor = {
  neutral: '#334155',
  good: '#047857',
  warn: '#b45309',
  bad: '#b91c1c',
};

function fade(frame: number, start: number, duration = 18) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

function SlideShell({ children, kicker, title }: { children: React.ReactNode; kicker: string; title: string }) {
  return (
    <AbsoluteFill style={{ background: '#f4f6f8', color: '#111827', fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ display: 'flex', height: '100%', flexDirection: 'column', padding: 56 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 }}>
          <div>
            <div style={{ color: '#006f8f', fontSize: 20, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {kicker}
            </div>
            <div style={{ fontSize: 54, lineHeight: 1.05, fontWeight: 900, letterSpacing: 0, marginTop: 8 }}>
              {title}
            </div>
          </div>
          <div style={{ border: '1px solid #c1c9d3', borderRadius: 8, padding: '12px 16px', textAlign: 'right', background: '#fff' }}>
            <div style={{ fontSize: 15, color: '#64748b', fontWeight: 700 }}>FIX-MCP</div>
            <div style={{ fontSize: 20, color: '#111827', fontWeight: 900 }}>Executive Brief</div>
          </div>
        </div>
        {children}
      </div>
    </AbsoluteFill>
  );
}

function MetricStrip({ story }: { story: ScenarioStory }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {story.metrics.map((metric) => (
        <div key={metric.label} style={{ background: '#fff', border: '1px solid #d8dee6', borderRadius: 8, padding: 18 }}>
          <div style={{ color: '#64748b', fontSize: 14, fontWeight: 800, textTransform: 'uppercase' }}>{metric.label}</div>
          <div style={{ color: toneColor[metric.tone], fontSize: 32, fontWeight: 900, marginTop: 8 }}>{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

function SystemMap({ story }: { story: ScenarioStory }) {
  const frame = useCurrentFrame();
  const pulse = interpolate(Math.sin(frame / 8), [-1, 1], [0.35, 1]);
  const nodes = [
    { label: 'Trading Desk', x: 90, y: 160, color: '#006f8f' },
    { label: 'MCP Tools', x: 420, y: 160, color: '#047857' },
    { label: 'FIX Sessions', x: 760, y: 90, color: story.severity === 'critical' ? '#b91c1c' : '#b45309' },
    { label: 'OMS / Orders', x: 760, y: 245, color: '#334155' },
  ];

  return (
    <div style={{ position: 'relative', height: 380, border: '1px solid #d8dee6', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      <svg width="100%" height="100%" viewBox="0 0 1040 380" style={{ position: 'absolute', inset: 0 }}>
        <line x1="210" y1="180" x2="420" y2="180" stroke="#8a97a8" strokeWidth="4" />
        <line x1="560" y1="170" x2="760" y2="120" stroke="#8a97a8" strokeWidth="4" />
        <line x1="560" y1="190" x2="760" y2="270" stroke="#8a97a8" strokeWidth="4" />
      </svg>
      {nodes.map((node) => (
        <div
          key={node.label}
          style={{
            position: 'absolute',
            left: node.x,
            top: node.y,
            width: 180,
            height: 86,
            borderRadius: 8,
            border: `3px solid ${node.color}`,
            background: '#f9fafb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            color: node.color,
            fontSize: 23,
            boxShadow: node.label === 'FIX Sessions' ? `0 0 ${22 * pulse}px ${node.color}44` : 'none',
          }}
        >
          {node.label}
        </div>
      ))}
      <div style={{ position: 'absolute', left: 42, bottom: 34, right: 42, color: '#334155', fontSize: 25, lineHeight: 1.35, fontWeight: 700 }}>
        {story.systemImpact}
      </div>
    </div>
  );
}

function EvidenceTimeline({ story }: { story: ScenarioStory }) {
  const items = [
    ['Investigate', story.mcpEvidence],
    ['Approve Workbook', story.humanDecision],
    ['Inject Stress', story.injector],
    ['Agent Run', story.agentRun],
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {items.map(([label, body], index) => (
        <div key={label} style={{ background: '#fff', border: '1px solid #d8dee6', borderRadius: 8, padding: 18, minHeight: 250 }}>
          <div style={{ width: 34, height: 34, borderRadius: 17, background: '#006f8f18', color: '#006f8f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, marginBottom: 16 }}>
            {index + 1}
          </div>
          <div style={{ fontSize: 25, fontWeight: 900, marginBottom: 12 }}>{label}</div>
          <div style={{ fontSize: 19, lineHeight: 1.35, color: '#334155', fontWeight: 650 }}>{body}</div>
        </div>
      ))}
    </div>
  );
}

export function ScenarioExecutiveBrief({ story = defaultStory }: { story?: ScenarioStory }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleScale = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const introOpacity = fade(frame, 0);

  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <SlideShell kicker={`${story.time} / ${story.category}`} title={story.title}>
          <div style={{ opacity: introOpacity, transform: `scale(${0.96 + titleScale * 0.04})` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24 }}>
              <div style={{ background: '#fff', border: '1px solid #d8dee6', borderRadius: 8, padding: 28 }}>
                <div style={{ color: toneColor[story.severity === 'medium' ? 'warn' : 'bad'], fontWeight: 900, textTransform: 'uppercase', fontSize: 18 }}>{story.severity}</div>
                <div style={{ fontSize: 36, lineHeight: 1.18, fontWeight: 900, marginTop: 12 }}>{story.executiveAngle}</div>
                <div style={{ fontSize: 25, lineHeight: 1.35, color: '#334155', marginTop: 26, fontWeight: 650 }}>{story.situation}</div>
              </div>
              <MetricStrip story={story} />
            </div>
          </div>
        </SlideShell>
      </Sequence>

      <Sequence from={150} durationInFrames={150}>
        <SlideShell kicker="System View" title="What Changes On The Desk">
          <SystemMap story={story} />
        </SlideShell>
      </Sequence>

      <Sequence from={300} durationInFrames={180}>
        <SlideShell kicker="MCP + Human Workflow" title="How The Incident Is Controlled">
          <EvidenceTimeline story={story} />
        </SlideShell>
      </Sequence>

      <Sequence from={480} durationInFrames={120}>
        <SlideShell kicker="Executive Close" title="Visible Outcome">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div style={{ background: '#fff', border: '1px solid #d8dee6', borderRadius: 8, padding: 32 }}>
              <div style={{ color: '#047857', fontWeight: 900, textTransform: 'uppercase', fontSize: 18 }}>Resolved Story</div>
              <div style={{ color: '#111827', fontSize: 40, lineHeight: 1.15, fontWeight: 900, marginTop: 14 }}>{story.outcome}</div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: 8, padding: 32, color: '#e2e8f0' }}>
              <div style={{ color: '#67e8f9', fontWeight: 900, textTransform: 'uppercase', fontSize: 18 }}>What The Audience Sees</div>
              <div style={{ fontSize: 28, lineHeight: 1.45, fontWeight: 800, marginTop: 22 }}>
                Incident pressure, MCP evidence, human approval, injected stress, and an agent run that stays inside the approved workbook.
              </div>
            </div>
          </div>
        </SlideShell>
      </Sequence>
    </AbsoluteFill>
  );
}

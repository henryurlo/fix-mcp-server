'use client';

import React, { useMemo, useEffect, useState } from 'react';
import ReactFlow, {
  Handle,
  Position,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useSystem, SessionInfo } from '@/store';
import { Radio } from 'lucide-react';

// ── Status color map ───────────────────────────────────────────────

const STATUS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  active:   { bg: '#0a1a12', border: '#00ff88', text: '#00ff88', glow: '0 0 10px #00ff8830' },
  healthy:  { bg: '#0a1a12', border: '#00ff88', text: '#00ff88', glow: '0 0 10px #00ff8830' },
  degraded: { bg: '#1a1508', border: '#f59e0b', text: '#f59e0b', glow: '0 0 12px #f59e0b30' },
  down:     { bg: '#1a0a0a', border: '#ff3366', text: '#ff3366', glow: '0 0 14px #ff336640' },
  unknown:  { bg: '#10131f', border: '#252c4a', text: '#555d7a', glow: 'none' },
  idle:     { bg: '#10131f', border: '#252c4a', text: '#555d7a', glow: 'none' },
};

type StatusKey = keyof typeof STATUS;

// ── Custom Node Components ─────────────────────────────────────────

function ExchangeNode({ data }: { data: any }) {
  const sc = STATUS[data.status as StatusKey] || STATUS.idle;
  return (
    <div style={{
      minWidth: 120,
      padding: '10px 14px',
      background: `linear-gradient(135deg, ${sc.bg}, #10131f)`,
      border: `1.5px solid ${sc.border}`,
      borderRadius: 10,
      textAlign: 'center',
      boxShadow: sc.glow,
    }}>
      <Handle type="source" position={Position.Bottom} id="source" style={{ width: 6, height: 6, background: sc.border, border: 'none' }} />
      <div style={{ fontSize: 8, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>EXCHANGE</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: sc.text, letterSpacing: '0.04em' }}>{data.label}</div>
      <div style={{ fontSize: 9, color: '#8b92b0', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>{data.sub}</div>
      {data.latency_ms != null && (
        <div style={{ fontSize: 9, color: data.latency_ms > 100 ? '#ff3366' : data.latency_ms > 20 ? '#f59e0b' : '#555d7a', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          {data.latency_ms.toFixed(1)}ms
        </div>
      )}
    </div>
  );
}

function BrokerNode({ data }: { data: any }) {
  const sc = STATUS[data.status as StatusKey] || STATUS.idle;
  return (
    <div style={{
      padding: '14px 24px',
      background: 'linear-gradient(135deg, #0c1a30, #10131f)',
      border: `2px solid ${sc.border}`,
      borderRadius: 14,
      textAlign: 'center',
      boxShadow: `0 0 20px #3b82f620, 0 0 40px #3b82f610`,
      minWidth: 180,
    }}>
      <Handle type="target" position={Position.Top} id="target-top" style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>{data.sub}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#3b82f6', letterSpacing: '0.03em' }}>{data.label}</div>
      <Handle type="source" position={Position.Right} id="source-right" style={{ width: 6, height: 6, background: '#00d4ff', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="source-bottom" style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
      <Handle type="source" position={Position.Left} id="source-left" style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
    </div>
  );
}

function InfraNode({ data }: { data: any }) {
  return (
    <div style={{
      padding: '8px 14px',
      background: '#10131f',
      border: '1px solid #1a1f35',
      borderRadius: 8,
      textAlign: 'center',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Top} id="target" style={{ width: 6, height: 6, background: '#1a1f35', border: 'none' }} />
      <div style={{ fontSize: 11, color: '#555d7a' }}>{data.icon || '🗄️'}</div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 2 }}>{data.label}</div>
    </div>
  );
}

function MarketDataNode({ data }: { data: any }) {
  return (
    <div style={{
      minWidth: 130,
      padding: '10px 14px',
      background: `linear-gradient(135deg, #0c1520, #10131f)`,
      border: `1.5px solid #00d4ff`,
      borderRadius: 10,
      textAlign: 'center',
      boxShadow: '0 0 12px #00d4ff20',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} id="target" style={{ width: 6, height: 6, background: '#00d4ff', border: 'none' }} />
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>MARKET DATA</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#00d4ff' }}>{data.label}</div>
      <div style={{ fontSize: 9, color: '#8b92b0', marginTop: 2 }}>{data.sub}</div>
    </div>
  );
}

const nodeTypes = { exchange: ExchangeNode, broker: BrokerNode, infra: InfraNode, marketData: MarketDataNode };

// ── Topology Builder ───────────────────────────────────────────────

function buildTopology(sessions: SessionInfo[], scenario: string | null, active: boolean) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Use actual session venues if available
  const venueIds = sessions.length > 0
    ? sessions.map((s) => ({ id: s.venue.toLowerCase(), label: s.venue }))
    : [
        { id: 'nyse', label: 'NYSE' },
        { id: 'arca', label: 'ARCA' },
        { id: 'bats', label: 'BATS' },
        { id: 'iex', label: 'IEX' },
      ];

  const exchangeY = 40;
  const exchangeXStart = 60;
  const exchangeXGap = Math.min(200, (800 - 120) / Math.max(venueIds.length, 1));

  venueIds.forEach((ex, i) => {
    const session = sessions.find((s) => s.venue === ex.label);
    const status = session?.status || 'idle';
    const statusColor = status === 'active' ? '#00ff88' : status === 'degraded' ? '#f59e0b' : status === 'down' ? '#ff3366' : '#555d7a';

    nodes.push({
      id: `ex-${ex.id}`,
      type: 'exchange',
      position: { x: exchangeXStart + i * exchangeXGap, y: exchangeY },
      data: {
        label: ex.label,
        sub: `FIX 4.2`,
        status,
        latency_ms: (session as any)?.latency_ms,
      },
    });

    edges.push({
      id: `e-${ex.id}-broker`,
      source: `ex-${ex.id}`,
      sourceHandle: 'source',
      target: 'broker',
      targetHandle: 'target-top',
      animated: status !== 'down' && status !== 'idle',
      style: {
        stroke: status === 'down' ? '#ff3366' : status === 'degraded' ? '#f59e0b' : '#252c4a',
        strokeWidth: status === 'down' ? 3 : 1.5,
        strokeDasharray: status === 'down' ? '8 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: status === 'down' ? '#ff3366' : '#3a4470' },
    });
  });

  // ── Broker Host (center) ──
  const centerX = exchangeXStart + (venueIds.length - 1) * exchangeXGap / 2;
  const brokerY = 220;

  nodes.push({
    id: 'broker',
    type: 'broker',
    position: { x: centerX - 90, y: brokerY },
    data: {
      label: 'BROKER-SIM',
      sub: active ? `● ${scenario}` : 'FIX Acceptor · OMS · SOR',
      status: sessions.some((s) => s.status === 'down') ? 'degraded' : 'healthy',
    },
  });

  // ── Market Data Hub (right of broker) ──
  nodes.push({
    id: 'market-data',
    type: 'marketData',
    position: { x: centerX + 180, y: brokerY - 10 },
    data: { label: 'MD Hub', sub: 'Price + FX Feeds' },
  });

  edges.push({
    id: 'e-broker-md',
    source: 'broker',
    sourceHandle: 'source-right',
    target: 'market-data',
    targetHandle: 'target',
    animated: true,
    style: { stroke: '#00d4ff40', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#00d4ff50' },
  });

  // ── Client sessions at bottom ──
  const clientY = 400;
  const clientXStart = centerX - 200;
  const clientXGap = 160;
  const clientLabels = ['INSTITUTIONAL', 'HEDGE_FUND', 'RETAIL', 'PROP_DESK'];

  clientLabels.forEach((cl, i) => {
    nodes.push({
      id: `cl-${i}`,
      type: 'infra',
      position: { x: clientXStart + i * clientXGap, y: clientY },
      data: { label: cl, icon: '🏛️' },
    });

    edges.push({
      id: `e-broker-cl-${i}`,
      source: 'broker',
      sourceHandle: 'source-bottom',
      target: `cl-${i}`,
      targetHandle: 'target',
      animated: true,
      style: { stroke: '#252c4a', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#3a4470' },
    });
  });

  // ── Infrastructure (far right bottom) ──
  nodes.push({
    id: 'postgres',
    type: 'infra',
    position: { x: centerX + 240, y: clientY - 30 },
    data: { label: 'PostgreSQL', icon: '🐘' },
  });

  nodes.push({
    id: 'redis',
    type: 'infra',
    position: { x: centerX + 240, y: clientY + 30 },
    data: { label: 'Redis', icon: '⚡' },
  });

  edges.push({
    id: 'e-broker-pg',
    source: 'broker',
    sourceHandle: 'source-right',
    target: 'postgres',
    targetHandle: 'target',
    style: { stroke: '#1a1f35', strokeWidth: 1.5 },
  });

  edges.push({
    id: 'e-broker-redis',
    source: 'broker',
    sourceHandle: 'source-right',
    target: 'redis',
    targetHandle: 'target',
    style: { stroke: '#1a1f35', strokeWidth: 1.5 },
  });

  return { nodes, edges };
}

// ── Main Component ─────────────────────────────────────────────────

export default function TopologyGraph() {
  const { sessions, scenario, refresh, connected } = useSystem();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => { setTick((t) => t + 1); refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const { nodes, edges } = useMemo(() => buildTopology(sessions, scenario, !!scenario), [sessions, scenario, tick]);

  const downCount = sessions.filter((s) => s.status === 'down').length;
  const degradedCount = sessions.filter((s) => s.status === 'degraded').length;
  const healthyCount = sessions.filter((s) => s.status === 'active').length;

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.35, maxZoom: 1.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1f35" gap={30} size={1} />
        <Controls showInteractive={false} />

        <Panel position="top-left">
          <div className="glass-panel px-3 py-2">
            <div className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">System Topology</div>
            <div className="text-[8px] text-[var(--text-dim)] font-mono mt-0.5">
              {scenario ? <span className="text-[var(--cyan)]">● {scenario}</span> : 'Standby'} • {sessions.length} engines
            </div>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="glass-panel px-2 py-1.5 flex items-center gap-2">
            <Legend color="#00ff88" label={`${healthyCount} OK`} />
            <Legend color="#f59e0b" label={`${degradedCount} WARN`} />
            <Legend color="#ff3366" label={`${downCount} DOWN`} />
            <Legend color="#3b82f6" label="Broker" />
            <Legend color="#00d4ff" label="Market Data" />
            <Legend color="#555d7a" label="Client" />
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[7px] text-[var(--text-dim)] font-mono uppercase">{label}</span>
    </div>
  );
}

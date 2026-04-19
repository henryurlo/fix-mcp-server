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

const STATUS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  active:   { bg: '#0a1a12', border: '#00ff88', text: '#00ff88', glow: '0 0 10px #00ff8830' },
  degraded: { bg: '#1a1508', border: '#f59e0b', text: '#f59e0b', glow: '0 0 12px #f59e0b30' },
  down:     { bg: '#1a0a0a', border: '#ff3366', text: '#ff3366', glow: '0 0 14px #ff336640' },
  unknown:  { bg: '#10131f', border: '#252c4a', text: '#555d7a', glow: 'none' },
};

function ExchangeNode({ data }: { data: any }) {
  const sc = STATUS[data.status] || STATUS.unknown;
  return (
    <div style={{
      minWidth: 130, padding: '12px 16px',
      background: `linear-gradient(135deg, ${sc.bg}, #10131f)`,
      border: `1.5px solid ${sc.border}`, borderRadius: 10,
      textAlign: 'center', boxShadow: sc.glow,
    }}>
      <Handle type="source" position={Position.Bottom} id="source"
        style={{ width: 6, height: 6, background: sc.border, border: 'none' }} />
      <div style={{ fontSize: 10, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3, letterSpacing: '0.1em' }}>EXCHANGE</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: sc.text, letterSpacing: '0.04em' }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>{data.sub}</div>
      {data.latency_ms != null && (
        <div style={{ fontSize: 11, color: data.latency_ms > 100 ? '#ff3366' : data.latency_ms > 20 ? '#f59e0b' : '#555d7a', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
          {data.latency_ms.toFixed(1)}ms
        </div>
      )}
    </div>
  );
}

function BrokerNode({ data }: { data: any }) {
  return (
    <div style={{
      padding: '14px 28px',
      background: 'linear-gradient(135deg, #0c1a30, #10131f)',
      border: '2px solid #3b82f6', borderRadius: 14, textAlign: 'center',
      boxShadow: '0 0 20px #3b82f620, 0 0 40px #3b82f610', minWidth: 190,
    }}>
      <Handle type="target" position={Position.Top} id="target-top"
        style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
      <div style={{ fontSize: 10, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3, letterSpacing: '0.1em' }}>BROKER-DEALER</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#3b82f6', letterSpacing: '0.03em' }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 3 }}>{data.sub}</div>
      <Handle type="source" position={Position.Right} id="source-right"
        style={{ width: 6, height: 6, background: '#00d4ff', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="source-bottom"
        style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
      <Handle type="source" position={Position.Left} id="source-left"
        style={{ width: 6, height: 6, background: '#3b82f6', border: 'none' }} />
    </div>
  );
}

function InfraNode({ data }: { data: any }) {
  return (
    <div style={{ padding: '10px 16px', background: '#10131f', border: '1px solid #1a1f35', borderRadius: 8, textAlign: 'center' }}>
      <Handle type="target" position={Position.Top} id="target"
        style={{ width: 6, height: 6, background: '#1a1f35', border: 'none' }} />
      <div style={{ fontSize: 12, color: '#555d7a' }}>{data.icon}</div>
      <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 3 }}>{data.label}</div>
    </div>
  );
}

function MarketDataNode({ data }: { data: any }) {
  return (
    <div style={{
      minWidth: 140, padding: '12px 16px',
      background: 'linear-gradient(135deg, #0c1520, #10131f)',
      border: '1.5px solid #00d4ff', borderRadius: 10, textAlign: 'center',
      boxShadow: '0 0 12px #00d4ff20',
    }}>
      <Handle type="target" position={Position.Left} id="target"
        style={{ width: 6, height: 6, background: '#00d4ff', border: 'none' }} />
      <div style={{ fontSize: 10, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3, letterSpacing: '0.1em' }}>MARKET DATA</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#00d4ff' }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 3 }}>{data.sub}</div>
    </div>
  );
}

const nodeTypes = { exchange: ExchangeNode, broker: BrokerNode, infra: InfraNode, marketData: MarketDataNode };

// Default venue configuration — used when no sessions loaded
const DEFAULT_VENUES = [
  { id: 'nyse', label: 'NYSE' },
  { id: 'arca', label: 'ARCA' },
  { id: 'bats', label: 'BATS' },
  { id: 'iex', label: 'IEX' },
];

function buildTopology(sessions: SessionInfo[], scenario: string | null, active: boolean, scenarioContext: any) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Determine which venues to show
  const venueList = sessions.length > 0
    ? sessions.map(s => ({ id: s.venue.toLowerCase(), label: s.venue }))
    : DEFAULT_VENUES;

  const exchangeY = 50;
  const exchangeXStart = 70;
  const exchangeXGap = Math.min(200, (900 - 140) / Math.max(venueList.length, 1));

  venueList.forEach((ex, i) => {
    const session = sessions.find(s => s.venue === ex.label);
    const status = session?.status || 'unknown';

    nodes.push({
      id: `ex-${ex.id}`, type: 'exchange',
      position: { x: exchangeXStart + i * exchangeXGap, y: exchangeY },
      data: { label: ex.label, sub: 'FIX 4.2', status, latency_ms: (session as any)?.latency_ms },
    });

    edges.push({
      id: `e-${ex.id}-broker`,
      source: `ex-${ex.id}`, sourceHandle: 'source',
      target: 'broker', targetHandle: 'target-top',
      animated: status !== 'down' && status !== 'unknown',
      style: {
        stroke: status === 'down' ? '#ff3366' : status === 'degraded' ? '#f59e0b' : '#252c4a',
        strokeWidth: status === 'down' ? 3 : 2,
        strokeDasharray: status === 'down' ? '8 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: status === 'down' ? '#ff3366' : '#3a4470' },
    });
  });

  // ── Broker-Dealer Hub (center) ──
  const centerX = exchangeXStart + (venueList.length - 1) * exchangeXGap / 2;
  const brokerY = 250;

  const hasDown = sessions.some(s => s.status === 'down');
  const hasDegraded = sessions.some(s => s.status === 'degraded');

  nodes.push({
    id: 'broker', type: 'broker',
    position: { x: centerX - 95, y: brokerY },
    data: {
      label: 'BROKER-SIM',
      sub: active && scenario ? `◆ ${scenario}` : 'FIX Acceptor · OMS · SOR · Algo',
      status: hasDown ? 'degraded' : hasDegraded ? 'degraded' : 'active',
    },
  });

  // ── Market Data Hub (right of broker) ──
  nodes.push({
    id: 'market-data', type: 'marketData',
    position: { x: centerX + 200, y: brokerY - 10 },
    data: { label: 'MD Hub', sub: 'Price + FX' },
  });

  edges.push({
    id: 'e-broker-md', source: 'broker', sourceHandle: 'source-right',
    target: 'market-data', targetHandle: 'target',
    animated: true, style: { stroke: '#00d4ff40', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#00d4ff50' },
  });

  // ── Client Sessions (bottom row) ──
  const clientY = 440;
  const clientXStart = centerX - 220;
  const clientXGap = 180;
  const clients = ['INSTITUTIONAL', 'HEDGE_FUND', 'RETAIL', 'PROP_DESK'];

  clients.forEach((cl, i) => {
    nodes.push({
      id: `cl-${i}`, type: 'infra',
      position: { x: clientXStart + i * clientXGap, y: clientY },
      data: { label: cl, icon: '🏛️' },
    });
    edges.push({
      id: `e-broker-cl-${i}`, source: 'broker', sourceHandle: 'source-bottom',
      target: `cl-${i}`, targetHandle: 'target',
      animated: true, style: { stroke: '#252c4a', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#3a4470' },
    });
  });

  // ── Infrastructure (bottom-right) ──
  nodes.push({
    id: 'postgres', type: 'infra',
    position: { x: centerX + 260, y: clientY - 35 },
    data: { label: 'PostgreSQL', icon: '🐘' },
  });

  nodes.push({
    id: 'redis', type: 'infra',
    position: { x: centerX + 260, y: clientY + 35 },
    data: { label: 'Redis', icon: '⚡' },
  });

  edges.push({
    id: 'e-broker-pg', source: 'broker', sourceHandle: 'source-right',
    target: 'postgres', targetHandle: 'target',
    style: { stroke: '#1a1f35', strokeWidth: 2 },
  });

  edges.push({
    id: 'e-broker-redis', source: 'broker', sourceHandle: 'source-right',
    target: 'redis', targetHandle: 'target',
    style: { stroke: '#1a1f35', strokeWidth: 2 },
  });

  return { nodes, edges };
}

export default function TopologyGraph() {
  const { sessions, scenario, scenarioContext, refresh, connected } = useSystem();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => { setTick(t => t + 1); refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const { nodes, edges } = useMemo(() => buildTopology(sessions, scenario, !!scenario, scenarioContext), [sessions, scenario, tick, scenarioContext]);

  const downCount = sessions.filter(s => s.status === 'down').length;
  const degradedCount = sessions.filter(s => s.status === 'degraded').length;
  const healthyCount = sessions.filter(s => s.status === 'active').length;

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        fitView fitViewOptions={{ padding: 0.15, minZoom: 0.35, maxZoom: 1.2 }}
        minZoom={0.3} maxZoom={2} defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1f35" gap={30} size={1} />
        <Controls showInteractive={false} />

        <Panel position="top-left">
          <div className="glass-panel px-4 py-2.5">
            <div className="text-[12px] font-bold text-[var(--text-secondary)] tracking-wider">System Topology</div>
            <div className="text-[13px] text-[var(--text-dim)] font-mono mt-1">
              {scenario ? <span className="text-[var(--cyan)]">● {scenario}</span> : 'Standby'}{' '}·{' '}
              {sessions.length || 4} venues
            </div>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="glass-panel px-3 py-2 flex items-center gap-3">
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
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[12px] text-[var(--text-dim)] font-mono">{label}</span>
    </div>
  );
}

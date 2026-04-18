'use client';

import React, { useMemo, useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  Position,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useSystem, SessionInfo } from '@/store';

// ── Status color map ───────────────────────────────────────────────

const STATUS = {
  active:   { bg: '#0a1a12', border: '#00ff88', text: '#00ff88', glow: '0 0 10px #00ff8830' },
  degraded: { bg: '#1a1508', border: '#f59e0b', text: '#f59e0b', glow: '0 0 12px #f59e0b30' },
  down:     { bg: '#1a0a0a', border: '#ff3366', text: '#ff3366', glow: '0 0 14px #ff336640' },
  idle:     { bg: '#10131f', border: '#252c4a', text: '#555d7a', glow: 'none' },
};

type StatusKey = keyof typeof STATUS;

// ── Custom Node Components ─────────────────────────────────────────

function ExchangeNode({ data }: { data: any }) {
  const sc = STATUS[data.status as StatusKey] || STATUS.idle;
  return (
    <div style={{
      minWidth: 140,
      padding: '12px 16px',
      background: `linear-gradient(135deg, ${sc.bg}, #10131f)`,
      border: `1.5px solid ${sc.border}`,
      borderRadius: 12,
      textAlign: 'center',
      boxShadow: sc.glow,
    }}>
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>
        EXCHANGE
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: sc.text, letterSpacing: '0.04em' }}>
        {data.label}
      </div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
        {data.sub}
      </div>
      {data.latency_ms != null && (
        <div style={{
          fontSize: 9,
          color: data.latency_ms > 100 ? '#ff3366' : data.latency_ms > 20 ? '#f59e0b' : '#555d7a',
          marginTop: 3,
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          {data.latency_ms.toFixed(1)}ms
        </div>
      )}
    </div>
  );
}

function BrokerNode({ data }: { data: any }) {
  return (
    <div style={{
      padding: '14px 24px',
      background: 'linear-gradient(135deg, #0c1a30, #10131f)',
      border: '2px solid #3b82f6',
      borderRadius: 14,
      textAlign: 'center',
      boxShadow: '0 0 20px #3b82f620, 0 0 40px #3b82f610',
      minWidth: 160,
    }}>
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>
        BROKER HOST
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#3b82f6', letterSpacing: '0.03em' }}>
        {data.label}
      </div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 3 }}>
        {data.sub}
      </div>
    </div>
  );
}

function ClientNode({ data }: { data: any }) {
  const sc = STATUS[data.status as StatusKey] || STATUS.idle;
  return (
    <div style={{
      minWidth: 110,
      padding: '8px 14px',
      background: `linear-gradient(135deg, ${sc.bg}, #10131f)`,
      border: `1px solid ${sc.border}`,
      borderRadius: 10,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 8, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 1, letterSpacing: '0.1em' }}>
        CLIENT
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: sc.text }}>
        {data.label}
      </div>
      <div style={{ fontSize: 9, color: '#555d7a', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
        {data.sub}
      </div>
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
    }}>
      <div style={{ fontSize: 11, color: '#555d7a' }}>{data.icon || '🗄️'}</div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 2 }}>{data.label}</div>
    </div>
  );
}

function MarketDataNode({ data }: { data: any }) {
  const sc = STATUS[data.status as StatusKey] || STATUS.active;
  return (
    <div style={{
      minWidth: 130,
      padding: '10px 14px',
      background: `linear-gradient(135deg, #0c1520, #10131f)`,
      border: `1.5px solid #00d4ff`,
      borderRadius: 10,
      textAlign: 'center',
      boxShadow: '0 0 12px #00d4ff20',
    }}>
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.08em' }}>
        MARKET DATA
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#00d4ff' }}>
        {data.label}
      </div>
      <div style={{ fontSize: 9, color: '#8b92b0', marginTop: 2 }}>
        {data.sub}
      </div>
    </div>
  );
}

const nodeTypes = {
  exchange: ExchangeNode,
  broker: BrokerNode,
  client: ClientNode,
  infra: InfraNode,
  marketData: MarketDataNode,
};

// ── Topology Builder ───────────────────────────────────────────────

function buildTopology(sessions: SessionInfo[], scenario: string | null) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ── Exchanges (top row) ──
  const exchanges = [
    { id: 'nyse', label: 'NYSE', mic: 'XNYS', port: 9001 },
    { id: 'nasdaq', label: 'NASDAQ', mic: 'XNAS', port: 9002 },
    { id: 'tsx', label: 'TSX', mic: 'XTSE', port: 9003 },
    { id: 'lse', label: 'LSE', mic: 'XLON', port: 9004 },
  ];

  const exchangeY = 40;
  const exchangeXStart = 80;
  const exchangeXGap = 220;

  exchanges.forEach((ex, i) => {
    // Match session data if available
    const session = sessions.find(s => s.venue === ex.label || s.venue === ex.mic);
    const status = session?.status || 'active';

    nodes.push({
      id: `ex-${ex.id}`,
      type: 'exchange',
      position: { x: exchangeXStart + i * exchangeXGap, y: exchangeY },
      data: {
        label: ex.label,
        sub: `FIX 4.2 • :${ex.port}`,
        status,
        latency_ms: (session as any)?.latency_ms ?? (Math.random() * 8 + 1),
      },
    });

    // Exchange → Broker edge
    edges.push({
      id: `e-${ex.id}-broker`,
      source: `ex-${ex.id}`,
      target: 'broker',
      animated: status !== 'down',
      style: {
        stroke: status === 'down' ? '#ff3366' : status === 'degraded' ? '#f59e0b' : '#252c4a',
        strokeWidth: status === 'down' ? 3 : 2,
        strokeDasharray: status === 'down' ? '8 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 8, color: status === 'down' ? '#ff3366' : '#3a4470' },
    });
  });

  // ── Broker Host (center) ──
  const brokerX = exchangeXStart + (exchangeXGap * 1.5) - 80;
  const brokerY = 240;

  nodes.push({
    id: 'broker',
    type: 'broker',
    position: { x: brokerX, y: brokerY },
    data: {
      label: 'BROKER-SIM',
      sub: scenario ? `● ${scenario}` : 'FIX Acceptor • OMS • SOR',
    },
  });

  // ── Market Data Hub (right of broker) ──
  nodes.push({
    id: 'market-data',
    type: 'marketData',
    position: { x: brokerX + 280, y: brokerY + 10 },
    data: {
      label: 'MD Hub',
      sub: 'Price + FX Feeds',
      status: 'active',
    },
  });

  edges.push({
    id: 'e-broker-md',
    source: 'broker',
    target: 'market-data',
    animated: true,
    style: { stroke: '#00d4ff40', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#00d4ff50' },
  });

  // ── Clients (bottom row) ──
  const clients = [
    { id: 'firm_a', label: 'FIRM_A', tier: 'Institutional' },
    { id: 'firm_b', label: 'FIRM_B', tier: 'Institutional' },
    { id: 'firm_c', label: 'FIRM_C', tier: 'Institutional' },
    { id: 'retail_1', label: 'RETAIL_1', tier: 'Retail' },
    { id: 'retail_2', label: 'RETAIL_2', tier: 'Retail' },
  ];

  const clientY = 440;
  const clientXStart = 100;
  const clientXGap = 170;

  clients.forEach((cl, i) => {
    nodes.push({
      id: `cl-${cl.id}`,
      type: 'client',
      position: { x: clientXStart + i * clientXGap, y: clientY },
      data: {
        label: cl.label,
        sub: cl.tier,
        status: 'active',
      },
    });

    edges.push({
      id: `e-broker-${cl.id}`,
      source: 'broker',
      target: `cl-${cl.id}`,
      animated: true,
      style: { stroke: '#252c4a', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: '#3a4470' },
    });
  });

  // ── Infrastructure (bottom-right corner) ──
  nodes.push({
    id: 'postgres',
    type: 'infra',
    position: { x: brokerX + 280, y: clientY },
    data: { label: 'PostgreSQL', icon: '🐘' },
  });

  nodes.push({
    id: 'redis',
    type: 'infra',
    position: { x: brokerX + 280 + 120, y: clientY },
    data: { label: 'Redis', icon: '⚡' },
  });

  edges.push({
    id: 'e-broker-pg',
    source: 'broker',
    target: 'postgres',
    style: { stroke: '#1a1f35', strokeWidth: 1 },
  });

  edges.push({
    id: 'e-broker-redis',
    source: 'broker',
    target: 'redis',
    style: { stroke: '#1a1f35', strokeWidth: 1 },
  });

  return { nodes, edges };
}

// ── Main Component ─────────────────────────────────────────────────

export default function TopologyGraph() {
  const { sessions, scenario, refresh } = useSystem();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => { setTick(t => t + 1); refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const { nodes, edges } = useMemo(() => {
    return buildTopology(sessions, scenario);
  }, [sessions, scenario, tick]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.4, maxZoom: 1.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1f35" gap={30} size={1} />
        <Controls showInteractive={false} />

        <Panel position="top-left">
          <div className="glass-panel px-4 py-2">
            <div className="text-[10px] font-bold text-[var(--text-secondary)]">System Topology</div>
            <div className="text-[9px] text-[var(--text-dim)] font-mono mt-0.5">
              {scenario ? `● ${scenario}` : 'Standby'} • {sessions.length || 4} engines • {5} clients
            </div>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="glass-panel px-3 py-2 flex items-center gap-3">
            <Legend color="#00ff88" label="Exchange" />
            <Legend color="#3b82f6" label="Broker" />
            <Legend color="#00d4ff" label="Market Data" />
            <Legend color="#8b92b0" label="Client" />
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
      <span className="text-[8px] text-[var(--text-dim)] font-mono uppercase">{label}</span>
    </div>
  );
}

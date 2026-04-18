'use client';

import React, { useMemo, useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  MarkerType,
  Panel,
  useNodesInitialized,
  FitViewOptions,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useSystem, SessionInfo } from '@/store';
import { ArrowRight, Activity, Shield, Database } from 'lucide-react';

// ── Custom Node Components ─────────────────────────────────────────

const statusColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  active:   { bg: '#0a1a12', border: '#10b981', text: '#10b981', glow: '0 0 12px rgba(16,185,129,0.3)' },
  degraded: { bg: '#1a1508', border: '#f59e0b', text: '#f59e0b', glow: '0 0 12px rgba(245,158,11,0.3)' },
  down:     { bg: '#1a0a0a', border: '#ef4444', text: '#ef4444', glow: '0 0 16px rgba(239,68,68,0.4)' },
};

function VenueNode({ data }: { data: any }) {
  const sc = statusColors[data.status] || statusColors.active;
  const isCritical = data.status === 'down';
  const isWarning = data.status === 'degraded';

  return (
    <div style={{
      minWidth: 130,
      padding: '10px 16px',
      background: `linear-gradient(135deg, ${sc.bg}, #12141a)`,
      border: `1.5px solid ${sc.border}`,
      borderRadius: 10,
      textAlign: 'center',
      boxShadow: isCritical ? sc.glow : isWarning ? sc.glow : 'none',
      animation: isCritical ? 'pulse-glow-red 1.5s ease-in-out infinite' : isWarning ? 'pulse-glow-amber 2s ease-in-out infinite' : undefined,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: sc.text, letterSpacing: '0.04em' }}>
        {data.label}
      </div>
      <div style={{ fontSize: 10, color: '#5a6178', marginTop: 3 }}>
        {data.sub}
      </div>
      {data.latency_ms && (
        <div style={{ fontSize: 9, color: '#5a6178', marginTop: 2, fontFamily: 'var(--font-geist-mono)' }}>
          {data.latency_ms}ms
        </div>
      )}
    </div>
  );
}

function HostNode({ data }: { data: any }) {
  return (
    <div style={{
      padding: '12px 20px',
      background: 'linear-gradient(135deg, #12141a, #1a1d26)',
      border: '1px solid #3b82f6',
      borderRadius: 12,
      textAlign: 'center',
      boxShadow: '0 0 12px rgba(59,130,246,0.2)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>
        {data.icon}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#e4e7f1', marginTop: 4 }}>
        {data.label}
      </div>
      <div style={{ fontSize: 9, color: '#5a6178', marginTop: 2 }}>
        {data.sub}
      </div>
    </div>
  );
}

function DatabaseNode({ data }: { data: any }) {
  return (
    <div style={{
      padding: '8px 14px',
      background: '#12141a',
      border: '1px solid #2a2f42',
      borderRadius: 8,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 12, color: '#5a6178' }}>
        {data.icon}
      </div>
      <div style={{ fontSize: 10, color: '#8b92a8', marginTop: 2 }}>{data.label}</div>
    </div>
  );
}

const nodeTypes = {
  venue: VenueNode,
  host: HostNode,
  db: DatabaseNode,
};

// ── Edge Components ────────────────────────────────────────────────

function StatusEdge({ source, target, status, animated = true }: { source: string; target: string; status: string; animated?: boolean }) {
  const color = status === 'down' ? '#ef4444' : status === 'degraded' ? '#f59e0b' : '#2a2f42';
  const width = status === 'down' ? 3 : 2;
  const anim = animated && status !== 'down';

  return {
    id: `e-${source}-${target}`,
    source,
    target,
    animated: anim,
    style: { stroke: color, strokeWidth: width },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 10, color },
  };
}

// ── Main Topology Component ────────────────────────────────────────

export default function TopologyGraph() {
  const { sessions, scenario, refresh } = useSystem();
  const [tick, setTick] = useState(0);

  // Auto-refresh every 5s for live updates
  useEffect(() => {
    const iv = setInterval(() => { setTick(t => t + 1); refresh(); }, 5000);
    return () => clearInterval(iv);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const n: Node[] = [];
    const e: Edge[] = [];

    // ── Central Host: FIX MCP Server ──
    n.push({
      id: 'mcp-server',
      type: 'host',
      position: { x: 400, y: 240 },
      data: {
        label: 'FIX MCP Server',
        sub: scenario || 'No scenario',
        icon: <Shield size={16} />,
      },
    });

    // ── Infrastructure Nodes ──
    n.push({
      id: 'postgres',
      type: 'db',
      position: { x: 100, y: 460 },
      data: { label: 'PostgreSQL', icon: <Database size={14} />, sub: 'Trading DB' },
    });

    n.push({
      id: 'redis',
      type: 'db',
      position: { x: 250, y: 460 },
      data: { label: 'Redis', icon: <Activity size={14} />, sub: 'Pub/Sub' },
    });

    // ── Venue Nodes (mapped from session data) ──
    const venueStatus = sessions.reduce<Record<string, SessionInfo & { latency_ms?: number }>>((acc, s) => {
      const key = s.venue || 'UNKNOWN';
      if (!acc[key] || s.status === 'down' || s.status === 'degraded') {
        acc[key] = s;
      }
      return acc;
    }, {});

    // If no sessions loaded yet, show default venues
    const venues = Object.keys(venueStatus).length > 0
      ? Object.entries(venueStatus)
      : [
          ['NYSE', { venue: 'NYSE', status: 'active' as const }],
          ['IEX',    { venue: 'IEX',    status: 'active' as const }],
          ['BATS',   { venue: 'BATS',   status: 'active' as const }],
          ['ARCA',   { venue: 'ARCA',   status: 'active' as const }],
        ];

    const venueLayout = [
      { x: 700, y: 80 },
      { x: 700, y: 240 },
      { x: 700, y: 400 },
      { x: 700, y: 560 },
    ];

    venues.forEach(([name, info], i) => {
      const pos = venueLayout[i] || { x: 700, y: 80 + i * 160 };
      n.push({
        id: `venue-${name}`,
        type: 'venue',
        position: pos,
        data: {
          label: name,
          status: (info as any).status || 'active',
          sub: (info as any).msg_rate ? `${(info as any).msg_rate} msg/s` : 'FIX 4.2',
          latency_ms: (info as any).latency_ms,
        },
      });

      e.push(StatusEdge({
        source: 'mcp-server',
        target: `venue-${name}`,
        status: (info as any).status || 'active',
        animated: true,
      }));
    });

    // ── Infrastructure Edges ──
    e.push(StatusEdge({ source: 'mcp-server', target: 'postgres', status: 'active', animated: false }));
    e.push(StatusEdge({ source: 'mcp-server', target: 'redis', status: 'active', animated: false }));

    return { nodes: n, edges: e };
  }, [sessions, scenario, tick]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.5, maxZoom: 1.0 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#1a1d26" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#3b82f6" maskColor="rgba(10,11,14,0.6)" pannable />

        <Panel position="top-left">
          <div className="bg-[#12141a] border border-[#2a2f42] rounded-lg px-4 py-2">
            <div className="text-xs font-semibold text-[#e4e7f1]">System Topology</div>
            <div className="text-[10px] text-[#5a6178] font-mono mt-0.5">
              {scenario ? `● ${scenario}` : 'No scenario active'}
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

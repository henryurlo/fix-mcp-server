'use client';

import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
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
import { useSystem, SessionInfo, TopologyAlert } from '@/store';
import { AlertTriangle, X, CheckCircle2, Loader2, Radio, ArrowUpRight, Zap } from 'lucide-react';

// ── Status colors ──────────────────────────────────────────────────

const STATUS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  active:   { bg: '#0a1a12', border: '#00ff88', text: '#00ff88', glow: '0 0 10px #00ff8830' },
  degraded: { bg: '#1a1508', border: '#f59e0b', text: '#f59e0b', glow: '0 0 12px #f59e0b30' },
  down:     { bg: '#1a0a0a', border: '#ff3366', text: '#ff3366', glow: '0 0 14px #ff336640' },
  unknown:  { bg: '#10131f', border: '#252c4a', text: '#555d7a', glow: 'none' },
};

// ── Alert banner config ────────────────────────────────────────────

const ALERT_STYLES: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
  info:    { bg: 'var(--cyan-dim)', border: 'var(--cyan)', icon: <Radio size={12} className="text-[var(--cyan)]" /> },
  warning: { bg: 'var(--amber-dim)', border: 'var(--amber)', icon: <AlertTriangle size={12} className="text-[var(--amber)]" /> },
  error:   { bg: 'var(--red-dim)', border: 'var(--red)', icon: <AlertTriangle size={12} className="text-[var(--red)]" /> },
  success: { bg: 'var(--green-dim)', border: 'var(--green)', icon: <CheckCircle2 size={12} className="text-[var(--green)]" /> },
};

// ── Custom Nodes ───────────────────────────────────────────────────

function ExchangeNode({ data }: { data: any }) {
  const sc = STATUS[data.status] || STATUS.unknown;
  const [flash, setFlash] = useState<string | null>(null);

  // Flash on status change
  useEffect(() => {
    if (!data.statusChange?.active) return;
    setFlash(data.statusChange.to);
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [data.statusChange]);

  const flashOverlay = flash ? {
    position: 'absolute' as const,
    inset: 0,
    borderRadius: 10,
    background: flash === 'down' ? 'rgba(255,51,102,0.3)' : flash === 'degraded' ? 'rgba(245,158,11,0.3)' : 'rgba(0,255,136,0.2)',
    transition: 'opacity 0.5s ease-out',
    pointerEvents: 'none' as const,
  } : null;

  return (
    <div style={{
      minWidth: 110, padding: '8px 12px', position: 'relative',
      background: `linear-gradient(135deg, ${sc.bg}, #10131f)`,
      border: `1.5px solid ${sc.border}`, borderRadius: 10,
      textAlign: 'center', boxShadow: sc.glow,
    }}>
      {flashOverlay && <div style={{ position: 'absolute', inset: 0, borderRadius: 10, background: flash === 'down' ? 'rgba(255,51,102,0.3)' : flash === 'degraded' ? 'rgba(245,158,11,0.3)' : 'rgba(0,255,136,0.2)', transition: 'opacity 0.5s ease-out', pointerEvents: 'none' as const }} />}
      <Handle type="source" position={Position.Bottom} id="source"
        style={{ width: 6, height: 6, background: sc.border, border: 'none' }} />
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.1em' }}>EXCHANGE</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: sc.text, letterSpacing: '0.04em' }}>{data.label}</div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>{data.sub}</div>
      {data.latency_ms != null && (
        <div style={{ fontSize: 10, color: data.latency_ms > 100 ? '#ff3366' : data.latency_ms > 20 ? '#f59e0b' : '#555d7a', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          {data.latency_ms.toFixed(1)}ms
        </div>
      )}
      {data.lastAction && (
        <div style={{ fontSize: 9, color: 'var(--cyan)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
          <Zap size={8} style={{ display: 'inline', marginRight: 2 }} /> {data.lastAction}
        </div>
      )}
    </div>
  );
}

function BrokerNode({ data }: { data: any }) {
  const hasDown = data.hasDown;
  const borderColor = hasDown ? '#ff3366' : '#3b82f6';
  const glow = hasDown ? '0 0 20px #ff336630, 0 0 40px #ff336620' : '0 0 20px #3b82f620, 0 0 40px #3b82f610';
  return (
    <div style={{
      padding: '10px 22px',
      background: `linear-gradient(135deg, ${hasDown ? '#2a0a0a' : '#0c1a30'}, #10131f)`,
      border: `2px solid ${borderColor}`, borderRadius: 14, textAlign: 'center',
      boxShadow: glow, minWidth: 170,
    }}>
      <Handle type="target" position={Position.Top} id="target-top"
        style={{ width: 6, height: 6, background: borderColor, border: 'none' }} />
      <div style={{ fontSize: 9, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2, letterSpacing: '0.1em' }}>BROKER-DEALER</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: borderColor, letterSpacing: '0.03em' }}>{data.label}</div>
      <div style={{ fontSize: 10, color: '#8b92b0', marginTop: 2 }}>{data.sub}</div>
      <Handle type="source" position={Position.Right} id="source-right"
        style={{ width: 6, height: 6, background: '#00d4ff', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="source-bottom"
        style={{ width: 6, height: 6, background: borderColor, border: 'none' }} />
      <Handle type="source" position={Position.Left} id="source-left"
        style={{ width: 6, height: 6, background: borderColor, border: 'none' }} />
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
  const mdColor = data.isDegraded ? '#ff9e3f' : '#00d4ff';
  const borderGlow = data.isDegraded ? '0 0 12px #ff9e3f40' : '0 0 12px #00d4ff20';
  return (
    <div style={{
      minWidth: 140, padding: '12px 16px',
      background: `linear-gradient(135deg, ${data.isDegraded ? '#1a1208' : '#0c1520'}, #10131f)`,
      border: `1.5px solid ${mdColor}`, borderRadius: 10, textAlign: 'center',
      boxShadow: borderGlow,
    }}>
      <Handle type="target" position={Position.Left} id="target"
        style={{ width: 6, height: 6, background: mdColor, border: 'none' }} />
      <div style={{ fontSize: 10, color: '#555d7a', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3, letterSpacing: '0.1em' }}>MARKET DATA</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: mdColor }}>{data.label}</div>
      <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 3 }}>{data.sub}</div>
    </div>
  );
}

const nodeTypes = { exchange: ExchangeNode, broker: BrokerNode, infra: InfraNode, marketData: MarketDataNode };

// ── Default venues ─────────────────────────────────────────────────

const DEFAULT_VENUES = [
  { id: 'nyse', label: 'NYSE' },
  { id: 'arca', label: 'ARCA' },
  { id: 'bats', label: 'BATS' },
  { id: 'iex', label: 'IEX' },
];

// ── Previous status tracking for flash detection ───────────────────

let prevVenueStatuses: Record<string, string> = {};

function buildTopology(sessions: SessionInfo[], scenario: string | null, active: boolean, scenarioContext: any, alertCount: number) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const venueList = sessions.length > 0
    ? sessions.map(s => ({ id: s.venue.toLowerCase(), label: s.venue }))
    : DEFAULT_VENUES;

  const exchangeY = 15;
  const exchangeXStart = 50;
  const exchangeXGap = Math.min(155, (700 - 100) / Math.max(venueList.length, 1));

  venueList.forEach((ex, i) => {
    const session = sessions.find(s => s.venue === ex.label);
    const status = session?.status || 'unknown';

    // Detect status change for flash
    const prevStatus = prevVenueStatuses[ex.id];
    const hasStatusChange = prevStatus && prevStatus !== status;
    const statusChange = hasStatusChange
      ? { from: prevStatus, to: status, active: true }
      : undefined;
    if (session) {
      prevVenueStatuses[ex.id] = status;
    }

    nodes.push({
      id: `ex-${ex.id}`, type: 'exchange',
      position: { x: exchangeXStart + i * exchangeXGap, y: exchangeY },
      data: { label: ex.label, sub: 'FIX 4.2', status, latency_ms: (session as any)?.latency_ms, statusChange, lastAction: statusChange?.active ? `${prevStatus} → ${status}` : undefined },
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
        transition: 'stroke 0.4s ease, stroke-width 0.3s ease',
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: status === 'down' ? '#ff3366' : '#3a4470' },
    });
  });

  const centerX = exchangeXStart + (venueList.length - 1) * exchangeXGap / 2;
  const brokerY = 180;

  const hasDown = sessions.some(s => s.status === 'down');
  const hasDegraded = sessions.some(s => s.status === 'degraded');

  nodes.push({
    id: 'broker', type: 'broker',
    position: { x: centerX - 95, y: brokerY },
    data: {
      label: 'BROKER-SIM',
      sub: active && scenario ? `◆ ${scenario}` : 'FIX Acceptor · OMS · SOR · Algo',
      hasDown,
    },
  });

  // Market Data Hub -- check if any session is down to show degraded state
  nodes.push({
    id: 'market-data', type: 'marketData',
    position: { x: centerX + 200, y: brokerY - 10 },
    data: { label: 'MD Hub', sub: hasDown ? 'DEGRADED' : 'Price + FX', isDegraded: hasDown },
  });

  edges.push({
    id: 'e-broker-md', source: 'broker', sourceHandle: 'source-right',
    target: 'market-data', targetHandle: 'target',
    animated: !hasDown, style: { stroke: hasDown ? '#ff9e3f40' : '#00d4ff40', strokeWidth: 2, transition: 'stroke 0.4s ease' },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 7, color: hasDown ? '#ff9e3f50' : '#00d4ff50' },
  });

  // Client Sessions
  const clientY = 320;
  const clientXStart = centerX - 180;
  const clientXGap = 140;
  const clients = ['INSTITUTIONAL', 'HEDGE_FUND', 'RETAIL'];

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

  nodes.push({
    id: 'postgres', type: 'infra',
    position: { x: centerX + 180, y: clientY - 25 },
    data: { label: 'PostgreSQL', icon: '🐘' },
  });
  nodes.push({
    id: 'redis', type: 'infra',
    position: { x: centerX + 180, y: clientY + 25 },
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

// ── Main Component ─────────────────────────────────────────────────

export default function TopologyGraph() {
  const { sessions, scenario, scenarioContext, refresh, connected, alerts, clearAlert } = useSystem();
  const [tick, setTick] = useState(0);
  const [prevSessions, setPrevSessions] = useState<SessionInfo[]>([]);
  const prevSessionsRef = useRef(sessions);

  // Track session changes to detect status transitions
  useEffect(() => {
    setPrevSessions(prevSessionsRef.current);
    prevSessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const iv = setInterval(() => { setTick(t => t + 1); refresh(); }, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  const { nodes, edges } = useMemo(() => buildTopology(sessions, scenario, !!scenario, scenarioContext, alerts.length), [sessions, scenario, tick, scenarioContext]);

  const downCount = sessions.filter(s => s.status === 'down').length;
  const degradedCount = sessions.filter(s => s.status === 'degraded').length;
  const healthyCount = sessions.filter(s => s.status === 'active').length;

  return (
    <div className="w-full h-full relative">
      {/* Alert banner overlay */}
      {alerts.length > 0 && (
        <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none space-y-1 p-2">
          {alerts.map((alert: TopologyAlert) => {
            const style = ALERT_STYLES[alert.type] || ALERT_STYLES.info;
            return (
              <div
                key={alert.id}
                className="animate-fade-in pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg border backdrop-blur-md"
                style={{ backgroundColor: style.bg, borderColor: style.border }}
              >
                {style.icon}
                <span className="text-[12px] font-mono font-semibold text-[var(--text-primary)] flex-1">{alert.message}</span>
                <button onClick={() => clearAlert(alert.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        fitView fitViewOptions={{ padding: 0.1, minZoom: 0.3, maxZoom: 1.2 }}
        minZoom={0.3} maxZoom={2} defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1f35" gap={30} size={1} />
        <Controls showInteractive={false} />

        <Panel position="top-left">
          <div className="glass-panel px-4 py-2.5">
            <div className="text-[12px] font-bold text-[var(--text-secondary)] tracking-wider">System Topology</div>
            <div className="text-[13px] text-[var(--text-muted)] font-mono mt-1">
              {scenario ? <span className="text-[var(--cyan)]">● {scenario}</span> : 'Standby'}{' · '}
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
      <span className="text-[12px] text-[var(--text-muted)] font-mono">{label}</span>
    </div>
  );
}

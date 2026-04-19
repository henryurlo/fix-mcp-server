'use client';

import React, { useEffect } from 'react';
import { useSystem } from '@/store';
import {
  Activity,
  Server,
  Network,
  Cpu,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowDownRight,
  ArrowUpRight,
  Zap,
  Database,
  Globe,
  Shield,
} from 'lucide-react';

interface ServiceItem {
  id: string;
  label: string;
  category: 'exchange' | 'engine' | 'market_data' | 'infra';
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs: number | null;
  detail: string;
  affectedByScenario: boolean;
  scenarioNote?: string;
}

const ICONS: Record<string, React.ReactNode> = {
  exchange: <Globe size={13} />,
  engine: <Cpu size={13} />,
  market_data: <Activity size={13} />,
  infra: <Database size={13} />,
};

export default function TelemetryDashboard() {
  const { sessions, scenario, scenarioContext, refresh, connected } = useSystem();

  // Extract which venues/symptoms are impacted by the active scenario
  const scenarioVenues = new Set<string>();
  const scenarioFlags = new Set<string>();
  if (scenarioContext) {
    // Parse runbook steps for venue mentions
    scenarioContext.runbook?.steps?.forEach((s) => {
      if (s.tool_args?.venue) scenarioVenues.add(s.tool_args.venue as string);
    });
    scenarioContext.hints?.key_problems?.forEach((p) => {
      ['NYSE', 'ARCA', 'BATS', 'IEX'].forEach((v) => {
        if (p.includes(v)) scenarioVenues.add(v);
      });
              if (p.includes('dark') || p.includes('Dark')) scenarioFlags.add('dark');
              if (p.includes('fx') || p.includes('FX')) scenarioFlags.add('fx');
            });
  }
  
  // Also check the actual sessions for scenario-relevant venues
  sessions.forEach((s) => {
    if (s.status !== 'active') scenarioVenues.add(s.venue);
  });

  // Build service list from actual session data
  const services: ServiceItem[] = [];

  // Exchange services from session data
  const venues = sessions.length > 0 ? sessions : [
    { venue: 'NYSE', status: connected ? 'active' as const : 'unknown', latency_ms: 0 },
    { venue: 'ARCA', status: connected ? 'active' as const : 'unknown', latency_ms: 0 },
    { venue: 'BATS', status: connected ? 'active' as const : 'unknown', latency_ms: 0 },
    { venue: 'IEX', status: connected ? 'active' as const : 'unknown', latency_ms: 0 },
  ];

  venues.forEach((v: any) => {
    const venue = v.venue;
    const status = v.status === 'active' ? 'healthy' : v.status === 'degraded' ? 'degraded' : v.status === 'down' ? 'down' : 'unknown';
    const isAffected = scenarioVenues.has(venue);
    services.push({
      id: venue,
      label: `${venue} FIX Session`,
      category: 'exchange',
      status,
      latencyMs: v.latency_ms || null,
      detail: `${status === 'healthy' ? 'Connected' : status === 'degraded' ? 'Elevated latency' : 'Disconnected'} ${v.latency_ms ? `• ${v.latency_ms.toFixed(1)}ms` : ''}`,
      affectedByScenario: isAffected,
      scenarioNote: isAffected ? 'Active issue in this scenario' : undefined,
    });
  });

  // Engine services
  const degradedCount = venues.filter((v: any) => v.status === 'degraded').length;
  const downCount = venues.filter((v: any) => v.status === 'down').length;

  services.push({
    id: 'oms',
    label: 'Order Management System',
    category: 'engine',
    status: connected ? 'healthy' : 'unknown',
    latencyMs: null,
    detail: connected ? 'Order store active' : 'Disconnected',
    affectedByScenario: scenarioContext?.categories?.includes('orders') || false,
  });

  services.push({
    id: 'sor',
    label: 'Smart Order Router',
    category: 'engine',
    status: connected ? (downCount > 0 ? 'degraded' : 'healthy') : 'unknown',
    latencyMs: null,
    detail: downCount > 0 ? `${downCount} venue(s) excluded from routing` : 'All venues routable',
    affectedByScenario: degradedCount > 0 || downCount > 0,
  });

  services.push({
    id: 'algo',
    label: 'Algo Engine',
    category: 'engine',
    status: connected ? 'healthy' : 'unknown',
    latencyMs: null,
    detail: scenarioContext?.categories?.includes('algo') ? 'Algostop affected by scenario' : 'Healthy — no active algos',
    affectedByScenario: scenarioContext?.categories?.includes('algo') || false,
  });

  // Market data
  const avgLatency = venues.length > 0
    ? venues.reduce((sum: number, v: any) => sum + (v.latency_ms || 0), 0) / venues.length
    : 0;
  services.push({
    id: 'md',
    label: 'Market Data Hub',
    category: 'market_data',
    status: avgLatency > 100 ? 'degraded' : connected ? 'healthy' : 'unknown',
    latencyMs: avgLatency,
    detail: avgLatency > 100 ? `Stale quotes on degraded venues • ${avgLatency.toFixed(1)}ms avg` : 'Fresh quotes on all venues',
    affectedByScenario: scenarioFlags.has('fx') || degradedCount > 0,
  });

  services.push({
    id: 'fx',
    label: 'FX Rate Service',
    category: 'market_data',
    status: connected ? 'healthy' : 'unknown',
    latencyMs: null,
    detail: scenarioFlags.has('fx') ? 'ADRs affected by FX movement' : 'Healthy — stable rates',
    affectedByScenario: scenarioFlags.has('fx'),
  });

  // Infrastructure
  services.push({
    id: 'postgres',
    label: 'PostgreSQL',
    category: 'infra',
    status: connected ? 'healthy' : 'unknown',
    latencyMs: null,
    detail: 'Order persistence active',
    affectedByScenario: false,
  });

  services.push({
    id: 'redis',
    label: 'Redis',
    category: 'infra',
    status: connected ? 'healthy' : 'unknown',
    latencyMs: null,
    detail: 'Pub/sub for fills · events',
    affectedByScenario: false,
  });

  const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
    healthy: { bg: 'var(--green-dim)', border: 'var(--green)', text: 'var(--green)', icon: <CheckCircle size={12} /> },
    degraded: { bg: 'var(--amber-dim)', border: 'var(--amber)', text: 'var(--amber)', icon: <AlertTriangle size={12} /> },
    down: { bg: 'var(--red-dim)', border: 'var(--red)', text: 'var(--red)', icon: <XCircle size={12} /> },
    unknown: { bg: 'var(--bg-elevated)', border: 'var(--border-dim)', text: 'var(--text-dim)', icon: <Shield size={12} /> },
  };

  // Group by category
  const categories = ['exchange', 'engine', 'market_data', 'infrastructure'] as const;
  const categoryLabels: Record<string, string> = { exchange: 'EXCHANGES', engine: 'TRADING ENGINE', market_data: 'MARKET DATA', infra: 'INFRASTRUCTURE' };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold">Service Health</h1>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {scenarioContext ? `● ${scenarioContext.title}` : 'No active scenario'} — {services.filter(s => s.status !== 'healthy').length} services impacted
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Healthy" value={services.filter(s => s.status === 'healthy').length.toString()} color="var(--green)" icon={<CheckCircle size={14} />} />
        <SummaryCard label="Degraded" value={services.filter(s => s.status === 'degraded').length.toString()} color="var(--amber)" icon={<AlertTriangle size={14} />} />
        <SummaryCard label="Down" value={services.filter(s => s.status === 'down').length.toString()} color="var(--red)" icon={<XCircle size={14} />} />
        <SummaryCard label="Affected" value={services.filter(s => s.affectedByScenario).length.toString()} color="var(--purple)" icon={<Zap size={14} />} />
      </div>

      {/* Services by category */}
      {categories.map((cat) => {
        const catServices = services.filter((s) => s.category === cat);
        if (catServices.length === 0) return null;
        return (
          <div key={cat} className="mb-6">
            <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-2">
              {ICONS[cat]} {categoryLabels[cat]}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {catServices.map((svc) => {
                const style = STATUS_STYLES[svc.status];
                return (
                  <div
                    key={svc.id}
                    className={`p-3 rounded-md border ${
                      svc.affectedByScenario
                        ? 'border-[var(--red)]/30 bg-[var(--red-dim)]/20'
                        : 'border-[var(--border-dim)] bg-[var(--bg-surface)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold">{svc.label}</span>
                      <div className="flex items-center gap-1.5">
                        {svc.affectedByScenario && (
                          <span className="text-[7px] px-1 py-0.5 rounded bg-[var(--red-dim)] text-[var(--red)] font-mono">AFFECTED</span>
                        )}
                        <span style={{ color: style.text }} className="flex items-center gap-1 text-[10px] font-semibold">
                          {style.icon} {svc.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-[var(--text-dim)] font-mono">
                      <span>{svc.detail}</span>
                      {svc.latencyMs != null && svc.latencyMs > 0 && (
                        <div className="flex items-center gap-0.5 ml-auto">
                          {svc.latencyMs > 100 ? <ArrowUpRight size={9} className="text-[var(--red)]" /> : <ArrowDownRight size={9} className="text-[var(--green)]" />}
                          {svc.latencyMs.toFixed(1)}ms
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-surface)] p-3 rounded-md border border-[var(--border-dim)]">
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
    </div>
  );
}

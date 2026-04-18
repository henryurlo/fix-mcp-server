'use client';

import React, { useEffect, useState } from 'react';
import { useTelemetry, type EngineHealth } from '@/store/telemetry';
import OrderDashboard from '@/components/OrderDashboard';
import {
  Activity,
  Cpu,
  Server,
  Zap,
  AlertTriangle,
  CheckCircle,
  Clock,
  BarChart2,
  TrendingUp,
  Radio,
  Globe,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
} from 'lucide-react';

// ── Sparkline component (pure CSS, no chart lib needed) ────────────

function Sparkline({ data, color = 'var(--cyan)', height = 32, width = 120 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return <div style={{ width, height }} className="bg-[var(--bg-base)] rounded" />;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#grad-${color.replace(/[^a-z0-9]/gi, '')})`}
      />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
          r="2.5"
          fill={color}
          stroke={color}
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

// ── Main Telemetry Dashboard ───────────────────────────────────────

export default function TelemetryDashboard() {
  const { history, engineHealth, marketDataStatus, fxRates, refresh, lastUpdate } = useTelemetry();
  const [tick, setTick] = useState(0);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(() => {
      refresh();
      setTick(t => t + 1);
    }, 2000);
    return () => clearInterval(iv);
  }, [refresh]);

  const latestPoint = history.length > 0 ? history[history.length - 1] : null;
  const msgRates = history.map(h => h.msg_rate);
  const latencies = history.map(h => h.latency_ms);
  const ordersOpen = history.map(h => h.orders_open);
  const ordersFilled = history.map(h => h.orders_filled);
  const freshness = history.map(h => h.market_data_freshness_ms);

  return (
    <div className="h-full overflow-y-auto p-5 bg-[var(--bg-void)]">
      {/* Title */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <BarChart2 size={18} className="text-[var(--cyan)]" />
          <div>
            <h1 className="text-base font-bold">System Telemetry</h1>
            <p className="text-[10px] text-[var(--text-muted)] font-mono">
              Real-time metrics • {history.length} samples • Updated {lastUpdate ? `${Math.round((Date.now() - lastUpdate) / 1000)}s ago` : 'never'}
            </p>
          </div>
        </div>
        <button onClick={refresh} className="btn-secondary flex items-center gap-1.5 !py-1.5 !px-3 !text-[10px]">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {/* ── Top Metrics Row ─────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <MetricCard
          label="Message Rate"
          value={latestPoint?.msg_rate?.toFixed(0) || '—'}
          unit="msg/s"
          sparkline={msgRates}
          color="var(--cyan)"
          icon={<Zap size={13} />}
        />
        <MetricCard
          label="Avg Latency"
          value={latestPoint?.latency_ms?.toFixed(1) || '—'}
          unit="ms"
          sparkline={latencies}
          color={latestPoint && latestPoint.latency_ms > 100 ? 'var(--red)' : 'var(--green)'}
          icon={<Clock size={13} />}
        />
        <MetricCard
          label="Open Orders"
          value={latestPoint?.orders_open?.toString() || '—'}
          unit="active"
          sparkline={ordersOpen}
          color="var(--blue)"
          icon={<ArrowUpRight size={13} />}
        />
        <MetricCard
          label="Filled Orders"
          value={latestPoint?.orders_filled?.toString() || '—'}
          unit="total"
          sparkline={ordersFilled}
          color="var(--green)"
          icon={<CheckCircle size={13} />}
        />
        <MetricCard
          label="Data Freshness"
          value={latestPoint?.market_data_freshness_ms?.toFixed(0) || '—'}
          unit="ms"
          sparkline={freshness}
          color={latestPoint && latestPoint.market_data_freshness_ms > 1000 ? 'var(--amber)' : 'var(--green)'}
          icon={<Radio size={13} />}
        />
      </div>

      {/* ── Engine Health Grid ──────────────────────────────── */}
      <div className="mb-5">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
          <Server size={13} /> Engine Health
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {engineHealth.length > 0 ? (
            engineHealth.map((engine) => (
              <EngineCard key={engine.name} engine={engine} />
            ))
          ) : (
            // Default engines when no data
            ['NYSE-FIX', 'NASDAQ-FIX', 'TSX-FIX', 'LSE-FIX', 'Broker Host', 'Market Data'].map((name) => (
              <EngineCard
                key={name}
                engine={{ name, status: 'healthy', last_heartbeat: Date.now(), latency_ms: Math.random() * 20, msg_rate: Math.random() * 100, sessions: Math.floor(Math.random() * 5) + 1 }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Market Data + FX Rates ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-5">
        {/* Market Data Status */}
        <div className="glass-panel p-4">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <Globe size={13} /> Market Data Feeds
          </h2>
          <div className="space-y-2">
            {Object.keys(marketDataStatus).length > 0 ? (
              Object.entries(marketDataStatus).map(([venue, data]) => (
                <div key={venue} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-dim)]">
                  <div className="flex items-center gap-2">
                    <span className={`status-dot ${data.status === 'fresh' ? 'healthy' : data.status === 'stale' ? 'degraded' : 'down'}`} />
                    <span className="text-[11px] font-mono font-semibold">{venue}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono ${
                      data.status === 'fresh' ? 'text-[var(--green)]' : data.status === 'stale' ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                    }`}>
                      {data.freshness_ms}ms
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                      data.status === 'fresh' ? 'bg-[var(--green-dim)] text-[var(--green)]' :
                      data.status === 'stale' ? 'bg-[var(--amber-dim)] text-[var(--amber)]' :
                      'bg-[var(--red-dim)] text-[var(--red)]'
                    }`}>
                      {data.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              // Default market data when no data
              ['XNYS (NYSE)', 'XNAS (NASDAQ)', 'XTSE (TSX)', 'XLON (LSE)'].map((venue) => (
                <div key={venue} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-dim)]">
                  <div className="flex items-center gap-2">
                    <span className="status-dot healthy" />
                    <span className="text-[11px] font-mono font-semibold">{venue}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--green)]">2ms</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* FX Rates */}
        <div className="glass-panel p-4">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp size={13} /> FX Rates
          </h2>
          <div className="space-y-2">
            {Object.keys(fxRates).length > 0 ? (
              Object.entries(fxRates).map(([pair, rate]) => (
                <FXRow key={pair} pair={pair} rate={rate} />
              ))
            ) : (
              // Default FX rates
              [
                { pair: 'CAD/USD', rate: 0.7316 },
                { pair: 'GBP/USD', rate: 1.2654 },
                { pair: 'EUR/USD', rate: 1.0892 },
                { pair: 'PEN/USD', rate: 0.2678 },
              ].map(({ pair, rate }) => (
                <FXRow key={pair} pair={pair} rate={rate} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Order Book ──────────────────────────────────────── */}
      <div className="mt-5">
        <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Order Book
        </h2>
        <OrderDashboard />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function MetricCard({ label, value, unit, sparkline, color, icon }: {
  label: string; value: string; unit: string; sparkline: number[]; color: string; icon: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <span className="text-xl font-bold font-mono" style={{ color }}>{value}</span>
          <span className="text-[9px] text-[var(--text-dim)] font-mono ml-1">{unit}</span>
        </div>
        <Sparkline data={sparkline.slice(-60)} color={color} height={28} width={80} />
      </div>
    </div>
  );
}

function EngineCard({ engine }: { engine: EngineHealth }) {
  const statusConfig = {
    healthy: { dot: 'healthy', label: 'HEALTHY', color: 'var(--green)' },
    degraded: { dot: 'degraded', label: 'DEGRADED', color: 'var(--amber)' },
    down: { dot: 'down', label: 'DOWN', color: 'var(--red)' },
  };
  const sc = statusConfig[engine.status] || statusConfig.healthy;
  const hbAge = Math.round((Date.now() - engine.last_heartbeat) / 1000);

  return (
    <div className={`glass-panel p-3 ${engine.status === 'down' ? 'border-[var(--red)]/40' : engine.status === 'degraded' ? 'border-[var(--amber)]/30' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${sc.dot}`} />
          <span className="text-[11px] font-mono font-semibold">{engine.name}</span>
        </div>
        <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono uppercase font-bold`} style={{ color: sc.color, background: `${sc.color}20` }}>
          {sc.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[9px] text-[var(--text-dim)] font-mono">Latency</div>
          <div className="text-[11px] font-mono font-semibold" style={{ color: engine.latency_ms > 100 ? 'var(--red)' : 'var(--text-primary)' }}>
            {engine.latency_ms.toFixed(1)}ms
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--text-dim)] font-mono">Msg/s</div>
          <div className="text-[11px] font-mono font-semibold text-[var(--text-primary)]">
            {engine.msg_rate.toFixed(0)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[var(--text-dim)] font-mono">HB Age</div>
          <div className="text-[11px] font-mono font-semibold" style={{ color: hbAge > 30 ? 'var(--amber)' : 'var(--text-primary)' }}>
            {hbAge}s
          </div>
        </div>
      </div>
    </div>
  );
}

function FXRow({ pair, rate }: { pair: string; rate: number }) {
  const isNormal = (pair === 'CAD/USD' && rate > 0.6 && rate < 0.9) ||
                   (pair === 'GBP/USD' && rate > 1.1 && rate < 1.5) ||
                   (pair === 'EUR/USD' && rate > 0.9 && rate < 1.3) ||
                   (pair === 'PEN/USD' && rate > 0.2 && rate < 0.35);

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-dim)]">
      <span className="text-[11px] font-mono font-semibold">{pair}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-mono font-bold ${isNormal ? 'text-[var(--text-primary)]' : 'text-[var(--red)]'}`}>
          {rate.toFixed(4)}
        </span>
        {!isNormal && (
          <AlertTriangle size={11} className="text-[var(--red)]" />
        )}
      </div>
    </div>
  );
}

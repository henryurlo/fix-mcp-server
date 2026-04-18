import { create } from 'zustand';

export interface TelemetryPoint {
  timestamp: number;
  msg_rate: number;
  latency_ms: number;
  orders_open: number;
  orders_filled: number;
  market_data_freshness_ms: number;
}

export interface EngineHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  last_heartbeat: number;
  latency_ms: number;
  msg_rate: number;
  sessions: number;
}

export interface TelemetryState {
  history: TelemetryPoint[];
  engineHealth: EngineHealth[];
  marketDataStatus: Record<string, { freshness_ms: number; status: 'fresh' | 'stale' | 'disconnected' }>;
  fxRates: Record<string, number>;
  lastUpdate: number;

  addSample: (point: TelemetryPoint) => void;
  setEngineHealth: (engines: EngineHealth[]) => void;
  setMarketDataStatus: (status: Record<string, { freshness_ms: number; status: 'fresh' | 'stale' | 'disconnected' }>) => void;
  setFxRates: (rates: Record<string, number>) => void;
  refresh: () => Promise<void>;
}

const MAX_HISTORY = 300;

export const useTelemetry = create<TelemetryState>((set, get) => ({
  history: [],
  engineHealth: [],
  marketDataStatus: {},
  fxRates: {},
  lastUpdate: 0,

  addSample: (point: TelemetryPoint) => {
    set((state) => ({
      history: [...state.history.slice(-MAX_HISTORY + 1), point],
      lastUpdate: Date.now(),
    }));
  },

  setEngineHealth: (engines: EngineHealth[]) => set({ engineHealth: engines }),
  setMarketDataStatus: (status) => set({ marketDataStatus: status }),
  setFxRates: (rates) => set({ fxRates: rates }),

  refresh: async () => {
    try {
      // Derive telemetry from the working /api/status and /api/orders endpoints
      const [statusRes, ordersRes] = await Promise.all([
        fetch('/api/status').catch(() => null),
        fetch('/api/orders').catch(() => null),
      ]);

      if (!statusRes?.ok) return;

      const status = await statusRes.json();
      const orders = ordersRes?.ok ? await ordersRes.json() : [];

      const venues = status.sessions?.detail || [];

      // Compute avg latency from venue sessions
      const activeSessions = venues.filter((v: any) => v.status === 'active');
      const avgLatency = activeSessions.length > 0
        ? activeSessions.reduce((sum: number, v: any) => sum + (v.latency_ms || 0), 0) / activeSessions.length
        : 0;

      // Count orders
      const orderList = Array.isArray(orders) ? orders : [];
      const openOrders = orderList.filter((o: any) => ['new', 'stuck', 'partially_filled'].includes(o.status)).length;
      const filledOrders = orderList.filter((o: any) => o.status === 'filled').length;

      // Simulate message rate from session count + random jitter
      const msgRate = activeSessions.length * (120 + Math.random() * 80);

      // Market data freshness from avg latency
      const freshness = avgLatency * 2 + Math.random() * 10;

      // Add telemetry sample
      get().addSample({
        timestamp: Date.now(),
        msg_rate: Math.round(msgRate),
        latency_ms: avgLatency,
        orders_open: openOrders || status.orders?.open || 0,
        orders_filled: filledOrders,
        market_data_freshness_ms: freshness,
      });

      // Build engine health from venue data
      const engines: EngineHealth[] = venues.map((v: any) => ({
        name: v.venue,
        status: v.status === 'active' ? 'healthy' as const : v.status === 'degraded' ? 'degraded' as const : 'down' as const,
        last_heartbeat: Date.now(),
        latency_ms: v.latency_ms || 0,
        msg_rate: Math.round(30 + Math.random() * 50),
        sessions: 1,
      }));
      get().setEngineHealth(engines);

      // Build market data status
      const mdStatus: Record<string, { freshness_ms: number; status: 'fresh' | 'stale' | 'disconnected' }> = {};
      for (const v of venues) {
        const f = (v.latency_ms || 0) * 2 + Math.random() * 5;
        mdStatus[v.venue] = {
          freshness_ms: f,
          status: v.status === 'down' ? 'disconnected' : f > 100 ? 'stale' : 'fresh',
        };
      }
      get().setMarketDataStatus(mdStatus);

      // Simulated FX rates
      get().setFxRates({
        'USD/CAD': 1.3642 + (Math.random() - 0.5) * 0.002,
        'EUR/USD': 1.0834 + (Math.random() - 0.5) * 0.001,
        'GBP/USD': 1.2654 + (Math.random() - 0.5) * 0.002,
        'USD/JPY': 154.32 + (Math.random() - 0.5) * 0.3,
      });
    } catch (err) {
      console.warn('[telemetry] refresh failed', err);
    }
  },
}));

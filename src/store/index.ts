import { create } from 'zustand';
import { useAudit, AuditEntry } from './audit';
import { SYSTEM_PROMPT, SCENARIO_OVERLAYS, KNOWN_TOOLS } from './prompts';
export type { AuditEntry };

// ── Backend URL — Next.js dev server proxies /api/* to the Python backend
const BACKEND = '';

async function jsonFetch<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function jsonPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ── Topology / System State ─────────────────────────────────────────
export interface SessionInfo {
  venue: string;
  status: 'active' | 'degraded' | 'down';
  latency_ms?: number;
  session_id?: string;
}

export interface OrderInfo {
  order_id: string;
  symbol: string;
  side: string;
  quantity: number;
  status: string;
  venue: string;
  client_name: string;
  price?: number;
  flags?: string[];
}

export interface EventEntry {
  ts: string;
  tool: string;
  ok: boolean;
  source: string;
  summary: string;
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface ScenarioSummary {
  name: string;
  title: string;
  description: string;
  severity: Severity;
  estimated_minutes: number;
  categories: string[];
  difficulty: Difficulty;
  simulated_time: string;
  is_algo: boolean;
  success_criteria_count: number;
  runbook_step_count: number;
  context: string;  // kept for backward compat
}

export interface RunbookStep {
  step: number;
  title: string;
  narrative: string;
  tool: string;
  tool_args: Record<string, unknown>;
  expected: string;
}

export interface ScenarioContext {
  name: string;
  title: string;
  description: string;
  severity: Severity;
  estimated_minutes: number;
  categories: string[];
  difficulty: Difficulty;
  simulated_time: string;
  runbook: {
    narrative: string;
    steps: RunbookStep[];
  };
  hints: {
    key_problems: string[];
    flag_meanings: Record<string, string>;
    diagnosis_path: string;
    common_mistakes: string[];
  };
  success_criteria: string[];
  sessions: unknown[];
  orders: unknown[];
}

type ScenarioDef = ScenarioSummary;  // backward compat alias

/** Status for individual runbook steps */
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/** Which control mode we are in */
export type ControlMode = 'human' | 'agent' | 'collab';

/** Alert that pops on the topology overlay */
export interface TopologyAlert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
  autoClear: boolean;
}

/** Host-level event (scenario lifecycle, resets, errors) */
export interface HostEvent {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

/** Detailed step tracking with status + output */
export interface TrackedStep extends RunbookStep {
  status: StepStatus;
  output: string;
}

interface SystemState {
  sessions: SessionInfo[];
  orders: OrderInfo[];
  events: EventEntry[];
  scenario: string | null;
  available_scenarios: ScenarioDef[];
  scenarioContext: ScenarioContext | null;  // Full scenario data for active scenario
  scenarioState: 'idle' | 'loading' | 'diagnosing' | 'addressing' | 'validating' | 'resolved' | 'failed';
  completedSteps: number[];  // step numbers completed
  /** Detailed tracked steps for the active scenario */
  trackedSteps: TrackedStep[];
  /** Whether a scenario is locked (mission mode — only Reset exits) */
  locked: boolean;
  /** Control mode: who's driving the runbook */
  controlMode: ControlMode;
  /** Alert banners for topology */
  alerts: TopologyAlert[];
  /** Host-level events */
  hostEvents: HostEvent[];
  /** Step-by-step status management */
  setStepStatus: (stepNumber: number, status: StepStatus, output?: string) => void;
  advanceStep: (stepNumber: number) => void;
  resetStepsForScenario: (steps: RunbookStep[]) => void;
  /** Lock/unlock scenario */
  setLocked: (locked: boolean) => void;
  /** Control mode actions */
  takeOverAsAgent: () => Promise<void>;
  releaseToHuman: () => Promise<void>;
  toggleCollab: () => Promise<void>;
  /** Alert management */
  addAlert: (message: string, type: TopologyAlert['type'], autoClear?: number) => void;
  clearAlert: (id: string) => void;
  /** Host event management */
  addHostEvent: (type: string, message: string, severity?: HostEvent['severity']) => void;
  completeStep: (stepNumber: number) => void;
  resetScenarioState: () => void;
  mode: 'human' | 'agent' | 'mixed';
  loading: boolean;
  connected: boolean;
  error: string | null;
  open_count: number;
  stuck_count: number;
  refresh: () => Promise<void>;
  startScenario: (name: string) => Promise<void>;
  resetScenario: () => Promise<void>;
  callTool: (tool: string, args: Record<string, unknown>) => Promise<string>;
  setMode: (mode: 'human' | 'agent' | 'mixed') => Promise<void>;
}

export const useSystem = create<SystemState>((set, get) => ({
  sessions: [],
  orders: [],
  events: [],
  scenario: null,
  available_scenarios: [],
  scenarioContext: null,
  scenarioState: 'idle',
  completedSteps: [],
  trackedSteps: [],
  locked: false,
  controlMode: 'human',
  alerts: [],
  hostEvents: [],

  completeStep: (stepNumber: number) => {
    set((s) => {
      const steps = s.completedSteps.includes(stepNumber)
        ? s.completedSteps
        : [...s.completedSteps, stepNumber];
      return { completedSteps: steps };
    });
  },
  resetScenarioState: () => {
    set({ scenarioState: 'idle', completedSteps: [] });
  },
  /** Track individual step with status + output */
  setStepStatus: (stepNumber: number, status: StepStatus, output?: string) => {
    set((s) => ({
      trackedSteps: s.trackedSteps.map((t) =>
        t.step === stepNumber
          ? { ...t, status, output: output ?? t.output }
          : t
      ),
    }));
  },
  /** Auto-advance: mark step done, set next step to running */
  advanceStep: (stepNumber: number) => {
    set((s) => {
      const idx = s.trackedSteps.findIndex((t) => t.step === stepNumber);
      if (idx === -1) return {};
      const updated = s.trackedSteps.map((t) =>
        t.step === stepNumber ? { ...t, status: 'done' as StepStatus } : t
      );
      if (idx + 1 < updated.length) {
        updated[idx + 1] = { ...updated[idx + 1], status: 'running' as StepStatus };
      }
      return { trackedSteps: updated };
    });
  },
  /** Initialize trackedSteps from a scenario's runbook steps */
  resetStepsForScenario: (steps: RunbookStep[]) => {
    set({
      trackedSteps: steps.map((s, i) => ({
        ...s,
        status: (i === 0 ? 'running' : 'pending') as StepStatus,
        output: '',
      })),
    });
  },
  /** Lock/unlock scenario (mission mode) */
  setLocked: (locked: boolean) => {
    set({ locked });
  },
  /** Switch to agent mode */
  takeOverAsAgent: async () => {
    await jsonPost('/api/mode', { mode: 'agent' });
    set({ controlMode: 'agent', mode: 'agent' });
  },
  /** Switch back to human mode */
  releaseToHuman: async () => {
    await jsonPost('/api/mode', { mode: 'human' });
    set({ controlMode: 'human', mode: 'human' });
  },
  /** Toggle collaborative mode */
  toggleCollab: async () => {
    await jsonPost('/api/mode', { mode: 'mixed' });
    set({ controlMode: 'collab', mode: 'mixed' });
  },
  /** Add alert banner */
  addAlert: (message: string, type: TopologyAlert['type'], autoClearMs?: number) => {
    const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      alerts: [...s.alerts, { id, message, type, timestamp: Date.now(), autoClear: !!autoClearMs }],
    }));
    if (autoClearMs) {
      setTimeout(() => {
        set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
      }, autoClearMs);
    }
  },
  /** Clear specific alert */
  clearAlert: (id: string) => {
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
  },
  /** Add host-level event */
  addHostEvent: (type: string, message: string, severity: HostEvent['severity'] = 'info') => {
    set((s) => ({
      hostEvents: [
        ...s.hostEvents,
        { id: `host-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), type, message, severity },
      ].slice(-200),
    }));
  },
  mode: 'human',
  loading: false,
  connected: false,
  error: null,
  open_count: 0,
  stuck_count: 0,

  refresh: async () => {
    try {
      const [statusRes, ordersRes, eventsRes, modeRes] = await Promise.all([
        jsonFetch<any>('/api/status').catch(e => { console.error('/api/status failed:', e); return null; }),
        jsonFetch<OrderInfo[]>('/api/orders').catch(e => { console.error('/api/orders failed:', e); return null; }),
        jsonFetch<EventEntry[]>('/api/events').catch(e => { console.error('/api/events failed:', e); return null; }),
        jsonFetch('/api/mode').catch(e => { console.error('/api/mode failed:', e); return null; }),
      ]);

      if (!statusRes) { set({ connected: false, error: '/api/status failed', loading: false }); return; }

      const sessions: SessionInfo[] = (statusRes.sessions?.detail || []).map((s: any) => ({
        venue: s.venue || '',
        status: (s.status || 'active') as SessionInfo['status'],
        latency_ms: s.latency_ms,
        session_id: s.session_id,
      }));

      set({
        sessions,
        orders: ordersRes ?? [],
        events: (eventsRes ?? []).slice(0, 50),
        scenario: statusRes.scenario,
        available_scenarios: statusRes.available_scenarios || [],
        mode: (modeRes?.mode as SystemState['mode']) || 'human',
        open_count: statusRes.orders?.open || 0,
        stuck_count: statusRes.orders?.stuck || 0,
        connected: true,
        error: null,
        loading: false,
      });
    } catch (err: unknown) {
      set({ connected: false, error: (err as Error).message });
    }
  },

  startScenario: async (name: string) => {
    set({ loading: true, scenarioState: 'loading', completedSteps: [] });
    try {
      await jsonPost('/api/reset', { scenario: name });
      await get().refresh();
      // Fetch full scenario context from the backend
      try {
        const ctx = await jsonFetch<ScenarioContext>(`/api/scenario/${name}`);
        set({ scenarioContext: ctx, scenarioState: 'diagnosing', locked: true });
        get().resetStepsForScenario(ctx.runbook?.steps || []);
        get().addHostEvent('scenario_start', `Scenario "${ctx.title}" activated`, 'info');
        get().addAlert(`Scenario: ${ctx.title}`, 'info', 5000);
      } catch {
        set({ scenarioContext: null, scenarioState: 'diagnosing', locked: true });
        get().addHostEvent('scenario_start', `Scenario "${name}" activated (no context)`, 'warning');
      }
    } catch (err: unknown) {
      set({ loading: false, error: (err as Error).message, scenarioState: 'idle' });
    }
  },

  /** Full reset: clear scenario, locked state, chat, tracked steps, alerts */
  resetScenario: async () => {
    const { scenario } = get();
    if (!scenario) return;
    set({ loading: true });
    try {
      await jsonPost('/api/reset', { scenario: 'clear' });
      await get().refresh();
      // Clear everything
      set({
        scenario: null,
        scenarioContext: null,
        scenarioState: 'idle',
        completedSteps: [],
        trackedSteps: [],
        locked: false,
        alerts: [],
        error: null,
        loading: false,
      });
      get().addHostEvent('scenario_reset', `Scenario "${scenario}" reset`, 'info');
    } catch (err: unknown) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  callTool: async (tool: string, args: Record<string, unknown>) => {
    const auditId = useAudit.getState().addEntry(tool, args);
    try {
      const res = await jsonPost('/api/tool', { tool, arguments: args });
      useAudit.getState().completeEntry(auditId, (res as { output?: string }).output || 'Done', true);
      await get().refresh();
      return (res as { output?: string }).output || '';
    } catch (err: unknown) {
      useAudit.getState().completeEntry(auditId, (err as Error).message, false);
      throw err;
    }
  },

  setMode: async (mode: 'human' | 'agent' | 'mixed') => {
    await jsonPost('/api/mode', { mode });
    set({ mode });
  },
}));

// ── Chat State ──────────────────────────────────────────────────────
export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'proposed' | 'approved' | 'executing' | 'success' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCallTrace[];
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  openRouterKey: string | null;
  isOpen: boolean;
  isTyping: boolean;
  setKey: (key: string | null) => void;
  toggleOpen: () => void;
  send: (content: string) => Promise<void>;
  approveToolCall: (msgId: string, toolIndex: number) => Promise<void>;
  clear: () => void;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [{
    id: 'init', role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now(),
  }],
  openRouterKey: null,
  isOpen: false,
  isTyping: false,

  setKey: (key: string | null) => set({ openRouterKey: key }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  send: async (content: string) => {
    const { openRouterKey } = get();
    if (!openRouterKey) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, userMsg], isTyping: true }));

    try {
      const status = await jsonFetch<any>('/api/status');
      const events = await jsonFetch<EventEntry[]>('/api/events');
      const { scenarioContext } = useSystem.getState();

      const contextHint = [
        `Active scenario: ${status.scenario}`,
        `Sessions: ${JSON.stringify(status.sessions?.detail || []).slice(0, 500)}`,
        `Open orders: ${status.orders?.open || 0} (${status.orders?.stuck || 0} stuck)`,
        `Recent events: ${JSON.stringify(events.slice(0, 5))}`,
      ].join('\n');

      // Build focused scenario context from the loaded scenario JSON
      // Only inject what the LLM needs — no fluff
      let scenarioContextMsg = '';
      if (scenarioContext) {
        const ctx = scenarioContext;
        const parts = [
          `## Active Scenario: ${ctx.title}`,
          ctx.runbook?.narrative ? `### Situation\n${ctx.runbook.narrative.slice(0, 200)}` : '',
          `### Key Problems: ${ctx.hints?.key_problems?.join('; ') || 'None'}`,
          `### Start: ${ctx.hints?.diagnosis_path || 'Check session health.'}`,
          `### Success Criteria: ${ctx.success_criteria?.length || 0} conditions`,
        ].filter(Boolean);
        scenarioContextMsg = parts.join('\n');
      }

      const msgs = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(scenarioContextMsg ? [{ role: 'system', content: scenarioContextMsg }] : []),
        { role: 'system', content: `Current system state:\n${contextHint}` },
        ...get().messages.filter((m) => m.role !== 'system').slice(-12).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ];

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title': 'FIX MCP Console',
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-plus',
          messages: msgs,
          max_tokens: 2048,
        }),
      });

      if (!resp.ok) {
        const e = await resp.text();
        throw new Error(e);
      }

      const data: { choices?: { message?: { content: string } }[] } = await resp.json();
      const reply = data.choices?.[0]?.message?.content || 'I could not process that request.';

      // Detect tool call proposals (names must match src/fix_mcp/server.py).
      const toolCalls: ToolCallTrace[] = KNOWN_TOOLS
        .filter((t) => reply.includes(t))
        .map((t) => ({ tool: t, args: {}, status: 'proposed' as const }));

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: reply,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: Date.now(),
      };

      set((s) => ({ messages: [...s.messages, assistantMsg], isTyping: false }));
    } catch (err: unknown) {
      set((s) => ({
        messages: [...s.messages, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Error: ${(err as Error).message}`,
          timestamp: Date.now(),
        }],
        isTyping: false,
      }));
    }
  },

  approveToolCall: async (msgId: string, toolIndex: number) => {
    const { callTool, refresh } = useSystem.getState();
    const msg = get().messages.find((m) => m.id === msgId);
    if (!msg?.toolCalls?.[toolIndex]) return;

    const tc = msg.toolCalls[toolIndex];
    tc.status = 'executing';
    set((s) => ({ messages: s.messages.map((m) => m.id === msgId ? { ...m } : m) }));

    try {
      const result = await callTool(tc.tool, tc.args);
      tc.status = 'success';
      tc.result = result;
      await refresh();
    } catch (err: unknown) {
      tc.status = 'error';
      tc.result = (err as Error).message;
    }

    set((s) => ({ messages: s.messages.map((m) => m.id === msgId ? { ...m } : m) }));
  },

  clear: () => set({ messages: [{ id: 'init', role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() }] }),
}));

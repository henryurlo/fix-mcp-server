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
  last_sent_seq?: number;
  last_recv_seq?: number;
  expected_recv_seq?: number;
  seq_gap?: boolean;
  error?: string;
  last_heartbeat?: string;
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
  context: string;
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

type ScenarioDef = ScenarioSummary;

export type StepStatus = 'idle' | 'running' | 'done' | 'failed';

export type ControlMode = 'human' | 'collab' | 'agent';

export interface TopologyAlert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
  autoClear: boolean;
}

export interface HostEvent {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

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
  scenarioContext: ScenarioContext | null;
  scenarioState: 'idle' | 'loading' | 'diagnosing' | 'addressing' | 'validating' | 'resolved' | 'failed';
  completedSteps: number[];
  trackedSteps: TrackedStep[];
  locked: boolean;
  controlMode: ControlMode;
  alerts: TopologyAlert[];
  hostEvents: HostEvent[];
  setStepStatus: (stepNumber: number, status: StepStatus, output?: string) => void;
  advanceStep: (stepNumber: number) => void;
  resetStepsForScenario: (steps: RunbookStep[]) => void;
  setLocked: (locked: boolean) => void;
  takeOverAsAgent: () => Promise<void>;
  releaseToHuman: () => Promise<void>;
  toggleCollab: () => Promise<void>;
  addAlert: (message: string, type: TopologyAlert['type'], autoClear?: number) => void;
  clearAlert: (id: string) => void;
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

  setStepStatus: (stepNumber: number, status: StepStatus, output?: string) => {
    set((s) => ({
      trackedSteps: s.trackedSteps.map((t) =>
        t.step === stepNumber
          ? { ...t, status, output: output ?? t.output }
          : t
      ),
    }));
  },

  advanceStep: (stepNumber: number) => {
    set((s) => {
      const idx = s.trackedSteps.findIndex((t) => t.step === stepNumber);
      if (idx === -1) return {};
      const updated = s.trackedSteps.map((t) =>
        t.step === stepNumber ? { ...t, status: 'done' as StepStatus } : t
      );
      if (idx + 1 < updated.length) {
        if (updated[idx + 1].status === 'idle') {
          updated[idx + 1] = { ...updated[idx + 1], status: 'idle' as StepStatus };
        }
      }
      return { trackedSteps: updated };
    });
  },

  /** Initialize trackedSteps from a scenario's runbook steps — ALL start as idle */
  resetStepsForScenario: (steps: RunbookStep[]) => {
    set({
      trackedSteps: steps.map((s) => ({
        ...s,
        status: 'idle' as StepStatus,
        output: '',
      })),
    });
  },

  setLocked: (locked: boolean) => {
    set({ locked });
  },

  takeOverAsAgent: async () => {
    await jsonPost('/api/mode', { mode: 'agent' });
    set({ controlMode: 'agent', mode: 'agent' });
  },

  releaseToHuman: async () => {
    await jsonPost('/api/mode', { mode: 'human' });
    set({ controlMode: 'human', mode: 'human' });
  },

  toggleCollab: async () => {
    await jsonPost('/api/mode', { mode: 'mixed' });
    set({ controlMode: 'collab', mode: 'mixed' });
  },

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

  clearAlert: (id: string) => {
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
  },

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
        last_sent_seq: s.last_sent_seq,
        last_recv_seq: s.last_recv_seq,
        expected_recv_seq: s.expected_recv_seq,
        seq_gap: s.seq_gap,
        error: s.error,
        last_heartbeat: s.last_heartbeat,
      }));

      const normalizedScenario = statusRes.scenario && statusRes.scenario !== 'clear'
        ? statusRes.scenario
        : null;

      set({
        sessions,
        orders: ordersRes ?? [],
        events: (eventsRes ?? []).slice(0, 50),
        scenario: normalizedScenario,
        available_scenarios: statusRes.available_scenarios || [],
        mode: (modeRes?.mode as SystemState['mode']) || 'human',
        controlMode: (modeRes?.mode === 'agent' ? 'agent' : modeRes?.mode === 'mixed' ? 'collab' : 'human') as ControlMode,
        open_count: statusRes.orders?.open || 0,
        stuck_count: statusRes.orders?.stuck || 0,
        connected: true,
        error: null,
        loading: false,
      });

      // Fetch scenario context on first load (Docker-initiated scenario)
      if (normalizedScenario && !get().scenarioContext) {
        try {
          const ctx = await jsonFetch<ScenarioContext>(`/api/scenario/${normalizedScenario}`);
          set({ scenarioContext: ctx, scenarioState: 'diagnosing' });
          // Only init steps once — all set to 'idle', no auto-run
          if (!get().trackedSteps.length) {
            get().resetStepsForScenario(ctx.runbook?.steps || []);
          }
        } catch { /* no context available */ }
      }

      if (!normalizedScenario && (get().scenarioContext || get().trackedSteps.length || get().completedSteps.length)) {
        set({
          scenarioContext: null,
          trackedSteps: [],
          completedSteps: [],
          scenarioState: 'idle',
          locked: false,
        });
      }
    } catch (err: unknown) {
      set({ connected: false, error: (err as Error).message });
    }
  },

  startScenario: async (name: string) => {
    set({ loading: true, scenarioState: 'loading', completedSteps: [], trackedSteps: [], alerts: [] });
    try {
      await jsonPost('/api/reset', { scenario: name });
      await get().refresh();
      try {
        const ctx = await jsonFetch<ScenarioContext>(`/api/scenario/${name}`);
        set({ scenarioContext: ctx, scenarioState: 'diagnosing', locked: true });
        // All steps 'idle' — user clicks Run for each
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

  resetScenario: async () => {
    const { scenario } = get();
    if (!scenario) return;
    set({ loading: true });
    try {
      await jsonPost('/api/reset', { scenario: 'clear' });
      await get().refresh();
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
  openWithPrompt: (content: string) => Promise<void>;
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
  openWithPrompt: async (content: string) => {
    set({ isOpen: true });
    await get().send(content);
  },

  send: async (content: string) => {
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

      let scenarioContextMsg = '';
      if (scenarioContext) {
        const ctx = scenarioContext;
        const { trackedSteps } = useSystem.getState();
        const stepSummary = trackedSteps.map((t, i) => {
          const statusEmoji = t.status === 'done' ? '✅' : t.status === 'running' ? '⏳' : t.status === 'failed' ? '❌' : '○';
          return `${statusEmoji} Step ${t.step}: ${t.title} [${t.status}]`;
        }).join('\n');
        const nextStep = trackedSteps.find((t) => t.status === 'idle');

        const parts = [
          `## Active Scenario: ${ctx.title}`,
          ctx.runbook?.narrative ? `### Situation\n${ctx.runbook.narrative.slice(0, 300)}` : '',
          `### Key Problems: ${ctx.hints?.key_problems?.join('; ') || 'None'}`,
          `### Start: ${ctx.hints?.diagnosis_path || 'Check session health.'}`,
          `### Success Criteria: ${ctx.success_criteria?.length || 0} conditions`,
          `### Runbook Steps:\n${stepSummary}`,
          nextStep
            ? `### Suggested Next Runbook Action: Step ${nextStep.step} — ${nextStep.title}. Mention this only when the user asks what to do next or approves action.`
            : '### All steps completed.',
        ].filter(Boolean);
        scenarioContextMsg = parts.join('\n');
      }

      const isBriefRequest = /\b(brief|concise|short|quick|summarize)\b/i.test(content);
      const briefGuard = isBriefRequest
        ? [{ role: 'system', content: 'The latest user message asks for a brief answer. Hard limit: 75 words. Answer the immediate question first, then ask at most one clarifying question.' }]
        : [];

      const msgs = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(scenarioContextMsg ? [{ role: 'system', content: scenarioContextMsg }] : []),
        { role: 'system', content: `Current system state:\n${contextHint}` },
        ...briefGuard,
        ...get().messages.filter((m) => m.role !== 'system').slice(-12).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ];

      const key = get().openRouterKey;

      const resp = key
        ? await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
              'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
              'X-Title': 'FIX-MCP',
            },
            body: JSON.stringify({
              model: 'openai/gpt-5.4',
              messages: msgs,
              max_tokens: isBriefRequest ? 180 : 2048,
            }),
          })
        : await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'openai/gpt-5.4',
              messages: msgs,
              max_tokens: isBriefRequest ? 180 : 2048,
            }),
          });

      if (!resp.ok) {
        const e = await resp.text();
        if (e.includes('OPENROUTER_API_KEY not configured')) {
          throw new Error('LLM is not configured. Add an OpenRouter key in the Copilot key menu or set OPENROUTER_API_KEY on the server, then rerun Investigator.');
        }
        throw new Error(e);
      }

      const data: { choices?: { message?: { content: string } }[] } = await resp.json();
      const reply = data.choices?.[0]?.message?.content || 'I could not process that request.';

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
          content: `Error: ${(err as Error).message}`,
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

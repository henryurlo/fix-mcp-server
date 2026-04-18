import { create } from 'zustand';

export interface ScenarioDefinition {
  name: string;
  title: string;
  description: string;
  background: string;
  steps: Array<{ step: number; action: string; expected_state: string }>;
  injections: Array<{
    component: string;
    fault: string;
    venue?: string;
    duration_ms: number;
    params?: Record<string, any>;
  }>;
  resolve_actions: string[];
}

export interface CreatedScenario {
  id: string;
  name: string;
  config: ScenarioDefinition;
  created_at: string;
  status: 'draft' | 'active' | 'resolved';
}

interface ScenarioCreatorState {
  // Form state
  newScenario: Partial<ScenarioDefinition>;
  createdScenarios: CreatedScenario[];
  isSubmitting: boolean;
  error: string | null;

  // Active fault injections
  activeInjections: Array<{
    id: string;
    component: string;
    fault: string;
    started_at: string;
    venue?: string;
  }>;

  // Q&A state
  qaThreads: Array<{
    id: string;
    question: string;
    answer: string;
    timestamp: string;
  }>;

  // Actions
  updateField: (field: keyof ScenarioDefinition, value: any) => void;
  addStep: () => void;
  removeStep: (index: number) => void;
  addInjection: () => void;
  removeInjection: (index: number) => void;
  updateInjection: (index: number, field: string, value: any) => void;
  submitScenario: () => Promise<void>;
  deleteScenario: (id: string) => void;
  injectFault: (config: any) => Promise<void>;
  resolveFault: (id: string) => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  clearError: () => void;
}

const emptyStep = { step: 1, action: '', expected_state: '' };
const emptyInjection = { component: 'market_data', fault: 'delay', venue: 'XNYS', duration_ms: 30000 };

export const useScenarioCreator = create<ScenarioCreatorState>((set, get) => ({
  newScenario: {
    name: '',
    title: '',
    description: '',
    background: '',
    steps: [{ ...emptyStep }],
    injections: [{ ...emptyInjection }],
    resolve_actions: [],
  },
  createdScenarios: [],
  isSubmitting: false,
  error: null,
  activeInjections: [],
  qaThreads: [],

  updateField: (field, value) => {
    set((state) => ({
      newScenario: { ...state.newScenario, [field]: value },
    }));
  },

  addStep: () => {
    set((state) => ({
      newScenario: {
        ...state.newScenario,
        steps: [
          ...state.newScenario.steps!,
          { step: state.newScenario.steps!.length + 1, action: '', expected_state: '' },
        ],
      },
    }));
  },

  removeStep: (index) => {
    set((state) => ({
      newScenario: {
        ...state.newScenario,
        steps: state.newScenario.steps!.filter((_, i) => i !== index),
      },
    }));
  },

  addInjection: () => {
    set((state) => ({
      newScenario: {
        ...state.newScenario,
        injections: [...state.newScenario.injections!, { ...emptyInjection }],
      },
    }));
  },

  removeInjection: (index) => {
    set((state) => ({
      newScenario: {
        ...state.newScenario,
        injections: state.newScenario.injections!.filter((_, i) => i !== index),
      },
    }));
  },

  updateInjection: (index, field, value) => {
    set((state) => ({
      newScenario: {
        ...state.newScenario,
        injections: state.newScenario.injections!.map((inj, i) =>
          i === index ? { ...inj, [field]: value } : inj
        ),
      },
    }));
  },

  submitScenario: async () => {
    const { newScenario } = get();
    if (!newScenario.name || !newScenario.title) {
      set({ error: 'Name and title are required' });
      return;
    }
    set({ isSubmitting: true, error: null });
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newScenario),
      });
      if (!res.ok) throw new Error('Failed to save scenario');
      const saved = await res.json();
      set((state) => ({
        createdScenarios: [
          ...state.createdScenarios,
          {
            id: saved.id || saved.name,
            name: newScenario.name!,
            config: newScenario as ScenarioDefinition,
            created_at: new Date().toISOString(),
            status: 'draft',
          },
        ],
        newScenario: {
          name: '',
          title: '',
          description: '',
          background: '',
          steps: [{ ...emptyStep }],
          injections: [{ ...emptyInjection }],
          resolve_actions: [],
        },
        isSubmitting: false,
      }));
    } catch (err: any) {
      set({ error: err.message, isSubmitting: false });
    }
  },

  deleteScenario: (id) => {
    set((state) => ({
      createdScenarios: state.createdScenarios.filter((s) => s.id !== id),
    }));
  },

  injectFault: async (config) => {
    try {
      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'inject_fault',
          args: config,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fault injection failed');
      const injectionId = `${config.component}-${config.fault}-${Date.now()}`;
      set((state) => ({
        activeInjections: [
          ...state.activeInjections,
          {
            id: injectionId,
            component: config.component,
            fault: config.fault,
            started_at: new Date().toISOString(),
            venue: config.venue,
          },
        ],
      }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  resolveFault: async (id) => {
    try {
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'resolve_fault',
          args: { injection_id: id },
        }),
      });
      set((state) => ({
        activeInjections: state.activeInjections.filter((inj) => inj.id !== id),
      }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  askQuestion: async (question: string) => {
    const { qaThreads } = get();
    // Optimistically add the question
    const threadId = `qa-${Date.now()}`;
    set((state) => ({
      qaThreads: [
        ...state.qaThreads,
        { id: threadId, question, answer: 'Thinking...', timestamp: new Date().toISOString() },
      ],
    }));
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, context: 'kb' }),
      });
      const data = await res.json();
      set((state) => ({
        qaThreads: state.qaThreads.map((t) =>
          t.id === threadId ? { ...t, answer: data.answer || data.message || 'No response' } : t
        ),
      }));
    } catch (err: any) {
      set((state) => ({
        qaThreads: state.qaThreads.map((t) =>
          t.id === threadId ? { ...t, answer: `Error: ${err.message}` } : t
        ),
      }));
    }
  },

  clearError: () => set({ error: null }),
}));

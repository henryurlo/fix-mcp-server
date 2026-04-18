import { create } from 'zustand';

export interface AuditEntry {
  id: string;
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'success' | 'error';
}

interface AuditState {
  entries: AuditEntry[];
  addEntry: (tool: string, args: Record<string, unknown>) => string; // returns id
  completeEntry: (id: string, result: string, ok: boolean) => void;
  clear: () => void;
}

const MAX_ENTRIES = 200;

export const useAudit = create<AuditState>((set) => ({
  entries: [],

  addEntry: (tool: string, args: Record<string, unknown>): string => {
    const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      entries: [
        ...s.entries.slice(-(MAX_ENTRIES - 1)),
        { id, timestamp: Date.now(), tool, args, status: 'running' },
      ],
    }));
    return id;
  },

  completeEntry: (id: string, result: string, ok: boolean) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id ? { ...e, result, status: ok ? 'success' : 'error' as AuditEntry['status'] } : e
      ),
    }));
  },

  clear: () => set({ entries: [] }),
}));

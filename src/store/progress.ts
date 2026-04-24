import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ACADEMY_MODULES, computeProgress, prerequisitesMet } from '@/data/modules';

interface LabAttempt {
  scenarioName: string;
  completedAt: number;
  durationMs: number;
  hintsUsed: number;
  stepsPassed: number;
  stepsTotal: number;
}

interface ProgressState {
  // ── Completion tracking ──
  completedLabs: string[]; // scenario names
  completedModules: string[]; // module IDs
  labAttempts: Record<string, LabAttempt>; // scenarioName → attempt record

  // ── Current session ──
  currentModuleId: string | null;
  currentLabName: string | null;
  labStartTime: number | null;

  // ── Actions ──
  startLab: (scenarioName: string, moduleId: string) => void;
  completeLab: (scenarioName: string, stepsPassed: number, stepsTotal: number, hintsUsed: number) => void;
  isLabCompleted: (scenarioName: string) => boolean;
  isModuleCompleted: (moduleId: string) => boolean;
  isModuleUnlocked: (moduleId: string) => boolean;
  getModuleProgress: (moduleId: string) => { completed: number; total: number; fraction: number };
  getOverallProgress: () => number;
  resetProgress: () => void;
}

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      completedLabs: [],
      completedModules: [],
      labAttempts: {},
      currentModuleId: null,
      currentLabName: null,
      labStartTime: null,

      startLab: (scenarioName: string, moduleId: string) => {
        set({
          currentLabName: scenarioName,
          currentModuleId: moduleId,
          labStartTime: Date.now(),
        });
      },

      completeLab: (scenarioName: string, stepsPassed: number, stepsTotal: number, hintsUsed: number) => {
        const state = get();
        if (state.completedLabs.includes(scenarioName)) return;

        const durationMs = state.labStartTime ? Date.now() - state.labStartTime : 0;
        const newCompletedLabs = [...state.completedLabs, scenarioName];
        const newAttempts = {
          ...state.labAttempts,
          [scenarioName]: { scenarioName, completedAt: Date.now(), durationMs, hintsUsed, stepsPassed, stepsTotal },
        };

        // Auto-complete modules where all labs are done
        const newCompletedModules = [...state.completedModules];
        for (const mod of ACADEMY_MODULES) {
          if (newCompletedModules.includes(mod.id)) continue;
          const allLabsDone = mod.labs.every((lab) => newCompletedLabs.includes(lab.scenarioName));
          if (allLabsDone) {
            newCompletedModules.push(mod.id);
          }
        }

        set({
          completedLabs: newCompletedLabs,
          completedModules: newCompletedModules,
          labAttempts: newAttempts,
          currentLabName: null,
          labStartTime: null,
        });
      },

      isLabCompleted: (scenarioName: string) => get().completedLabs.includes(scenarioName),

      isModuleCompleted: (moduleId: string) => get().completedModules.includes(moduleId),

      isModuleUnlocked: (moduleId: string) => {
        const mod = ACADEMY_MODULES.find((m) => m.id === moduleId);
        if (!mod) return false;
        if (mod.prerequisites.length === 0) return true;
        return prerequisitesMet(moduleId, get().completedModules);
      },

      getModuleProgress: (moduleId: string) => {
        const mod = ACADEMY_MODULES.find((m) => m.id === moduleId);
        if (!mod) return { completed: 0, total: 0, fraction: 0 };
        const completed = mod.labs.filter((lab) => get().completedLabs.includes(lab.scenarioName)).length;
        return { completed, total: mod.labs.length, fraction: mod.labs.length > 0 ? completed / mod.labs.length : 0 };
      },

      getOverallProgress: () => computeProgress(new Set(get().completedLabs)),

      resetProgress: () =>
        set({
          completedLabs: [],
          completedModules: [],
          labAttempts: {},
          currentModuleId: null,
          currentLabName: null,
          labStartTime: null,
        }),
    }),
    {
      name: 'fix-mcp-academy-progress',
      partialize: (state) => ({
        completedLabs: state.completedLabs,
        completedModules: state.completedModules,
        labAttempts: state.labAttempts,
      }),
    }
  )
);

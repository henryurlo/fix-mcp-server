'use client';

import { useState } from 'react';
import { ACADEMY_MODULES } from '@/data/modules';
import { useProgress } from '@/store/progress';
import { useSystem } from '@/store';
import {
  CheckCircle2, Clock, ChevronRight, ChevronDown,
  Play, BookOpen, BarChart3, AlertTriangle, SignalHigh, SignalMedium, SignalLow,
  BriefcaseBusiness, RotateCcw, Filter,
} from 'lucide-react';

const DIFF_ICON: Record<string, typeof SignalLow> = {
  beginner: SignalLow,
  intermediate: SignalMedium,
  advanced: SignalHigh,
};

const DIFF_COLOR: Record<string, string> = {
  beginner: 'var(--green)',
  intermediate: 'var(--amber)',
  advanced: 'var(--red)',
};

const DIFF_BG: Record<string, string> = {
  beginner: 'var(--green-dim)',
  intermediate: 'var(--amber-dim)',
  advanced: 'var(--red-dim)',
};

const SEV_COLOR: Record<string, string> = {
  low: 'var(--green)',
  medium: 'var(--amber)',
  high: 'var(--red)',
  critical: 'var(--purple)',
};

const SEV_BG: Record<string, string> = {
  low: 'var(--green-dim)',
  medium: 'var(--amber-dim)',
  high: 'var(--red-dim)',
  critical: 'var(--purple-dim)',
};

export default function LearningPath({ onStartLab }: { onStartLab: (scenarioName: string, moduleId: string) => void }) {
  const { completedLabs, completedModules, isModuleUnlocked, getModuleProgress, resetProgress } = useProgress();
  const { available_scenarios } = useSystem();
  const [expandedModule, setExpandedModule] = useState<string | null>('m1-fix-fundamentals');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const overallProgress = useProgress.getState().getOverallProgress();

  const totalLabs = ACADEMY_MODULES.reduce((s, m) => s + m.labs.length, 0);
  const completedCount = completedLabs.length;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-void)]">
      <div className="max-w-7xl mx-auto p-6 space-y-5">
        {/* ── Hero ── */}
        <div className="rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BriefcaseBusiness size={17} className="text-[var(--cyan)]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--cyan)]">Incident Program</span>
              </div>
              <h1 className="text-[26px] font-bold text-[var(--text-primary)] leading-tight">
                Select any desk incident. No locked path.
              </h1>
              <p className="mt-2 text-[15px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                Use this as a professional demo catalog, not a course gate. Pick the scenario that fits the audience: FIX basics for first contact, venue outages for trading ops, or compound failures for executives and senior engineers.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[var(--text-dim)]"><Filter size={12} /> Filter</span>
                {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setDifficultyFilter(filter)}
                    className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                      difficultyFilter === filter
                        ? 'border-[var(--cyan)] bg-[var(--cyan-dim)] text-[var(--cyan)]'
                        : 'border-[var(--border-dim)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-bright)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[200px]">
              <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">Overall Progress</div>
                <div className="flex items-end gap-2 mt-1">
                  <span className="text-[28px] font-bold text-[var(--text-primary)]">{Math.round(overallProgress * 100)}%</span>
                  <span className="text-[13px] text-[var(--text-muted)] mb-1">{completedCount}/{totalLabs} labs</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--bg-void)] overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--cyan)] transition-all" style={{ width: `${overallProgress * 100}%` }} />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3 text-center">
                  <div className="text-[20px] font-bold text-[var(--text-primary)]">{completedModules.length}</div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Paths Done</div>
                </div>
                <div className="flex-1 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3 text-center">
                  <div className="text-[20px] font-bold text-[var(--text-primary)]">{ACADEMY_MODULES.length}</div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Module Grid ── */}
        <div className="space-y-4">
          {ACADEMY_MODULES.map((mod) => {
            const unlocked = true;
            const completed = completedModules.includes(mod.id);
            const progress = getModuleProgress(mod.id);
            const isExpanded = expandedModule === mod.id;
            const DiffIcon = DIFF_ICON[mod.difficulty];
            const visibleLabs = mod.labs.filter((lab) => difficultyFilter === 'all' || lab.difficulty === difficultyFilter);
            if (visibleLabs.length === 0) return null;

            return (
              <div
                key={mod.id}
                className={`rounded-xl border transition-all ${
                  completed
                    ? 'border-[var(--green)]/30 bg-[var(--green)]/5'
                  : 'border-[var(--border-base)] bg-[var(--bg-base)] hover:border-[var(--cyan)]/40'
                }`}
              >
                {/* Module header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedModule(isExpanded ? null : mod.id)}
                >
                  <div className="shrink-0">
                    {completed ? (
                      <div className="w-10 h-10 rounded-md bg-[var(--green-dim)] border border-[var(--green)]/30 flex items-center justify-center">
                        <CheckCircle2 size={18} className="text-[var(--green)]" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-[var(--cyan-dim)] border border-[var(--cyan)]/30 flex items-center justify-center">
                        <span className="text-[14px] font-bold text-[var(--cyan)]">M{mod.number}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[16px] font-bold text-[var(--text-primary)]">{mod.title}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                        style={{ backgroundColor: DIFF_BG[mod.difficulty], color: DIFF_COLOR[mod.difficulty] }}
                      >
                        {mod.difficulty}
                      </span>
                      {completed && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[var(--green-dim)] text-[var(--green)]">
                          Completed
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-[var(--text-secondary)]">{mod.subtitle}</div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1"><BookOpen size={10} /> {mod.labs.length} labs</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> ~{mod.estimatedHours}h</span>
                      <span className="flex items-center gap-1"><DiffIcon size={10} /> {mod.difficulty}</span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    {/* Progress mini */}
                    <div className="text-right">
                      <div className="text-[12px] font-mono text-[var(--text-muted)]">{progress.completed}/{progress.total}</div>
                      <div className="w-20 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden mt-1">
                        <div
                          className="h-full rounded-full bg-[var(--cyan)] transition-all"
                          style={{ width: `${progress.fraction * 100}%` }}
                        />
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown size={16} className="text-[var(--text-dim)]" /> : <ChevronRight size={16} className="text-[var(--text-dim)]" />}
                  </div>
                </div>

                {/* Expanded: labs + concepts */}
                {isExpanded && (
                  <div className="border-t border-[var(--border-dim)] px-5 pb-5">
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mt-4 mb-4">{mod.description}</p>

                    {/* Concepts */}
                    <div className="mb-4">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] mb-2">Operational concepts</div>
                      <div className="flex flex-wrap gap-1.5">
                        {mod.concepts.map((c) => (
                          <span key={c} className="px-2 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-dim)] text-[11px] text-[var(--text-secondary)]">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Labs */}
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] mb-1">Incident runs</div>
                      {visibleLabs.map((lab) => {
                        const isCompleted = completedLabs.includes(lab.scenarioName);
                        const scenarioMeta = available_scenarios?.find((s: any) => s.name === lab.scenarioName);

                        return (
                          <button
                            key={lab.scenarioName}
                            onClick={() => {
                              onStartLab(lab.scenarioName, mod.id);
                            }}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
                              isCompleted
                                ? 'bg-[var(--green)]/5 border border-[var(--green)]/20 hover:bg-[var(--green)]/10'
                                : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--cyan)]/40 hover:bg-[var(--bg-base)]'
                            }`}
                          >
                            <div className="shrink-0">
                              {isCompleted ? (
                                <CheckCircle2 size={16} className="text-[var(--green)]" />
                              ) : (
                                <Play size={14} className="text-[var(--text-dim)]" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[13px] font-semibold ${isCompleted ? 'text-[var(--green)]' : 'text-[var(--text-primary)]'}`}>
                                  {lab.title}
                                </span>
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                                  style={{ backgroundColor: SEV_BG[lab.severity], color: SEV_COLOR[lab.severity] }}
                                >
                                  {lab.severity}
                                </span>
                              </div>
                              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mt-0.5">{lab.description}</p>
                              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                                <span className="flex items-center gap-1"><Clock size={9} /> {lab.estimatedMinutes}m</span>
                                <span>{lab.stepCount} steps</span>
                                <span className="flex items-center gap-1">
                                  <BarChart3 size={9} /> {lab.difficulty}
                                </span>
                                {scenarioMeta && (
                                  <span className="text-[var(--cyan)]">{scenarioMeta.categories?.join(' · ')}</span>
                                )}
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {lab.concepts.slice(0, 3).map((c) => (
                                  <span key={c} className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[9px] text-[var(--text-dim)] border border-[var(--border-dim)]">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <ChevronRight size={14} className="text-[var(--text-dim)] shrink-0" />
                          </button>
                        );
                      })}
                    </div>

                    {/* Prerequisites notice */}
                    {false && mod.prerequisites.length > 0 && (
                      <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--amber)]">
                        <AlertTriangle size={12} />
                        <span>Complete {mod.prerequisites.map((p) => `M${ACADEMY_MODULES.find((m) => m.id === p)?.number}`).join(', ')} to unlock.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reset */}
        {completedCount > 0 && (
          <div className="flex justify-center pt-4">
            <button
              onClick={() => {
                if (confirm('Reset all academy progress? This cannot be undone.')) {
                  resetProgress();
                }
              }}
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-dim)] hover:text-[var(--red)] transition-colors"
            >
              <RotateCcw size={12} /> Reset Progress
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

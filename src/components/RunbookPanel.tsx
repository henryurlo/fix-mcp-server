'use client';

import React, { useState } from 'react';
import { useSystem, useChat, RunbookStep, TrackedStep, type StepStatus } from '@/store';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Radio,
  AlertTriangle,
  BookOpen,
  Wrench,
  Terminal,
  ChevronRight,
  Play,
  ArrowRight,
} from 'lucide-react';

const STATUS_CONFIG: Record<StepStatus, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  idle: {
    icon: <ChevronRight size={12} />,
    color: 'var(--text-dim)',
    bg: 'var(--bg-surface)',
    label: 'WAITING',
  },
  running: {
    icon: <Loader2 size={12} className="animate-spin" />,
    color: 'var(--cyan)',
    bg: 'var(--cyan-dim)',
    label: 'RUNNING',
  },
  done: {
    icon: <CheckCircle2 size={12} />,
    color: 'var(--green)',
    bg: 'var(--green-dim)',
    label: 'DONE',
  },
  failed: {
    icon: <XCircle size={12} />,
    color: 'var(--red)',
    bg: 'var(--red-dim)',
    label: 'FAILED',
  },
};

interface RunbookPanelProps {
  scenarioContext: any;
  scenario: string | null;
}

export default function RunbookPanel({ scenarioContext, scenario }: RunbookPanelProps) {
  const { callTool, completeStep, trackedSteps, setStepStatus, advanceStep, addHostEvent, addAlert } = useSystem();
  const { isOpen, toggleOpen, send } = useChat();
  const [activeStepIdx, setActiveStepIdx] = useState(0);

  if (!scenarioContext && !scenario) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
        <BookOpen size={24} className="text-[var(--text-dim)] mb-2" />
        <p className="text-[13px] text-[var(--text-muted)]">Select a scenario to see the runbook.</p>
      </div>
    );
  }

  const totalSteps = trackedSteps.length || scenarioContext?.runbook?.steps?.length || 0;
  const doneCount = trackedSteps.filter((s) => s.status === 'done').length;
  const allDone = doneCount === totalSteps && totalSteps > 0;
  const activeScenarioName = scenario || scenarioContext?.name || '';
  const displayTitle = scenarioContext
    ? scenarioContext.title.toUpperCase()
    : activeScenarioName.replace(/_/g, ' ').toUpperCase();

  const handleRunStep = async (step: TrackedStep | RunbookStep, index: number) => {
    if ('status' in step && step.status === 'running') return; // prevent double-run

    // Set running
    if ('step' in step) {
      setStepStatus(step.step, 'running');
    }
    setActiveStepIdx(index);

    try {
      const result = await callTool(step.tool, step.tool_args);
      // Mark done
      setStepStatus(step.step, 'done', result);
      completeStep(step.step);
      addHostEvent('step_complete', `Step ${step.step} "${step.title}" completed`, 'info');

      // Auto-advance: set next step to running
      if (index + 1 < trackedSteps.length) {
        advanceStep(step.step);
        addAlert(`Step ${step.step} done → advancing to step ${step.step + 1}`, 'success', 4000);
      } else {
        addAlert('All steps complete! Scenario resolved.', 'success', 6000);
      }
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      addHostEvent('step_failed', `Step ${step.step} "${step.title}" failed: ${err.message}`, 'error');
      addAlert(`Step ${step.step} failed: ${err.message}`, 'error', 8000);
    }
  };

  // Determine which steps array to use - always cast to TrackedStep for consistent typing
  const steps: TrackedStep[] = (trackedSteps.length > 0
    ? trackedSteps
    : (scenarioContext?.runbook?.steps?.map((s: RunbookStep, i: number): TrackedStep => ({
        ...s,
        status: (i === 0 ? 'running' : 'pending') as StepStatus,
        output: '',
      })) || [])
  ) as TrackedStep[];

  /* ---- Phase calculation ---- */
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
  const PHASES = [
    { key: 'diagnosing', label: 'DIAGNOSE', icon: '🔍' },
    { key: 'addressing', label: 'ADDRESS', icon: '🔧' },
    { key: 'validating', label: 'VALIDATE', icon: '✅' },
    { key: 'resolved', label: 'RESOLVED', icon: '🟢' },
  ];
  const isResolved = allDone;
  const currentPhaseIdx = isResolved ? 3 : doneCount === 0 ? 0 : doneCount < totalSteps * 0.4 ? 0 : doneCount < totalSteps * 0.8 ? 1 : 2;
  const currentPhase = PHASES[currentPhaseIdx];

  const DIFFICULTY_LABELS: Record<string, string> = {
    beginner: '●',
    intermediate: '●●',
    advanced: '●●●',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Scenario header */}
      <div className="px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${scenario ? 'active' : ''} w-1.5 h-1.5`} />
          <span className="text-[12px] font-bold text-[var(--cyan)] uppercase tracking-wider">
            {scenario ? 'Active' : 'Preview'}
          </span>
          {allDone && (
            <span className="text-[12px] font-bold text-[var(--green)] uppercase tracking-wider flex items-center gap-0.5">
              ✓ RESOLVED
            </span>
          )}
          <span className="ml-auto text-[11px] font-mono text-[var(--text-dim)]">{doneCount}/{totalSteps} ({pct}%)</span>
        </div>
        <h3 className="text-[14px] font-bold mt-0.5">{displayTitle}</h3>

        {/* Phase progress bar */}
        {totalSteps > 0 && (
          <div className="flex items-center gap-1 mt-2 px-1">
            <span className="text-[13px]">{currentPhase.icon}</span>
            <div className="flex-1 flex items-center gap-0.5 h-2">
              {PHASES.map((p, i) => (
                <div key={p.key} className="flex-1 flex flex-col items-center">
                  <div className={`h-1.5 rounded-full w-full transition-all duration-500 ${
                    i <= currentPhaseIdx ? (isResolved ? 'bg-[var(--green)]' : 'bg-[var(--cyan)]') : 'bg-[var(--border-dim)]'
                  }`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {scenarioContext && (
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              {scenarioContext.simulated_time}
            </span>
            <span className="text-[11px] font-mono text-[var(--text-dim)]">
              {scenarioContext.estimated_minutes}m · {scenarioContext.estimated_minutes < 20 ? 'Quick' : scenarioContext.estimated_minutes < 30 ? 'Moderate' : 'Extended'}
            </span>
            <span className="text-[11px] font-mono text-[var(--text-dim)]">
              {DIFFICULTY_LABELS[scenarioContext.difficulty] || ''} {scenarioContext.difficulty}
            </span>
          </div>
        )}

        {scenarioContext?.hints?.key_problems && scenarioContext.hints.key_problems.length > 0 && (
          <div className="mt-2 space-y-1">
            {scenarioContext.hints.key_problems.map((p: string, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--red)] leading-relaxed">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{p}</span>
              </div>
            ))}
          </div>
        )}

        {scenarioContext?.runbook?.narrative && (
          <p className="text-[12px] text-[var(--text-secondary)] mt-2 leading-relaxed">{scenarioContext.runbook.narrative}</p>
        )}
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {steps.map((step, i) => {
            const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG.idle;
            const isActive = activeStepIdx === i;

            return (
              <div
                key={i}
                onClick={() => setActiveStepIdx(i)}
                className={`p-2 rounded border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--cyan-dim)] border-[var(--cyan)]/30'
                    : step.status === 'done'
                      ? 'bg-[var(--green)]/5 border-[var(--green)]/20'
                      : step.status === 'failed'
                        ? 'bg-[var(--red)]/5 border-[var(--red)]/20'
                        : 'bg-[var(--bg-surface)] border-[var(--border-dim)] hover:border-[var(--border-base)]'
                }`}
              >
                {/* Step header */}
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: sc.color }}>{sc.icon}</span>
                  <span className="text-[13px] font-bold text-[var(--text-primary)]">#{step.step} {step.title}</span>
                  <span
                    className="ml-auto text-[10px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{ color: sc.color, backgroundColor: sc.bg }}
                  >
                    {sc.label}
                  </span>
                </div>

                {/* Narrative */}
                <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-1.5">
                  {step.narrative}
                </div>

                {/* CLI command */}
                <div className="bg-[var(--bg-void)] rounded px-2 py-1 mb-1.5">
                  <code className="text-[12px] font-mono text-[var(--green)]">
                    fix-cli&gt; {step.tool}{Object.keys(step.tool_args || {}).length ? ` ${JSON.stringify(step.tool_args)}` : ''}
                  </code>
                </div>

                {/* Run button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRunStep(step as TrackedStep, i);
                  }}
                  disabled={step.status === 'running'}
                  className="w-full btn-secondary !text-[12px] !py-0.5 !px-2 flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {step.status === 'running' ? (
                    <><Loader2 size={9} className="animate-spin" /> Running...</>
                  ) : (
                    <><Activity size={9} /> Run {step.tool}</>
                  )}
                </button>

                {/* Step output */}
                {step.output && (
                  <div className={`mt-1 text-[14px] font-mono leading-relaxed ${
                    step.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--green)]'
                  }`}>
                    → {step.output.slice(0, 300)}{step.output.length > 300 ? '…' : ''}
                  </div>
                )}

                {/* Expected */}
                <p className="text-[14px] text-[var(--text-dim)] mt-1">
                  Expected: {step.expected}
                </p>
              </div>
            );
          })}

          {/* Success Criteria */}
          {scenarioContext?.success_criteria && scenarioContext.success_criteria.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border-dim)]">
              <div className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                ✓ Success Criteria ({doneCount}/{scenarioContext.success_criteria.length} complete)
              </div>
              <div className="space-y-1">
                {doneCount > 0 && scenarioContext.success_criteria.map((c: string, i: number) => {
                  const isComplete = i < doneCount;
                  return (
                    <div key={i} className={`text-[14px] font-mono flex items-start gap-1 ${isComplete ? 'text-[var(--green)]' : 'text-[var(--text-dim)]'}`}>
                      <span>{isComplete ? '✓' : '○'}</span>
                      <span>{c}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="px-2 py-2 border-t border-[var(--border-dim)] shrink-0">
        <div className="flex gap-1.5">
          <button
            onClick={() => {
              const currentStep = steps[activeStepIdx] || steps[0];
              if (currentStep) handleRunStep(currentStep as TrackedStep, activeStepIdx);
            }}
            className="btn-secondary flex-1 flex items-center justify-center gap-1 text-[12px]"
          >
            <Wrench size={10} /> Run Step
          </button>
          <button
            onClick={() => {
              const currentStep = steps[activeStepIdx];
              if (!isOpen) toggleOpen();
              send(`I'm on step ${activeStepIdx + 1} of the ${displayTitle} runbook: "${currentStep?.title}"`);
            }}
            className="btn-primary flex-1 flex items-center justify-center gap-1 text-[12px]"
          >
            <Terminal size={10} /> Copilot
          </button>
        </div>
      </div>
    </div>
  );
}

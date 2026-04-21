'use client';

import React, { useState } from 'react';
import { useSystem, useChat, RunbookStep, TrackedStep } from '@/store';
import {
  Activity, CheckCircle2, XCircle, Loader2, BookOpen, Terminal, ChevronDown,
  AlertTriangle, Lightbulb, PlayCircle, Eye, EyeOff, Target,
} from 'lucide-react';

const SC: Record<string, { icon: React.ReactNode; bg: string; label: string }> = {
  idle: { icon: <ChevronDown size={12} />, bg: 'var(--bg-surface)', label: 'WAITING' },
  running: { icon: <Loader2 size={12} className="animate-spin" />, bg: 'var(--cyan-dim)', label: 'RUNNING' },
  done: { icon: <CheckCircle2 size={12} />, bg: 'var(--green-dim)', label: 'DONE' },
  failed: { icon: <XCircle size={12} />, bg: 'var(--red-dim)', label: 'FAILED' },
};

export default function RunbookPanel({ scenarioContext, scenario }: { scenarioContext: any; scenario: string | null }) {
  const { callTool, completeStep, trackedSteps, setStepStatus, addHostEvent } = useSystem();
  const { isOpen, toggleOpen, send } = useChat();

  if (!scenarioContext) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <BookOpen size={32} className="text-[var(--text-dim)] mb-3" />
        <p className="text-[13px] text-[var(--text-muted)] mb-1">No active scenario</p>
        <p className="text-[12px] text-[var(--text-dim)]">Select a scenario from the dropdown</p>
      </div>
    );
  }

  const { runbook, hints, success_criteria } = scenarioContext;
  const totalSteps = trackedSteps.length > 0 ? trackedSteps.length : runbook?.steps?.length || 0;
  const doneCount = trackedSteps.filter((s) => s.status === 'done').length;
  const donePct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

  const steps = trackedSteps.length > 0
    ? trackedSteps.map((t: any) => ({ ...t, output: t.output || '' }))
    : (runbook?.steps || []).map((s: RunbookStep, i: number) => ({ ...s, status: (i === 0 ? 'idle' : 'idle'), output: '' }));

  const currentIdx = steps.findIndex((s: any) => s.status === 'idle' || s.status === 'running');
  const [expanded, setExpanded] = useState<Set<number>>(new Set([Math.max(0, currentIdx)]));
  const [showHints, setShowHints] = useState<Set<number>>(new Set());
  const [showProblems, setShowProblems] = useState(false);

  function toggleExp(n: number) {
    setExpanded(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }
  function toggleHint(n: number) {
    setShowHints(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  }
  function toggleAllHints() {
    setShowHints(prev => prev.size > 0 ? new Set() : new Set(steps.map((_: any, i: number) => i)));
  }

  async function runStep(step: typeof steps[0], idx: number) {
    if (step.status === 'running' || step.status === 'done') return;
    setStepStatus(step.step, 'running');
    try {
      const result = await callTool(step.tool, step.tool_args);
      setStepStatus(step.step, 'done', result);
      completeStep(step.step);
      setExpanded(prev => { const next = new Set(prev); next.add(idx + 1 > 0 ? Math.min(idx + 1, steps.length - 1) : 0); return next; });
      addHostEvent('step_complete', `Step ${step.step} completed`, 'info');
    } catch (err: any) {
      setStepStatus(step.step, 'failed', err.message);
      addHostEvent('step_failed', `Step ${step.step} failed: ${err.message}`, 'error');
    }
  }

  const keyProblems = hints?.key_problems || [];
  const diagnosisPath = hints?.diagnosis_path || '';
  const isAllDone = doneCount >= totalSteps && totalSteps > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ═══ HEADER ═══ */}
      <div className="px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${scenario ? 'bg-[var(--green)] animate-pulse' : 'bg-[var(--text-dim)]'}`} />
            <span className="text-[11px] font-mono font-bold text-[var(--text-muted)]">
              {doneCount}/{totalSteps} ({donePct}%)
            </span>
          </div>
          {scenario && (
            <button onClick={toggleAllHints}
              className="text-[10px] font-mono text-[var(--amber)] hover:text-[var(--amber)]/80 flex items-center gap-1 px-1 py-0.5 rounded">
              {showHints.size > 0 ? <><EyeOff size={9} /> Hide Hints</> : <><Eye size={9} /> Show Hints</>}
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center gap-0.5 mt-1.5 h-1.5">
          {steps.map((s: any, i: number) => (
            <div key={i} className="flex-1 h-full rounded-sm transition-colors"
              style={{
                backgroundColor: s.status === 'done' ? 'var(--green)' : s.status === 'failed' ? 'var(--red)' :
                  s.status === 'running' ? 'var(--cyan)' : i === currentIdx ? 'var(--cyan)' : 'var(--border-dim)',
                opacity: s.status === 'idle' && i > currentIdx ? 0.4 : 1,
              }} />
          ))}
        </div>

        {/* Key problems accordion */}
        {keyProblems.length > 0 && (
          <button onClick={() => setShowProblems(p => !p)}
            className={`mt-2 w-full flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${showProblems ? 'bg-[var(--amber-dim)]/20 text-[var(--amber)] border border-[var(--amber)]/30' : 'bg-[var(--bg-void)] text-[var(--text-muted)] border border-[var(--border-dim)] hover:border-[var(--amber)]/30'}`}>
            <AlertTriangle size={10} className="shrink-0" />
            <span className="font-bold">{keyProblems.length} Issues</span>
            <ChevronDown size={10} className={`ml-auto transition-transform ${showProblems ? 'rotate-180' : ''}`} />
          </button>
        )}
        {showProblems && (
          <div className="mt-1 space-y-0.5 px-1">
            {keyProblems.map((p: string, i: number) => (
              <div key={i} className="text-[10px] text-[var(--red)] flex items-start gap-1 leading-relaxed">
                <span className="shrink-0">•</span><span>{p}</span>
              </div>
            ))}
            {diagnosisPath && (
              <div className="mt-1 text-[10px] text-[var(--cyan)] flex items-start gap-1 bg-[var(--cyan-dim)]/10 rounded px-2 py-1 leading-relaxed">
                <Lightbulb size={10} className="shrink-0 mt-0.5" /><span>{diagnosisPath}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ STEPS ═══ */}
      <div className="flex-1 overflow-y-auto">
        {steps.map((step: any, i: number) => {
          const sc = SC[step.status] || SC.idle;
          const isExpanded = expanded.has(i);
          const showHint = showHints.has(i);
          const isCurrent = i === currentIdx;
          const isPast = step.status === 'done';

          return (
            <div key={step.step} className={`border-b border-[var(--border-dim)] transition-all ${
              isPast ? 'opacity-70' : isCurrent ? 'bg-[var(--cyan)]/5' : ''
            }`}>
              {/* Clickable step header */}
              <button onClick={() => toggleExp(i)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-elevated)]/50 transition-colors">
                <span style={{ color: step.status === 'done' ? 'var(--green)' : 'var(--text-dim)' }} className="shrink-0">
                  {sc.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-bold ${
                      isPast ? 'text-[var(--green)]' : isCurrent ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}>
                      #{step.step} {step.title || ''}
                    </span>
                    {isCurrent && (
                      <span className="text-[8px] font-bold uppercase px-1 py-0 rounded shrink-0" style={{ color: sc.label === 'RUNNING' ? 'var(--cyan)' : 'var(--amber)', backgroundColor: sc.bg }}>
                        {sc.label}
                      </span>
                    )}
                    {isPast && <span className="text-[8px] font-bold uppercase px-1 py-0 rounded shrink-0" style={{ color: 'var(--green)', backgroundColor: 'var(--green-dim)' }}>DONE</span>}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0 truncate">{step.expected}</div>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-0">
                  <div className="flex items-start gap-1.5 mb-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    <Target size={11} className="shrink-0 mt-0.5 text-[var(--cyan)]" />
                    <span>{step.narrative}</span>
                  </div>

                  <div className="bg-[var(--bg-void)] rounded-md px-2 py-1.5 mb-2">
                    <span className="text-[9px] font-mono text-[var(--text-muted)]">CMD: </span>
                    <code className="text-[10px] font-mono text-[var(--green)]">{step.tool}{Object.keys(step.tool_args ?? {}).length > 0 ? ' ' + JSON.stringify(step.tool_args) : ''}</code>
                  </div>

                  <div className="text-[10px] mb-2 bg-[var(--amber-dim)]/5 rounded px-2 py-1 flex items-start gap-1 leading-relaxed">
                    <span className="shrink-0 font-bold text-[var(--amber)]">Expected:</span><span>{step.expected}</span>
                  </div>

                  {step.status === 'idle' && (
                    <button onClick={() => runStep(step, i)}
                      className="w-full py-1.5 rounded-md bg-[var(--cyan)] text-black text-[11px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-1.5">
                      <PlayCircle size={12} /> Run This Step
                    </button>
                  )}
                  {step.status === 'running' && (
                    <button disabled className="w-full py-1.5 rounded-md bg-[var(--cyan-dim)] text-[var(--cyan)] text-[11px] font-bold flex items-center justify-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> Running...
                    </button>
                  )}
                  {step.output && (
                    <div className={`mt-2 text-[10px] font-mono leading-relaxed rounded px-2 py-1 ${
                      step.status === 'failed' ? 'bg-[var(--red-dim)]/5 text-[var(--red)]' : 'bg-[var(--green-dim)]/5 text-[var(--green)]'
                    }`}>
                      → {step.output.slice(0, 400)}{step.output.length > 400 ? '...' : ''}
                    </div>
                  )}

                  <button onClick={() => toggleHint(i)}
                    className="mt-2 flex items-center gap-1 text-[10px] text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors">
                    {showHint ? <><EyeOff size={9} /> Hide Hint</> : <><Eye size={9} /> Show Hint</>}
                  </button>

                  {showHint && hints && (
                    <div className="mt-1.5 p-2 rounded-md bg-[var(--amber-dim)]/10 border border-[var(--amber)]/20 text-[10px] space-y-1 leading-relaxed">
                      {hints.key_problems?.[i] && <div><span className="text-[var(--red)] font-bold">Problem:</span> {hints.key_problems[i]}</div>}
                      {hints.diagnosis_path && <div><span className="text-[var(--cyan)] font-bold">💡 Hint:</span> {hints.diagnosis_path}</div>}
                      {hints.common_mistakes?.[i] && <div><span className="text-[var(--amber)] font-bold">⚠️ Avoid:</span> {hints.common_mistakes[i]}</div>}
                      {hints.flag_meanings && Object.keys(hints.flag_meanings).length > 0 && (
                        <div className="text-[var(--text-muted)]">
                          <span className="font-bold">Flags:</span> {Object.entries(hints.flag_meanings as Record<string, string>).map(([k, v], j) => <span key={k}> {k}: {v}{j < Object.keys(hints.flag_meanings).length - 1 ? ' |' : ''}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Success Criteria */}
        {success_criteria?.length > 0 && isAllDone && (
          <div className="px-3 py-2 bg-[var(--green-dim)]/10 border-t border-[var(--green)]/30">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={13} className="text-[var(--green)]" /><span className="text-[11px] font-bold text-[var(--green)]">All Steps Complete</span></div>
            {success_criteria.map((c: string, i: number) => (
              <div key={i} className="text-[10px] font-mono text-[var(--green)] leading-relaxed pl-4 flex items-start gap-1 mb-0.5">
                <span>✓</span><span>{c}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ BOTTOM BAR ═══ */}
      <div className="px-3 py-2 bg-[var(--bg-surface)] border-t border-[var(--border-dim)] shrink-0">
        <div className="flex gap-2">
          {currentIdx >= 0 && steps[currentIdx]?.status === 'idle' && (
            <button onClick={() => runStep(steps[currentIdx], currentIdx)}
              className="flex-1 py-1.5 rounded-md bg-[var(--cyan)] text-black text-[11px] font-bold hover:bg-[var(--cyan)]/80 flex items-center justify-center gap-1.5">
              <PlayCircle size={12} /> Run Next Step
            </button>
          )}
          <button onClick={() => {
              if (!isOpen) toggleOpen();
              send(`Scenario: ${scenarioContext.title}. Current step ${currentIdx + 1}: "${steps[currentIdx]?.title}". Guide me.`);
            }}
            className="py-1.5 px-3 rounded-md bg-[var(--bg-elevated)] text-[var(--cyan)] text-[11px] font-bold border border-[var(--cyan)]/30 hover:bg-[var(--cyan-dim)]/30 flex items-center gap-1.5">
            <Terminal size={12} /> Copilot
          </button>
        </div>
      </div>
    </div>
  );
}

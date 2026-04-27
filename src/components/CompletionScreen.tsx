'use client';

import { Clock, CheckCircle2, FileText, Play, Activity, ClipboardCheck } from 'lucide-react';
import type { TrackedStep } from '@/store';

function CompletionScreen({ steps, hintsUsed, startTime, summary, onClose, onNewScenario, onReviewEvidence }: {
  steps: TrackedStep[];
  hintsUsed: number;
  startTime: number;
  summary: string;
  onClose: () => void;
  onNewScenario: () => void;
  onReviewEvidence: () => void;
}) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const totalSteps = steps.length;
  const doneSteps = steps.filter(s => s.status === 'done').length;
  const hintsUsedCount = hintsUsed;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-base)] border border-[var(--border-bright)] rounded-lg p-6 max-w-xl w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5">
          <div className="w-12 h-12 rounded-md bg-[var(--green-dim)] border border-[var(--green)]/30 flex items-center justify-center mb-4">
            <ClipboardCheck size={25} className="text-[var(--green)]" />
          </div>
          <h2 className="text-[22px] font-bold text-[var(--text-primary)] mb-1">Incident Resolved</h2>
          <p className="text-[14px] text-[var(--text-muted)]">The workbook completed and produced MCP evidence for all {totalSteps} steps.</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border-dim)]">
            <Clock size={20} className="text-[var(--cyan)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{mins > 0 ? `${mins}m ` : ''}{secs}s</div>
            <div className="text-[12px] text-[var(--text-muted)]">Time Taken</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border-dim)]">
            <CheckCircle2 size={20} className="text-[var(--green)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{doneSteps}/{totalSteps}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Steps Done</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-lg p-3 border border-[var(--border-dim)]">
            <Activity size={20} className="text-[var(--amber)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{hintsUsedCount}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Operator Assists</div>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-[var(--green)]/30 bg-[var(--green-dim)]/10 p-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
          {summary}
        </div>

        <div className="flex gap-3">
          <button onClick={onReviewEvidence}
            className="flex-1 py-3 rounded-md bg-[var(--green)] text-white text-[14px] font-bold hover:bg-[var(--green)]/80 transition-colors flex items-center justify-center gap-2">
            <FileText size={16} /> Review Evidence
          </button>
          <button onClick={onNewScenario}
            className="flex-1 py-3 rounded-md bg-[var(--cyan)] text-white text-[14px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-2">
            <Play size={16} fill="currentColor" /> New Scenario
          </button>
          <button onClick={onClose}
            className="px-4 py-3 rounded-md bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-dim)] text-[14px] font-semibold hover:bg-[var(--bg-elevated)] transition-colors flex items-center gap-2">
            <Activity size={16} /> Continue
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 justify-center text-[12px] text-[var(--text-dim)]">
          <span>Press <kbd className="px-1.5 py-0.5 bg-[var(--bg-void)] rounded text-[11px] font-mono border border-[var(--border-dim)]">Esc</kbd> to continue</span>
        </div>
      </div>
    </div>
  );
}

export default CompletionScreen;

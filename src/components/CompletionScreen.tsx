'use client';

import { Clock, CheckCircle2, Lightbulb, Trophy, FileText, Play, Activity, Star } from 'lucide-react';
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
  // Rating: clean = 3 stars, 1 hint = 2 stars, 2+ hints = 1 star
  const rating = hintsUsedCount === 0 ? 3 : hintsUsedCount === 1 ? 2 : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-bright)] rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto mb-4">
            <Trophy size={32} className="text-[var(--green)]" />
          </div>
          <h2 className="text-[24px] font-bold text-[var(--green)] mb-1">Case Complete!</h2>
          <p className="text-[15px] text-[var(--text-muted)]">You&#39;ve resolved all {totalSteps} steps successfully.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <Clock size={20} className="text-[var(--cyan)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{mins > 0 ? `${mins}m ` : ''}{secs}s</div>
            <div className="text-[12px] text-[var(--text-muted)]">Time Taken</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <CheckCircle2 size={20} className="text-[var(--green)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{doneSteps}/{totalSteps}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Steps Done</div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-center border border-[var(--border-dim)]">
            <Lightbulb size={20} className="text-[var(--amber)] mx-auto mb-1" />
            <div className="text-[18px] font-bold font-mono">{hintsUsedCount}</div>
            <div className="text-[12px] text-[var(--text-muted)]">Hints Used</div>
          </div>
        </div>

        <div className="text-center mb-5">
          <div className="text-[14px] text-[var(--text-muted)] mb-2">Performance Rating</div>
          <div className="flex items-center justify-center gap-1">
            {[1, 2, 3].map(i => (
              <Star key={i} size={28} className={i <= rating ? 'text-[var(--amber)] fill-[var(--amber)]' : 'text-[var(--text-dim)]'} />
            ))}
          </div>
          <div className="text-[14px] text-[var(--text-secondary)] mt-1">
            {rating === 3 ? '🔥 Clean Completion — No hints needed!' : rating === 2 ? '👍 Good — Used 1 hint' : '💡 Keep practicing — You\'ll get faster!'}
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-[var(--green)]/30 bg-[var(--green-dim)]/10 p-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
          {summary}
        </div>

        <div className="flex gap-3">
          <button onClick={onReviewEvidence}
            className="flex-1 py-3 rounded-lg bg-[var(--green)] text-black text-[14px] font-bold hover:bg-[var(--green)]/80 transition-colors flex items-center justify-center gap-2">
            <FileText size={16} /> Review Evidence
          </button>
          <button onClick={onNewScenario}
            className="flex-1 py-3 rounded-lg bg-[var(--cyan)] text-black text-[14px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-2">
            <Play size={16} fill="currentColor" /> New Scenario
          </button>
          <button onClick={onClose}
            className="px-4 py-3 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-dim)] text-[14px] font-semibold hover:bg-[var(--bg-elevated)] transition-colors flex items-center gap-2">
            <Activity size={16} /> View Topology
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

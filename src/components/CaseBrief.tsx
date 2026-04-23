'use client';

import { useState } from 'react';
import type { ScenarioContext } from '@/store';
import { BookMarked, FileText, AlertTriangle, Lightbulb, CheckCircle2, ChevronDown, Play } from 'lucide-react';

const SEV: Record<string, string> = { low: 'var(--green)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--purple)' };
const SEV_BG: Record<string, string> = { low: 'var(--green-dim)', medium: 'var(--amber-dim)', high: 'var(--red-dim)', critical: 'var(--purple-dim)' };

function CaseBrief({ ctx, onStart, downCount, degradedCount, openOrders, stuckOrders }: {
  ctx: ScenarioContext;
  onStart: () => void;
  downCount: number;
  degradedCount: number;
  openOrders: number;
  stuckOrders: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const problems = ctx.hints?.key_problems || [];
  const diagnosis = ctx.hints?.diagnosis_path || '';
  const categoryLabel = ctx.categories?.length ? ctx.categories.join(' · ') : 'ops incident';

  return (
    <div className="p-5 overflow-y-auto">
      {/* Briefing header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase" style={{ backgroundColor: SEV_BG[ctx.severity], color: SEV[ctx.severity] }}>
            {ctx.severity}
          </div>
          <span className="text-[12px] text-[var(--text-muted)] font-mono">{ctx.simulated_time || ''}</span>
          <span className="text-[12px] text-[var(--text-muted)] font-mono">~{ctx.estimated_minutes} min</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <BookMarked size={20} className="text-[var(--cyan)]" />
          <h2 className="text-[20px] font-bold">{ctx.title}</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-4 mb-4">
          <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Venue pressure</div>
            <div className="mt-1 text-[18px] font-bold text-[var(--text-primary)]">{downCount} down</div>
            <div className="text-[12px] text-[var(--text-muted)]">{degradedCount} degraded</div>
          </div>
          <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Order pressure</div>
            <div className="mt-1 text-[18px] font-bold text-[var(--text-primary)]">{stuckOrders} stuck</div>
            <div className="text-[12px] text-[var(--text-muted)]">{openOrders} open orders</div>
          </div>
          <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Scenario lens</div>
            <div className="mt-1 text-[14px] font-bold text-[var(--text-primary)]">{categoryLabel}</div>
            <div className="text-[12px] text-[var(--text-muted)]">{ctx.difficulty} difficulty</div>
          </div>
          <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">AI / MCP path</div>
            <div className="mt-1 text-[18px] font-bold text-[var(--text-primary)]">{ctx.runbook?.steps?.length || 0} steps</div>
            <div className="text-[12px] text-[var(--text-muted)]">Explainable tool workflow</div>
          </div>
        </div>

        {/* Scenario story — the "real case" presentation */}
        <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-base)] p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} className="text-[var(--cyan)]" />
            <span className="text-[14px] font-bold">Case Briefing</span>
          </div>
          <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
            {ctx.runbook?.narrative || ctx.description}
          </p>
        </div>

        {/* Key problems */}
        {problems.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-[var(--amber)]" />
              <span className="text-[14px] font-bold">Issues to Diagnose</span>
            </div>
            <div className="space-y-1.5">
              {problems.map((p: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-[14px] text-[var(--text-secondary)] leading-relaxed">
                  <span className="text-[var(--red)] font-bold mt-0.5">•</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Where to start — diagnosis path */}
        {diagnosis && (
          <div className="flex items-start gap-2 bg-[var(--cyan-dim)]/10 border border-[var(--cyan)]/20 rounded-lg p-3 mb-4">
            <Lightbulb size={14} className="text-[var(--cyan)] shrink-0 mt-0.5" />
            <div>
              <span className="text-[14px] font-bold text-[var(--cyan)]">Where to start</span>
              <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{diagnosis}</p>
            </div>
          </div>
        )}

        {/* Success criteria */}
        {ctx.success_criteria?.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 mb-2">
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="text-[14px] font-bold text-[var(--green)]">Success Criteria ({ctx.success_criteria.length})</span>
          </button>
        )}
        {expanded && ctx.success_criteria?.length > 0 && (
          <div className="space-y-1 mb-4 pl-4 border-l-2 border-[var(--green)]/30">
            {ctx.success_criteria.map((c: string, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[14px] text-[var(--green)]">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4 rounded-lg border border-[var(--cyan)]/20 bg-[var(--cyan-dim)]/10 p-3 text-[13px] text-[var(--text-secondary)]">
          Best demo flow: brief the incident, run the case study, open Trace to show the MCP audit trail, then open Manual Runbook to prove every AI action maps to real desk commands.
        </div>

        {/* Start button */}
        <button onClick={onStart}
          className="w-full py-3 rounded-lg bg-[var(--cyan)] text-black text-[16px] font-bold hover:bg-[var(--cyan)]/80 transition-colors flex items-center justify-center gap-2">
          <Play size={18} fill="currentColor" /> Start Live Drill
        </button>
      </div>
    </div>
  );
}

// ═══ FIX Wire Messages view ═══

export default CaseBrief;

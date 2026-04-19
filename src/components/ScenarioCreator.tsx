'use client';

import { useState } from 'react';
import { useSystem } from '@/store';
import {
  Plus, Save, Trash2, Layers, AlertTriangle, BookOpen,
  Wrench, CheckCircle, ArrowRight, Play, Search, Eye,
  ChevronDown, ChevronRight, Loader2, X,
} from 'lucide-react';

type RunbookStep = {
  step: number;
  title: string;
  narrative: string;
  tool: string;
  tool_args: Record<string, unknown>;
  expected: string;
};

type ScenarioDraft = {
  name: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimated_minutes: number;
  categories: string[];
  simulated_time: string;
  runbook: {
    narrative: string;
    steps: RunbookStep[];
  };
  hints: {
    key_problems: string[];
    diagnosis_path: string;
    common_mistakes: string[];
  };
  success_criteria: string[];
};

const TOOLS = [
  'check_fix_sessions', 'query_orders', 'validate_orders', 'session_heartbeat',
  'dump_session_state', 'fix_session_issue', 'release_stuck_orders',
  'check_ticker', 'update_ticker', 'load_ticker', 'send_order', 'cancel_replace',
  'update_venue_status', 'run_premarket_check',
  'check_algo_status', 'modify_algo', 'cancel_algo', 'send_algo_order',
];

const CATEGORY_OPTIONS = ['session', 'orders', 'reference_data', 'algo', 'market_data', 'regulatory'];

function emptyDraft(): ScenarioDraft {
  return {
    name: '', title: '', description: '',
    severity: 'medium', difficulty: 'intermediate', estimated_minutes: 20,
    categories: [], simulated_time: '',
    runbook: { narrative: '', steps: [] },
    hints: { key_problems: [], diagnosis_path: '', common_mistakes: [] },
    success_criteria: [],
  };
}

export function ScenarioCreator() {
  const { available_scenarios: scenarios, startScenario } = useSystem();
  const [draft, setDraft] = useState<ScenarioDraft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ basic: true, hints: false, runbook: false, criteria: false });
  const [preview, setPreview] = useState(false);

  const filtered = (scenarios ?? [])
    .filter((s) => s.title.toLowerCase().includes(search) || s.name.includes(search) || s.description.toLowerCase().includes(search))
    .sort((a, b) => {
      const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    });

  const update = (field: keyof ScenarioDraft, value: any) => setDraft((d) => ({ ...d, [field]: value }));

  const addStep = () => {
    const step: RunbookStep = { step: draft.runbook.steps.length + 1, title: '', narrative: '', tool: '', tool_args: {}, expected: '' };
    setDraft((d) => ({ ...d, runbook: { ...d.runbook, steps: [...d.runbook.steps, step] } }));
  };

  const updateStep = (idx: number, field: keyof RunbookStep, value: any) => {
    setDraft((d) => {
      const steps = [...d.runbook.steps];
      steps[idx] = { ...steps[idx], [field]: value };
      return { ...d, runbook: { ...d.runbook, steps } };
    });
  };

  const removeStep = (idx: number) => {
    setDraft((d) => {
      const steps = d.runbook.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step: i + 1 }));
      return { ...d, runbook: { ...d.runbook, steps } };
    });
  };

  const addKeyProblem = () => setDraft((d) => ({ ...d, hints: { ...d.hints, key_problems: [...d.hints.key_problems, ''] } }));
  const addMistake = () => setDraft((d) => ({ ...d, hints: { ...d.hints, common_mistakes: [...d.hints.common_mistakes, ''] } }));
  const addCriterion = () => setDraft((d) => ({ ...d, success_criteria: [...d.success_criteria, ''] }));

  const removeList = (field: 'key_problems' | 'common_mistakes', idx: number) =>
    setDraft((d) => ({ ...d, hints: { ...d.hints, [field]: d.hints[field].filter((_, i) => i !== idx) } }));
  const removeCriterion = (idx: number) =>
    setDraft((d) => ({ ...d, success_criteria: d.success_criteria.filter((_, i) => i !== idx) }));

  const toggleSection = (section: string) => setExpandedSections((p) => ({ ...p, [section]: !p[section] }));

  const jsonPreview = JSON.stringify(draft, null, 2);

  return (
    <div className="h-full flex bg-[var(--bg-void)]">
      {/* Left panel: Library */}
      <div className="w-[280px] border-r border-[var(--border-dim)] bg-[var(--bg-base)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--border-dim)]">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
            <Layers size={13} /> Scenario Library
          </h2>
        </div>
        <div className="px-3 pt-2">
          <input className="input-base !text-[10px] !py-1.5 !px-2.5 !rounded-lg !w-full" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.map((s: any) => (
            <button key={s.name} onClick={() => startScenario(s.name)} className="w-full text-left px-2 py-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--cyan)]/30 transition-all">
              <div className="text-[10px] font-mono font-semibold truncate">{s.title || s.name}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[7px] px-1 py-px rounded bg-[var(--cyan-dim)] text-[var(--cyan)] font-mono">{s.severity?.toUpperCase()}</span>
                <span className="text-[7px] font-mono text-[var(--text-dim)]">{s.estimated_minutes}m</span>
              </div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--border-dim)]">
          <button onClick={() => { setDraft(emptyDraft()); setEditing(true); setPreview(false); }} className="btn-primary w-full flex items-center justify-center gap-1.5 !text-[10px]">
            <Plus size={11} /> New Scenario
          </button>
        </div>
      </div>

      {/* Right panel: Editor or Preview */}
      <div className="flex-1 overflow-y-auto p-6">
        {!editing ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Layers size={32} className="text-[var(--text-dim)] mx-auto mb-2" />
              <p className="text-[11px] text-[var(--text-muted)] mb-3">Select a scenario or create a new one</p>
              <button onClick={() => { setDraft(emptyDraft()); setEditing(true); }} className="btn-primary flex items-center gap-1.5 !text-[10px] mx-auto">
                <Plus size={11} /> Create Scenario
              </button>
            </div>
          </div>
        ) : preview ? (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-bold">JSON Preview</h1>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(false)} className="btn-secondary flex items-center gap-1.5 !text-[10px]"><Wrench size={11} /> Edit</button>
                <button onClick={() => { navigator.clipboard.writeText(jsonPreview); }} className="btn-primary flex items-center gap-1.5 !text-[10px]"><Save size={11} /> Copy JSON</button>
                <button onClick={async () => {
                  try {
                    const res = await fetch('/api/scenario', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: jsonPreview,
                    });
                    if (res.ok) {
                      const data = await res.json();
                      alert(`Saved as ${data.name}. Refresh to see it in the library.`);
                    }
                  } catch { alert('Save failed.'); }
                }} className="btn-primary flex items-center gap-1.5 !text-[10px]"><Save size={11} /> Save to Server</button>
              </div>
            </div>
            <pre className="bg-[var(--bg-base)] p-4 rounded-md border border-[var(--border-dim)] text-[10px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap max-h-[600px]">
              {jsonPreview}
            </pre>
          </div>
        ) : (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-lg font-bold">{draft.name ? `Edit: ${draft.title || draft.name}` : 'New Scenario'}</h1>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(true)} className="btn-secondary flex items-center gap-1.5 !text-[10px]"><Eye size={11} /> Preview</button>
                <button onClick={() => setEditing(false)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><X size={14} /></button>
              </div>
            </div>

            {/* Basic Info */}
            <Section title="Basic Information" expanded={expandedSections.basic} onToggle={() => toggleSection('basic')} icon={<Layers size={13} />}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Input label="Name" value={draft.name} onChange={(v) => update('name', v)} placeholder="e.g. venue_outage_1400" />
                <Input label="Title" value={draft.title} onChange={(v) => update('title', v)} placeholder="e.g. Venue Outage at 14:00 ET" />
              </div>
              <Textarea label="Description" value={draft.description} onChange={(v) => update('description', v)} placeholder="Brief description..." rows={2} />
              <Textarea label="Runbook Narrative" value={draft.runbook.narrative} onChange={(v) => update('runbook', { ...draft.runbook, narrative: v })} placeholder="Scene-setting for the operator..." rows={3} />
              <div className="grid grid-cols-4 gap-3 mt-3">
                <Select label="Severity" value={draft.severity} onChange={(v: any) => update('severity', v)} options={['low', 'medium', 'high', 'critical']} />
                <Select label="Difficulty" value={draft.difficulty} onChange={(v: any) => update('difficulty', v)} options={['beginner', 'intermediate', 'advanced']} />
                <Input label="Est. Minutes" value={draft.estimated_minutes.toString()} onChange={(v) => update('estimated_minutes', parseInt(v) || 0)} type="number" />
                <Input label="Simulated Time" value={draft.simulated_time} onChange={(v) => update('simulated_time', v)} placeholder="e.g. 14:00 ET" />
              </div>
              <div className="mt-3">
                <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Categories</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <button key={cat} onClick={() => {
                      update('categories', draft.categories.includes(cat) ? draft.categories.filter((c) => c !== cat) : [...draft.categories, cat]);
                    }} className={`text-[8px] px-2 py-1 rounded font-mono ${draft.categories.includes(cat) ? 'bg-[var(--cyan-dim)] text-[var(--cyan)] border border-[var(--cyan)]/30' : 'bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border-dim)]'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {/* Key Problems */}
            <Section title="Key Problems" expanded={expandedSections.hints} onToggle={() => toggleSection('hints')} icon={<AlertTriangle size={13} />}>
              <Textarea label="Diagnosis Path" value={draft.hints.diagnosis_path} onChange={(v) => update('hints', { ...draft.hints, diagnosis_path: v })} placeholder="First thing the operator should check..." rows={2} />
              <div className="mt-3">
                <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 flex items-center justify-between">
                  Key Problems
                  <button onClick={addKeyProblem} className="text-[var(--cyan)] hover:text-[var(--text-primary)] text-[8px]">+ Add</button>
                </label>
                {draft.hints.key_problems.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <Input value={p} onChange={(v) => { const arr = [...draft.hints.key_problems]; arr[i] = v; update('hints', { ...draft.hints, key_problems: arr }); }} placeholder="Problem description..." />
                    <button onClick={() => removeList('key_problems', i)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 flex items-center justify-between">
                  Common Mistakes
                  <button onClick={addMistake} className="text-[var(--cyan)] hover:text-[var(--text-primary)] text-[8px]">+ Add</button>
                </label>
                {draft.hints.common_mistakes.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <Input value={m} onChange={(v) => { const arr = [...draft.hints.common_mistakes]; arr[i] = v; update('hints', { ...draft.hints, common_mistakes: arr }); }} placeholder="Common mistake..." />
                    <button onClick={() => removeList('common_mistakes', i)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </Section>

            {/* Runbook Steps */}
            <Section title={`Runbook Steps (${draft.runbook.steps.length})`} expanded={expandedSections.runbook} onToggle={() => toggleSection('runbook')} icon={<BookOpen size={13} />}>
              {draft.runbook.steps.map((step, i) => (
                <div key={i} className="p-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-dim)] mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono font-bold text-[var(--cyan)]">Step {step.step}</span>
                    <button onClick={() => removeStep(i)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><Trash2 size={12} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <Input label="Title" value={step.title} onChange={(v) => updateStep(i, 'title', v)} placeholder="Step title" />
                    <Select label="Tool" value={step.tool} onChange={(v: string) => updateStep(i, 'tool', v)} options={TOOLS} />
                  </div>
                  <Textarea label="Narrative" value={step.narrative} onChange={(v) => updateStep(i, 'narrative', v)} placeholder="What to do and why..." rows={2} />
                  <Input label="Expected" value={step.expected} onChange={(v) => updateStep(i, 'expected', v)} placeholder="What success looks like" className="mt-2" />
                </div>
              ))}
              <button onClick={addStep} className="btn-secondary flex items-center gap-1.5 !text-[10px]"><Plus size={11} /> Add Step</button>
            </Section>

            {/* Success Criteria */}
            <Section title={`Success Criteria (${draft.success_criteria.length})`} expanded={expandedSections.criteria} onToggle={() => toggleSection('criteria')} icon={<CheckCircle size={13} />}>
              {draft.success_criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <CheckCircle size={12} className="text-[var(--green)] shrink-0" />
                  <Input value={c} onChange={(v) => { const arr = [...draft.success_criteria]; arr[i] = v; update('success_criteria', arr); }} placeholder="Condition for resolved..." />
                  <button onClick={() => removeCriterion(i)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><Trash2 size={12} /></button>
                </div>
              ))}
              <button onClick={addCriterion} className="btn-secondary flex items-center gap-1.5 !text-[10px]"><Plus size={11} /> Add Criterion</button>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, expanded, onToggle, icon, children }: { title: string; expanded: boolean; onToggle: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 border border-[var(--border-dim)] rounded-md bg-[var(--bg-surface)] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)]/50 transition-colors">
        <span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">{icon} {title}</span>
        {expanded ? <ChevronDown size={13} className="text-[var(--text-dim)]" /> : <ChevronRight size={13} className="text-[var(--text-dim)]" />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text', className = '' }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <input type={type} className="input-base !text-[10px] !py-1.5 !px-2.5 !rounded-md !w-full" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label?: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      {label && <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base !text-[10px] !py-1.5 !px-2.5 !rounded-md !w-full">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, rows = 2 }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div className="mb-2">
      {label && <label className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <textarea className="input-base !text-[10px] !py-1.5 !px-2.5 !rounded-md !w-full resize-y" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
    </div>
  );
}

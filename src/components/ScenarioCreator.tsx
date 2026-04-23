'use client';

import { useMemo, useState } from 'react';
import { useSystem, useChat } from '@/store';
import {
  Plus, Save, Trash2, Layers, AlertTriangle, BookOpen,
  Wrench, CheckCircle, ArrowRight, Play, Search, Eye,
  ChevronDown, ChevronRight, Loader2, X, FlaskConical,
  MessageSquare, Upload, FileCode2,
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
  const { available_scenarios: scenarios, startScenario, refresh } = useSystem();
  const { openWithPrompt, isOpen, toggleOpen } = useChat();
  const [draft, setDraft] = useState<ScenarioDraft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ basic: true, hints: false, runbook: false, criteria: false });
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [jsonImport, setJsonImport] = useState('');
  const [importError, setImportError] = useState('');
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [stressingScenario, setStressingScenario] = useState<string | null>(null);

  const filtered = (scenarios ?? [])
    .filter((s) => s.title.toLowerCase().includes(search) || s.name.includes(search) || s.description.toLowerCase().includes(search))
    .sort((a, b) => {
      const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    });

  const update = (field: keyof ScenarioDraft, value: any) => setDraft((d) => ({ ...d, [field]: value }));

  const scenarioOps = useMemo(() => {
    return filtered.map((s: any) => {
      const categories = Array.isArray(s.categories) ? s.categories.join(' · ') : '';
      return {
        ...s,
        categoriesLabel: categories,
      };
    });
  }, [filtered]);

  async function launchScenarioWithCopilot(name: string, title?: string) {
    setRunningScenario(name);
    try {
      await startScenario(name);
      if (!isOpen) toggleOpen();
      await openWithPrompt(`Start a new scenario: ${title || name}. Summarize the incident, tell me what matters first, and guide the first action.`);
    } finally {
      setRunningScenario(null);
    }
  }

  async function stressTestScenario(name: string, title?: string) {
    setStressingScenario(name);
    try {
      await startScenario(name);
      await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'inject_event',
          arguments: { event_type: 'reject_spike', target: 'desk', details: `Stress test launched for ${title || name}`, delay_sec: 0 },
        }),
      });
      if (!isOpen) toggleOpen();
      await openWithPrompt(`Stress test scenario ${title || name}. A reject spike has been injected. Triage the scenario, explain the blast radius, and recommend the next three actions.`);
    } finally {
      setStressingScenario(null);
    }
  }

  function normalizeDraftInput(parsed: any): ScenarioDraft {
    const steps = Array.isArray(parsed?.runbook?.steps)
      ? parsed.runbook.steps.map((step: any, idx: number) => ({
          step: Number(step?.step ?? idx + 1),
          title: step?.title ?? '',
          narrative: step?.narrative ?? '',
          tool: step?.tool ?? '',
          tool_args: step?.tool_args ?? {},
          expected: step?.expected ?? '',
        }))
      : [];

    return {
      name: parsed?.name ?? '',
      title: parsed?.title ?? '',
      description: parsed?.description ?? '',
      severity: parsed?.severity ?? 'medium',
      difficulty: parsed?.difficulty ?? 'intermediate',
      estimated_minutes: Number(parsed?.estimated_minutes ?? 20),
      categories: Array.isArray(parsed?.categories) ? parsed.categories : [],
      simulated_time: parsed?.simulated_time ?? '',
      runbook: {
        narrative: parsed?.runbook?.narrative ?? '',
        steps,
      },
      hints: {
        key_problems: Array.isArray(parsed?.hints?.key_problems) ? parsed.hints.key_problems : [],
        diagnosis_path: parsed?.hints?.diagnosis_path ?? '',
        common_mistakes: Array.isArray(parsed?.hints?.common_mistakes) ? parsed.hints.common_mistakes : [],
      },
      success_criteria: Array.isArray(parsed?.success_criteria) ? parsed.success_criteria : [],
    };
  }

  function loadDraftFromJson(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      setDraft(normalizeDraftInput(parsed));
      setEditing(true);
      setPreview(false);
      setImportError('');
      setSaveState('idle');
      setSaveMessage('Draft loaded into builder.');
    } catch (err) {
      setImportError(`Invalid JSON: ${(err as Error).message}`);
    }
  }

  async function saveScenarioToServer(payloadText: string) {
    setSaveState('saving');
    setSaveMessage('Saving scenario...');
    try {
      const res = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadText,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.output || 'Save failed');
      }
      await refresh();
      setSaveState('saved');
      setSaveMessage(`Saved as ${data.name}. It is ready to load or stress test.`);
    } catch (err) {
      setSaveState('error');
      setSaveMessage((err as Error).message || 'Save failed');
    }
  }

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
      {/* Left panel: Operations */}
      <div className="w-[380px] border-r border-[var(--border-dim)] bg-[var(--bg-base)] flex flex-col shrink-0">
        <div className="p-4 border-b border-[var(--border-dim)] space-y-3">
          <div>
            <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
              <Layers size={13} /> Scenario Operations Desk
            </h2>
            <p className="text-[13px] text-[var(--text-muted)] mt-2 leading-relaxed">
              Launch a scenario straight into the chatbot, inject stress, or create and load a new one without leaving this screen.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setDraft(emptyDraft()); setEditing(true); setPreview(false); setSaveState('idle'); setSaveMessage(''); }} className="btn-primary w-full flex items-center justify-center gap-1.5 !text-[13px]">
              <Plus size={11} /> Create Scenario
            </button>
            <button onClick={() => setEditing((v) => !v)} className="btn-secondary w-full flex items-center justify-center gap-1.5 !text-[13px]">
              <FileCode2 size={11} /> {editing ? 'Hide Builder' : 'Open Builder'}
            </button>
          </div>
          <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3">
            <div className="text-[12px] font-bold text-[var(--text-primary)] flex items-center gap-2 mb-2">
              <Upload size={12} /> Load Scenario JSON
            </div>
            <textarea
              className="input-base !text-[12px] !py-2 !px-2.5 !rounded-md !w-full resize-y min-h-[120px]"
              placeholder="Paste a scenario JSON draft here to load it into the builder..."
              value={jsonImport}
              onChange={(e) => setJsonImport(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => loadDraftFromJson(jsonImport)} className="btn-secondary flex items-center gap-1.5 !text-[12px]">
                <Upload size={11} /> Load Draft
              </button>
              <button onClick={() => { setJsonImport(''); setImportError(''); }} className="btn-secondary !text-[12px]">Clear</button>
            </div>
            {importError && <div className="mt-2 text-[12px] text-[var(--red)]">{importError}</div>}
          </div>
        </div>
        <div className="px-3 pt-3">
          <input className="input-base !text-[13px] !py-1.5 !px-2.5 !rounded-lg !w-full" placeholder="Search scenarios..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {scenarioOps.map((s: any) => (
            <div key={s.name} className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-dim)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--text-primary)] leading-tight">{s.title || s.name}</div>
                  <div className="mt-1 text-[12px] text-[var(--text-dim)] font-mono">{s.estimated_minutes}m · {s.runbook_step_count || '?'} steps · {s.difficulty || 'intermediate'}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--cyan-dim)] text-[var(--cyan)] font-mono">{s.severity?.toUpperCase()}</span>
              </div>
              {s.categoriesLabel && (
                <div className="mt-2 text-[12px] text-[var(--text-muted)]">{s.categoriesLabel}</div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  onClick={() => launchScenarioWithCopilot(s.name, s.title)}
                  disabled={runningScenario === s.name}
                  className="w-full rounded-lg bg-[var(--cyan)] text-black text-[13px] font-bold py-2 px-3 flex items-center justify-center gap-2 hover:bg-[var(--cyan)]/80 transition-colors disabled:opacity-50"
                >
                  {runningScenario === s.name ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                  Launch in Chatbot
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => startScenario(s.name)}
                    className="w-full rounded-lg border border-[var(--border-dim)] bg-[var(--bg-elevated)] text-[13px] font-semibold py-2 px-3 hover:border-[var(--cyan)]/30"
                  >
                    Load Only
                  </button>
                  <button
                    onClick={() => stressTestScenario(s.name, s.title)}
                    disabled={stressingScenario === s.name}
                    className="w-full rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)] text-[13px] font-semibold py-2 px-3 flex items-center justify-center gap-1.5 hover:bg-[var(--red)]/20 disabled:opacity-50"
                  >
                    {stressingScenario === s.name ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                    Stress Test
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: Editor or Preview */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl">
          <div className="mb-5 rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[12px] uppercase tracking-wide text-[var(--text-dim)] font-bold">Top-dollar workflow</div>
                <h1 className="text-[24px] font-bold text-[var(--text-primary)] mt-1">Create → Load → Stress Test → Verify</h1>
                <p className="text-[14px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                  This should be the scenario workbench: build or import a new incident, save it to the server, launch it straight into the chatbot, and pressure-test it with injected failures.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 min-w-[220px]">
                <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="text-[11px] uppercase text-[var(--text-dim)]">Saved scenarios</div>
                  <div className="text-[22px] font-bold text-[var(--cyan)]">{scenarios?.length || 0}</div>
                </div>
                <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="text-[11px] uppercase text-[var(--text-dim)]">Stress tools surfaced</div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">Launch + inject + chat handoff</div>
                </div>
              </div>
            </div>
            {(saveState !== 'idle' || saveMessage) && (
              <div className={`mt-4 rounded-lg border px-3 py-2 text-[13px] ${saveState === 'error' ? 'border-[var(--red)]/40 text-[var(--red)] bg-[var(--red)]/10' : 'border-[var(--green)]/30 text-[var(--green)] bg-[var(--green)]/10'}`}>
                {saveMessage}
              </div>
            )}
          </div>
        {!editing ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-dim)] bg-[var(--bg-surface)] p-10 text-center">
            <Layers size={36} className="text-[var(--text-dim)] mx-auto mb-3" />
            <p className="text-[16px] text-[var(--text-secondary)] mb-2">Select an operation on the left.</p>
            <p className="text-[13px] text-[var(--text-muted)] mb-4">Best path: create or import a scenario, save it, then launch it directly into the chatbot or hit Stress Test.</p>
            <button onClick={() => { setDraft(emptyDraft()); setEditing(true); setPreview(false); }} className="btn-primary flex items-center gap-1.5 !text-[13px] mx-auto">
              <Plus size={11} /> Start New Scenario Draft
            </button>
          </div>
        ) : preview ? (
          <div className="max-w-4xl">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-bold">Scenario JSON Preview</h1>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button onClick={() => setPreview(false)} className="btn-secondary flex items-center gap-1.5 !text-[13px]"><Wrench size={11} /> Back to Builder</button>
                <button onClick={() => { navigator.clipboard.writeText(jsonPreview); }} className="btn-secondary flex items-center gap-1.5 !text-[13px]"><Save size={11} /> Copy JSON</button>
                <button onClick={() => saveScenarioToServer(jsonPreview)} disabled={saveState === 'saving'} className="btn-primary flex items-center gap-1.5 !text-[13px] disabled:opacity-50">
                  {saveState === 'saving' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save to Server
                </button>
                <button onClick={() => launchScenarioWithCopilot(draft.name, draft.title)} disabled={!draft.name || saveState === 'saving'} className="btn-primary flex items-center gap-1.5 !text-[13px] disabled:opacity-50">
                  <MessageSquare size={11} /> Save Then Launch in Chat
                </button>
              </div>
            </div>
            <pre className="bg-[var(--bg-base)] p-4 rounded-md border border-[var(--border-dim)] text-[13px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap max-h-[600px]">
              {jsonPreview}
            </pre>
          </div>
        ) : (
          <div className="max-w-4xl">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-lg font-bold">{draft.name ? `Scenario Builder: ${draft.title || draft.name}` : 'Scenario Builder'}</h1>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button onClick={() => setPreview(true)} className="btn-secondary flex items-center gap-1.5 !text-[13px]"><Eye size={11} /> Preview JSON</button>
                <button onClick={() => saveScenarioToServer(jsonPreview)} disabled={saveState === 'saving'} className="btn-secondary flex items-center gap-1.5 !text-[13px] disabled:opacity-50">
                  {saveState === 'saving' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save Draft
                </button>
                <button onClick={() => setEditing(false)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><X size={14} /></button>
              </div>
            </div>
            <div className="mb-4 rounded-xl border border-[var(--border-dim)] bg-[var(--bg-surface)] p-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              Build the scenario here, save it to the server, then immediately load it or stress test it from the operations desk.
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
                <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Categories</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <button key={cat} onClick={() => {
                      update('categories', draft.categories.includes(cat) ? draft.categories.filter((c) => c !== cat) : [...draft.categories, cat]);
                    }} className={`text-[14px] px-2 py-1 rounded font-mono ${draft.categories.includes(cat) ? 'bg-[var(--cyan-dim)] text-[var(--cyan)] border border-[var(--cyan)]/30' : 'bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border-dim)]'}`}>
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
                <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 flex items-center justify-between">
                  Key Problems
                  <button onClick={addKeyProblem} className="text-[var(--cyan)] hover:text-[var(--text-primary)] text-[14px]">+ Add</button>
                </label>
                {draft.hints.key_problems.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <Input value={p} onChange={(v) => { const arr = [...draft.hints.key_problems]; arr[i] = v; update('hints', { ...draft.hints, key_problems: arr }); }} placeholder="Problem description..." />
                    <button onClick={() => removeList('key_problems', i)} className="text-[var(--text-dim)] hover:text-[var(--red)]"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 flex items-center justify-between">
                  Common Mistakes
                  <button onClick={addMistake} className="text-[var(--cyan)] hover:text-[var(--text-primary)] text-[14px]">+ Add</button>
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
                    <span className="text-[13px] font-mono font-bold text-[var(--cyan)]">Step {step.step}</span>
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
              <button onClick={addStep} className="btn-secondary flex items-center gap-1.5 !text-[13px]"><Plus size={11} /> Add Step</button>
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
              <button onClick={addCriterion} className="btn-secondary flex items-center gap-1.5 !text-[13px]"><Plus size={11} /> Add Criterion</button>
            </Section>
          </div>
        )}
        </div>
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
      {label && <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <input type={type} className="input-base !text-[13px] !py-1.5 !px-2.5 !rounded-md !w-full" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label?: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      {label && <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base !text-[13px] !py-1.5 !px-2.5 !rounded-md !w-full">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, rows = 2 }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div className="mb-2">
      {label && <label className="text-[12px] font-mono text-[var(--text-muted)] uppercase mb-1 block">{label}</label>}
      <textarea className="input-base !text-[13px] !py-1.5 !px-2.5 !rounded-md !w-full resize-y" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />
    </div>
  );
}

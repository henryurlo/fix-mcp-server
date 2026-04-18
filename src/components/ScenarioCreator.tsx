'use client';

import React, { useState } from 'react';
import { useScenarioCreator } from '@/store/scenario-creator';
import {
  PlusCircle,
  Trash2,
  Play,
  Save,
  AlertTriangle,
  Zap,
  Server,
  Globe,
  Radio,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Send,
  BookOpen,
  Layers,
  X,
} from 'lucide-react';

const FAULT_TYPES = ['delay', 'disconnect', 'corrupt', 'overload', 'auth_storm', 'latency_spike', 'rate_corruption'];
const COMPONENTS = ['market_data', 'exchange', 'broker', 'fx_feed', 'client_session'];
const VENUES = ['XNYS', 'XNAS', 'XTSE', 'XLON', 'ARCA'];

export default function ScenarioCreator() {
  const [activeSection, setActiveSection] = useState<'create' | 'library' | 'qa'>('create');
  const {
    newScenario,
    createdScenarios,
    isSubmitting,
    error,
    activeInjections,
    qaThreads,
    updateField,
    addStep,
    removeStep,
    addInjection,
    removeInjection,
    updateInjection,
    submitScenario,
    deleteScenario,
    injectFault,
    resolveFault,
    askQuestion,
    clearError,
  } = useScenarioCreator();

  const [qaInput, setQaInput] = useState('');

  return (
    <div className="h-full flex bg-[var(--bg-void)]">
      {/* Left sidebar: Section nav */}
      <div className="w-56 border-r border-[var(--border-dim)] bg-[var(--bg-base)] flex flex-col">
        <div className="p-4 border-b border-[var(--border-dim)]">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
            <PlusCircle size={13} /> Scenario Lab
          </h2>
          <p className="text-[9px] text-[var(--text-muted)] mt-1">Build, test, and manage fault scenarios</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <SidebarBtn
            icon={<Zap size={13} />}
            label="Create Scenario"
            active={activeSection === 'create'}
            onClick={() => setActiveSection('create')}
          />
          <SidebarBtn
            icon={<BookOpen size={13} />}
            label="Scenario Library"
            active={activeSection === 'library'}
            onClick={() => setActiveSection('library')}
            badge={createdScenarios.length > 0 ? createdScenarios.length.toString() : undefined}
          />
          <SidebarBtn
            icon={<MessageCircle size={13} />}
            label="System Q&A"
            active={activeSection === 'qa'}
            onClick={() => setActiveSection('qa')}
          />
        </nav>

        {/* Active injections */}
        {activeInjections.length > 0 && (
          <div className="p-3 border-t border-[var(--border-dim)]">
            <h3 className="text-[9px] font-bold text-[var(--red)] uppercase tracking-wider mb-2 flex items-center gap-1">
              <AlertTriangle size={10} /> Active Faults
            </h3>
            <div className="space-y-1">
              {activeInjections.map((inj) => (
                <div key={inj.id} className="flex items-center justify-between p-1.5 rounded bg-[var(--red-dim)] border border-[var(--red)]/20">
                  <span className="text-[9px] font-mono text-[var(--red)]">{inj.component}: {inj.fault}</span>
                  <button onClick={() => resolveFault(inj.id)} className="text-[var(--red)] hover:text-white">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-5 tab-content-enter">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30 flex items-center justify-between">
            <span className="text-[11px] text-[var(--red)]">{error}</span>
            <button onClick={clearError} className="text-[var(--red)] hover:text-white"><X size={13} /></button>
          </div>
        )}

        {activeSection === 'create' && <CreateSection />}
        {activeSection === 'library' && <LibrarySection />}
        {activeSection === 'qa' && <QASection />}
      </div>
    </div>
  );
}

// ── CREATE SECTION ─────────────────────────────────────────────────

function CreateSection() {
  const {
    newScenario,
    isSubmitting,
    updateField,
    addStep,
    removeStep,
    addInjection,
    removeInjection,
    updateInjection,
    submitScenario,
    injectFault,
  } = useScenarioCreator();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    steps: true,
    injections: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-bold mb-1">Create Scenario</h1>
      <p className="text-[11px] text-[var(--text-muted)] mb-5">Define a new fault scenario with injections, steps, and resolution actions.</p>

      {/* Basic Info */}
      <CollapsibleSection
        title="Basic Information"
        icon={<Layers size={13} />}
        expanded={expandedSections.basic}
        onToggle={() => toggleSection('basic')}
      >
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Scenario ID</label>
            <input
              className="input-base font-mono"
              placeholder="e.g. fx_feed_corruption"
              value={newScenario.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Title</label>
            <input
              className="input-base"
              placeholder="e.g. FX Feed Rate Corruption"
              value={newScenario.title || ''}
              onChange={(e) => updateField('title', e.target.value)}
            />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Description</label>
          <textarea
            className="input-base min-h-[60px] resize-y"
            placeholder="Brief description of what this scenario simulates..."
            value={newScenario.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase mb-1 block">Background (SRE Context)</label>
          <textarea
            className="input-base min-h-[80px] resize-y"
            placeholder="Business context for the SRE / LLM copilot. What would the SRE need to know about this situation in production?"
            value={newScenario.background || ''}
            onChange={(e) => updateField('background', e.target.value)}
          />
        </div>
      </CollapsibleSection>

      {/* Steps */}
      <CollapsibleSection
        title={`Troubleshooting Steps (${newScenario.steps?.length || 0})`}
        icon={<BookOpen size={13} />}
        expanded={expandedSections.steps}
        onToggle={() => toggleSection('steps')}
      >
        <div className="space-y-2 mb-3">
          {newScenario.steps?.map((step, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-[var(--bg-base)] border border-[var(--border-dim)] animate-fade-in">
              <span className="text-[10px] font-mono font-bold text-[var(--cyan)] mt-1.5 w-5 shrink-0">#{step.step}</span>
              <div className="flex-1 space-y-2">
                <input
                  className="input-base !text-[11px]"
                  placeholder="Action to take..."
                  value={step.action}
                  onChange={(e) => {
                    const updated = [...newScenario.steps!];
                    updated[i] = { ...updated[i], action: e.target.value };
                    updateField('steps', updated);
                  }}
                />
                <input
                  className="input-base !text-[11px]"
                  placeholder="Expected state after this step..."
                  value={step.expected_state}
                  onChange={(e) => {
                    const updated = [...newScenario.steps!];
                    updated[i] = { ...updated[i], expected_state: e.target.value };
                    updateField('steps', updated);
                  }}
                />
              </div>
              <button onClick={() => removeStep(i)} className="text-[var(--text-dim)] hover:text-[var(--red)] mt-1.5">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addStep} className="btn-secondary flex items-center gap-1.5 !text-[10px] !py-1.5">
          <PlusCircle size={11} /> Add Step
        </button>
      </CollapsibleSection>

      {/* Fault Injections */}
      <CollapsibleSection
        title={`Fault Injections (${newScenario.injections?.length || 0})`}
        icon={<AlertTriangle size={13} />}
        expanded={expandedSections.injections}
        onToggle={() => toggleSection('injections')}
      >
        <div className="space-y-2 mb-3">
          {newScenario.injections?.map((inj, i) => (
            <div key={i} className="p-3 rounded-lg bg-[var(--bg-base)] border border-[var(--border-dim)] animate-fade-in">
              <div className="flex items-center gap-2 mb-2">
                <select
                  className="input-base !w-auto !text-[10px] !py-1 !font-mono"
                  value={inj.component}
                  onChange={(e) => updateInjection(i, 'component', e.target.value)}
                >
                  {COMPONENTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  className="input-base !w-auto !text-[10px] !py-1 !font-mono"
                  value={inj.fault}
                  onChange={(e) => updateInjection(i, 'fault', e.target.value)}
                >
                  {FAULT_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  className="input-base !w-auto !text-[10px] !py-1 !font-mono"
                  value={inj.venue || ''}
                  onChange={(e) => updateInjection(i, 'venue', e.target.value)}
                >
                  <option value="">All venues</option>
                  {VENUES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <input
                  className="input-base !w-24 !text-[10px] !py-1 !font-mono"
                  type="number"
                  placeholder="Duration ms"
                  value={inj.duration_ms}
                  onChange={(e) => updateInjection(i, 'duration_ms', parseInt(e.target.value) || 0)}
                />
                <button
                  onClick={() => injectFault({ component: inj.component, fault: inj.fault, venue: inj.venue, duration_ms: inj.duration_ms })}
                  className="text-[var(--amber)] hover:text-[var(--orange)]"
                  title="Test inject now"
                >
                  <Zap size={12} />
                </button>
                <button onClick={() => removeInjection(i)} className="text-[var(--text-dim)] hover:text-[var(--red)]">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addInjection} className="btn-secondary flex items-center gap-1.5 !text-[10px] !py-1.5">
          <PlusCircle size={11} /> Add Injection
        </button>
      </CollapsibleSection>

      {/* Submit */}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={submitScenario}
          disabled={isSubmitting || !newScenario.name || !newScenario.title}
          className="btn-primary flex items-center gap-2"
        >
          <Save size={13} />
          {isSubmitting ? 'Saving...' : 'Save Scenario'}
        </button>
        <span className="text-[10px] text-[var(--text-dim)]">
          Saved scenarios appear in the Scenario Library and can be triggered from Mission Control.
        </span>
      </div>
    </div>
  );
}

// ── LIBRARY SECTION ────────────────────────────────────────────────

function LibrarySection() {
  const { createdScenarios, deleteScenario } = useScenarioCreator();

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Scenario Library</h1>
      <p className="text-[11px] text-[var(--text-muted)] mb-5">Your custom scenarios and pre-built workbooks.</p>

      {createdScenarios.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={32} className="text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[11px] text-[var(--text-muted)]">No custom scenarios yet. Create one in the builder.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {createdScenarios.map((s) => (
            <div key={s.id} className="glass-panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono font-bold">{s.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                    s.status === 'active' ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' :
                    s.status === 'resolved' ? 'bg-[var(--green-dim)] text-[var(--green)]' :
                    'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                  }`}>
                    {s.status.toUpperCase()}
                  </span>
                  <button onClick={() => deleteScenario(s.id)} className="text-[var(--text-dim)] hover:text-[var(--red)]">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] mb-2">{s.config.description || 'No description'}</p>
              <div className="flex items-center gap-3 text-[9px] text-[var(--text-dim)] font-mono">
                <span>{s.config.steps?.length || 0} steps</span>
                <span>{s.config.injections?.length || 0} injections</span>
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Q&A SECTION ────────────────────────────────────────────────────

function QASection() {
  const { qaThreads, askQuestion } = useScenarioCreator();
  const [input, setInput] = useState('');

  const handleAsk = () => {
    if (!input.trim()) return;
    askQuestion(input.trim());
    setInput('');
  };

  return (
    <div className="max-w-3xl flex flex-col h-full">
      <h1 className="text-lg font-bold mb-1">System Q&A</h1>
      <p className="text-[11px] text-[var(--text-muted)] mb-5">Ask questions about the FIX-MCP system, trading protocols, scenarios, or workbooks.</p>

      {/* Q&A Thread */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {qaThreads.length === 0 && (
          <div className="text-center py-12">
            <MessageCircle size={28} className="text-[var(--text-dim)] mx-auto mb-3" />
            <p className="text-[11px] text-[var(--text-muted)] mb-4">Ask anything about the system</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                'What scenarios involve FX feeds?',
                'How does interlisted name resolution work?',
                'What MCP tools are available?',
                'Explain the FIX Logon sequence',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { askQuestion(q); }}
                  className="btn-secondary !text-[9px] !py-1 !px-2.5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {qaThreads.map((thread) => (
          <div key={thread.id} className="animate-fade-in">
            <div className="flex items-start gap-2 mb-2">
              <div className="w-5 h-5 rounded bg-[var(--blue-dim)] flex items-center justify-center shrink-0 mt-0.5">
                <MessageCircle size={10} className="text-[var(--blue)]" />
              </div>
              <p className="text-[11px] text-[var(--text-primary)]">{thread.question}</p>
            </div>
            <div className="flex items-start gap-2 ml-7">
              <div className="w-5 h-5 rounded bg-[var(--cyan-dim)] flex items-center justify-center shrink-0 mt-0.5">
                <Zap size={10} className="text-[var(--cyan)]" />
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {thread.answer}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2 shrink-0">
        <input
          className="input-base flex-1 !text-[11px]"
          placeholder="Ask about the system, protocols, scenarios..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
        />
        <button onClick={handleAsk} className="btn-primary flex items-center gap-1.5 !text-[11px]">
          <Send size={12} /> Ask
        </button>
      </div>
    </div>
  );
}

// ── SHARED COMPONENTS ──────────────────────────────────────────────

function SidebarBtn({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all ${
        active
          ? 'bg-[var(--bg-elevated)] text-[var(--cyan)] border border-[var(--cyan)]/20'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--cyan-dim)] text-[var(--cyan)] font-mono">{badge}</span>
      )}
    </button>
  );
}

function CollapsibleSection({ title, icon, expanded, onToggle, children }: {
  title: string; icon: React.ReactNode; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="mb-4 glass-panel overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">{icon} {title}</span>
        {expanded ? <ChevronUp size={13} className="text-[var(--text-dim)]" /> : <ChevronDown size={13} className="text-[var(--text-dim)]" />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

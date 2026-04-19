'use client';

import { useSystem } from '@/store';
import { Play, Radio, Search, AlertTriangle, Clock, Layers, Zap } from 'lucide-react';
import { useState } from 'react';

export function ScenarioCreator() {
  const {
    scenario,
    scenarioContext,
    available_scenarios: scenarios,
    startScenario,
  } = useSystem();

  const [search, setSearch] = useState('');

  const filtered = (scenarios ?? [])
    .filter((s) => s.title.includes(search) || s.description.includes(search) || s.name.includes(search))
    .sort((a, b) => {
      const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    });

  return (
    <div className="h-full flex bg-[var(--bg-void)]">
      {/* Left panel: Scenario List */}
      <div className="w-[300px] border-r border-[var(--border-dim)] bg-[var(--bg-base)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--border-dim)]">
          <h2 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
            <Zap size={13} /> Scenario Library
          </h2>
          <p className="text-[9px] text-[var(--text-muted)] mt-1">Browse, load, and inspect scenarios</p>
        </div>

        <div className="px-3 pt-2">
          <input
            className="input-base !text-[10px] !py-1.5 !px-2.5 !rounded-lg !w-full"
            placeholder="Search scenarios..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.map((s) => {
            const isActive = scenario === s.name;
            const sevBg: Record<string, string> = {
              critical: 'var(--purple)',
              high: 'var(--red)',
              medium: 'var(--amber)',
              low: 'var(--green)',
            };
            return (
              <button
                key={s.name}
                onClick={() => startScenario(s.name)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-all ${
                  isActive
                    ? 'bg-[var(--cyan-dim)] border border-[var(--cyan)]/30'
                    : 'bg-[var(--bg-surface)] border border-[var(--border-dim)] hover:border-[var(--border-base)]'
                }`}
              >
                {isActive
                  ? <Radio size={10} className="text-[var(--cyan)] animate-pulse shrink-0" />
                  : <Play size={10} className="text-[var(--text-dim)] shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono font-semibold truncate">{s.title || s.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[7px] font-bold px-1 py-px rounded" style={{ backgroundColor: sevBg[s.severity], color: '#0a0b0e' }}>
                      {s.severity?.toUpperCase()}
                    </span>
                    <span className="text-[7px] font-mono text-[var(--text-dim)]">{s.estimated_minutes}m</span>
                    <span className="text-[7px] font-mono text-[var(--text-dim)]">{s.difficulty}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right panel: Scenario Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {scenarioContext ? (
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-lg font-bold">{scenarioContext.title}</h1>
              {scenarioContext.severity && (
                <span className={`text-[8px] px-2 py-1 rounded font-bold ${
                  scenarioContext.severity === 'critical' ? 'bg-[var(--purple-dim)] text-[var(--purple)]' :
                  scenarioContext.severity === 'high' ? 'bg-[var(--red-dim)] text-[var(--red)]' :
                  scenarioContext.severity === 'medium' ? 'bg-[var(--amber-dim)] text-[var(--amber)]' :
                  'bg-[var(--green-dim)] text-[var(--green)]'
                }`}>
                  {scenarioContext.severity.toUpperCase()}
                </span>
              )}
            </div>

            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-4">
              {scenarioContext.description}
            </p>

            <div className="grid grid-cols-4 gap-3 mb-6">
              <StatCard label="Est. Time" value={`${scenarioContext.estimated_minutes}m`} icon={<Clock size={13} />} />
              <StatCard label="Difficulty" value={scenarioContext.difficulty} icon={<AlertTriangle size={13} />} />
              <StatCard label="Steps" value={scenarioContext.runbook?.steps?.length ?? 0} icon={<Layers size={13} />} />
              <StatCard label="Criteria" value={scenarioContext.success_criteria?.length ?? 0} icon={<Zap size={13} />} />
            </div>

            {scenarioContext.hints?.key_problems && scenarioContext.hints.key_problems.length > 0 && (
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-[var(--red)] uppercase tracking-wider mb-2 flex items-center gap-2">
                  <AlertTriangle size={11} /> Key Problems ({scenarioContext.hints.key_problems.length})
                </h3>
                {scenarioContext.hints.key_problems.map((p, i) => (
                  <div key={i} className="text-[10px] text-[var(--text-secondary)] p-3 rounded-md bg-[var(--red-dim)]/30 border border-[var(--red)]/20 mb-2">
                    {p}
                  </div>
                ))}
              </div>
            )}

            {scenarioContext.runbook?.steps && scenarioContext.runbook.steps.length > 0 && (
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-[var(--cyan)] uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Layers size={11} /> Runbook Steps
                </h3>
                {scenarioContext.runbook.steps.map((step) => (
                  <div key={step.step} className="flex items-start gap-3 p-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-dim)] mb-2">
                    <span className="text-[10px] font-mono font-bold text-[var(--cyan)] mt-0.5 w-6 shrink-0 text-right">#{step.step}</span>
                    <div>
                      <div className="text-[10px] font-semibold mb-1">{step.title}</div>
                      <div className="text-[9px] text-[var(--text-muted)] leading-relaxed">{step.narrative}</div>
                      <div className="text-[8px] text-[var(--green)] font-mono mt-1">
                        &rarr; {step.tool}{Object.keys(step.tool_args || {}).length ? ` ${JSON.stringify(step.tool_args)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <Layers size={32} className="text-[var(--text-dim)] mb-2" />
            <p className="text-[11px] text-[var(--text-muted)]">Select a scenario to inspect</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-surface)] p-3 rounded-md border border-[var(--border-dim)]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--text-muted)]">{icon}</span>
        <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase">{label}</span>
      </div>
      <div className="text-[11px] font-bold font-mono text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

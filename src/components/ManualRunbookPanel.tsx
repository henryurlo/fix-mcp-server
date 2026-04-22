'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Terminal, Copy, Check, ChevronDown, ChevronRight, Search,
  AlertTriangle, FileText
} from 'lucide-react';

interface RunbookCommand {
  label: string;
  language: string;
  code: string;
  notes?: string;
}

interface RunbookEntry {
  title: string;
  description: string;
  commands: RunbookCommand[];
}

export function ManualRunbookPanel() {
  const [runbook, setRunbook] = useState<Record<string, RunbookEntry>>({});
  const [loading, setLoading] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [highlightedTool, setHighlightedTool] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/runbook')
      .then(r => r.json())
      .then(data => setRunbook(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Listen for tool highlights from the trace
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setHighlightedTool(detail);
        setExpandedTools(prev => {
          const next = new Set(prev);
          Object.keys(runbook).forEach(k => {
            if (k.includes(detail) || detail.includes(k)) {
              next.add(k);
            }
          });
          return next;
        });
      }
    };
    window.addEventListener('highlight:runbook', handler);
    return () => window.removeEventListener('highlight:runbook', handler);
  }, [runbook]);

  function toggleTool(key: string) {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyToClipboard(text: string, cmdKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCmd(cmdKey);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {}
  }

  const filteredTools = Object.entries(runbook).filter(([key]) =>
    !filter || key.toLowerCase().includes(filter.toLowerCase()) || runbook[key].title.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-[14px] text-[var(--text-muted)]">Loading runbook...</div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Warning banner */}
      <div className="bg-[var(--amber-dim)]/10 border-b border-[var(--amber)]/20 px-4 py-2.5 shrink-0">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-[var(--amber)] shrink-0 mt-0.5" />
          <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
            <b className="text-[var(--amber)]">These are the exact commands a human SRE would run.</b> 
            The AI is automating these, not replacing the runbook. Your ops team can execute any of these manually at any time.
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="px-3 py-2 border-b border-[var(--border-dim)] shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search tools..."
            className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-dim)] rounded text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--cyan)]/50"
          />
        </div>
      </div>

      {/* Commands list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filteredTools.length === 0 ? (
          <div className="text-[13px] text-[var(--text-muted)] text-center py-6">
            <FileText size={24} className="text-[var(--text-dim)] mx-auto mb-2" />
            {filter ? `No tools match "${filter}"` : 'No runbook entries found'}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTools.map(([toolKey, entry]) => {
              const isExpanded = expandedTools.has(toolKey);
              const isHighlighted = highlightedTool === toolKey;

              return (
                <div key={toolKey}
                  className={`rounded-lg border overflow-hidden transition-all ${
                    isHighlighted
                      ? 'border-[var(--amber)]/50 bg-[var(--amber)]/5'
                      : 'border-[var(--border-dim)] bg-[var(--bg-surface)]'
                  }`}>
                  {/* Tool header */}
                  <button onClick={() => toggleTool(toolKey)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors">
                    {isExpanded ? <ChevronDown size={12} className="text-[var(--text-dim)] shrink-0" /> : <ChevronRight size={12} className="text-[var(--text-dim)] shrink-0" />}
                    <Terminal size={12} className="text-[var(--cyan)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-[var(--text-primary)]">{entry.title}</div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">{entry.description}</div>
                    </div>
                    <div className="px-1.5 py-0.5 rounded bg-[var(--bg-void)] text-[10px] font-mono text-[var(--text-dim)] shrink-0">
                      {entry.commands.length} cmd{entry.commands.length !== 1 ? 's' : ''}
                    </div>
                  </button>

                  {/* Commands list */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border-dim)] divide-y divide-[var(--border-dim)]">
                      {entry.commands.map((cmd, i) => {
                        const cmdKey = `${toolKey}-${i}`;
                        const isCopied = copiedCmd === cmdKey;

                        return (
                          <div key={i} className="p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[var(--cyan)]/20 text-[var(--cyan)]">
                                  {cmd.language}
                                </span>
                                <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{cmd.label}</span>
                              </div>
                              <button onClick={() => copyToClipboard(cmd.code, cmdKey)}
                                className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors">
                                {isCopied ? <Check size={12} className="text-[var(--green)]" /> : <Copy size={12} />}
                              </button>
                            </div>
                            <pre className="text-[11px] font-mono text-[var(--green)] bg-[var(--bg-void)] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                              {cmd.code}
                            </pre>
                            {cmd.notes && (
                              <div className="text-[11px] text-[var(--amber)] mt-1.5 italic">
                                # {cmd.notes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

function EvidencePanel({
  output,
  isFailed,
  manualCommands,
}: {
  output: string;
  isFailed: boolean;
  manualCommands: Array<{ label: string; language: string; code: string }>;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const lines = output.split('\n').filter(l => l.trim().length > 0).length;

  return (
    <div className={`rounded-lg border ${isFailed ? 'border-[var(--red)]/20' : 'border-[var(--border-dim)]'} overflow-hidden`}>
      <div className="bg-[var(--bg-void)] px-3 py-2 flex items-center gap-2">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-[13px] w-full text-left">
          <ChevronDown size={12} className={`text-[var(--text-dim)] transition-transform ${collapsed ? '' : 'rotate-180'}`} />
          <span className={isFailed ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
            {isFailed ? '✗ Evidence captured with failure' : '✓ Evidence captured'} — {lines} lines
          </span>
          <span className="ml-auto text-[11px] text-[var(--text-dim)]">MCP + FIX proof</span>
        </button>
      </div>
      {!collapsed && (
        <div className="divide-y divide-[var(--border-dim)] bg-[var(--bg-void)]">
          <div className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] mb-2">MCP result</div>
            <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all"
              style={{ color: isFailed ? 'var(--red)' : 'var(--green)' }}>
              {output}
            </pre>
          </div>
          <div className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)] mb-2">Human/FIX commands that correspond to this step</div>
            {manualCommands.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)]">No mapped manual commands for this tool yet.</div>
            ) : (
              <div className="space-y-2">
                {manualCommands.map((cmd, idx) => (
                  <div key={`${cmd.label}-${idx}`} className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[var(--cyan)]/20 text-[var(--cyan)]">{cmd.language}</span>
                      <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{cmd.label}</span>
                    </div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-[var(--cyan)]">{cmd.code}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EvidencePanel;

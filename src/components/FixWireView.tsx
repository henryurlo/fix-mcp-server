'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

function FixWireView({ sessions }: { sessions: any[] }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/fix-wire')
      .then(r => r.json())
      .then(data => setMessages((data || []).slice(0, 50)))
      .catch(() => {});
  }, [sessions]);

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[14px] text-[var(--text-muted)]">
        No FIX wire messages yet. Run a scenario step to generate traffic.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {messages.map((msg, i) => {
        const typeColor = msg.msg_type === 'D' ? 'var(--cyan)' : msg.msg_type === '8' ? 'var(--green)' : msg.msg_type === '3' ? 'var(--red)' : 'var(--text-muted)';
        const isExpanded = expanded === i;
        return (
          <button key={i} onClick={() => setExpanded(isExpanded ? null : i)}
            className={`w-full text-left px-3 py-2 border-b border-[var(--border-dim)] hover:bg-[var(--bg-elevated)] transition-colors ${isExpanded ? 'bg-[var(--bg-elevated)]' : ''}`}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-dim)] font-mono w-[90px]">{msg.ts?.split('T')[1]?.split('.')[0] || msg.ts}</span>
              <span className="text-[12px] font-bold font-mono" style={{ color: typeColor }}>{msg.type}</span>
              <span className="text-[12px] text-[var(--text-secondary)] truncate">{msg.symbol || ''} {msg.side ? `· ${msg.side}` : ''} {msg.qty ? `· ${msg.qty}` : ''}</span>
              <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto">{msg.venue || ''}</span>
              <ChevronRight size={12} className={`text-[var(--text-dim)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            {isExpanded && msg.message && (
              <pre className="mt-2 text-[12px] font-mono text-[var(--green)] leading-relaxed whitespace-pre-wrap break-all">{msg.message}</pre>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══ Main Page ═══

export default FixWireView;

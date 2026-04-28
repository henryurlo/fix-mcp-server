'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Radio, ShieldCheck } from 'lucide-react';

const TAG_LABELS: Record<string, string> = {
  '8': 'BeginString',
  '9': 'BodyLength',
  '35': 'MsgType',
  '34': 'MsgSeqNum',
  '49': 'SenderCompID',
  '52': 'SendingTime',
  '56': 'TargetCompID',
  '11': 'ClOrdID',
  '37': 'OrderID',
  '38': 'OrderQty',
  '39': 'OrdStatus',
  '54': 'Side',
  '55': 'Symbol',
  '58': 'Text',
  '100': 'ExDestination',
  '150': 'ExecType',
};

function decodeFix(raw: string) {
  return raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [tag, ...rest] = part.split('=');
      return { tag, label: TAG_LABELS[tag] || 'Tag', value: rest.join('=') };
    });
}

function messagePurpose(msgType: string) {
  if (msgType === 'D') return 'new order sent to venue';
  if (msgType === '8') return 'execution report from venue';
  if (msgType === '3') return 'reject proving the venue refused the message';
  if (msgType === '4') return 'sequence reset / recovery traffic';
  if (msgType === 'A') return 'session logon';
  return 'wire-level FIX evidence';
}

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
      <div className="flex h-full items-center justify-center bg-[#f8fafc]">
        <div className="max-w-xl px-6 text-center">
          <ShieldCheck size={34} className="text-[var(--cyan)] mx-auto mb-3" />
          <p className="text-[16px] font-bold text-[var(--text-primary)] mb-2">FIX Wire proves what actually crossed the session</p>
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
            Use this after a runbook step or agent run to show executives the protocol evidence behind the decision: NewOrderSingle, ExecutionReport, Reject, Logon, and SequenceReset traffic. Run a scenario step to generate wire records.
          </p>
        </div>
      </div>
    );
  }

  const rejectCount = messages.filter((m) => m.msg_type === '3').length;
  const executionCount = messages.filter((m) => m.msg_type === '8').length;
  const orderCount = messages.filter((m) => m.msg_type === 'D').length;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-base)]">
      <div className="sticky top-0 z-10 border-b border-[var(--border-dim)] bg-[var(--bg-base)]/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[14px] font-bold text-[var(--text-primary)]">
              <Radio size={15} className="text-[var(--cyan)]" />
              FIX Wire Evidence
            </div>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              Protocol transcript used to prove what the MCP tools and agent observed.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-3 py-1">
              <div className="font-mono text-[14px] font-bold text-[var(--cyan)]">{orderCount}</div>
              <div className="text-[9px] uppercase text-[var(--text-muted)]">35=D</div>
            </div>
            <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-3 py-1">
              <div className="font-mono text-[14px] font-bold text-[var(--green)]">{executionCount}</div>
              <div className="text-[9px] uppercase text-[var(--text-muted)]">35=8</div>
            </div>
            <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-surface)] px-3 py-1">
              <div className="font-mono text-[14px] font-bold text-[var(--red)]">{rejectCount}</div>
              <div className="text-[9px] uppercase text-[var(--text-muted)]">35=3</div>
            </div>
          </div>
        </div>
      </div>
      {messages.map((msg, i) => {
        const typeColor = msg.msg_type === 'D' ? 'var(--cyan)' : msg.msg_type === '8' ? 'var(--green)' : msg.msg_type === '3' ? 'var(--red)' : 'var(--text-muted)';
        const isExpanded = expanded === i;
        const decoded = msg.message ? decodeFix(msg.message) : [];
        return (
          <button key={i} onClick={() => setExpanded(isExpanded ? null : i)}
            className={`w-full text-left px-4 py-3 border-b border-[var(--border-dim)] hover:bg-[var(--bg-elevated)] transition-colors ${isExpanded ? 'bg-[var(--bg-elevated)]' : ''}`}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-dim)] font-mono w-[90px] shrink-0">{msg.ts?.split('T')[1]?.split('.')[0] || msg.ts}</span>
              <span className="text-[12px] font-bold font-mono shrink-0" style={{ color: typeColor }}>{msg.type}</span>
              <span className="text-[12px] text-[var(--text-secondary)] truncate">{messagePurpose(msg.msg_type)} {msg.symbol ? `· ${msg.symbol}` : ''} {msg.side ? `· ${msg.side}` : ''} {msg.qty ? `· ${msg.qty}` : ''}</span>
              <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto">{msg.venue || ''}</span>
              <ChevronRight size={12} className={`text-[var(--text-dim)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            {isExpanded && msg.message && (
              <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                <pre className="rounded-md border border-[#334155] bg-[#0f172a] p-3 text-[12px] font-mono text-[#e2e8f0] leading-relaxed whitespace-pre-wrap break-all">{msg.message}</pre>
                <div className="rounded-md border border-[var(--border-dim)] bg-[var(--bg-base)] p-2">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Decoded Tags</div>
                  <div className="grid grid-cols-1 gap-1">
                    {decoded.slice(0, 12).map((part, idx) => (
                      <div key={`${part.tag}-${idx}`} className="grid grid-cols-[44px_110px_1fr] gap-2 rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-[11px]">
                        <span className="font-bold" style={{ color: typeColor }}>{part.tag}</span>
                        <span className="text-[var(--text-muted)]">{part.label}</span>
                        <span className="truncate text-[var(--text-primary)]">{part.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══ Main Page ═══

export default FixWireView;

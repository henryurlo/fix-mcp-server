'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, Loader2, Play, Radio, Send, Zap } from 'lucide-react';
import { useChat, useSystem } from '@/store';

const DEFAULT_PROMPT = 'Drop BATS heartbeat for 90 seconds';

export default function DemoPage() {
  const {
    available_scenarios,
    scenario,
    sessions,
    orders,
    fixWire,
    triageNarrative,
    sseConnected,
    connected,
    stuck_count,
    refresh,
    subscribeEvents,
    startScenario,
    callTool,
  } = useSystem();
  const { messages, send, isTyping } = useChat();
  const [selectedScenario, setSelectedScenario] = useState('midday_chaos_1205');
  const [input, setInput] = useState(DEFAULT_PROMPT);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    refresh();
    const unsubscribe = subscribeEvents();
    if (useSystem.getState().controlMode !== 'agent') {
      useSystem.getState().takeOverAsAgent().catch(() => {});
    }
    return unsubscribe;
  }, [refresh, subscribeEvents]);

  useEffect(() => {
    if (!available_scenarios.length) return;
    const hasMidday = available_scenarios.some((s) => s.name === 'midday_chaos_1205');
    setSelectedScenario((current) => {
      if (available_scenarios.some((s) => s.name === current)) return current;
      return hasMidday ? 'midday_chaos_1205' : available_scenarios[0].name;
    });
  }, [available_scenarios]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [fixWire]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-10),
    [messages],
  );

  const activeScenarioTitle = available_scenarios.find((s) => s.name === scenario)?.title || scenario || 'No scenario';
  const downVenues = sessions.filter((s) => s.status === 'down').map((s) => s.venue);
  const degradedVenues = sessions.filter((s) => s.status === 'degraded').map((s) => s.venue);

  async function withBusy(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  async function loadScenario() {
    await withBusy('load', async () => {
      await startScenario(selectedScenario);
      if (useSystem.getState().controlMode !== 'agent') {
        await useSystem.getState().takeOverAsAgent();
      }
    });
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    await withBusy('prompt', async () => {
      if (useSystem.getState().controlMode !== 'agent') {
        await useSystem.getState().takeOverAsAgent();
      }
      await send(prompt);
    });
  }

  async function quickInject(label: string, args: Record<string, unknown>) {
    await withBusy(label, async () => {
      await callTool('inject_event', args);
    });
  }

  return (
    <main className="min-h-screen bg-[#050606] text-[#e6edf0] font-mono">
      <div className="h-screen grid grid-rows-[auto_minmax(0,1fr)_minmax(190px,34vh)]">
        <header className="border-b border-[#26312d] bg-[#0b0e0d] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Radio size={16} className={sseConnected ? 'text-emerald-300 animate-pulse' : 'text-amber-300'} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8ea49c]">FIX MCP Demo</div>
                <div className="truncate text-[15px] text-[#f4f7f5]">{activeScenarioTitle}</div>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                className="h-9 max-w-[260px] rounded border border-[#35453f] bg-[#111715] px-2 text-[12px] text-[#dce7e3] outline-none focus:border-cyan-300"
              >
                {available_scenarios.map((s) => (
                  <option key={s.name} value={s.name}>{s.title || s.name}</option>
                ))}
              </select>
              <button
                onClick={loadScenario}
                disabled={busyAction !== null}
                className="h-9 inline-flex items-center gap-1.5 rounded border border-cyan-400/40 bg-cyan-400/10 px-3 text-[12px] font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
              >
                {busyAction === 'load' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Load Scenario
              </button>
              <button
                onClick={() => quickInject('BATS', { event_type: 'venue_outage', target: 'BATS', delay_sec: 90, details: 'Demo quick inject: drop BATS heartbeat for 90 seconds' })}
                disabled={busyAction !== null}
                className="h-9 inline-flex items-center gap-1.5 rounded border border-amber-300/40 bg-amber-300/10 px-3 text-[12px] font-semibold text-amber-200 hover:bg-amber-300/20 disabled:opacity-50"
              >
                <Zap size={13} />
                Drop BATS
              </button>
              <button
                onClick={() => quickInject('NYSE', { event_type: 'seq_gap', target: 'NYSE', details: 'Demo quick inject: NYSE sequence gap' })}
                disabled={busyAction !== null}
                className="h-9 inline-flex items-center gap-1.5 rounded border border-rose-300/40 bg-rose-300/10 px-3 text-[12px] font-semibold text-rose-200 hover:bg-rose-300/20 disabled:opacity-50"
              >
                <Activity size={13} />
                NYSE Gap
              </button>
            </div>
          </div>
        </header>

        <section className="min-h-0 overflow-y-auto px-4 py-4">
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="API" value={connected ? 'ONLINE' : 'OFFLINE'} tone={connected ? 'good' : 'bad'} />
            <Metric label="STREAM" value={sseConnected ? 'LIVE' : 'WAIT'} tone={sseConnected ? 'good' : 'warn'} />
            <Metric label="STUCK" value={String(stuck_count)} tone={stuck_count ? 'bad' : 'good'} />
            <Metric label="VENUES" value={[...downVenues, ...degradedVenues].join(', ') || 'GREEN'} tone={downVenues.length ? 'bad' : degradedVenues.length ? 'warn' : 'good'} />
          </div>

          <div className="h-full min-h-[280px] rounded border border-[#26312d] bg-[#0a0f0d]">
            <div className="flex items-center justify-between border-b border-[#26312d] px-3 py-2">
              <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-[#8ea49c]">
                <Bot size={14} className="text-cyan-200" />
                AI Triage
              </div>
              {isTyping && <Loader2 size={14} className="animate-spin text-cyan-200" />}
            </div>
            <div className="max-h-[calc(66vh-150px)] min-h-[240px] overflow-y-auto p-3">
              {triageNarrative && (
                <div className="mb-3 border-l-2 border-amber-300 bg-amber-300/10 px-3 py-2 text-[14px] leading-relaxed text-amber-100">
                  {triageNarrative}
                </div>
              )}

              <div className="space-y-2">
                {visibleMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={msg.role === 'user'
                      ? 'ml-auto max-w-[820px] rounded border border-[#35453f] bg-[#111715] px-3 py-2 text-[13px] text-[#f4f7f5]'
                      : 'max-w-[920px] rounded border border-[#20352f] bg-[#0e1713] px-3 py-2 text-[13px] leading-relaxed text-[#cfe5dd]'}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[#70837b]">
                      {msg.role === 'user' ? 'Operator' : 'Agent'}
                    </div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.toolCalls?.length ? (
                      <div className="mt-2 space-y-1 border-t border-[#22302b] pt-2">
                        {msg.toolCalls.map((tc, index) => (
                          <div key={`${tc.tool}-${index}`} className="flex flex-wrap items-center gap-2 text-[11px] text-[#9db4ac]">
                            <span className={tc.status === 'success' ? 'text-emerald-300' : tc.status === 'error' ? 'text-rose-300' : 'text-amber-200'}>
                              {tc.status.toUpperCase()}
                            </span>
                            <span className="text-cyan-200">{tc.tool}</span>
                            <span className="truncate text-[#6f837b]">{JSON.stringify(tc.args)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={submitPrompt} className="flex gap-2 border-t border-[#26312d] p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#35453f] bg-[#070b09] px-3 py-2 text-[13px] text-[#f4f7f5] outline-none focus:border-cyan-300"
                placeholder={DEFAULT_PROMPT}
              />
              <button
                type="submit"
                disabled={busyAction !== null || isTyping}
                className="inline-flex h-10 items-center gap-1.5 rounded border border-emerald-300/40 bg-emerald-300/10 px-4 text-[12px] font-semibold text-emerald-200 hover:bg-emerald-300/20 disabled:opacity-50"
              >
                {busyAction === 'prompt' || isTyping ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </button>
            </form>
          </div>
        </section>

        <section className="min-h-0 border-t border-[#26312d] bg-[#070a08]">
          <div className="flex items-center justify-between border-b border-[#1c2823] px-4 py-2">
            <div className="text-[12px] uppercase tracking-[0.16em] text-[#8ea49c]">Live FIX Log</div>
            <div className="text-[11px] text-[#6f837b]">{orders.length} open orders</div>
          </div>
          <div className="h-full overflow-y-auto px-4 py-2 text-[11px]">
            {fixWire.length === 0 ? (
              <div className="py-8 text-center text-[#6f837b]">Awaiting FIX traffic</div>
            ) : (
              <div className="space-y-1">
                {fixWire.slice().reverse().map((entry, index) => (
                  <div key={`${entry.ts}-${entry.raw}-${index}`} className="grid grid-cols-[88px_54px_72px_1fr] gap-2 border-b border-[#111a16] py-1">
                    <span className="truncate text-[#6f837b]">{entry.ts ? entry.ts.slice(11, 19) : '--:--:--'}</span>
                    <span className={entry.type === 'SessionState' && entry.raw.includes('down') ? 'text-rose-300' : 'text-emerald-300'}>
                      {entry.venue || 'SYS'}
                    </span>
                    <span className="text-cyan-200">{entry.type}</span>
                    <span className="truncate text-[#b7cbc3]">{entry.raw}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-200' : 'text-rose-300';
  return (
    <div className="rounded border border-[#26312d] bg-[#0a0f0d] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#6f837b]">{label}</div>
      <div className={`truncate text-[15px] font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { BookOpen, Terminal, Shield, BookCopy, X } from 'lucide-react';

const GLOSSARY = [
  { term: 'FIX (Financial Information Exchange)', def: 'Standard protocol for electronic communication of securities transactions. Version 4.2/4.4 are most common in equities.' },
  { term: 'MCP (Model Context Protocol)', def: 'Protocol that lets LLMs interact with tools, resources, and prompts through a standardized interface.' },
  { term: 'OMS (Order Management System)', def: 'System that tracks and manages the lifecycle of orders from creation through execution.' },
  { term: 'ClOrdID', def: 'Client Order ID — unique identifier assigned by the sender of a new order (FIX tag 11).' },
  { term: 'OrdStatus', def: 'Order status: 0=Filled, 1=Partial, 2=New/pending, A=Pending New, 8=Rejected, C=Cancelled.' },
  { term: 'LULD', def: 'Limit Up Limit Down — circuit breaker mechanism that halts trading if a stock moves beyond defined price bands within 5 minutes.' },
  { term: 'SSR', def: 'Short Sale Restriction — triggered when a stock drops 10%+ in a day. Restricts short-selling to uptick only.' },
  { term: 'MOC', def: 'Market On Close — orders executed at the closing auction price.' },
  { term: 'MOO', def: 'Market On Open — orders executed at the opening auction price.' },
  { term: 'TWAP', def: 'Time-Weighted Average Price — algo that slices a large order evenly over time to minimize market impact.' },
  { term: 'VWAP', def: 'Volume-Weighted Average Price — algo that tries to match the volume-weighted average price over a specified period.' },
  { term: 'POV', def: 'Participation Rate — algo that participates in a fixed percentage of market volume.' },
  { term: 'Implementation Shortfall (IS)', def: 'Algo strategy that balances timing risk vs. market impact vs. spread cost to minimize execution cost.' },
  { term: 'Dark Pool', def: 'Private exchange where large orders can be executed without revealing order book depth.' },
  { term: 'Seq Gap', def: 'Sequence number gap in FIX messages — indicates dropped messages, recovered via ResendRequest (35=2).' },
  { term: 'Venue', def: 'Trading venue/exchange: NYSE, NASDAQ, BATS, ARCA, IEX, Dark Pools.' },
  { term: 'MTTR', def: 'Mean Time To Recovery — average time to restore service after an incident.' },
  { term: 'FixMsgType', def: 'FIX message type: A=Logon, D=NewOrder, F=Cancel, G=CancelReplace, 8=ExecutionReport, 3=Reject.' },
];

const TABS = [
  { id: 'what' as const, label: 'What is this?', icon: BookOpen },
  { id: 'how' as const, label: 'How to use', icon: Terminal },
  { id: 'scenarios' as const, label: 'Scenarios', icon: BookCopy },
  { id: 'glossary' as const, label: 'Glossary', icon: Shield },
];

export function OnboardingPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'what' | 'how' | 'scenarios' | 'glossary'>('what');
  const [glossaryQuery, setGlossaryQuery] = useState('');

  const filteredGlossary = GLOSSARY.filter((item) => {
    const q = glossaryQuery.trim().toLowerCase();
    if (!q) return true;
    return item.term.toLowerCase().includes(q) || item.def.toLowerCase().includes(q);
  });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-bright)] rounded-2xl w-[680px] max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-dim)] shrink-0">
          <h2 className="text-[18px] font-bold bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)] bg-clip-text text-transparent">
            FIX-MCP Trading Desk Simulator - Getting Started
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] transition-colors">
            <X size={18} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[var(--border-dim)] px-6 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-[13px] font-semibold transition-all border-b-2 ${
                tab === id
                  ? 'border-[var(--cyan)] text-[var(--cyan)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'what' && (
            <div className="space-y-4">
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-dim)] p-5">
                <h3 className="text-[16px] font-bold text-[var(--text-primary)] mb-2">What is the FIX-MCP Simulator?</h3>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-3">
                  A professional open-source demo for presenting how FIX infrastructure, MCP tools,
                  human approval, and incident-response runbooks fit together on a modern trading desk.
                </p>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-3">
                  <b className="text-[var(--text-primary)]">FIX</b> (Financial Information Exchange) is the standard 
                  protocol used by every major exchange, broker-dealer, and trading firm to communicate order flows, 
                  execution reports, and market data. When things go wrong — sessions disconnect, sequence numbers 
                  drift, venues go down — engineers need to diagnose and fix problems in minutes, not hours.
                </p>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
                  This simulator creates realistic failure scenarios (venue outages, corporate actions, circuit breakers,
                  algo degradation), then lets a human operator or AI copilot work the same workflow a real desk would:
                  inspect sessions, query orders, review traces, approve a recovery workbook, and execute explainable runbooks. Every AI action maps
                  to actual FIX-level or Linux/SQL commands.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { title: 'Trading Desk', desc: 'Review protocol-level diagnostics without risking real orders' },
                  { title: 'SRE / DevOps', desc: 'Observe FIX session management, sequence recovery, and failover' },
                  { title: 'AI / CTO', desc: 'See how MCP turns documentation and tools into bounded agent work' },
                ].map((item, i) => (
                  <div key={i} className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-dim)] p-4 text-center">
                    <div className="text-[13px] font-bold text-[var(--text-primary)] mb-1">{item.title}</div>
                    <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'how' && (
            <div className="space-y-4">
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-dim)] p-5">
                <h3 className="text-[16px] font-bold text-[var(--text-primary)] mb-4">How to Run a Scenario</h3>
                <div className="space-y-4">
                  {[
                    {
                      step: '1',
                      title: 'Pick a scenario',
                      desc: 'Use the scenario dropdown in the header or browse the scenario cards on the landing page. Each scenario represents a real trading desk incident: ARCA session down, MOC deadline missed, LULD halt, and related operational failures.',
                      highlight: 'Select from the scenarios dropdown',
                    },
                    {
                      step: '2',
                      title: 'Read the case brief',
                      desc: 'Each scenario presents a narrative briefing: the time, what went wrong, what symptoms to inspect, and what success looks like.',
                      highlight: '',
                    },
                    {
                      step: '3',
                      title: 'Follow the runbook steps',
                      desc: 'Click through each step in order, or approve the full workbook from Mission Control. Each step shows the MCP tool, expected output, and evidence produced.',
                      highlight: 'Run each step in sequence',
                    },
                    {
                      step: '4',
                      title: 'Explore the Trace tab',
                      desc: 'Every tool call is logged in the Trace tab — timestamps, inputs, outputs, latency. This is the audit trail. If something goes wrong, this is where you look first.',
                      highlight: 'Toggle the Trace tab below the runbook',
                    },
                    {
                      step: '5',
                      title: 'Check the Manual Runbook',
                      desc: 'The Runbook panel shows the exact Linux, SQL, and FIX commands a human would run to achieve the same result. Every AI action is explainable.',
                      highlight: '',
                    },
                    {
                      step: '6',
                      title: 'Score your performance',
                      desc: 'Once all steps are complete, the scoring panel shows your KPIs: time-to-recovery, SLA compliance, regulatory compliance, and notional preserved. Aim for A (90+) every time.',
                      highlight: '',
                    },
                  ].map(item => (
                    <div key={item.step} className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-[var(--cyan)]/20 border border-[var(--cyan)]/40 flex items-center justify-center shrink-0">
                        <span className="text-[14px] font-bold text-[var(--cyan)]">{item.step}</span>
                      </div>
                      <div>
                        <div className="text-[14px] font-bold text-[var(--text-primary)] mb-0.5">{item.title}</div>
                        <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{item.desc}</div>
                        {item.highlight && (
                          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--cyan-dim)] rounded text-[11px] text-[var(--cyan)] font-semibold">
                            {item.highlight}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'scenarios' && (
            <div className="space-y-4">
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-dim)] p-5">
                <h3 className="text-[16px] font-bold text-[var(--text-primary)] mb-3">How Scenarios Work</h3>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-3">
                  Each scenario is a structured configuration that sets up a specific trading-ops incident. 
                  Scenarios define:
                </p>
                <ul className="space-y-2 text-[13px] text-[var(--text-secondary)]">
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--cyan)] font-bold mt-0.5">•</span>
                    <span><b className="text-[var(--text-primary)]">Simulated time</b> - when the incident occurred (pre-market, opening, EOD, etc.)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--cyan)] font-bold mt-0.5">•</span>
                    <span><b className="text-[var(--text-primary)]">Seeded state</b> - FIX sessions with specific statuses, orders in various states across venues</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--cyan)] font-bold mt-0.5">•</span>
                    <span><b className="text-[var(--text-primary)]">Runbook steps</b> - ordered sequence of tool calls to diagnose and resolve the issues</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--cyan)] font-bold mt-0.5">•</span>
                    <span><b className="text-[var(--text-primary)]">Success criteria</b> - what "done" looks like for this scenario</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--cyan)] font-bold mt-0.5">•</span>
                    <span><b className="text-[var(--text-primary)]">Hints</b> - guidance for diagnosing the issues without giving away the answer</span>
                  </li>
                </ul>
              </div>

              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-dim)] p-5">
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] mb-2">Stress Infrastructure</h3>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  Each scenario also includes a <b className="text-[var(--green)]">stress panel</b>
                  with time control, KPI scoring, state snapshots, and event injection. These tools let you
                  rehearse incident response under time pressure, save state before risky operations,
                  and inject additional failures mid-scenario to evaluate the operating model.
                </p>
              </div>
            </div>
          )}

          {tab === 'glossary' && (
            <div>
              <div className="mb-3">
                <input
                  type="text"
                  value={glossaryQuery}
                  onChange={(e) => setGlossaryQuery(e.target.value)}
                  placeholder="Search terms..."
                  className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-dim)] rounded-lg text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--cyan)]/50"
                />
              </div>
              <div className="space-y-2">
                {filteredGlossary.map((item, i) => (
                  <div key={i} className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-dim)] p-4">
                    <div className="text-[13px] font-bold text-[var(--cyan)] mb-1">{item.term}</div>
                    <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{item.def}</div>
                  </div>
                ))}
                {filteredGlossary.length === 0 && (
                  <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-dim)] p-4 text-[13px] text-[var(--text-muted)]">
                    No glossary terms match "{glossaryQuery}".
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat, ChatMessage } from '@/store';
import { useSystem } from '@/store';
import { Send, X, Key, Bot, CheckCircle, AlertCircle, Loader2, AlertTriangle, Shield, Terminal, Zap, Radio, Wrench } from 'lucide-react';

// Quick-prompt buttons — context-aware
const QUICK_PROMPTS = [
  { icon: '🔍', label: 'System status', prompt: 'What is the current system status? Check all sessions, engines, and report any issues.' },
  { icon: '📋', label: 'Open orders', prompt: 'Query all open orders. Show what\'s stuck, what\'s at risk, and SLA status.' },
  { icon: '🔧', label: 'Fix sessions', prompt: 'Check all FIX sessions across exchanges. Identify degraded/down venues and recommend fixes.' },
  { icon: '⚠️', label: 'Risk analysis', prompt: 'Analyze current scenario risk. What SLAs are breaching? What needs immediate action?' },
  { icon: '📊', label: 'Market data', prompt: 'Check all market data feeds. Are any venues stale or disconnected? Check FX rates for anomalies.' },
  { icon: '🔗', label: 'Interlist check', prompt: 'Verify interlisted symbol resolution. Are all cross-venue mappings working correctly?' },
];

// Scenario-specific quick prompts -- now sourced from the loaded scenario JSON hints
// (key_problems, diagnosis_path, common_mistakes). This map provides fallback
// prompts if a scenario JSON is not yet loaded.
const SCENARIO_QUICK_ACTION: Record<string, Array<{ icon: string; label: string; prompt: string }>> = {
  morning_triage: [
    { icon: '🔍', label: 'Check ARCA', prompt: 'Check ARCA session -- it should be down. Attempt reconnection.' },
    { icon: '📋', label: 'Stale tickers', prompt: 'Check for ACME→ACMX ticker rename and verify all affected orders.' },
    { icon: '🆕', label: 'Load ZEPH', prompt: 'Load the ZEPH IPO symbol so pending orders can proceed.' },
  ],
  venue_degradation_1030: [
    { icon: '📡', label: 'NYSE latency', prompt: 'Check NYSE latency -- it should be ~180ms. Dump session state.' },
    { icon: '📊', label: 'Stuck orders', prompt: 'Query all NYSE orders -- identify stuck and listing-venue-required.' },
    { icon: '🔧', label: 'Reconnect', prompt: 'Attempt NYSE reconnection. Check if latency improves.' },
  ],
  ssr_and_split_1130: [
    { icon: '⚖️', label: 'RIDE SSR', prompt: 'Check RIDE SSR status and rejected short orders.' },
    { icon: '✂️', label: 'AAPL split', prompt: 'Find all AAPL orders that need 4:1 split adjustment before 12:00 ET.' },
  ],
};


export function ChatPanel() {
  const { messages, isOpen, isTyping, openRouterKey, toggleOpen, send, setKey, clear } = useChat();
  const { mode, scenario, scenarioContext, controlMode, takeOverAsAgent, releaseToHuman, toggleCollab, locked } = useSystem();
  const [input, setInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!input.trim()) return;
    send(input.trim());
    setInput('');
  };

  const handleKeySubmit = () => {
    if (keyInput.trim().startsWith('sk-or-') || keyInput.trim().startsWith('sk-')) {
      setKey(keyInput.trim());
      setShowKeyModal(false);
      setKeyInput('');
    }
  };

  // Context-aware prompts: prefer runbook steps from loaded scenarioContext,
  // fall back to the hardcoded SCENARIO_QUICK_ACTION map, then general prompts.
  const runbookPrompts = scenarioContext?.runbook?.steps?.map((s) => ({
    icon: '⚡',
    label: `Step ${s.step}: ${s.title}`,
    prompt: `Run runbook step ${s.step}: ${s.title}. ${s.narrative}`,
  })) || [];

  const fallbackPrompts = scenario ? (SCENARIO_QUICK_ACTION[scenario] || []) : [];
  const scenarioPrompts = runbookPrompts.length > 0 ? runbookPrompts : fallbackPrompts;
  const allPrompts = [...scenarioPrompts, ...QUICK_PROMPTS];

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border-dim)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--purple)] to-[var(--blue)] flex items-center justify-center">
            <Terminal size={12} className="text-white" />
          </div>
          <div>
            <span className="text-[14px] font-bold text-[var(--text-primary)]">SRE Copilot</span>
            {scenario && (
              <div className="flex items-center gap-1">
                <Radio size={8} className="text-[var(--cyan)] animate-pulse" />
                <span className="text-[14px] font-mono text-[var(--cyan)]">{scenario}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Control mode buttons */}
          {scenario && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                onClick={() => releaseToHuman()}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${controlMode === 'human' ? 'bg-[var(--green-dim)] text-[var(--green)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`}
                title="Human Mode"
              >
                H
              </button>
              <button
                onClick={() => takeOverAsAgent()}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${controlMode === 'agent' ? 'bg-[var(--purple-dim)] text-[var(--purple)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`}
                title="Agent Mode"
              >
                A
              </button>
              <button
                onClick={() => toggleCollab()}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${controlMode === 'collab' ? 'bg-[var(--cyan-dim)] text-[var(--cyan)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'}`}
                title="Collaborative Mode"
              >
                C
              </button>
            </div>
          )}
          {mode === 'agent' && (
            <span className="text-[14px] bg-[var(--purple-dim)] text-[var(--purple)] px-2 py-0.5 rounded-full font-bold font-mono">
              AGENT
            </span>
          )}
          <button
            onClick={() => setShowKeyModal(true)}
            className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-primary)]"
            title="Set OpenRouter API Key"
          >
            <Key size={13} />
          </button>
          <button
            onClick={clear}
            className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-dim)] hover:text-[var(--text-primary)]"
            title="Clear chat"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length <= 1 && (
          <div className="text-center py-8">
            <Terminal size={24} className="text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[14px] text-[var(--text-muted)] mb-1">SRE Copilot Ready</p>
            <p className="text-[12px] text-[var(--text-muted)] mb-2">
              {scenarioContext
                ? `Scenario: ${scenarioContext.title}. ${scenarioContext.runbook?.steps?.length || 0} runbook steps.`
                : scenario
                ? `Active scenario: ${scenario}.`
                : 'No active scenario.'}
            </p>
            {scenario && (
              <div className="text-[11px] text-[var(--text-muted)] font-mono space-y-0.5">
                {controlMode === 'human' && <p>You are driving. Ask the Copilot for guidance.</p>}
                {controlMode === 'agent' && <p>Agent is driving. Monitor the topology and audit log.</p>}
                {controlMode === 'collab' && <p>Working together. Both can take action.</p>}
              </div>
            )}
            {!scenario && (
              <p className="text-[12px] text-[var(--text-muted)]">Select a scenario to start, or ask any question.</p>
            )}
          </div>
        )}

        {messages.filter(m => m.role !== 'system').map((msg: ChatMessage) => (
          <div key={msg.id} className={`animate-fade-in ${msg.role === 'user' ? 'ml-6' : 'mr-2'}`}>
            {msg.role === 'user' && (
              <div className="bg-[var(--bg-elevated)] rounded-xl px-3 py-2 border border-[var(--border-dim)]">
                <p className="text-[14px] text-[var(--text-primary)] whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}

            {msg.role === 'assistant' && (
              <div className="bg-[var(--bg-surface)] rounded-xl px-3 py-2 border border-[var(--border-dim)]">
                <p className="text-[14px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[var(--border-dim)] pt-2">
                    {msg.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[12px] font-mono">
                        {tc.status === 'proposed' && <AlertTriangle size={9} className="text-[var(--amber)]" />}
                        {tc.status === 'executing' && <Loader2 size={9} className="text-[var(--blue)] animate-spin" />}
                        {tc.status === 'success' && <CheckCircle size={9} className="text-[var(--green)]" />}
                        {tc.status === 'error' && <AlertCircle size={9} className="text-[var(--red)]" />}
                        {tc.status === 'approved' && <CheckCircle size={9} className="text-[var(--purple)]" />}
                        <span className="text-[var(--text-primary)]">{tc.tool}</span>
                        <span className="text-[var(--text-dim)] truncate max-w-[150px]">
                          ({JSON.stringify(tc.args)})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-[13px]">
            <Loader2 size={12} className="animate-spin text-[var(--purple)]" />
            Analyzing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-3 pb-2 shrink-0">
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {allPrompts.slice(0, 6).map((qp, i) => (
            <button
              key={i}
              onClick={() => { send(qp.prompt); }}
              className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-dim)] text-[12px] text-[var(--text-muted)] hover:border-[var(--cyan)]/30 hover:text-[var(--text-secondary)] transition-colors"
            >
              <span>{qp.icon}</span>
              {qp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[var(--border-dim)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex gap-2">
          <input
            className="input-base flex-1 !text-[14px] !py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={openRouterKey ? 'Ask about system state, diagnose issues...' : 'Set your OpenRouter key first (🔑)'}
            disabled={!openRouterKey}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !openRouterKey || isTyping}
            className="btn-primary !px-3 !py-2"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-panel-bright p-5 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-[var(--green)]" />
              <h3 className="text-sm font-bold">OpenRouter API Key</h3>
            </div>
            <p className="text-[13px] text-[var(--text-muted)] mb-3">
              Your key stays in this browser session — never sent anywhere except OpenRouter's API.
            </p>
            <input
              type="password"
              className="input-base font-mono !text-[14px] mb-3"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-..."
              onKeyDown={(e) => { if (e.key === 'Enter') handleKeySubmit(); }}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleKeySubmit} className="btn-primary flex-1">
                Activate Copilot
              </button>
              <button onClick={() => setShowKeyModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

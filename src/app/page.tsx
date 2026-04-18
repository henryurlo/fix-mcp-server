'use client';

import { useEffect, useCallback } from 'react';
import { useSystem, useChat } from '@/store';
import dynamic from 'next/dynamic';
import { Activity, Shield, Bell, Terminal, Settings, Bot, ArrowRight, AlertTriangle, CheckCircle, XCircle, Play, RefreshCw } from 'lucide-react';

// Client-only ReactFlow
const TopologyGraph = dynamic(() => import('@/components/TopologyGraph'), { ssr: false });
const ChatPanel = dynamic(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const IncidentWorkspace = dynamic(() => import('@/components/IncidentWorkspace').then(m => ({ default: m.IncidentWorkspace })), { ssr: false });

export default function Home() {
  const { scenario, available_scenarios: available, loading, startScenario, refresh, mode, setMode, sessions, events, error, connected } = useSystem();
  const { isOpen, openRouterKey, toggleOpen } = useChat();

  // Debug: log store state
  useEffect(() => {
    console.log('[debug] connected:', connected, 'error:', error, 'scenarios:', available?.length, 'scenario:', scenario);
  }, [connected, error, available, scenario]);

  // Initial load
  useEffect(() => { 
    console.log('[fix-console] v2 — refreshing store');
    refresh(); 
  }, []);

  // Auto-refresh every 5s
  useEffect(() => {
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  // ── HEADER ───────────────────────────────────────────────────────
  const header = (
    <header className="h-12 bg-[#0a0b0e] border-b border-[#1e2233] flex items-center justify-between px-4 shrink-0">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <Shield size={18} className="text-[#10b981]" />
        <span className="text-sm font-bold tracking-wider">FIX MCP</span>
        <span className="text-[10px] text-[#5a6178] font-mono">AI Operations Theater</span>
        {scenario && (
          <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a1d26] border border-[#2a2f42] text-[10px] font-mono text-[#3b82f6]">
            <Activity size={10} /> {scenario}
          </span>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {error && (
          <span className="text-[10px] text-[#ef4444] font-mono">{error}</span>
        )}
        {connected && (
          <span className="flex items-center gap-1 text-[10px] text-[#10b981] font-mono">
            <CheckCircle size={10} /> Connected
          </span>
        )}

        {/* Mode Toggle */}
        <button
          onClick={() => setMode(mode === 'human' ? 'agent' : 'human')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
            mode === 'agent'
              ? 'bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/40'
              : 'text-[#5a6178] border border-[#2a2f42]'
          }`}
        >
          <Bot size={12} />
          {mode === 'agent' ? 'AGENT' : 'HUMAN'}
        </button>

        {/* Scenario Selector */}
        <select
          value={scenario || ''}
          onChange={(e) => e.target.value && startScenario(e.target.value)}
          className="bg-[#12141a] border border-[#2a2f42] rounded-lg px-2 py-1 text-[10px] text-[#e4e7f1] focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="">Scenario...</option>
          {available?.map((s: any) => (
            <option key={s.name} value={s.name}>
              {s.name}{s.is_algo ? ' ⚡' : ''}
            </option>
          ))}
        </select>

        {/* Copilot Toggle */}
        <button
          onClick={toggleOpen}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
            openRouterKey
              ? 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/40'
              : 'text-[#5a6178] border-[#2a2f42]'
          }`}
        >
          <Terminal size={12} />
          Copilot
          {!openRouterKey && <span className="ml-1 text-[#f59e0b]">🔑</span>}
        </button>
      </div>
    </header>
  );

  // ── MAIN CONTENT ─────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[#0a0b0e] text-[#e4e7f1]">
      {header}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Center: Topology + Incident Workspace */}
        <main className="flex-1 flex flex-col relative">
          {/* Topology — always visible, shrinks when scenario active */}
          <div className={`relative transition-all duration-300 ${scenario ? 'h-3/5' : 'h-full'}`}>
            <TopologyGraph />

            {/* Empty state overlay (no scenario) */}
            {!scenario && !loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0b0e]/80 backdrop-blur-sm z-10">
                <Shield size={48} className="text-[#10b981] mb-4" />
                <h1 className="text-2xl font-bold text-[#e4e7f1] mb-2">AI Operations Theater</h1>
                <p className="text-sm text-[#5a6178] text-center max-w-sm mb-6">
                  A scenario-driven trading operations console where an LLM agent diagnoses failures, proposes fixes, and executes through MCP tools — with human approval
                </p>
                <div className="text-[10px] text-[#5a6178] mb-4">
                  Select a scenario above to begin
                </div>
              </div>
            )}
          </div>

          {/* Incident Workspace — auto-opens when scenario is active */}
          {scenario && (
            <div className="h-2/5 border-t border-[#1e2233] bg-[#0a0b0e] overflow-hidden">
              <IncidentWorkspace />
            </div>
          )}
        </main>

        {/* Right: Copilot Slide */}
        <aside className={`transition-all duration-300 bg-[#0d0e12] border-l border-[#1e2233] ${
          isOpen ? 'w-96' : 'w-0'
        } overflow-hidden shrink-0`}>
          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}

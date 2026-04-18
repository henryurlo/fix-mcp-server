'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat, ChatMessage } from '@/store';
import { useSystem } from '@/store';
import { Send, X, Key, Bot, CheckCircle, AlertCircle, Loader2, ArrowRight, AlertTriangle, Shield, Terminal } from 'lucide-react';

// Quick-prompt buttons for common operations
const QUICK_PROMPTS = [
  { icon: '🔍', label: 'What\'s the status?', prompt: 'What is the current system status? Check all sessions and report any issues.' },
  { icon: '📋', label: 'Show orders', prompt: 'Query all open orders. Show me what\'s stuck and what\'s at risk.' },
  { icon: '🔧', label: 'Fix sessions', prompt: 'Check all FIX sessions. Identify any degraded or down venues and recommend fixes.' },
  { icon: '⚠️', label: 'Risk analysis', prompt: 'Analyze the current scenario risk. What SLAs are about to breach?' },
];

export function ChatPanel() {
  const { messages, isOpen, isTyping, openRouterKey, toggleOpen, send, setKey, clear, approveToolCall } = useChat();
  const { mode } = useSystem();
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

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#0d0e12] border-l border-[#1e2233]">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#1e2233] bg-[#12141a]">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[#8b5cf6]" />
          <span className="text-sm font-semibold text-[#e4e7f1]">AI Operations Copilot</span>
          {mode === 'agent' && (
            <span className="text-[9px] bg-[#8b5cf6]/20 text-[#8b5cf6] px-2 py-0.5 rounded-full font-semibold">
              AGENT MODE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowKeyModal(true)}
            className="p-1.5 rounded hover:bg-[#222633] text-[#5a6178] hover:text-[#e4e7f1]"
            title="Set OpenRouter API Key"
          >
            <Key size={14} />
          </button>
          <button
            onClick={toggleOpen}
            className="p-1.5 rounded hover:bg-[#222633] text-[#5a6178] hover:text-[#e4e7f1]"
            title="Close copilot"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.filter(m => m.role !== 'system').map((msg: ChatMessage) => (
          <div key={msg.id} className={`space-y-2 ${msg.role === 'user' ? 'ml-8' : msg.role === 'tool' ? 'ml-4' : 'mr-4'}`}>
            {/* User message */}
            {msg.role === 'user' && (
              <div className="bg-[#1a1d26] rounded-xl px-3 py-2.5 border border-[#2a2f42]">
                <p className="text-sm text-[#e4e7f1] whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}

            {/* Assistant message */}
            {msg.role === 'assistant' && (
              <div className="bg-[#12141a] rounded-xl px-3 py-2.5 border border-[#1e2233]">
                <p className="text-sm text-[#8b92a8] whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                {/* Tool call traces */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {msg.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono bg-[#0a0b0e] border border-[#1a1d26] rounded px-2 py-1">
                        {tc.status === 'proposed' && <AlertTriangle size={10} className="text-[#f59e0b]" />}
                        {tc.status === 'executing' && <Loader2 size={10} className="text-[#3b82f6] animate-spin" />}
                        {tc.status === 'success' && <CheckCircle size={10} className="text-[#10b981]" />}
                        {tc.status === 'error' && <AlertCircle size={10} className="text-[#ef4444]" />}
                        {tc.status === 'approved' && <CheckCircle size={10} className="text-[#8b5cf6]" />}

                        <span className="text-[#e4e7f1]">{tc.tool}</span>
                        <span className="text-[#5a6178] truncate">({Object.keys(tc.args).length ? JSON.stringify(tc.args) : ''})</span>

                        {tc.status === 'proposed' && (
                          <button
                            onClick={() => approveToolCall(msg.id, i)}
                            className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/40 hover:bg-[#8b5cf6]/25"
                          >
                            APPROVE
                          </button>
                        )}
                        {tc.result && tc.status === 'success' && (
                          <span className="ml-auto text-[#10b981] truncate max-w-[140px]" title={tc.result}>
                            ✓ {tc.result.slice(0, 40)}
                          </span>
                        )}
                        {tc.result && tc.status === 'error' && (
                          <span className="ml-auto text-[#ef4444] truncate max-w-[140px]" title={tc.result}>
                            ✗ {tc.result.slice(0, 40)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 ml-4 text-[#5a6178] text-xs">
            <Loader2 size={14} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 pb-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              onClick={() => setInput(qp.prompt)}
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#12141a] border border-[#1e2233] text-[10px] text-[#8b92a8] hover:border-[#3b82f6] hover:text-[#e4e7f1] transition-colors"
            >
              <span>{qp.icon}</span>
              {qp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#1e2233] bg-[#12141a]">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[#0a0b0e] border border-[#2a2f42] rounded-lg px-3 py-2 text-sm text-[#e4e7f1] placeholder-[#5a6178] focus:outline-none focus:border-[#8b5cf6] transition-colors"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={openRouterKey ? "Ask about system state..." : "Set your OpenRouter key first..."}
            disabled={!openRouterKey}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !openRouterKey || isTyping}
            className="bg-[#8b5cf6] text-white px-3 rounded-lg hover:bg-[#7c3aed] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#12141a] border border-[#2a2f42] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-[#10b981]" />
              <h3 className="text-base font-semibold text-[#e4e7f1]">OpenRouter API Key</h3>
            </div>
            <p className="text-xs text-[#8b92a8] mb-4">
              Enter your OpenRouter API key to activate the AI Copilot. Your key is stored only in this browser session — never sent to any server except OpenRouter.
            </p>
            <input
              type="password"
              className="w-full bg-[#0a0b0e] border border-[#2a2f42] rounded-lg px-3 py-2.5 text-sm text-[#e4e7f1] placeholder-[#5a6178] focus:outline-none focus:border-[#10b981] font-mono"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-..."
              onKeyDown={(e) => { if (e.key === 'Enter') handleKeySubmit(); }}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleKeySubmit}
                className="flex-1 bg-[#10b981] text-[#0a0b0e] py-2 rounded-lg text-sm font-semibold hover:bg-[#059669] transition-colors"
              >
                Activate Copilot
              </button>
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 bg-[#1a1d26] text-[#8b92a8] py-2 rounded-lg text-sm hover:bg-[#222633] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

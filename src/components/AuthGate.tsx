'use client';

import React, { useState } from 'react';
import { useAuth } from '@/store/auth';
import { BriefcaseBusiness, Eye, EyeOff, User, Mail, Lock, ArrowRight, Shield } from 'lucide-react';

export default function AuthGate() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, register, isLoading, error, clearError } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await login(username, password);
    } else {
      await register(username, email, password);
    }
  };

  const switchMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login');
    clearError();
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-void)] relative overflow-hidden">
      {/* Auth card */}
      <div className="relative z-10 w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-lg bg-[var(--bg-base)] border border-[var(--border-base)] flex items-center justify-center mx-auto mb-4 shadow-sm">
            <BriefcaseBusiness size={24} className="text-[var(--cyan)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            FIX-MCP
          </h1>
          <p className="text-[11px] text-[var(--text-muted)] font-mono mt-1">Trading Operations Console</p>
        </div>

        {/* Card */}
        <div className="glass-panel-bright p-6">
          <h2 className="text-base font-bold mb-1">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-[11px] text-[var(--text-muted)] mb-5">
            {mode === 'login'
              ? 'Sign in to access Mission Control'
              : 'Register to access Mission Control'}
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30 text-[11px] text-[var(--red)]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Username */}
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
              <input
                className="input-base !pl-9"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>

            {/* Email (register only) */}
            {mode === 'register' && (
              <div className="relative animate-fade-in">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
                <input
                  className="input-base !pl-9"
                  placeholder="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Password */}
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
              <input
                className="input-base !pl-9 !pr-10"
                placeholder="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full flex items-center justify-center gap-2 !py-2.5 !text-sm"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          {/* Switch mode */}
          <div className="mt-4 text-center">
            <button
              onClick={switchMode}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--cyan)] transition-colors"
            >
              {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
            </button>
          </div>

          {/* Demo mode */}
          <div className="mt-4 pt-4 border-t border-[var(--border-dim)] text-center">
            <button
              onClick={() => login('demo', 'demo')}
              className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1.5 mx-auto"
            >
              <Shield size={11} /> Demo Mode (no account needed)
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[9px] text-[var(--text-dim)] font-mono mt-4">
          FIX Protocol • MCP Tools • Human Approval • Audit Trace
        </p>
      </div>
    </div>
  );
}

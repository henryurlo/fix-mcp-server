'use client';

import { useSystem } from '@/store';
import { Play, Loader2 } from 'lucide-react';

export function ScenarioSelector() {
  const { scenario, available_scenarios: available, startScenario, loading } = useSystem();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={scenario || ''}
        onChange={(e) => e.target.value && startScenario(e.target.value)}
        className="bg-[#0a0b0e] border border-[#2a2f42] rounded-lg px-3 py-2 text-sm text-[#e4e7f1] focus:outline-none focus:border-[#3b82f6] min-w-[240px]"
      >
        <option value="">Select scenario...</option>
        {available.map((s: any) => (
          <option key={s.name} value={s.name}>
            {s.name}{s.is_algo ? ' (algo)' : ''}
          </option>
        ))}
      </select>
      <button
        onClick={() => scenario && startScenario(scenario)}
        disabled={loading}
        className="flex items-center gap-2 bg-[#10b981] text-[#0a0b0e] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        {scenario ? 'Restart' : 'Start'}
      </button>
    </div>
  );
}

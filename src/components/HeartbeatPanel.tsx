'use client';

import { useState, useCallback } from 'react';
import { useSystem, SessionInfo } from '@/store';
import { Activity, Radio, ChevronDown, ChevronUp } from 'lucide-react';

export interface HeartbeatPanelProps {
  onVenueClick: (venue: string) => void;
}

export default function HeartbeatPanel({ onVenueClick }: HeartbeatPanelProps) {
  const { sessions } = useSystem();
  const [expanded, setExpanded] = useState(false);

  const handleVenueClick = useCallback((venue: string) => {
    onVenueClick(venue);
  }, [onVenueClick]);

  if (sessions.length === 0) {
    return (
      <div className="p-3 flex items-center justify-center text-[var(--text-dim)] text-[13px] font-mono">
        No venue sessions
      </div>
    );
  }

  // Show top 3 by default, expand on click
  const displaySessions = expanded ? sessions : sessions.slice(0, 3);
  const hasMore = sessions.length > 3;

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
          <Radio size={9} /> FIX Sessions
        </span>
      </div>

      <div className="space-y-0.5">
        {displaySessions.map((s: SessionInfo & { session_id?: string; last_heartbeat?: string; last_sent_seq?: number; last_recv_seq?: number }) => {
          // Determine status-based styling
          const isDown = s.status === 'down';
          const isDegraded = s.status === 'degraded';
          const isActive = s.status === 'active';

          // Status dot class
          const dotClass = isDown ? 'down' : isDegraded ? 'degraded' : isActive ? 'healthy' : 'down';

          // Status text label
          const statusLabel = isDown ? 'DOWN' : isDegraded ? 'DEGRADED' : '';

          return (
            <button
              key={s.venue}
              onClick={() => handleVenueClick(s.venue)}
              className="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors group"
            >
              <span className={`status-dot w-[6px] h-[6px] ${dotClass}`} />
              <span className="text-[13px] font-mono font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors truncate">
                {s.venue}
              </span>
              {/* Status label for DOWN/DEGRADED — replaces latency */}
              {isDown && (
                <span className="text-[11px] font-mono font-bold ml-auto text-[var(--red)]">
                  DOWN
                </span>
              )}
              {isDegraded && (
                <span className="text-[11px] font-mono font-bold ml-auto text-[var(--amber)]">
                  DEGRADED
                </span>
              )}
              {/* Latency only shown for active sessions */}
              {!isDown && !isDegraded && s.latency_ms != null && (
                <span className={`text-[12px] font-mono ml-auto ${
                  s.latency_ms > 100 ? 'text-[var(--red)]' :
                  s.latency_ms > 20 ? 'text-[var(--amber)]' : 'text-[var(--green)]'
                }`}>
                  {s.latency_ms.toFixed(0)}ms
                </span>
              )}
            </button>
          );
        })}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center py-1 text-[12px] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition-colors"
          >
            {expanded ? (
              <><ChevronUp size={10} /> Show less</>
            ) : (
              <><ChevronDown size={10} /> {sessions.length - 3} more</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect } from 'react';

function useKeyboardShortcuts({ onRun, onHint, onToggleCopilot, onNavPrev, onNavNext }: {
  onRun?: () => void;
  onHint?: () => void;
  onToggleCopilot?: () => void;
  onNavPrev?: () => void;
  onNavNext?: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          onRun?.();
          break;
        case 'h':
          e.preventDefault();
          onHint?.();
          break;
        case 'tab':
          e.preventDefault();
          onToggleCopilot?.();
          break;
        case 'escape':
          e.preventDefault();
          onToggleCopilot?.();
          break;
        case 'arrowleft':
        case 'arrowup':
          e.preventDefault();
          onNavPrev?.();
          break;
        case 'arrowright':
        case 'arrowdown':
          e.preventDefault();
          onNavNext?.();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onRun, onHint, onToggleCopilot, onNavPrev, onNavNext]);
}

// ═══ Scenario Case Brief — the story presentation ═══

export default useKeyboardShortcuts;

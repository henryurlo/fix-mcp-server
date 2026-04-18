import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          // Built-in accounts (backend auth coming soon)
          const BUILTIN: Record<string, { password: string; user: User }> = {
            admin: {
              password: 'admin',
              user: { id: 'usr_001', username: 'admin', email: 'admin@fixmcp.local', role: 'admin' },
            },
            henry: {
              password: 'henry',
              user: { id: 'usr_002', username: 'henry', email: 'henry@fixmcp.local', role: 'admin' },
            },
            demo: {
              password: 'demo',
              user: { id: 'usr_demo', username: 'demo', email: 'demo@fixmcp.local', role: 'user' },
            },
          };

          const account = BUILTIN[username.toLowerCase()];
          if (account && account.password === password) {
            // Simulate network delay
            await new Promise(r => setTimeout(r, 400));
            set({
              user: account.user,
              token: `fixmcp_${Date.now()}_${username}`,
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }

          // Try backend auth
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || 'Login failed');
          set({
            user: data.user,
            token: data.access_token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
        }
      },

      register: async (username: string, email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          // For now, auto-create locally (backend auth coming soon)
          await new Promise(r => setTimeout(r, 500));
          set({ isLoading: false });
          // Auto-login after registration
          await get().login(username, password);
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
        }
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
      },

      clearError: () => set({ error: null }),
      setLoading: (isLoading: boolean) => set({ isLoading }),
    }),
    {
      name: 'fix-console-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

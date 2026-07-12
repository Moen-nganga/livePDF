import { create } from 'zustand';
import { api, type AuthUser } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

  fetchMe: () => Promise<void>;
  requestMagicLink: (email: string) => Promise<{ ok: boolean; error?: string }>;
  verifyToken: (token: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',

  // Call on app mount to check for an existing session cookie. Since the
  // cookie is httpOnly, this is the only way the client can know whether
  // it's signed in -- there's nothing to read from document.cookie directly.
  fetchMe: async () => {
    set({ status: 'loading' });
    const user = await api.getMe();
    set({ user, status: user ? 'authenticated' : 'unauthenticated' });
  },

  requestMagicLink: async (email: string) => {
    try {
      await api.requestMagicLink(email);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
    }
  },

  verifyToken: async (token: string) => {
    try {
      const user = await api.verifyMagicLink(token);
      set({ user, status: 'authenticated' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'This link is invalid or has expired' };
    }
  },

  logout: async () => {
    await api.logout();
    set({ user: null, status: 'unauthenticated' });
  },
}));
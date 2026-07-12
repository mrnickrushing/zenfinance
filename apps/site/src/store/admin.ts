import { create } from 'zustand';
import { apiFetch } from '../lib/api';

interface AdminState {
  accessToken: string | null;
  login: (secret: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
}

// Access token lives in memory only (never localStorage); the refresh token
// is an httpOnly cookie the JS can't read.
export const useAdminStore = create<AdminState>((set) => ({
  accessToken: null,

  login: async (secret: string) => {
    const res = await apiFetch<{ accessToken: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ secret }),
    });
    set({ accessToken: res.accessToken });
  },

  refresh: async () => {
    try {
      const res = await apiFetch<{ accessToken: string }>('/api/admin/refresh', {
        method: 'POST',
      });
      set({ accessToken: res.accessToken });
      return true;
    } catch {
      set({ accessToken: null });
      return false;
    }
  },

  logout: async () => {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } finally {
      set({ accessToken: null });
    }
  },
}));

/** Fetch with the admin bearer token; on a 401, refresh once and retry. */
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const attempt = () => {
    const token = useAdminStore.getState().accessToken;
    return apiFetch<T>(path, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  };
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
      const ok = await useAdminStore.getState().refresh();
      if (ok) return attempt();
    }
    throw err;
  }
}

import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, Role, User } from '@/api/types';

const K_ACCESS = 'pos.access';
const K_REFRESH = 'pos.refresh';
const K_USER = 'pos.user';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';
export interface SessionState {
  status: SessionStatus;
  user: User | null;
  role: Role | null;
}

let state: SessionState = { status: 'loading', user: null, role: null };
let accessToken: string | null = null;
let refreshToken: string | null = null;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

async function safeSet(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* storage failure: keep in-memory session for this run */
  }
}
async function safeDel(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

export const session = {
  getState: (): SessionState => state,
  getAccessToken: (): string | null => accessToken,
  getRefreshToken: (): string | null => refreshToken,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Restore the session from secure storage. Safe to call more than once. */
  async init(): Promise<void> {
    if (state.status !== 'loading') return;
    try {
      const [a, r, u] = await Promise.all([
        SecureStore.getItemAsync(K_ACCESS),
        SecureStore.getItemAsync(K_REFRESH),
        SecureStore.getItemAsync(K_USER),
      ]);
      if (a && r && u) {
        const user = JSON.parse(u) as User;
        accessToken = a;
        refreshToken = r;
        set({ status: 'signedIn', user, role: user.role });
        return;
      }
    } catch {
      /* corrupted storage: fall through to signed out */
    }
    accessToken = null;
    refreshToken = null;
    set({ status: 'signedOut', user: null, role: null });
  },

  async setAuth(auth: AuthResponse): Promise<void> {
    accessToken = auth.accessToken;
    refreshToken = auth.refreshToken;
    set({ status: 'signedIn', user: auth.user, role: auth.user.role });
    await Promise.all([
      safeSet(K_ACCESS, auth.accessToken),
      safeSet(K_REFRESH, auth.refreshToken),
      safeSet(K_USER, JSON.stringify(auth.user)),
    ]);
  },

  async setTokens(access: string, refresh: string): Promise<void> {
    accessToken = access;
    refreshToken = refresh;
    await Promise.all([safeSet(K_ACCESS, access), safeSet(K_REFRESH, refresh)]);
  },

  async setUser(user: User): Promise<void> {
    set({ status: 'signedIn', user, role: user.role });
    await safeSet(K_USER, JSON.stringify(user));
  },

  async clear(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    set({ status: 'signedOut', user: null, role: null });
    await Promise.all([safeDel(K_ACCESS), safeDel(K_REFRESH), safeDel(K_USER)]);
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

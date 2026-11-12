/**
 * Feature flags from GET /config.
 *
 *   const { flags, status } = useFeatures();       // all flags, safe defaults while loading / offline
 *   const aiOn = useFeature('ai');                 // single flag (false when missing)
 *   const cfg = getAppConfig();                    // outside React (reads the last good value)
 *
 * Safe defaults: every flag is false, Google/Turnstile config is empty, upload limits use the documented
 * server defaults. If /config fails (offline, server cold start) the app keeps working with those defaults,
 * retries with backoff, and re-reads on reconnect / returning to the foreground. A flag read as false
 * while the real value is true only hides optional UI; the server stays the authority.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { fetchConfig } from '@/api/integrations';
import type { AppConfig, FeatureFlags } from '@/api/integrationsTypes';
import { DEFAULT_CONFIG, DEFAULT_FLAGS } from './defaults';

export { DEFAULT_CONFIG, DEFAULT_FLAGS };

/** 'loading' = first read in flight; 'ready' = server answered; 'fallback' = using defaults after a failure. */
export type ConfigStatus = 'loading' | 'ready' | 'fallback';

export interface FeaturesContextValue {
  config: AppConfig;
  flags: FeatureFlags;
  status: ConfigStatus;
  /** true when the values are the built-in defaults (loading or failed) */
  isDefault: boolean;
  refetch: () => Promise<void>;
}

/* module-level mirror so non-React code can read the last good config */
let current: AppConfig = DEFAULT_CONFIG;
export const getAppConfig = (): AppConfig => current;
export const getFeatureFlags = (): FeatureFlags => current.features;

const FeaturesContext = createContext<FeaturesContextValue>({
  config: DEFAULT_CONFIG,
  flags: DEFAULT_FLAGS,
  status: 'loading',
  isDefault: true,
  refetch: async () => undefined,
});

const RETRY_MS = [3000, 10000, 30000];

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ConfigStatus>('loading');
  const inflight = useRef<Promise<void> | null>(null);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const statusRef = useRef<ConfigStatus>('loading');
  statusRef.current = status;

  const load = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const next = await fetchConfig();
        current = next;
        attempt.current = 0;
        if (alive.current) {
          setConfig(next);
          setStatus('ready');
        }
      } catch {
        if (!alive.current) return;
        // keep the last good config if we had one, otherwise defaults
        setStatus((s) => (s === 'ready' ? s : 'fallback'));
        const delay = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)];
        attempt.current += 1;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (alive.current && statusRef.current !== 'ready') void load();
        }, delay);
      }
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const appSub = AppState.addEventListener('change', (st) => {
      // re-read when returning to the foreground (flags can change after a server deploy)
      if (st === 'active') void load();
    });
    const netUnsub = NetInfo.addEventListener((s) => {
      if (s.isConnected !== false && statusRef.current !== 'ready') void load();
    });
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      appSub.remove();
      netUnsub();
    };
  }, [load]);

  const value = useMemo<FeaturesContextValue>(
    () => ({ config, flags: config.features, status, isDefault: status !== 'ready', refetch: load }),
    [config, status, load],
  );
  return React.createElement(FeaturesContext.Provider, { value }, children);
}

export function useFeatures(): FeaturesContextValue {
  return useContext(FeaturesContext);
}

/** One flag; unknown flags are false. */
export function useFeature(name: keyof FeatureFlags | (string & {})): boolean {
  return useContext(FeaturesContext).flags[name] === true;
}

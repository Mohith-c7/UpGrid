import type { AiProvider } from './types';

export interface AiConfig {
  enabled: boolean;
  configured: boolean;
  model: string;
  dailyLimit: number;
  staffDailyLimit: number;
  burstPerMinute: number;
  timeoutMs: number;
  retryBackoffMs: number;
  cacheTtlSeconds: number;
}

const num = (v: string | undefined, d: number, min = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : d;
};
const isFalse = (v: string | undefined) => v !== undefined && /^(0|false|off|no)$/i.test(v.trim());

export function hasProviderEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim()) return true;
  return !!(env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_LOCATION);
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    enabled: !isFalse(env.AI_ENABLED),
    configured: hasProviderEnv(env),
    model: env.AI_MODEL?.trim() || 'gemini-flash-lite-latest',
    dailyLimit: num(env.AI_DAILY_LIMIT, 30),
    staffDailyLimit: num(env.AI_DAILY_LIMIT_STAFF, 300),
    burstPerMinute: num(env.AI_BURST_PER_MINUTE, 10),
    timeoutMs: num(env.AI_TIMEOUT_MS, 25_000, 100),
    retryBackoffMs: num(env.AI_RETRY_BACKOFF_MS, 500, 0),
    cacheTtlSeconds: num(env.AI_CACHE_TTL_SECONDS, 24 * 3600),
  };
}

// ---- runtime holder (injectable for tests) --------------------------------------------------
let providerOverride: AiProvider | null = null;
let configOverride: Partial<AiConfig> | null = null;
let lazyProvider: { key: string; provider: AiProvider } | null = null;

export function setAiProvider(p: AiProvider | null) { providerOverride = p; }
export function setAiConfigOverride(c: Partial<AiConfig> | null) { configOverride = c; }

/** Effective config: env + overrides. An injected provider counts as "configured". */
export function currentAiConfig(): AiConfig {
  const base = loadAiConfig();
  const merged = { ...base, ...(configOverride || {}) };
  if (providerOverride && !(configOverride && 'configured' in configOverride)) merged.configured = true;
  return merged;
}

export function aiAvailable(): boolean {
  const c = currentAiConfig();
  return c.enabled && c.configured;
}

export function getAiProvider(): AiProvider | null {
  if (providerOverride) return providerOverride;
  if (!hasProviderEnv()) return null;
  const key = [process.env.GEMINI_API_KEY, process.env.GOOGLE_CLOUD_PROJECT, process.env.GOOGLE_CLOUD_LOCATION, process.env.AI_MODEL].join('|');
  if (!lazyProvider || lazyProvider.key !== key) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GeminiProvider } = require('./gemini') as typeof import('./gemini');
    lazyProvider = { key, provider: new GeminiProvider(currentAiConfig().model) };
  }
  return lazyProvider.provider;
}

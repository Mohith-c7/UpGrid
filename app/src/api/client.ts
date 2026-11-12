import NetInfo from '@react-native-community/netinfo';
import { session } from '@/state/session';
import type { ApiErrorBody, AuthResponse } from './types';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api/v1';
export const API_URL: string = RAW_URL.replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  isNetwork: boolean;
  /** seconds to wait before retrying (429 RESEND_COOLDOWN etc.); from body.error.retryAfterSeconds or the Retry-After header */
  retryAfterSeconds?: number;
  /** the parsed JSON response body (whole object, not just `error`), when the server sent one; e.g. 503 CODE_EXECUTION_UNAVAILABLE carries `submission` */
  body?: unknown;
  constructor(message: string, code: string, status: number, fields?: Record<string, string>, isNetwork = false) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.isNetwork = isNetwork;
  }
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.fields ? e.fields : {};
}

/* ---------- server time offset ---------- */
let serverOffsetMs = 0;
export const getServerOffsetMs = () => serverOffsetMs;

/* ---------- request core ---------- */
interface ReqOpts {
  /** default true: attach bearer token and refresh on 401 */
  auth?: boolean;
  timeoutMs?: number;
}

async function classifyNetworkFailure(timedOut: boolean): Promise<ApiError> {
  if (timedOut) return new ApiError('The server is taking too long to respond. Please try again.', 'TIMEOUT', 0, undefined, true);
  let online = true;
  try {
    const s = await NetInfo.fetch();
    online = s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    online = true;
  }
  if (!online) return new ApiError('You are offline. Check your connection and try again.', 'OFFLINE', 0, undefined, true);
  return new ApiError('Could not reach the server. Please try again.', 'NETWORK', 0, undefined, true);
}

async function send(method: string, path: string, body: unknown, token: string | null, timeoutMs: number, accept = 'application/json'): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw await classifyNetworkFailure(timedOut);
  } finally {
    clearTimeout(timer);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let parsed: Partial<ApiErrorBody> | null = null;
  try {
    parsed = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    parsed = null;
  }
  const e = parsed?.error;
  const fallback =
    res.status === 429
      ? 'Too many attempts. Please wait a minute and try again.'
      : res.status >= 500
        ? 'The server had a problem. Please try again shortly.'
        : 'Request failed.';
  const err = new ApiError(e?.message ?? fallback, e?.code ?? `HTTP_${res.status}`, res.status, e?.fields);
  if (parsed && typeof parsed === 'object') err.body = parsed;
  const bodyRetry = Number((e as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
  const headerRetry = Number(res.headers.get('Retry-After'));
  const retry = Number.isFinite(bodyRetry) && bodyRetry > 0 ? bodyRetry : headerRetry;
  if (Number.isFinite(retry) && retry > 0) err.retryAfterSeconds = Math.ceil(retry);
  return err;
}

/* ---------- single-flight refresh ---------- */
let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = session.getRefreshToken();
    if (!rt) return false;
    try {
      const res = await send('POST', '/auth/refresh', { refreshToken: rt }, null, TIMEOUT_MS);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 400) await session.clear();
        return false;
      }
      const data = (await res.json()) as Partial<AuthResponse>;
      if (!data.accessToken || !data.refreshToken) {
        await session.clear();
        return false;
      }
      await session.setTokens(data.accessToken, data.refreshToken);
      if (data.user) await session.setUser(data.user);
      return true;
    } catch {
      // network problem: keep the session, let the caller see the failure
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  let res = await send(method, path, body, useAuth ? session.getAccessToken() : null, timeout);
  if (res.status === 401 && useAuth && session.getRefreshToken()) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      res = await send(method, path, body, session.getAccessToken(), timeout);
    }
  } else if (res.status === 401 && useAuth && session.getState().status === 'signedIn' && !session.getRefreshToken()) {
    // an authenticated call was rejected and there is nothing to refresh with: the stored session is dead
    await session.clear();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Unexpected response from the server.', 'BAD_RESPONSE', res.status);
  }
}

/** GET a text body (e.g. CSV) with the same auth + refresh behaviour as `api`. */
export async function apiGetText(path: string, accept = 'text/csv', timeoutMs = 30000): Promise<string> {
  let res = await send('GET', path, undefined, session.getAccessToken(), timeoutMs, accept);
  if (res.status === 401 && session.getRefreshToken()) {
    if (await refreshOnce()) res = await send('GET', path, undefined, session.getAccessToken(), timeoutMs, accept);
  }
  if (!res.ok) throw await toApiError(res);
  return res.text();
}

export const api = {
  get: <T>(path: string, opts?: ReqOpts) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: ReqOpts) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: ReqOpts) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: ReqOpts) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T>(path: string, body?: unknown, opts?: ReqOpts) => request<T>('DELETE', path, body, opts),
};

/** Fetch /time and compute offset = serverNow - deviceNow (midpoint of the round trip). */
export async function syncServerTime(): Promise<number> {
  try {
    const t0 = Date.now();
    const r = await api.get<{ now?: string; serverNow?: string; time?: string }>('/time', { auth: false, timeoutMs: 8000 });
    const t1 = Date.now();
    const iso = r?.now ?? r?.serverNow ?? r?.time;
    const serverMs = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(serverMs)) serverOffsetMs = serverMs - Math.round((t0 + t1) / 2);
  } catch {
    /* keep previous offset */
  }
  return serverOffsetMs;
}

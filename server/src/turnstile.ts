import type { RequestHandler } from 'express';
import { ApiError, wrap } from './errors';

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies `turnstileToken` (JSON body) or `X-Turnstile-Token` against Cloudflare. Skipped entirely when the secret is unset.
 * Fails closed: 400 CAPTCHA_FAILED for a bad/missing token, 503 CAPTCHA_UNAVAILABLE when Cloudflare cannot be reached.
 */
export function turnstileGuard(secret: string | undefined, fetchFn: FetchLike, timeoutMs = 5000): RequestHandler {
  return wrap(async (req, _res, next) => {
    if (!secret) return next();
    const headerTok = req.headers['x-turnstile-token'];
    const raw = (req.body && typeof req.body === 'object' ? (req.body as any).turnstileToken : undefined) ?? (Array.isArray(headerTok) ? headerTok[0] : headerTok);
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!token || token.length > 4096) throw new ApiError(400, 'CAPTCHA_FAILED', 'Please complete the security check and try again');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let body: any;
    try {
      const form = new URLSearchParams({ secret, response: token });
      if (req.ip) form.set('remoteip', req.ip);
      const r = await fetchFn(TURNSTILE_VERIFY_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`siteverify ${r.status}`);
      body = await r.json();
    } catch {
      throw new ApiError(503, 'CAPTCHA_UNAVAILABLE', 'Security check is temporarily unavailable. Please try again shortly');
    } finally {
      clearTimeout(timer);
    }
    if (!body || body.success !== true) throw new ApiError(400, 'CAPTCHA_FAILED', 'Security check failed. Please try again');
    next();
  });
}

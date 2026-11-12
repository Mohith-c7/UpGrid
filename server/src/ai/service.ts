import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError } from '../errors';
import type { AuthUser } from '../context';
import { currentAiConfig, getAiProvider } from './config';
import { deepSanitize, stripMarkup } from './sanitize';
import { AiMessage, AiProvider, GenerateRequest, ProviderError } from './types';

export type AiRole = AuthUser['role'] | 'recruiter';
export interface AiUser { id: string; tenantId: string; role: AiRole; name?: string }
export interface Quota { limit: number; used: number; remaining: number; resetsAt: string }
export interface UsageInfo { inputTokens: number; outputTokens: number; cached: boolean }

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function assertAvailable(): AiProvider {
  const cfg = currentAiConfig();
  if (!cfg.configured) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI features are not configured on this server');
  if (!cfg.enabled) throw new ApiError(503, 'AI_DISABLED', 'AI features are temporarily turned off');
  const p = getAiProvider();
  if (!p) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI features are not configured on this server');
  return p;
}

const nextUtcMidnight = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};
const DAY_START = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export async function getQuota(pool: Pool, user: AiUser): Promise<Quota> {
  const cfg = currentAiConfig();
  const limit = user.role === 'student' ? cfg.dailyLimit : cfg.staffDailyLimit;
  const r = await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE user_id=$1 AND counted AND created_at >= ${DAY_START}`, [user.id]);
  const used = r.rows[0].n as number;
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: nextUtcMidnight() };
}

/** Extract a JSON value from model text (handles code fences and leading/trailing prose). */
export function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.search(/[{[]/);
  const e = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (s >= 0 && e > s) { t = t.slice(s, e + 1); return JSON.parse(t); }
  throw new Error('no JSON found');
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> | undefined {
  try {
    const js = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  } catch { return undefined; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapProviderError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ProviderError && e.status === 504) return new ApiError(504, 'AI_TIMEOUT', 'The AI service took too long to respond. Please try again.');
  return new ApiError(502, 'AI_UPSTREAM_ERROR', 'The AI service is unavailable right now. Please try again shortly.');
}

async function withTimeout<T>(ms: number, outer: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(ctl.signal),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => { ctl.abort(); rej(new ProviderError('timeout', true, 504)); }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export interface CallOptions<T> {
  user: AiUser;
  feature: string;
  system: string;
  messages: AiMessage[];
  schema?: z.ZodType<T>;
  maxOutputTokens: number;
  temperature?: number;
  /** identical idempotent prompts are cached; scope controls who can reuse the entry */
  cache?: { scope: 'user' | 'tenant'; ttlSeconds?: number };
  flags?: string[];
  signal?: AbortSignal;
  /** post-processing of validated output; may throw ApiError */
  after?: (data: T) => T;
}
export interface CallResult<T> { data: T; text: string; usage: UsageInfo; quota: Quota }

export class AiService {
  constructor(private pool: Pool) {}

  private async reserve(user: AiUser, feature: string, promptHash: string, flags: string[]): Promise<number> {
    const cfg = currentAiConfig();
    const limit = user.role === 'student' ? cfg.dailyLimit : cfg.staffDailyLimit;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai:${user.id}`]);
      const q = await client.query(
        `SELECT count(*) FILTER (WHERE counted AND created_at >= ${DAY_START})::int AS day,
                count(*) FILTER (WHERE counted AND created_at > now() - interval '60 seconds')::int AS burst
           FROM ai_usage WHERE user_id=$1`, [user.id]);
      if (q.rows[0].burst >= cfg.burstPerMinute) {
        await client.query('ROLLBACK');
        throw Object.assign(new ApiError(429, 'AI_RATE_LIMITED', 'Too many AI requests. Please wait a minute and try again.'), { retryAfter: 60 });
      }
      if (q.rows[0].day >= limit) {
        await client.query('ROLLBACK');
        throw Object.assign(new ApiError(429, 'AI_QUOTA_EXCEEDED', `Daily AI limit of ${limit} requests reached. It resets at 00:00 UTC.`), { retryAfter: Math.max(1, Math.ceil((new Date(nextUtcMidnight()).getTime() - Date.now()) / 1000)) });
      }
      const ins = await client.query(
        `INSERT INTO ai_usage (tenant_id, user_id, feature, model, prompt_hash, status, counted, flags)
         VALUES ($1,$2,$3,$4,$5,'pending',true,$6) RETURNING id`,
        [user.tenantId, user.id, feature, cfg.model, promptHash, flags]);
      await client.query('COMMIT');
      return Number(ins.rows[0].id);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      client.release();
    }
  }

  private async finish(id: number, patch: { status: string; inputTokens?: number; outputTokens?: number; latencyMs?: number; counted?: boolean; errorCode?: string }) {
    await this.pool.query(
      `UPDATE ai_usage SET status=$2, input_tokens=$3, output_tokens=$4, latency_ms=$5, counted=COALESCE($6, counted), error_code=$7 WHERE id=$1`,
      [id, patch.status, patch.inputTokens ?? 0, patch.outputTokens ?? 0, patch.latencyMs ?? 0, patch.counted ?? null, patch.errorCode ?? null]);
  }

  private async logExtra(user: AiUser, feature: string, promptHash: string, patch: { status: string; cached?: boolean; inputTokens?: number; outputTokens?: number; flags?: string[] }) {
    await this.pool.query(
      `INSERT INTO ai_usage (tenant_id, user_id, feature, model, prompt_hash, status, cached, counted, input_tokens, output_tokens, flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10)`,
      [user.tenantId, user.id, feature, currentAiConfig().model, promptHash, patch.status, !!patch.cached, patch.inputTokens ?? 0, patch.outputTokens ?? 0, patch.flags ?? []]);
  }

  /** Log a request that was refused before reaching the model (no quota cost). */
  async logBlocked(user: AiUser, feature: string, text: string, reason: string) {
    await this.logExtra(user, feature, sha(text), { status: 'blocked', flags: [reason] });
  }

  private async attempt(provider: AiProvider, req: GenerateRequest) {
    const cfg = currentAiConfig();
    let lastErr: unknown;
    for (let i = 0; i < 2; i++) {
      try {
        return await withTimeout(cfg.timeoutMs, req.signal, (signal) => provider.generate({ ...req, signal }));
      } catch (e) {
        lastErr = e;
        if (req.signal?.aborted) throw e;
        const retryable = e instanceof ProviderError ? e.retryable : true;
        if (!retryable || i === 1) break;
        await sleep(cfg.retryBackoffMs * (1 + Math.random() * 0.5));
      }
    }
    throw mapProviderError(lastErr);
  }

  private cacheKey(o: { user: AiUser; feature: string; hash: string; scope: 'user' | 'tenant' }) {
    return sha([currentAiConfig().model, o.feature, o.scope === 'user' ? o.user.id : o.user.tenantId, o.hash].join('|'));
  }

  async call<T = string>(o: CallOptions<T>): Promise<CallResult<T>> {
    const provider = assertAvailable();
    const cfg = currentAiConfig();
    const hash = sha(JSON.stringify([o.system, o.messages, o.schema ? 'json' : 'text']));

    if (o.cache) {
      const key = this.cacheKey({ user: o.user, feature: o.feature, hash, scope: o.cache.scope });
      const hit = await this.pool.query(`SELECT value FROM ai_cache WHERE key=$1 AND expires_at > now()`, [key]);
      if (hit.rows[0]) {
        await this.logExtra(o.user, o.feature, hash, { status: 'ok', cached: true, flags: o.flags });
        return { data: hit.rows[0].value.data as T, text: '', usage: { inputTokens: 0, outputTokens: 0, cached: true }, quota: await getQuota(this.pool, o.user) };
      }
    }

    const usageId = await this.reserve(o.user, o.feature, hash, o.flags || []);
    const started = Date.now();
    const req: GenerateRequest = {
      system: o.system, messages: o.messages, json: !!o.schema, schema: o.schema ? jsonSchemaOf(o.schema) : undefined,
      maxOutputTokens: o.maxOutputTokens, temperature: o.temperature ?? 0.4, signal: o.signal,
    };
    let inTok = 0; let outTok = 0;
    try {
      let res = await this.attempt(provider, req);
      inTok += res.inputTokens; outTok += res.outputTokens;
      let data: unknown = res.text;
      if (o.schema) {
        let parsed = this.tryParse(o.schema, res.text);
        if (!parsed.ok) {
          // one repair attempt: show the model its own output and the validation problems
          const repairReq: GenerateRequest = {
            ...req,
            messages: [...o.messages, { role: 'model', text: res.text.slice(0, 6000) },
              { role: 'user', text: `Your previous output was rejected: ${parsed.error}. Return ONLY corrected JSON that matches the required schema exactly. Do not add commentary.` }],
          };
          res = await this.attempt(provider, repairReq);
          inTok += res.inputTokens; outTok += res.outputTokens;
          await this.logExtra(o.user, `${o.feature}:repair`, hash, { status: 'ok', inputTokens: res.inputTokens, outputTokens: res.outputTokens });
          parsed = this.tryParse(o.schema, res.text);
          if (!parsed.ok) {
            await this.finish(usageId, { status: 'bad_output', inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started, errorCode: 'AI_BAD_OUTPUT' });
            throw new ApiError(502, 'AI_BAD_OUTPUT', 'The AI response could not be understood. Please try again.');
          }
        }
        data = parsed.data;
      } else {
        data = stripMarkup(String(res.text)).trim();
        if (!data) throw new ProviderError('empty response', true);
      }
      let out = (o.schema ? deepSanitize(data) : data) as T;
      if (o.after) out = o.after(out);
      await this.finish(usageId, { status: 'ok', inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started });
      if (o.cache) {
        const key = this.cacheKey({ user: o.user, feature: o.feature, hash, scope: o.cache.scope });
        await this.pool.query(
          `INSERT INTO ai_cache (key, tenant_id, user_id, feature, value, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at`,
          [key, o.user.tenantId, o.cache.scope === 'user' ? o.user.id : null, o.feature, JSON.stringify({ data: out }), String(o.cache.ttlSeconds ?? cfg.cacheTtlSeconds)]);
      }
      return { data: out, text: typeof data === 'string' ? data : '', usage: { inputTokens: inTok, outputTokens: outTok, cached: false }, quota: await getQuota(this.pool, o.user) };
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'AI_BAD_OUTPUT')) {
        const err = e instanceof ApiError ? e : mapProviderError(e);
        // provider failures are not charged to the user's quota
        await this.finish(usageId, { status: 'error', inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started, counted: false, errorCode: err.code }).catch(() => undefined);
        if (e instanceof ApiError) throw e;
        throw err;
      }
      throw e;
    }
  }

  private tryParse<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
    let raw: unknown;
    try { raw = extractJson(text); } catch { return { ok: false, error: 'output was not valid JSON' }; }
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, data: r.data };
    return { ok: false, error: r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }

  /** Streaming text call (chat). Yields deltas; the generator's return value is the final accounting. */
  async *stream(o: Omit<CallOptions<string>, 'schema' | 'cache' | 'after'>): AsyncGenerator<string, { text: string; usage: UsageInfo; quota: Quota }, void> {
    const provider = assertAvailable();
    const cfg = currentAiConfig();
    const hash = sha(JSON.stringify([o.system, o.messages, 'stream']));
    const usageId = await this.reserve(o.user, o.feature, hash, o.flags || []);
    const started = Date.now();
    const req: GenerateRequest = { system: o.system, messages: o.messages, maxOutputTokens: o.maxOutputTokens, temperature: o.temperature ?? 0.5, signal: o.signal };
    let text = ''; let inTok = 0; let outTok = 0;
    try {
      let sent = false;
      for (let i = 0; i < 2; i++) {
        try {
          if (provider.generateStream) {
            const it = provider.generateStream(req)[Symbol.asyncIterator]();
            for (;;) {
              const next = await Promise.race([
                it.next(),
                new Promise<never>((_, rej) => setTimeout(() => rej(new ProviderError('timeout', true, 504)), cfg.timeoutMs).unref?.()),
              ]);
              if (next.done) break;
              const c = next.value;
              if (c.inputTokens) inTok = c.inputTokens;
              if (c.outputTokens) outTok = c.outputTokens;
              if (c.text) { sent = true; text += c.text; yield c.text; }
            }
          } else {
            const r = await this.attempt(provider, req);
            inTok = r.inputTokens; outTok = r.outputTokens; sent = true;
            // fallback: emit in small chunks so clients still see incremental output
            for (let p = 0; p < r.text.length; p += 40) { const chunk = r.text.slice(p, p + 40); text += chunk; yield chunk; }
          }
          break;
        } catch (e) {
          if (req.signal?.aborted) throw e;
          const retryable = e instanceof ProviderError ? e.retryable : true;
          if (sent || !retryable || i === 1) throw mapProviderError(e);
          await sleep(cfg.retryBackoffMs);
        }
      }
      if (!text.trim()) throw new ApiError(502, 'AI_UPSTREAM_ERROR', 'The AI service returned an empty answer. Please try again.');
      await this.finish(usageId, { status: 'ok', inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started });
      return { text, usage: { inputTokens: inTok, outputTokens: outTok, cached: false }, quota: await getQuota(this.pool, o.user) };
    } catch (e) {
      const aborted = !!req.signal?.aborted;
      const err = e instanceof ApiError ? e : mapProviderError(e);
      await this.finish(usageId, { status: aborted ? 'aborted' : 'error', inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started, counted: aborted ? true : false, errorCode: err.code }).catch(() => undefined);
      throw err;
    }
  }
}

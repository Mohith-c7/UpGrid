/**
 * Public pre-launch waitlist for the marketing website.
 *   POST /api/v1/waitlist         public, no auth, rate limited (5/hour/IP)
 *   GET  /api/v1/waitlist/export  officer-only CSV (formula-injection safe)
 * Must be mounted BEFORE meRouter in app.ts (meRouter authenticates everything mounted after it).
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../config';
import { authenticate, Deps, me, requireRole } from '../context';
import { toCsv, formatIstStamp } from '../csv';
import { ApiError, wrap, zodFields } from '../errors';
import { emailSchema, nameSchema, normalizeEmail, phoneSchema, textSchema } from '../validation';

export const WAITLIST_ROLES = ['student', 'placement_officer', 'recruiter', 'other'] as const;
export const WAITLIST_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
/** a human needs more than this to fill the form; faster submissions are treated as bots */
export const MIN_FILL_MS = 2000;
export const WAITLIST_TERMS_VERSION = 'draft-1';

const optionalPhone = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  phoneSchema.optional(),
);
const optionalCollege = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  textSchema(120).optional(),
);

export const waitlistSchema = z
  .object({
    name: nameSchema,
    role: z.enum(WAITLIST_ROLES, { error: 'Choose one of student, placement_officer, recruiter or other' }),
    college: optionalCollege,
    email: emailSchema,
    phone: optionalPhone,
    consent: z.literal(true, { error: 'Please tick the consent box to join the waitlist' }),
    /** honeypot: real users never see or fill this field */
    website: z.string().max(200).optional(),
    /** milliseconds between the form being shown and submitted (time-trap) */
    elapsedMs: z.number().finite().optional(),
  })
  .strict();

const ok = { ok: true, message: 'You are on the list. We will email you about the campus pilot and launch.' };

export function waitlistRouter(deps: Deps, opts: { rateLimit?: boolean } = {}) {
  const { pool, cfg } = deps;
  const r = Router();

  if (opts.rateLimit !== false) {
    r.post(
      '/',
      rateLimit({
        windowMs: WAITLIST_RATE_LIMIT.windowMs,
        limit: WAITLIST_RATE_LIMIT.max,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) =>
          res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-up attempts from this network. Please try again in an hour or email us.' } }),
      }),
    );
  }

  r.post('/', wrap(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Send a JSON object', { _: 'Send a JSON object' });
    }
    // Bot traps answer with the normal success body and store nothing, so bots learn nothing.
    const honeypot = typeof body.website === 'string' && body.website.trim() !== '';
    const tooFast = typeof body.elapsedMs !== 'number' || !Number.isFinite(body.elapsedMs) || body.elapsedMs < MIN_FILL_MS;
    if (honeypot || tooFast) return res.status(200).json(ok);

    const parsed = waitlistSchema.safeParse(body);
    if (!parsed.success) {
      const fields = zodFields(parsed.error);
      throw new ApiError(400, 'VALIDATION_ERROR', String(Object.values(fields)[0] ?? 'Invalid request'), fields);
    }
    const d = parsed.data;
    const n = normalizeEmail(d.email);
    if (!n.ok) throw new ApiError(400, 'VALIDATION_ERROR', n.message, { email: n.message });
    const ipHash = createHash('sha256').update(`${cfg.jwtSecret}:${req.ip ?? ''}`).digest('hex').slice(0, 32);

    // Duplicate email is idempotent: same 200 body whether new or existing (no account enumeration).
    await pool.query(
      `INSERT INTO waitlist_signups (tenant_id, name, role, college, email, email_key, phone, terms_version, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, email_key) DO NOTHING`,
      [DEFAULT_TENANT_ID, d.name, d.role, d.college ?? null, n.value.email, n.value.uniqueKey, d.phone ?? null, WAITLIST_TERMS_VERSION, ipHash],
    );
    return res.status(200).json(ok);
  }));

  r.get('/export', authenticate(deps), requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const rows = (await pool.query(
      `SELECT name, role, college, email, phone, created_at FROM waitlist_signups WHERE tenant_id=$1 ORDER BY created_at, id`, [u.tenantId])).rows;
    const csv = toCsv(
      ['name', 'role', 'college', 'email', 'phone', 'signedUpAt'],
      rows.map((x) => [x.name, x.role, x.college ?? '', x.email, x.phone ?? '', formatIstStamp(new Date(x.created_at))]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="waitlist.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }));

  return r;
}

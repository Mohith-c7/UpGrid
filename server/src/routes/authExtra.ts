import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../config';
import { authenticate, Deps, me } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, parse, wrap } from '../errors';
import { integ } from '../integrations';
import { CONSENT_POLICY_VERSION } from '../legal';
import { sendMail } from '../mail';
import { checkOtp, issueOtp, IssueResult, OTP } from '../otp';
import { turnstileGuard } from '../turnstile';
import { normalizeEmail, normalizeName, passwordSchema } from '../validation';
import { issueSessionTokens, userDto } from './auth';

const DUMMY_HASH = bcrypt.hashSync('dummy-password-1', 4);
const FORGOT_BODY = { ok: true, message: 'If an account exists for this email, a reset code has been sent.' };
const codeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

/** Key used to look an account up by whatever the user typed (same fallback as password login). */
function emailKeyOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 254) return null;
  const e = normalizeEmail(raw);
  return e.ok ? e.value.uniqueKey : raw.trim().toLowerCase();
}

function fallbackEmail(raw: string): { email: string; uniqueKey: string } {
  const email = raw.trim().toLowerCase();
  const [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { email: `${local}@gmail.com`, uniqueKey: `${local.split('+')[0].replace(/\./g, '')}@gmail.com` };
  return { email, uniqueKey: email };
}

export function nameFromGoogle(name: string | null, email: string): string {
  const n = normalizeName(name ?? '');
  if (n.ok) return n.value;
  const cleaned = (s: string) => s.replace(/[^\p{L}\p{M} .'’-]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{M}]+/u, '').slice(0, 80);
  for (const cand of [cleaned(name ?? ''), cleaned(email.split('@')[0])]) {
    const r = normalizeName(cand);
    if (r.ok) return r.value;
  }
  return 'Student';
}

function otpFail(reason: 'invalid' | 'expired' | 'locked'): never {
  if (reason === 'expired') throw new ApiError(400, 'CODE_EXPIRED', 'This code has expired. Request a new one.');
  if (reason === 'locked') throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.');
  throw new ApiError(400, 'INVALID_CODE', 'That code is incorrect.');
}

function sendLimited(res: Response, out: Extract<IssueResult, { ok: false }>) {
  res.set('Retry-After', String(out.retryAfter));
  const cooldown = out.reason === 'cooldown';
  return res.status(429).json({
    error: {
      code: cooldown ? 'RESEND_COOLDOWN' : 'RATE_LIMITED',
      message: cooldown ? `Please wait ${out.retryAfter} seconds before requesting another code.` : 'Too many codes requested. Try again later.',
      retryAfterSeconds: out.retryAfter,
    },
  });
}

/** Email verification, password reset and Google sign-in (mounted at /auth, before authRouter). */
export function authExtraRouter(deps: Deps) {
  const { pool } = deps;
  const i = integ(deps);
  const r = Router();
  const captcha = turnstileGuard(i.settings.turnstile.secret, i.fetch);
  const emailOn = (_req: any, _res: any, next: any) =>
    i.emailEnabled ? next() : next(new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email is not configured on this server'));
  const googleOn = (_req: any, _res: any, next: any) =>
    i.googleEnabled ? next() : next(new ApiError(503, 'GOOGLE_LOGIN_NOT_CONFIGURED', 'Google sign-in is not configured on this server'));

  // ------------------------------------------------------------ email verification
  r.post('/email/send-verification', authenticate(deps), emailOn, wrap(async (req, res) => {
    const u = (await pool.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [me(req).id])).rows[0];
    if (u.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
    const out = await issueOtp(pool, { tenantId: u.tenant_id, userId: u.id, emailKey: u.email_key, purpose: 'verify_email', ip: req.ip ?? null });
    if (!out.ok) return sendLimited(res, out);
    void sendMail(u.email, 'verification_code', { name: u.name, code: out.code, expiresMinutes: OTP.ttlMinutes });
    res.json({ ok: true, expiresInSeconds: OTP.ttlMinutes * 60, resendAfterSeconds: OTP.cooldownSeconds });
  }));

  r.post('/email/verify', authenticate(deps), emailOn, wrap(async (req, res) => {
    const body = parse<{ code: string }>(z.object({ code: codeSchema }), req.body ?? {});
    const u = (await pool.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [me(req).id])).rows[0];
    if (u.email_verified_at) return res.json({ ok: true, user: userDto(u) });
    const chk = await checkOtp(pool, { tenantId: u.tenant_id, emailKey: u.email_key, purpose: 'verify_email', code: body.code });
    if (!chk.ok) otpFail(chk.reason);
    const upd = (await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1 AND email_key=$2 RETURNING *', [u.id, u.email_key])).rows[0];
    // the email changed between issuing and verifying: the code no longer proves the current address
    if (!upd) throw new ApiError(400, 'INVALID_CODE', 'That code is incorrect.');
    res.json({ ok: true, user: userDto(upd) });
  }));

  // ------------------------------------------------------------ forgot / reset password
  r.post('/forgot-password', captcha, wrap(async (req, res) => {
    const key = emailKeyOf(req.body?.email);
    const ip = req.ip ?? null;
    res.json(FORGOT_BODY); // identical for every input; the work below happens after the response
    try {
      if (!key || !i.emailEnabled) return;
      const u = (await pool.query('SELECT * FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL', [DEFAULT_TENANT_ID, key])).rows[0];
      if (!u) return;
      const out = await issueOtp(pool, { tenantId: u.tenant_id, userId: u.id, emailKey: u.email_key, purpose: 'reset_password', ip });
      if (!out.ok) return; // cooldown / rate limit: silent so the response never differs
      await sendMail(u.email, 'password_reset_code', { name: u.name, code: out.code, expiresMinutes: OTP.ttlMinutes });
    } catch (e) {
      console.error(`[auth] forgot-password failed: ${(e as Error).message}`);
    }
  }));

  r.post('/reset-password', wrap(async (req, res) => {
    const body = parse<{ email: string; code: string; newPassword: string }>(
      z.object({ email: z.string().max(254), code: codeSchema, newPassword: passwordSchema }), req.body ?? {});
    const key = emailKeyOf(body.email);
    const u = key ? (await pool.query('SELECT * FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL', [DEFAULT_TENANT_ID, key])).rows[0] : null;
    if (!u) {
      await bcrypt.compare(body.newPassword, DUMMY_HASH); // similar work for unknown emails
      throw new ApiError(400, 'INVALID_CODE', 'That code is incorrect.');
    }
    const chk = await checkOtp(pool, { tenantId: u.tenant_id, emailKey: u.email_key, purpose: 'reset_password', code: body.code });
    if (!chk.ok) otpFail(chk.reason);
    const hash = await bcrypt.hash(body.newPassword, deps.cfg.bcryptRounds);
    await withTx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [u.id, hash]);
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ Google sign-in
  const googleBody = z.object({
    idToken: z.string().min(1, 'idToken is required').max(8192),
    acceptTerms: z.boolean().optional(),
    turnstileToken: z.string().max(4096).optional(),
  }).strict();

  r.post('/google', googleOn, captcha, wrap(async (req, res) => {
    const body = parse<z.infer<typeof googleBody>>(googleBody, req.body ?? {});
    let g;
    try {
      g = await i.googleVerifier(body.idToken, i.settings.google.all);
    } catch {
      throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');
    }
    if (!g || !g.sub || !g.email) throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');
    if (!g.emailVerified) throw new ApiError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Your Google email address is not verified.');
    const norm = normalizeEmail(g.email);
    const em = norm.ok ? { email: norm.value.email, uniqueKey: norm.value.uniqueKey } : fallbackEmail(g.email);

    const out = await withTx(pool, async (c) => {
      let user = (await c.query('SELECT * FROM users WHERE tenant_id=$1 AND google_sub=$2 AND deleted_at IS NULL FOR UPDATE', [DEFAULT_TENANT_ID, g.sub])).rows[0];
      let isNewUser = false;
      if (user) {
        if (!user.email_verified_at) {
          user = (await c.query('UPDATE users SET email_verified_at=now() WHERE id=$1 RETURNING *', [user.id])).rows[0];
        }
      } else {
        const byEmail = (await c.query('SELECT * FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL FOR UPDATE', [DEFAULT_TENANT_ID, em.uniqueKey])).rows[0];
        if (byEmail) {
          if (byEmail.google_sub && byEmail.google_sub !== g.sub) {
            throw conflict('GOOGLE_ACCOUNT_CONFLICT', 'This email is already linked to a different Google account');
          }
          // An unverified password account may have been pre-registered by someone else: drop its password and sessions when linking.
          const risky = !byEmail.email_verified_at && !!byEmail.password_hash;
          user = (await c.query(
            `UPDATE users SET google_sub=$2, email_verified_at=COALESCE(email_verified_at, now()),
                    password_hash = CASE WHEN $3 THEN NULL ELSE password_hash END WHERE id=$1 RETURNING *`,
            [byEmail.id, g.sub, risky])).rows[0];
          if (risky) await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [byEmail.id]);
        } else {
          if (body.acceptTerms !== true) {
            throw new ApiError(400, 'TERMS_REQUIRED', 'You must accept the Terms and Privacy Policy to create an account', {
              acceptTerms: 'You must accept the Terms and Privacy Policy to create an account',
            });
          }
          // Google can only ever create students. Officer / recruiter accounts exist only through their own flows.
          user = (await c.query(
            `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash, google_sub, auth_provider, email_verified_at)
             VALUES ($1,'student',$2,$3,$4,NULL,NULL,$5,'google',now()) RETURNING *`,
            [DEFAULT_TENANT_ID, nameFromGoogle(g.name, g.email), em.email, em.uniqueKey, g.sub])).rows[0];
          await c.query('INSERT INTO user_consents (tenant_id, user_id, policy_version) VALUES ($1,$2,$3)', [user.tenant_id, user.id, CONSENT_POLICY_VERSION]);
          await c.query('INSERT INTO profiles (user_id, tenant_id) VALUES ($1,$2)', [user.id, user.tenant_id]);
          isNewUser = true;
        }
      }
      const tokens = await issueSessionTokens(deps, c, user);
      return { user, isNewUser, tokens };
    });
    res.json({ user: userDto(out.user), ...out.tokens, isNewUser: out.isNewUser, needsPhone: !out.user.phone });
  }));

  return r;
}

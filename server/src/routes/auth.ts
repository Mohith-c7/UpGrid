import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../config';
import { authenticate, Deps, me, signAccessToken } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, forbidden, parse, unauthorized, wrap } from '../errors';
import { CONSENT_POLICY_VERSION } from '../legal';
import { integ } from '../integrations';
import { turnstileGuard } from '../turnstile';
import { OTP, issueOtp } from '../otp';
import { sendMail } from '../mail';
import { formatPhone, nameSchema, normalizeEmail, normalizeName, normalizePhone, passwordSchema, phoneSchema, validatePassword } from '../validation';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password-1', 4);

export function userDto(u: any) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone ?? null, phoneDisplay: u.phone ? formatPhone(String(u.phone).trim()) : null,
    role: u.role, tenantId: u.tenant_id, createdAt: u.created_at,
    emailVerified: !!u.email_verified_at,
    authProvider: (u.auth_provider === 'google' ? 'google' : 'password') as 'password' | 'google',
    hasPassword: !!u.password_hash,
  };
}

/** Creates a 6-digit code for the user's current email and mails it. Never throws; returns the outcome for callers that care. */
export async function sendVerificationEmail(deps: Deps, user: { id: string; tenant_id: string; email: string; email_key: string; name: string }, ip: string | null) {
  if (!integ(deps).emailEnabled) return { sent: false as const, reason: 'disabled' as const };
  try {
    const out = await issueOtp(deps.pool, { tenantId: user.tenant_id, userId: user.id, emailKey: user.email_key, purpose: 'verify_email', ip });
    if (!out.ok) return { sent: false as const, reason: out.reason, retryAfter: out.retryAfter };
    void sendMail(user.email, 'verification_code', { name: user.name, code: out.code, expiresMinutes: OTP.ttlMinutes });
    return { sent: true as const };
  } catch (e) {
    console.error(`[auth] verification email failed: ${(e as Error).message}`);
    return { sent: false as const, reason: 'error' as const };
  }
}

export async function issueSessionTokens(deps: Deps, db: { query: Function }, user: any) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await db.query(
    `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [user.tenant_id, user.id, sha256(refreshToken), String(deps.cfg.refreshTtlDays)],
  );
  return { accessToken: signAccessToken(deps.cfg, user), refreshToken };
}

const registerSchema = z.object({
  name: nameSchema,
  email: z.any(),
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(['student', 'officer'], { message: 'Role must be student or officer' }),
  inviteCode: z.string().max(100).optional(),
  acceptTerms: z.literal(true, { message: 'You must accept the Terms and Privacy Policy to create an account' }),
});

export function authRouter(deps: Deps) {
  const { pool, cfg } = deps;
  const r = Router();
  const captcha = turnstileGuard(integ(deps).settings.turnstile.secret, integ(deps).fetch);

  async function issueTokens(db: { query: Function }, user: any) {
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await db.query(
      `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
      [user.tenant_id, user.id, sha256(refreshToken), String(cfg.refreshTtlDays)],
    );
    return { accessToken: signAccessToken(cfg, user), refreshToken };
  }

  r.post('/register', captcha, wrap(async (req, res) => {
    // validate email separately so we can keep the unique key
    const body = req.body ?? {};
    const fields: Record<string, string> = {};
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    const em = normalizeEmail(body.email);
    if (!em.ok) fields.email = em.message;
    if (Object.keys(fields).length || !parsed.success || !em.ok) {
      throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0] || 'Invalid request', fields);
    }
    const d = parsed.data;
    if (d.role === 'officer') {
      if (!cfg.officerInviteCode || d.inviteCode !== cfg.officerInviteCode) {
        throw forbidden('A valid invite code is required for officer accounts', 'INVALID_INVITE_CODE');
      }
    }
    const out = await withTx(pool, async (c) => {
      const dupE = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL', [DEFAULT_TENANT_ID, em.value.uniqueKey]);
      if (dupE.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this email already exists', { email: 'An account with this email already exists' });
      const dupP = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND phone=$2 AND deleted_at IS NULL', [DEFAULT_TENANT_ID, d.phone]);
      if (dupP.rowCount) throw conflict('PHONE_TAKEN', 'An account with this mobile number already exists', { phone: 'An account with this mobile number already exists' });
      const hash = await bcrypt.hash(d.password, cfg.bcryptRounds);
      const ins = await c.query(
        `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [DEFAULT_TENANT_ID, d.role, d.name, em.value.email, em.value.uniqueKey, d.phone, hash],
      );
      const user = ins.rows[0];
      await c.query('INSERT INTO user_consents (tenant_id, user_id, policy_version) VALUES ($1,$2,$3)', [user.tenant_id, user.id, CONSENT_POLICY_VERSION]);
      if (d.role === 'student') {
        await c.query('INSERT INTO profiles (user_id, tenant_id) VALUES ($1,$2)', [user.id, user.tenant_id]);
      }
      const tokens = await issueTokens(c, user);
      return { user: userDto(user), ...tokens };
    });
    // non-blocking: a mail problem never fails registration
    void sendVerificationEmail(deps, { id: out.user.id, tenant_id: out.user.tenantId, email: out.user.email, email_key: em.value.uniqueKey, name: out.user.name }, req.ip ?? null);
    res.status(201).json(out);
  }));

  r.post('/login', captcha, wrap(async (req, res) => {
    const body = z.object({ email: z.string().max(254), password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Email and password are required', { email: 'Required', password: 'Required' });
    const em = normalizeEmail(body.data.email);
    // A typo domain should not block login of a legacy account; look up by key either way.
    const key = em.ok ? em.value.uniqueKey : body.data.email.trim().toLowerCase();
    const row = (await pool.query('SELECT * FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL', [DEFAULT_TENANT_ID, key])).rows[0];
    const okPw = await bcrypt.compare(body.data.password, row?.password_hash || DUMMY_HASH);
    // accounts created with Google have no password: they can never match here
    if (!row || !row.password_hash || !okPw) throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
    const tokens = await issueTokens(pool, row);
    res.json({ user: userDto(row), ...tokens });
  }));

  r.post('/refresh', wrap(async (req, res) => {
    const { refreshToken } = parse<{ refreshToken: string }>(z.object({ refreshToken: z.string().min(10).max(200) }), req.body);
    const out = await withTx(pool, async (c) => {
      const t = (await c.query('SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE', [sha256(refreshToken)])).rows[0];
      if (!t) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
      if (t.revoked_at) {
        // reuse of a rotated token: assume theft, revoke the whole family
        await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [t.user_id]);
        return { reuse: true as const };
      }
      if (new Date(t.expires_at) < new Date()) throw unauthorized('Session expired', 'INVALID_REFRESH_TOKEN');
      const user = (await c.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [t.user_id])).rows[0];
      if (!user) throw unauthorized('Account not found', 'INVALID_REFRESH_TOKEN');
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [t.id]);
      return { reuse: false as const, user, ...(await issueTokens(c, user)) };
    });
    if (out.reuse) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    res.json({ user: userDto(out.user), accessToken: out.accessToken, refreshToken: out.refreshToken });
  }));

  r.post('/logout', wrap(async (req, res) => {
    const rt = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    if (rt) await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [sha256(rt)]);
    res.json({ ok: true });
  }));

  return r;
}

export function meRouter(deps: Deps) {
  const { pool, cfg } = deps;
  const r = Router();
  r.use(authenticate(deps));

  r.get('/me', wrap(async (req, res) => {
    const u = (await pool.query('SELECT * FROM users WHERE id=$1', [me(req).id])).rows[0];
    res.json({ user: userDto(u) });
  }));

  // Edit contact details. Role (and any other field) cannot be changed here.
  // Changing the email clears emailVerified and sends a new code (when mail is configured).
  r.patch('/me', wrap(async (req, res) => {
    const u = me(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Send the fields you want to change', { _: 'Send the fields you want to change' });
    }
    const allowed = new Set(['name', 'email', 'phone']);
    const fields: Record<string, string> = {};
    for (const k of Object.keys(body)) if (!allowed.has(k)) fields[k] = k === 'role' ? 'Role cannot be changed' : 'This field cannot be changed';
    const patch: { name?: string; email?: string; emailKey?: string; phone?: string } = {};
    if (body.name !== undefined) {
      const n = normalizeName(body.name);
      if (n.ok) patch.name = n.value; else fields.name = n.message;
    }
    if (body.email !== undefined) {
      const e = normalizeEmail(body.email);
      if (e.ok) { patch.email = e.value.email; patch.emailKey = e.value.uniqueKey; } else fields.email = e.message;
    }
    if (body.phone !== undefined) {
      const p = normalizePhone(body.phone);
      if (p.ok) patch.phone = p.value; else fields.phone = p.message;
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    if (!Object.keys(patch).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Send at least one of name, email or phone', { _: 'Nothing to update' });

    const taken = (code: string, message: string, field: string) => conflict(code, message, { [field]: message });
    let emailChanged = false;
    const row = await withTx(pool, async (c) => {
      const cur = (await c.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [u.id])).rows[0];
      if (!cur) throw unauthorized('Account not found');
      emailChanged = patch.emailKey !== undefined && patch.emailKey !== cur.email_key;
      if (patch.emailKey !== undefined && patch.emailKey !== cur.email_key) {
        const dup = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL AND id<>$3', [cur.tenant_id, patch.emailKey, cur.id]);
        if (dup.rowCount) throw taken('EMAIL_TAKEN', 'An account with this email already exists', 'email');
      }
      if (patch.phone !== undefined && patch.phone !== String(cur.phone).trim()) {
        const dup = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND phone=$2 AND deleted_at IS NULL AND id<>$3', [cur.tenant_id, patch.phone, cur.id]);
        if (dup.rowCount) throw taken('PHONE_TAKEN', 'An account with this mobile number already exists', 'phone');
      }
      const upd = await c.query(
        `UPDATE users SET name=$2, email=$3, email_key=$4, phone=$5,
                email_verified_at = CASE WHEN email_key = $4 THEN email_verified_at ELSE NULL END WHERE id=$1 RETURNING *`,
        [cur.id, patch.name ?? cur.name, patch.email ?? cur.email, patch.emailKey ?? cur.email_key, patch.phone ?? cur.phone],
      );
      return upd.rows[0];
    }).catch((e: any) => {
      if (e?.code === '23505') {
        // lost a race against another signup/edit
        const f = /phone/.test(String(e.constraint)) ? 'phone' : 'email';
        throw f === 'phone' ? taken('PHONE_TAKEN', 'An account with this mobile number already exists', 'phone') : taken('EMAIL_TAKEN', 'An account with this email already exists', 'email');
      }
      throw e;
    });
    if (emailChanged) void sendVerificationEmail(deps, row, req.ip ?? null); // the new address must be verified again
    res.json({ user: userDto(row) });
  }));

  r.post('/me/change-password', wrap(async (req, res) => {
    const body = parse<{ currentPassword: string; newPassword: string }>(
      z.object({ currentPassword: z.string().max(200), newPassword: passwordSchema }), req.body);
    const u = (await pool.query('SELECT * FROM users WHERE id=$1', [me(req).id])).rows[0];
    if (!u.password_hash) {
      throw new ApiError(400, 'NO_PASSWORD_SET', 'This account has no password yet. Use "Forgot password" to set one.', { currentPassword: 'No password set' });
    }
    if (!(await bcrypt.compare(body.currentPassword, u.password_hash))) {
      throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    if (body.currentPassword === body.newPassword) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'New password must be different', { newPassword: 'New password must be different' });
    }
    validatePassword(body.newPassword);
    const hash = await bcrypt.hash(body.newPassword, cfg.bcryptRounds);
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, hash]);
    await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    const tokens = { accessToken: signAccessToken(cfg, u), refreshToken: '' };
    const refresh = crypto.randomBytes(48).toString('base64url');
    await pool.query(`INSERT INTO refresh_tokens (tenant_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`, [u.tenant_id, u.id, sha256(refresh), String(cfg.refreshTtlDays)]);
    tokens.refreshToken = refresh;
    res.json({ ok: true, ...tokens });
  }));

  // Soft delete: frees email/phone for reuse (partial unique indexes), revokes sessions, removes push tokens, cancels reminders.
  r.delete('/me', wrap(async (req, res) => {
    const id = me(req).id;
    await withTx(pool, async (c) => {
      await c.query('UPDATE users SET deleted_at=now() WHERE id=$1', [id]);
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
      await c.query('DELETE FROM devices WHERE user_id=$1', [id]);
      await c.query(`UPDATE scheduled_reminders SET status='cancelled', processed_at=now() WHERE user_id=$1 AND status='pending'`, [id]);
    });
    res.json({ ok: true });
  }));

  return r;
}

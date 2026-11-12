import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { Config } from '../config';
import { signAccessToken } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, unprocessable } from '../errors';
import { toCompany } from '../drives';
import { CONSENT_POLICY_VERSION } from '../legal';
import { formatPhone, nameSchema, normalizeEmail, passwordSchema, phoneSchema } from '../validation';
import { normalizePermissions, Permissions } from './access';
import { audit, Outbox } from './shared';
import { sendInviteMail } from './mailer';
import type { PushSender } from '../push';

export const INVITE_TTL_DAYS = 7;
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => 'rinv_' + crypto.randomBytes(32).toString('base64url');

export interface InviteInput { email: unknown; name?: unknown; permissions?: Permissions }

const inviteDto = (r: any) => ({
  id: r.id, driveId: r.drive_id, email: r.email, name: r.name ?? null,
  status: r.accepted_at ? 'accepted' : r.revoked_at ? 'revoked' : new Date(r.expires_at) <= new Date() ? 'expired' : 'pending',
  expiresAt: new Date(r.expires_at).toISOString(), createdAt: new Date(r.created_at).toISOString(), permissions: normalizePermissions(r.permissions),
});
export { inviteDto };

export const memberDto = (r: any) => ({
  userId: r.user_id, name: r.name, email: r.email, phoneDisplay: r.phone ? formatPhone(String(r.phone).trim()) : null,
  permissions: normalizePermissions(r.permissions), addedAt: new Date(r.created_at).toISOString(),
  revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
});

export async function inviteRecruiter(
  pool: Pool, push: PushSender, officer: { id: string; tenantId: string; name: string }, drive: any, input: InviteInput,
) {
  const em = normalizeEmail(input.email);
  const fields: Record<string, string> = {};
  if (!em.ok) fields.email = em.message;
  let name: string | null = null;
  if (input.name !== undefined && input.name !== null && input.name !== '') {
    const n = nameSchema.safeParse(input.name);
    if (n.success) name = n.data as string; else fields.name = n.error.issues[0]?.message ?? 'Invalid name';
  }
  if (Object.keys(fields).length || !em.ok) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0] || 'Invalid request', fields);
  const perms = input.permissions ?? normalizePermissions({});
  const company = toCompany(drive.company).name;
  const outbox = new Outbox(pool as any, officer.tenantId);

  const out = await withTx(pool, async (c) => {
    const ob = new Outbox(c, officer.tenantId);
    const existing = (await c.query(`SELECT id, role FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL`, [officer.tenantId, em.value.uniqueKey])).rows[0];
    if (existing) {
      if (existing.role !== 'recruiter') throw conflict('EMAIL_BELONGS_TO_OTHER_ROLE', 'This email belongs to a student or officer account and cannot be invited as a recruiter', { email: 'This email already has a non-recruiter account' });
      const m = (await c.query('SELECT revoked_at FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 FOR UPDATE', [drive.id, existing.id])).rows[0];
      if (m && !m.revoked_at) throw conflict('ALREADY_MEMBER', 'This recruiter already has access to the drive');
      await c.query(
        `INSERT INTO company_recruiters (drive_id, user_id, tenant_id, permissions, invited_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (drive_id, user_id) DO UPDATE SET revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL, permissions=EXCLUDED.permissions, invited_by=EXCLUDED.invited_by, created_at=now()`,
        [drive.id, existing.id, officer.tenantId, JSON.stringify(perms), officer.id],
      );
      await ob.send(existing.id, 'recruiter_access', `You were added to ${company}`, `You can now review candidates for ${drive.role} at ${company}.`, { driveId: drive.id });
      await audit(c, officer.tenantId, officer.id, 'recruiter.invite', { driveId: drive.id, userId: existing.id, existingAccount: true });
      return { kind: 'member' as const, userId: existing.id, ob };
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    const pending = (await c.query(`SELECT id FROM recruiter_invites WHERE drive_id=$1 AND email_key=$2 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`, [drive.id, em.value.uniqueKey])).rows[0];
    let row: any;
    if (pending) {
      row = (await c.query(
        `UPDATE recruiter_invites SET token_hash=$2, expires_at=$3, name=COALESCE($4, name), permissions=$5, invited_by=$6 WHERE id=$1 RETURNING *`,
        [pending.id, sha256(token), expiresAt, name, JSON.stringify(perms), officer.id],
      )).rows[0];
    } else {
      row = (await c.query(
        `INSERT INTO recruiter_invites (tenant_id, drive_id, email, email_key, name, permissions, token_hash, invited_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [officer.tenantId, drive.id, em.value.email, em.value.uniqueKey, name, JSON.stringify(perms), sha256(token), officer.id, expiresAt],
      )).rows[0];
    }
    await audit(c, officer.tenantId, officer.id, 'recruiter.invite', { driveId: drive.id, inviteId: row.id, email: em.value.email, reissued: !!pending });
    return { kind: 'invite' as const, row, token, reissued: !!pending, ob };
  });
  void outbox;
  await out.ob.flush(push, pool);
  if (out.kind === 'member') {
    const m = (await pool.query(
      `SELECT cr.*, u.name, u.email, u.phone FROM company_recruiters cr JOIN users u ON u.id=cr.user_id WHERE cr.drive_id=$1 AND cr.user_id=$2`, [drive.id, out.userId])).rows[0];
    return { status: 201, body: { member: memberDto(m), invite: null, inAppNotified: true, emailSent: false } };
  }
  const emailSent = await sendInviteMail({
    to: out.row.email, name: out.row.name, companyName: company, driveRole: drive.role, inviteToken: out.token, expiresAt: new Date(out.row.expires_at), invitedBy: officer.name,
  });
  return { status: out.reissued ? 200 : 201, body: { invite: inviteDto(out.row), inviteToken: out.token, emailSent, inAppNotified: false, ...(out.reissued ? { reissued: true } : {}) } };
}

/** Re-issue a token for an existing pending invite (resend). */
export async function resendInvite(pool: Pool, officer: { id: string; tenantId: string; name: string }, drive: any, inviteId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  const row = (await pool.query(
    `UPDATE recruiter_invites SET token_hash=$3, expires_at=$4 WHERE id=$1 AND drive_id=$2 AND tenant_id=$5 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING *`,
    [inviteId, drive.id, sha256(token), expiresAt, officer.tenantId],
  )).rows[0];
  if (!row) throw notFound('Invite not found or no longer pending', 'INVITE_NOT_FOUND');
  await audit(pool, officer.tenantId, officer.id, 'recruiter.invite', { driveId: drive.id, inviteId, resent: true });
  const emailSent = await sendInviteMail({
    to: row.email, name: row.name, companyName: toCompany(drive.company).name, driveRole: drive.role, inviteToken: token, expiresAt, invitedBy: officer.name,
  });
  return { invite: inviteDto(row), inviteToken: token, emailSent };
}

// ------------------------------------------------------------------ public: lookup + register
const invalid = () => notFound('This invite link is not valid', 'INVITE_INVALID');

async function findInvite(db: { query: Function }, token: unknown, lock = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid();
  const inv = (await db.query(
    `SELECT i.*, d.company, d.role AS drive_role FROM recruiter_invites i JOIN drives d ON d.id=i.drive_id WHERE i.token_hash=$1 ${lock ? 'FOR UPDATE OF i' : ''}`, [sha256(token)])).rows[0];
  if (!inv || inv.revoked_at || inv.accepted_at) throw invalid();
  if (new Date(inv.expires_at) <= new Date()) throw unprocessable('INVITE_EXPIRED', 'This invite has expired. Ask the placement cell to send a new one.');
  return inv;
}

export async function lookupInvite(pool: Pool, token: unknown) {
  const inv = await findInvite(pool, token);
  return { invite: { email: inv.email, name: inv.name ?? null, driveId: inv.drive_id, companyName: toCompany(inv.company).name, role: inv.drive_role, expiresAt: new Date(inv.expires_at).toISOString() } };
}

const registerSchema = z.object({
  inviteToken: z.string().min(20, 'Invite token is required').max(200),
  name: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: 'You must accept the Terms and Privacy Policy to create an account' }),
});

export async function registerRecruiter(pool: Pool, cfg: Config, body: unknown) {
  const parsed = registerSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
  }
  const d = parsed.data;
  return withTx(pool, async (c) => {
    const inv = await findInvite(c, d.inviteToken, true);
    const em = normalizeEmail(inv.email);
    const key = em.ok ? em.value.uniqueKey : String(inv.email_key);
    const dupE = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND email_key=$2 AND deleted_at IS NULL', [inv.tenant_id, key]);
    if (dupE.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this email already exists', { email: 'An account with this email already exists' });
    const dupP = await c.query('SELECT 1 FROM users WHERE tenant_id=$1 AND phone=$2 AND deleted_at IS NULL', [inv.tenant_id, d.phone]);
    if (dupP.rowCount) throw conflict('PHONE_TAKEN', 'An account with this mobile number already exists', { phone: 'An account with this mobile number already exists' });
    const hash = await bcrypt.hash(d.password, cfg.bcryptRounds);
    const user = (await c.query(
      `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,'recruiter',$2,$3,$4,$5,$6) RETURNING *`,
      [inv.tenant_id, d.name, inv.email, key, d.phone, hash])).rows[0];
    await c.query('INSERT INTO user_consents (tenant_id, user_id, policy_version) VALUES ($1,$2,$3)', [user.tenant_id, user.id, CONSENT_POLICY_VERSION]);
    // accept every still-valid invite for this email (one recruiter can be invited to several drives)
    const all = (await c.query(
      `SELECT * FROM recruiter_invites WHERE tenant_id=$1 AND email_key=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [inv.tenant_id, inv.email_key])).rows;
    const memberships: { driveId: string; permissions: Permissions }[] = [];
    for (const i of all) {
      await c.query(`UPDATE recruiter_invites SET accepted_at=now(), accepted_user_id=$2 WHERE id=$1`, [i.id, user.id]);
      await c.query(
        `INSERT INTO company_recruiters (drive_id, user_id, tenant_id, permissions, invited_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (drive_id, user_id) DO UPDATE SET revoked_at=NULL, permissions=EXCLUDED.permissions`,
        [i.drive_id, user.id, inv.tenant_id, JSON.stringify(normalizePermissions(i.permissions)), i.invited_by]);
      memberships.push({ driveId: i.drive_id, permissions: normalizePermissions(i.permissions) });
    }
    await audit(c, inv.tenant_id, user.id, 'recruiter.register', { driveIds: memberships.map((m) => m.driveId), inviteId: inv.id });
    if (inv.invited_by) {
      const ob = new Outbox(c, inv.tenant_id);
      await ob.send(inv.invited_by, 'recruiter_access', 'Recruiter joined', `${user.name} accepted the invite for ${toCompany(inv.company).name}.`, { driveId: inv.drive_id, userId: user.id });
    }
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await c.query(`INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`, [user.tenant_id, user.id, sha256(refreshToken), String(cfg.refreshTtlDays)]);
    return { user, accessToken: signAccessToken(cfg, user), refreshToken, memberships };
  });
}

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { withTx } from './db';

export const OTP = { ttlMinutes: 10, maxAttempts: 5, cooldownSeconds: 60, perEmailPerHour: 5, perIpPerHour: 20 } as const;
export type OtpPurpose = 'verify_email' | 'reset_password';

export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const hashCode = (code: string, salt: string) => crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'cooldown' | 'rate_limited'; retryAfter: number };

/** Creates a new code (invalidating older ones) unless the 60 s cooldown or the hourly per-email / per-IP limits apply. */
export async function issueOtp(
  pool: Pool,
  p: { tenantId: string; userId: string | null; emailKey: string; purpose: OtpPurpose; ip: string | null },
): Promise<IssueResult> {
  return withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${p.tenantId}:${p.purpose}:${p.emailKey}`]);
    const last = (await c.query(
      `SELECT ceil(extract(epoch FROM (created_at + ($4 || ' seconds')::interval - clock_timestamp())))::int AS wait
         FROM otp_codes WHERE tenant_id=$1 AND email_key=$2 AND purpose=$3 ORDER BY created_at DESC LIMIT 1`,
      [p.tenantId, p.emailKey, p.purpose, String(OTP.cooldownSeconds)])).rows[0];
    if (last && last.wait > 0) return { ok: false as const, reason: 'cooldown' as const, retryAfter: last.wait };
    const perEmail = (await c.query(
      `SELECT count(*)::int n FROM otp_codes WHERE tenant_id=$1 AND email_key=$2 AND purpose=$3 AND created_at > now() - interval '1 hour'`,
      [p.tenantId, p.emailKey, p.purpose])).rows[0].n;
    if (perEmail >= OTP.perEmailPerHour) return { ok: false as const, reason: 'rate_limited' as const, retryAfter: 600 };
    if (p.ip) {
      const perIp = (await c.query(`SELECT count(*)::int n FROM otp_codes WHERE ip=$1 AND created_at > now() - interval '1 hour'`, [p.ip])).rows[0].n;
      if (perIp >= OTP.perIpPerHour) return { ok: false as const, reason: 'rate_limited' as const, retryAfter: 600 };
    }
    await c.query(`UPDATE otp_codes SET consumed_at=now() WHERE tenant_id=$1 AND email_key=$2 AND purpose=$3 AND consumed_at IS NULL`, [p.tenantId, p.emailKey, p.purpose]);
    const code = newCode();
    const salt = crypto.randomBytes(16).toString('hex');
    await c.query(
      `INSERT INTO otp_codes (tenant_id, user_id, email_key, purpose, code_hash, salt, ip, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' minutes')::interval)`,
      [p.tenantId, p.userId, p.emailKey, p.purpose, hashCode(code, salt), salt, p.ip, String(OTP.ttlMinutes)]);
    return { ok: true as const, code };
  });
}

export type CheckResult = { ok: true; userId: string | null } | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

/** Checks the newest active code. Wrong guesses are counted (and persisted); after 5 the code is locked even for the right value. */
export async function checkOtp(pool: Pool, p: { tenantId: string; emailKey: string; purpose: OtpPurpose; code: string }): Promise<CheckResult> {
  return withTx(pool, async (c) => {
    const row = (await c.query(
      `SELECT *, (expires_at < clock_timestamp()) AS expired FROM otp_codes
        WHERE tenant_id=$1 AND email_key=$2 AND purpose=$3 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [p.tenantId, p.emailKey, p.purpose])).rows[0];
    if (!row) return { ok: false as const, reason: 'invalid' as const };
    if (row.attempts >= OTP.maxAttempts) return { ok: false as const, reason: 'locked' as const };
    if (row.expired) return { ok: false as const, reason: 'expired' as const };
    if (safeEqualHex(hashCode(p.code, row.salt), row.code_hash)) {
      await c.query('UPDATE otp_codes SET consumed_at=now() WHERE id=$1', [row.id]);
      return { ok: true as const, userId: row.user_id as string | null };
    }
    await c.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
    return { ok: false as const, reason: 'invalid' as const };
  });
}

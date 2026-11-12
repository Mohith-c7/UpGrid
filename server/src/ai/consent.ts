import type { Pool } from 'pg';
import { ApiError } from '../errors';

export const CONSENT_VERSION = 'v1';
export interface ConsentState { granted: boolean; grantedAt: string | null; revokedAt: string | null; version: string }

export async function getConsent(pool: Pool, userId: string): Promise<ConsentState> {
  const r = await pool.query('SELECT granted, granted_at, revoked_at, version FROM ai_consents WHERE user_id=$1', [userId]);
  const row = r.rows[0];
  if (!row) return { granted: false, grantedAt: null, revokedAt: null, version: CONSENT_VERSION };
  return {
    granted: !!row.granted,
    grantedAt: row.granted_at ? new Date(row.granted_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    version: row.version,
  };
}

export async function setConsent(pool: Pool, tenantId: string, userId: string, granted: boolean): Promise<ConsentState> {
  await pool.query(
    `INSERT INTO ai_consents (user_id, tenant_id, granted, version, granted_at, revoked_at, updated_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $3 THEN now() END, CASE WHEN NOT $3 THEN now() END, now())
     ON CONFLICT (user_id) DO UPDATE SET granted=$3, version=$4,
       granted_at = CASE WHEN $3 THEN now() ELSE ai_consents.granted_at END,
       revoked_at = CASE WHEN NOT $3 THEN now() ELSE NULL END, updated_at=now()`,
    [userId, tenantId, granted, CONSENT_VERSION]);
  if (!granted) await pool.query('DELETE FROM ai_cache WHERE user_id=$1', [userId]);
  return getConsent(pool, userId);
}

export async function requireConsent(pool: Pool, userId: string): Promise<void> {
  if (!(await getConsent(pool, userId)).granted) {
    throw new ApiError(403, 'AI_CONSENT_REQUIRED', 'Turn on AI assistance in your AI settings to use this feature. Your contact details are never shared with the AI.');
  }
}

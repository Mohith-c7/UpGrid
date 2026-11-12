import type { Db } from '../db';
import { policySchema, Policy } from './schema';

export interface ActiveVersion { id: string; version: number; policyId: string; name: string; effectiveFrom: string | null }
export interface ActivePolicy { policy: Policy; version: ActiveVersion }

export const SETTING_DEFAULTS = {
  publicStatsEnabled: false,
  publicStatsMinGroup: 5,
  restrictionApproval: 'required' as 'required' | 'not_required',
  policyApproval: 'not_required' as 'required' | 'not_required',
};
export type TenantOpsSettings = typeof SETTING_DEFAULTS;

export async function getOpsSettings(db: Db, tenantId: string): Promise<TenantOpsSettings> {
  const r = await db.query('SELECT settings FROM tenant_settings WHERE tenant_id=$1', [tenantId]);
  const s = r.rows[0]?.settings || {};
  return {
    publicStatsEnabled: s.publicStatsEnabled === true,
    publicStatsMinGroup: Math.max(5, Number(s.publicStatsMinGroup) || 5),
    restrictionApproval: s.restrictionApproval === 'not_required' ? 'not_required' : 'required',
    policyApproval: s.policyApproval === 'required' ? 'required' : 'not_required',
  };
}

export async function saveOpsSettings(db: Db, tenantId: string, patch: Partial<TenantOpsSettings>): Promise<TenantOpsSettings> {
  const cur = await getOpsSettings(db, tenantId);
  const next = { ...cur, ...patch };
  await db.query(
    `INSERT INTO tenant_settings (tenant_id, settings, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (tenant_id) DO UPDATE SET settings = tenant_settings.settings || EXCLUDED.settings, updated_at = now()`,
    [tenantId, JSON.stringify(next)],
  );
  return next;
}

/** Writes the active policy JSON where the hiring pipeline module reads it (tenant_settings.policy). */
export async function writeTenantPolicy(db: Db, tenantId: string, active: ActivePolicy | null): Promise<void> {
  const value = active
    ? { ...active.policy, _meta: { policyId: active.version.policyId, versionId: active.version.id, version: active.version.version, name: active.version.name, effectiveFrom: active.version.effectiveFrom } }
    : null;
  await db.query(
    `INSERT INTO tenant_settings (tenant_id, policy, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (tenant_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
    [tenantId, JSON.stringify(value ?? {})], // tenant_settings.policy is NOT NULL (migration 024): '{}' = no active policy
  );
}

const toActive = (row: any): ActivePolicy => ({
  policy: policySchema.parse(row.policy),
  version: {
    id: row.id, version: row.version, policyId: row.policy_id, name: row.name,
    effectiveFrom: row.effective_from ? new Date(row.effective_from).toISOString() : null,
  },
});

/** Policy in force for the tenant right now (a scheduled version whose time has come is promoted on read). null = none. */
export async function getActivePolicy(db: Db, tenantId: string, now: Date = new Date()): Promise<ActivePolicy | null> {
  const r = await db.query(
    `SELECT pv.*, pp.name FROM policy_versions pv JOIN placement_policies pp ON pp.id = pv.policy_id
      WHERE pv.tenant_id=$1 AND pv.status IN ('active','scheduled') AND COALESCE(pv.effective_from, pv.activated_at) <= $2
      ORDER BY COALESCE(pv.effective_from, pv.activated_at) DESC, pv.activated_at DESC LIMIT 1`,
    [tenantId, now],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.status === 'scheduled') {
    await db.query(`UPDATE policy_versions SET status='superseded' WHERE tenant_id=$1 AND status='active' AND id<>$2`, [tenantId, row.id]);
    await db.query(`UPDATE policy_versions SET status='active' WHERE id=$1`, [row.id]);
  }
  const active = toActive(row);
  const cur = await db.query(`SELECT policy->'_meta'->>'versionId' AS vid FROM tenant_settings WHERE tenant_id=$1`, [tenantId]);
  if (cur.rows[0]?.vid !== active.version.id) await writeTenantPolicy(db, tenantId, active);
  return active;
}

/** Makes a version live (or scheduled when its effective date is in the future). Call inside a transaction. */
export async function activateVersion(db: Db, tenantId: string, versionId: string, actorId: string, now: Date = new Date()): Promise<{ active: boolean }> {
  const v = (await db.query(`SELECT * FROM policy_versions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [versionId, tenantId])).rows[0];
  const from = v.effective_from ? new Date(v.effective_from) : now;
  if (from.getTime() > now.getTime()) {
    await db.query(`UPDATE policy_versions SET status='scheduled', effective_from=$2, activated_by=$3, activated_at=$4 WHERE id=$1`, [versionId, from, actorId, now]);
    return { active: false };
  }
  await db.query(`UPDATE policy_versions SET status='superseded' WHERE tenant_id=$1 AND status IN ('active','scheduled') AND id<>$2`, [tenantId, versionId]);
  await db.query(`UPDATE policy_versions SET status='active', effective_from=$2, activated_by=$3, activated_at=$4 WHERE id=$1`, [versionId, from, actorId, now]);
  const row = (await db.query(`SELECT pv.*, pp.name FROM policy_versions pv JOIN placement_policies pp ON pp.id=pv.policy_id WHERE pv.id=$1`, [versionId])).rows[0];
  await writeTenantPolicy(db, tenantId, toActive(row));
  return { active: true };
}

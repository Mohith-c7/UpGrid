/** DB-backed eligibility assessment: base engine + drive `extra` + policy + restrictions. Used by preview / apply / lists / simulate. */
import type { Db } from '../db';
import type { EligibilityResult } from '../eligibility';
import { driveCtxFromRow, evaluateWithPolicy, offerInfoFromLpas, StudentCtx } from './engine';
import { getActivePolicy } from './store';
import { getActiveRestrictions, restrictedReason, rowToRestriction, RestrictionRow } from './restrictions';
import type { Policy } from './schema';

export type AssessedEligibility = Omit<EligibilityResult, 'status'> & {
  status: EligibilityResult['status'] | 'restricted';
  restriction?: { id: string; message: string; appealPath: string };
  policy: { versionId: string; version: number } | null;
};

export async function loadOffers(db: Db, tenantId: string, userId: string) {
  const r = await db.query(
    `SELECT d.ctc FROM applications a JOIN drives d ON d.id=a.drive_id
      WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.status IN ('offer_accepted','joined')`, [tenantId, userId]);
  return offerInfoFromLpas(r.rows.map((x) => {
    const c = x.ctc || {};
    return (c.kind || 'annual') === 'annual' && typeof c.fixedLpa === 'number' ? (c.fixedLpa || 0) + (c.variableLpa || 0) + (c.bonusLpa || 0) : null;
  }));
}

export async function loadActiveRestrictionRows(db: Db, tenantId: string, userId?: string): Promise<RestrictionRow[]> {
  const r = await db.query(
    `SELECT * FROM restrictions WHERE tenant_id=$1 AND status='active' AND (starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
       AND ($2::uuid IS NULL OR student_id IS NULL OR student_id=$2)`, [tenantId, userId ?? null]);
  return r.rows.map(rowToRestriction);
}

export function studentCtx(userId: string, name: string | undefined, profile: { data?: any; verification?: any } | null, offers: StudentCtx['offers']): StudentCtx {
  return { id: userId, name, academics: profile?.data?.academics, verification: profile?.verification, contact: profile?.data?.contact, skills: profile?.data?.skills, offers };
}

export async function assessEligibility(
  db: Db, tenantId: string, driveRow: any, userId: string, profile: { data?: any; verification?: any } | null,
  opts: { record?: 'apply' | 'preview'; recordDb?: Db; policy?: Policy | null } = {},
): Promise<AssessedEligibility> {
  const active = opts.policy !== undefined ? null : await getActivePolicy(db, tenantId);
  const policy = opts.policy !== undefined ? opts.policy : active?.policy ?? null;
  const offers = policy ? await loadOffers(db, tenantId, userId) : offerInfoFromLpas([]);
  const drive = driveCtxFromRow(driveRow);
  const ev = evaluateWithPolicy(policy, drive, studentCtx(userId, undefined, profile, offers));
  const restrictions = await loadActiveRestrictionRows(db, tenantId, userId);
  const hits = getActiveRestrictions(
    { id: userId, department: profile?.data?.academics?.department, batchYear: profile?.data?.academics?.batchYear },
    { id: driveRow.id, companyName: driveRow.company?.name, companyId: driveRow.company_id }, restrictions);
  const policyRef = active ? { versionId: active.version.id, version: active.version.version } : null;
  let out: AssessedEligibility;
  if (hits.length) {
    const rr = restrictedReason(hits[0]);
    out = {
      status: 'restricted', reason: rr.message, policy: policyRef, restriction: { id: hits[0].id, ...rr },
      reasons: [...ev.reasons, { criterion: 'restriction', label: 'Restriction', required: 'No active restriction', actual: hits[0].id, met: false, source: 'profile', verification: 'unverified', message: rr.message } as any],
    };
  } else {
    out = { status: ev.status, reason: ev.reason, reasons: ev.reasons, policy: policyRef };
  }
  if (opts.record) {
    await (opts.recordDb ?? db).query(
      `INSERT INTO eligibility_evaluations (tenant_id, user_id, drive_id, policy_version_id, status, reasons, context) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, userId, driveRow.id, policyRef?.versionId ?? null, out.status, JSON.stringify(out.reasons), opts.record]);
  }
  return out;
}

/** For list/detail views: marks eligibility as `restricted` where an active restriction applies. Mutates nothing; returns a new object. */
export function restrictedOverlay<T extends { status: string; reason: string }>(
  elig: T, student: { id: string; department?: any; batchYear?: any }, driveRow: any, restrictions: RestrictionRow[],
): T {
  const hits = getActiveRestrictions(student, { id: driveRow.id, companyName: driveRow.company?.name, companyId: driveRow.company_id }, restrictions);
  if (!hits.length) return elig;
  return { ...elig, status: 'restricted', reason: restrictedReason(hits[0]).message };
}

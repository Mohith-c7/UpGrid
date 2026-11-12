import { z } from 'zod';
import type { Db } from '../db';
import { pendingVerificationFields } from '../routes/officer';

export const cohortFilterSchema = z.object({
  departments: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  batches: z.array(z.number().int().min(2020).max(2040)).max(10).optional(),
  minCgpa: z.number().min(0).max(10).optional(),
  maxCgpa: z.number().min(0).max(10).optional(),
  maxActiveBacklogs: z.number().int().min(0).max(50).optional(),
  verified: z.boolean().optional(),
  placement: z.enum(['placed', 'unplaced', 'offered']).optional(),
  appliedToDriveId: z.string().uuid().optional(),
  notAppliedToDriveId: z.string().uuid().optional(),
  registrationPrefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9/-]+$/).optional(),
}).strict();
export type CohortFilter = z.infer<typeof cohortFilterSchema>;

export interface CohortStudent { id: string; name: string; registrationNumber: string | null; department: string | null; batchYear: number | null; cgpa: number | null }

/** Students matching a dynamic filter (tenant scoped, ordered by name). */
export async function resolveFilter(db: Db, tenantId: string, f: CohortFilter): Promise<CohortStudent[]> {
  const p: unknown[] = [tenantId];
  let w = `u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`;
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  if (f.departments?.length) w += ` AND lower(p.data->'academics'->>'department') = ANY(${add(f.departments.map((d) => d.toLowerCase()))}::text[])`;
  if (f.batches?.length) w += ` AND (p.data->'academics'->>'batchYear') = ANY(${add(f.batches.map(String))}::text[])`;
  if (f.minCgpa !== undefined) w += ` AND (p.data->'academics'->>'cgpa')::numeric >= ${add(f.minCgpa)}`;
  if (f.maxCgpa !== undefined) w += ` AND (p.data->'academics'->>'cgpa')::numeric <= ${add(f.maxCgpa)}`;
  if (f.maxActiveBacklogs !== undefined) w += ` AND (p.data->'academics'->>'activeBacklogs')::numeric <= ${add(f.maxActiveBacklogs)}`;
  if (f.registrationPrefix) w += ` AND upper(p.data->'identity'->>'registrationNumber') LIKE ${add(f.registrationPrefix.toUpperCase().replace(/[%_\\]/g, (m) => '\\' + m) + '%')}`;
  if (f.appliedToDriveId) w += ` AND EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.drive_id=${add(f.appliedToDriveId)} AND a.status<>'withdrawn')`;
  if (f.notAppliedToDriveId) w += ` AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.drive_id=${add(f.notAppliedToDriveId)} AND a.status<>'withdrawn')`;
  if (f.placement === 'placed') w += ` AND EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.status IN ('offer_accepted','joined'))`;
  if (f.placement === 'unplaced') w += ` AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.status IN ('offer_accepted','joined'))`;
  if (f.placement === 'offered') w += ` AND EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.status IN ('offer_issued','offer_accepted','offer_declined','joined'))`;
  const rows = (await db.query(`SELECT u.id, u.name, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE ${w} ORDER BY u.name, u.id`, p)).rows;
  let out = rows;
  if (f.verified !== undefined) {
    out = rows.filter((s) => {
      const has = Object.keys(s.data?.academics || {}).length > 0;
      const ok = has && pendingVerificationFields(s.data || {}, s.verification || {}).length === 0;
      return f.verified ? ok : !ok;
    });
  }
  return out.map((s) => ({
    id: s.id, name: s.name, registrationNumber: s.data?.identity?.registrationNumber ?? null, department: s.data?.academics?.department ?? null,
    batchYear: s.data?.academics?.batchYear ?? null, cgpa: s.data?.academics?.cgpa ?? null,
  }));
}

export async function loadStudentsByIds(db: Db, tenantId: string, ids: string[]): Promise<CohortStudent[]> {
  if (!ids.length) return [];
  const rows = (await db.query(
    `SELECT u.id, u.name, p.data FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL AND u.id = ANY($2::uuid[]) ORDER BY u.name, u.id`, [tenantId, ids])).rows;
  return rows.map((s) => ({ id: s.id, name: s.name, registrationNumber: s.data?.identity?.registrationNumber ?? null, department: s.data?.academics?.department ?? null, batchYear: s.data?.academics?.batchYear ?? null, cgpa: s.data?.academics?.cgpa ?? null }));
}

export async function cohortMembers(db: Db, cohort: { id: string; tenant_id: string; kind: string; filter: any }): Promise<CohortStudent[]> {
  if (cohort.kind === 'fixed') {
    const ids = (await db.query('SELECT user_id FROM cohort_members WHERE cohort_id=$1', [cohort.id])).rows.map((r) => r.user_id);
    return loadStudentsByIds(db, cohort.tenant_id, ids);
  }
  return resolveFilter(db, cohort.tenant_id, cohortFilterSchema.parse(cohort.filter || {}));
}

/** Exported for other modules (announcements, assessments, drives): the user ids currently in a cohort. [] when unknown. */
export async function resolveCohort(db: Db, cohortId: string, tenantId?: string): Promise<string[]> {
  const c = (await db.query('SELECT * FROM cohorts WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2)', [cohortId, tenantId ?? null])).rows[0];
  if (!c) return [];
  return (await cohortMembers(db, c)).map((s) => s.id);
}

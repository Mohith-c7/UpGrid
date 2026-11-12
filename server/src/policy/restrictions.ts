/** Pure restriction matching. A restriction is enforced only while status is `active` and now is inside [startsAt, endsAt). */
export type RestrictionScope = 'student' | 'company' | 'drive' | 'department' | 'batch' | 'tenant';

export interface RestrictionRow {
  id: string;
  scope: RestrictionScope;
  scopeValue: string | null;
  studentId: string | null;
  studentMessage: string;
  status: 'pending_approval' | 'active' | 'rejected' | 'lifted';
  startsAt: Date | string;
  endsAt: Date | string | null;
  exemptStudentIds: string[];
}
export interface RestrictionStudent { id: string; department?: string | null; batchYear?: number | string | null }
export interface RestrictionDrive { id: string; companyName?: string | null; companyId?: string | null }

export type EffectiveStatus = 'pending_approval' | 'upcoming' | 'active' | 'expired' | 'rejected' | 'lifted';

export function effectiveRestrictionStatus(r: Pick<RestrictionRow, 'status' | 'startsAt' | 'endsAt'>, now: Date): EffectiveStatus {
  if (r.status !== 'active') return r.status;
  if (new Date(r.startsAt).getTime() > now.getTime()) return 'upcoming';
  if (r.endsAt && new Date(r.endsAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

const eq = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Does the restriction target this student (ignoring which drive)? */
function targetsStudent(r: RestrictionRow, s: RestrictionStudent): boolean {
  if (r.exemptStudentIds?.includes(s.id)) return false;
  if (r.studentId && r.studentId !== s.id) return false;
  switch (r.scope) {
    case 'student': return r.scopeValue === s.id || r.studentId === s.id;
    case 'department': return !!s.department && eq(r.scopeValue, s.department);
    case 'batch': return s.batchYear !== null && s.batchYear !== undefined && eq(r.scopeValue, s.batchYear);
    case 'tenant': case 'company': case 'drive': return true;
    default: return false;
  }
}

/**
 * Active restrictions that stop `student` from applying to `drive`.
 * With `drive = null` drive-specific scopes (company / drive) are included so a student can see everything that may affect them.
 */
export function getActiveRestrictions(
  student: RestrictionStudent, drive: RestrictionDrive | null, restrictions: RestrictionRow[], now: Date = new Date(),
): RestrictionRow[] {
  return restrictions.filter((r) => {
    if (effectiveRestrictionStatus(r, now) !== 'active') return false;
    if (!targetsStudent(r, student)) return false;
    if (drive) {
      if (r.scope === 'drive' && r.scopeValue !== drive.id) return false;
      if (r.scope === 'company' && !(eq(r.scopeValue, drive.companyName) || (!!drive.companyId && r.scopeValue === drive.companyId))) return false;
    }
    return true;
  });
}

export function restrictedReason(r: Pick<RestrictionRow, 'studentMessage' | 'id'>): { message: string; appealPath: string } {
  const base = r.studentMessage.replace(/[.\s]+$/, '');
  return { message: `${base}. You can appeal from Profile > Restrictions.`, appealPath: `/my/restrictions/${r.id}/appeal` };
}

export function rowToRestriction(row: any): RestrictionRow {
  return {
    id: row.id, scope: row.scope, scopeValue: row.scope_value, studentId: row.student_id, studentMessage: row.student_message,
    status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, exemptStudentIds: row.exempt_student_ids || [],
  };
}

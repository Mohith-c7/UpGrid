import { z } from 'zod';
import type { Db } from '../db';
import type { AuthUser, Role } from '../context';
import { ApiError, forbidden, notFound } from '../errors';
import { formatPhone } from '../validation';
import { pipelinePool } from './policy';

// ------------------------------------------------------------------ recruiter permissions
export const PERMISSION_KEYS = [
  'viewCandidates', 'shortlist', 'notes', 'scorecards', 'proposeSlots', 'proposeOutcomes', 'proposeOffers',
  'uploadResults', 'markAttendance', 'message',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Permissions = Record<PermissionKey, boolean>;
export const DEFAULT_PERMISSIONS: Permissions = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as Permissions;

export const permissionsSchema = z.object(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean({ message: 'Must be true or false' })])) as Record<PermissionKey, z.ZodBoolean>)
  .partial().strict();

export function normalizePermissions(stored: unknown): Permissions {
  const out = { ...DEFAULT_PERMISSIONS };
  if (stored && typeof stored === 'object') for (const k of PERMISSION_KEYS) if (typeof (stored as any)[k] === 'boolean') out[k] = (stored as any)[k];
  return out;
}

// ------------------------------------------------------------------ per-drive pipeline settings
export interface PipelineSettings { autoAcceptSlotProposals: boolean; showUnscreened: boolean; slotCancelCutoffMinutes: number; blindScorecards: boolean }
export const DEFAULT_SETTINGS: PipelineSettings = { autoAcceptSlotProposals: false, showUnscreened: false, slotCancelCutoffMinutes: 120, blindScorecards: true };
export const settingsSchema = z.object({
  autoAcceptSlotProposals: z.boolean(),
  showUnscreened: z.boolean(),
  slotCancelCutoffMinutes: z.number().int().min(0).max(10080),
  blindScorecards: z.boolean(),
}).partial().strict();

export async function getSettings(db: Db, driveId: string): Promise<PipelineSettings> {
  const r = await db.query('SELECT settings FROM drive_pipeline_settings WHERE drive_id=$1', [driveId]);
  const parsed = settingsSchema.safeParse(r.rows[0]?.settings ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

// ------------------------------------------------------------------ drive-level access
export interface DriveAccess { drive: any; role: Role; permissions: Permissions | null; userId: string; tenantId: string }

export async function getMembership(db: Db, tenantId: string, userId: string, driveId: string) {
  const r = await db.query(
    `SELECT cr.* FROM company_recruiters cr JOIN users u ON u.id=cr.user_id AND u.deleted_at IS NULL
      WHERE cr.drive_id=$1 AND cr.user_id=$2 AND cr.tenant_id=$3 AND cr.revoked_at IS NULL`,
    [driveId, userId, tenantId],
  );
  return r.rows[0] as { permissions: unknown } | undefined;
}

/**
 * Loads a drive for the caller. Officers: any drive of their tenant. Recruiters: only drives with an active membership
 * (anything else is a 404 so ids cannot be probed) and, when `permission` is given, that permission. Students never pass.
 */
export async function loadDriveAccess(db: Db, user: AuthUser, driveId: string, permission?: PermissionKey, opts: { lock?: boolean } = {}): Promise<DriveAccess> {
  if (user.role === 'student') throw forbidden('Student accounts cannot use this endpoint');
  const drive = (await db.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2 ${opts.lock ? 'FOR SHARE' : ''}`, [driveId, user.tenantId])).rows[0];
  const nf = () => notFound('Drive not found', 'DRIVE_NOT_FOUND');
  if (!drive) throw nf();
  if (user.role === 'officer') return { drive, role: 'officer', permissions: null, userId: user.id, tenantId: user.tenantId };
  if (user.role !== 'recruiter' || drive.status === 'draft') throw nf();
  const m = await getMembership(db, user.tenantId, user.id, driveId);
  if (!m) throw nf();
  const permissions = normalizePermissions(m.permissions);
  if (permission && !permissions[permission]) throw new ApiError(403, 'PERMISSION_DENIED', 'Your access to this drive does not include this action', { permission });
  if (!permissions.viewCandidates && permission !== undefined && permission !== 'message') {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Your access to this drive does not include this action', { permission: 'viewCandidates' });
  }
  return { drive, role: 'recruiter', permissions, userId: user.id, tenantId: user.tenantId };
}

export const officerOnly = (a: DriveAccess) => {
  if (a.role !== 'officer') throw forbidden('Placement officer access required');
};

// ------------------------------------------------------------------ candidate access
export const SHARED_KEYS = [
  'name', 'email', 'phone', 'registrationNumber', 'department', 'program', 'batchYear', 'cgpa', 'cgpaScale',
  'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'gapYears', 'linkedin',
] as const;

/** SQL predicate for applications a recruiter may see (alias `a`). */
export const recruiterVisibleSql = (showUnscreened: boolean) =>
  `a.status <> 'withdrawn' ${showUnscreened ? '' : "AND a.status <> 'submitted'"} AND EXISTS (SELECT 1 FROM users su WHERE su.id=a.user_id AND su.deleted_at IS NULL)`;

export interface CandidateAccess {
  allowed: boolean;
  reason?: string;
  role: Role | null;
  tenantId?: string;
  driveId?: string;
  studentId?: string;
  sharedFieldKeys: string[];
}
const deny = (reason: string, role: Role | null = null): CandidateAccess => ({ allowed: false, reason, role, sharedFieldKeys: [] });

/**
 * Single choke point for "may this user look at this application?". The AI module must call it before using any
 * candidate data. Officers: own tenant. Students: own application only. Recruiters: active membership of the drive,
 * viewCandidates permission, application not withdrawn / (unscreened unless enabled) / student not deleted.
 */
export async function canAccessCandidate(userId: string, applicationId: string, db?: Db): Promise<CandidateAccess> {
  const d = db ?? pipelinePool();
  if (!/^[0-9a-f-]{36}$/i.test(String(applicationId)) || !/^[0-9a-f-]{36}$/i.test(String(userId))) return deny('invalid_id');
  const u = (await d.query('SELECT id, tenant_id, role FROM users WHERE id=$1 AND deleted_at IS NULL', [userId])).rows[0];
  if (!u) return deny('unknown_user');
  const a = (await d.query('SELECT id, tenant_id, drive_id, user_id, status FROM applications WHERE id=$1', [applicationId])).rows[0];
  if (!a || a.tenant_id !== u.tenant_id) return deny('not_found', u.role);
  const base = { role: u.role as Role, tenantId: a.tenant_id as string, driveId: a.drive_id as string, studentId: a.user_id as string };
  const keys = (await d.query('SELECT field_keys FROM application_shared_fields WHERE application_id=$1', [a.id])).rows[0]?.field_keys ?? [];
  if (u.role === 'officer') return { allowed: true, ...base, sharedFieldKeys: [...SHARED_KEYS] };
  if (u.role === 'student') return a.user_id === u.id ? { allowed: true, ...base, sharedFieldKeys: [...SHARED_KEYS] } : { ...deny('not_owner', 'student') };
  if (u.role !== 'recruiter') return deny('role_not_allowed', u.role);
  const m = await getMembership(d, a.tenant_id, u.id, a.drive_id);
  if (!m) return deny('not_assigned', 'recruiter');
  if (!normalizePermissions(m.permissions).viewCandidates) return deny('no_permission', 'recruiter');
  if (a.status === 'withdrawn') return deny('withdrawn', 'recruiter');
  const dr = (await d.query('SELECT status FROM drives WHERE id=$1', [a.drive_id])).rows[0];
  if (!dr || dr.status === 'draft') return deny('not_found', 'recruiter');
  if (a.status === 'submitted' && !(await getSettings(d, a.drive_id)).showUnscreened) return deny('not_screened', 'recruiter');
  const stu = (await d.query('SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL', [a.user_id])).rowCount;
  if (!stu) return deny('student_inactive', 'recruiter');
  return { allowed: true, ...base, sharedFieldKeys: keys };
}
/** Bound variant: `makeAccess(pool).canAccessCandidate(userId, applicationId)`. */
export const makeAccess = (db: Db) => ({ canAccessCandidate: (userId: string, applicationId: string) => canAccessCandidate(userId, applicationId, db) });

// ------------------------------------------------------------------ shared-field view
export interface ResumeView { label: string | null; url: string | null; signed: boolean; expiresAt: string | null }
export type ResumeSigner = (url: string, ctx: { applicationId: string; viewerId: string; fileId?: string | null }) => Promise<{ url: string; expiresAt?: Date | string | null }>;
let signer: ResumeSigner | null = null;
/** The files module registers its signed-URL helper here; without one the saved https link is returned. */
export function setResumeSigner(fn: ResumeSigner | null) { signer = fn; }

export async function resolveResume(snapshot: any, ctx: { applicationId: string; viewerId: string }): Promise<ResumeView> {
  const url: string | null = snapshot?.url ?? null;
  const label: string | null = snapshot?.label ?? null;
  const fileId: string | null = snapshot?.fileId ?? snapshot?.file_id ?? null;
  if (!url && !fileId) return { label, url: null, signed: false, expiresAt: null };
  let fn = signer;
  if (!fn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../files');
      const cand = mod?.signedUrlForResume ?? mod?.getSignedUrl ?? mod?.createSignedUrl;
      if (typeof cand === 'function') fn = async (u) => { const r = await cand(u); return typeof r === 'string' ? { url: r } : r; };
    } catch { /* files module not installed */ }
  }
  if (fn) {
    try {
      const s = await fn(url ?? '', { ...ctx, fileId });
      return { label, url: s.url, signed: true, expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null };
    } catch { /* fall back to the saved link */ }
  }
  return { label, url, signed: false, expiresAt: null };
}

export interface SharedCandidate {
  applicationId: string;
  driveId: string;
  reference: string;
  fieldKeys: string[];
  fields: Record<string, unknown>;
  verification: Record<string, string>;
  resume: { label: string | null; url: string | null };
  answers: { id: string; label: string; value: unknown }[];
}

/** The only candidate data a recruiter-facing feature (UI or AI) may use. Call canAccessCandidate first. */
export async function getSharedCandidate(applicationId: string, db?: Db): Promise<SharedCandidate | null> {
  const d = db ?? pipelinePool();
  const a = (await d.query(
    `SELECT a.id, a.drive_id, a.reference, a.snapshot, a.resume_snapshot, a.answers, dr.questions, sf.field_keys, sf.data, sf.verification
       FROM applications a JOIN drives dr ON dr.id=a.drive_id LEFT JOIN application_shared_fields sf ON sf.application_id=a.id WHERE a.id=$1`, [applicationId])).rows[0];
  if (!a) return null;
  const data: Record<string, unknown> = a.data ?? Object.fromEntries(Object.entries(a.snapshot?.student ?? {}).filter(([k]) => (SHARED_KEYS as readonly string[]).includes(k)));
  const keys: string[] = a.field_keys ?? Object.keys(data);
  const fields: Record<string, unknown> = {};
  for (const k of keys) if ((SHARED_KEYS as readonly string[]).includes(k)) fields[k] = data[k] ?? null;
  if (typeof fields.phone === 'string' && /^\d{10}$/.test(fields.phone as string)) fields.phoneDisplay = formatPhone(fields.phone as string);
  const answers = ((a.questions as any[]) || []).filter((q) => q?.id in (a.answers || {})).map((q) => ({ id: q.id, label: q.label, value: a.answers[q.id] }));
  return {
    applicationId: a.id, driveId: a.drive_id, reference: a.reference, fieldKeys: keys, fields,
    verification: Object.fromEntries(Object.entries(a.verification ?? a.snapshot?.student?.verification ?? {}).filter(([k]) => keys.includes(k.split('.').pop() as string) || k.startsWith('academics.') || k.startsWith('identity.')) as [string, string][]),
    resume: { label: a.resume_snapshot?.label ?? null, url: a.resume_snapshot?.url ?? null },
    answers,
  };
}

/** Loads one application of a drive for a caller with drive access, enforcing recruiter visibility rules. */
export async function loadVisibleApplication(db: Db, access: DriveAccess, applicationId: string, opts: { lock?: boolean } = {}) {
  const a = (await db.query(
    `SELECT a.* FROM applications a WHERE a.id=$1 AND a.drive_id=$2 AND a.tenant_id=$3 ${opts.lock ? 'FOR UPDATE OF a' : ''}`,
    [applicationId, access.drive.id, access.tenantId],
  )).rows[0];
  const nf = () => notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  if (!a) throw nf();
  if (access.role === 'recruiter') {
    const st = await getSettings(db, access.drive.id);
    const stu = (await db.query('SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL', [a.user_id])).rowCount;
    if (a.status === 'withdrawn' || (a.status === 'submitted' && !st.showUnscreened) || !stu) throw nf();
  }
  return a;
}

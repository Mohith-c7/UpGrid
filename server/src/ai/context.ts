import type { Pool } from 'pg';
import { eligibilityFor, toCompany, toCtc, effectiveStatus } from '../drives';
import { getProfileRow } from '../profile';
import { ApiError, notFound } from '../errors';
import { cleanText, redactPii } from './sanitize';
import type { AiUser } from './service';

const istFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const ist = (d: Date | string | null) => (d ? `${istFmt.format(new Date(d))} IST` : null);

export interface StudentProfileSummary {
  university?: string; department?: string; program?: string; batchYear?: number; semester?: number;
  cgpa?: number; cgpaScale?: number; tenthPercent?: number; twelfthPercent?: number; activeBacklogs?: number; gapYears?: number;
  skills: string[]; preferredRoles: string[]; preferredLocations: string[]; workMode?: string;
}

/** Minimised profile: no name, email, phone, registration number, links or address. */
export function profileSummary(data: any): StudentProfileSummary {
  const a = data?.academics || {};
  const pick = <T,>(v: T | null | undefined) => (v === null || v === undefined ? undefined : v);
  return {
    university: pick(a.university), department: pick(a.department), program: pick(a.program), batchYear: pick(a.batchYear), semester: pick(a.semester),
    cgpa: pick(a.cgpa), cgpaScale: pick(a.cgpaScale), tenthPercent: pick(a.tenthPercent), twelfthPercent: pick(a.twelfthPercent),
    activeBacklogs: pick(a.activeBacklogs), gapYears: pick(a.gapYears),
    skills: Array.isArray(data?.skills) ? data.skills.slice(0, 30) : [],
    preferredRoles: data?.preferences?.roles || [], preferredLocations: data?.preferences?.locations || [], workMode: pick(data?.preferences?.workMode),
  };
}

const driveFact = (row: any, elig: any, now: Date) => ({
  company: toCompany(row.company).name, role: row.role, workMode: row.work_mode, locations: row.locations || [],
  ctc: toCtc(row.ctc), deadline: ist(row.deadline), status: effectiveStatus(row, now),
  requirements: (row.requirements || []).slice(0, 10),
  eligibility: elig ? {
    status: elig.status,
    reasons: elig.reasons.map((r: any) => ({ criterion: r.label, required: r.required, actual: r.actual, met: r.met })),
  } : undefined,
});

export interface StudentContext {
  /** JSON facts block (authoritative, deterministic) */
  facts: Record<string, unknown>;
  /** untrusted text from officers (JD of the focus drive) */
  jd: string | null;
  used: { profile: boolean; drives: number; applications: number; schedule: number };
}

export async function buildStudentContext(pool: Pool, user: AiUser, opts: { consented: boolean; driveId?: string | null }): Promise<StudentContext> {
  const now = new Date();
  const used = { profile: false, drives: 0, applications: 0, schedule: 0 };
  const facts: Record<string, unknown> = { nowIst: ist(now), appliesToCurrentStudentOnly: true };
  let jd: string | null = null;

  const profile = opts.consented ? await getProfileRow(pool, user.id) : null;
  if (profile) {
    facts.studentProfile = profileSummary(profile.data);
    used.profile = true;
  }

  // open drives (+ focus drive in any published state)
  const params: unknown[] = [user.tenantId];
  let focusSql = '';
  if (opts.driveId) { params.push(opts.driveId); focusSql = ` OR d.id=$2`; }
  const drives = (await pool.query(
    `SELECT d.* FROM drives d WHERE d.tenant_id=$1 AND d.status <> 'draft' AND ((d.status='open' AND d.deadline > now())${focusSql})
      ORDER BY (d.id = ${opts.driveId ? '$2' : 'NULL'}) DESC NULLS LAST, d.deadline ASC LIMIT 12`, params)).rows;
  if (opts.driveId && !drives.find((d) => d.id === opts.driveId)) throw notFound('Drive not found');
  facts.drives = drives.map((d) => ({ ...driveFact(d, profile ? eligibilityFor(d, profile) : null, now), isFocus: d.id === opts.driveId }));
  used.drives = drives.length;
  const focus = drives.find((d) => d.id === opts.driveId);
  if (focus?.jd) jd = focus.jd;

  if (opts.consented) {
    const apps = (await pool.query(
      `SELECT a.id, a.status, a.submitted_at, d.company, d.role, d.ctc, d.deadline
         FROM applications a JOIN drives d ON d.id=a.drive_id WHERE a.user_id=$1 AND a.tenant_id=$2 AND a.status <> 'withdrawn'
        ORDER BY a.submitted_at DESC LIMIT 15`, [user.id, user.tenantId])).rows;
    facts.applications = apps.map((a) => ({ company: toCompany(a.company).name, role: a.role, status: a.status, appliedAt: ist(a.submitted_at) }));
    facts.offers = apps.filter((a) => ['selected', 'offer_issued', 'offer_accepted', 'offer_declined'].includes(a.status))
      .map((a) => ({ company: toCompany(a.company).name, role: a.role, status: a.status, ctc: toCtc(a.ctc) }));
    used.applications = apps.length;
    const sch = (await pool.query(
      `SELECT s.type, s.scheduled_at, s.mode, d.company, d.role FROM application_schedules s
         JOIN applications a ON a.id=s.application_id JOIN drives d ON d.id=a.drive_id
        WHERE a.user_id=$1 AND s.tenant_id=$2 AND s.superseded_at IS NULL AND s.scheduled_at > now() ORDER BY s.scheduled_at LIMIT 10`, [user.id, user.tenantId])).rows;
    facts.upcomingSchedule = sch.map((s) => ({ type: s.type, at: ist(s.scheduled_at), mode: s.mode, company: toCompany(s.company).name, role: s.role }));
    used.schedule = sch.length;
    facts.upcomingDeadlinesNote = 'Drive deadlines are in the drives list; only open drives are listed.';
  }
  return { facts, jd, used };
}

export interface CandidateData {
  applicationId: string; driveId: string; tenantId: string; studentUserId: string;
  drive: { company: string; role: string; jd: string; requirements: string[]; rounds: string[] };
  shared: { department?: string; program?: string; batchYear?: number; cgpa?: number; cgpaScale?: number; skills: string[]; answers: Record<string, string> };
  resumeFileId: string | null;
  names: string[]; registrationNumber: string | null; email: string | null; phone: string | null;
}

/** Shared application data only. Callers must have passed canAccessCandidate() first. */
export async function loadCandidate(pool: Pool, tenantId: string, applicationId: string): Promise<CandidateData> {
  const r = await pool.query(
    `SELECT a.id, a.drive_id, a.user_id, a.answers, a.snapshot, a.resume_snapshot, d.company, d.role, d.jd, d.requirements, d.rounds, d.questions
       FROM applications a JOIN drives d ON d.id=a.drive_id
      WHERE a.id=$1 AND a.tenant_id=$2`, [applicationId, tenantId]);
  const row = r.rows[0];
  if (!row) throw notFound('Application not found');
  const snap = row.snapshot?.student || {};
  const answers: Record<string, string> = {};
  for (const q of row.questions || []) {
    const v = row.answers?.[q.id];
    if (q.type === 'declaration' || v === undefined || v === null) continue;
    answers[String(q.label).slice(0, 120)] = cleanText(Array.isArray(v) ? v.join(', ') : String(v), 500);
  }
  return {
    applicationId: row.id, driveId: row.drive_id, tenantId, studentUserId: row.user_id,
    drive: {
      company: toCompany(row.company).name, role: row.role, jd: row.jd || '',
      requirements: row.requirements || [], rounds: (row.rounds || []).map((x: any) => x.name),
    },
    shared: {
      department: snap.department ?? undefined, program: snap.program ?? undefined, batchYear: snap.batchYear ?? undefined,
      cgpa: snap.cgpa ?? undefined, cgpaScale: snap.cgpaScale ?? undefined,
      // skills are NOT part of the apply-time shared snapshot (pipeline rule: never the live profile); they only appear via the resume
      skills: [], answers,
    },
    resumeFileId: row.resume_snapshot?.fileId || row.resume_snapshot?.file_id || null,
    names: [snap.name].filter(Boolean),
    registrationNumber: snap.registrationNumber ?? null, email: snap.email ?? null, phone: snap.phone ?? null,
  };
}

export const redactFor = (text: string, c: Pick<CandidateData, 'names' | 'registrationNumber' | 'email' | 'phone'>) =>
  redactPii(text, { names: c.names, registrationNumber: c.registrationNumber, email: c.email, phone: c.phone });

export function assertStaff(user: AiUser) {
  if (user.role !== 'officer' && user.role !== 'recruiter') throw new ApiError(403, 'FORBIDDEN', 'This tool is for placement officers and recruiters');
}

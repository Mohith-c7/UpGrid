import { z } from 'zod';
import type { Db } from './db';
import {
  backlogsSchema, batchYearSchema, cgpaSchema, gapYearsSchema, githubSchema, httpsUrlSchema, linkedinSchema,
  nameSchema, percentSchema, regNoSchema, semesterSchema, textSchema, validateCgpa,
} from './validation';
import { ApiError, conflict } from './errors';

export const ACADEMIC_FIELDS = [
  'university', 'department', 'program', 'batchYear', 'semester', 'cgpa', 'cgpaScale',
  'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'gapYears',
] as const;
/** fields an officer can verify and that reset when edited */
export const VERIFIABLE = new Set<string>([
  ...ACADEMIC_FIELDS.map((f) => `academics.${f}`),
  'identity.registrationNumber',
]);

const nul = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const profilePatchSchema = z
  .object({
    identity: z.object({
      registrationNumber: z.preprocess(emptyToNull, nul(regNoSchema)),
      preferredName: z.preprocess(emptyToNull, nul(nameSchema)),
    }).strict().optional(),
    academics: z.object({
      university: z.preprocess(emptyToNull, nul(textSchema(120))),
      department: z.preprocess(emptyToNull, nul(textSchema(80))),
      program: z.preprocess(emptyToNull, nul(textSchema(80))),
      batchYear: nul(batchYearSchema),
      semester: nul(semesterSchema),
      cgpa: nul(cgpaSchema(10)),
      cgpaScale: nul(z.union([z.literal(4), z.literal(5), z.literal(10)], { message: 'CGPA scale must be 4, 5 or 10' })),
      tenthPercent: nul(percentSchema),
      twelfthPercent: nul(percentSchema),
      activeBacklogs: nul(backlogsSchema),
      gapYears: nul(gapYearsSchema),
    }).strict().optional(),
    contact: z.object({
      city: z.preprocess(emptyToNull, nul(textSchema(60))),
      state: z.preprocess(emptyToNull, nul(textSchema(60))),
    }).strict().optional(),
    links: z.object({
      linkedin: z.preprocess(emptyToNull, nul(linkedinSchema)),
      github: z.preprocess(emptyToNull, nul(githubSchema)),
      portfolio: z.preprocess(emptyToNull, nul(httpsUrlSchema)),
    }).strict().optional(),
    skills: z.array(textSchema(40, 1)).max(30).optional(),
    preferences: z.object({
      roles: z.array(textSchema(60, 1)).max(10).optional(),
      locations: z.array(textSchema(60, 1)).max(10).optional(),
      workMode: nul(z.enum(['onsite', 'hybrid', 'remote', 'any'])),
      relocate: nul(z.boolean()),
    }).strict().optional(),
  })
  .strict();

export type ProfileData = {
  identity?: Record<string, any>;
  academics?: Record<string, any>;
  contact?: Record<string, any>;
  links?: Record<string, any>;
  skills?: string[];
  preferences?: Record<string, any>;
};

export interface ProfileRow {
  data: ProfileData;
  verification: Record<string, string>;
}

export async function getProfileRow(db: Db, userId: string): Promise<ProfileRow> {
  const r = await db.query('SELECT data, verification FROM profiles WHERE user_id=$1', [userId]);
  if (!r.rows[0]) return { data: {}, verification: {} };
  return { data: r.rows[0].data || {}, verification: r.rows[0].verification || {} };
}

export interface CompletionItem { key: string; label: string; done: boolean; why: string }
export interface Completion { percent: number; items: CompletionItem[]; nextStep: string | null }

const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

export function computeCompletion(data: ProfileData, resumeCount: number, hasPhone = true): Completion {
  const a = data.academics || {};
  const items: CompletionItem[] = [
    { key: 'phone', label: 'Mobile number', done: hasPhone, why: 'The placement cell and recruiters use it to reach you' },
    { key: 'registrationNumber', label: 'Registration number', done: filled(data.identity?.registrationNumber), why: 'Placement cell uses it to verify you' },
    { key: 'department', label: 'Department and program', done: filled(a.department) && filled(a.program), why: 'Many drives are open only to specific departments' },
    { key: 'batchYear', label: 'Batch year', done: filled(a.batchYear), why: 'Drives are limited to specific batches' },
    { key: 'cgpa', label: 'CGPA', done: filled(a.cgpa), why: 'Needed to check minimum CGPA criteria' },
    { key: 'tenthTwelfth', label: '10th and 12th percentage', done: filled(a.tenthPercent) && filled(a.twelfthPercent), why: 'Companies often set school-level cutoffs' },
    { key: 'backlogsGap', label: 'Backlogs and gap years', done: filled(a.activeBacklogs) && filled(a.gapYears), why: 'Used for eligibility checks' },
    { key: 'city', label: 'City and state', done: filled(data.contact?.city) && filled(data.contact?.state), why: 'Helps match location preferences' },
    { key: 'linkedin', label: 'LinkedIn link', done: filled(data.links?.linkedin), why: 'Recruiters often check it' },
    { key: 'skills', label: 'Skills', done: filled(data.skills), why: 'Shown to recruiters with your application' },
    { key: 'preferences', label: 'Job preferences', done: filled(data.preferences?.roles) || filled(data.preferences?.workMode), why: 'Tell us the roles you want' },
    { key: 'resume', label: 'Resume link', done: resumeCount > 0, why: 'You need a resume to apply' },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done);
  return { percent: Math.round((doneCount / items.length) * 100), items, nextStep: next ? next.label : null };
}

export async function countResumes(db: Db, userId: string): Promise<number> {
  const r = await db.query('SELECT count(*)::int AS n FROM resumes WHERE user_id=$1', [userId]);
  return r.rows[0].n;
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Applies a validated patch; returns new data and verification maps. Pure. */
export function applyPatch(
  current: ProfileRow,
  patch: z.infer<typeof profilePatchSchema>,
): ProfileRow {
  const data: ProfileData = JSON.parse(JSON.stringify(current.data || {}));
  const ver = { ...(current.verification || {}) };
  for (const section of ['identity', 'academics', 'contact', 'links', 'preferences'] as const) {
    const p = (patch as any)[section] as Record<string, unknown> | undefined;
    if (!p) continue;
    const target = ((data as any)[section] ||= {});
    for (const [field, value] of Object.entries(p)) {
      if (value === undefined) continue;
      const key = `${section}.${field}`;
      const before = target[field];
      if (value === null) {
        delete target[field];
        delete ver[key];
        continue;
      }
      target[field] = value;
      if (section === 'preferences') continue;
      if (VERIFIABLE.has(key)) {
        if (!sameValue(before, value)) ver[key] = 'unverified'; // edit resets verification
        else ver[key] = ver[key] || 'unverified';
      } else {
        ver[key] = 'student_confirmed';
      }
    }
  }
  if (patch.skills) data.skills = Array.from(new Set(patch.skills));
  return { data, verification: ver };
}

/** Cross-field checks (cgpa against scale). Returns field errors. */
export function crossValidate(data: ProfileData, patch: z.infer<typeof profilePatchSchema>): Record<string, string> {
  const errs: Record<string, string> = {};
  const touched = patch.academics && ('cgpa' in patch.academics || 'cgpaScale' in patch.academics);
  if (touched && data.academics?.cgpa !== undefined && data.academics?.cgpa !== null) {
    const r = validateCgpa(data.academics.cgpa, data.academics.cgpaScale || 10);
    if (!r.ok) errs['academics.cgpa'] = r.message;
  }
  return errs;
}

export async function saveProfile(
  db: Db, tenantId: string, userId: string, row: ProfileRow,
): Promise<void> {
  await db.query(
    `INSERT INTO profiles (user_id, tenant_id, data, verification, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, verification=EXCLUDED.verification, updated_at=now()`,
    [userId, tenantId, JSON.stringify(row.data), JSON.stringify(row.verification)],
  );
}

export async function assertRegNoFree(db: Db, tenantId: string, userId: string, regNo: string) {
  const r = await db.query(
    `SELECT 1 FROM profiles WHERE tenant_id=$1 AND user_id<>$2 AND data->'identity'->>'registrationNumber'=$3 LIMIT 1`,
    [tenantId, userId, regNo],
  );
  if (r.rowCount) throw conflict('REG_NO_TAKEN', 'This registration number is already linked to another account', { 'identity.registrationNumber': 'Already in use' });
}

export { ApiError };

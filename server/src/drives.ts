import { z } from 'zod';
import { evaluateEligibility, DriveRules, EligibilityResult } from './eligibility';
import { emailSchema, httpsUrlSchema, phoneSchema, textSchema } from './validation';
import type { ProfileData } from './profile';
import { buildConditionContext, composeExtra, validateConditions } from './policy/conditions';

export const QUESTION_TYPES = [
  'short_text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'yes_no', 'url', 'declaration',
] as const;
export const SAVE_TO_PROFILE_KEYS = [
  'contact.city', 'contact.state', 'links.linkedin', 'links.github', 'links.portfolio', 'preferences.workMode',
] as const;

const optNum = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();
const iso = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });

export const questionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Question id may use letters, numbers, _ and -').optional(),
    label: textSchema(200, 1),
    type: z.enum([...QUESTION_TYPES], { message: `Type must be one of ${QUESTION_TYPES.join(', ')}` }),
    required: z.boolean().default(false),
    options: z.array(textSchema(100, 1)).max(20).default([]),
    maxLength: z.number().int().min(1).max(5000).optional(),
    helpText: textSchema(300).optional(),
    saveToProfileKey: z.enum([...SAVE_TO_PROFILE_KEYS]).optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if ((q.type === 'single_select' || q.type === 'multi_select') && q.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Select questions need at least 2 options' });
    }
  });

const rulesSchema = z
  .object({
    minCgpa: optNum(0, 10),
    min10th: optNum(0, 100),
    min12th: optNum(0, 100),
    maxActiveBacklogs: z.number().int().min(0).max(50).nullable().optional(),
    maxGapYears: z.number().int().min(0).max(10).nullable().optional(),
    allowedDepartments: z.array(textSchema(80, 1)).max(30).optional(),
    allowedBatches: z.array(z.number().int().min(2020).max(2040)).max(10).optional(),
    // nested AND / OR / NOT conditions (see policy/conditions.ts)
    extra: z.unknown().superRefine((v, ctx) => {
      if (v === undefined || v === null) return;
      for (const e of validateConditions(v).errors) ctx.addIssue({ code: 'custom', message: `${e.path}: ${e.message}` });
    }).optional(),
  })
  .strict();

const draftBase = z.object({
  company: z
    .object({
      name: textSchema(80, 1),
      logoUrl: httpsUrlSchema.nullable().optional(),
      /** a ready `company_logo` file (see docs/integrations-api.md); the server derives logoUrl from it */
      logoFileId: z.string().uuid('logoFileId must be a UUID').nullable().optional(),
      industry: textSchema(60).optional(),
      verified: z.boolean().optional(),
    })
    .strict(),
  role: textSchema(100),
  workMode: z.enum(['onsite', 'hybrid', 'remote']),
  locations: z.array(textSchema(60, 1)).max(10),
  ctc: z
    .object({
      fixedLpa: optNum(0, 100000),
      variableLpa: optNum(0, 1000),
      bonusLpa: optNum(0, 1000),
      esopNote: textSchema(200).nullable().optional(),
      breakdownProvided: z.boolean().optional(),
      kind: z.enum(['annual', 'stipend_monthly']).optional(),
    })
    .strict(),
  deadline: iso,
  jd: textSchema(5000),
  requirements: z.array(textSchema(200, 1)).max(20),
  rounds: z.array(z.object({ name: textSchema(60, 1), description: textSchema(300).optional(), mode: textSchema(40).optional() }).strict()).max(10),
  questions: z.array(questionSchema).max(15),
  policyNote: textSchema(1000),
  contact: z.object({ name: textSchema(80).optional(), email: emailSchema.optional(), phone: phoneSchema.optional() }).strict(),
  rules: rulesSchema,
  lastVerifiedAt: iso.nullable(),
});

export const driveCreateSchema = draftBase.partial().strict();
export const driveUpdateSchema = draftBase.partial().strict();
export type DriveInput = z.infer<typeof driveCreateSchema>;

export function normalizeQuestions(qs: z.infer<typeof questionSchema>[]) {
  const seen = new Set<string>();
  return qs.map((q, i) => {
    let id = q.id || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    return { ...q, id };
  });
}

export function effectiveStatus(row: { status: string; deadline: Date | string | null }, now: Date): 'draft' | 'open' | 'closing' | 'closed' {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'closed') return 'closed';
  const dl = row.deadline ? new Date(row.deadline).getTime() : 0;
  if (dl <= now.getTime()) return 'closed';
  if (dl - now.getTime() <= 24 * 3600 * 1000) return 'closing';
  return 'open';
}

export function toCompany(c: any) {
  return { name: c?.name || '', logoUrl: c?.logoUrl ?? null, industry: c?.industry || '', verified: !!c?.verified };
}
export function toCtc(c: any) {
  return {
    fixedLpa: c?.fixedLpa ?? null,
    variableLpa: c?.variableLpa ?? null,
    bonusLpa: c?.bonusLpa ?? null,
    esopNote: c?.esopNote ?? null,
    breakdownProvided: !!c?.breakdownProvided,
    kind: c?.kind || 'annual',
  };
}
export const totalPackage = (c: any) => (c?.fixedLpa || 0) + (c?.variableLpa || 0) + (c?.bonusLpa || 0);

export function driveListItem(row: any, now: Date, elig: EligibilityResult | null, saved: boolean, applied: boolean) {
  return {
    id: row.id,
    company: toCompany(row.company),
    role: row.role,
    workMode: row.work_mode,
    locations: row.locations || [],
    ctc: toCtc(row.ctc),
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    status: effectiveStatus(row, now),
    eligibility: elig ? { status: elig.status, reason: elig.reason } : null,
    saved,
    applied,
  };
}

export const DATA_SHARED = [
  'Name', 'Email', 'Mobile number', 'Registration number', 'Department and program', 'Batch year',
  'CGPA', '10th and 12th percentage', 'Backlogs and gap years', 'Resume link', 'Your answers to this drive’s questions',
];

export function driveDetail(row: any, now: Date, elig: EligibilityResult | null, saved: boolean, applied: boolean, officer: boolean) {
  return {
    ...driveListItem(row, now, elig, saved, applied),
    jd: row.jd,
    requirements: row.requirements || [],
    rounds: row.rounds || [],
    questions: row.questions || [],
    policyNote: row.policy_note,
    contact: row.contact || {},
    lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
    dataSharedPreview: DATA_SHARED,
    eligibilityReasons: elig ? elig.reasons : undefined,
    ...(officer ? { rules: row.rules || {}, rawStatus: row.status, publishedAt: row.published_at, createdAt: row.created_at } : {}),
  };
}

/** Publish completeness gate. Returns missing items keyed by field. */
export function completenessGaps(row: any, now: Date): Record<string, string> {
  const gaps: Record<string, string> = {};
  if (!row.company?.name) gaps['company.name'] = 'Company name is required';
  if (!row.role?.trim()) gaps.role = 'Role title is required';
  if (!row.work_mode) gaps.workMode = 'Work mode is required';
  if (!Array.isArray(row.locations) || row.locations.length === 0) gaps.locations = 'Add at least one location';
  const ctc = row.ctc || {};
  if (typeof ctc.fixedLpa !== 'number' || ctc.fixedLpa <= 0) gaps['ctc.fixedLpa'] = 'Fixed pay is required';
  if (!row.deadline) gaps.deadline = 'Application deadline is required';
  else if (new Date(row.deadline).getTime() <= now.getTime()) gaps.deadline = 'Deadline must be in the future';
  if (!row.jd || row.jd.trim().length < 20) gaps.jd = 'Add a job description (at least 20 characters)';
  if (!Array.isArray(row.rounds) || row.rounds.length === 0) gaps.rounds = 'Add at least one selection round';
  if (!row.contact?.name && !row.contact?.email && !row.contact?.phone) gaps.contact = 'Add a contact person for queries';
  if (!row.rules || Object.keys(row.rules).length === 0) gaps.rules = 'Set at least one eligibility rule';
  return gaps;
}

export function eligibilityFor(row: any, profile: { data?: ProfileData; verification?: Record<string, string> } | null) {
  const base = evaluateEligibility(row.rules as DriveRules, { academics: profile?.data?.academics, verification: profile?.verification });
  if (!row.rules?.extra) return base; // unchanged output when a drive has no extra conditions
  return composeExtra(base, row.rules.extra, buildConditionContext({
    academics: profile?.data?.academics, contact: profile?.data?.contact, skills: profile?.data?.skills, verification: profile?.verification,
  }));
}

export const DRIVE_COLUMNS = `d.*`;

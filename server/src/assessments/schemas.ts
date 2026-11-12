import { z } from 'zod';
import { cleanMultiline, cleanString } from '../validation';

export const QUESTION_TYPES = ['mcq_single', 'mcq_multi', 'numeric', 'short_text', 'coding'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const LANGUAGES = ['python3', 'java', 'cpp', 'c', 'javascript'] as const;
export type Language = (typeof LANGUAGES)[number];
export const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const MAX_CODE_CHARS = 32_000;
export const MAX_STDIN_CHARS = 10_000;

const NUL = /\u0000/;

/** single line, trimmed, no control characters */
export const line = (max: number, min = 0) =>
  z.any().transform((v, ctx) => {
    const r = cleanString(v, max);
    if (!r.ok) { ctx.addIssue({ code: 'custom', message: r.message }); return z.NEVER; }
    if (r.value.length < min) { ctx.addIssue({ code: 'custom', message: min === 1 ? 'This field is required' : `Must be at least ${min} characters` }); return z.NEVER; }
    return r.value;
  });
/** markdown / multi-line text (may be empty) */
export const multiline = (max: number, label = 'Text') =>
  z.any().transform((v, ctx) => {
    if (v === undefined || v === null || v === '') return '';
    const r = cleanMultiline(v, 0, max, label);
    if (!r.ok) { ctx.addIssue({ code: 'custom', message: r.message }); return z.NEVER; }
    return r.value;
  });
/** raw data (test inputs, code): any characters except NUL, length capped, no trimming */
export const raw = (max: number) =>
  z.string({ message: 'Must be text' }).max(max, `Must be at most ${max} characters`).refine((s) => !NUL.test(s), 'Contains invalid characters');

const marks = z.number({ message: 'Must be a number' }).min(0.25, 'At least 0.25').max(100, 'At most 100').refine((n) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'At most 2 decimals');
const negMarks = z.number({ message: 'Must be a number' }).min(0).max(100).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'At most 2 decimals');

export const optionSchema = z.object({ id: z.enum(OPTION_IDS, { message: 'Option id must be a-h' }), text: line(300, 1) }).strict();

const testCaseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  kind: z.enum(['sample', 'hidden'], { message: 'kind must be sample or hidden' }),
  input: raw(20_000),
  expectedOutput: raw(20_000),
  weight: z.number().int().min(0).max(100).default(1),
  explanation: multiline(1000).optional(),
}).strict();

export const codingSchema = z.object({
  constraints: multiline(5000).default(''),
  languages: z.array(z.enum(LANGUAGES, { message: `Language must be one of ${LANGUAGES.join(', ')}` })).min(1, 'Choose at least one language').max(5),
  timeLimitMs: z.number().int().min(100).max(15_000).default(2000),
  memoryLimitMb: z.number().int().min(16).max(512).default(256),
  compare: z.object({
    mode: z.enum(['tokens', 'lines']).default('tokens'),
    floatTolerance: z.number().min(0).max(1).optional(),
  }).strict().default({ mode: 'tokens' }),
  starterCode: z.record(z.string(), raw(MAX_CODE_CHARS)).default({}),
  referenceSolution: z.object({ language: z.enum(LANGUAGES), code: raw(MAX_CODE_CHARS) }).strict().optional(),
  testCases: z.array(testCaseSchema).min(1, 'Add at least one test case').max(60),
}).strict();

const answerSchema = z.object({
  correct: z.union([z.string(), z.array(z.string())]).optional(),
  value: z.number().finite().optional(),
  tolerance: z.number().min(0).optional(),
  accepted: z.array(line(200, 1)).max(20).optional(),
  mode: z.enum(['exact', 'regex']).optional(),
  caseSensitive: z.boolean().optional(),
}).strict();

export const questionInput = z.object({
  type: z.enum(QUESTION_TYPES, { message: `Type must be one of ${QUESTION_TYPES.join(', ')}` }),
  title: line(200, 1),
  body: multiline(20_000, 'Body'),
  topic: line(80).default(''),
  tags: z.array(line(40, 1)).max(10).default([]),
  difficulty: z.enum(DIFFICULTIES, { message: 'difficulty must be easy, medium or hard' }).default('medium'),
  marks,
  negativeMarks: negMarks.default(0),
  explanation: multiline(5000, 'Explanation').default(''),
  practice: z.boolean().default(false),
  options: z.array(optionSchema).max(8).default([]),
  answer: answerSchema.default({}),
  coding: codingSchema.nullable().optional(),
}).strict();
export type QuestionInput = z.infer<typeof questionInput>;

/** Cross-field validation shared by the bank, import and publish checks. Returns field-path -> message. */
export function validateQuestionShape(q: QuestionInput): Record<string, string> {
  const f: Record<string, string> = {};
  if (q.negativeMarks > q.marks) f.negativeMarks = 'Cannot exceed marks';
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    const ids = q.options.map((o) => o.id);
    if (q.options.length < 2) f.options = 'Add at least 2 options';
    else if (new Set(ids).size !== ids.length) f.options = 'Option ids must be unique';
    const c = q.answer.correct;
    if (q.type === 'mcq_single') {
      if (typeof c !== 'string') f['answer.correct'] = 'Choose the correct option';
      else if (!ids.includes(c as any)) f['answer.correct'] = 'Correct answer must be one of the options';
    } else {
      if (!Array.isArray(c) || c.length === 0) f['answer.correct'] = 'Choose at least one correct option';
      else if (new Set(c).size !== c.length || c.some((x) => !ids.includes(x as any))) f['answer.correct'] = 'Correct answers must be unique option ids';
    }
    if (q.coding) f.coding = 'Only coding questions have a coding section';
  } else if (q.type === 'numeric') {
    if (typeof q.answer.value !== 'number') f['answer.value'] = 'Enter the correct value';
    if (q.options.length) f.options = 'Numeric questions have no options';
  } else if (q.type === 'short_text') {
    if (!q.answer.accepted || q.answer.accepted.length === 0) f['answer.accepted'] = 'Add at least one accepted answer';
    else if (q.answer.mode === 'regex') {
      q.answer.accepted.forEach((p, i) => {
        const bad = regexProblem(p);
        if (bad) f[`answer.accepted.${i}`] = bad;
      });
    }
    if (q.options.length) f.options = 'Short-text questions have no options';
  } else if (q.type === 'coding') {
    if (!q.coding) { f.coding = 'Coding settings are required'; }
    else {
      const tc = q.coding.testCases;
      const total = tc.reduce((s, t) => s + t.weight, 0);
      if (total <= 0) f['coding.testCases'] = 'Total test weight must be greater than 0';
      for (const k of Object.keys(q.coding.starterCode)) if (!q.coding.languages.includes(k as Language)) f[`coding.starterCode.${k}`] = 'Not an allowed language';
      if (q.coding.referenceSolution && !q.coding.languages.includes(q.coding.referenceSolution.language)) f['coding.referenceSolution.language'] = 'Not an allowed language';
    }
    if (q.options.length) f.options = 'Coding questions have no options';
  }
  return f;
}

/** Cheap ReDoS guard: reject nested quantifiers, backreferences, lookbehind and over-long patterns. */
export function regexProblem(p: string): string | null {
  if (p.length > 200) return 'Pattern too long';
  if (/\\[1-9]|\(\?<[=!]/.test(p)) return 'Backreferences and lookbehind are not allowed';
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(p) || /\([^)]*\{\d+,\d*\}[^)]*\)[+*{]/.test(p)) return 'Nested quantifiers are not allowed';
  try { new RegExp(p); } catch { return 'Invalid regular expression'; }
  return null;
}

// ------------------------------------------------------------------ assessments
export const AUDIENCE_STATUSES = ['submitted', 'screening', 'assessment', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'offer_declined', 'rejected', 'joined'] as const;
const uuid = z.string().uuid('Must be a valid id');
export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('drive_applicants'), driveId: uuid.optional(), statuses: z.array(z.enum(AUDIENCE_STATUSES)).min(1, 'Choose at least one status').max(10) }).strict(),
  z.object({ type: z.literal('all_eligible'), driveId: uuid.optional() }).strict(),
  z.object({ type: z.literal('students'), studentIds: z.array(uuid).min(1).max(2000) }).strict(),
  z.object({ type: z.literal('cohort'), cohortId: line(80, 1) }).strict(),
  z.object({ type: z.literal('all_students') }).strict(),
]);
export type Audience = z.infer<typeof audienceSchema>;

const iso = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });

export const settingsSchema = z.object({
  randomiseQuestions: z.boolean(),
  randomiseOptions: z.boolean(),
  negativeMarking: z.boolean(),
  passCutoff: z.object({ type: z.enum(['marks', 'percent']), value: z.number().min(0).max(100000) }).strict().nullable(),
  resultVisibility: z.enum(['immediate', 'after_close', 'manual'], { message: 'resultVisibility must be immediate, after_close or manual' }),
  allowReview: z.boolean(),
  maxAttempts: z.number().int().min(1).max(10),
  rankingEnabled: z.boolean(),
  proctoring: z.object({ enabled: z.boolean(), maxWarnings: z.number().int().min(1).max(20), autoSubmit: z.boolean() }).strict(),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  randomiseQuestions: false, randomiseOptions: false, negativeMarking: false, passCutoff: null, resultVisibility: 'after_close',
  allowReview: false, maxAttempts: 1, rankingEnabled: true, proctoring: { enabled: false, maxWarnings: 3, autoSubmit: false },
};
export const settingsPatchSchema = settingsSchema.partial().extend({
  proctoring: settingsSchema.shape.proctoring.partial().optional(),
}).strict();

export function mergeSettings(stored: any, patch?: any): Settings {
  const base = { ...DEFAULT_SETTINGS, ...(stored || {}), proctoring: { ...DEFAULT_SETTINGS.proctoring, ...(stored?.proctoring || {}) } };
  if (!patch) return base;
  return { ...base, ...patch, proctoring: { ...base.proctoring, ...(patch.proctoring || {}) } };
}

const sectionQuestionInput = z.object({ questionId: uuid, marks: marks.optional(), negativeMarks: negMarks.optional() }).strict();
export const sectionInput = z.object({
  id: uuid.optional(),
  title: line(100, 1),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
  cutoffMarks: z.number().min(0).max(100000).nullable().optional(),
  questions: z.array(sectionQuestionInput).max(200),
}).strict();

export const assessmentInput = z.object({
  title: line(150, 1),
  instructions: multiline(10_000, 'Instructions'),
  driveId: uuid.nullable(),
  audience: audienceSchema.nullable(),
  opensAt: iso.nullable(),
  closesAt: iso.nullable(),
  durationMinutes: z.number().int().min(1).max(600).nullable(),
  practice: z.boolean(),
  settings: settingsPatchSchema,
  sections: z.array(sectionInput).max(20),
}).partial().strict();

import { z } from 'zod';
import { driveUpdateSchema } from '../drives';

const s = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number, itemMax = 300) => z.array(s(itemMax)).max(max).default([]);

// ---------------------------------------------------------------- eligibility rules (reuse the drive schema)
const rulesObj = (driveUpdateSchema.shape.rules as any).unwrap?.() ?? driveUpdateSchema.shape.rules;
export const eligibilityRulesSchema: z.ZodType<Record<string, unknown>> = rulesObj;
/** Keep only the rule fields that individually validate against the real eligibility schema. */
export function coerceRules(raw: unknown): { rules: Record<string, unknown>; dropped: string[] } {
  const rules: Record<string, unknown> = {};
  const dropped: string[] = [];
  const shape = (rulesObj as any).shape as Record<string, z.ZodType>;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
      if (!shape[k]) { dropped.push(k); continue; }
      const r = shape[k].safeParse(v);
      if (r.success && r.data !== undefined) rules[k] = r.data; else dropped.push(k);
    }
  }
  return { rules, dropped };
}

// ---------------------------------------------------------------- B. resume review
export const resumeReviewOut = z.object({
  score: z.number().int().min(0).max(100),
  strengths: list(8), gaps: list(8), ats_keywords_missing: list(15, 60),
  rewrite_suggestions: z.array(z.object({ section: s(60), before: s(600), after: s(800) })).max(8).default([]),
  jd_match: z.object({ matched_skills: list(20, 60), missing_skills: list(20, 60), percent: z.number().min(0).max(100) }).nullable().optional(),
});
export type ResumeReviewOut = z.infer<typeof resumeReviewOut>;

// ---------------------------------------------------------------- C. mock interview
export const mockQuestionOut = z.object({ question: s(600) });
export const mockAnswerOut = z.object({
  feedback: z.object({ summary: s(500), strengths: list(4, 200), improve: list(4, 200) }),
  score: z.number().min(0).max(10).transform((n) => Math.round(n)),
  next_question: z.string().trim().max(600).nullable().optional(),
});
const dim = z.object({ score: z.number().min(0).max(10).transform((n) => Math.round(n)), notes: s(500) });
export const mockReportOut = z.object({
  communication: dim, technical_depth: dim, structure_star: dim,
  per_question: z.array(z.object({ index: z.number().int().min(1).max(10), comment: s(400) })).max(10),
  top_tips: z.array(s(240)).min(1).max(6),
});

// ---------------------------------------------------------------- D. recruiter tools
export const SOURCES = ['resume', 'jd', 'skills', 'profile'] as const;
const evidence = z.object({ source: z.enum(SOURCES), quote: s(300) });
const rubric = z.object({ '1': s(240), '2': s(240), '3': s(240), '4': s(240), '5': s(240) });
export const questionItem = z.object({
  question: s(500), why_asked: s(400), evidence: evidence.nullable().optional(),
  expected_points: z.array(s(300)).min(1).max(8), follow_ups: z.array(s(300)).max(5).default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']), rubric,
});
export const interviewQuestionsOut = z.object({ questions: z.array(questionItem).min(1).max(15) });

/** The stored/edited shape (adds server fields). */
export const storedQuestion = questionItem.extend({
  id: z.string().min(1).max(40).optional(),
  evidence_verified: z.boolean().optional(),
});
export const storedQuestions = z.array(storedQuestion).min(1).max(15);

export const candidateSummaryOut = z.object({
  factual_summary: s(1500),
  skills_vs_jd: z.object({
    matched: z.array(z.object({ skill: s(60), citation: s(300) })).max(20).default([]),
    not_evidenced: list(20, 60),
  }),
  citations: z.array(evidence).max(15).default([]),
  notes: list(5, 240),
});

export const jdParseOut = z.object({
  role: s(100), company: z.string().trim().max(80).nullable().optional(),
  skills: list(25, 60), qualifications: list(15, 200), selection_process: list(10, 120),
  suggested_eligibility: z.record(z.string(), z.unknown()).default({}),
  eligibility_evidence: z.record(z.string(), z.string()).default({}),
  suggested_questions: z.array(z.object({
    label: s(200), type: z.string(), required: z.boolean().default(false), options: z.array(s(100)).max(20).default([]),
  })).max(8).default([]),
});

export const mcqOut = z.object({
  items: z.array(z.object({
    stem: s(500), options: z.array(s(200)).length(4), correct_index: z.number().int().min(0).max(3), explanation: s(600),
  }).superRefine((q, ctx) => {
    if (new Set(q.options.map((o) => o.toLowerCase())).size !== 4) ctx.addIssue({ code: 'custom', message: 'options must be distinct', path: ['options'] });
  })).min(1).max(10),
});

export const announcementOut = z.object({ title: s(120), body: s(1200) });
export const policyOut = z.object({
  rules: z.record(z.string(), z.unknown()).default({}),
  explanation: s(800),
  unsupported: list(10, 240),
});

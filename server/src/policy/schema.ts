import { z } from 'zod';

const pct = z.number().min(0).max(100).nullable();
const defaultsSchema = z.object({
  minCgpa: z.number().min(0).max(10).nullable().default(null),
  maxActiveBacklogs: z.number().int().min(0).max(50).nullable().default(null),
  maxGapYears: z.number().int().min(0).max(10).nullable().default(null),
  min10th: pct.default(null),
  min12th: pct.default(null),
}).strict();

export const policySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  oneOffer: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
  tiers: z.object({
    enabled: z.boolean().default(false),
    dreamMinLpa: z.number().positive().max(1000).default(10),
    superDreamMinLpa: z.number().positive().max(1000).default(20),
  }).strict().default({ enabled: false, dreamMinLpa: 10, superDreamMinLpa: 20 }),
  upgrade: z.object({
    enabled: z.boolean().default(false),
    multiplier: z.number().min(1.1).max(5).default(1.5),
  }).strict().default({ enabled: false, multiplier: 1.5 }),
  defaults: defaultsSchema.default({ minCgpa: null, maxActiveBacklogs: null, maxGapYears: null, min10th: null, min12th: null }),
  requireVerifiedAcademics: z.boolean().default(false),
  notes: z.string().max(1000).default(''),
}).strict().superRefine((p, ctx) => {
  if (p.tiers.superDreamMinLpa <= p.tiers.dreamMinLpa) {
    ctx.addIssue({ code: 'custom', path: ['tiers', 'superDreamMinLpa'], message: 'Super-dream threshold must be higher than dream threshold' });
  }
});

export type Policy = z.infer<typeof policySchema>;

export interface PolicyIssue { path: string; message: string }
export interface PolicyValidation { valid: boolean; errors: PolicyIssue[]; warnings: string[]; normalized: Policy | null }

export function validatePolicy(input: unknown): PolicyValidation {
  const r = policySchema.safeParse(input);
  if (!r.success) {
    return {
      valid: false, normalized: null, warnings: [],
      errors: r.error.issues.map((i) => ({ path: i.path.join('.') || '_', message: i.message })),
    };
  }
  const p = r.data;
  const warnings: string[] = [];
  if (p.upgrade.enabled && !p.oneOffer.enabled) warnings.push('Upgrade multiplier has no effect while the one-offer rule is off');
  if (p.tiers.enabled && !p.oneOffer.enabled) warnings.push('Dream / super-dream tiers have no effect while the one-offer rule is off');
  if (p.upgrade.enabled && p.tiers.enabled) warnings.push('Both upgrade multiplier and tiers are on: a student may apply if either allows it');
  if ((p.defaults.minCgpa ?? 0) > 9) warnings.push('Default minimum CGPA above 9 will exclude almost every student');
  return { valid: true, errors: [], warnings, normalized: p };
}

export const EMPTY_POLICY: Policy = policySchema.parse({});

export interface PolicyTemplate { id: string; name: string; description: string; policy: Policy }
const mk = (over: Record<string, unknown>) => policySchema.parse(over);
export const POLICY_TEMPLATES: PolicyTemplate[] = [
  { id: 'one-offer', name: 'One offer policy', description: 'A student with an accepted offer cannot apply to further drives.', policy: mk({ oneOffer: { enabled: true } }) },
  {
    id: 'dream-super-dream', name: 'Dream / super-dream tiers',
    description: 'One offer per student, except for drives in a higher tier (dream from 10 LPA, super-dream from 20 LPA).',
    policy: mk({ oneOffer: { enabled: true }, tiers: { enabled: true, dreamMinLpa: 10, superDreamMinLpa: 20 } }),
  },
  { id: 'upgrade-1-5x', name: '1.5x upgrade', description: 'Placed students may apply to drives paying at least 1.5 times their accepted offer.', policy: mk({ oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 1.5 } }) },
  { id: 'upgrade-2x', name: '2x upgrade', description: 'Placed students may apply to drives paying at least twice their accepted offer.', policy: mk({ oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 2 } }) },
  {
    id: 'cgpa-backlog-defaults', name: 'CGPA and backlog defaults',
    description: 'Minimum CGPA 6 and no active backlogs for drives that do not set their own limits.',
    policy: mk({ defaults: { minCgpa: 6, maxActiveBacklogs: 0 } }),
  },
];

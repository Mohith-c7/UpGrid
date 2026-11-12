/** Deterministic, pure eligibility engine. No I/O. */

export interface DriveRules {
  minCgpa?: number | null;
  min10th?: number | null;
  min12th?: number | null;
  maxActiveBacklogs?: number | null;
  maxGapYears?: number | null;
  allowedDepartments?: string[] | null;
  allowedBatches?: number[] | null;
}

export interface EligibilityProfile {
  academics?: {
    department?: string | null;
    batchYear?: number | null;
    cgpa?: number | null;
    cgpaScale?: number | null;
    tenthPercent?: number | null;
    twelfthPercent?: number | null;
    activeBacklogs?: number | null;
    gapYears?: number | null;
  } | null;
  verification?: Record<string, string> | null;
}

export type CriterionKey =
  | 'cgpa'
  | 'tenthPercent'
  | 'twelfthPercent'
  | 'activeBacklogs'
  | 'gapYears'
  | 'department'
  | 'batchYear';

export interface EligibilityReason {
  criterion: CriterionKey;
  label: string;
  required: string | number;
  actual: string | number | null;
  /** true = requirement met, false = not met, null = data missing */
  met: boolean | null;
  source: 'profile';
  verification: 'unverified' | 'verified' | 'student_confirmed';
  message: string;
}

export interface EligibilityResult {
  status: 'eligible' | 'not_eligible' | 'pending';
  reasons: EligibilityReason[];
  /** short human reason for list cards ('' when eligible) */
  reason: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const has = (v: unknown) => v !== null && v !== undefined;

export function evaluateEligibility(rules: DriveRules | null | undefined, profile: EligibilityProfile | null | undefined): EligibilityResult {
  const r = rules || {};
  const a = profile?.academics || {};
  const ver = profile?.verification || {};
  const reasons: EligibilityReason[] = [];
  const vOf = (f: string) => ((ver[`academics.${f}`] as EligibilityReason['verification']) || 'unverified');

  const push = (
    criterion: CriterionKey,
    label: string,
    field: string,
    required: string | number,
    actual: string | number | null,
    met: boolean | null,
    failText: string,
    missingText: string,
  ) => {
    reasons.push({
      criterion,
      label,
      required,
      actual,
      met,
      source: 'profile',
      verification: vOf(field),
      message: met === null ? missingText : met ? `${label}: meets requirement` : failText,
    });
  };

  if (isNum(r.minCgpa)) {
    const scale = isNum(a.cgpaScale) && a.cgpaScale > 0 ? a.cgpaScale : 10;
    const norm = isNum(a.cgpa) ? Math.round((a.cgpa / scale) * 10 * 100) / 100 : null;
    push(
      'cgpa', 'CGPA', 'cgpa', r.minCgpa, isNum(a.cgpa) ? a.cgpa : null,
      norm === null ? null : norm >= r.minCgpa,
      `Minimum CGPA ${r.minCgpa} required, yours is ${a.cgpa}`,
      'Add your CGPA to check eligibility',
    );
  }
  if (isNum(r.min10th)) {
    push('tenthPercent', '10th %', 'tenthPercent', r.min10th, isNum(a.tenthPercent) ? a.tenthPercent : null,
      isNum(a.tenthPercent) ? a.tenthPercent >= r.min10th : null,
      `Minimum ${r.min10th}% in 10th required, yours is ${a.tenthPercent}%`, 'Add your 10th percentage');
  }
  if (isNum(r.min12th)) {
    push('twelfthPercent', '12th %', 'twelfthPercent', r.min12th, isNum(a.twelfthPercent) ? a.twelfthPercent : null,
      isNum(a.twelfthPercent) ? a.twelfthPercent >= r.min12th : null,
      `Minimum ${r.min12th}% in 12th required, yours is ${a.twelfthPercent}%`, 'Add your 12th percentage');
  }
  if (isNum(r.maxActiveBacklogs)) {
    push('activeBacklogs', 'Active backlogs', 'activeBacklogs', r.maxActiveBacklogs, isNum(a.activeBacklogs) ? a.activeBacklogs : null,
      isNum(a.activeBacklogs) ? a.activeBacklogs <= r.maxActiveBacklogs : null,
      `At most ${r.maxActiveBacklogs} active backlogs allowed, you have ${a.activeBacklogs}`, 'Add your active backlogs count');
  }
  if (isNum(r.maxGapYears)) {
    push('gapYears', 'Gap years', 'gapYears', r.maxGapYears, isNum(a.gapYears) ? a.gapYears : null,
      isNum(a.gapYears) ? a.gapYears <= r.maxGapYears : null,
      `At most ${r.maxGapYears} gap years allowed, you have ${a.gapYears}`, 'Add your gap years');
  }
  if (Array.isArray(r.allowedDepartments) && r.allowedDepartments.length > 0) {
    const allowed = r.allowedDepartments.map((d) => d.trim().toLowerCase());
    const dep = typeof a.department === 'string' && a.department.trim() ? a.department.trim() : null;
    push('department', 'Department', 'department', r.allowedDepartments.join(', '), dep,
      dep === null ? null : allowed.includes(dep.toLowerCase()),
      `Open to ${r.allowedDepartments.join(', ')} only`, 'Add your department');
  }
  if (Array.isArray(r.allowedBatches) && r.allowedBatches.length > 0) {
    push('batchYear', 'Batch', 'batchYear', r.allowedBatches.join(', '), has(a.batchYear) ? (a.batchYear as number) : null,
      has(a.batchYear) ? r.allowedBatches.includes(a.batchYear as number) : null,
      `Open to batch ${r.allowedBatches.join(', ')} only`, 'Add your batch year');
  }

  const failed = reasons.filter((x) => x.met === false);
  const missing = reasons.filter((x) => x.met === null);
  if (failed.length) return { status: 'not_eligible', reasons, reason: failed[0].message };
  if (missing.length) return { status: 'pending', reasons, reason: missing[0].message };
  return { status: 'eligible', reasons, reason: '' };
}

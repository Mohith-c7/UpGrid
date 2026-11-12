/** Pure policy + eligibility composition. No I/O. */
import { DriveRules, EligibilityProfile, EligibilityResult, evaluateEligibility } from '../eligibility';
import { buildConditionContext, composeExtra, OfferInfo } from './conditions';
import type { Policy } from './schema';

export type Tier = 'regular' | 'dream' | 'super_dream';
const RANK: Record<Tier, number> = { regular: 0, dream: 1, super_dream: 2 };

export function ctcTier(totalLpa: number | null, policy: Policy): Tier {
  if (totalLpa === null) return 'regular';
  if (totalLpa >= policy.tiers.superDreamMinLpa) return 'super_dream';
  if (totalLpa >= policy.tiers.dreamMinLpa) return 'dream';
  return 'regular';
}

/** Drive's own limits win; policy defaults fill only criteria the drive leaves unset. */
export function effectiveRules(rules: DriveRules | null | undefined, policy: Policy | null): DriveRules {
  const r: DriveRules = { ...(rules || {}) };
  if (!policy) return r;
  const d = policy.defaults;
  const fill = <K extends keyof DriveRules>(k: K, v: DriveRules[K]) => { if (v !== null && v !== undefined && (r[k] === undefined || r[k] === null)) r[k] = v; };
  fill('minCgpa', d.minCgpa); fill('maxActiveBacklogs', d.maxActiveBacklogs); fill('maxGapYears', d.maxGapYears);
  fill('min10th', d.min10th); fill('min12th', d.min12th);
  return r;
}

export interface DriveCtx { id: string; rules: any; totalLpa: number | null; annual: boolean; companyName?: string; companyId?: string | null }
export interface StudentCtx extends EligibilityProfile {
  id: string; name?: string; contact?: any; skills?: string[]; offers: OfferInfo & { tiers?: Tier[] };
}
export interface PolicyEvaluation extends EligibilityResult { policyApplied: boolean }

export function offerInfoFromLpas(lpas: (number | null)[]): OfferInfo {
  const nums = lpas.filter((x): x is number => typeof x === 'number');
  return { count: lpas.length, hasAccepted: lpas.length > 0, bestLpa: nums.length ? Math.max(...nums) : null };
}

/** Full evaluation: policy defaults -> base engine -> drive `extra` conditions -> one-offer / upgrade / tiers -> verification requirement. */
export function evaluateWithPolicy(policy: Policy | null, drive: DriveCtx, student: StudentCtx): PolicyEvaluation {
  const rules = effectiveRules(drive.rules, policy);
  const base = evaluateEligibility(rules, { academics: student.academics, verification: student.verification });
  const ctx = buildConditionContext({ academics: student.academics, contact: student.contact, skills: student.skills, verification: student.verification }, student.offers);
  let res = composeExtra(base, drive.rules?.extra, ctx);
  if (!policy) return { ...res, policyApplied: false };

  const reasons: any[] = [...res.reasons];
  let status = res.status;
  let reason = res.reason;
  const addFail = (message: string, required: string, actual: string | number | null) => {
    reasons.push({ criterion: 'policy', label: 'Placement policy', required, actual, met: false, source: 'profile', verification: 'unverified', message });
    if (status !== 'not_eligible') { status = 'not_eligible'; reason = message; }
  };

  if (policy.oneOffer.enabled && drive.annual && student.offers.hasAccepted) {
    const best = student.offers.bestLpa;
    const upgradeOk = policy.upgrade.enabled && drive.totalLpa !== null && best !== null && drive.totalLpa >= policy.upgrade.multiplier * best;
    const studentTier = best === null ? 'regular' : ctcTier(best, policy);
    const driveTier = ctcTier(drive.totalLpa, policy);
    const tierOk = policy.tiers.enabled && RANK[driveTier] > RANK[studentTier];
    if (upgradeOk || tierOk) {
      reasons.push({ criterion: 'policy', label: 'Placement policy', required: 'One offer policy', actual: best, met: true, source: 'profile', verification: 'unverified',
        message: upgradeOk ? `Allowed: package is at least ${policy.upgrade.multiplier}x your accepted offer` : `Allowed: ${driveTier.replace('_', '-')} tier drive` });
    } else {
      addFail('You already have an accepted offer, and this drive does not qualify for a further offer under the placement policy',
        'One offer policy', best);
    }
  }
  if (policy.requireVerifiedAcademics && status !== 'not_eligible') {
    const unverified = res.reasons.filter((r) => r.met !== null && r.criterion !== ('custom' as any) && r.verification !== 'verified');
    if (unverified.length) {
      const m = `Waiting for the placement cell to verify your ${unverified[0].label}`;
      reasons.push({ criterion: 'policy', label: 'Verified academics', required: 'Verified', actual: 'Unverified', met: null, source: 'profile', verification: 'unverified', message: m });
      if (status === 'eligible') { status = 'pending'; reason = m; }
    }
  }
  return { status, reasons, reason, policyApplied: true };
}

export function driveCtxFromRow(row: any): DriveCtx {
  const c = row.ctc || {};
  const annual = (c.kind || 'annual') === 'annual';
  const total = annual && typeof c.fixedLpa === 'number' ? (c.fixedLpa || 0) + (c.variableLpa || 0) + (c.bonusLpa || 0) : null;
  return { id: row.id, rules: row.rules || {}, totalLpa: total, annual, companyName: row.company?.name, companyId: row.company_id ?? null };
}

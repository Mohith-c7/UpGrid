import { z } from 'zod';
import type { Pool } from 'pg';
import type { Db } from '../db';

/** Offer policy stored in tenant_settings.policy.offers (the ops module edits it; this module only reads it). */
export interface OfferPolicy {
  oneOffer: boolean;
  allowOverride: boolean;
  dreamMinLpa: number;
  superDreamMinLpa: number;
  dreamUpgradeMultiplier: number;
  superDreamUpgradeMultiplier: number;
  /** Ops "upgrade" rule: any offer of at least this multiple of the best held offer is allowed (null = rule off). */
  upgradeMultiplier?: number | null;
}
export interface TenantPolicy { offers: OfferPolicy }

export const DEFAULT_OFFER_POLICY: OfferPolicy = {
  oneOffer: true,
  allowOverride: true,
  dreamMinLpa: 10,
  superDreamMinLpa: 20,
  dreamUpgradeMultiplier: 1.5,
  superDreamUpgradeMultiplier: 2,
};
export const DEFAULT_POLICY: TenantPolicy = { offers: DEFAULT_OFFER_POLICY };

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const offerPolicyFields = {
  oneOffer: z.boolean(),
  allowOverride: z.boolean(),
  dreamMinLpa: num(0.1, 1000),
  superDreamMinLpa: num(0.1, 1000),
  dreamUpgradeMultiplier: num(1, 10),
  superDreamUpgradeMultiplier: num(1, 10),
};
/** Strict validation (for the policy editor): every key optional, unknown keys rejected. */
export const offerPolicySchema = z.object(offerPolicyFields).partial().strict();

/** Merge stored JSON over defaults field by field; an invalid field falls back to its default. */
export function normalizePolicy(raw: unknown): TenantPolicy {
  if (raw && typeof raw === 'object' && !('offers' in (raw as any)) && typeof (raw as any).oneOffer === 'object' && (raw as any).oneOffer) return fromOpsPolicy(raw as any);
  const stored = raw && typeof raw === 'object' ? ((raw as any).offers ?? {}) : {};
  const out: any = { ...DEFAULT_OFFER_POLICY };
  if (stored && typeof stored === 'object') {
    for (const [k, schema] of Object.entries(offerPolicyFields)) {
      if (k in stored) {
        const r = (schema as z.ZodTypeAny).safeParse((stored as any)[k]);
        if (r.success) out[k] = r.data;
      }
    }
  }
  // thresholds must be ordered
  if (out.superDreamMinLpa <= out.dreamMinLpa) {
    out.dreamMinLpa = DEFAULT_OFFER_POLICY.dreamMinLpa;
    out.superDreamMinLpa = DEFAULT_OFFER_POLICY.superDreamMinLpa;
  }
  return { offers: out as OfferPolicy };
}

/**
 * The operations module (src/policy) writes the ACTIVE placement policy to tenant_settings.policy in its own shape
 * ({oneOffer:{enabled}, tiers:{enabled,dreamMinLpa,superDreamMinLpa}, upgrade:{enabled,multiplier}}). Translate it so offers are
 * judged by the same policy as applications: a higher tier (or an offer >= upgrade multiplier x the held one) is allowed, anything
 * else is blocked / needs an officer override while the one-offer rule is on.
 */
export function fromOpsPolicy(p: any): TenantPolicy {
  const o: OfferPolicy = { ...DEFAULT_OFFER_POLICY, oneOffer: !!p.oneOffer?.enabled, upgradeMultiplier: p.upgrade?.enabled && Number(p.upgrade.multiplier) >= 1 ? Number(p.upgrade.multiplier) : null };
  if (p.tiers?.enabled && Number(p.tiers.superDreamMinLpa) > Number(p.tiers.dreamMinLpa) && Number(p.tiers.dreamMinLpa) > 0) {
    o.dreamMinLpa = Number(p.tiers.dreamMinLpa);
    o.superDreamMinLpa = Number(p.tiers.superDreamMinLpa);
    o.dreamUpgradeMultiplier = 1; // ops rule: a strictly higher tier is enough
    o.superDreamUpgradeMultiplier = 1;
  } else {
    o.dreamMinLpa = 999; // tiers off: nothing counts as dream / super-dream
    o.superDreamMinLpa = 1000;
  }
  return { offers: o };
}

let boundPool: Pool | null = null;
/** Called once by the pipeline router so other modules can call getPolicy(tenantId) without a pool. */
export function bindPipelinePool(pool: Pool) { boundPool = pool; }
export const pipelinePool = (): Pool => {
  if (!boundPool) throw new Error('pipeline module is not initialised (createApp not called)');
  return boundPool;
};

export async function getPolicy(tenantId: string, db?: Db): Promise<TenantPolicy> {
  const r = await (db ?? pipelinePool()).query('SELECT policy FROM tenant_settings WHERE tenant_id=$1', [tenantId]);
  return normalizePolicy(r.rows[0]?.policy);
}

// ------------------------------------------------------------------ evaluation (pure)
export type Tier = 'regular' | 'dream' | 'super_dream';
export interface HeldOffer { status: string; totalLpa: number }
export interface PolicyReason { code: string; message: string }
export interface PolicyEvaluation {
  result: 'allowed' | 'needs_override' | 'blocked';
  reasons: PolicyReason[];
  tier: Tier;
  heldBest: { totalLpa: number; tier: Tier } | null;
}
export const HOLDING_STATUSES = ['issued', 'accepted', 'joined'];

export function tierFor(totalLpa: number, p: OfferPolicy): Tier {
  if (totalLpa >= p.superDreamMinLpa) return 'super_dream';
  if (totalLpa >= p.dreamMinLpa) return 'dream';
  return 'regular';
}
const TIER_LABEL: Record<Tier, string> = { regular: 'regular', dream: 'dream', super_dream: 'super-dream' };
const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateOfferAgainstPolicy(input: { policy: OfferPolicy; offer: { totalLpa: number }; existing: HeldOffer[] }): PolicyEvaluation {
  const p = input.policy;
  const tier = tierFor(input.offer.totalLpa, p);
  const held = input.existing.filter((o) => HOLDING_STATUSES.includes(o.status));
  const base = { tier, heldBest: null as PolicyEvaluation['heldBest'] };
  if (!p.oneOffer || held.length === 0) return { result: 'allowed', reasons: [], ...base };

  const best = held.reduce((a, b) => (b.totalLpa > a.totalLpa ? b : a));
  const bestTier = tierFor(best.totalLpa, p);
  const heldBest = { totalLpa: best.totalLpa, tier: bestTier };
  const blocked = (code: string, message: string): PolicyEvaluation => ({ result: 'blocked', reasons: [{ code, message }], tier, heldBest });
  const needs = (code: string, message: string): PolicyEvaluation =>
    p.allowOverride ? { result: 'needs_override', reasons: [{ code, message }], tier, heldBest }
      : { result: 'blocked', reasons: [{ code, message: message + ' Overrides are disabled for this institute.' }], tier, heldBest };

  if (p.upgradeMultiplier && input.offer.totalLpa + 1e-9 >= best.totalLpa * p.upgradeMultiplier) return { result: 'allowed', reasons: [], tier, heldBest };
  if (bestTier === 'super_dream') return blocked('SUPER_DREAM_HELD', 'The student already holds a super-dream offer, so no further offers are allowed.');
  if (tier === 'regular') {
    return blocked('ONE_OFFER', `One-offer policy: the student already holds a ${TIER_LABEL[bestTier]} offer (${round2(best.totalLpa)} LPA).`);
  }
  if (tier === 'dream') {
    if (bestTier === 'dream') return blocked('SAME_TIER', 'The student already holds a dream offer; another dream offer is not allowed.');
    const need = round2(best.totalLpa * p.dreamUpgradeMultiplier);
    if (input.offer.totalLpa + 1e-9 >= best.totalLpa * p.dreamUpgradeMultiplier) return { result: 'allowed', reasons: [], tier, heldBest };
    return needs('BELOW_UPGRADE_MULTIPLIER', `A dream upgrade needs at least ${p.dreamUpgradeMultiplier}x the current ${round2(best.totalLpa)} LPA (${need} LPA).`);
  }
  // tier === 'super_dream', held is regular or dream
  const need = round2(best.totalLpa * p.superDreamUpgradeMultiplier);
  if (input.offer.totalLpa + 1e-9 >= best.totalLpa * p.superDreamUpgradeMultiplier) return { result: 'allowed', reasons: [], tier, heldBest };
  return needs('BELOW_UPGRADE_MULTIPLIER', `A super-dream upgrade needs at least ${p.superDreamUpgradeMultiplier}x the current ${round2(best.totalLpa)} LPA (${need} LPA).`);
}

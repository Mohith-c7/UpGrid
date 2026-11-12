import type { PolicyJson } from '@/api/opsTypes';

export interface PolicyForm {
  oneOffer: boolean;
  tiers: boolean; dream: string; superDream: string;
  upgrade: boolean; multiplier: string;
  minCgpa: string; maxActiveBacklogs: string; maxGapYears: string; min10th: string; min12th: string;
  requireVerified: boolean; notes: string;
}
const s = (n: number | null | undefined) => (n == null ? '' : String(n));
export function toForm(p: PolicyJson): PolicyForm {
  return {
    oneOffer: !!p.oneOffer?.enabled,
    tiers: !!p.tiers?.enabled, dream: s(p.tiers?.dreamMinLpa ?? 10), superDream: s(p.tiers?.superDreamMinLpa ?? 20),
    upgrade: !!p.upgrade?.enabled, multiplier: s(p.upgrade?.multiplier ?? 1.5),
    minCgpa: s(p.defaults?.minCgpa), maxActiveBacklogs: s(p.defaults?.maxActiveBacklogs), maxGapYears: s(p.defaults?.maxGapYears),
    min10th: s(p.defaults?.min10th), min12th: s(p.defaults?.min12th),
    requireVerified: !!p.requireVerifiedAcademics, notes: p.notes ?? '',
  };
}
const n = (v: string): number | null => (v.trim() === '' ? null : Number(v));
export function fromForm(f: PolicyForm): PolicyJson {
  return {
    schemaVersion: 1,
    oneOffer: { enabled: f.oneOffer },
    tiers: { enabled: f.tiers, dreamMinLpa: Number(f.dream), superDreamMinLpa: Number(f.superDream) },
    upgrade: { enabled: f.upgrade, multiplier: Number(f.multiplier) },
    defaults: { minCgpa: n(f.minCgpa), maxActiveBacklogs: n(f.maxActiveBacklogs), maxGapYears: n(f.maxGapYears), min10th: n(f.min10th), min12th: n(f.min12th) },
    requireVerifiedAcademics: f.requireVerified,
    notes: f.notes.trim(),
  };
}
/** Client-side checks before calling validate-draft; keys are form field names. */
export function formErrors(f: PolicyForm): Record<string, string> {
  const e: Record<string, string> = {};
  const num = (k: keyof PolicyForm, v: string, min: number, max: number, req = false) => {
    if (v.trim() === '') { if (req) e[k] = 'Required'; return; }
    const x = Number(v);
    if (!Number.isFinite(x) || x < min || x > max) e[k] = `Enter a number from ${min} to ${max}`;
  };
  if (f.tiers) {
    num('dream', f.dream, 0, 1000, true); num('superDream', f.superDream, 0, 1000, true);
    if (!e.dream && !e.superDream && Number(f.superDream) <= Number(f.dream)) e.superDream = 'Super dream must be higher than dream';
  }
  if (f.upgrade) num('multiplier', f.multiplier, 1.1, 5, true);
  num('minCgpa', f.minCgpa, 0, 10); num('min10th', f.min10th, 0, 100); num('min12th', f.min12th, 0, 100);
  num('maxActiveBacklogs', f.maxActiveBacklogs, 0, 50); num('maxGapYears', f.maxGapYears, 0, 10);
  if (f.notes.length > 1000) e.notes = 'Keep notes under 1000 characters';
  return e;
}

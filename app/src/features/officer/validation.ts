import type { DriveDraft } from './types';

const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;
export function isHttpsUrl(v: string): boolean {
  return v.length <= 300 && HTTPS.test(v.trim());
}

/** Parse a user-typed non-negative number with max 2 decimals. Returns null when blank, NaN when invalid. */
export function parseMoney(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

export type Errors = Record<string, string>;

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function validateStep(step: number, d: DriveDraft, serverNow: number): Errors {
  const e: Errors = {};
  switch (step) {
    case 0:
      if (d.companyName.trim().length < 2) e.companyName = 'Enter the company name (2+ characters)';
      if (d.companyWebsite && !isHttpsUrl(d.companyWebsite)) e.companyWebsite = 'Use an https:// link';
      break;
    case 1:
      if (d.role.trim().length < 2) e.role = 'Enter the role title';
      if (d.locations.length === 0) e.locations = 'Add at least one location (for remote roles, add "Remote" or the base city)';
      break;
    case 2:
      if (d.jd.trim().length < 50) e.jd = 'Job description needs at least 50 characters';
      break;
    case 3: {
      const c = d.ctc;
      if (c.fixedLpa == null || Number.isNaN(c.fixedLpa)) e.fixedLpa = 'Enter the fixed amount. It is required to publish';
      else if (c.fixedLpa <= 0) e.fixedLpa = 'Must be greater than 0';
      if (c.variableLpa != null && (Number.isNaN(c.variableLpa) || c.variableLpa < 0)) e.variableLpa = 'Enter 0 or more, max 2 decimals';
      if (c.bonusLpa != null && (Number.isNaN(c.bonusLpa) || c.bonusLpa < 0)) e.bonusLpa = 'Enter 0 or more, max 2 decimals';
      if (!e.fixedLpa && !e.variableLpa && c.kind === 'annual' && c.fixedLpa != null && c.variableLpa != null && c.variableLpa > c.fixedLpa * 3)
        e.variableLpa = 'Variable looks far larger than fixed. Please check';
      if (!e.fixedLpa && c.kind === 'annual' && c.fixedLpa != null && c.fixedLpa > 500) e.fixedLpa = 'Value looks too high for LPA';
      break;
    }
    case 4: {
      const r = d.rules;
      if (r.minCgpa != null && (Number.isNaN(r.minCgpa) || r.minCgpa < 0 || r.minCgpa > 10)) e.minCgpa = 'CGPA must be between 0 and 10';
      for (const k of ['min10th', 'min12th'] as const) {
        const v = r[k];
        if (v != null && (Number.isNaN(v) || v < 0 || v > 100)) e[k] = 'Percentage must be between 0 and 100';
      }
      if (r.maxActiveBacklogs != null && (!Number.isInteger(r.maxActiveBacklogs) || r.maxActiveBacklogs < 0 || r.maxActiveBacklogs > 50)) e.maxActiveBacklogs = 'Whole number from 0 to 50';
      if (r.maxGapYears != null && (!Number.isInteger(r.maxGapYears) || r.maxGapYears < 0 || r.maxGapYears > 10)) e.maxGapYears = 'Whole number from 0 to 10';
      if ((r.allowedBatches ?? []).length === 0) e.allowedBatches = 'Select at least one batch year';
      break;
    }
    case 5:
      d.questions.forEach((q, i) => {
        if (!q.label.trim()) e[`q${i}`] = 'Question text is required';
        else if ((q.type === 'single_select' || q.type === 'multi_select') && (q.options ?? []).filter((o) => o.trim()).length < 2)
          e[`q${i}`] = 'Add at least two options';
      });
      break;
    case 6:
      if (d.rounds.length === 0) e.rounds = 'Add at least one selection round';
      d.rounds.forEach((r, i) => { if (!r.name.trim()) e[`r${i}`] = 'Round name is required'; });
      break;
    case 7: {
      if (!d.deadline) e.deadline = 'Set an application deadline';
      else {
        const dl = new Date(d.deadline).getTime();
        if (dl <= serverNow) e.deadline = 'Deadline must be in the future';
        else if (d.opensAt && dl <= new Date(d.opensAt).getTime()) e.deadline = 'Deadline must be after the open date';
      }
      if (d.opensAt && d.deadline && new Date(d.opensAt).getTime() >= new Date(d.deadline).getTime()) e.opensAt = 'Open date must be before the deadline';
      if (d.contactEmail && !EMAIL.test(d.contactEmail.trim().toLowerCase())) e.contactEmail = 'Enter a valid email';
      break;
    }
  }
  return e;
}

export const STEP_TITLES = ['Company', 'Role', 'Description', 'Compensation', 'Eligibility', 'Questions', 'Rounds', 'Timeline', 'Review'];
export function validateAll(d: DriveDraft, now: number): { step: number; errors: Errors }[] {
  const out: { step: number; errors: Errors }[] = [];
  for (let s = 0; s < 8; s++) { const errors = validateStep(s, d, now); if (Object.keys(errors).length) out.push({ step: s, errors }); }
  return out;
}

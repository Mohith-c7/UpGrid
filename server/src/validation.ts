/**
 * Shared validation rules (mirrored in app/src/lib/validation.ts).
 * Pure functions return { ok:true, value } | { ok:false, message }.
 */
import { z } from 'zod';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(message: string): Result<T> => ({ ok: false, message });

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
export const hasControlChars = (s: string) => CONTROL_CHARS.test(s);

/** Trim, collapse nothing, reject control characters, cap length. */
export function cleanString(raw: unknown, max: number): Result<string> {
  if (typeof raw !== 'string') return fail('Must be text');
  const s = raw.trim();
  if (hasControlChars(s)) return fail('Contains invalid characters');
  if (s.length > max) return fail(`Must be at most ${max} characters`);
  return ok(s);
}

// ---------------------------------------------------------------- email
export const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

const TYPO_DOMAINS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'yahooo.com': 'yahoo.com',
};
export const EMAIL_TYPO_DOMAINS = Object.keys(TYPO_DOMAINS);

export interface NormalizedEmail {
  /** trimmed + lowercased (googlemail.com normalized to gmail.com) */
  email: string;
  /** key for uniqueness: gmail dots and +tag stripped */
  uniqueKey: string;
}

export function normalizeEmail(raw: unknown): Result<NormalizedEmail> {
  if (typeof raw !== 'string') return fail('Enter a valid email address');
  const e = raw.trim().toLowerCase();
  if (!e) return fail('Enter your email address');
  if (e.length > 254) return fail('Email is too long');
  if (hasControlChars(e)) return fail('Enter a valid email address');
  if (!EMAIL_REGEX.test(e) || e.includes('..')) return fail('Enter a valid email address');
  const at = e.lastIndexOf('@');
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (local.startsWith('.') || local.endsWith('.')) return fail('Enter a valid email address');
  if (domain.startsWith('-') || domain.endsWith('-') || domain.split('.').some((p) => p.startsWith('-') || p.endsWith('-'))) {
    return fail('Enter a valid email address');
  }
  if (TYPO_DOMAINS[domain]) return fail(`Did you mean ${TYPO_DOMAINS[domain]}?`);

  let uniqueKey: string;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    domain = 'gmail.com';
    const base = local.split('+')[0];
    if (!/^[a-z0-9.]+$/.test(base)) return fail('Gmail addresses can only use letters, numbers and dots');
    if (base.startsWith('.') || base.endsWith('.') || base.includes('..')) return fail('Enter a valid email address');
    if (!/[a-z0-9]/.test(base)) return fail('Enter a valid email address');
    if (base.length < 6 || base.length > 30) return fail('Gmail usernames must be 6–30 characters');
    uniqueKey = `${base.replace(/\./g, '')}@gmail.com`;
  } else {
    uniqueKey = `${local}@${domain}`;
  }
  return ok({ email: `${local}@${domain}`, uniqueKey });
}

// ---------------------------------------------------------------- phone
export const PHONE_ERROR = 'Enter a valid 10-digit mobile number starting with 6–9';

/** Returns exactly 10 digits. Accepts spaces/dashes, +91, 91 (12 digits), leading 0 (11 digits). */
export function normalizePhone(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail(PHONE_ERROR);
  let s = raw.trim();
  if (/[a-zA-Z]/.test(s)) return fail(PHONE_ERROR);
  s = s.replace(/[\s\-().]/g, '');
  let plus = false;
  if (s.startsWith('+')) {
    plus = true;
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) return fail(PHONE_ERROR);
  if (plus) {
    if (!(s.startsWith('91') && s.length === 12)) return fail(PHONE_ERROR);
    s = s.slice(2);
  } else if (s.length === 12 && s.startsWith('91')) {
    s = s.slice(2);
  } else if (s.length === 11 && s.startsWith('0')) {
    s = s.slice(1);
  }
  if (s.length !== 10) return fail(PHONE_ERROR);
  if (!/^[6-9]/.test(s)) return fail(PHONE_ERROR);
  if (/^(\d)\1{9}$/.test(s)) return fail(PHONE_ERROR);
  if (s === '1234567890' || s === '0123456789') return fail(PHONE_ERROR);
  return ok(s);
}

export function formatPhone(tenDigits: string): string;
export function formatPhone(tenDigits: string | null | undefined): string | null;
export function formatPhone(tenDigits: string | null | undefined): string | null {
  if (!tenDigits) return null; // Google sign-ups have no phone until they add one
  return `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
}

// ---------------------------------------------------------------- password
export function validatePassword(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('Enter a password');
  if (raw.length < 8) return fail('Password must be at least 8 characters');
  if (raw.length > 64) return fail('Password must be at most 64 characters');
  if (raw !== raw.trim()) return fail('Password cannot start or end with a space');
  if (hasControlChars(raw)) return fail('Password contains invalid characters');
  if (!/\p{L}/u.test(raw)) return fail('Password must include a letter');
  if (!/\d/.test(raw)) return fail('Password must include a number');
  return ok(raw);
}

// ---------------------------------------------------------------- name
export function normalizeName(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('Enter your name');
  const s = raw.trim().replace(/\s+/g, ' ');
  if (hasControlChars(s)) return fail('Name contains invalid characters');
  if (s.length < 2) return fail('Name must be at least 2 characters');
  if (s.length > 80) return fail('Name must be at most 80 characters');
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s)) return fail("Name can only contain letters, spaces and . ' -");
  return ok(s);
}

// ---------------------------------------------------------------- misc fields
export function normalizeRegNo(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('Enter your registration number');
  const s = raw.trim().toUpperCase();
  if (s.length < 5 || s.length > 20) return fail('Registration number must be 5–20 characters');
  if (!/^[A-Z0-9/-]+$/.test(s)) return fail('Use only letters, numbers, / and -');
  return ok(s);
}

const maxDecimals = (n: number, d: number) => Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-7;

export function validateCgpa(raw: unknown, scale = 10): Result<number> {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fail('Enter a valid CGPA');
  if (n < 0 || n > scale) return fail(`CGPA must be between 0 and ${scale}`);
  if (!maxDecimals(n, 2)) return fail('CGPA can have at most 2 decimal places');
  return ok(n);
}

export function validatePercent(raw: unknown): Result<number> {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fail('Enter a valid percentage');
  if (n < 0 || n > 100) return fail('Percentage must be between 0 and 100');
  if (!maxDecimals(n, 2)) return fail('Percentage can have at most 2 decimal places');
  return ok(n);
}

export function validateIntRange(raw: unknown, min: number, max: number, label: string): Result<number> {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) return fail(`${label} must be a whole number`);
  if (n < min || n > max) return fail(`${label} must be between ${min} and ${max}`);
  return ok(n);
}
export const validateBacklogs = (r: unknown) => validateIntRange(r, 0, 50, 'Active backlogs');
export const validateGapYears = (r: unknown) => validateIntRange(r, 0, 10, 'Gap years');
export const validateBatchYear = (r: unknown) => validateIntRange(r, 2020, 2040, 'Batch year');
export const validateSemester = (r: unknown) => validateIntRange(r, 1, 12, 'Semester');

export function validateHttpsUrl(raw: unknown, kind?: 'linkedin' | 'github'): Result<string> {
  if (typeof raw !== 'string') return fail('Enter a valid https:// link');
  const s = raw.trim();
  if (hasControlChars(s) || /\s/.test(s)) return fail('Enter a valid https:// link');
  if (s.length > 300) return fail('Link must be at most 300 characters');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail('Enter a valid https:// link');
  }
  if (u.protocol !== 'https:') return fail('Link must start with https://');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.')) return fail('Enter a valid https:// link');
  if (kind === 'linkedin' && !(host === 'linkedin.com' || host.endsWith('.linkedin.com'))) {
    return fail('Enter a linkedin.com link');
  }
  if (kind === 'github' && host !== 'github.com') return fail('Enter a github.com link');
  return ok(s);
}

// ---------------------------------------------------------------- zod schemas
function fromResult<T>(fn: (v: unknown) => Result<T>) {
  return z.any().transform((v, ctx) => {
    const r = fn(v);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.message });
      return z.NEVER;
    }
    return r.value;
  });
}

export const emailSchema = fromResult((v) => {
  const r = normalizeEmail(v);
  return r.ok ? ok(r.value.email) : r;
});
export const phoneSchema = fromResult(normalizePhone);
export const passwordSchema = fromResult(validatePassword);
export const nameSchema = fromResult(normalizeName);
export const regNoSchema = fromResult(normalizeRegNo);
export const cgpaSchema = (scale = 10) => fromResult((v) => validateCgpa(v, scale));
export const percentSchema = fromResult(validatePercent);
export const backlogsSchema = fromResult(validateBacklogs);
export const gapYearsSchema = fromResult(validateGapYears);
export const batchYearSchema = fromResult(validateBatchYear);
export const semesterSchema = fromResult(validateSemester);
export const httpsUrlSchema = fromResult((v) => validateHttpsUrl(v));
export const linkedinSchema = fromResult((v) => validateHttpsUrl(v, 'linkedin'));
export const githubSchema = fromResult((v) => validateHttpsUrl(v, 'github'));
export const textSchema = (max: number, min = 0) =>
  fromResult((v) => {
    const r = cleanString(v, max);
    if (!r.ok) return r;
    if (r.value.length < min) return fail(min === 1 ? 'This field is required' : `Must be at least ${min} characters`);
    return r;
  });

// ---------------------------------------------------------------- scheduling (interview / assessment)
export const SCHEDULE_TYPES = ['assessment', 'interview'] as const;
export const SCHEDULE_MODES = ['online', 'in_person'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];
export const MAX_SCHEDULE_AHEAD_DAYS = 365;

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO-8601 instant with an explicit zone (Z or offset), a real calendar date, strictly after `now`, at most a year ahead. */
export function validateScheduledAt(raw: unknown, now: Date = new Date()): Result<Date> {
  if (typeof raw !== 'string') return fail('Enter the date and time as an ISO-8601 UTC timestamp');
  const s = raw.trim();
  const m = ISO_INSTANT.exec(s);
  if (!m) return fail('Enter the date and time as an ISO-8601 UTC timestamp, e.g. 2026-12-01T04:30:00Z');
  const [, y, mo, d, h, mi, sec] = m as unknown as string[];
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return fail('Enter a valid date');
  if (Number(h) > 23 || Number(mi) > 59 || Number(sec ?? 0) > 59) return fail('Enter a valid time');
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return fail('Enter a valid date and time');
  if (t.getTime() <= now.getTime()) return fail('Choose a date and time in the future');
  if (t.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86400_000) return fail('Choose a date within the next year');
  return ok(t);
}

/** Online: https link (max 300). In person: 3-200 chars of plain text. */
export function validateVenueOrLink(mode: unknown, raw: unknown): Result<string> {
  if (mode === 'online') {
    const r = validateHttpsUrl(raw);
    return r.ok ? r : fail('Enter a valid https:// meeting link');
  }
  const r = cleanString(raw, 200);
  if (!r.ok) return r;
  if (r.value.length < 3) return fail('Venue must be at least 3 characters');
  return r;
}

/** Multi-line text: allows \n, \r and \t but rejects other control characters. Result is trimmed. */
export function cleanMultiline(raw: unknown, min: number, max: number, label = 'Text'): Result<string> {
  if (typeof raw !== 'string') return fail(`${label} must be text`);
  const s = raw.trim().replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(s)) return fail(`${label} contains invalid characters`);
  if (s.length < min) return fail(min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`);
  if (s.length > max) return fail(`${label} must be at most ${max} characters`);
  return ok(s);
}

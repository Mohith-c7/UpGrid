// Mirror of server/src/validation.ts (CONTRACT.md "Validation rules"). Every validator returns
// { ok: true, value } or { ok: false, error } so UI can show live messages.
export type VResult<T = string> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): VResult<T> => ({ ok: true, value });
const bad = (error: string): VResult<never> => ({ ok: false, error });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
export const hasControlChars = (s: string) => CONTROL.test(s);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const GMAIL_TYPOS = ['gmial.com', 'gmai.com', 'gamil.com', 'gmail.co', 'gmail.con', 'gmal.com', 'gmil.com', 'hotmial.com', 'yahooo.com'];
const TYPO_FIX: Record<string, string> = { 'hotmial.com': 'hotmail.com', 'yahooo.com': 'yahoo.com' };

export function suggestEmailFix(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at < 1) return null;
  const domain = v.slice(at + 1);
  if (GMAIL_TYPOS.includes(domain)) return `${v.slice(0, at)}@${TYPO_FIX[domain] ?? 'gmail.com'}`;
  return null;
}

export function validateEmail(raw: string): VResult {
  if (hasControlChars(raw)) return bad('Email contains invalid characters');
  const v = raw.trim().toLowerCase();
  if (!v) return bad('Enter your email address');
  if (v.length > 254) return bad('Email is too long');
  if (v.includes('..')) return bad('Email cannot contain consecutive dots');
  if (!EMAIL_RE.test(v)) return bad('Enter a valid email like name@example.com');
  const at = v.lastIndexOf('@');
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.startsWith('.') || local.endsWith('.')) return bad('Email cannot start or end with a dot before @');
  if (GMAIL_TYPOS.includes(domain)) {
    const fix = TYPO_FIX[domain];
    return bad(fix ? `Did you mean ${fix}?` : 'Did you mean gmail.com?');
  }
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const base = local.split('+')[0];
    if (!/^[a-z0-9.]+$/.test(base)) return bad('Gmail addresses use only letters, numbers and dots');
    if (base.startsWith('.') || base.endsWith('.') || base.includes('..')) return bad('Gmail address has misplaced dots');
    if (base.length < 6 || base.length > 30) return bad('Gmail usernames are 6–30 characters');
    if (!/[a-z0-9]/.test(base)) return bad('Enter a valid Gmail address');
  }
  return ok(v);
}

/** Canonical form for uniqueness (matches the server). */
export function canonicalEmail(email: string): string {
  const v = email.trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at < 0) return v;
  let local = v.slice(0, at);
  let domain = v.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

export const PHONE_ERROR = 'Enter a valid 10-digit mobile number starting with 6–9';

export function validatePhone(raw: string): VResult {
  const s = raw.trim();
  if (!s) return bad('Enter your mobile number');
  if (/[a-zA-Z]/.test(s) || hasControlChars(s)) return bad(PHONE_ERROR);
  if (!/^[+\d\s-]+$/.test(s)) return bad(PHONE_ERROR);
  if (s.includes('+') && !s.startsWith('+')) return bad(PHONE_ERROR);
  let d = s.replace(/[\s+-]/g, '');
  if (s.startsWith('+')) {
    if (!d.startsWith('91') || d.length !== 12) return bad(PHONE_ERROR);
    d = d.slice(2);
  } else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return bad(PHONE_ERROR);
  if (/^(\d)\1{9}$/.test(d)) return bad(PHONE_ERROR);
  if (d === '1234567890' || d === '0123456789') return bad(PHONE_ERROR);
  return ok(d);
}

export function formatPhone(ten: string | null | undefined): string {
  if (!ten) return '';
  const d = ten.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : ten;
}

export function validatePassword(v: string): VResult {
  if (!v) return bad('Enter a password');
  if (v.length < 8) return bad('Use at least 8 characters');
  if (v.length > 64) return bad('Use at most 64 characters');
  if (v !== v.trim()) return bad('Password cannot start or end with a space');
  if (!/[A-Za-z]/.test(v)) return bad('Include at least one letter');
  if (!/\d/.test(v)) return bad('Include at least one number');
  return ok(v);
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };
export function passwordStrength(v: string): Strength {
  if (!v) return { score: 0, label: '' };
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  if (!validatePassword(v).ok) s = Math.min(s, 1);
  const score = Math.max(s, v.length ? 1 : 0) as 0 | 1 | 2 | 3 | 4;
  return { score, label: ['', 'Weak', 'Okay', 'Good', 'Strong'][score] };
}

export function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

export function validateName(raw: string): VResult {
  if (hasControlChars(raw)) return bad('Name contains invalid characters');
  const v = normalizeSpaces(raw);
  if (!v) return bad('Enter your name');
  if (v.length < 2) return bad('Name must be at least 2 characters');
  if (v.length > 80) return bad('Name must be at most 80 characters');
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v)) return bad("Use only letters, spaces and . ' -");
  return ok(v);
}

export function validateRegNo(raw: string): VResult {
  const v = raw.trim().toUpperCase();
  if (!v) return bad('Enter your registration number');
  if (v.length < 5 || v.length > 20) return bad('Registration number is 5–20 characters');
  if (!/^[A-Z0-9/-]+$/.test(v)) return bad('Use only letters, numbers, / and -');
  return ok(v);
}

function decimalsOk(s: string, max = 2) {
  return new RegExp(`^\\d+(\\.\\d{1,${max}})?$`).test(s);
}

export function validateCgpa(raw: string, scale = 10): VResult<number> {
  const s = raw.trim();
  if (!s) return bad('Enter your CGPA');
  if (!decimalsOk(s)) return bad('Enter a number with up to 2 decimals');
  const n = Number(s);
  if (n < 0 || n > scale) return bad(`CGPA must be between 0 and ${scale}`);
  return ok(n);
}
export function validatePercent(raw: string, label = 'Percentage'): VResult<number> {
  const s = raw.trim();
  if (!s) return bad(`Enter ${label}`);
  if (!decimalsOk(s)) return bad('Enter a number with up to 2 decimals');
  const n = Number(s);
  if (n < 0 || n > 100) return bad(`${label} must be between 0 and 100`);
  return ok(n);
}
function intInRange(raw: string, min: number, max: number, label: string): VResult<number> {
  const s = raw.trim();
  if (!s) return bad(`Enter ${label}`);
  if (!/^\d+$/.test(s)) return bad('Enter a whole number');
  const n = Number(s);
  if (n < min || n > max) return bad(`${label[0].toUpperCase()}${label.slice(1)} must be ${min}–${max}`);
  return ok(n);
}
export const validateBacklogs = (r: string) => intInRange(r, 0, 50, 'active backlogs');
export const validateGapYears = (r: string) => intInRange(r, 0, 10, 'gap years');
export const validateBatchYear = (r: string) => intInRange(r, 2020, 2040, 'batch year');
export const validateSemester = (r: string) => intInRange(r, 1, 12, 'semester');

export function validateUrl(raw: string, kind: 'any' | 'linkedin' | 'github' = 'any', required = false): VResult<string> {
  const v = raw.trim();
  if (!v) return required ? bad('Enter a link') : ok('');
  if (hasControlChars(v)) return bad('Link contains invalid characters');
  if (v.length > 300) return bad('Link is too long (max 300)');
  if (!/^https:\/\//i.test(v)) return bad('Link must start with https://');
  let host = '';
  try {
    host = new URL(v).hostname.toLowerCase();
  } catch {
    return bad('Enter a valid link');
  }
  if (!host.includes('.')) return bad('Enter a valid link');
  if (kind === 'linkedin' && !(host === 'linkedin.com' || host.endsWith('.linkedin.com'))) return bad('Must be a linkedin.com link');
  if (kind === 'github' && !(host === 'github.com' || host === 'www.github.com')) return bad('Must be a github.com link');
  return ok(v);
}

export function validateText(raw: string, opts: { required?: boolean; max?: number; label?: string } = {}): VResult {
  const v = raw.trim();
  const max = opts.max ?? 500;
  if (hasControlChars(raw.replace(/[\n\t]/g, ''))) return bad('Contains invalid characters');
  if (!v) return opts.required ? bad(`${opts.label ?? 'This field'} is required`) : ok('');
  if (v.length > max) return bad(`Keep it within ${max} characters`);
  return ok(v);
}

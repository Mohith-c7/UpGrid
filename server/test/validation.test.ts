import { describe, expect, it } from 'vitest';
import {
  formatPhone, normalizeEmail, normalizeName, normalizePhone, normalizeRegNo, validateBacklogs, validateBatchYear, validateCgpa,
  validateGapYears, validateHttpsUrl, validatePassword, validatePercent, validateSemester, emailSchema, phoneSchema,
} from '../src/validation';

const PHONE_MSG = 'Enter a valid 10-digit mobile number starting with 6–9';

describe('email', () => {
  it('trims, lowercases and accepts a normal address', () => {
    const r = normalizeEmail('  Student.Name+x@College.EDU.in ');
    expect(r).toMatchObject({ ok: true, value: { email: 'student.name+x@college.edu.in', uniqueKey: 'student.name+x@college.edu.in' } });
  });
  it.each(['gmial.com', 'gmai.com', 'gamil.com', 'gmail.co', 'gmail.con', 'gmal.com', 'gmil.com'])('flags gmail typo domain %s', (d) => {
    expect(normalizeEmail(`someone123@${d}`)).toEqual({ ok: false, message: 'Did you mean gmail.com?' });
  });
  it('flags hotmial/yahooo with the right suggestion', () => {
    expect(normalizeEmail('abcdef@hotmial.com')).toMatchObject({ ok: false, message: 'Did you mean hotmail.com?' });
    expect(normalizeEmail('abcdef@yahooo.com')).toMatchObject({ ok: false, message: 'Did you mean yahoo.com?' });
  });
  it('gmail: dots and +tag collapse to one unique key; googlemail normalizes', () => {
    const a = normalizeEmail('john.smith@gmail.com');
    const b = normalizeEmail('johnsmith+jobs@googlemail.com');
    const c = normalizeEmail('j.o.h.n.s.m.i.t.h@gmail.com');
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.value.uniqueKey).toBe('johnsmith@gmail.com');
      expect(b.value.uniqueKey).toBe('johnsmith@gmail.com');
      expect(c.value.uniqueKey).toBe('johnsmith@gmail.com');
      expect(b.value.email).toBe('johnsmith+jobs@gmail.com');
    }
  });
  it('gmail local part length and shape rules', () => {
    expect(normalizeEmail('abc12@gmail.com').ok).toBe(false); // 5 chars
    expect(normalizeEmail('abcdef@gmail.com').ok).toBe(true); // 6 chars
    expect(normalizeEmail(`${'a'.repeat(31)}@gmail.com`).ok).toBe(false);
    expect(normalizeEmail(`${'a'.repeat(30)}@gmail.com`).ok).toBe(true);
    expect(normalizeEmail('ab_cdef@gmail.com').ok).toBe(false);
    expect(normalizeEmail('abc..def@gmail.com').ok).toBe(false);
    expect(normalizeEmail('.abcdef@gmail.com').ok).toBe(false);
    expect(normalizeEmail('abcdef.@gmail.com').ok).toBe(false);
    expect(normalizeEmail('123456@gmail.com').ok).toBe(true);
  });
  it('rejects malformed addresses', () => {
    for (const bad of ['', 'plain', 'a@b', 'a@@b.com', 'a b@c.com', 'a..b@c.com', '.a@c.com', 'a.@c.com', 'a@c..com', 'a@-c.com', 'a@c.c', `${'x'.repeat(250)}@c.com`]) {
      expect(normalizeEmail(bad).ok, bad).toBe(false);
    }
    expect(normalizeEmail(123 as any).ok).toBe(false);
  });
  it('zod schema returns normalized email', () => {
    expect(emailSchema.parse(' A.B@Example.com ')).toBe('a.b@example.com');
    expect(emailSchema.safeParse('x@gmial.com').success).toBe(false);
  });
});

describe('phone', () => {
  it.each([
    ['9876543210', '9876543210'], ['98765 43210', '9876543210'], ['98765-43210', '9876543210'], ['+91 98765 43210', '9876543210'],
    ['+919876543210', '9876543210'], ['919876543210', '9876543210'], ['09876543210', '9876543210'], ['6000000001', '6000000001'],
  ])('accepts and normalizes %s', (input, out) => {
    expect(normalizePhone(input)).toEqual({ ok: true, value: out });
  });
  it.each([
    ['9-digit', '987654321'], ['11-digit non-zero', '19876543210'], ['12-digit not 91', '129876543210'], ['letters', '98765abcde'],
    ['letters mixed', '987654321O'], ['starts with 5', '5876543210'], ['repeated digits', '9999999999'], ['repeated 7s', '7777777777'],
    ['sequential', '1234567890'], ['0-prefixed sequential', '0123456789'], ['empty', ''], ['+1 country', '+14155552671'], ['too long', '98765432101234'],
    ['+91 with 9 digits', '+91987654321'],
  ])('rejects %s', (_n, input) => {
    expect(normalizePhone(input)).toEqual({ ok: false, message: PHONE_MSG });
  });
  it('formats for display', () => {
    expect(formatPhone('9876543210')).toBe('+91 98765 43210');
  });
  it('zod schema', () => {
    expect(phoneSchema.parse('+91 98765-43210')).toBe('9876543210');
    expect(phoneSchema.safeParse('abc').success).toBe(false);
  });
});

describe('password', () => {
  it('accepts valid', () => expect(validatePassword('Passw0rdX').ok).toBe(true));
  it.each([
    ['short', 'Ab1'], ['no digit', 'abcdefgh'], ['no letter', '12345678'], ['leading space', ' Passw0rd1'], ['trailing space', 'Passw0rd1 '], ['too long', 'a1'.repeat(33)],
  ])('rejects weak password: %s', (_n, p) => expect(validatePassword(p).ok).toBe(false));
  it('allows inner spaces', () => expect(validatePassword('pass word 1').ok).toBe(true));
});

describe('name, reg no, numbers, urls', () => {
  it('names', () => {
    expect(normalizeName('  Anna   Maria  ')).toEqual({ ok: true, value: 'Anna Maria' });
    expect(normalizeName("D'Souza-Rao Jr.").ok).toBe(true);
    expect(normalizeName('Śrīnivāsa Ramānujan').ok).toBe(true);
    expect(normalizeName('A').ok).toBe(false);
    expect(normalizeName('Bob99').ok).toBe(false);
    expect(normalizeName('x'.repeat(81)).ok).toBe(false);
    expect(normalizeName('Bob\u0000').ok).toBe(false);
  });
  it('registration number', () => {
    expect(normalizeRegNo(' cse22/b-0142 ')).toEqual({ ok: true, value: 'CSE22/B-0142' });
    expect(normalizeRegNo('ab1').ok).toBe(false);
    expect(normalizeRegNo('AB 1234').ok).toBe(false);
    expect(normalizeRegNo('A'.repeat(21)).ok).toBe(false);
  });
  it('cgpa', () => {
    expect(validateCgpa(8.25).ok).toBe(true);
    expect(validateCgpa('9.5').ok).toBe(true);
    expect(validateCgpa(10.01).ok).toBe(false);
    expect(validateCgpa(-1).ok).toBe(false);
    expect(validateCgpa(8.123).ok).toBe(false);
    expect(validateCgpa(4.5, 4).ok).toBe(false);
    expect(validateCgpa('abc').ok).toBe(false);
  });
  it('percent, backlogs, gap, batch, semester', () => {
    expect(validatePercent(100).ok).toBe(true);
    expect(validatePercent(100.5).ok).toBe(false);
    expect(validatePercent(88.555).ok).toBe(false);
    expect(validateBacklogs(50).ok).toBe(true);
    expect(validateBacklogs(51).ok).toBe(false);
    expect(validateBacklogs(1.5).ok).toBe(false);
    expect(validateGapYears(10).ok).toBe(true);
    expect(validateGapYears(11).ok).toBe(false);
    expect(validateBatchYear(2019).ok).toBe(false);
    expect(validateBatchYear(2040).ok).toBe(true);
    expect(validateSemester(0).ok).toBe(false);
    expect(validateSemester(12).ok).toBe(true);
  });
  it('urls', () => {
    expect(validateHttpsUrl('https://example.com/a').ok).toBe(true);
    expect(validateHttpsUrl('http://example.com').ok).toBe(false);
    expect(validateHttpsUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateHttpsUrl('https://example.com/' + 'a'.repeat(300)).ok).toBe(false);
    expect(validateHttpsUrl('https://www.linkedin.com/in/x', 'linkedin').ok).toBe(true);
    expect(validateHttpsUrl('https://linkedin.com.evil.io/in/x', 'linkedin').ok).toBe(false);
    expect(validateHttpsUrl('https://notlinkedin.com/in/x', 'linkedin').ok).toBe(false);
    expect(validateHttpsUrl('https://github.com/u', 'github').ok).toBe(true);
    expect(validateHttpsUrl('https://gist.github.com/u', 'github').ok).toBe(false);
  });
});

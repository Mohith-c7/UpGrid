import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { csvCell, csvSafe, toCsv } from '../src/csv';
import { MAX_IMPORT_ROWS, validateImportRow } from '../src/studentImport';
import { applyTo, auth, createOpenDrive, makeApp, makeEligibleStudent, makeOtherTenant, pool, register, resetDb } from './helpers';

const B = '/api/v1';
const app = makeApp();
let officer: Awaited<ReturnType<typeof register>>;

beforeAll(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  officer = await register(app, 'officer');
});
afterAll(async () => { await pool.end(); });

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let cur: string[] = []; let cell = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
    else cell += ch;
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
};

describe('csv helpers (pure)', () => {
  it('prefixes formula starters with a single quote', () => {
    for (const v of ['=1+1', '+91 98765', '-5', '@SUM(A1)', '\tx', '\rx']) expect(csvSafe(v)).toBe(`'${v}`);
    expect(csvSafe('safe')).toBe('safe');
    expect(csvSafe(8.4)).toBe('8.4');
    expect(csvSafe(null)).toBe('');
    expect(csvSafe("='already")).toBe("'='already");
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });
  it('starts with a BOM and ends rows with CRLF', () => {
    const out = toCsv(['a', 'b'], [[1, 'x']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toBe('﻿a,b\r\n1,x\r\n');
  });
});

describe('GET /drives/:id/applicants/export', () => {
  it('returns a UTF-8 CSV with BOM, exact columns, IST timestamps and resume URL', async () => {
    const s = await makeEligibleStudent(app);
    await request(app).put(`${B}/profile`).set(auth(s)).send({ identity: { registrationNumber: 'CSE22B0001' } });
    const d = await createOpenDrive(app, officer, { company: { name: 'Export Co / Ltd' } });
    const ap = await applyTo(app, s, d.id);
    expect(ap.status).toBe(201);
    const r = await request(app).get(`${B}/drives/${d.id}/applicants/export`).set(auth(officer));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="applicants-export-co-ltd-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(r.text);
    expect(rows[0]).toEqual(['reference', 'name', 'email', 'phoneDisplay', 'registrationNumber', 'department', 'batchYear', 'cgpa', 'activeBacklogs', 'status', 'appliedAt', 'resumeUrl', 'resumeKind']);
    expect(rows).toHaveLength(2);
    const row = rows[1];
    expect(row[0]).toBe(ap.body.application.reference);
    expect(row[1]).toBe('Test User');
    expect(row[2]).toBe(s.email);
    expect(row[3]).toBe(`'+91 ${s.phone.slice(0, 5)} ${s.phone.slice(5)}`); // '+' is a formula starter, so it is neutralised
    expect(row.slice(4, 10)).toEqual(['CSE22B0001', 'Computer Science', '2026', '8.2', '0', 'submitted']);
    expect(row[10]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} IST$/);
    expect(row[11]).toBe('https://example.com/cv.pdf');
    // IST is UTC+5:30
    const submitted = (await pool.query('SELECT submitted_at FROM applications WHERE id=$1', [ap.body.application.id])).rows[0].submitted_at as Date;
    expect(new Date(row[10].replace(' IST', '').replace(' ', 'T') + '+05:30').getTime()).toBe(Math.floor(submitted.getTime() / 1000) * 1000);
  });

  it('neutralises CSV injection in names, emails-like text and quotes cells with commas', async () => {
    const s = await register(app, 'student', { name: 'Evil Name' });
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { department: 'x', program: 'B.Tech', batchYear: 2026, cgpa: 8, cgpaScale: 10, tenthPercent: 80, twelfthPercent: 80, activeBacklogs: 0, gapYears: 0 } });
    const d = await createOpenDrive(app, officer, { rules: { minCgpa: 1 } });
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'R', url: 'https://example.com/a,b.pdf' });
    const ap = await applyTo(app, { ...s, resumeId: rs.body.resume.id }, d.id);
    expect(ap.status).toBe(201);
    // tamper with the snapshot as an attacker-controlled value would appear
    await pool.query(`UPDATE applications SET snapshot = jsonb_set(jsonb_set(snapshot,'{student,name}','"=cmd|\\" /C calc\\"!A0"'),'{student,department}','"@SUM(1,2)"') WHERE id=$1`, [ap.body.application.id]);
    const r = await request(app).get(`${B}/drives/${d.id}/applicants/export`).set(auth(officer));
    const row = parseCsv(r.text)[1];
    expect(row[1]).toBe('\'=cmd|" /C calc"!A0');
    expect(row[5]).toBe("'@SUM(1,2)");
    expect(row[11]).toBe('https://example.com/a,b.pdf');
    for (const cell of row) expect(/^[=+\-@]/.test(cell)).toBe(false);
  });

  it('is officer only, tenant scoped, filterable by status and handles empty drives', async () => {
    const d = await createOpenDrive(app, officer);
    const empty = await request(app).get(`${B}/drives/${d.id}/applicants/export`).set(auth(officer));
    expect(empty.status).toBe(200);
    expect(parseCsv(empty.text)).toHaveLength(1);
    const s = await makeEligibleStudent(app);
    expect((await request(app).get(`${B}/drives/${d.id}/applicants/export`).set(auth(s))).status).toBe(403);
    expect((await request(app).get(`${B}/drives/${d.id}/applicants/export`)).status).toBe(401);
    const t2 = await makeOtherTenant('c');
    expect((await request(app).get(`${B}/drives/${d.id}/applicants/export`).set(auth(t2.officer))).status).toBe(404);
    expect((await request(app).get(`${B}/drives/00000000-0000-4000-8000-000000000999/applicants/export`).set(auth(officer))).status).toBe(404);
    await applyTo(app, s, d.id);
    expect(parseCsv((await request(app).get(`${B}/drives/${d.id}/applicants/export?status=screening`).set(auth(officer))).text)).toHaveLength(1);
    expect(parseCsv((await request(app).get(`${B}/drives/${d.id}/applicants/export?status=submitted`).set(auth(officer))).text)).toHaveLength(2);
  });
});

describe('validateImportRow (pure)', () => {
  it('normalises and validates with the shared validators', () => {
    const r = validateImportRow({ registrationNumber: ' cse22b0142 ', email: 'A.B@Example.com', cgpa: '8.25', cgpaScale: '10', batchYear: '2026', activeBacklogs: 0, department: ' CSE ' });
    expect(r.ok && r.value).toMatchObject({ registrationNumber: 'CSE22B0142', academics: { cgpa: 8.25, cgpaScale: 10, batchYear: 2026, activeBacklogs: 0, department: 'CSE' } });
  });
  it('reports each bad field', () => {
    const r = validateImportRow({ registrationNumber: '1', email: 'x@gmial.com', cgpa: 10.5, tenthPercent: 101, twelfthPercent: -1, activeBacklogs: 51, gapYears: 1.5, batchYear: 2019, semester: 13, cgpaScale: 7, program: 'a'.repeat(81), nope: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields).sort()).toEqual(['activeBacklogs', 'batchYear', 'cgpa', 'cgpaScale', 'email', 'gapYears', 'nope', 'program', 'registrationNumber', 'semester', 'tenthPercent', 'twelfthPercent']);
  });
  it('treats blanks as not provided and requires a registration number', () => {
    expect(validateImportRow({ registrationNumber: 'ABC123', cgpa: '', department: null }).ok).toBe(true);
    const r = validateImportRow({ cgpa: 8 });
    expect(!r.ok && r.fields.registrationNumber).toBe('Registration number is required');
    expect(validateImportRow('x').ok).toBe(false);
    expect(validateImportRow(null).ok).toBe(false);
  });
  it('checks CGPA against the row scale', () => {
    expect(validateImportRow({ registrationNumber: 'ABC123', cgpa: 3.9, cgpaScale: 4 }).ok).toBe(true);
    expect(validateImportRow({ registrationNumber: 'ABC123', cgpa: 4.5, cgpaScale: 4 }).ok).toBe(false);
    expect(validateImportRow({ registrationNumber: 'ABC123', cgpa: 8.123 }).ok).toBe(false);
  });
});

describe('POST /students/import', () => {
  const imp = (rows: unknown, who = officer) => request(app).post(`${B}/students/import`).set(auth(who)).send({ rows } as any);
  const profile = async (id: string) => (await request(app).get(`${B}/students/${id}`).set(auth(officer))).body;

  async function studentWithReg(reg: string, academics: Record<string, unknown> = { department: 'Computer Science', cgpa: 7, cgpaScale: 10 }) {
    const s = await register(app, 'student');
    const put = await request(app).put(`${B}/profile`).set(auth(s)).send({ identity: { registrationNumber: reg }, academics });
    expect(put.status).toBe(200);
    return s;
  }

  it('is officer only and requires authentication', async () => {
    const s = await studentWithReg('CSE22B1001');
    expect((await imp([{ registrationNumber: 'CSE22B1001' }], s)).status).toBe(403);
    expect((await request(app).post(`${B}/students/import`).send({ rows: [] })).status).toBe(401);
  });

  it('updates academics, marks those fields verified, and reports unchanged / unmatched / invalid', async () => {
    const a = await studentWithReg('CSE22B1001');
    const b = await studentWithReg('CSE22B1002', { department: 'Computer Science', cgpa: 8, cgpaScale: 10, activeBacklogs: 0 });
    // make b's values verified and identical to what the import will send
    await request(app).post(`${B}/students/${b.id}/verify`).set(auth(officer)).send({ fields: ['academics.department', 'academics.cgpa', 'academics.activeBacklogs'] });
    const r = await imp([
      { registrationNumber: 'cse22b1001', department: 'Information Technology', cgpa: '8.75', batchYear: 2026, activeBacklogs: 1, tenthPercent: 91.5 },
      { registrationNumber: 'CSE22B1002', department: 'Computer Science', cgpa: 8, activeBacklogs: 0 },
      { registrationNumber: 'ZZZ99999', cgpa: 9 },
      { registrationNumber: 'CSE22B1001', cgpa: 99 },
      { cgpa: 9 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 5, updated: 1, unchanged: 1 });
    expect(r.body.unmatched).toEqual([{ row: 3, registrationNumber: 'ZZZ99999', reason: 'No student with this registration number' }]);
    expect(r.body.invalid).toEqual([
      { row: 4, registrationNumber: 'CSE22B1001', fields: { cgpa: expect.stringMatching(/between 0 and 10/) } },
      { row: 5, registrationNumber: null, fields: { registrationNumber: 'Registration number is required' } },
    ]);
    const pa = await profile(a.id);
    expect(pa.academics).toMatchObject({ department: 'Information Technology', cgpa: 8.75, batchYear: 2026, activeBacklogs: 1, tenthPercent: 91.5 });
    for (const f of ['department', 'cgpa', 'batchYear', 'activeBacklogs', 'tenthPercent']) expect(pa.verification[`academics.${f}`], f).toBe('verified');
    expect(pa.verification['academics.gapYears']).toBeUndefined();
    // untouched fields keep their state
    expect(pa.academics.cgpaScale).toBe(10);
    // second run with identical data is all unchanged
    const again = await imp([{ registrationNumber: 'CSE22B1001', department: 'Information Technology', cgpa: 8.75 }]);
    expect(again.body).toMatchObject({ total: 1, updated: 0, unchanged: 1 });
  });

  it('an identical value that was only unverified becomes verified (counts as updated)', async () => {
    const a = await studentWithReg('CSE22B1003', { cgpa: 7.5, cgpaScale: 10 });
    expect((await profile(a.id)).verification['academics.cgpa']).toBe('unverified');
    const r = await imp([{ registrationNumber: 'CSE22B1003', cgpa: 7.5 }]);
    expect(r.body).toMatchObject({ updated: 1, unchanged: 0 });
    expect((await profile(a.id)).verification['academics.cgpa']).toBe('verified');
  });

  it('matches by email when the registration number is unknown, filling in a missing one; refuses a conflicting one', async () => {
    const noReg = await register(app, 'student', { email: 'noreg.student@example.com' });
    const withReg = await studentWithReg('CSE22B1004');
    const r = await imp([
      { registrationNumber: 'CSE22B2001', email: 'NoReg.Student@example.com', cgpa: 7.1 },
      { registrationNumber: 'CSE22B2002', email: withReg.email, cgpa: 7.2 },
      { registrationNumber: 'CSE22B2003', email: 'nobody@example.com' },
    ]);
    expect(r.body.updated).toBe(1);
    const p = await profile(noReg.id);
    expect(p.identity.registrationNumber).toBe('CSE22B2001');
    expect(p.verification['identity.registrationNumber']).toBe('verified');
    expect(p.academics.cgpa).toBe(7.1);
    expect(r.body.unmatched).toEqual([
      { row: 2, registrationNumber: 'CSE22B2002', reason: expect.stringMatching(/different registration number \(CSE22B1004\)/) },
      { row: 3, registrationNumber: 'CSE22B2003', reason: 'No student with this registration number or email' },
    ]);
    expect((await profile(withReg.id)).academics.cgpa).toBe(7);
  });

  it('one transaction per row: a CGPA that breaks the stored scale rolls back only that row', async () => {
    const four = await studentWithReg('CSE22B1005', { cgpa: 3.5, cgpaScale: 4, department: 'Old Dept' });
    const ok = await studentWithReg('CSE22B1006');
    const r = await imp([
      { registrationNumber: 'CSE22B1005', department: 'New Dept', cgpa: 9.1 }, // 9.1 > scale 4 stored
      { registrationNumber: 'CSE22B1006', department: 'Fine Dept' },
    ]);
    expect(r.body).toMatchObject({ updated: 1 });
    expect(r.body.invalid).toEqual([{ row: 1, registrationNumber: 'CSE22B1005', fields: { cgpa: expect.stringMatching(/between 0 and 4/) } }]);
    const p = await profile(four.id);
    expect(p.academics).toMatchObject({ department: 'Old Dept', cgpa: 3.5 });
    expect((await profile(ok.id)).academics.department).toBe('Fine Dept');
  });

  it('flags duplicate registration numbers inside one import', async () => {
    await studentWithReg('CSE22B1007');
    const r = await imp([{ registrationNumber: 'CSE22B1007', cgpa: 7.7 }, { registrationNumber: 'cse22b1007', cgpa: 6 }]);
    expect(r.body.updated).toBe(1);
    expect(r.body.invalid).toEqual([{ row: 2, registrationNumber: 'CSE22B1007', fields: { registrationNumber: 'Duplicate of row 1 in this import' } }]);
  });

  it('validates the body: missing, empty, not an array, extra keys, unknown row fields, 501 rows', async () => {
    expect((await request(app).post(`${B}/students/import`).set(auth(officer)).send({})).status).toBe(400);
    expect((await imp([])).status).toBe(400);
    expect((await imp('x')).status).toBe(400);
    expect((await request(app).post(`${B}/students/import`).set(auth(officer)).send({ rows: [], other: 1 })).status).toBe(400);
    const tooMany = await imp(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ registrationNumber: `REG${i + 10000}` })));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.fields.rows).toMatch(/500/);
    const unknown = await imp([{ registrationNumber: 'CSE22B1008', name: 'Hax', role: 'officer' }]);
    expect(unknown.status).toBe(200);
    expect(unknown.body.invalid[0].fields).toEqual({ name: 'Unknown field', role: 'Unknown field' });
  });

  it('accepts exactly 500 rows (large body) and reports unknown registration numbers', async () => {
    await studentWithReg('CSE22B1009');
    const rows = Array.from({ length: 500 }, (_, i) => ({
      registrationNumber: i === 0 ? 'CSE22B1009' : `UNK${String(i).padStart(5, '0')}`, email: `unknown.person${i}@example-college.edu`, department: 'Computer Science',
      program: 'B.Tech', batchYear: 2026, semester: 7, cgpa: 8.1, cgpaScale: 10, tenthPercent: 90, twelfthPercent: 88, activeBacklogs: 0, gapYears: 0,
    }));
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(100 * 1024); // beyond the default 100 kB JSON limit
    const r = await imp(rows);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(500);
    expect(r.body.updated).toBe(1);
    expect(r.body.unmatched).toHaveLength(499);
    expect(r.body.unmatched[0]).toMatchObject({ row: 2, registrationNumber: 'UNK00001' });
  });

  it('is tenant scoped: another tenant cannot touch these students and ours cannot touch theirs', async () => {
    const a = await studentWithReg('CSE22B1010');
    const t2 = await makeOtherTenant('d');
    await pool.query(`UPDATE profiles SET data='{"identity":{"registrationNumber":"OTH22B0001"}}' WHERE user_id=$1`, [t2.student.id]);
    const cross = await imp([{ registrationNumber: 'CSE22B1010', cgpa: 9.9 }], t2.officer);
    expect(cross.body.updated).toBe(0);
    expect(cross.body.unmatched).toHaveLength(1);
    expect((await profile(a.id)).academics.cgpa).toBe(7);
    const mine = await imp([{ registrationNumber: 'OTH22B0001', cgpa: 9.9 }]);
    expect(mine.body.unmatched).toHaveLength(1);
    const theirs = await imp([{ registrationNumber: 'OTH22B0001', cgpa: 9.9 }], t2.officer);
    expect(theirs.body.updated).toBe(1);
  });

  it('writes an audit event', async () => {
    await studentWithReg('CSE22B1011');
    await imp([{ registrationNumber: 'CSE22B1011', cgpa: 8 }, { registrationNumber: 'NOPE12345' }, { cgpa: 1 }]);
    const a = (await pool.query(`SELECT actor_id, action, meta FROM audit_events WHERE action='students.import'`)).rows;
    expect(a).toHaveLength(1);
    expect(a[0].actor_id).toBe(officer.id);
    expect(a[0].meta).toEqual({ total: 3, updated: 1, unchanged: 0, unmatched: 1, invalid: 1 });
  });

  it('re-runs eligibility reminder scheduling for affected students', async () => {
    const s = await register(app, 'student');
    await request(app).put(`${B}/profile`).set(auth(s)).send({ identity: { registrationNumber: 'CSE22B1012' }, academics: { cgpa: 5, cgpaScale: 10, department: 'Computer Science', batchYear: 2026, activeBacklogs: 0 } });
    const d = await createOpenDrive(app, officer, { rules: { minCgpa: 7 } });
    const count = async () => (await pool.query(`SELECT count(*)::int n FROM scheduled_reminders WHERE drive_id=$1 AND user_id=$2 AND status='pending'`, [d.id, s.id])).rows[0].n;
    expect(await count()).toBe(0); // not eligible at publish
    await imp([{ registrationNumber: 'CSE22B1012', cgpa: 8.2 }]);
    expect(await count()).toBeGreaterThan(0);
    await imp([{ registrationNumber: 'CSE22B1012', cgpa: 6 }]);
    expect(await count()).toBe(0); // dropped below the cutoff, so reminders are cancelled
  });
});

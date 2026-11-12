import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createR2Storage, FILE_RULES } from '../src/storage';
import { registerFileAccessRule } from '../src/routes/files';
import {
  applyTo, auth, createOpenDrive, makeEligibleStudent, makeOtherTenant, pool, register, resetDb, screenedApplication,
} from './helpers';
import { B, makeIntegApp, MockStorage } from './integ-helpers';

afterAll(async () => { await pool.end(); });

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MB = 1024 * 1024;

let app: Express;
let storage: MockStorage;
let officer: Awaited<ReturnType<typeof register>>;
let student: Awaited<ReturnType<typeof register>>;

beforeEach(async () => {
  await resetDb();
  storage = new MockStorage();
  app = makeIntegApp({}, { storage });
  officer = await register(app, 'officer');
  student = await register(app, 'student');
});

const presign = (who: any, body: Record<string, unknown>) => request(app).post(`${B}/files/presign`).set(auth(who)).send(body);
const good = (over: Record<string, unknown> = {}) => ({ purpose: 'resume', fileName: 'cv.pdf', contentType: PDF, size: 1000, ...over });

/** presign + simulate the browser PUT + confirm */
async function upload(who: any, over: Record<string, unknown> = {}, uploaded?: { size?: number; contentType?: string }) {
  const body = good(over);
  const p = await presign(who, body);
  if (p.status !== 200) throw new Error('presign failed ' + JSON.stringify(p.body));
  const key = (await pool.query('SELECT key FROM files WHERE id=$1', [p.body.fileId])).rows[0].key;
  storage.put(key, uploaded?.size ?? (body.size as number), uploaded?.contentType ?? (body.contentType as string));
  const c = await request(app).post(`${B}/files/${p.body.fileId}/confirm`).set(auth(who)).send({});
  return { id: p.body.fileId as string, key, confirm: c };
}

describe('presign validation matrix', () => {
  it('returns the documented shape and a tenant/user/purpose/uuid.ext key (extension from content type, not the client)', async () => {
    const r = await presign(student, good({ fileName: 'evil.exe' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ method: 'PUT', expiresIn: 600, headers: { 'Content-Type': PDF } });
    expect(r.body.uploadUrl).toContain('X-Amz-Signature');
    const row = (await pool.query('SELECT * FROM files WHERE id=$1', [r.body.fileId])).rows[0];
    expect(row.key).toMatch(new RegExp(`^${row.tenant_id}/${student.id}/resume/[0-9a-f-]{36}\\.pdf$`));
    expect(row).toMatchObject({ status: 'pending', owner_id: student.id, purpose: 'resume', content_type: PDF, file_name: 'evil.exe' });
    expect(Number(row.size)).toBe(1000);
    expect(storage.signedPuts[0]).toMatchObject({ contentType: PDF, expiresIn: 600 });
    const d = await presign(student, good({ contentType: DOCX }));
    expect((await pool.query('SELECT key FROM files WHERE id=$1', [d.body.fileId])).rows[0].key).toMatch(/\.docx$/);
    const j = await presign(student, good({ purpose: 'photo', contentType: 'image/jpeg', fileName: 'me.png' }));
    expect((await pool.query('SELECT key FROM files WHERE id=$1', [j.body.fileId])).rows[0].key).toMatch(/\/photo\/[0-9a-f-]{36}\.jpg$/);
  });

  const matrix: { purpose: string; ok: string[]; bad: string[]; max: number }[] = [
    { purpose: 'resume', ok: [PDF, DOCX], bad: ['image/png', 'application/msword', 'text/html', 'image/svg+xml'], max: 5 * MB },
    { purpose: 'photo', ok: ['image/png', 'image/jpeg', 'image/webp'], bad: [PDF, 'image/svg+xml', 'image/gif'], max: 2 * MB },
    { purpose: 'company_logo', ok: ['image/png', 'image/jpeg', 'image/webp'], bad: [PDF, 'image/svg+xml', 'image/gif'], max: 1 * MB },
    { purpose: 'document', ok: [PDF, 'image/png', 'image/jpeg'], bad: ['image/webp', DOCX, 'image/svg+xml', 'application/zip'], max: 5 * MB },
  ];
  for (const m of matrix) {
    it(`${m.purpose}: allowlist and size limit`, async () => {
      const who = m.purpose === 'company_logo' ? officer : student;
      for (const ct of m.ok) expect((await presign(who, good({ purpose: m.purpose, contentType: ct, size: m.max }))).status, ct).toBe(200);
      for (const ct of m.bad) {
        const r = await presign(who, good({ purpose: m.purpose, contentType: ct }));
        expect(r.status, ct).toBe(400);
        expect(r.body.error.fields.contentType).toBeTruthy();
      }
      const big = await presign(who, good({ purpose: m.purpose, contentType: m.ok[0], size: m.max + 1 }));
      expect(big.status).toBe(400);
      expect(big.body.error.fields.size).toMatch(/too large/);
    });
  }

  it('rejects zero/negative/fractional/non-numeric sizes, odd content types, bad names and purposes', async () => {
    for (const size of [0, -5, 1.5, '1000', null, NaN, undefined]) expect((await presign(student, good({ size }))).body.error?.fields?.size, String(size)).toBeTruthy();
    for (const ct of ['', undefined, 'application/pdf; charset=x', 'APPLICATION/PDF ', 5]) {
      const r = await presign(student, good({ contentType: ct }));
      if (ct === 'APPLICATION/PDF ') expect(r.status).toBe(200); // normalised
      else expect(r.status, String(ct)).toBe(400);
    }
    for (const fileName of ['', '   ', undefined, 'a'.repeat(201), 'bad\u0000name.pdf']) expect((await presign(student, good({ fileName }))).body.error.fields.fileName, String(fileName)).toBeTruthy();
    for (const purpose of ['avatar', '', undefined, 'RESUME']) expect((await presign(student, good({ purpose }))).body.error.fields.purpose, String(purpose)).toBeTruthy();
    expect((await request(app).post(`${B}/files/presign`).set(auth(student)).send([1])).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int n FROM files WHERE owner_id=$1', [student.id])).rows[0].n).toBe(1); // only the normalised one
  });

  it('role rules: company_logo is officer only, resume is student only; photo/document for any user; auth required', async () => {
    const logo = good({ purpose: 'company_logo', contentType: 'image/png' });
    expect((await presign(student, logo)).status).toBe(403);
    expect((await presign(officer, logo)).status).toBe(200);
    expect((await presign(officer, good())).status).toBe(403);
    expect((await presign(officer, good({ purpose: 'photo', contentType: 'image/webp' }))).status).toBe(200);
    expect((await presign(student, good({ purpose: 'document' }))).status).toBe(200);
    expect((await request(app).post(`${B}/files/presign`).send(good())).status).toBe(401);
    expect(FILE_RULES.company_logo.types).not.toHaveProperty('image/svg+xml');
  });
});

describe('confirm', () => {
  it('marks the file ready after checking the stored object; idempotent', async () => {
    const u = await upload(student, { size: 4321 });
    expect(u.confirm.status).toBe(200);
    expect(u.confirm.body.file).toMatchObject({ id: u.id, purpose: 'resume', contentType: PDF, size: 4321, status: 'ready', fileName: 'cv.pdf' });
    expect(u.confirm.body.file.publicUrl).toBeUndefined();
    expect((await request(app).post(`${B}/files/${u.id}/confirm`).set(auth(student)).send({})).status).toBe(200);
    expect((await pool.query('SELECT status FROM files WHERE id=$1', [u.id])).rows[0].status).toBe('ready');
  });
  it('409 UPLOAD_NOT_FOUND when nothing was uploaded; stays pending and can be confirmed later', async () => {
    const p = await presign(student, good());
    const c = await request(app).post(`${B}/files/${p.body.fileId}/confirm`).set(auth(student)).send({});
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('UPLOAD_NOT_FOUND');
    const key = (await pool.query('SELECT key FROM files WHERE id=$1', [p.body.fileId])).rows[0].key;
    storage.put(key, 1000, PDF);
    expect((await request(app).post(`${B}/files/${p.body.fileId}/confirm`).set(auth(student)).send({})).status).toBe(200);
  });
  it('422 FILE_MISMATCH on size or type mismatch: object removed, file discarded', async () => {
    for (const bad of [{ size: 999 }, { size: 6 * MB }, { contentType: 'image/png' }, { contentType: 'text/html' }]) {
      const u = await upload(student, {}, bad);
      expect(u.confirm.status, JSON.stringify(bad)).toBe(422);
      expect(u.confirm.body.error.code).toBe('FILE_MISMATCH');
      expect(storage.removed).toContain(u.key);
      expect(storage.objects.has(u.key)).toBe(false);
      expect((await pool.query('SELECT status FROM files WHERE id=$1', [u.id])).rows[0].status).toBe('deleted');
      expect((await request(app).post(`${B}/files/${u.id}/confirm`).set(auth(student)).send({})).status).toBe(404);
    }
  });
  it('content-type parameters from the storage layer are tolerated', async () => {
    const u = await upload(student, {}, { contentType: 'application/pdf; charset=binary' });
    expect(u.confirm.status).toBe(200);
  });
  it('only the owner can confirm; bad ids are 404; company_logo confirm returns publicUrl', async () => {
    const p = await presign(student, good());
    const other = await register(app, 'student');
    expect((await request(app).post(`${B}/files/${p.body.fileId}/confirm`).set(auth(other)).send({})).status).toBe(404);
    expect((await request(app).post(`${B}/files/not-a-uuid/confirm`).set(auth(student)).send({})).status).toBe(404);
    const logo = await upload(officer, { purpose: 'company_logo', contentType: 'image/png', fileName: 'l.png', size: 500 });
    expect(logo.confirm.body.file.publicUrl).toBe(`https://cdn.example.test/${logo.key}`);
  });
});

describe('GET /files/:id/url access control', () => {
  it('owner gets a 300 s signed URL; strangers, deleted and pending files are 404', async () => {
    const u = await upload(student, { purpose: 'document' });
    const r = await request(app).get(`${B}/files/${u.id}/url`).set(auth(student));
    expect(r.status).toBe(200);
    expect(r.body.expiresIn).toBe(300);
    expect(r.body.url).toContain(u.key);
    expect(storage.signedGets.pop()).toEqual({ key: u.key, expiresIn: 300 });
    expect(r.headers['cache-control']).toBe('no-store');
    const stranger = await register(app, 'student');
    expect((await request(app).get(`${B}/files/${u.id}/url`).set(auth(stranger))).status).toBe(404);
    expect((await request(app).get(`${B}/files/${u.id}/url`)).status).toBe(401);
    expect((await request(app).get(`${B}/files/nope/url`).set(auth(student))).status).toBe(404);
    const pending = await presign(student, good());
    expect((await request(app).get(`${B}/files/${pending.body.fileId}/url`).set(auth(student))).status).toBe(404);
    expect((await request(app).delete(`${B}/files/${u.id}`).set(auth(student))).status).toBe(200);
    expect((await request(app).get(`${B}/files/${u.id}/url`).set(auth(student))).status).toBe(404);
  });

  it('officers see only applicants\' files (resume attached to an application / documents of applicants), same tenant only', async () => {
    const s = await makeEligibleStudent(app);
    const doc = await upload(s, { purpose: 'document' });
    const resumeFile = await upload(s, { purpose: 'resume' });
    const photo = await upload(s, { purpose: 'photo', contentType: 'image/png' });
    const get = (id: string, who: any) => request(app).get(`${B}/files/${id}/url`).set(auth(who));
    // not an applicant yet: nothing visible
    expect((await get(doc.id, officer)).status).toBe(404);
    expect((await get(resumeFile.id, officer)).status).toBe(404);
    // attach the resume file and apply
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'Uploaded', fileId: resumeFile.id, isDefault: true });
    expect(rs.status).toBe(201);
    const drive = await createOpenDrive(app, officer);
    const ap = await applyTo(app, { ...s, resumeId: rs.body.resume.id }, drive.id);
    expect(ap.status).toBe(201);
    expect((await get(resumeFile.id, officer)).status).toBe(200);
    expect((await get(doc.id, officer)).status).toBe(200); // owner has applied
    expect((await get(photo.id, officer)).status).toBe(404); // photos stay private
    const other = await makeOtherTenant('f');
    expect((await get(resumeFile.id, other.officer)).status).toBe(404);
    expect((await get(doc.id, other.student)).status).toBe(404);
    const stranger = await register(app, 'student');
    expect((await get(resumeFile.id, stranger)).status).toBe(404);
    // a module can add its own rule (e.g. recruiters of the drive)
    const rec = await register(app, 'student');
    expect((await get(photo.id, rec)).status).toBe(404);
    registerFileAccessRule(async ({ user, file }) => user.id === rec.id && file.purpose === 'photo');
    expect((await get(photo.id, rec)).status).toBe(200);
  });

  it('company logos can be fetched by officers of the tenant', async () => {
    const logo = await upload(officer, { purpose: 'company_logo', contentType: 'image/png', size: 100 });
    const o2 = await register(app, 'officer');
    expect((await request(app).get(`${B}/files/${logo.id}/url`).set(auth(o2))).status).toBe(200);
    expect((await request(app).get(`${B}/files/${logo.id}/url`).set(auth(student))).status).toBe(404);
  });
});

describe('quota and deletion', () => {
  it('20 ready files per user: presign is refused at the limit (409 FILE_QUOTA_EXCEEDED)', async () => {
    for (let n = 0; n < 20; n++) {
      await pool.query(
        `INSERT INTO files (tenant_id, owner_id, purpose, key, content_type, size, status) SELECT tenant_id, id, 'document', $2, 'application/pdf', 10, 'ready' FROM users WHERE id=$1`,
        [student.id, `q/${n}`]);
    }
    const r = await presign(student, good({ purpose: 'document' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('FILE_QUOTA_EXCEEDED');
    expect((await presign(officer, good({ purpose: 'document' }))).status).toBe(200); // per user
    // deleting one frees a slot
    const one = (await pool.query(`SELECT id FROM files WHERE owner_id=$1 LIMIT 1`, [student.id])).rows[0].id;
    expect((await request(app).delete(`${B}/files/${one}`).set(auth(student))).status).toBe(200);
    expect((await presign(student, good({ purpose: 'document' }))).status).toBe(200);
  });
  it('confirm re-checks the quota (race): the object is removed and the file discarded', async () => {
    const p = await presign(student, good({ purpose: 'document' }));
    const key = (await pool.query('SELECT key FROM files WHERE id=$1', [p.body.fileId])).rows[0].key;
    storage.put(key, 1000, PDF);
    for (let n = 0; n < 20; n++) {
      await pool.query(`INSERT INTO files (tenant_id, owner_id, purpose, key, content_type, size, status) SELECT tenant_id, id, 'document', $2, 'application/pdf', 10, 'ready' FROM users WHERE id=$1`, [student.id, `r/${n}`]);
    }
    const c = await request(app).post(`${B}/files/${p.body.fileId}/confirm`).set(auth(student)).send({});
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('FILE_QUOTA_EXCEEDED');
    expect(storage.removed).toContain(key);
  });
  it('too many unconfirmed uploads are throttled (429)', async () => {
    for (let n = 0; n < 30; n++) expect((await presign(student, good({ purpose: 'document' }))).status).toBe(200);
    expect((await presign(student, good({ purpose: 'document' }))).status).toBe(429);
  });
  it('DELETE is owner-only, removes the object, and is refused while an application uses the file', async () => {
    const s = await makeEligibleStudent(app);
    const f = await upload(s, { purpose: 'resume' });
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'Up', fileId: f.id });
    expect((await request(app).delete(`${B}/files/${f.id}`).set(auth(student))).status).toBe(404);
    const drive = await createOpenDrive(app, officer);
    const ap = await applyTo(app, { ...s, resumeId: rs.body.resume.id }, drive.id);
    expect(ap.status).toBe(201);
    const blocked = await request(app).delete(`${B}/files/${f.id}`).set(auth(s));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('FILE_IN_USE');
    await request(app).post(`${B}/applications/${ap.body.application.id}/withdraw`).set(auth(s)).send({});
    expect((await request(app).delete(`${B}/files/${f.id}`).set(auth(s))).status).toBe(200);
    expect(storage.removed).toContain(f.key);
    expect((await pool.query('SELECT count(*)::int n FROM resumes WHERE file_id=$1', [f.id])).rows[0].n).toBe(0);
    expect((await request(app).delete(`${B}/files/${f.id}`).set(auth(s))).status).toBe(404);
  });
});

describe('resumes: file or link', () => {
  it('accepts exactly one of fileId / url, exposes fileId + kind, counts towards the limit of 5', async () => {
    const f = await upload(student);
    const both = await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'x', fileId: f.id, url: 'https://example.com/a.pdf' });
    expect(both.status).toBe(400);
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'x' })).status).toBe(400);
    const link = await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'Link', url: 'https://example.com/a.pdf' });
    expect(link.body.resume).toMatchObject({ kind: 'link', fileId: null, url: 'https://example.com/a.pdf', fileName: null, size: null, isDefault: true });
    const file = await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'File', fileId: f.id });
    expect(file.status).toBe(201);
    expect(file.body.resume).toMatchObject({ kind: 'file', fileId: f.id, url: null, fileName: 'cv.pdf', size: 1000, isDefault: false });
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'Dup', fileId: f.id })).status).toBe(409);
    const list = await request(app).get(`${B}/profile/resumes`).set(auth(student));
    expect(list.body.items.map((x: any) => x.kind).sort()).toEqual(['file', 'link']);
    for (let n = 0; n < 3; n++) expect((await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: `L${n}`, url: `https://example.com/${n}.pdf` })).status).toBe(201);
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'Six', url: 'https://example.com/6.pdf' })).status).toBe(409);
    const det = await request(app).get(`${B}/students/${student.id}`).set(auth(officer));
    expect(det.body.resumes.find((x: any) => x.kind === 'file')).toMatchObject({ fileId: f.id, fileName: 'cv.pdf' });
  });
  it('rejects files that are not yours, not ready, or not resumes', async () => {
    const other = await register(app, 'student');
    const theirs = await upload(other);
    const pending = await presign(student, good());
    const photo = await upload(student, { purpose: 'photo', contentType: 'image/png' });
    for (const id of [theirs.id, pending.body.fileId, photo.id, '00000000-0000-4000-8000-000000000999']) {
      const r = await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'x', fileId: id });
      expect(r.status, id).toBe(400);
      expect(r.body.error.fields.fileId).toBeTruthy();
    }
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(student)).send({ label: 'x', fileId: 'nope' })).status).toBe(400);
  });
  it('apply stores the file resume in the snapshot; officer resume-url returns a signed URL (link resumes return the link); CSV shows resumeKind only', async () => {
    const s = await makeEligibleStudent(app);
    const f = await upload(s);
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'Uploaded', fileId: f.id });
    const drive = await createOpenDrive(app, officer);
    const ap = await applyTo(app, { ...s, resumeId: rs.body.resume.id }, drive.id);
    const ap2 = await applyTo(app, await makeEligibleStudent(app), drive.id);
    expect(ap.status).toBe(201);
    const det = await request(app).get(`${B}/applications/${ap.body.application.id}`).set(auth(officer));
    expect(det.body.application.resume).toEqual({ label: 'Uploaded', url: null, kind: 'file', fileId: f.id });
    const u = await request(app).get(`${B}/applications/${ap.body.application.id}/resume-url`).set(auth(officer));
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ kind: 'file', label: 'Uploaded', fileName: 'cv.pdf', expiresIn: 300 });
    expect(u.body.url).toContain(f.key);
    const l = await request(app).get(`${B}/applications/${ap2.body.application.id}/resume-url`).set(auth(officer));
    expect(l.body).toMatchObject({ kind: 'link', url: 'https://example.com/cv.pdf' });
    expect((await request(app).get(`${B}/applications/${ap.body.application.id}/resume-url`).set(auth(s))).status).toBe(403);
    expect((await request(app).get(`${B}/applications/${ap.body.application.id}/resume-url`).set(auth((await makeOtherTenant('g')).officer))).status).toBe(404);
    expect((await request(app).get(`${B}/applications/nope/resume-url`).set(auth(officer))).status).toBe(404);
    const csv = await request(app).get(`${B}/drives/${drive.id}/applicants/export`).set(auth(officer));
    expect(csv.text).toContain('resumeKind');
    expect(csv.text).not.toContain('X-Amz');
    expect(csv.text).not.toContain(f.key);
    const lines = csv.text.trim().split('\r\n');
    expect(lines.filter((x) => x.endsWith(',file'))).toHaveLength(1);
    expect(lines.filter((x) => x.endsWith(',link'))).toHaveLength(1);
    // an uploaded resume deleted from storage later is reported cleanly
    await pool.query(`UPDATE files SET status='deleted' WHERE id=$1`, [f.id]);
    expect((await request(app).get(`${B}/applications/${ap.body.application.id}/resume-url`).set(auth(officer))).body.error.code).toBe('RESUME_NOT_AVAILABLE');
  });
  it('a resume whose file was removed cannot be used to apply', async () => {
    const s = await makeEligibleStudent(app);
    const f = await upload(s);
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'Gone', fileId: f.id });
    await pool.query(`UPDATE files SET status='deleted' WHERE id=$1`, [f.id]);
    const drive = await createOpenDrive(app, officer);
    const ap = await applyTo(app, { ...s, resumeId: rs.body.resume.id }, drive.id);
    expect(ap.status).toBe(400);
    expect(ap.body.error.fields.resumeId).toBeTruthy();
  });
});

describe('company logo', () => {
  const logoBody = (id: unknown) => ({ company: { name: 'Acme Demo Co', industry: 'Software', verified: true, logoFileId: id } });
  it('PUT /drives/:id with company.logoFileId sets logoUrl from R2_PUBLIC_BASE_URL + key', async () => {
    const drive = await createOpenDrive(app, officer);
    const logo = await upload(officer, { purpose: 'company_logo', contentType: 'image/webp', fileName: 'logo.webp', size: 900 });
    const r = await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(logo.id));
    expect(r.status).toBe(200);
    expect(r.body.drive.company.logoUrl).toBe(`https://cdn.example.test/${logo.key}`);
    const asStudent = await request(app).get(`${B}/drives/${drive.id}`).set(auth(student));
    expect(asStudent.body.drive.company.logoUrl).toBe(`https://cdn.example.test/${logo.key}`);
    const cleared = await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(null));
    expect(cleared.body.drive.company.logoUrl).toBeNull();
  });
  it('also works on create; rejects foreign / pending / non-logo files and a missing public base URL', async () => {
    const created = await request(app).post(`${B}/drives`).set(auth(officer)).send({ company: { name: 'NewCo', logoFileId: (await upload(officer, { purpose: 'company_logo', contentType: 'image/png', size: 10 })).id } });
    expect(created.status).toBe(201);
    expect(created.body.drive.company.logoUrl).toMatch(/^https:\/\/cdn\.example\.test\/.+\/company_logo\/.+\.png$/);
    const drive = await createOpenDrive(app, officer);
    const o2 = await register(app, 'officer');
    const foreign = await upload(o2, { purpose: 'company_logo', contentType: 'image/png', size: 10 });
    const pending = await presign(officer, good({ purpose: 'company_logo', contentType: 'image/png' }));
    const doc = await upload(officer, { purpose: 'document' });
    // another officer of the same tenant is fine (any officer in the tenant)
    expect((await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(foreign.id))).status).toBe(200);
    for (const id of [pending.body.fileId, doc.id, '00000000-0000-4000-8000-000000000999']) {
      const r = await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(id));
      expect(r.status, id).toBe(400);
      expect(r.body.error.fields['company.logoFileId']).toBeTruthy();
    }
    expect((await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody('not-a-uuid'))).status).toBe(400);
    // a student's file is not an officer-owned logo even if forced into the table
    const sfile = await upload(student, { purpose: 'document' });
    await pool.query(`UPDATE files SET purpose='company_logo' WHERE id=$1`, [sfile.id]);
    expect((await request(app).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(sfile.id))).status).toBe(400);
    const noBase = makeIntegApp({}, { storage: new MockStorage(null) });
    const l2 = await upload(officer, { purpose: 'company_logo', contentType: 'image/png', size: 10 });
    const r = await request(noBase).put(`${B}/drives/${drive.id}`).set(auth(officer)).send(logoBody(l2.id));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('LOGO_PUBLIC_URL_NOT_CONFIGURED');
  });
});

describe('storage not configured', () => {
  it('every /files route answers 503 FILE_STORAGE_NOT_CONFIGURED and the flag is off', async () => {
    const off = makeIntegApp();
    const o = await register(off, 'officer');
    const s = await register(off, 'student');
    const id = '00000000-0000-4000-8000-000000000999';
    const calls = [
      request(off).post(`${B}/files/presign`).set(auth(s)).send(good()),
      request(off).post(`${B}/files/${id}/confirm`).set(auth(s)).send({}),
      request(off).get(`${B}/files/${id}/url`).set(auth(s)),
      request(off).delete(`${B}/files/${id}`).set(auth(s)),
      request(off).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'x', fileId: id }),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('FILE_STORAGE_NOT_CONFIGURED');
    }
    expect((await request(off).post(`${B}/files/presign`).send(good())).status).toBe(401); // auth still first
    expect((await request(off).get(`${B}/config`)).body.features.fileUploads).toBe(false);
    // links still work
    expect((await request(off).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'L', url: 'https://example.com/a.pdf' })).status).toBe(201);
    const logoPut = await request(off).put(`${B}/drives/${(await createOpenDrive(off, o)).id}`).set(auth(o)).send({ company: { name: 'X', logoFileId: id } });
    expect(logoPut.status).toBe(503);
  });
  it('partial R2 env counts as not configured; full env turns the flag on', async () => {
    const partial = makeIntegApp({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b' });
    expect((await request(partial).get(`${B}/config`)).body.features.fileUploads).toBe(false);
    const full = makeIntegApp({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' });
    expect((await request(full).get(`${B}/config`)).body.features.fileUploads).toBe(true);
  });
});

describe('R2 storage adapter (real presigner, no network)', () => {
  const r2 = createR2Storage({ accountId: 'acc123', accessKeyId: 'AKID', secretAccessKey: 'SECRET', bucket: 'placement-files', publicBaseUrl: 'https://files.example.com' });
  it('presigned PUT targets the R2 endpoint, signs content-type and expires in 600 s', async () => {
    const p = await r2.presignPut('t/u/resume/abc.pdf', PDF, 600);
    const u = new URL(p.url);
    expect(u.host).toBe('acc123.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/placement-files/t/u/resume/abc.pdf');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toMatch(/content-type/);
    expect(u.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    expect(p.headers).toEqual({ 'Content-Type': PDF });
    expect(p.url).not.toContain('SECRET');
  });
  it('presigned GET expires in 300 s and suggests a safe file name', async () => {
    const g = new URL(await r2.presignGet('t/u/resume/abc.pdf', 300, 'My "CV"\r\n.pdf'));
    expect(g.searchParams.get('X-Amz-Expires')).toBe('300');
    const cd = g.searchParams.get('response-content-disposition')!;
    expect(cd).toMatch(/^inline; filename="[\w.\- ]+"$/);
    expect(r2.publicBaseUrl).toBe('https://files.example.com');
  });
});

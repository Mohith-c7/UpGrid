import type { Express } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { applyTo, auth, createOpenDrive, makeApp, makeEligibleStudent, nextPhone, pool, register, resetDb, Session } from './helpers';

export const B = '/api/v1';
export { auth, pool, makeApp, resetDb, register, createOpenDrive, applyTo, makeEligibleStudent };

export async function resetPipelineDb() {
  await resetDb();
  await pool.query('DELETE FROM tenant_settings');
}

let n = 0;
/** Invite + register a recruiter for a drive; returns the session. */
export async function makeRecruiter(app: Express, officer: Session, driveId: string, over: { permissions?: Record<string, boolean>; email?: string } = {}) {
  n += 1;
  const email = over.email ?? `rec${n}x${randomUUID().slice(0, 6)}@example.com`;
  const inv = await request(app).post(`${B}/drives/${driveId}/recruiters`).set(auth(officer)).send({ email, name: 'Recruiter Test', ...(over.permissions ? { permissions: over.permissions } : {}) });
  if (inv.status !== 201) throw new Error('invite failed ' + JSON.stringify(inv.body));
  const reg = await request(app).post(`${B}/auth/register-recruiter`).send({ inviteToken: inv.body.inviteToken, name: 'Recruiter Test', phone: nextPhone(), password: 'Passw0rdX', acceptTerms: true });
  if (reg.status !== 201) throw new Error('register-recruiter failed ' + JSON.stringify(reg.body));
  return { token: reg.body.accessToken as string, refresh: reg.body.refreshToken as string, id: reg.body.user.id as string, email, phone: reg.body.user.phone as string } as Session;
}

/** Eligible student who applied to the drive; moved to `screening` by default. */
export async function makeCandidate(app: Express, officer: Session, driveId: string, status: string | null = 'screening', academics: Record<string, unknown> = {}) {
  const s = await makeEligibleStudent(app, academics);
  const ap = await applyTo(app, s, driveId);
  if (ap.status !== 201) throw new Error('apply failed ' + JSON.stringify(ap.body));
  const applicationId = ap.body.application.id as string;
  if (status && status !== 'submitted') {
    const st = await request(app).post(`${B}/applications/${applicationId}/status`).set(auth(officer)).send({ status });
    if (st.status !== 200) throw new Error('status failed ' + JSON.stringify(st.body));
  }
  return { student: s, applicationId };
}

export async function makeRound(app: Express, officer: Session, driveId: string, over: Record<string, unknown> = {}) {
  const r = await request(app).post(`${B}/pipeline/drives/${driveId}/rounds`).set(auth(officer)).send({ name: 'Technical interview', kind: 'technical', ...over });
  if (r.status !== 201) throw new Error('round failed ' + JSON.stringify(r.body));
  return r.body.round as { id: string; seq: number; name: string };
}

export async function addToRound(app: Express, officer: Session, driveId: string, roundId: string, applicationIds: string[]) {
  const r = await request(app).post(`${B}/pipeline/drives/${driveId}/rounds/${roundId}/candidates`).set(auth(officer)).send({ applicationIds });
  if (r.status !== 200 || r.body.failed.length) throw new Error('add failed ' + JSON.stringify(r.body));
  return r.body;
}

export async function setRoundStatus(app: Express, who: Session, driveId: string, roundId: string, updates: { applicationId: string; status: string }[]) {
  return request(app).post(`${B}/pipeline/drives/${driveId}/rounds/${roundId}/status`).set(auth(who)).send({ updates });
}

export async function setRubric(app: Express, officer: Session, driveId: string, roundId?: string) {
  const r = await request(app).put(`${B}/pipeline/drives/${driveId}/rubric`).set(auth(officer)).send({
    ...(roundId ? { roundId } : {}), items: [{ id: 'problem', label: 'Problem solving' }, { id: 'comm', label: 'Communication', description: 'Explains clearly' }],
  });
  if (r.status !== 200) throw new Error('rubric failed ' + JSON.stringify(r.body));
  return r.body.rubric;
}

export const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString();
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export async function notifications(userId: string, type?: string) {
  return (await pool.query(`SELECT * FROM notifications WHERE user_id=$1 ${type ? 'AND type=$2' : ''} ORDER BY created_at, id`, type ? [userId, type] : [userId])).rows;
}
export async function audits(action: string) {
  return (await pool.query('SELECT * FROM audit_events WHERE action=$1 ORDER BY id', [action])).rows;
}

/** Officer + open drive + assigned recruiter. */
export async function setup(app: Express, driveOver: Record<string, unknown> = {}) {
  const officer = await register(app, 'officer');
  const drive = await createOpenDrive(app, officer, driveOver);
  const recruiter = await makeRecruiter(app, officer, drive.id);
  return { officer, drive, recruiter };
}

import type { Express } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';
import { migrate } from '../src/migrator';
import type { PushMessage, PushSender } from '../src/push';

export const cfg = loadConfig();
export const pool = createPool(cfg.databaseUrl);
export const sent: PushMessage[][] = [];
export const fakePush: PushSender = async (m) => {
  sent.push(m);
  return { invalidTokens: [] };
};

export async function resetDb() {
  await migrate(pool);
  await pool.query(`TRUNCATE ticket_messages, tickets, user_consents, audit_events, application_schedules, announcements, scheduled_reminders, devices, reminder_settings, notifications, application_events, applications, saved_drives, drives, resumes, profiles, refresh_tokens, users RESTART IDENTITY CASCADE`);
  await pool.query(`DELETE FROM tenants WHERE id <> '00000000-0000-4000-8000-000000000001'`);
  sent.length = 0;
}

export function makeApp(rateLimits: any = false): Express {
  return createApp({ pool, cfg, push: fakePush, rateLimits, logger: () => undefined });
}

let n = 0;
export const nextPhone = () => {
  n += 1;
  return `9${String(317245 + n * 7919).padStart(9, '3').slice(0, 9)}`.replace(/(\d)\1{9}/, '9812345678');
};

export interface Session { token: string; refresh: string; id: string; email: string; phone: string }

export async function register(app: Express, role: 'student' | 'officer' = 'student', over: Record<string, unknown> = {}): Promise<Session> {
  n += 1;
  const email = (over.email as string) ?? `user${n}x${randomUUID().slice(0, 6)}@example.com`;
  const phone = (over.phone as string) ?? nextPhone();
  const res = await request(app).post('/api/v1/auth/register').send({
    name: 'Test User', email, phone, password: 'Passw0rdX', role, acceptTerms: true, ...(role === 'officer' ? { inviteCode: 'TEST-INVITE' } : {}), ...over,
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, refresh: res.body.refreshToken, id: res.body.user.id, email, phone: res.body.user.phone };
}

export const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

export const goodAcademics = {
  department: 'Computer Science', program: 'B.Tech', batchYear: 2026, semester: 7, cgpa: 8.2, cgpaScale: 10,
  tenthPercent: 90, twelfthPercent: 88, activeBacklogs: 0, gapYears: 0,
};

export async function makeEligibleStudent(app: Express, academics: Record<string, unknown> = {}) {
  const s = await register(app, 'student');
  const put = await request(app).put('/api/v1/profile').set(auth(s)).send({ academics: { ...goodAcademics, ...academics } });
  if (put.status !== 200) throw new Error('profile put failed ' + JSON.stringify(put.body));
  const rs = await request(app).post('/api/v1/profile/resumes').set(auth(s)).send({ label: 'Main', url: 'https://example.com/cv.pdf' });
  return { ...s, resumeId: rs.body.resume.id as string };
}

export const baseDrive = (over: Record<string, unknown> = {}) => ({
  company: { name: 'Acme Demo Co', industry: 'Software', verified: true },
  role: 'Software Engineer',
  workMode: 'hybrid',
  locations: ['Pune'],
  ctc: { fixedLpa: 10, variableLpa: 1, bonusLpa: 0, breakdownProvided: true, kind: 'annual' },
  deadline: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
  jd: 'Build and ship backend services for the demo platform.',
  requirements: ['DSA'],
  rounds: [{ name: 'Interview' }],
  questions: [],
  policyNote: 'Demo',
  contact: { name: 'Officer', email: 'off@example.com' },
  rules: { minCgpa: 7, maxActiveBacklogs: 0 },
  ...over,
});

export async function createOpenDrive(app: Express, officer: Session, over: Record<string, unknown> = {}) {
  const c = await request(app).post('/api/v1/drives').set(auth(officer)).send(baseDrive(over));
  if (c.status !== 201) throw new Error('create drive failed ' + JSON.stringify(c.body));
  const p = await request(app).post(`/api/v1/drives/${c.body.drive.id}/publish`).set(auth(officer));
  if (p.status !== 200) throw new Error('publish failed ' + JSON.stringify(p.body));
  return p.body.drive as { id: string; [k: string]: any };
}

export async function applyTo(app: Express, s: { token: string; resumeId: string; id: string }, driveId: string, over: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/drives/${driveId}/apply`).set({ Authorization: `Bearer ${s.token}` }).send({
    idempotencyKey: randomUUID(), resumeId: s.resumeId, answers: {}, declarationsAccepted: true, ...over,
  });
}

import { signAccessToken } from '../src/context';

/** A second tenant with one officer and one student (rows inserted directly; tokens signed locally). */
export async function makeOtherTenant(tag = 'x') {
  const T2 = '00000000-0000-4000-8000-0000000000b2';
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Other Uni') ON CONFLICT DO NOTHING`, [T2]);
  const mk = async (role: string, name: string, phone: string) => {
    const u = (await pool.query(
      `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,$2,$3,$4,$4,$5,'x') RETURNING id, tenant_id, role`,
      [T2, role, name, `${name.toLowerCase().replace(/\W/g, '')}${tag}@other.edu`, phone])).rows[0];
    if (role === 'student') await pool.query('INSERT INTO profiles (user_id, tenant_id) VALUES ($1,$2)', [u.id, T2]);
    return { id: u.id as string, token: signAccessToken(cfg, u), refresh: '', email: '', phone } as Session;
  };
  return { tenantId: T2, officer: await mk('officer', 'Other Officer', `90000${tag.length}1111`), student: await mk('student', 'Other Student', `90000${tag.length}2222`) };
}

const B = '/api/v1';
/** Student who has applied to a fresh open drive and been moved to `screening` by the officer. */
export async function screenedApplication(app: Express, officer: Session, driveOver: Record<string, unknown> = {}) {
  const student = await makeEligibleStudent(app);
  const drive = await createOpenDrive(app, officer, driveOver);
  const ap = await applyTo(app, student, drive.id);
  if (ap.status !== 201) throw new Error('apply failed ' + JSON.stringify(ap.body));
  const applicationId = ap.body.application.id as string;
  const st = await request(app).post(`${B}/applications/${applicationId}/status`).set(auth(officer)).send({ status: 'screening' });
  if (st.status !== 200) throw new Error('screening failed ' + JSON.stringify(st.body));
  return { student, drive, applicationId };
}

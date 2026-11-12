import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  addToRound, audits, auth, B, makeApp, makeCandidate, makeRecruiter, makeRound, notifications, pool, register, resetPipelineDb, setRoundStatus, setRubric, setup,
} from './pipelineHelpers';

const app = makeApp();
beforeEach(resetPipelineDb);
const d = (id: string) => `${B}/pipeline/drives/${id}`;

describe('rounds and round candidates', () => {
  it('officer defines ordered rounds; recruiters cannot; validation and reorder', async () => {
    const { officer, drive, recruiter } = await setup(app);
    expect((await request(app).post(`${d(drive.id)}/rounds`).set(auth(recruiter)).send({ name: 'Round', kind: 'hr' })).status).toBe(403);
    const bad = await request(app).post(`${d(drive.id)}/rounds`).set(auth(officer)).send({ name: 'A', kind: 'nonsense' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['kind', 'name']);
    const asm = await request(app).post(`${B}/assessments`).set(auth(officer)).send({ title: 'Aptitude screening' });
    expect(asm.status).toBe(201);
    const a = await makeRound(app, officer, drive.id, { name: 'Aptitude', kind: 'aptitude', assessmentId: asm.body.assessment.id });
    const ghost = await request(app).post(`${d(drive.id)}/rounds`).set(auth(officer)).send({ name: 'Ghost', kind: 'aptitude', assessmentId: randomUUID() });
    expect(ghost.status).toBe(400); // unknown assessment is rejected by the assessments module
    const b = await makeRound(app, officer, drive.id, { name: 'Technical', kind: 'technical' });
    const c = await makeRound(app, officer, drive.id, { name: 'HR', kind: 'hr' });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect((await request(app).post(`${d(drive.id)}/rounds`).set(auth(officer)).send({ name: 'Tech 2', kind: 'technical', assessmentId: asm.body.assessment.id })).status).toBe(400); // assessmentId only on assessment kinds
    const re = await request(app).post(`${d(drive.id)}/rounds/reorder`).set(auth(officer)).send({ roundIds: [c.id, a.id, b.id] });
    expect(re.body.items.map((r: any) => r.name)).toEqual(['HR', 'Aptitude', 'Technical']);
    expect((await request(app).post(`${d(drive.id)}/rounds/reorder`).set(auth(officer)).send({ roundIds: [c.id, a.id] })).status).toBe(400);
    const list = await request(app).get(`${d(drive.id)}/rounds`).set(auth(recruiter));
    expect(list.body.items.map((r: any) => r.seq)).toEqual([1, 2, 3]);
    await request(app).delete(`${d(drive.id)}/rounds/${a.id}`).set(auth(officer));
    expect((await request(app).get(`${d(drive.id)}/rounds`).set(auth(officer))).body.items.map((r: any) => r.seq)).toEqual([1, 2]);
    expect((await audits('round.create')).length).toBe(3);
  });

  it('adds only screened candidates and refuses to delete a round with candidates', async () => {
    const { officer, drive } = await setup(app);
    const r1 = await makeRound(app, officer, drive.id);
    const ok = await makeCandidate(app, officer, drive.id);
    const fresh = await makeCandidate(app, officer, drive.id, 'submitted');
    const res = await request(app).post(`${d(drive.id)}/rounds/${r1.id}/candidates`).set(auth(officer)).send({ applicationIds: [ok.applicationId, fresh.applicationId, randomUUID()] });
    expect(res.body.added).toBe(1);
    expect(res.body.failed).toHaveLength(2);
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/candidates`).set(auth(officer)).send({ applicationIds: [ok.applicationId] })).body.alreadyIn).toBe(1);
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/candidates`).set(auth(officer)).send({ allScreened: true })).body.alreadyIn).toBe(1);
    const del = await request(app).delete(`${d(drive.id)}/rounds/${r1.id}`).set(auth(officer));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ROUND_HAS_CANDIDATES');
  });

  it('round status transitions are validated, bulk is partial, events append-only, invited notifies', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const r1 = await makeRound(app, officer, drive.id, { name: 'Online test', kind: 'assessment' });
    const a = await makeCandidate(app, officer, drive.id);
    const b = await makeCandidate(app, officer, drive.id);
    await addToRound(app, officer, drive.id, r1.id, [a.applicationId, b.applicationId]);
    // recruiters cannot invite
    const inv = await setRoundStatus(app, recruiter, drive.id, r1.id, [{ applicationId: a.applicationId, status: 'invited' }]);
    expect(inv.status).toBe(403);
    const invited = await setRoundStatus(app, officer, drive.id, r1.id, [{ applicationId: a.applicationId, status: 'invited' }, { applicationId: b.applicationId, status: 'invited' }]);
    expect(invited.body).toMatchObject({ updated: 2, unchanged: 0, failed: [] });
    expect((await notifications(a.student.id, 'pipeline')).length).toBe(1);
    const again = await setRoundStatus(app, officer, drive.id, r1.id, [{ applicationId: a.applicationId, status: 'invited' }]);
    expect(again.body).toMatchObject({ updated: 0, unchanged: 1 });
    expect((await notifications(a.student.id, 'pipeline')).length).toBe(1);
    const mix = await setRoundStatus(app, recruiter, drive.id, r1.id, [
      { applicationId: a.applicationId, status: 'passed' }, { applicationId: b.applicationId, status: 'failed' }, { applicationId: randomUUID(), status: 'passed' },
    ]);
    expect(mix.body.updated).toBe(2);
    expect(mix.body.failed).toHaveLength(1);
    const bad = await setRoundStatus(app, officer, drive.id, r1.id, [{ applicationId: a.applicationId, status: 'pending' }]);
    expect(bad.body.failed[0].reason).toMatch(/Cannot move a candidate from passed to pending/);
    expect((await setRoundStatus(app, officer, drive.id, r1.id, [{ applicationId: a.applicationId, status: 'bogus' }])).status).toBe(400);
    const events = (await pool.query('SELECT to_status FROM round_events WHERE application_id=$1 ORDER BY id', [a.applicationId])).rows.map((r) => r.to_status);
    expect(events).toEqual(['pending', 'invited', 'passed']);
    await expect(pool.query(`UPDATE round_events SET note='tamper'`)).rejects.toThrow(/append-only/);
    // application status is unchanged by round results
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [b.applicationId])).rows[0].status).toBe('screening');
  });

  it('bulk attendance marks present/absent and requires the markAttendance permission', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const noAtt = await makeRecruiter(app, officer, drive.id, { permissions: { markAttendance: false } });
    const r1 = await makeRound(app, officer, drive.id);
    const cs = [await makeCandidate(app, officer, drive.id), await makeCandidate(app, officer, drive.id), await makeCandidate(app, officer, drive.id)];
    await addToRound(app, officer, drive.id, r1.id, cs.map((c) => c.applicationId));
    const marks = [{ applicationId: cs[0].applicationId, present: true }, { applicationId: cs[1].applicationId, present: false }, { applicationId: cs[2].applicationId, present: true }];
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/attendance`).set(auth(noAtt)).send({ marks })).status).toBe(403);
    const ok = await request(app).post(`${d(drive.id)}/rounds/${r1.id}/attendance`).set(auth(recruiter)).send({ marks });
    expect(ok.body.updated).toBe(3);
    const listed = await request(app).get(`${d(drive.id)}/rounds/${r1.id}/candidates?status=attended`).set(auth(recruiter));
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.counts).toMatchObject({ attended: 2, absent: 1, total: 3 });
    expect((await audits('round.attendance')).length).toBe(1);
  });
});

describe('advance with preview and confirmation', () => {
  async function pipeline() {
    const ctx = await setup(app);
    const r1 = await makeRound(app, ctx.officer, ctx.drive.id, { name: 'Round 1', kind: 'assessment' });
    const r2 = await makeRound(app, ctx.officer, ctx.drive.id, { name: 'Round 2', kind: 'technical' });
    const cs = [];
    for (let i = 0; i < 4; i++) cs.push(await makeCandidate(app, ctx.officer, ctx.drive.id));
    await addToRound(app, ctx.officer, ctx.drive.id, r1.id, cs.map((c) => c.applicationId));
    await setRoundStatus(app, ctx.officer, ctx.drive.id, r1.id, [
      { applicationId: cs[0].applicationId, status: 'passed' }, { applicationId: cs[1].applicationId, status: 'passed' }, { applicationId: cs[2].applicationId, status: 'passed' }, { applicationId: cs[3].applicationId, status: 'failed' },
    ]);
    return { ...ctx, r1, r2, cs };
  }

  it('previews without writing, requires confirm, and is idempotent per key', async () => {
    const { officer, drive, recruiter, r1, r2, cs } = await pipeline();
    const url = `${d(drive.id)}/rounds/${r1.id}/advance`;
    const prev = await request(app).post(`${url}/preview`).set(auth(recruiter)).send({});
    expect(prev.status).toBe(200);
    expect(prev.body.toRound.id).toBe(r2.id);
    expect(prev.body.counts).toEqual({ toInvite: 3, toWaitlist: 0, skipped: 0 });
    expect((await pool.query('SELECT count(*)::int n FROM round_candidates WHERE round_id=$1', [r2.id])).rows[0].n).toBe(0);
    const explicit = await request(app).post(`${url}/preview`).set(auth(officer)).send({ applicationIds: [cs[0].applicationId, cs[3].applicationId] });
    expect(explicit.body.skipped).toEqual([{ applicationId: cs[3].applicationId, reason: 'not_passed' }]);

    const key = randomUUID();
    expect((await request(app).post(url).set(auth(officer)).send({ idempotencyKey: key })).status).toBe(400); // no confirm
    expect((await request(app).post(url).set(auth(officer)).send({ confirm: true })).status).toBe(400); // no key
    const go = await request(app).post(url).set(auth(recruiter)).send({ confirm: true, idempotencyKey: key });
    expect(go.status).toBe(200);
    expect(go.body.moved).toHaveLength(3);
    expect(go.body.replayed).toBe(false);
    const eventsAfter = (await pool.query('SELECT count(*)::int n FROM round_events')).rows[0].n;
    const notifsAfter = (await notifications(cs[0].student.id, 'pipeline')).length;
    expect(notifsAfter).toBe(1);
    const replay = await request(app).post(url).set(auth(recruiter)).send({ confirm: true, idempotencyKey: key });
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.moved).toHaveLength(3);
    expect((await pool.query('SELECT count(*)::int n FROM round_events')).rows[0].n).toBe(eventsAfter);
    expect((await notifications(cs[0].student.id, 'pipeline')).length).toBe(notifsAfter);
    const other = await request(app).post(url).set(auth(officer)).send({ confirm: true, idempotencyKey: randomUUID() });
    expect(other.body.moved).toHaveLength(0);
    expect(other.body.skipped.every((s: any) => s.reason === 'already_in_target' || s.reason === 'not_passed')).toBe(true);
    expect((await pool.query(`SELECT status FROM round_candidates WHERE round_id=$1`, [r2.id])).rows.every((r) => r.status === 'invited')).toBe(true);
    // a candidate that already moved cannot be flipped back
    const flip = await setRoundStatus(app, officer, drive.id, r1.id, [{ applicationId: cs[0].applicationId, status: 'failed' }]);
    expect(flip.body.failed[0].reason).toMatch(/already moved/);
    // last round has nowhere to go
    const last = await request(app).post(`${d(drive.id)}/rounds/${r2.id}/advance/preview`).set(auth(officer)).send({});
    expect(last.status).toBe(422);
    expect(last.body.error.code).toBe('NO_NEXT_ROUND');
    expect((await audits('round.advance')).length).toBe(2);
  });

  it('capacity invites the best by score and waitlists the rest; promote invites a waitlisted candidate', async () => {
    const { officer, drive, recruiter, r1, r2, cs } = await pipeline();
    await setRubric(app, officer, drive.id);
    const score = (i: number, a: number, b: number) =>
      request(app).put(`${d(drive.id)}/candidates/${cs[i].applicationId}/scorecards/${r1.id}`).set(auth(recruiter)).send({ ratings: [{ itemId: 'problem', rating: a }, { itemId: 'comm', rating: b }], recommendation: 'hire' });
    expect((await score(0, 3, 3)).status).toBe(201);
    expect((await score(1, 5, 5)).status).toBe(201);
    expect((await score(2, 4, 4)).status).toBe(201);
    const url = `${d(drive.id)}/rounds/${r1.id}/advance`;
    const prev = await request(app).post(`${url}/preview`).set(auth(officer)).send({ capacity: 2 });
    expect(prev.body.toInvite.map((x: any) => x.applicationId)).toEqual([cs[1].applicationId, cs[2].applicationId]);
    expect(prev.body.toWaitlist.map((x: any) => x.applicationId)).toEqual([cs[0].applicationId]);
    const go = await request(app).post(url).set(auth(officer)).send({ capacity: 2, confirm: true, idempotencyKey: randomUUID() });
    expect(go.body.waitlisted).toHaveLength(1);
    const wl = await request(app).get(`${d(drive.id)}/rounds/${r2.id}/candidates?waitlisted=1`).set(auth(officer));
    expect(wl.body.items).toHaveLength(1);
    expect(wl.body.items[0]).toMatchObject({ applicationId: cs[0].applicationId, waitlisted: true, waitlistRank: 1 });
    // waitlisted candidates cannot be given results
    const st = await setRoundStatus(app, officer, drive.id, r2.id, [{ applicationId: cs[0].applicationId, status: 'attended' }]);
    expect(st.body.failed[0].reason).toMatch(/waitlist/i);
    const pro = await request(app).post(`${d(drive.id)}/rounds/${r2.id}/promote`).set(auth(officer)).send({ applicationIds: [cs[0].applicationId] });
    expect(pro.body.promoted).toBe(1);
    expect((await pool.query(`SELECT status, waitlisted FROM round_candidates WHERE round_id=$1 AND application_id=$2`, [r2.id, cs[0].applicationId])).rows[0]).toEqual({ status: 'invited', waitlisted: false });
    const funnel = await request(app).get(`${d(drive.id)}/funnel`).set(auth(recruiter));
    expect(funnel.body.rounds[0]).toMatchObject({ name: 'Round 1', passed: 3, failed: 1, total: 4 });
    expect(funnel.body.rounds[1]).toMatchObject({ name: 'Round 2', invited: 3, total: 3 });
    expect(funnel.body.applications.byStatus.screening).toBe(4);
  });
});

describe('results upload and publishing', () => {
  it('uploads results by reference or id, reports bad rows, hides outcomes from students until published', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const r1 = await makeRound(app, officer, drive.id, { name: 'Aptitude', kind: 'aptitude' });
    const a = await makeCandidate(app, officer, drive.id);
    const b = await makeCandidate(app, officer, drive.id);
    await addToRound(app, officer, drive.id, r1.id, [a.applicationId, b.applicationId]);
    const ref = (await pool.query('SELECT reference FROM applications WHERE id=$1', [b.applicationId])).rows[0].reference;
    const res = await request(app).post(`${d(drive.id)}/rounds/${r1.id}/results`).set(auth(recruiter)).send({
      rows: [{ applicationId: a.applicationId, result: 'passed', score: 82.5 }, { reference: ref, result: 'failed', remark: 'Below cutoff' }, { reference: 'PL-NOPE', result: 'passed' }, { applicationId: a.applicationId, result: 'failed' }],
    });
    expect(res.body).toMatchObject({ total: 4, updated: 2, unchanged: 0 });
    expect(res.body.failed.map((f: any) => f.row)).toEqual([3, 4]);
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/results`).set(auth(recruiter)).send({ rows: [{ applicationId: a.applicationId, result: 'passed', score: 101 }] })).status).toBe(400);
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/results`).set(auth(recruiter)).send({ rows: [{ result: 'passed' }] })).status).toBe(400);
    const mine = () => request(app).get(`${B}/pipeline/applications/${a.applicationId}/rounds`).set(auth(a.student));
    expect((await mine()).body.items[0].status).toBe('pending_results');
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/publish-results`).set(auth(recruiter))).status).toBe(403);
    const pub = await request(app).post(`${d(drive.id)}/rounds/${r1.id}/publish-results`).set(auth(officer));
    expect(pub.body).toEqual({ ok: true, notified: 2 });
    expect((await request(app).post(`${d(drive.id)}/rounds/${r1.id}/publish-results`).set(auth(officer))).body.notified).toBe(0);
    expect((await mine()).body.items[0].status).toBe('passed');
    expect((await request(app).get(`${B}/pipeline/applications/${a.applicationId}/rounds`).set(auth(b.student))).status).toBe(404);
    expect((await audits('round.results_upload')).length).toBe(1);
  });
});

describe('QR attendance', () => {
  async function qrSetup() {
    const ctx = await setup(app);
    const round = await makeRound(app, ctx.officer, ctx.drive.id, { name: 'GD', kind: 'gd' });
    const inRound = await makeCandidate(app, ctx.officer, ctx.drive.id);
    const notIn = await makeCandidate(app, ctx.officer, ctx.drive.id);
    await addToRound(app, ctx.officer, ctx.drive.id, round.id, [inRound.applicationId]);
    const tokenUrl = `${d(ctx.drive.id)}/rounds/${round.id}/attendance-token`;
    return { ...ctx, round, inRound, notIn, tokenUrl };
  }
  const scan = (who: any, token: string) => request(app).post(`${B}/pipeline/attendance/scan`).set(auth(who)).send({ token });

  it('marks attendance inside the window, replays safely, and rejects outsiders', async () => {
    const { officer, recruiter, round, inRound, notIn, tokenUrl } = await qrSetup();
    const t = await request(app).post(tokenUrl).set(auth(recruiter)).send({ session: 'morning', validMinutes: 30 });
    expect(t.status).toBe(201);
    expect(t.body.qrPayload).toBe('POSATT1.' + t.body.token);
    expect((new Date(t.body.validUntil).getTime() - new Date(t.body.validFrom).getTime()) / 60000).toBe(30);
    const stored = (await pool.query('SELECT token_hash FROM attendance_tokens')).rows[0];
    expect(stored.token_hash).not.toBe(t.body.token);
    expect((await scan(notIn.student, t.body.token)).body.error.code).toBe('NOT_SHORTLISTED');
    expect((await scan(inRound.student, 'x'.repeat(30))).body.error.code).toBe('TOKEN_INVALID');
    const ok = await scan(inRound.student, t.body.qrPayload);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ attended: true, replayed: false, round: { id: round.id } });
    expect((await scan(inRound.student, t.body.token)).body.replayed).toBe(true);
    expect((await pool.query(`SELECT status FROM round_candidates WHERE application_id=$1`, [inRound.applicationId])).rows[0].status).toBe('attended');
    expect((await audits('attendance.scan')).length).toBe(1);
    // a new token for the same session revokes the old one
    const t2 = await request(app).post(tokenUrl).set(auth(officer)).send({ session: 'morning' });
    expect((await scan(inRound.student, t.body.token)).body.error.code).toBe('TOKEN_INVALID');
    expect((await scan(inRound.student, t2.body.token)).body.replayed).toBe(true);
    // recruiters and students cannot scan as staff / staff cannot scan
    expect((await scan(recruiter, t2.body.token)).status).toBe(403);
    expect((await request(app).delete(`${tokenUrl}/morning`).set(auth(officer))).body.revoked).toBe(1);
    expect((await scan(inRound.student, t2.body.token)).body.error.code).toBe('TOKEN_INVALID');
  });

  it('enforces the time window with the server clock', async () => {
    const { officer, inRound, tokenUrl } = await qrSetup();
    const future = await request(app).post(tokenUrl).set(auth(officer)).send({ session: 'later', validFrom: new Date(Date.now() + 3600_000).toISOString() });
    const early = await scan(inRound.student, future.body.token);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('TOKEN_NOT_STARTED');
    const now = await request(app).post(tokenUrl).set(auth(officer)).send({ session: 'now' });
    await pool.query(`UPDATE attendance_tokens SET valid_from = now() - interval '2 hours', valid_until = now() - interval '1 minute' WHERE session='now'`);
    const late = await scan(inRound.student, now.body.token);
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('TOKEN_EXPIRED');
    expect((await request(app).post(tokenUrl).set(auth(officer)).send({ validMinutes: 1 })).status).toBe(400);
    expect((await request(app).post(tokenUrl).set(auth(officer)).send({ validMinutes: 9999 })).status).toBe(400);
    expect((await pool.query(`SELECT status FROM round_candidates WHERE application_id=$1`, [inRound.applicationId])).rows[0].status).toBe('pending');
  });

  it('rejects waitlisted candidates and candidates whose result is already recorded', async () => {
    const { officer, drive, round, inRound, notIn, tokenUrl } = await qrSetup();
    await addToRound(app, officer, drive.id, round.id, [notIn.applicationId]);
    await request(app).post(`${d(drive.id)}/rounds/${round.id}/waitlist`).set(auth(officer)).send({ applicationIds: [notIn.applicationId] });
    const t = await request(app).post(tokenUrl).set(auth(officer)).send({});
    expect((await scan(notIn.student, t.body.token)).body.error.code).toBe('NOT_SHORTLISTED');
    await setRoundStatus(app, officer, drive.id, round.id, [{ applicationId: inRound.applicationId, status: 'passed' }]);
    const late = await scan(inRound.student, t.body.token);
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('only staff with markAttendance can create tokens', async () => {
    const { officer, drive, tokenUrl } = await qrSetup();
    const limited = await makeRecruiter(app, officer, drive.id, { permissions: { markAttendance: false } });
    expect((await request(app).post(tokenUrl).set(auth(limited)).send({})).status).toBe(403);
    expect((await request(app).post(tokenUrl).set(auth(await register(app, 'student'))).send({})).status).toBe(403);
  });
});

describe('rubric and scorecards', () => {
  it('officer defines the rubric; scorecards validate 1-5 per item and compute the score server-side', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const round = await makeRound(app, officer, drive.id);
    const c = await makeCandidate(app, officer, drive.id);
    await addToRound(app, officer, drive.id, round.id, [c.applicationId]);
    const url = `${d(drive.id)}/candidates/${c.applicationId}/scorecards/${round.id}`;
    const body = { ratings: [{ itemId: 'problem', rating: 4 }, { itemId: 'comm', rating: 5 }], comments: 'Good', recommendation: 'strong_hire' };
    const none = await request(app).put(url).set(auth(recruiter)).send(body);
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('NO_RUBRIC');
    expect((await request(app).put(`${d(drive.id)}/rubric`).set(auth(recruiter)).send({ items: [{ label: 'Skill' }] })).status).toBe(403);
    expect((await request(app).put(`${d(drive.id)}/rubric`).set(auth(officer)).send({ items: [] })).status).toBe(400);
    const rub = await setRubric(app, officer, drive.id);
    expect(rub.version).toBe(1);
    expect((await setRubric(app, officer, drive.id)).version).toBe(2);
    expect((await request(app).get(`${d(drive.id)}/rubric`).set(auth(recruiter))).body.rubric.items).toHaveLength(2);
    for (const bad of [
      { ...body, ratings: [{ itemId: 'problem', rating: 6 }, { itemId: 'comm', rating: 5 }] },
      { ...body, ratings: [{ itemId: 'problem', rating: 0 }, { itemId: 'comm', rating: 5 }] },
      { ...body, ratings: [{ itemId: 'problem', rating: 3.5 }, { itemId: 'comm', rating: 5 }] },
      { ...body, ratings: [{ itemId: 'problem', rating: 4 }] },
      { ...body, ratings: [{ itemId: 'problem', rating: 4 }, { itemId: 'comm', rating: 4 }, { itemId: 'zzz', rating: 4 }] },
      { ...body, recommendation: 'maybe' },
      { ...body, overall: 5 },
    ]) {
      const r = await request(app).put(url).set(auth(recruiter)).send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await request(app).put(url).set(auth(recruiter)).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.scorecard).toMatchObject({ overall: 4.5, revision: 1, recommendation: 'strong_hire', rubricVersion: 2 });
    expect(ok.body.scorecard.ratings[0]).toEqual({ itemId: 'problem', label: 'Problem solving', rating: 4 });
    const upd = await request(app).put(url).set(auth(recruiter)).send({ ...body, ratings: [{ itemId: 'problem', rating: 2 }, { itemId: 'comm', rating: 3 }], recommendation: 'no_hire' });
    expect(upd.status).toBe(200);
    expect(upd.body.scorecard).toMatchObject({ overall: 2.5, revision: 2 });
    expect((await pool.query('SELECT count(*)::int n FROM scorecards')).rows[0].n).toBe(1);
    expect((await audits('scorecard.submit')).length).toBe(2);
    const detail = await request(app).get(`${d(drive.id)}/candidates/${c.applicationId}`).set(auth(officer));
    expect(detail.body.candidate.scoreSummary).toEqual({ count: 1, avg: 2.5, byRecommendation: { no_hire: 1 } });
    // not in round
    const other = await makeCandidate(app, officer, drive.id);
    const nr = await request(app).put(`${d(drive.id)}/candidates/${other.applicationId}/scorecards/${round.id}`).set(auth(recruiter)).send(body);
    expect(nr.body.error.code).toBe('NOT_IN_ROUND');
  });

  it('a round rubric overrides the drive rubric, and scorecards are blind until you submit your own', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const second = await makeRecruiter(app, officer, drive.id);
    const round = await makeRound(app, officer, drive.id);
    const c = await makeCandidate(app, officer, drive.id);
    await addToRound(app, officer, drive.id, round.id, [c.applicationId]);
    await setRubric(app, officer, drive.id);
    await request(app).put(`${d(drive.id)}/rubric`).set(auth(officer)).send({ roundId: round.id, items: [{ id: 'depth', label: 'Depth' }] });
    expect((await request(app).get(`${d(drive.id)}/rubric?roundId=${round.id}`).set(auth(officer))).body.rubric.items[0].id).toBe('depth');
    const url = `${d(drive.id)}/candidates/${c.applicationId}/scorecards/${round.id}`;
    const first = await request(app).put(url).set(auth(recruiter)).send({ ratings: [{ itemId: 'depth', rating: 5 }], recommendation: 'hire' });
    expect(first.status).toBe(201);
    const list = (who: any) => request(app).get(`${d(drive.id)}/candidates/${c.applicationId}/scorecards`).set(auth(who));
    expect((await list(second)).body).toMatchObject({ items: [], hiddenCount: 1 });
    expect((await list(officer)).body.items).toHaveLength(1);
    await request(app).put(url).set(auth(second)).send({ ratings: [{ itemId: 'depth', rating: 2 }], recommendation: 'no_hire' });
    expect((await list(second)).body).toMatchObject({ hiddenCount: 0 });
    expect((await list(second)).body.items).toHaveLength(2);
    await request(app).put(`${d(drive.id)}/settings`).set(auth(officer)).send({ blindScorecards: false });
    const third = await makeRecruiter(app, officer, drive.id);
    expect((await list(third)).body.items).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  addToRound, auth, B, makeApp, makeCandidate, makeRecruiter, makeRound, resetPipelineDb, setRoundStatus, setRubric, setup,
} from './pipelineHelpers';

const app = makeApp();
beforeEach(resetPipelineDb);
const d = (id: string) => `${B}/pipeline/drives/${id}`;

/** Officer + drive + recruiters A (viewer) and B (scorer), two rounds, three candidates in round 1. B has scored c1 (5.0) and c2 (2.0). */
async function blindWorld() {
  const { officer, drive, recruiter: A } = await setup(app);
  const Bk = await makeRecruiter(app, officer, drive.id);
  const r1 = await makeRound(app, officer, drive.id, { name: 'Round 1', kind: 'technical' });
  const r2 = await makeRound(app, officer, drive.id, { name: 'Round 2', kind: 'hr' });
  await setRubric(app, officer, drive.id);
  const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await makeCandidate(app, officer, drive.id));
  await addToRound(app, officer, drive.id, r1.id, cs.map((c) => c.applicationId));
  const card = (who: any, c: any, round: any, a: number, b: number) =>
    request(app).put(`${d(drive.id)}/candidates/${c.applicationId}/scorecards/${round.id}`).set(auth(who))
      .send({ ratings: [{ itemId: 'problem', rating: a }, { itemId: 'comm', rating: b }], recommendation: a >= 4 ? 'strong_hire' : 'no_hire' });
  expect((await card(Bk, cs[0], r1, 5, 5)).status).toBe(201);
  expect((await card(Bk, cs[1], r1, 2, 2)).status).toBe(201);
  const list = (who: any, qs = '') => request(app).get(`${d(drive.id)}/candidates${qs}`).set(auth(who));
  const detail = (who: any, c: any) => request(app).get(`${d(drive.id)}/candidates/${c.applicationId}`).set(auth(who));
  const roundList = (who: any, round: any, qs = '') => request(app).get(`${d(drive.id)}/rounds/${round.id}/candidates${qs}`).set(auth(who));
  const row = (res: any, c: any) => res.body.items.find((x: any) => x.applicationId === c.applicationId);
  return { officer, drive, A, B: Bk, r1, r2, cs, card, list, detail, roundList, row };
}

describe('blind scorecards: score-derived aggregates', () => {
  it('candidate list: recruiter sees no avgScore until their own scorecard; counts stay; officer always sees', async () => {
    const w = await blindWorld();
    const before = await w.list(w.A);
    expect(before.status).toBe(200);
    expect(w.row(before, w.cs[0])).toMatchObject({ scorecardCount: 1, avgScore: null });
    expect(w.row(before, w.cs[1])).toMatchObject({ scorecardCount: 1, avgScore: null });
    const off = await w.list(w.officer);
    expect(w.row(off, w.cs[0]).avgScore).toBe(5);
    expect(w.row(off, w.cs[1]).avgScore).toBe(2);

    expect((await w.card(w.A, w.cs[0], w.r1, 3, 3)).status).toBe(201);
    const after = await w.list(w.A);
    expect(w.row(after, w.cs[0])).toMatchObject({ scorecardCount: 2, avgScore: 4 }); // (5 + 3) / 2
    expect(w.row(after, w.cs[1])).toMatchObject({ scorecardCount: 1, avgScore: null }); // still blind for the candidate A has not scored
    expect(w.row(await w.list(w.B), w.cs[1]).avgScore).toBe(2); // B authored it
  });

  it('candidate detail: scoreSummary avg and byRecommendation are withheld, count and hiddenCount kept; revealed after submit', async () => {
    const w = await blindWorld();
    const before = (await w.detail(w.A, w.cs[0])).body.candidate;
    expect(before.scorecards).toEqual([]);
    expect(before.scoreSummary).toEqual({ count: 1, avg: null, byRecommendation: {}, hiddenCount: 1 });
    const off = (await w.detail(w.officer, w.cs[0])).body.candidate;
    expect(off.scoreSummary).toEqual({ count: 1, avg: 5, byRecommendation: { strong_hire: 1 } });
    expect(off.scorecards).toHaveLength(1);

    await w.card(w.A, w.cs[0], w.r1, 3, 3);
    const after = (await w.detail(w.A, w.cs[0])).body.candidate;
    expect(after.scorecards).toHaveLength(2);
    expect(after.scoreSummary).toEqual({ count: 2, avg: 4, byRecommendation: { strong_hire: 1, no_hire: 1 }, hiddenCount: 0 });
  });

  it('aggregates only cover rounds the recruiter has submitted in (no leak of other rounds via the candidate-level summary)', async () => {
    const w = await blindWorld();
    await addToRound(app, w.officer, w.drive.id, w.r2.id, [w.cs[0].applicationId]);
    expect((await w.card(w.B, w.cs[0], w.r2, 1, 1)).status).toBe(201);
    await w.card(w.A, w.cs[0], w.r1, 3, 3); // A scores round 1 only
    const detail = (await w.detail(w.A, w.cs[0])).body.candidate;
    expect(detail.scoreSummary).toMatchObject({ count: 3, avg: 4, hiddenCount: 1 }); // round 2 card (1.0) stays out of the average
    expect(w.row(await w.list(w.A), w.cs[0]).avgScore).toBe(4);
    expect(w.row(await w.list(w.officer), w.cs[0]).avgScore).toBe(3); // (5 + 3 + 1) / 3
    expect((await w.detail(w.officer, w.cs[0])).body.candidate.scoreSummary.avg).toBe(3);
  });

  it('blindScorecards=false returns everything to recruiters', async () => {
    const w = await blindWorld();
    await request(app).put(`${d(w.drive.id)}/settings`).set(auth(w.officer)).send({ blindScorecards: false });
    expect(w.row(await w.list(w.A), w.cs[0]).avgScore).toBe(5);
    expect((await w.detail(w.A, w.cs[0])).body.candidate.scoreSummary).toEqual({ count: 1, avg: 5, byRecommendation: { strong_hire: 1 } });
    expect((await w.list(w.A, '?sort=score')).status).toBe(200);
  });
});

describe('blind scorecards: score-based sorting', () => {
  it('rejects sort=score with 400 for recruiters in blind mode (even after submitting), allows officers and non-blind', async () => {
    const w = await blindWorld();
    const bad = await w.list(w.A, '?sort=score');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.fields.sort).toBeTruthy();
    await w.card(w.A, w.cs[0], w.r1, 3, 3);
    expect((await w.list(w.A, '?sort=score')).status).toBe(400);
    expect((await w.list(w.A, '?sort=cgpa')).status).toBe(200);
    expect((await w.list(w.A, '?sort=name')).status).toBe(200);
    const off = await w.list(w.officer, '?sort=score');
    expect(off.status).toBe(200);
    expect(off.body.items.map((x: any) => x.avgScore).slice(0, 2)).toEqual([4, 2]);
    await request(app).put(`${d(w.drive.id)}/settings`).set(auth(w.officer)).send({ blindScorecards: false });
    expect((await w.list(w.A, '?sort=score')).status).toBe(200);
  });

  it('round candidates rejects a score sort for blind recruiters', async () => {
    const w = await blindWorld();
    expect((await w.roundList(w.A, w.r1, '?sort=score')).status).toBe(400);
    expect((await w.roundList(w.A, w.r1, '?sort=avgScore')).status).toBe(400);
    expect((await w.roundList(w.officer, w.r1, '?sort=score')).status).toBe(200);
  });
});

describe('blind scorecards: round view and advance', () => {
  it('round candidates: avgScore withheld until own scorecard in that round; officer sees all', async () => {
    const w = await blindWorld();
    const before = await w.roundList(w.A, w.r1);
    expect(before.status).toBe(200);
    expect(before.body.items.every((x: any) => x.avgScore === null)).toBe(true);
    expect(before.body.counts).toBeTruthy();
    const off = await w.roundList(w.officer, w.r1);
    expect(w.row(off, w.cs[0]).avgScore).toBe(5);
    expect(w.row(off, w.cs[1]).avgScore).toBe(2);
    await w.card(w.A, w.cs[0], w.r1, 3, 3);
    const after = await w.roundList(w.A, w.r1);
    expect(w.row(after, w.cs[0]).avgScore).toBe(4);
    expect(w.row(after, w.cs[1]).avgScore).toBeNull();
  });

  async function advanceWorld() {
    const w = await blindWorld();
    await setRoundStatus(app, w.officer, w.drive.id, w.r1.id, w.cs.map((c) => ({ applicationId: c.applicationId, status: 'passed' })));
    const url = `${d(w.drive.id)}/rounds/${w.r1.id}/advance`;
    return { ...w, url };
  }

  it('advance preview: no avgScore, no score ordering, and no score-based capacity cut for blind recruiters', async () => {
    const w = await advanceWorld();
    const prev = await request(app).post(`${w.url}/preview`).set(auth(w.A)).send({});
    expect(prev.status).toBe(200);
    expect(prev.body.toInvite.map((x: any) => x.avgScore)).toEqual([null, null, null]);
    // submission order (not score order): c1 (5.0), c2 (2.0), c3 (unscored)
    expect(prev.body.toInvite.map((x: any) => x.applicationId)).toEqual(w.cs.map((c) => c.applicationId));
    const cap = await request(app).post(`${w.url}/preview`).set(auth(w.A)).send({ capacity: 1 });
    expect(cap.status).toBe(400);
    expect(cap.body.error.fields.capacity).toBeTruthy();
    expect((await request(app).post(`${w.url}/preview`).set(auth(w.A)).send({ capacity: 3 })).status).toBe(200); // no cut -> no ranking
    // officer still ranks by score
    const off = await request(app).post(`${w.url}/preview`).set(auth(w.officer)).send({ capacity: 1 });
    expect(off.body.toInvite.map((x: any) => x.avgScore)).toEqual([5]);
    expect(off.body.toWaitlist.map((x: any) => x.avgScore)).toEqual([2, null]);
  });

  it('advance preview: scores revealed for candidates the recruiter has scored in that round', async () => {
    const w = await advanceWorld();
    await w.card(w.A, w.cs[0], w.r1, 3, 3);
    const prev = await request(app).post(`${w.url}/preview`).set(auth(w.A)).send({});
    const byApp = Object.fromEntries(prev.body.toInvite.map((x: any) => [x.applicationId, x.avgScore]));
    expect(byApp[w.cs[0].applicationId]).toBe(4);
    expect(byApp[w.cs[1].applicationId]).toBeNull();
  });

  it('advance replay: a result stored by an officer does not leak scores or ranking to a blind recruiter', async () => {
    const w = await advanceWorld();
    const key = randomUUID();
    const go = await request(app).post(w.url).set(auth(w.officer)).send({ capacity: 2, confirm: true, idempotencyKey: key });
    expect(go.status).toBe(200);
    expect(go.body.moved.map((x: any) => x.avgScore)).toEqual([5, 2]); // officer view
    const replay = await request(app).post(w.url).set(auth(w.A)).send({ capacity: 2, confirm: true, idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect([...replay.body.moved, ...replay.body.waitlisted].every((x: any) => x.avgScore === null)).toBe(true);
    const offReplay = await request(app).post(w.url).set(auth(w.officer)).send({ capacity: 2, confirm: true, idempotencyKey: key });
    expect(offReplay.body.moved.map((x: any) => x.avgScore)).toEqual([5, 2]);
  });

  it('a recruiter-run advance without capacity succeeds and does not expose scores', async () => {
    const w = await advanceWorld();
    const go = await request(app).post(w.url).set(auth(w.A)).send({ confirm: true, idempotencyKey: randomUUID() });
    expect(go.status).toBe(200);
    expect(go.body.moved).toHaveLength(3);
    expect(go.body.moved.every((x: any) => x.avgScore === null)).toBe(true);
  });
});

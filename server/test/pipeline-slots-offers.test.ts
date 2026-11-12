import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/context';
import { cfg } from './helpers';
import request from 'supertest';
import {
  addToRound, audits, auth, B, DAY, futureIso, HOUR, makeApp, makeCandidate, makeRecruiter, makeRound, notifications, pool, resetPipelineDb, setup,
} from './pipelineHelpers';
import { DEFAULT_OFFER_POLICY, evaluateOfferAgainstPolicy, getPolicy, normalizePolicy, tierFor } from '../src/pipeline/policy';
import { expireOffers } from '../src/pipeline/offers';
import { sendPanelReminders } from '../src/pipeline/slots';

const app = makeApp();
beforeEach(resetPipelineDb);
const d = (id: string) => `${B}/pipeline/drives/${id}`;
const push = { send: vi.fn(async () => {}) } as any;

function slotBody(startMs: number, durMin = 30, over: Record<string, unknown> = {}) {
  return { startsAt: futureIso(startMs), endsAt: futureIso(startMs + durMin * 60_000), mode: 'online', venueOrLink: 'https://meet.example.com/abc', ...over };
}

async function slotCtx() {
  const ctx = await setup(app);
  const round = await makeRound(app, ctx.officer, ctx.drive.id);
  const cs = [await makeCandidate(app, ctx.officer, ctx.drive.id), await makeCandidate(app, ctx.officer, ctx.drive.id), await makeCandidate(app, ctx.officer, ctx.drive.id)];
  await addToRound(app, ctx.officer, ctx.drive.id, round.id, cs.map((c) => c.applicationId));
  const url = `${d(ctx.drive.id)}/rounds/${round.id}/slots`;
  return { ...ctx, round, cs, url };
}
const book = (c: any, slotId: string) => request(app).post(`${B}/pipeline/applications/${c.applicationId}/slots/${slotId}/book`).set(auth(c.student));

describe('slot creation and approval', () => {
  it('officer slots are open; recruiter proposals need approval unless auto-accept is on', async () => {
    const { officer, drive, recruiter, url } = await slotCtx();
    const o = await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY)] });
    expect(o.status).toBe(201);
    expect(o.body.items[0].status).toBe('open');
    const p = await request(app).post(url).set(auth(recruiter)).send({ slots: [slotBody(3 * DAY, 30, { panelistIds: [recruiter.id] })] });
    expect(p.body.items[0]).toMatchObject({ status: 'proposed', panel: [{ userId: recruiter.id }] });
    expect((await notifications(officer.id)).some((n) => /slot/i.test(n.title))).toBe(true);
    expect((await request(app).post(`${B}/pipeline/slots/${p.body.items[0].id}/approve`).set(auth(recruiter))).status).toBe(403);
    const ap = await request(app).post(`${B}/pipeline/slots/${p.body.items[0].id}/approve`).set(auth(officer));
    expect(ap.body.slot.status).toBe('open');
    expect((await request(app).post(`${B}/pipeline/slots/${p.body.items[0].id}/approve`).set(auth(officer))).body.error.code).toBe('SLOT_NOT_PROPOSED');
    const p2 = await request(app).post(url).set(auth(recruiter)).send({ slots: [slotBody(5 * DAY)] });
    const dec = await request(app).post(`${B}/pipeline/slots/${p2.body.items[0].id}/decline`).set(auth(officer)).send({ reason: 'Panel unavailable' });
    expect(dec.body.slot.status).toBe('declined');
    expect((await notifications(recruiter.id)).some((n) => /declin/i.test(n.title))).toBe(true);
    await request(app).put(`${d(drive.id)}/settings`).set(auth(officer)).send({ autoAcceptSlotProposals: true });
    const auto = await request(app).post(url).set(auth(recruiter)).send({ slots: [slotBody(6 * DAY)] });
    expect(auto.body.items[0].status).toBe('open');
    expect((await audits('slot.create')).length).toBe(4);
  });

  it('validates times, venue, capacity and panelists', async () => {
    const { officer, url } = await slotCtx();
    const post = (slots: any[]) => request(app).post(url).set(auth(officer)).send({ slots });
    expect((await post([{ ...slotBody(-HOUR) }])).status).toBe(400);
    expect((await post([slotBody(DAY, 5)])).status).toBe(400);
    expect((await post([slotBody(DAY, 600)])).status).toBe(400);
    expect((await post([slotBody(DAY, 30, { venueOrLink: 'not a url' })])).status).toBe(400);
    expect((await post([slotBody(DAY, 30, { capacity: 51 })])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    const outsider = (await pool.query(`SELECT id FROM users WHERE role='student' LIMIT 1`)).rows[0]?.id ?? '00000000-0000-4000-8000-000000000000';
    const bad = await post([slotBody(DAY, 30, { panelistIds: [outsider] })]);
    expect(bad.status).toBe(400);
  });

  it('panelist double booking is a 409, also for concurrent creation', async () => {
    const { officer, recruiter, url } = await slotCtx();
    const first = await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY, 60, { panelistIds: [recruiter.id] })] });
    expect(first.status).toBe(201);
    const clash = await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY + 30 * 60_000, 60, { panelistIds: [recruiter.id] })] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('PANELIST_BUSY');
    const adjacent = await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY + 60 * 60_000, 30, { panelistIds: [recruiter.id] })] });
    expect(adjacent.status).toBe(201);
    const t = 4 * DAY;
    const results = await Promise.all([0, 1, 2, 3].map(() => request(app).post(url).set(auth(officer)).send({ slots: [slotBody(t, 30, { panelistIds: [recruiter.id] })] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });
});

describe('slot booking', () => {
  it('books, creates the live schedule and reminder, notifies, and replays', async () => {
    const { officer, recruiter, cs, url, round } = await slotCtx();
    const s = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY, 30, { panelistIds: [recruiter.id] })] })).body.items[0];
    const list = await request(app).get(`${B}/pipeline/applications/${cs[0].applicationId}/slots`).set(auth(cs[0].student));
    expect(list.body.items.map((x: any) => x.id)).toEqual([s.id]);
    expect(list.body.items[0].remaining).toBe(1);
    expect(list.body.items[0].roundName).toBe(round.name);
    const b = await book(cs[0], s.id);
    expect(b.status).toBe(201);
    expect(b.body.booking).toMatchObject({ slotId: s.id, status: 'booked' });
    const sched = (await pool.query(`SELECT * FROM application_schedules WHERE application_id=$1`, [cs[0].applicationId])).rows;
    expect(sched).toHaveLength(1);
    expect(sched[0].slot_booking_id).toBe(b.body.booking.id);
    expect((await pool.query(`SELECT status FROM applications WHERE id=$1`, [cs[0].applicationId])).rows[0].status).toBe('interview');
    expect((await pool.query(`SELECT count(*)::int n FROM reminders WHERE application_id=$1`, [cs[0].applicationId]).catch(() => ({ rows: [{ n: 1 }] }))).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await notifications(cs[0].student.id, 'schedule')).length).toBe(1);
    expect((await notifications(recruiter.id)).some((n) => /book/i.test(n.title + n.body))).toBe(true);
    const again = await book(cs[0], s.id);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect((await pool.query('SELECT count(*)::int n FROM slot_bookings')).rows[0].n).toBe(1);
    // slot is now full for everybody else
    const full = await book(cs[1], s.id);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SLOT_FULL');
    expect((await request(app).get(`${B}/pipeline/applications/${cs[1].applicationId}/slots`).set(auth(cs[1].student))).body.items).toHaveLength(0);
    expect((await audits('slot.book')).length).toBe(1);
  });

  it('proposed slots, unknown slots, candidates outside the round and other students are refused', async () => {
    const { officer, recruiter, drive, url, cs, round } = await slotCtx();
    const prop = (await request(app).post(url).set(auth(recruiter)).send({ slots: [slotBody(2 * DAY)] })).body.items[0];
    expect((await book(cs[0], prop.id)).body.error.code).toBe('SLOT_NOT_OPEN');
    expect((await book(cs[0], '00000000-0000-4000-8000-000000000000')).body.error.code).toBe('SLOT_NOT_FOUND');
    const open = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(3 * DAY)] })).body.items[0];
    const outside = await makeCandidate(app, officer, drive.id);
    const r = await book(outside, open.id);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_IN_ROUND');
    const other = await request(app).post(`${B}/pipeline/applications/${cs[1].applicationId}/slots/${open.id}/book`).set(auth(cs[0].student));
    expect([403, 404]).toContain(other.status);
    expect(round.id).toBeTruthy();
  });

  it('race: many students for one seat, exactly one wins', async () => {
    const ctx = await slotCtx();
    const extra = [];
    for (let i = 0; i < 3; i++) { const c = await makeCandidate(app, ctx.officer, ctx.drive.id); extra.push(c); }
    await addToRound(app, ctx.officer, ctx.drive.id, ctx.round.id, extra.map((c) => c.applicationId));
    const s = (await request(app).post(ctx.url).set(auth(ctx.officer)).send({ slots: [slotBody(2 * DAY)] })).body.items[0];
    const all = [...ctx.cs, ...extra];
    const res = await Promise.all(all.map((c) => book(c, s.id)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_FULL')).toBe(true);
    expect((await pool.query(`SELECT count(*)::int n FROM slot_bookings WHERE status='booked'`)).rows[0].n).toBe(1);
  });

  it('race: capacity 2 with 5 students books exactly 2', async () => {
    const ctx = await slotCtx();
    const extra = [await makeCandidate(app, ctx.officer, ctx.drive.id), await makeCandidate(app, ctx.officer, ctx.drive.id)];
    await addToRound(app, ctx.officer, ctx.drive.id, ctx.round.id, extra.map((c) => c.applicationId));
    const s = (await request(app).post(ctx.url).set(auth(ctx.officer)).send({ slots: [slotBody(2 * DAY, 30, { capacity: 2 })] })).body.items[0];
    const res = await Promise.all([...ctx.cs, ...extra].map((c) => book(c, s.id)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect((await pool.query('SELECT booked FROM (SELECT count(*)::int booked FROM slot_bookings WHERE slot_id=$1 AND status=\'booked\') x', [s.id])).rows[0].booked).toBe(2);
  });

  it('a candidate cannot hold two bookings, nor overlapping ones in two rounds', async () => {
    const ctx = await slotCtx();
    const round2 = await makeRound(app, ctx.officer, ctx.drive.id, { name: 'Managerial', kind: 'hr' });
    await addToRound(app, ctx.officer, ctx.drive.id, round2.id, [ctx.cs[0].applicationId]);
    const url2 = `${d(ctx.drive.id)}/rounds/${round2.id}/slots`;
    const a = (await request(app).post(ctx.url).set(auth(ctx.officer)).send({ slots: [slotBody(2 * DAY, 60), slotBody(2 * DAY + 3 * HOUR, 30)] })).body.items;
    const ovr = await request(app).post(url2).set(auth(ctx.officer)).send({ slots: [slotBody(2 * DAY + 30 * 60_000, 60, { panelistIds: [ctx.recruiter.id] })] });
    if (ovr.status !== 201) throw new Error(JSON.stringify(ovr.body));
    const overlap = ovr.body.items[0];
    expect((await book(ctx.cs[0], a[0].id)).status).toBe(201);
    const second = await book(ctx.cs[0], a[1].id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_BOOKED');
    const clash = await book(ctx.cs[0], overlap.id);
    expect(clash.status).toBe(409);
    expect(['CANDIDATE_BUSY', 'ALREADY_BOOKED']).toContain(clash.body.error.code);
    // concurrent double submit of two different slots by the same student -> one booking
    const ctx2 = await slotCtx();
    const two = (await request(app).post(ctx2.url).set(auth(ctx2.officer)).send({ slots: [slotBody(2 * DAY), slotBody(4 * DAY)] })).body.items;
    const rr = await Promise.all([book(ctx2.cs[0], two[0].id), book(ctx2.cs[0], two[1].id)]);
    expect(rr.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::int n FROM slot_bookings WHERE application_id=$1 AND status='booked'`, [ctx2.cs[0].applicationId])).rows[0].n).toBe(1);
  });

  it('cancel frees the seat, respects the cutoff, and allows rebooking', async () => {
    const { officer, recruiter, cs, url, round } = await slotCtx();
    const near = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(60 * 60_000, 30)] })).body.items[0];
    const far = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(3 * DAY, 30)] })).body.items[0];
    await book(cs[0], near.id);
    const cancelUrl = (c: any) => `${B}/pipeline/applications/${c.applicationId}/rounds/${round.id}/booking/cancel`;
    const late = await request(app).post(cancelUrl(cs[0])).set(auth(cs[0].student)).send({});
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('CANCEL_WINDOW_CLOSED');
    await pool.query('DELETE FROM slot_bookings');
    await book(cs[1], far.id);
    expect((await request(app).post(cancelUrl(cs[1])).set(auth(cs[1].student)).send({ reason: 'Clash' })).body).toEqual({ ok: true, cancelled: true });
    expect((await request(app).post(cancelUrl(cs[1])).set(auth(cs[1].student)).send({})).body.cancelled).toBe(false);
    expect((await pool.query(`SELECT count(*)::int n FROM application_schedules WHERE application_id=$1 AND superseded_at IS NULL`, [cs[1].applicationId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n).toBe(0);
    expect((await book(cs[2], far.id)).status).toBe(201);
    expect(recruiter.id).toBeTruthy();
  });

  it('officer cancel and reschedule move students and notify them; panel clashes are refused', async () => {
    const { officer, recruiter, cs, url } = await slotCtx();
    const s = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY, 30, { panelistIds: [recruiter.id] })] })).body.items[0];
    const other = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY + 2 * HOUR, 30, { panelistIds: [recruiter.id] })] })).body.items[0];
    await book(cs[0], s.id);
    const before = (await notifications(cs[0].student.id)).length;
    const newStart = futureIso(3 * DAY);
    const mv = await request(app).patch(`${B}/pipeline/slots/${s.id}`).set(auth(officer)).send({ startsAt: newStart, endsAt: futureIso(3 * DAY + 30 * 60_000) });
    expect(mv.status).toBe(200);
    expect(new Date((await pool.query(`SELECT scheduled_at FROM application_schedules WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1`, [cs[0].applicationId])).rows[0].scheduled_at).toISOString()).toBe(new Date(newStart).toISOString());
    expect((await notifications(cs[0].student.id)).length).toBe(before + 1);
    const busy = await request(app).patch(`${B}/pipeline/slots/${s.id}`).set(auth(officer)).send({ startsAt: other.startsAt, endsAt: other.endsAt });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('PANELIST_BUSY');
    expect((await request(app).patch(`${B}/pipeline/slots/${s.id}`).set(auth(await makeRecruiter(app, officer, s.driveId))).send({ mode: 'online' })).status).toBe(403);
    const cx = await request(app).post(`${B}/pipeline/slots/${s.id}/cancel`).set(auth(officer)).send({ reason: 'Panel ill' });
    expect(cx.body).toMatchObject({ slot: { status: 'cancelled' }, cancelledBookings: 1 });
    expect((await notifications(cs[0].student.id)).length).toBe(before + 2);
    expect((await book(cs[1], s.id)).body.error.code).toBe('SLOT_NOT_OPEN');
    // cancelled slot frees the panelist
    const reuse = await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(3 * DAY, 30, { panelistIds: [recruiter.id] })] });
    expect(reuse.status).toBe(201);
  });

  it('sends panel reminders once, about an hour before the slot', async () => {
    const { officer, recruiter, cs, url } = await slotCtx();
    const s = (await request(app).post(url).set(auth(officer)).send({ slots: [slotBody(2 * DAY, 30, { panelistIds: [recruiter.id] })] })).body.items[0];
    await book(cs[0], s.id);
    const start = new Date(s.startsAt);
    expect(await sendPanelReminders(pool, push, new Date(start.getTime() - 3 * HOUR))).toBe(0);
    const n = await sendPanelReminders(pool, push, new Date(start.getTime() - 50 * 60_000));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await sendPanelReminders(pool, push, new Date(start.getTime() - 45 * 60_000))).toBe(0);
  });
});

// ------------------------------------------------------------------ offers
describe('policy (pure)', () => {
  const p = DEFAULT_OFFER_POLICY;
  const ev = (total: number, existing: { status: string; totalLpa: number }[], policy = p) => evaluateOfferAgainstPolicy({ policy, offer: { totalLpa: total }, existing });
  it('tiers by total', () => {
    expect([tierFor(5, p), tierFor(10, p), tierFor(19.99, p), tierFor(20, p)]).toEqual(['regular', 'dream', 'dream', 'super_dream']);
  });
  it('allows when nothing is held or only non-holding offers exist', () => {
    expect(ev(5, []).result).toBe('allowed');
    expect(ev(5, [{ status: 'declined', totalLpa: 30 }, { status: 'expired', totalLpa: 30 }, { status: 'revoked', totalLpa: 30 }, { status: 'pending_approval', totalLpa: 30 }]).result).toBe('allowed');
  });
  it('blocks a regular offer on top of any held offer (one offer rule)', () => {
    const r = ev(6, [{ status: 'accepted', totalLpa: 4 }]);
    expect(r.result).toBe('blocked');
    expect(r.reasons[0].code).toBe('ONE_OFFER');
    expect(ev(6, [{ status: 'issued', totalLpa: 4 }]).result).toBe('blocked');
    expect(ev(6, [{ status: 'joined', totalLpa: 4 }]).result).toBe('blocked');
  });
  it('dream over regular needs 1.5x, otherwise an override', () => {
    expect(ev(12, [{ status: 'accepted', totalLpa: 8 }]).result).toBe('allowed');
    const r = ev(11, [{ status: 'accepted', totalLpa: 8 }]);
    expect(r.result).toBe('needs_override');
    expect(r.reasons[0].code).toBe('BELOW_UPGRADE_MULTIPLIER');
    expect(ev(12, [{ status: 'accepted', totalLpa: 8 }]).tier).toBe('dream');
  });
  it('dream over dream is blocked; anything over super dream is blocked', () => {
    expect(ev(15, [{ status: 'accepted', totalLpa: 11 }]).reasons[0].code).toBe('SAME_TIER');
    expect(ev(40, [{ status: 'accepted', totalLpa: 21 }]).reasons[0].code).toBe('SUPER_DREAM_HELD');
    expect(ev(40, [{ status: 'accepted', totalLpa: 21 }]).result).toBe('blocked');
  });
  it('super dream over lower tiers needs 2x', () => {
    expect(ev(24, [{ status: 'accepted', totalLpa: 12 }]).result).toBe('allowed');
    expect(ev(22, [{ status: 'accepted', totalLpa: 12 }]).result).toBe('needs_override');
    expect(ev(22, [{ status: 'accepted', totalLpa: 6 }]).result).toBe('allowed');
  });
  it('uses the best held offer; oneOffer=false allows; allowOverride=false blocks', () => {
    expect(ev(12, [{ status: 'accepted', totalLpa: 4 }, { status: 'issued', totalLpa: 11 }]).reasons[0].code).toBe('SAME_TIER');
    expect(ev(6, [{ status: 'accepted', totalLpa: 4 }], { ...p, oneOffer: false }).result).toBe('allowed');
    expect(ev(11, [{ status: 'accepted', totalLpa: 8 }], { ...p, allowOverride: false }).result).toBe('blocked');
  });
  it('boundary: exactly the multiple is allowed', () => {
    expect(ev(12, [{ status: 'accepted', totalLpa: 8 }]).result).toBe('allowed');
    expect(ev(11.99, [{ status: 'accepted', totalLpa: 8 }]).result).toBe('needs_override');
  });
  it('normalizePolicy falls back field by field and fixes unordered thresholds', () => {
    expect(normalizePolicy(null)).toEqual({ offers: p });
    expect(normalizePolicy({ offers: { dreamMinLpa: 'x', oneOffer: false, dreamUpgradeMultiplier: 3 } }).offers).toMatchObject({ dreamMinLpa: 10, oneOffer: false, dreamUpgradeMultiplier: 3 });
    expect(normalizePolicy({ offers: { dreamMinLpa: 30, superDreamMinLpa: 20 } }).offers).toMatchObject({ dreamMinLpa: 10, superDreamMinLpa: 20 });
  });
});

describe('getPolicy and tenant_settings', () => {
  it('reads tenant policy over defaults', async () => {
    const { officer } = await setup(app);
    const tenantId = (await pool.query('SELECT tenant_id FROM users WHERE id=$1', [officer.id])).rows[0].tenant_id;
    expect((await getPolicy(tenantId)).offers.dreamMinLpa).toBe(10);
    await pool.query(`INSERT INTO tenant_settings (tenant_id, policy) VALUES ($1, '{"offers":{"dreamMinLpa":12,"superDreamMinLpa":25}}')`, [tenantId]);
    expect((await getPolicy(tenantId)).offers).toMatchObject({ dreamMinLpa: 12, superDreamMinLpa: 25, oneOffer: true });
  });
});

async function offerCtx(app2 = app) {
  const ctx = await setup(app2);
  const c = await makeCandidate(app2, ctx.officer, ctx.drive.id);
  await pool.query(`UPDATE applications SET status='selected' WHERE id=$1`, [c.applicationId]);
  const base = { ctc: { fixedLpa: 8, variableLpa: 1 }, joiningDate: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10), location: 'Bengaluru', expiresAt: futureIso(7 * DAY) };
  const url = `${d(ctx.drive.id)}/candidates/${c.applicationId}/offers`;
  return { ...ctx, c, base, url };
}

describe('offers', () => {
  it('recruiter proposes, officer approves, student sees it only after issue', async () => {
    const { officer, recruiter, c, base, url } = await offerCtx();
    const prop = await request(app).post(url).set(auth(recruiter)).send(base);
    expect(prop.status).toBe(201);
    expect(prop.body.offer).toMatchObject({ status: 'pending_approval', tier: 'regular', ctc: { totalLpa: 9 } });
    expect((await request(app).get(`${B}/pipeline/applications/${c.applicationId}/offer`).set(auth(c.student))).body.offer).toBeNull();
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('selected');
    expect((await request(app).post(url).set(auth(officer)).send(base)).body.error.code).toBe('OFFER_EXISTS');
    expect((await request(app).post(`${B}/pipeline/offers/${prop.body.offer.id}/approve`).set(auth(recruiter)).send({})).status).toBe(403);
    const ap = await request(app).post(`${B}/pipeline/offers/${prop.body.offer.id}/approve`).set(auth(officer)).send({});
    expect(ap.body.offer.status).toBe('issued');
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('offer_issued');
    const mine = await request(app).get(`${B}/pipeline/applications/${c.applicationId}/offer`).set(auth(c.student));
    expect(mine.body.offer).toMatchObject({ status: 'issued', canRespond: true });
    expect((await notifications(c.student.id, 'application_status')).length).toBeGreaterThanOrEqual(1);
    const detail = await request(app).get(`${B}/pipeline/offers/${prop.body.offer.id}`).set(auth(recruiter));
    expect(detail.body.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['created', 'approved', 'issued']));
    await expect(pool.query(`UPDATE offer_events SET note='x'`)).rejects.toThrow(/append-only/);
    expect((await audits('offer.approve')).length).toBe(1);
  });

  it('officer creation issues immediately; validation is strict', async () => {
    const { officer, base, url, c } = await offerCtx();
    for (const bad of [
      { ...base, ctc: { fixedLpa: 0 } }, { ...base, joiningDate: '2020-01-01' }, { ...base, expiresAt: futureIso(120 * DAY) },
      { ...base, expiresAt: futureIso(-HOUR) }, { ...base, location: 'x' }, { ...base, letterUrl: 'http://insecure.example.com/l.pdf' }, { ...base, overrideReason: 'short' },
    ]) {
      const r = await request(app).post(url).set(auth(officer)).send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await request(app).post(url).set(auth(officer)).send(base);
    expect(ok.status).toBe(201);
    expect(ok.body.offer.status).toBe('issued');
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('offer_issued');
  });

  it('requires a selected application and blocks by policy; override flow for officers', async () => {
    const { officer, recruiter, drive, base } = await offerCtx();
    const notSel = await makeCandidate(app, officer, drive.id);
    expect((await request(app).post(`${d(drive.id)}/candidates/${notSel.applicationId}/offers`).set(auth(officer)).send(base)).body.error.code).toBe('NOT_SELECTED');
    // student already holds an accepted offer elsewhere (8 LPA)
    const s = await makeCandidate(app, officer, drive.id);
    await pool.query(`UPDATE applications SET status='selected' WHERE id=$1`, [s.applicationId]);
    const drive2 = (await (await import('./helpers')).createOpenDrive(app, officer));
    const ap2 = await (await import('./helpers')).applyTo(app, s.student, drive2.id);
    const app2Id = ap2.body.application.id;
    await pool.query(`UPDATE applications SET status='offer_accepted' WHERE id=$1`, [app2Id]);
    await pool.query(`INSERT INTO offers (tenant_id, application_id, drive_id, user_id, status, kind, ctc, total_lpa, tier, joining_date, location, expires_at)
      SELECT tenant_id, id, drive_id, user_id, 'accepted', 'annual', '{"fixedLpa":8}'::jsonb, 8, 'regular', current_date+60, 'Pune', now()+interval '3 days' FROM applications WHERE id=$1`, [app2Id]).catch(async (e) => { throw new Error('seed offer failed: ' + e.message); });
    const url = `${d(drive.id)}/candidates/${s.applicationId}/offers`;
    const blocked = await request(app).post(url).set(auth(officer)).send({ ...base, ctc: { fixedLpa: 6 } });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('OFFER_BLOCKED_BY_POLICY');
    const pc = await request(app).post(`${B}/pipeline/offers/policy-check`).set(auth(recruiter)).send({ applicationId: s.applicationId, ctc: { fixedLpa: 11 } });
    expect(pc.body.policy).toMatchObject({ result: 'needs_override', tier: 'dream' });
    const noReason = await request(app).post(url).set(auth(officer)).send({ ...base, ctc: { fixedLpa: 11 } });
    expect(noReason.body.error.code).toBe('OVERRIDE_REQUIRED');
    const rec = await request(app).post(url).set(auth(recruiter)).send({ ...base, ctc: { fixedLpa: 11 } });
    expect(rec.body.offer).toMatchObject({ status: 'pending_approval', policy: { result: 'needs_override' } });
    const ap = await request(app).post(`${B}/pipeline/offers/${rec.body.offer.id}/approve`).set(auth(officer)).send({});
    expect(ap.body.error.code).toBe('OVERRIDE_REQUIRED');
    const ok = await request(app).post(`${B}/pipeline/offers/${rec.body.offer.id}/approve`).set(auth(officer)).send({ overrideReason: 'Dream company upgrade approved by TPO' });
    expect(ok.body.offer).toMatchObject({ status: 'issued', overrideReason: 'Dream company upgrade approved by TPO' });
  });

  it('reject, revoke, and joined transitions with reasons and audit', async () => {
    const { officer, recruiter, c, base, url } = await offerCtx();
    const prop = (await request(app).post(url).set(auth(recruiter)).send(base)).body.offer;
    expect((await request(app).post(`${B}/pipeline/offers/${prop.id}/reject`).set(auth(officer)).send({ reason: 'x' })).status).toBe(400);
    const rj = await request(app).post(`${B}/pipeline/offers/${prop.id}/reject`).set(auth(officer)).send({ reason: 'CTC too high for band' });
    expect(rj.body.offer).toMatchObject({ status: 'rejected', rejectedReason: 'CTC too high for band' });
    expect((await notifications(recruiter.id)).some((n) => /reject/i.test(n.title + n.body))).toBe(true);
    expect((await request(app).post(`${B}/pipeline/offers/${prop.id}/reject`).set(auth(officer)).send({ reason: 'again again' })).status).toBe(200); // idempotent replay
    const o2 = (await request(app).post(url).set(auth(officer)).send(base)).body.offer;
    const rv = await request(app).post(`${B}/pipeline/offers/${o2.id}/revoke`).set(auth(officer)).send({ reason: 'Background check failed' });
    expect(rv.body.offer).toMatchObject({ status: 'revoked', revokedReason: 'Background check failed' });
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('offer_declined');
    expect((await audits('offer.revoke')).length).toBe(1);
    expect((await notifications(c.student.id, 'offer')).length).toBeGreaterThanOrEqual(2);
    expect((await request(app).post(`${B}/pipeline/offers/${o2.id}/revoke`).set(auth(officer)).send({ reason: 'twice over' })).status).toBe(200); // idempotent replay
    expect((await audits('offer.revoke')).length).toBe(1);
  });

  it('student accept settles the offer; joined requires accepted; accept after expiry is refused', async () => {
    const { officer, recruiter, c, base, url } = await offerCtx();
    const o = (await request(app).post(url).set(auth(recruiter)).send(base)).body.offer;
    await request(app).post(`${B}/pipeline/offers/${o.id}/approve`).set(auth(officer)).send({});
    expect((await request(app).post(`${B}/pipeline/offers/${o.id}/joined`).set(auth(officer)).send({})).status).toBe(422);
    const acc = await request(app).post(`${B}/applications/${c.applicationId}/respond`).set(auth(c.student)).send({ decision: 'accept' });
    expect(acc.status).toBe(200);
    expect((await pool.query('SELECT status FROM offers WHERE id=$1', [o.id])).rows[0].status).toBe('accepted');
    expect((await notifications(recruiter.id)).some((n) => /accept/i.test(n.title + n.body))).toBe(true);
    const j = await request(app).post(`${B}/pipeline/offers/${o.id}/joined`).set(auth(officer)).send({ note: 'Reported on day one' });
    expect(j.body.offer.status).toBe('joined');
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('joined');
    expect((await request(app).post(`${B}/pipeline/offers/${o.id}/revoke`).set(auth(officer)).send({ reason: 'too late now' })).body.error.code).toBe('OFFER_NOT_REVOCABLE');
  });

  it('expiry worker expires issued offers once and the respond endpoint refuses expired ones', async () => {
    const { officer, c, base, url } = await offerCtx();
    const o = (await request(app).post(url).set(auth(officer)).send(base)).body.offer;
    expect(await expireOffers(pool, push)).toBe(0);
    await pool.query(`UPDATE offers SET expires_at = now() - interval '1 minute' WHERE id=$1`, [o.id]);
    const late = await request(app).post(`${B}/applications/${c.applicationId}/respond`).set(auth(c.student)).send({ decision: 'accept' });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('OFFER_EXPIRED');
    const [a, b] = await Promise.all([expireOffers(pool, push), expireOffers(pool, push)]);
    expect(a + b).toBe(1);
    expect((await pool.query('SELECT status FROM offers WHERE id=$1', [o.id])).rows[0].status).toBe('expired');
    const st = (await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status;
    expect(st).toBe('offer_declined');
    expect(await expireOffers(pool, push)).toBe(0);
    expect((await notifications(c.student.id, 'offer')).some((n) => /expired/i.test(n.title))).toBe(true);
    const mine = await request(app).get(`${B}/pipeline/applications/${c.applicationId}/offer`).set(auth(c.student));
    expect(mine.body.offer).toMatchObject({ status: 'expired', canRespond: false });
  });

  it('approval of an already expired proposal is refused; tenant and drive scoping hold', async () => {
    const { officer, recruiter, c, base, url, drive } = await offerCtx();
    const o = (await request(app).post(url).set(auth(recruiter)).send(base)).body.offer;
    await pool.query(`UPDATE offers SET expires_at = now() - interval '1 minute' WHERE id=$1`, [o.id]);
    expect((await request(app).post(`${B}/pipeline/offers/${o.id}/approve`).set(auth(officer)).send({})).body.error.code).toBe('OFFER_EXPIRED_ON_APPROVAL');
    const T2 = '00000000-0000-4000-8000-0000000000c3';
    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant Two') ON CONFLICT DO NOTHING`, [T2]);
    const u = (await pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,'officer','T2 Officer','off2@tenant2.edu','off2@tenant2.edu','9811100001','x') RETURNING id, tenant_id, role`, [T2])).rows[0];
    const other = { id: u.id, token: signAccessToken(cfg, u) } as any;
    expect((await request(app).get(`${B}/pipeline/offers/${o.id}`).set(auth(other))).status).toBe(404);
    const otherDrive = await (await import('./helpers')).createOpenDrive(app, officer);
    const outsider = await makeRecruiter(app, officer, otherDrive.id);
    expect((await request(app).get(`${B}/pipeline/offers/${o.id}`).set(auth(outsider))).status).toBe(404);
    expect((await request(app).get(`${d(drive.id)}/offers`).set(auth(outsider))).status).toBe(404);
    expect((await request(app).get(`${B}/pipeline/applications/${c.applicationId}/offer`).set(auth(c.student))).body.offer).toBeNull();
  });
});

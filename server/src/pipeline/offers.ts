import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../errors';
import { toCompany } from '../drives';
import type { PushSender } from '../push';
import { TRANSITIONS, AppStatus } from '../routes/applications';
import { DriveAccess, loadVisibleApplication } from './access';
import { evaluateOfferAgainstPolicy, getPolicy, HeldOffer, HOLDING_STATUSES, PolicyEvaluation } from './policy';
import { audit, iso, officerIds, Outbox } from './shared';

export interface CtcInput { fixedLpa: number; variableLpa?: number; bonusLpa?: number; joiningBonusLpa?: number; esopNote?: string | null; other?: { label: string; amountLpa: number }[] }
export interface OfferInput {
  ctc: CtcInput; joiningDate: string; location: string; expiresAt: Date; letterFileId?: string | null; letterUrl?: string | null; notes?: string | null; overrideReason?: string | null;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export const totalLpa = (c: CtcInput) => r2(c.fixedLpa + (c.variableLpa ?? 0) + (c.bonusLpa ?? 0) + (c.joiningBonusLpa ?? 0) + (c.other ?? []).reduce((s, o) => s + o.amountLpa, 0));

export function offerDto(o: any) {
  const c = o.ctc || {};
  return {
    id: o.id, applicationId: o.application_id, driveId: o.drive_id, status: o.status, kind: o.kind,
    ctc: { fixedLpa: c.fixedLpa ?? null, variableLpa: c.variableLpa ?? 0, bonusLpa: c.bonusLpa ?? 0, joiningBonusLpa: c.joiningBonusLpa ?? 0, esopNote: c.esopNote ?? null, other: c.other ?? [], totalLpa: Number(o.total_lpa) },
    joiningDate: typeof o.joining_date === 'string' ? o.joining_date : new Date(o.joining_date).toISOString().slice(0, 10),
    location: o.location, expiresAt: iso(o.expires_at), letter: { fileId: o.letter_file_id ?? null, url: o.letter_url ?? null }, notes: o.notes ?? null,
    tier: o.tier, policy: o.policy_result, overrideReason: o.override_reason ?? null,
    proposedBy: o.proposed_by ? { id: o.proposed_by, name: o.proposer_name ?? null, role: o.proposed_by_role } : null,
    approvedBy: o.approved_by ?? null, rejectedReason: o.rejected_reason ?? null, revokedReason: o.revoked_reason ?? null,
    createdAt: iso(o.created_at), issuedAt: iso(o.issued_at), respondedAt: iso(o.responded_at), joinedAt: iso(o.joined_at),
    ...(o.cand_name !== undefined ? { candidate: { name: o.cand_name, applicationReference: o.reference } } : {}),
  };
}

const OFFER_SELECT = `SELECT o.*, pu.name AS proposer_name, a.reference, sf.data->>'name' AS cand_name
  FROM offers o JOIN applications a ON a.id=o.application_id LEFT JOIN users pu ON pu.id=o.proposed_by LEFT JOIN application_shared_fields sf ON sf.application_id=a.id`;

/** Offers (and legacy status-only offers) a student currently holds, excluding one application. */
export async function heldOffers(db: Db, tenantId: string, userId: string, excludeApplicationId: string): Promise<HeldOffer[]> {
  const rows = (await db.query(`SELECT status, total_lpa FROM offers WHERE tenant_id=$1 AND user_id=$2 AND application_id <> $3 AND status = ANY($4)`, [tenantId, userId, excludeApplicationId, HOLDING_STATUSES])).rows;
  const held: HeldOffer[] = rows.map((r) => ({ status: r.status, totalLpa: Number(r.total_lpa) }));
  // offers recorded only through the status endpoint (no offers row) still count
  const legacy = (await db.query(
    `SELECT a.status, d.ctc FROM applications a JOIN drives d ON d.id=a.drive_id
      WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.id <> $3 AND a.status IN ('offer_issued','offer_accepted','joined')
        AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.application_id=a.id) AND COALESCE(d.ctc->>'kind','annual')='annual'`, [tenantId, userId, excludeApplicationId])).rows;
  for (const l of legacy) held.push({ status: l.status === 'offer_issued' ? 'issued' : l.status === 'offer_accepted' ? 'accepted' : 'joined', totalLpa: Number(l.ctc?.fixedLpa ?? 0) + Number(l.ctc?.variableLpa ?? 0) + Number(l.ctc?.bonusLpa ?? 0) });
  return held;
}

export async function evaluateForApplication(db: Db, tenantId: string, app: { id: string; user_id: string }, kind: string, total: number): Promise<PolicyEvaluation> {
  if (kind !== 'annual') return { result: 'allowed', reasons: [], tier: 'regular', heldBest: null };
  const policy = (await getPolicy(tenantId, db)).offers;
  return evaluateOfferAgainstPolicy({ policy, offer: { totalLpa: total }, existing: await heldOffers(db, tenantId, app.user_id, app.id) });
}

const policyBlocked = (ev: PolicyEvaluation) => new ApiError(422, 'OFFER_BLOCKED_BY_POLICY', ev.reasons[0]?.message ?? 'Blocked by the placement policy', { policy: ev.reasons.map((r) => r.message).join(' ') });

async function addEvent(db: Db, tenantId: string, offerId: string, type: string, from: string | null, to: string | null, note: string | null, actor: { id: string | null; role: string | null }) {
  await db.query('INSERT INTO offer_events (tenant_id, offer_id, type, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tenantId, offerId, type, from, to, note, actor.id, actor.role]);
}

/** pending/new -> issued: application selected -> offer_issued, student notified. Runs inside the caller's transaction. */
async function issue(c: Db, o: Outbox, officer: { id: string; tenantId: string }, offer: any, app: any, drive: any, fromStatus: string | null, overrideReason: string | null) {
  if (new Date(offer.expires_at) <= new Date()) throw unprocessable('OFFER_EXPIRED_ON_APPROVAL', 'The offer expiry has already passed. Create a new offer with a later expiry.');
  if (app.status !== 'selected') throw unprocessable('NOT_SELECTED', `The application is ${app.status}; an offer can only be issued to a selected candidate`);
  if (!TRANSITIONS[app.status as AppStatus].includes('offer_issued')) throw unprocessable('INVALID_TRANSITION', 'Cannot issue an offer from this status');
  const upd = (await c.query(
    `UPDATE offers SET status='issued', issued_at=now(), approved_by=$2, override_reason=COALESCE($3, override_reason), updated_at=now() WHERE id=$1 RETURNING *`,
    [offer.id, officer.id, overrideReason])).rows[0];
  await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [app.id, 'offer_issued']);
  await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [app.id, 'offer_issued', 'Offer issued', officer.id, 'officer']);
  if (fromStatus === 'pending_approval') await addEvent(c, officer.tenantId, offer.id, 'approved', 'pending_approval', 'issued', null, { id: officer.id, role: 'officer' });
  await addEvent(c, officer.tenantId, offer.id, 'issued', fromStatus, 'issued', null, { id: officer.id, role: 'officer' });
  if (overrideReason) {
    await addEvent(c, officer.tenantId, offer.id, 'override', null, null, overrideReason, { id: officer.id, role: 'officer' });
    await audit(c, officer.tenantId, officer.id, 'offer.override', { offerId: offer.id, applicationId: app.id, reason: overrideReason });
  }
  const company = toCompany(drive.company).name;
  await o.send(app.user_id, 'offer', `Offer from ${company}`, `You have received an offer for ${drive.role}. Review it and respond before ${new Date(offer.expires_at).toISOString().slice(0, 10)}.`, { applicationId: app.id, driveId: drive.id, offerId: offer.id });
  if (offer.proposed_by && offer.proposed_by_role === 'recruiter') await o.send(offer.proposed_by, 'offer', 'Offer approved', `Your offer proposal for ${app.reference} was approved and issued.`, { applicationId: app.id, offerId: offer.id });
  return upd;
}

export async function createOffer(pool: Pool, push: PushSender, access: DriveAccess, applicationId: string, i: OfferInput) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const app = await loadVisibleApplication(c, access, applicationId, { lock: true });
    if (app.status !== 'selected') throw unprocessable('NOT_SELECTED', `The application is ${app.status}; offers can only be made to selected candidates`);
    const open = (await c.query(`SELECT 1 FROM offers WHERE application_id=$1 AND status IN ('pending_approval','issued','accepted','joined')`, [app.id])).rowCount;
    if (open) throw conflict('OFFER_EXISTS', 'This candidate already has an open offer');
    if (access.role === 'recruiter' && i.overrideReason) throw new ApiError(400, 'VALIDATION_ERROR', 'Only a placement officer can override the policy', { overrideReason: 'Only a placement officer can override the policy' });
    const drive = access.drive;
    const kind = drive.ctc?.kind === 'stipend_monthly' ? 'stipend_monthly' : 'annual';
    const total = totalLpa(i.ctc);
    const ev = await evaluateForApplication(c, access.tenantId, app, kind, total);
    if (ev.result === 'blocked') throw policyBlocked(ev);
    if (ev.result === 'needs_override' && access.role === 'officer' && !i.overrideReason) {
      throw new ApiError(422, 'OVERRIDE_REQUIRED', ev.reasons[0].message + ' Provide overrideReason to proceed.', { overrideReason: 'Required to override the policy' });
    }
    const row = (await c.query(
      `INSERT INTO offers (tenant_id, drive_id, application_id, user_id, status, kind, ctc, total_lpa, tier, joining_date, location, expires_at, letter_file_id, letter_url, notes, policy_result, proposed_by, proposed_by_role)
       VALUES ($1,$2,$3,$4,'pending_approval',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [access.tenantId, drive.id, app.id, app.user_id, kind, JSON.stringify(i.ctc), total, ev.tier, i.joiningDate, i.location, i.expiresAt, i.letterFileId ?? null, i.letterUrl ?? null, i.notes ?? null,
        JSON.stringify({ result: ev.result, reasons: ev.reasons }), access.userId, access.role])).rows[0];
    await addEvent(c, access.tenantId, row.id, 'created', null, 'pending_approval', null, { id: access.userId, role: access.role });
    await audit(c, access.tenantId, access.userId, 'offer.create', { driveId: drive.id, applicationId: app.id, offerId: row.id, totalLpa: total, policy: ev.result });
    const o = new Outbox(c, access.tenantId);
    ob.push(o);
    let final = row;
    if (access.role === 'officer') {
      final = await issue(c, o, { id: access.userId, tenantId: access.tenantId }, row, app, drive, 'pending_approval', ev.result === 'needs_override' ? i.overrideReason ?? null : null);
    } else {
      const who = (await c.query('SELECT name FROM users WHERE id=$1', [access.userId])).rows[0]?.name ?? 'A recruiter';
      await o.sendMany(await officerIds(c, access.tenantId), 'offer', `Offer to approve: ${toCompany(drive.company).name}`, `${who} proposed an offer of ${total} LPA for ${app.reference}.${ev.result === 'needs_override' ? ' Policy override needed.' : ''}`, { driveId: drive.id, applicationId: app.id, offerId: row.id });
    }
    const full = (await c.query(`${OFFER_SELECT} WHERE o.id=$1`, [final.id])).rows[0];
    return { offer: offerDto(full), policy: { result: ev.result, reasons: ev.reasons } };
  }).catch((e: any) => {
    if (e?.code === '23505') throw conflict('OFFER_EXISTS', 'This candidate already has an open offer');
    throw e;
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

export async function policyCheck(db: Db, access: DriveAccess, applicationId: string, ctc: CtcInput) {
  const app = await loadVisibleApplication(db, access, applicationId);
  const kind = access.drive.ctc?.kind === 'stipend_monthly' ? 'stipend_monthly' : 'annual';
  const total = totalLpa(ctc);
  const ev = await evaluateForApplication(db, access.tenantId, app, kind, total);
  return { policy: { result: ev.result, reasons: ev.reasons, tier: ev.tier, totalLpa: total, existing: ev.heldBest } };
}

export async function listOffers(db: Db, access: DriveAccess, status: string | undefined, limit: number, offset: number) {
  const params: unknown[] = [access.drive.id, access.tenantId];
  let where = 'o.drive_id=$1 AND o.tenant_id=$2';
  if (status) { params.push(status); where += ` AND o.status=$${params.length}`; }
  const rows = (await db.query(`${OFFER_SELECT} WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
  return { items: rows.slice(0, limit).map(offerDto), hasMore: rows.length > limit };
}

export async function getOffer(db: Db, user: { id: string; tenantId: string; role: string }, offerId: string) {
  const o = (await db.query(`${OFFER_SELECT} WHERE o.id=$1 AND o.tenant_id=$2`, [offerId, user.tenantId])).rows[0];
  const nf = () => notFound('Offer not found', 'OFFER_NOT_FOUND');
  if (!o) throw nf();
  if (user.role === 'recruiter') {
    const m = (await db.query('SELECT 1 FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 AND revoked_at IS NULL', [o.drive_id, user.id])).rowCount;
    if (!m) throw nf();
  } else if (user.role !== 'officer') throw nf();
  const events = (await db.query(
    `SELECT e.*, u.name AS actor_name FROM offer_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.offer_id=$1 ORDER BY e.id`, [offerId])).rows;
  return {
    offer: offerDto(o),
    events: events.map((e) => ({ type: e.type, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, actor: e.actor_id ? { id: e.actor_id, name: e.actor_name, role: e.actor_role } : (e.actor_role ? { id: null, name: 'System', role: e.actor_role } : null), createdAt: iso(e.created_at) })),
  };
}

type Officer = { id: string; tenantId: string; name: string };

async function lockOffer(c: Db, officer: Officer, offerId: string) {
  const o = (await c.query('SELECT * FROM offers WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [offerId, officer.tenantId])).rows[0];
  if (!o) throw notFound('Offer not found', 'OFFER_NOT_FOUND');
  return o;
}
const fullOffer = async (db: Db, id: string) => offerDto((await db.query(`${OFFER_SELECT} WHERE o.id=$1`, [id])).rows[0]);

export async function approveOffer(pool: Pool, push: PushSender, officer: Officer, offerId: string, overrideReason: string | null) {
  const ob: Outbox[] = [];
  const id = await withTx(pool, async (c) => {
    const o = await lockOffer(c, officer, offerId);
    if (o.status === 'issued') return o.id;
    if (o.status !== 'pending_approval') throw conflict('OFFER_NOT_PENDING', `This offer is ${o.status}`);
    const app = (await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [o.application_id])).rows[0];
    const drive = (await c.query('SELECT * FROM drives WHERE id=$1', [o.drive_id])).rows[0];
    const ev = await evaluateForApplication(c, officer.tenantId, app, o.kind, Number(o.total_lpa));
    if (ev.result === 'blocked') throw policyBlocked(ev);
    if (ev.result === 'needs_override' && !overrideReason) throw new ApiError(422, 'OVERRIDE_REQUIRED', ev.reasons[0].message + ' Provide overrideReason to proceed.', { overrideReason: 'Required to override the policy' });
    await c.query('UPDATE offers SET policy_result=$2, tier=$3 WHERE id=$1', [o.id, JSON.stringify({ result: ev.result, reasons: ev.reasons }), ev.tier]);
    const ox = new Outbox(c, officer.tenantId);
    ob.push(ox);
    await issue(c, ox, officer, o, app, drive, 'pending_approval', ev.result === 'needs_override' ? overrideReason : null);
    await audit(c, officer.tenantId, officer.id, 'offer.approve', { offerId: o.id, applicationId: app.id });
    return o.id;
  });
  for (const o of ob) await o.flush(push, pool);
  return { offer: await fullOffer(pool, id) };
}

export async function rejectOffer(pool: Pool, push: PushSender, officer: Officer, offerId: string, reason: string) {
  const ob: Outbox[] = [];
  await withTx(pool, async (c) => {
    const o = await lockOffer(c, officer, offerId);
    if (o.status === 'rejected') return;
    if (o.status !== 'pending_approval') throw conflict('OFFER_NOT_PENDING', `This offer is ${o.status}`);
    await c.query(`UPDATE offers SET status='rejected', rejected_reason=$2, updated_at=now() WHERE id=$1`, [o.id, reason]);
    await addEvent(c, officer.tenantId, o.id, 'rejected', 'pending_approval', 'rejected', reason, { id: officer.id, role: 'officer' });
    await audit(c, officer.tenantId, officer.id, 'offer.reject', { offerId: o.id, reason });
    const ox = new Outbox(c, officer.tenantId);
    ob.push(ox);
    await ox.send(o.proposed_by, 'offer', 'Offer proposal rejected', `Your offer proposal was rejected: ${reason}`, { offerId: o.id, applicationId: o.application_id });
  });
  for (const o of ob) await o.flush(push, pool);
  return { offer: await fullOffer(pool, offerId) };
}

export async function revokeOffer(pool: Pool, push: PushSender, officer: Officer, offerId: string, reason: string) {
  const ob: Outbox[] = [];
  await withTx(pool, async (c) => {
    const o = await lockOffer(c, officer, offerId);
    if (o.status === 'revoked') return;
    if (!['pending_approval', 'issued'].includes(o.status)) throw unprocessable('OFFER_NOT_REVOCABLE', `A ${o.status} offer cannot be revoked`);
    const ox = new Outbox(c, officer.tenantId);
    ob.push(ox);
    await c.query(`UPDATE offers SET status='revoked', revoked_reason=$2, updated_at=now() WHERE id=$1`, [o.id, reason]);
    await addEvent(c, officer.tenantId, o.id, 'revoked', o.status, 'revoked', reason, { id: officer.id, role: 'officer' });
    if (o.status === 'issued') {
      const app = (await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [o.application_id])).rows[0];
      if (app.status === 'offer_issued') {
        await c.query(`UPDATE applications SET status='offer_declined', updated_at=now() WHERE id=$1`, [app.id]);
        await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [app.id, 'offer_declined', `Offer revoked by placement cell: ${reason}`, officer.id, 'officer']);
      }
      const d = (await c.query('SELECT company FROM drives WHERE id=$1', [o.drive_id])).rows[0];
      await ox.send(o.user_id, 'offer', `Offer withdrawn: ${toCompany(d.company).name}`, `The offer was withdrawn by the placement cell. ${reason}`, { applicationId: o.application_id, offerId: o.id });
    }
    if (o.proposed_by && o.proposed_by_role === 'recruiter') await ox.send(o.proposed_by, 'offer', 'Offer revoked', `An offer you proposed was revoked: ${reason}`, { offerId: o.id });
    await audit(c, officer.tenantId, officer.id, 'offer.revoke', { offerId: o.id, applicationId: o.application_id, reason, from: o.status });
  });
  for (const o of ob) await o.flush(push, pool);
  return { offer: await fullOffer(pool, offerId) };
}

export async function markJoined(pool: Pool, push: PushSender, officer: Officer, offerId: string, note: string | null) {
  const ob: Outbox[] = [];
  await withTx(pool, async (c) => {
    const o = await lockOffer(c, officer, offerId);
    if (o.status === 'joined') return;
    if (o.status !== 'accepted') throw unprocessable('OFFER_NOT_ACCEPTED', 'Only an accepted offer can be marked as joined');
    const app = (await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [o.application_id])).rows[0];
    if (app.status !== 'offer_accepted') throw unprocessable('INVALID_TRANSITION', `The application is ${app.status}`);
    await c.query(`UPDATE offers SET status='joined', joined_at=now(), updated_at=now() WHERE id=$1`, [o.id]);
    await c.query(`UPDATE applications SET status='joined', updated_at=now() WHERE id=$1`, [app.id]);
    await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [app.id, 'joined', note ?? 'Joining confirmed by placement cell', officer.id, 'officer']);
    await addEvent(c, officer.tenantId, o.id, 'joined', 'accepted', 'joined', note, { id: officer.id, role: 'officer' });
    await audit(c, officer.tenantId, officer.id, 'offer.joined', { offerId: o.id, applicationId: app.id });
    const ox = new Outbox(c, officer.tenantId);
    ob.push(ox);
    await ox.send(app.user_id, 'application_status', 'Joining confirmed', 'The placement cell confirmed that you have joined.', { applicationId: app.id });
  });
  for (const o of ob) await o.flush(push, pool);
  return { offer: await fullOffer(pool, offerId) };
}

export async function studentOffer(db: Db, student: { id: string; tenantId: string }, applicationId: string) {
  const a = (await db.query('SELECT id FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [applicationId, student.tenantId, student.id])).rows[0];
  if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  const o = (await db.query(`${OFFER_SELECT} WHERE o.application_id=$1 AND o.status IN ('issued','accepted','declined','expired','revoked','joined') ORDER BY o.created_at DESC LIMIT 1`, [a.id])).rows[0];
  if (!o) return { offer: null };
  const dto = offerDto(o) as any;
  delete dto.policy; delete dto.overrideReason; delete dto.proposedBy; delete dto.approvedBy; delete dto.notes;
  return { offer: { ...dto, canRespond: o.status === 'issued' && new Date(o.expires_at) > new Date() } };
}

// ------------------------------------------------------------------ expiry (worker)
export async function expireOffers(pool: Pool, push: PushSender, now = new Date(), batch = 100): Promise<number> {
  const ob: Outbox[] = [];
  const n = await withTx(pool, async (c) => {
    const due = (await c.query(`SELECT * FROM offers WHERE status='issued' AND expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [now, batch])).rows;
    for (const o of due) {
      await c.query(`UPDATE offers SET status='expired', updated_at=now() WHERE id=$1`, [o.id]);
      await addEvent(c, o.tenant_id, o.id, 'expired', 'issued', 'expired', 'Offer expired', { id: null, role: 'system' });
      const app = (await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [o.application_id])).rows[0];
      if (app.status === 'offer_issued') {
        await c.query(`UPDATE applications SET status='offer_declined', updated_at=now() WHERE id=$1`, [app.id]);
        await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,NULL,$4)', [app.id, 'offer_declined', 'Offer expired', 'system']);
      }
      const d = (await c.query('SELECT company, role FROM drives WHERE id=$1', [o.drive_id])).rows[0];
      const ox = new Outbox(c, o.tenant_id);
      ob.push(ox);
      const company = toCompany(d.company).name;
      await ox.send(o.user_id, 'offer', `Offer expired: ${company}`, `Your offer for ${d.role} expired because it was not answered in time.`, { applicationId: o.application_id, offerId: o.id });
      await ox.sendMany([...(await officerIds(c, o.tenant_id)), o.proposed_by_role === 'recruiter' ? o.proposed_by : null], 'offer', `Offer expired: ${company}`, `The offer for ${app.reference} expired without a response.`, { applicationId: o.application_id, offerId: o.id });
      await audit(c, o.tenant_id, null, 'offer.expire', { offerId: o.id, applicationId: o.application_id });
    }
    return due.length;
  });
  for (const o of ob) await o.flush(push, pool);
  return n;
}
void forbidden;

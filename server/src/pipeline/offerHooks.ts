import type { Db } from '../db';
import { unprocessable } from '../errors';
import { Outbox } from './shared';

/** Called by POST /applications/:id/respond before it writes: a lapsed offer cannot be answered. */
export async function assertOfferNotExpired(db: Db, applicationId: string): Promise<void> {
  const r = await db.query(`SELECT 1 FROM offers WHERE application_id=$1 AND status='issued' AND expires_at <= clock_timestamp()`, [applicationId]);
  if (r.rowCount) throw unprocessable('OFFER_EXPIRED', 'This offer has expired and can no longer be accepted or declined. Contact the placement cell.');
}

/** Called by POST /applications/:id/respond after it writes: tells the proposing recruiter (the offer row itself is synced by a DB trigger). */
export async function notifyOfferResponded(db: Db, tenantId: string, application: { id: string; user_id: string; reference: string }, decision: 'accept' | 'decline', studentName: string): Promise<void> {
  const o = (await db.query(`SELECT id, proposed_by, proposed_by_role FROM offers WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1`, [application.id])).rows[0];
  if (!o || o.proposed_by_role !== 'recruiter' || !o.proposed_by) return;
  const verb = decision === 'accept' ? 'accepted' : 'declined';
  await new Outbox(db, tenantId).send(o.proposed_by, 'offer', `Offer ${verb}`, `${studentName} ${verb} the offer (${application.reference}).`, { applicationId: application.id, offerId: o.id });
}

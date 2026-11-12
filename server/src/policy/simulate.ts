import type { Db } from '../db';
import { evaluateEligibility } from '../eligibility';
import { driveCtxFromRow, evaluateWithPolicy, offerInfoFromLpas, StudentCtx } from './engine';
import { getActiveRestrictions, restrictedReason } from './restrictions';
import { loadActiveRestrictionRows } from './assess';
import { getActivePolicy } from './store';
import type { Policy } from './schema';

type Status = 'eligible' | 'not_eligible' | 'pending' | 'restricted';
const zero = () => ({ eligible: 0, notEligible: 0, pending: 0, restricted: 0 });
const bump = (o: ReturnType<typeof zero>, s: Status) => { if (s === 'eligible') o.eligible++; else if (s === 'not_eligible') o.notEligible++; else if (s === 'pending') o.pending++; else o.restricted++; };

export interface SimulateInput { candidate: Policy; candidateLabel: string; driveId?: string }

export async function simulatePolicy(db: Db, tenantId: string, input: SimulateInput) {
  const current = await getActivePolicy(db, tenantId);
  const drives = input.driveId
    ? (await db.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2 AND status<>'draft'`, [input.driveId, tenantId])).rows
    : (await db.query(`SELECT * FROM drives WHERE tenant_id=$1 AND status='open' AND deadline > now() ORDER BY created_at`, [tenantId])).rows;
  const studs = (await db.query(
    `SELECT u.id, u.name, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL ORDER BY u.id`, [tenantId])).rows;
  const offerRows = (await db.query(
    `SELECT a.user_id, d.ctc FROM applications a JOIN drives d ON d.id=a.drive_id WHERE a.tenant_id=$1 AND a.status IN ('offer_accepted','joined')`, [tenantId])).rows;
  const lpas = new Map<string, (number | null)[]>();
  for (const o of offerRows) {
    const c = o.ctc || {};
    const v = (c.kind || 'annual') === 'annual' && typeof c.fixedLpa === 'number' ? (c.fixedLpa || 0) + (c.variableLpa || 0) + (c.bonusLpa || 0) : null;
    if (!lpas.has(o.user_id)) lpas.set(o.user_id, []);
    lpas.get(o.user_id)!.push(v);
  }
  const restrictions = await loadActiveRestrictionRows(db, tenantId);

  const cur = zero(), cand = zero();
  const perReason = new Map<string, { failed: number; missing: number }>();
  const diff = { newlyEligible: 0, newlyIneligible: 0, newlyPending: 0, unchanged: 0 };
  const samples = { newlyIneligible: [] as any[], newlyEligible: [] as any[] };

  for (const d of drives) {
    const dctx = driveCtxFromRow(d);
    for (const s of studs) {
      const sc: StudentCtx = {
        id: s.id, name: s.name, academics: s.data?.academics, verification: s.verification, contact: s.data?.contact, skills: s.data?.skills,
        offers: offerInfoFromLpas(lpas.get(s.id) || []),
      };
      const hit = getActiveRestrictions({ id: s.id, department: s.data?.academics?.department, batchYear: s.data?.academics?.batchYear },
        { id: d.id, companyName: d.company?.name, companyId: d.company_id }, restrictions);
      const a = hit.length ? ({ status: 'restricted', reasons: [], reason: restrictedReason(hit[0]).message } as any) : evaluateWithPolicy(current?.policy ?? null, dctx, sc);
      const b = hit.length ? a : evaluateWithPolicy(input.candidate, dctx, sc);
      bump(cur, a.status); bump(cand, b.status);
      for (const rs of b.reasons as any[]) {
        if (rs.met === true) continue;
        const slot = perReason.get(rs.criterion) || { failed: 0, missing: 0 };
        if (rs.met === false) slot.failed++; else slot.missing++;
        perReason.set(rs.criterion, slot);
      }
      if (a.status === b.status) diff.unchanged++;
      else if (b.status === 'eligible') {
        diff.newlyEligible++;
        if (samples.newlyEligible.length < 5) samples.newlyEligible.push({ studentId: s.id, name: s.name, driveId: d.id, reason: b.reasons.find((x: any) => x.criterion === 'policy')?.message ?? 'Meets all criteria' });
      } else if (b.status === 'not_eligible') {
        diff.newlyIneligible++;
        if (samples.newlyIneligible.length < 5) samples.newlyIneligible.push({ studentId: s.id, name: s.name, driveId: d.id, reason: b.reason });
      } else if (b.status === 'pending') diff.newlyPending++;
      else diff.unchanged++;
    }
  }
  void evaluateEligibility;
  return {
    against: { currentVersion: current ? { id: current.version.id, version: current.version.version } : null, candidate: input.candidateLabel },
    drives: drives.length, students: studs.length, current: cur, candidate: cand,
    perReason: [...perReason.entries()].map(([criterion, v]) => ({ criterion, ...v })).sort((x, y) => y.failed - x.failed || y.missing - x.missing),
    diff, samples,
  };
}

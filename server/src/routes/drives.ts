import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, denyRecruiter, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import {
  completenessGaps, driveCreateSchema, driveDetail, driveListItem, driveUpdateSchema, effectiveStatus, eligibilityFor,
  normalizeQuestions, totalPackage,
} from '../drives';
import { ApiError, conflict, notFound, parse, unprocessable, wrap } from '../errors';
import { createNotification } from '../notify';
import { getProfileRow } from '../profile';
import { cancelForDrive, rescheduleForDrive, scheduleForDrive } from '../reminders';
import { evaluateEligibility } from '../eligibility';
import { formatIstStamp, toCsv } from '../csv';
import { formatPhone } from '../validation';
import { integ } from '../integrations';
import type { Db } from '../db';
import { loadActiveRestrictionRows, restrictedOverlay } from '../policy/assess';

export const encodeCursor = (n: number) => Buffer.from(`o:${n}`).toString('base64url');
export function decodeCursor(c: unknown): number {
  if (typeof c !== 'string' || !c) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(c, 'base64url').toString());
  if (!m) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor', { cursor: 'Invalid cursor' });
  return Number(m[1]);
}
export function pageLimit(v: unknown, def = 20): number {
  const n = v === undefined ? def : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be 1–50', { limit: 'Must be 1–50' });
  return n;
}

const dbFields = (input: any) => {
  const set: Record<string, unknown> = {};
  if (input.company !== undefined) set.company = JSON.stringify(input.company);
  if (input.role !== undefined) set.role = input.role;
  if (input.workMode !== undefined) set.work_mode = input.workMode;
  if (input.locations !== undefined) set.locations = JSON.stringify(input.locations);
  if (input.ctc !== undefined) set.ctc = JSON.stringify(input.ctc);
  if (input.deadline !== undefined) set.deadline = input.deadline;
  if (input.jd !== undefined) set.jd = input.jd;
  if (input.requirements !== undefined) set.requirements = JSON.stringify(input.requirements);
  if (input.rounds !== undefined) set.rounds = JSON.stringify(input.rounds);
  if (input.questions !== undefined) set.questions = JSON.stringify(normalizeQuestions(input.questions));
  if (input.policyNote !== undefined) set.policy_note = input.policyNote;
  if (input.contact !== undefined) set.contact = JSON.stringify(input.contact);
  if (input.rules !== undefined) set.rules = JSON.stringify(input.rules);
  if (input.lastVerifiedAt !== undefined) set.last_verified_at = input.lastVerifiedAt;
  return set;
};

export function driveRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();

  /** company.logoFileId -> company.logoUrl (R2_PUBLIC_BASE_URL + key). Mutates the parsed input. */
  async function applyCompanyLogo(db: Db, tenantId: string, company: any) {
    if (!company || company.logoFileId === undefined) return;
    if (company.logoFileId === null) { company.logoUrl = null; delete company.logoFileId; return; }
    const st = integ(deps).storage;
    if (!st) throw new ApiError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'File storage is not configured on this server');
    const f = (await db.query(
      `SELECT f.key FROM files f JOIN users o ON o.id=f.owner_id
        WHERE f.id=$1 AND f.tenant_id=$2 AND f.purpose='company_logo' AND f.status='ready' AND o.role='officer' AND o.tenant_id=$2 AND o.deleted_at IS NULL`,
      [company.logoFileId, tenantId])).rows[0];
    if (!f) throw new ApiError(400, 'VALIDATION_ERROR', 'Upload and confirm the company logo first', { 'company.logoFileId': 'Choose an uploaded company logo' });
    if (!st.publicBaseUrl) throw unprocessable('LOGO_PUBLIC_URL_NOT_CONFIGURED', 'R2_PUBLIC_BASE_URL is not set, so logos cannot be published');
    company.logoUrl = `${st.publicBaseUrl}/${f.key}`;
  }
  r.use(authenticate(deps), denyRecruiter);

  async function getDrive(tenantId: string, id: string, db: { query: Function } = pool, lock = false) {
    const row = (await db.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, tenantId])).rows[0];
    if (!row) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    return row;
  }

  // ------------------------------------------------------------ list
  r.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['open', 'closing', 'closed', 'draft']).optional(),
      eligibility: z.enum(['eligible', 'not_eligible', 'pending']).optional(),
      sort: z.enum(['closing', 'newest', 'package']).default('closing'),
      saved: z.enum(['0', '1']).optional(),
      cursor: z.string().max(100).optional(),
      limit: z.string().optional(),
    }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const now = new Date((await pool.query('SELECT now() AS n')).rows[0].n);
    const officer = u.role === 'officer';
    if (!officer && q.status === 'draft') throw new ApiError(403, 'FORBIDDEN', 'Not allowed');

    const params: unknown[] = [u.tenantId];
    let where = 'd.tenant_id=$1' + (officer ? '' : " AND d.status <> 'draft'");
    if (q.q) {
      params.push(`%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
      where += ` AND (d.company->>'name' ILIKE $${params.length} OR d.role ILIKE $${params.length} OR d.locations::text ILIKE $${params.length})`;
    }
    if (q.saved === '1') {
      params.push(u.id);
      where += ` AND EXISTS (SELECT 1 FROM saved_drives s WHERE s.drive_id=d.id AND s.user_id=$${params.length})`;
    }
    const rows = (await pool.query(`SELECT d.* FROM drives d WHERE ${where}`, params)).rows;

    let profile: any = null;
    let savedSet = new Set<string>();
    let appliedSet = new Set<string>();
    let counts = new Map<string, number>();
    if (!officer) {
      profile = await getProfileRow(pool, u.id);
      savedSet = new Set((await pool.query('SELECT drive_id FROM saved_drives WHERE user_id=$1', [u.id])).rows.map((x) => x.drive_id));
      appliedSet = new Set(
        (await pool.query(`SELECT drive_id FROM applications WHERE user_id=$1 AND status <> 'withdrawn'`, [u.id])).rows.map((x) => x.drive_id),
      );
    } else {
      counts = new Map(
        (await pool.query(`SELECT drive_id, count(*)::int n FROM applications WHERE tenant_id=$1 AND status <> 'withdrawn' GROUP BY drive_id`, [u.tenantId])).rows.map((x) => [x.drive_id, x.n]),
      );
    }

    const restrictions = officer ? [] : await loadActiveRestrictionRows(pool, u.tenantId, u.id);
    const sref = { id: u.id, department: profile?.data?.academics?.department, batchYear: profile?.data?.academics?.batchYear };
    let items = rows.map((row) => {
      const elig = officer ? null : restrictedOverlay(eligibilityFor(row, profile), sref, row, restrictions);
      const item: any = driveListItem(row, now, elig, savedSet.has(row.id), appliedSet.has(row.id));
      if (officer) item.applicantCount = counts.get(row.id) || 0;
      item._row = row;
      return item;
    });
    if (q.status) {
      items = items.filter((i) => (q.status === 'open' ? i.status === 'open' || i.status === 'closing' : i.status === q.status));
    }
    if (q.eligibility && !officer) items = items.filter((i) => i.eligibility?.status === q.eligibility);

    const dl = (i: any) => (i.deadline ? new Date(i.deadline).getTime() : Infinity);
    if (q.sort === 'closing') {
      items.sort((a, b) => {
        const ac = a.status === 'closed' ? 1 : 0;
        const bc = b.status === 'closed' ? 1 : 0;
        if (ac !== bc) return ac - bc;
        return ac ? dl(b) - dl(a) : dl(a) - dl(b);
      });
    } else if (q.sort === 'newest') {
      items.sort((a, b) => new Date(b._row.published_at || b._row.created_at).getTime() - new Date(a._row.published_at || a._row.created_at).getTime());
    } else {
      items.sort((a, b) => totalPackage(b._row.ctc) - totalPackage(a._row.ctc));
    }
    const page = items.slice(offset, offset + limit).map(({ _row, ...rest }) => rest);
    res.json({ items: page, nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null });
  }));

  // ------------------------------------------------------------ officer: create
  r.post('/', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const input = parse<any>(driveCreateSchema, req.body ?? {});
    await applyCompanyLogo(pool, u.tenantId, input.company);
    const f = dbFields(input);
    const cols = Object.keys(f);
    const sql = `INSERT INTO drives (tenant_id, created_by, status${cols.map((c) => ', ' + c).join('')})
                 VALUES ($1,$2,'draft'${cols.map((_, i) => `, $${i + 3}`).join('')}) RETURNING *`;
    const row = (await pool.query(sql, [u.tenantId, u.id, ...cols.map((c) => f[c])])).rows[0];
    res.status(201).json({ drive: driveDetail(row, new Date(), null, false, false, true) });
  }));

  // ------------------------------------------------------------ detail
  r.get('/:id', wrap(async (req, res) => {
    const u = me(req);
    const row = await getDrive(u.tenantId, pid(req));
    const officer = u.role === 'officer';
    if (!officer && row.status === 'draft') throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    const now = new Date((await pool.query('SELECT now() AS n')).rows[0].n);
    if (officer) return res.json({ drive: driveDetail(row, now, null, false, false, true) });
    const profile = await getProfileRow(pool, u.id);
    const saved = !!(await pool.query('SELECT 1 FROM saved_drives WHERE user_id=$1 AND drive_id=$2', [u.id, row.id])).rowCount;
    const applied = !!(await pool.query(`SELECT 1 FROM applications WHERE user_id=$1 AND drive_id=$2 AND status <> 'withdrawn'`, [u.id, row.id])).rowCount;
    const restrictions = await loadActiveRestrictionRows(pool, u.tenantId, u.id);
    const sref = { id: u.id, department: profile?.data?.academics?.department, batchYear: profile?.data?.academics?.batchYear };
    res.json({ drive: driveDetail(row, now, restrictedOverlay(eligibilityFor(row, profile), sref, row, restrictions) as any, saved, applied, false) });
  }));

  // ------------------------------------------------------------ officer: update
  r.put('/:id', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const input = parse<any>(driveUpdateSchema, req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const cur = await getDrive(u.tenantId, pid(req), c, true);
      if (cur.status === 'closed') throw conflict('DRIVE_CLOSED', 'A closed drive cannot be edited. Duplicate it instead.');
      const now = new Date((await c.query('SELECT now() AS n')).rows[0].n);
      await applyCompanyLogo(c, u.tenantId, input.company);
      const f = dbFields(input);
      const cols = Object.keys(f);
      if (cols.length) {
        const sql = `UPDATE drives SET ${cols.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`;
        const row = (await c.query(sql, [cur.id, u.tenantId, ...cols.map((k) => f[k])])).rows[0];
        if (cur.status === 'open') {
          const gaps = completenessGaps(row, now);
          if (Object.keys(gaps).length) throw unprocessable('DRIVE_INCOMPLETE', 'This change would leave the published drive incomplete', gaps);
          const deadlineChanged = new Date(cur.deadline).getTime() !== new Date(row.deadline).getTime();
          const rulesChanged = JSON.stringify(cur.rules) !== JSON.stringify(row.rules);
          if (deadlineChanged || rulesChanged) await rescheduleForDrive(c as any, row.id, now);
        }
        return row;
      }
      return cur;
    });
    res.json({ drive: driveDetail(out, new Date(), null, false, false, true) });
  }));

  // ------------------------------------------------------------ officer: publish
  r.post('/:id/publish', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const out = await withTx(pool, async (c) => {
      const cur = await getDrive(u.tenantId, pid(req), c, true);
      if (cur.status !== 'draft') throw conflict('ALREADY_PUBLISHED', cur.status === 'open' ? 'Drive is already published' : 'Drive is closed');
      const now = new Date((await c.query('SELECT now() AS n')).rows[0].n);
      const gaps = completenessGaps(cur, now);
      if (Object.keys(gaps).length) {
        throw unprocessable('DRIVE_INCOMPLETE', `Cannot publish: ${Object.keys(gaps).length} item(s) missing`, gaps);
      }
      const row = (
        await c.query(
          `UPDATE drives SET status='open', published_at=now(), last_verified_at=COALESCE(last_verified_at, now()), updated_at=now() WHERE id=$1 RETURNING *`,
          [cur.id],
        )
      ).rows[0];
      const n = await scheduleForDrive(c as any, row.id, now);
      // announce to eligible-or-pending students
      const studs = (await c.query(`SELECT u.id, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [u.tenantId])).rows;
      for (const s of studs) {
        const e = evaluateEligibility(row.rules, { academics: s.data?.academics, verification: s.verification });
        if (e.status === 'not_eligible') continue;
        await createNotification(c as any, u.tenantId, s.id, 'new_drive', `New drive: ${row.company.name}`, `${row.role} is open for applications.`, { driveId: row.id });
      }
      return { row, remindersFor: n };
    });
    res.json({ drive: driveDetail(out.row, new Date(), null, false, false, true), remindersScheduledFor: out.remindersFor });
  }));

  r.post('/:id/close', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const row = await withTx(pool, async (c) => {
      const cur = await getDrive(u.tenantId, pid(req), c, true);
      if (cur.status === 'draft') throw conflict('NOT_PUBLISHED', 'Draft drives cannot be closed');
      if (cur.status === 'closed') return cur;
      const upd = (await c.query(`UPDATE drives SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [cur.id])).rows[0];
      await cancelForDrive(c as any, cur.id);
      return upd;
    });
    res.json({ drive: driveDetail(row, new Date(), null, false, false, true) });
  }));

  r.post('/:id/duplicate', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const cur = await getDrive(u.tenantId, pid(req));
    const row = (
      await pool.query(
        `INSERT INTO drives (tenant_id, created_by, status, company, role, work_mode, locations, ctc, deadline, jd, requirements, rounds, questions, policy_note, contact, rules)
         VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [u.tenantId, u.id, cur.company, cur.role, cur.work_mode, JSON.stringify(cur.locations), cur.ctc, cur.jd,
          JSON.stringify(cur.requirements), JSON.stringify(cur.rounds), JSON.stringify(cur.questions), cur.policy_note, cur.contact, cur.rules],
      )
    ).rows[0];
    res.status(201).json({ drive: driveDetail(row, new Date(), null, false, false, true) });
  }));

  r.get('/:id/eligible-count', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const row = await getDrive(u.tenantId, pid(req));
    const studs = (await pool.query(`SELECT u.id, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [u.tenantId])).rows;
    const out = { total: studs.length, eligible: 0, notEligible: 0, pending: 0, perReason: {} as Record<string, { failed: number; missing: number }> };
    for (const s of studs) {
      const e = evaluateEligibility(row.rules, { academics: s.data?.academics, verification: s.verification });
      if (e.status === 'eligible') out.eligible++;
      else if (e.status === 'pending') out.pending++;
      else out.notEligible++;
      for (const reason of e.reasons) {
        const slot = (out.perReason[reason.criterion] ||= { failed: 0, missing: 0 });
        if (reason.met === false) slot.failed++;
        else if (reason.met === null) slot.missing++;
      }
    }
    res.json(out);
  }));

  r.get('/:id/applicants', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ status: z.string().max(30).optional(), cursor: z.string().optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    await getDrive(u.tenantId, pid(req));
    const params: unknown[] = [pid(req), u.tenantId];
    let where = 'a.drive_id=$1 AND a.tenant_id=$2';
    if (q.status) { params.push(q.status); where += ` AND a.status=$${params.length}`; }
    const rows = (
      await pool.query(
        `SELECT a.id, a.reference, a.status, a.submitted_at, a.snapshot, a.resume_snapshot, u.id AS uid, u.name, u.email, u.phone
           FROM applications a JOIN users u ON u.id=a.user_id WHERE ${where}
          ORDER BY a.submitted_at DESC LIMIT ${limit + 1} OFFSET ${offset}`,
        params,
      )
    ).rows;
    const items = rows.slice(0, limit).map((a) => ({
      applicationId: a.id, reference: a.reference, status: a.status, submittedAt: a.submitted_at,
      student: { id: a.uid, name: a.name, email: a.email, phone: a.phone, ...a.snapshot?.student },
      resume: a.resume_snapshot || null,
    }));
    res.json({ items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  // CSV export of all applicants of a drive (officer). UTF-8 BOM, formula-injection safe.
  r.get('/:id/applicants/export', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ status: z.string().max(30).optional() }).parse(req.query);
    const drive = await getDrive(u.tenantId, pid(req));
    const params: unknown[] = [drive.id, u.tenantId];
    let where = 'a.drive_id=$1 AND a.tenant_id=$2';
    if (q.status) { params.push(q.status); where += ` AND a.status=$${params.length}`; }
    const rows = (
      await pool.query(
        `SELECT a.reference, a.status, a.submitted_at, a.snapshot, a.resume_snapshot, u.name, u.email, u.phone
           FROM applications a JOIN users u ON u.id=a.user_id WHERE ${where}
          ORDER BY a.submitted_at, a.reference`,
        params,
      )
    ).rows;
    const header = ['reference', 'name', 'email', 'phoneDisplay', 'registrationNumber', 'department', 'batchYear', 'cgpa', 'activeBacklogs', 'status', 'appliedAt', 'resumeUrl', 'resumeKind'];
    const body = rows.map((a) => {
      const s = a.snapshot?.student || {};
      const phone = String(s.phone ?? a.phone ?? '');
      return [
        a.reference, s.name ?? a.name, s.email ?? a.email, /^\d{10}$/.test(phone) ? formatPhone(phone) : phone,
        s.registrationNumber, s.department, s.batchYear, s.cgpa, s.activeBacklogs, a.status,
        formatIstStamp(new Date(a.submitted_at)), a.resume_snapshot?.kind === 'file' || a.resume_snapshot?.fileId ? '' : a.resume_snapshot?.url,
        a.resume_snapshot?.kind === 'file' || a.resume_snapshot?.fileId ? 'file' : 'link',
      ];
    });
    const slug = String(drive.company?.name || 'drive').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drive';
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="applicants-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(toCsv(header, body));
  }));

  // ------------------------------------------------------------ student: save
  r.put('/:id/save', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const d = await getDrive(u.tenantId, pid(req));
    if (d.status === 'draft') throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    await pool.query('INSERT INTO saved_drives (user_id, drive_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, d.id, u.tenantId]);
    res.json({ saved: true });
  }));
  r.delete('/:id/save', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    await getDrive(u.tenantId, pid(req));
    await pool.query('DELETE FROM saved_drives WHERE user_id=$1 AND drive_id=$2', [u.id, pid(req)]);
    res.json({ saved: false });
  }));

  return r;
}

export { effectiveStatus };

import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, forbidden, notFound, parse, wrap } from '../errors';
import { createNotification } from '../notify';
import { getProfileRow } from '../profile';
import { recordAudit } from '../policy/audit';
import { effectiveRestrictionStatus, getActiveRestrictions, rowToRestriction } from '../policy/restrictions';
import { getOpsSettings } from '../policy/store';
import { iso, isoDate, pageOf, paging, textSchema, uuid } from '../ops/util';

const SCOPES = ['student', 'company', 'drive', 'department', 'batch', 'tenant'] as const;

const dto = (x: any, now = new Date()) => ({
  id: x.id, scope: x.scope, scopeValue: x.scope_value, studentId: x.student_id, reason: x.reason, studentMessage: x.student_message,
  evidenceNotes: x.evidence_notes, status: x.status, effectiveStatus: effectiveRestrictionStatus(rowToRestriction(x), now),
  startsAt: iso(x.starts_at), endsAt: iso(x.ends_at), requestedBy: x.requested_by, approvedBy: x.approved_by, approvedAt: iso(x.approved_at),
  liftedBy: x.lifted_by, liftedAt: iso(x.lifted_at), liftReason: x.lift_reason, exemptStudentIds: x.exempt_student_ids || [], createdAt: iso(x.created_at),
});

const createSchema = z.object({
  scope: z.enum(SCOPES, { message: `scope must be one of ${SCOPES.join(', ')}` }),
  scopeValue: textSchema(120).optional(),
  studentId: uuid.optional(),
  reason: textSchema(500, 3),
  studentMessage: textSchema(300, 5),
  evidenceNotes: textSchema(2000).optional(),
  startsAt: isoDate.optional(),
  endsAt: isoDate.nullable().optional(),
}).strict();

export function restrictionRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');
  const stu = requireRole('student');

  async function validateTarget(tenantId: string, b: z.infer<typeof createSchema>) {
    const fields: Record<string, string> = {};
    let scopeValue: string | null = b.scopeValue ?? null;
    let studentId = b.studentId ?? null;
    switch (b.scope) {
      case 'student': {
        const id = studentId ?? scopeValue;
        if (!id || !uuid.safeParse(id).success) { fields.studentId = 'Choose the student'; break; }
        studentId = id; scopeValue = id; break;
      }
      case 'company': if (!scopeValue) fields.scopeValue = 'Enter the company name'; break;
      case 'drive':
        if (!scopeValue || !uuid.safeParse(scopeValue).success) fields.scopeValue = 'Choose the drive';
        else if (!(await pool.query(`SELECT 1 FROM drives WHERE id=$1 AND tenant_id=$2`, [scopeValue, tenantId])).rowCount) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
        break;
      case 'department': if (!scopeValue) fields.scopeValue = 'Enter the department'; if (studentId) fields.studentId = 'Not used for department scope'; break;
      case 'batch': if (!scopeValue || !/^20[2-4]\d$/.test(scopeValue)) fields.scopeValue = 'Enter a batch year such as 2026'; if (studentId) fields.studentId = 'Not used for batch scope'; break;
      case 'tenant': scopeValue = null; if (studentId) fields.studentId = 'Not used for tenant scope'; break;
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    if (studentId && !(await pool.query(`SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2 AND role='student' AND deleted_at IS NULL`, [studentId, tenantId])).rowCount) {
      throw notFound('Student not found', 'STUDENT_NOT_FOUND');
    }
    return { scopeValue, studentId };
  }
  const checkWindow = (startsAt: Date, endsAt: Date | null) => {
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) throw new ApiError(400, 'VALIDATION_ERROR', 'endsAt must be after startsAt', { endsAt: 'Must be after startsAt' });
    if (endsAt && endsAt.getTime() <= Date.now()) throw new ApiError(400, 'VALIDATION_ERROR', 'endsAt must be in the future', { endsAt: 'Must be in the future' });
  };
  const event = (db: any, tenantId: string, id: string, type: string, actor: string | null, note?: string | null) =>
    db.query('INSERT INTO restriction_events (tenant_id,restriction_id,type,actor_id,note) VALUES ($1,$2,$3,$4,$5)', [tenantId, id, type, actor, note ?? null]);
  const notifyStudent = async (db: any, tenantId: string, row: any, title: string, body: string) => {
    if (row.student_id) await createNotification(db, tenantId, row.student_id, 'restriction', title, body, { restrictionId: row.id });
  };

  r.post('/restrictions', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<z.infer<typeof createSchema>>(createSchema, req.body ?? {});
    const t = await validateTarget(u.tenantId, b);
    const startsAt = b.startsAt ? new Date(b.startsAt) : new Date();
    const endsAt = b.endsAt ? new Date(b.endsAt) : null;
    checkWindow(startsAt, endsAt);
    const settings = await getOpsSettings(pool, u.tenantId);
    const immediate = settings.restrictionApproval === 'not_required';
    const row = await withTx(pool, async (c) => {
      const x = (await c.query(
        `INSERT INTO restrictions (tenant_id,scope,scope_value,student_id,reason,student_message,evidence_notes,status,starts_at,ends_at,requested_by,approved_by,approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [u.tenantId, b.scope, t.scopeValue, t.studentId, b.reason, b.studentMessage, b.evidenceNotes ?? '', immediate ? 'active' : 'pending_approval', startsAt, endsAt, u.id,
          immediate ? u.id : null, immediate ? new Date() : null])).rows[0];
      await event(c, u.tenantId, x.id, 'requested', u.id, b.reason);
      if (immediate) { await event(c, u.tenantId, x.id, 'approved', u.id, 'Approval not required for this tenant'); await notifyStudent(c, u.tenantId, x, 'A restriction was applied to your account', b.studentMessage); }
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'restriction.create', entityType: 'restriction', entityId: x.id, meta: { scope: b.scope, scopeValue: t.scopeValue, studentId: t.studentId, immediate } });
      return x;
    });
    res.status(201).json({ restriction: dto(row) });
  }));

  r.get('/restrictions', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      status: z.enum(['pending_approval', 'active', 'upcoming', 'expired', 'rejected', 'lifted']).optional(), scope: z.enum(SCOPES).optional(), studentId: uuid.optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const { limit, offset } = paging(q);
    const p: unknown[] = [u.tenantId];
    let w = 'tenant_id=$1';
    if (q.scope) { p.push(q.scope); w += ` AND scope=$${p.length}`; }
    if (q.studentId) { p.push(q.studentId); w += ` AND student_id=$${p.length}`; }
    if (q.status === 'active') w += ` AND status='active' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`;
    else if (q.status === 'upcoming') w += ` AND status='active' AND starts_at > now()`;
    else if (q.status === 'expired') w += ` AND status='active' AND ends_at IS NOT NULL AND ends_at <= now()`;
    else if (q.status) { p.push(q.status); w += ` AND status=$${p.length}`; }
    const rows = (await pool.query(`SELECT * FROM restrictions WHERE ${w} ORDER BY created_at DESC, id LIMIT ${limit + 1} OFFSET ${offset}`, p)).rows;
    res.json(pageOf(rows.map((x) => dto(x)), limit, offset));
  }));

  // appeals (declared before /:id)
  r.get('/restrictions/appeals', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ status: z.enum(['pending', 'upheld', 'overturned']).optional(), cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const { limit, offset } = paging(q);
    const rows = (await pool.query(
      `SELECT a.*, s.name AS student_name, r.scope, r.student_message FROM restriction_appeals a
         JOIN users s ON s.id=a.student_id JOIN restrictions r ON r.id=a.restriction_id
        WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.status=$2) ORDER BY a.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, [u.tenantId, q.status ?? null])).rows;
    res.json(pageOf(rows.map((a) => ({
      id: a.id, restrictionId: a.restriction_id, studentId: a.student_id, studentName: a.student_name, message: a.message, status: a.status, decisionNote: a.decision_note,
      createdAt: iso(a.created_at), decidedAt: iso(a.decided_at), restriction: { scope: a.scope, studentMessage: a.student_message },
    })), limit, offset));
  }));

  r.post('/restrictions/appeals/:id/decide', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ decision: 'uphold' | 'overturn'; note: string }>(z.object({ decision: z.enum(['uphold', 'overturn']), note: textSchema(500, 3) }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const a = (await c.query('SELECT * FROM restriction_appeals WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [pid(req), u.tenantId])).rows[0];
      if (!a) throw notFound('Appeal not found', 'APPEAL_NOT_FOUND');
      if (a.status !== 'pending') throw conflict('APPEAL_DECIDED', 'This appeal has already been decided');
      const status = b.decision === 'overturn' ? 'overturned' : 'upheld';
      const row = (await c.query(`UPDATE restriction_appeals SET status=$2, decision_note=$3, decided_by=$4, decided_at=now() WHERE id=$1 RETURNING *`, [a.id, status, b.note, u.id])).rows[0];
      if (b.decision === 'overturn') {
        await c.query(`UPDATE restrictions SET exempt_student_ids = array_append(exempt_student_ids, $2::uuid), updated_at=now() WHERE id=$1 AND NOT ($2::uuid = ANY(exempt_student_ids))`, [a.restriction_id, a.student_id]);
      }
      await event(c, u.tenantId, a.restriction_id, `appeal_${status}`, u.id, b.note);
      await createNotification(c as any, u.tenantId, a.student_id, 'restriction_appeal',
        b.decision === 'overturn' ? 'Your appeal was accepted' : 'Your appeal was reviewed',
        b.decision === 'overturn' ? `The restriction no longer applies to you. ${b.note}` : `The placement cell kept the restriction in place. ${b.note}`, { restrictionId: a.restriction_id, appealId: a.id });
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'appeal.decide', entityType: 'restriction_appeal', entityId: a.id, meta: { decision: b.decision, restrictionId: a.restriction_id, studentId: a.student_id } });
      return row;
    });
    res.json({ appeal: { id: out.id, restrictionId: out.restriction_id, status: out.status, decisionNote: out.decision_note, decidedAt: iso(out.decided_at) } });
  }));

  r.get('/restrictions/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const x = (await pool.query('SELECT * FROM restrictions WHERE id=$1 AND tenant_id=$2', [pid(req), u.tenantId])).rows[0];
    if (!x) throw notFound('Restriction not found', 'RESTRICTION_NOT_FOUND');
    const hist = (await pool.query(`SELECT e.*, a.name AS actor_name FROM restriction_events e LEFT JOIN users a ON a.id=e.actor_id WHERE e.restriction_id=$1 ORDER BY e.id`, [x.id])).rows;
    const appeals = (await pool.query(`SELECT a.*, s.name AS student_name FROM restriction_appeals a JOIN users s ON s.id=a.student_id WHERE a.restriction_id=$1 ORDER BY a.created_at`, [x.id])).rows;
    res.json({
      restriction: dto(x),
      history: hist.map((e) => ({ id: e.id, type: e.type, actorId: e.actor_id, actorName: e.actor_name, note: e.note, createdAt: iso(e.created_at) })),
      appeals: appeals.map((a) => ({ id: a.id, studentId: a.student_id, studentName: a.student_name, message: a.message, status: a.status, decisionNote: a.decision_note, createdAt: iso(a.created_at) })),
    });
  }));

  r.put('/restrictions/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(createSchema.partial().omit({ scope: true, studentId: true }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const x = (await c.query('SELECT * FROM restrictions WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [pid(req), u.tenantId])).rows[0];
      if (!x) throw notFound('Restriction not found', 'RESTRICTION_NOT_FOUND');
      if (x.status !== 'pending_approval') throw conflict('NOT_PENDING', 'Only restrictions awaiting approval can be edited');
      const startsAt = b.startsAt ? new Date(b.startsAt) : new Date(x.starts_at);
      const endsAt = b.endsAt !== undefined ? (b.endsAt ? new Date(b.endsAt) : null) : x.ends_at;
      checkWindow(startsAt, endsAt);
      const row = (await c.query(
        `UPDATE restrictions SET reason=$2, student_message=$3, evidence_notes=$4, starts_at=$5, ends_at=$6, scope_value=$7, updated_at=now() WHERE id=$1 RETURNING *`,
        [x.id, b.reason ?? x.reason, b.studentMessage ?? x.student_message, b.evidenceNotes ?? x.evidence_notes, startsAt, endsAt, b.scopeValue ?? x.scope_value])).rows[0];
      await event(c, u.tenantId, x.id, 'edited', u.id);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'restriction.update', entityType: 'restriction', entityId: x.id });
      return row;
    });
    res.json({ restriction: dto(out) });
  }));

  const transitionPending = (kind: 'approve' | 'reject') => wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ note?: string }>(z.object({ note: kind === 'reject' ? textSchema(500, 3) : textSchema(500).optional() }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const x = (await c.query('SELECT * FROM restrictions WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [pid(req), u.tenantId])).rows[0];
      if (!x) throw notFound('Restriction not found', 'RESTRICTION_NOT_FOUND');
      if (x.status !== 'pending_approval') throw conflict('NOT_PENDING', 'This restriction is not awaiting approval');
      if (kind === 'approve' && x.requested_by === u.id) throw forbidden('You cannot approve a restriction you requested. Ask another officer.', 'SELF_APPROVAL');
      const row = (await c.query(
        kind === 'approve' ? `UPDATE restrictions SET status='active', approved_by=$2, approved_at=now(), updated_at=now() WHERE id=$1 RETURNING *`
          : `UPDATE restrictions SET status='rejected', approved_by=$2, approved_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [x.id, u.id])).rows[0];
      await event(c, u.tenantId, x.id, kind === 'approve' ? 'approved' : 'rejected', u.id, b.note);
      if (kind === 'approve') await notifyStudent(c, u.tenantId, row, 'A restriction was applied to your account', row.student_message);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: `restriction.${kind}`, entityType: 'restriction', entityId: x.id, meta: { requestedBy: x.requested_by } });
      return row;
    });
    res.json({ restriction: dto(out) });
  });
  r.post('/restrictions/:id/approve', off, transitionPending('approve'));
  r.post('/restrictions/:id/reject', off, transitionPending('reject'));

  r.post('/restrictions/:id/lift', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ reason: string }>(z.object({ reason: textSchema(500, 3) }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const x = (await c.query('SELECT * FROM restrictions WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [pid(req), u.tenantId])).rows[0];
      if (!x) throw notFound('Restriction not found', 'RESTRICTION_NOT_FOUND');
      if (x.status !== 'active') throw conflict('NOT_ACTIVE', 'Only active restrictions can be lifted');
      const row = (await c.query(`UPDATE restrictions SET status='lifted', lifted_by=$2, lifted_at=now(), lift_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`, [x.id, u.id, b.reason])).rows[0];
      await event(c, u.tenantId, x.id, 'lifted', u.id, b.reason);
      await notifyStudent(c, u.tenantId, row, 'A restriction was lifted', 'The restriction on your account has been lifted. You can apply to drives again.');
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'restriction.lift', entityType: 'restriction', entityId: x.id, meta: { reason: b.reason } });
      return row;
    });
    res.json({ restriction: dto(out) });
  }));

  // ------------------------------------------------------------------ student
  r.get('/my/restrictions', stu, wrap(async (req, res) => {
    const u = me(req);
    const prof = await getProfileRow(pool, u.id);
    const rows = (await pool.query(`SELECT * FROM restrictions WHERE tenant_id=$1 AND status='active'`, [u.tenantId])).rows;
    const hits = getActiveRestrictions({ id: u.id, department: prof.data.academics?.department, batchYear: prof.data.academics?.batchYear }, null, rows.map(rowToRestriction));
    const ids = new Set(hits.map((h) => h.id));
    const mine = rows.filter((x) => ids.has(x.id));
    const appeals = mine.length ? (await pool.query(
      `SELECT DISTINCT ON (restriction_id) * FROM restriction_appeals WHERE student_id=$1 AND restriction_id = ANY($2::uuid[]) ORDER BY restriction_id, created_at DESC`, [u.id, mine.map((m) => m.id)])).rows : [];
    res.json({
      items: mine.map((x) => {
        const ap = appeals.find((a) => a.restriction_id === x.id);
        return {
          id: x.id, scope: x.scope, message: x.student_message, startsAt: iso(x.starts_at), endsAt: iso(x.ends_at),
          canAppeal: !ap || ap.status !== 'pending', appeal: ap ? { id: ap.id, status: ap.status, decisionNote: ap.decision_note } : null,
          appealPath: `/my/restrictions/${x.id}/appeal`,
        };
      }),
    });
  }));

  r.post('/my/restrictions/:id/appeal', stu, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ message: string }>(z.object({ message: textSchema(1000, 10) }).strict(), req.body ?? {});
    const prof = await getProfileRow(pool, u.id);
    const out = await withTx(pool, async (c) => {
      const x = (await c.query(`SELECT * FROM restrictions WHERE id=$1 AND tenant_id=$2 AND status='active' FOR UPDATE`, [pid(req), u.tenantId])).rows[0];
      const hit = x && getActiveRestrictions({ id: u.id, department: prof.data.academics?.department, batchYear: prof.data.academics?.batchYear }, null, [rowToRestriction(x)]).length;
      if (!hit) throw notFound('Restriction not found', 'RESTRICTION_NOT_FOUND');
      const pending = (await c.query(`SELECT 1 FROM restriction_appeals WHERE restriction_id=$1 AND student_id=$2 AND status='pending'`, [x.id, u.id])).rowCount;
      if (pending) throw conflict('APPEAL_EXISTS', 'You already have an appeal waiting for a decision');
      const a = (await c.query(`INSERT INTO restriction_appeals (tenant_id,restriction_id,student_id,message) VALUES ($1,$2,$3,$4) RETURNING *`, [u.tenantId, x.id, u.id, b.message])).rows[0];
      await event(c, u.tenantId, x.id, 'appeal_filed', u.id, b.message);
      const officers = (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='officer' AND deleted_at IS NULL`, [u.tenantId])).rows;
      for (const o of officers) await createNotification(c as any, u.tenantId, o.id, 'restriction_appeal', 'New restriction appeal', `${u.name} appealed a restriction.`, { restrictionId: x.id, appealId: a.id });
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'appeal.create', entityType: 'restriction_appeal', entityId: a.id, meta: { restrictionId: x.id } });
      return a;
    });
    res.status(201).json({ appeal: { id: out.id, restrictionId: out.restriction_id, status: out.status, createdAt: iso(out.created_at) } });
  }));
  return r;
}

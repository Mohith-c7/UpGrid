import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, parse, wrap } from '../errors';
import { recordAudit } from '../policy/audit';
import { cohortFilterSchema, cohortMembers, loadStudentsByIds, resolveFilter } from '../policy/cohorts';
import { iso, textSchema, uuid, decodeCursor, encodeCursor, pageLimit } from '../ops/util';

const bodySchema = z.object({
  name: textSchema(80, 2), description: textSchema(300).optional(), kind: z.enum(['dynamic', 'fixed']),
  filter: cohortFilterSchema.optional(), studentIds: z.array(uuid).max(2000).optional(),
}).strict();

export function cohortRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');

  const dto = (c: any, count: number) => ({ id: c.id, name: c.name, description: c.description, kind: c.kind, filter: c.filter, memberCount: count, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at) });
  const load = async (tenantId: string, id: string, db: any = pool) => {
    const c = (await db.query('SELECT * FROM cohorts WHERE id=$1 AND tenant_id=$2', [id, tenantId])).rows[0];
    if (!c) throw notFound('Cohort not found', 'COHORT_NOT_FOUND');
    return c;
  };
  const count = async (c: any) => (await cohortMembers(pool, c)).length;
  const onlyTenantStudents = async (tenantId: string, ids: string[]) => {
    const found = await loadStudentsByIds(pool, tenantId, ids);
    if (found.length !== new Set(ids).size) throw new ApiError(400, 'VALIDATION_ERROR', 'Some students were not found', { studentIds: 'Some students were not found' });
    return found.map((s) => s.id);
  };

  r.get('/cohorts', off, wrap(async (req, res) => {
    const rows = (await pool.query('SELECT * FROM cohorts WHERE tenant_id=$1 ORDER BY name', [me(req).tenantId])).rows;
    res.json({ items: await Promise.all(rows.map(async (c) => dto(c, await count(c)))) });
  }));

  r.post('/cohorts/preview', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ kind: z.enum(['dynamic', 'fixed']), filter: cohortFilterSchema.optional(), studentIds: z.array(uuid).max(2000).optional() }).strict(), req.body ?? {});
    const members = b.kind === 'fixed' ? await loadStudentsByIds(pool, u.tenantId, b.studentIds ?? []) : await resolveFilter(pool, u.tenantId, b.filter ?? {});
    res.json({ count: members.length, sample: members.slice(0, 5).map((m) => ({ id: m.id, name: m.name, department: m.department, batchYear: m.batchYear })) });
  }));

  r.post('/cohorts', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<z.infer<typeof bodySchema>>(bodySchema, req.body ?? {});
    if (b.kind === 'fixed' && b.filter) throw new ApiError(400, 'VALIDATION_ERROR', 'Fixed cohorts take studentIds, not a filter', { filter: 'Not allowed for fixed cohorts' });
    if (b.kind === 'dynamic' && b.studentIds) throw new ApiError(400, 'VALIDATION_ERROR', 'Dynamic cohorts take a filter, not studentIds', { studentIds: 'Not allowed for dynamic cohorts' });
    const ids = b.kind === 'fixed' ? await onlyTenantStudents(u.tenantId, b.studentIds ?? []) : [];
    const out = await withTx(pool, async (c) => {
      const row = (await c.query(`INSERT INTO cohorts (tenant_id,name,description,kind,filter,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [u.tenantId, b.name, b.description ?? '', b.kind, JSON.stringify(b.filter ?? {}), u.id])).rows[0];
      for (const id of ids) await c.query('INSERT INTO cohort_members (cohort_id,user_id,tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [row.id, id, u.tenantId]);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'cohort.create', entityType: 'cohort', entityId: row.id, meta: { name: b.name, kind: b.kind } });
      return row;
    });
    res.status(201).json({ cohort: dto(out, await count(out)) });
  }));

  r.get('/cohorts/:id', off, wrap(async (req, res) => {
    const c = await load(me(req).tenantId, pid(req));
    res.json({ cohort: dto(c, await count(c)) });
  }));

  r.put('/cohorts/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ name: textSchema(80, 2).optional(), description: textSchema(300).optional(), filter: cohortFilterSchema.optional() }).strict(), req.body ?? {});
    const cur = await load(u.tenantId, pid(req));
    if (b.filter && cur.kind !== 'dynamic') throw new ApiError(400, 'VALIDATION_ERROR', 'Only dynamic cohorts have a filter', { filter: 'Only dynamic cohorts have a filter' });
    const row = (await pool.query(`UPDATE cohorts SET name=$2, description=$3, filter=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [cur.id, b.name ?? cur.name, b.description ?? cur.description, JSON.stringify(b.filter ?? cur.filter)])).rows[0];
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'cohort.update', entityType: 'cohort', entityId: cur.id });
    res.json({ cohort: dto(row, await count(row)) });
  }));

  r.delete('/cohorts/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const cur = await load(u.tenantId, pid(req));
    const used = await pool.query(`SELECT 1 FROM announcements WHERE tenant_id=$1 AND status='scheduled' AND audience->>'cohortId'=$2 LIMIT 1`, [u.tenantId, cur.id]);
    if (used.rowCount) throw conflict('COHORT_IN_USE', 'A scheduled announcement uses this cohort. Edit or delete it first.');
    await pool.query('DELETE FROM cohorts WHERE id=$1', [cur.id]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'cohort.delete', entityType: 'cohort', entityId: cur.id, meta: { name: cur.name } });
    res.json({ ok: true });
  }));

  r.get('/cohorts/:id/members', off, wrap(async (req, res) => {
    const q = parse<any>(z.object({ cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const limit = pageLimit(q.limit); const offset = decodeCursor(q.cursor);
    const c = await load(me(req).tenantId, pid(req));
    const all = await cohortMembers(pool, c);
    res.json({ items: all.slice(offset, offset + limit), nextCursor: offset + limit < all.length ? encodeCursor(offset + limit) : null, total: all.length });
  }));

  r.put('/cohorts/:id/members', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ add: z.array(uuid).max(500).optional(), remove: z.array(uuid).max(500).optional() }).strict(), req.body ?? {});
    const c = await load(u.tenantId, pid(req));
    if (c.kind !== 'fixed') throw conflict('COHORT_NOT_FIXED', 'Members can only be edited on fixed cohorts');
    const add = b.add?.length ? await onlyTenantStudents(u.tenantId, b.add) : [];
    await withTx(pool, async (cl) => {
      for (const id of add) await cl.query('INSERT INTO cohort_members (cohort_id,user_id,tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, id, u.tenantId]);
      if (b.remove?.length) await cl.query('DELETE FROM cohort_members WHERE cohort_id=$1 AND user_id = ANY($2::uuid[])', [c.id, b.remove]);
      await cl.query('UPDATE cohorts SET updated_at=now() WHERE id=$1', [c.id]);
      await recordAudit(cl, { tenantId: u.tenantId, actorId: u.id, action: 'cohort.members', entityType: 'cohort', entityId: c.id, meta: { added: add.length, removed: b.remove?.length ?? 0 } });
    });
    res.json({ cohort: dto(c, await count(c)) });
  }));
  return r;
}

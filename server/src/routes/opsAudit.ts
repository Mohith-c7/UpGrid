import { Router } from 'express';
import { z } from 'zod';
import { toCsv } from '../csv';
import { Deps, me, requireRole } from '../context';
import { parse, wrap } from '../errors';
import { maskMeta, recordAudit } from '../policy/audit';
import { iso, isoDate, likeEscape, pageOf, paging, uuid } from '../ops/util';

const filterSchema = z.object({
  actorId: uuid.optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(80).optional(), action: z.string().max(60).optional(),
  from: isoDate.optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()), to: isoDate.optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  q: z.string().max(80).optional(),
});

function where(tenantId: string, f: z.infer<typeof filterSchema>) {
  const p: unknown[] = [tenantId];
  let w = 'e.tenant_id=$1';
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  if (f.actorId) w += ` AND e.actor_id=${add(f.actorId)}`;
  if (f.entityType) w += ` AND e.entity_type=${add(f.entityType)}`;
  if (f.entityId) w += ` AND e.entity_id=${add(f.entityId)}`;
  if (f.action) w += f.action.endsWith('*') ? ` AND e.action LIKE ${add(likeEscape(f.action.slice(0, -1)) + '%')}` : ` AND e.action=${add(f.action)}`;
  if (f.from) w += ` AND e.created_at >= ${add(new Date(f.from))}`;
  if (f.to) w += ` AND e.created_at < ${add(/^\d{4}-\d{2}-\d{2}$/.test(f.to) ? new Date(new Date(f.to).getTime() + 86400000) : new Date(f.to))}`;
  if (f.q) w += ` AND (e.action ILIKE ${add('%' + likeEscape(f.q) + '%')} OR e.meta::text ILIKE $${p.length})`;
  return { w, p };
}
const SELECT = `SELECT e.*, u.name AS actor_name FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id`;
const dto = (e: any) => ({
  id: Number(e.id), actorId: e.actor_id, actorName: e.actor_name ?? null, action: e.action, entityType: e.entity_type, entityId: e.entity_id,
  meta: maskMeta(e.meta), createdAt: iso(e.created_at),
});

export function auditRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');

  r.get('/audit/actions', off, wrap(async (req, res) => {
    const rows = (await pool.query('SELECT DISTINCT action FROM audit_events WHERE tenant_id=$1 ORDER BY 1', [me(req).tenantId])).rows;
    res.json({ items: rows.map((x) => x.action) });
  }));

  r.get('/audit/export', off, wrap(async (req, res) => {
    const u = me(req);
    const { format, ...rest } = req.query as Record<string, string>;
    const f = parse<z.infer<typeof filterSchema>>(filterSchema, rest);
    const fmt = parse<{ format: 'csv' | 'json' }>(z.object({ format: z.enum(['csv', 'json']).default('csv') }), { format }).format;
    const { w, p } = where(u.tenantId, f);
    const rows = (await pool.query(`${SELECT} WHERE ${w} ORDER BY e.id DESC LIMIT 5000`, p)).rows.map(dto);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'audit.export', meta: { format: fmt, rows: rows.length } });
    if (fmt === 'json') return res.json({ generatedAt: new Date().toISOString(), rows });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(toCsv(['id', 'createdAt', 'actor', 'action', 'entityType', 'entityId', 'meta'], rows.map((e) => [e.id, e.createdAt, e.actorName ?? e.actorId, e.action, e.entityType, e.entityId, JSON.stringify(e.meta)])));
  }));

  r.get('/audit', off, wrap(async (req, res) => {
    const u = me(req);
    const { cursor, limit: lim, ...rest } = req.query as Record<string, string>;
    const f = parse<z.infer<typeof filterSchema>>(filterSchema, rest);
    const { limit, offset } = paging({ cursor, limit: lim });
    const { w, p } = where(u.tenantId, f);
    const rows = (await pool.query(`${SELECT} WHERE ${w} ORDER BY e.id DESC LIMIT ${limit + 1} OFFSET ${offset}`, p)).rows;
    res.json(pageOf(rows.map(dto), limit, offset));
  }));
  return r;
}

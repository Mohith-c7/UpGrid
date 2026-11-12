import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, authenticate } from '../context';
import { notFound, parse, wrap } from '../errors';
import { buildIcs, calendarEvents, hashToken } from '../ops/calendar';
import { recordAudit } from '../policy/audit';
import { iso } from '../ops/util';
import { ApiError } from '../errors';

const dayMs = 24 * 3600_000;

export function calendarRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();

  r.get('/calendar', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<{ from?: string; to?: string }>(z.object({
      from: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date').optional(), to: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date').optional(),
    }), req.query);
    const from = q.from ? new Date(q.from) : new Date();
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 30 * dayMs);
    if (to <= from) throw new ApiError(400, 'VALIDATION_ERROR', '`to` must be after `from`', { to: 'Must be after from' });
    if (to.getTime() - from.getTime() > 92 * dayMs) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a range of at most 92 days', { to: 'Range too long' });
    res.json({ items: await calendarEvents(pool, u, from, to) });
  }));

  r.post('/calendar/feed-token', wrap(async (req, res) => {
    const u = me(req);
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('UPDATE calendar_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    await pool.query('INSERT INTO calendar_tokens (tenant_id,user_id,token_hash) VALUES ($1,$2,$3)', [u.tenantId, u.id, hashToken(token)]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'calendar.token_create', entityType: 'user', entityId: u.id });
    res.status(201).json({ token, url: `/api/v1/calendar.ics?token=${token}` });
  }));
  r.get('/calendar/feed-token', wrap(async (req, res) => {
    const t = (await pool.query('SELECT created_at FROM calendar_tokens WHERE user_id=$1 AND revoked_at IS NULL', [me(req).id])).rows[0];
    res.json({ active: !!t, createdAt: iso(t?.created_at) });
  }));
  r.delete('/calendar/feed-token', wrap(async (req, res) => {
    const u = me(req);
    await pool.query('UPDATE calendar_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'calendar.token_revoke', entityType: 'user', entityId: u.id });
    res.json({ ok: true });
  }));
  return r;
}

/** Public, token-authenticated iCalendar feed. Mounted before the authenticated routers. */
export function icsHandler(deps: Deps) {
  const { pool } = deps;
  return wrap(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound('Not found');
    const row = (await pool.query(
      `SELECT u.id, u.tenant_id, u.role FROM calendar_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND u.deleted_at IS NULL`, [hashToken(token)])).rows[0];
    if (!row) throw notFound('Not found');
    const now = Date.now();
    const events = await calendarEvents(pool, { id: row.id, tenantId: row.tenant_id, role: row.role }, new Date(now - 7 * dayMs), new Date(now + 60 * dayMs));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buildIcs(events));
  });
}
void authenticate;

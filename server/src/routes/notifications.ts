import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me } from '../context';
import { ApiError, parse, wrap } from '../errors';
import { DEFAULT_REMINDER_SETTINGS, getReminderSettings, mergeSettings } from '../notify';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const dto = (n: any) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, read: !!n.read_at, readAt: n.read_at, createdAt: new Date(n.created_at).toISOString() });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const settingsSchema = z.object({
  t60: z.boolean(), t30: z.boolean(), t15: z.boolean(), push: z.boolean(), inApp: z.boolean(), email: z.boolean(),
  quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }).partial().strict(),
}).partial().strict();

export function notificationRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps));

  r.get('/notifications', wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ cursor: z.string().optional(), limit: z.string().optional(), unread: z.enum(['0', '1']).optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const rows = (await pool.query(
      `SELECT * FROM notifications WHERE user_id=$1 AND tenant_id=$2 ${q.unread === '1' ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC, id LIMIT ${limit + 1} OFFSET ${offset}`,
      [u.id, u.tenantId])).rows;
    const unread = (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [u.id])).rows[0].n;
    res.json({ items: rows.slice(0, limit).map(dto), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null, unreadCount: unread });
  }));

  r.get('/notifications/unread-count', wrap(async (req, res) => {
    const n = (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [me(req).id])).rows[0].n;
    res.json({ count: n });
  }));

  r.post('/notifications/read', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ ids?: string[]; all?: boolean }>(
      z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }).strict(), req.body ?? {});
    if (!body.all && !body.ids?.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Provide ids or all:true', { ids: 'Provide ids or all:true' });
    const r1 = body.all
      ? await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [u.id])
      : await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND id = ANY($2::uuid[])', [u.id, body.ids]);
    res.json({ updated: r1.rowCount });
  }));

  // ---------------------------------------------------------- reminder settings
  r.get('/reminder-settings', wrap(async (req, res) => {
    res.json(await getReminderSettings(pool, me(req).id));
  }));
  r.put('/reminder-settings', wrap(async (req, res) => {
    const u = me(req);
    const patch = parse<any>(settingsSchema, req.body ?? {});
    const cur = await getReminderSettings(pool, u.id);
    const next = mergeSettings({ ...cur, ...patch, quietHours: { ...cur.quietHours, ...(patch.quietHours || {}) } });
    await pool.query(
      `INSERT INTO reminder_settings (user_id, tenant_id, settings) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET settings=EXCLUDED.settings`,
      [u.id, u.tenantId, JSON.stringify(next)]);
    res.json(next);
  }));
  r.post('/reminder-settings/reset', wrap(async (req, res) => {
    const u = me(req);
    await pool.query('DELETE FROM reminder_settings WHERE user_id=$1', [u.id]);
    res.json(DEFAULT_REMINDER_SETTINGS);
  }));

  // ---------------------------------------------------------- devices
  r.post('/devices', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ expoPushToken: string; platform: string }>(
      z.object({
        expoPushToken: z.string().max(200).regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/, 'Invalid Expo push token'),
        platform: z.enum(['android', 'ios']),
      }).strict(), req.body ?? {});
    await pool.query(
      `INSERT INTO devices (tenant_id,user_id,expo_push_token,platform) VALUES ($1,$2,$3,$4)
       ON CONFLICT (expo_push_token) DO UPDATE SET user_id=EXCLUDED.user_id, tenant_id=EXCLUDED.tenant_id, platform=EXCLUDED.platform`,
      [u.tenantId, u.id, body.expoPushToken, body.platform]);
    res.status(201).json({ ok: true });
  }));
  r.delete('/devices', wrap(async (req, res) => {
    const u = me(req);
    const token = typeof req.body?.expoPushToken === 'string' ? req.body.expoPushToken : typeof req.query.expoPushToken === 'string' ? req.query.expoPushToken : null;
    if (token) await pool.query('DELETE FROM devices WHERE user_id=$1 AND expo_push_token=$2', [u.id, token]);
    else await pool.query('DELETE FROM devices WHERE user_id=$1', [u.id]);
    res.json({ ok: true });
  }));

  return r;
}

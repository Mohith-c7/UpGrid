import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, requireRole, pid } from '../context';
import { ApiError, conflict, notFound, parse, wrap } from '../errors';
import { Audience, deliverAnnouncement, resolveAudience } from '../ops/announcements';
import { recordAudit } from '../policy/audit';
import { iso, isoDate, pageOf, paging, textSchema, uuid } from '../ops/util';

const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }).strict(),
  z.object({ type: z.literal('cohort'), cohortId: uuid }).strict(),
  z.object({ type: z.literal('drive_participants'), driveId: uuid }).strict(),
  z.object({ type: z.literal('eligible_not_applied'), driveId: uuid }).strict(),
]);
const channelsSchema = z.object({ inApp: z.boolean().default(true), push: z.boolean().default(true), email: z.boolean().default(false) }).strict();

const createSchema = z.object({
  title: textSchema(100, 1), body: textSchema(2000, 1), audience: audienceSchema, channels: channelsSchema.optional(),
  sendAt: isoDate.optional(), pinned: z.boolean().optional(), expiresAt: isoDate.nullable().optional(), templateId: uuid.optional(), draft: z.boolean().optional(),
}).strict();

const dto = (a: any, extra: Record<string, unknown> = {}) => ({
  id: a.id, title: a.title, body: a.body, status: a.status, audience: a.audience, channels: a.channels, sendAt: iso(a.send_at), sentAt: iso(a.sent_at),
  pinned: a.pinned, expiresAt: iso(a.expires_at), templateId: a.template_id, recipients: a.recipients,
  ...(a.delivered !== undefined ? { delivered: a.delivered, read: a.read } : {}), createdAt: iso(a.created_at), ...extra,
});

export function announcementV2Router(deps: Deps) {
  const { pool, push } = deps;
  const r = Router();
  const off = requireRole('officer');
  const stu = requireRole('student');

  async function checkAudience(tenantId: string, a: Audience) {
    if (a.type === 'cohort') {
      if (!(await pool.query('SELECT 1 FROM cohorts WHERE id=$1 AND tenant_id=$2', [a.cohortId, tenantId])).rowCount) throw new ApiError(400, 'VALIDATION_ERROR', 'Cohort not found', { 'audience.cohortId': 'Cohort not found' });
    } else if (a.type !== 'all') {
      if (!(await pool.query(`SELECT 1 FROM drives WHERE id=$1 AND tenant_id=$2 AND status<>'draft'`, [a.driveId, tenantId])).rowCount) throw new ApiError(400, 'VALIDATION_ERROR', 'Drive not found', { 'audience.driveId': 'Drive not found' });
    }
  }
  const checkTimes = (sendAt: Date | null, expiresAt: Date | null) => {
    if (sendAt && sendAt.getTime() <= Date.now()) throw new ApiError(400, 'VALIDATION_ERROR', 'sendAt must be in the future', { sendAt: 'Must be in the future' });
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new ApiError(400, 'VALIDATION_ERROR', 'expiresAt must be in the future', { expiresAt: 'Must be in the future' });
    if (sendAt && expiresAt && expiresAt <= sendAt) throw new ApiError(400, 'VALIDATION_ERROR', 'expiresAt must be after sendAt', { expiresAt: 'Must be after sendAt' });
  };
  const withCounts = `SELECT a.*, (SELECT count(*)::int FROM announcement_deliveries d WHERE d.announcement_id=a.id) AS delivered,
        (SELECT count(*)::int FROM announcement_deliveries d WHERE d.announcement_id=a.id AND d.read_at IS NOT NULL) AS read FROM announcements a`;
  const load = async (tenantId: string, id: string) => {
    const a = (await pool.query(`${withCounts} WHERE a.id=$1 AND a.tenant_id=$2 AND a.v2`, [id, tenantId])).rows[0];
    if (!a) throw notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
    return a;
  };

  // ---------------------------------------------------------------- templates
  r.get('/announcement-templates', off, wrap(async (req, res) => {
    const rows = (await pool.query('SELECT * FROM announcement_templates WHERE tenant_id=$1 ORDER BY name', [me(req).tenantId])).rows;
    res.json({ items: rows.map((t) => ({ id: t.id, name: t.name, title: t.title, body: t.body, createdAt: iso(t.created_at) })) });
  }));
  r.post('/announcement-templates', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ name: textSchema(60, 2), title: textSchema(100, 1), body: textSchema(2000, 1) }).strict(), req.body ?? {});
    const t = (await pool.query(`INSERT INTO announcement_templates (tenant_id,name,title,body,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [u.tenantId, b.name, b.title, b.body, u.id])).rows[0];
    res.status(201).json({ template: { id: t.id, name: t.name, title: t.title, body: t.body, createdAt: iso(t.created_at) } });
  }));
  r.delete('/announcement-templates/:id', off, wrap(async (req, res) => {
    const d = await pool.query('DELETE FROM announcement_templates WHERE id=$1 AND tenant_id=$2', [pid(req), me(req).tenantId]);
    if (!d.rowCount) throw notFound('Template not found', 'TEMPLATE_NOT_FOUND');
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- student feed (declared before /:id)
  r.get('/announcements-v2/feed', stu, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const { limit, offset } = paging(q);
    const rows = (await pool.query(
      `SELECT a.id, a.title, a.body, a.pinned, a.sent_at, a.expires_at, d.read_at FROM announcement_deliveries d JOIN announcements a ON a.id=d.announcement_id
        WHERE d.user_id=$1 AND a.tenant_id=$2 AND a.v2 AND a.status='sent' AND (a.expires_at IS NULL OR a.expires_at > now())
        ORDER BY a.pinned DESC, a.sent_at DESC, a.id LIMIT ${limit + 1} OFFSET ${offset}`, [u.id, u.tenantId])).rows;
    res.json(pageOf(rows.map((a) => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, sentAt: iso(a.sent_at), expiresAt: iso(a.expires_at), read: !!a.read_at })), limit, offset));
  }));
  r.post('/announcements-v2/:id/read', stu, wrap(async (req, res) => {
    const u = me(req);
    const up = await pool.query(`UPDATE announcement_deliveries SET read_at = COALESCE(read_at, now()) WHERE announcement_id=$1 AND user_id=$2 AND tenant_id=$3`, [pid(req), u.id, u.tenantId]);
    if (!up.rowCount) throw notFound('Announcement not found', 'ANNOUNCEMENT_NOT_FOUND');
    await pool.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id=$1 AND type='announcement' AND data->>'announcementId'=$2`, [u.id, pid(req)]);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- officer CRUD
  r.post('/announcements-v2', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<z.infer<typeof createSchema>>(createSchema, req.body ?? {});
    await checkAudience(u.tenantId, b.audience as Audience);
    const sendAt = b.sendAt ? new Date(b.sendAt) : null;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    checkTimes(sendAt, expiresAt);
    if (b.draft && sendAt) throw new ApiError(400, 'VALIDATION_ERROR', 'A draft cannot have sendAt', { sendAt: 'Remove sendAt or draft' });
    const status = b.draft ? 'draft' : sendAt ? 'scheduled' : 'draft';
    const a = (await pool.query(
      `INSERT INTO announcements (tenant_id,author_id,drive_id,title,body,audience,channels,send_at,pinned,expires_at,template_id,status,v2)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
      [u.tenantId, u.id, (b.audience as any).driveId ?? null, b.title, b.body, JSON.stringify(b.audience), JSON.stringify(channelsSchema.parse(b.channels ?? {})), sendAt, b.pinned ?? false, expiresAt, b.templateId ?? null, status])).rows[0];
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.create', entityType: 'announcement', entityId: a.id, meta: { status, audience: b.audience } });
    if (!b.draft && !sendAt) {
      await deliverAnnouncement(pool, push, a.id);
      await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.send', entityType: 'announcement', entityId: a.id });
    }
    res.status(201).json({ announcement: dto(await load(u.tenantId, a.id)) });
  }));

  r.get('/announcements-v2', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ status: z.enum(['draft', 'scheduled', 'sent']).optional(), cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const { limit, offset } = paging(q);
    const rows = (await pool.query(`${withCounts} WHERE a.tenant_id=$1 AND a.v2 AND ($2::text IS NULL OR a.status=$2) ORDER BY a.pinned DESC, a.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, [u.tenantId, q.status ?? null])).rows;
    res.json(pageOf(rows.map((a) => dto(a)), limit, offset));
  }));

  r.get('/announcements-v2/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const a = await load(u.tenantId, pid(req));
    const extra = a.status === 'sent' ? {} : { audienceCount: (await resolveAudience(pool, u.tenantId, a.audience)).length };
    res.json({ announcement: dto(a, extra) });
  }));

  r.put('/announcements-v2/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(createSchema.partial().omit({ draft: true }).extend({ sendAt: isoDate.nullable().optional() }).strict(), req.body ?? {});
    const cur = await load(u.tenantId, pid(req));
    if (!['draft', 'scheduled'].includes(cur.status)) throw conflict('ALREADY_SENT', 'This announcement has already been sent');
    if (b.audience) await checkAudience(u.tenantId, b.audience);
    const sendAt = b.sendAt === undefined ? cur.send_at : b.sendAt ? new Date(b.sendAt) : null;
    const expiresAt = b.expiresAt === undefined ? cur.expires_at : b.expiresAt ? new Date(b.expiresAt) : null;
    checkTimes(b.sendAt ? sendAt : null, b.expiresAt ? expiresAt : null);
    const audience = b.audience ?? cur.audience;
    const row = (await pool.query(
      `UPDATE announcements SET title=$2, body=$3, audience=$4, channels=$5, send_at=$6, pinned=$7, expires_at=$8, status=$9, drive_id=$10, updated_at=now()
        WHERE id=$1 AND status IN ('draft','scheduled') RETURNING *`,
      [cur.id, b.title ?? cur.title, b.body ?? cur.body, JSON.stringify(audience), JSON.stringify(b.channels ? channelsSchema.parse(b.channels) : cur.channels), sendAt,
        b.pinned ?? cur.pinned, expiresAt, sendAt ? 'scheduled' : 'draft', audience.driveId ?? null])).rows[0];
    if (!row) throw conflict('ALREADY_SENT', 'This announcement has already been sent');
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.update', entityType: 'announcement', entityId: cur.id });
    res.json({ announcement: dto(await load(u.tenantId, cur.id)) });
  }));

  r.delete('/announcements-v2/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const cur = await load(u.tenantId, pid(req));
    const d = await pool.query(`DELETE FROM announcements WHERE id=$1 AND status IN ('draft','scheduled')`, [cur.id]);
    if (!d.rowCount) throw conflict('ALREADY_SENT', 'This announcement has already been sent and cannot be deleted');
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.delete', entityType: 'announcement', entityId: cur.id, meta: { title: cur.title } });
    res.json({ ok: true });
  }));

  r.post('/announcements-v2/:id/send', off, wrap(async (req, res) => {
    const u = me(req);
    const cur = await load(u.tenantId, pid(req));
    if (cur.status !== 'sent') {
      const out = await deliverAnnouncement(pool, push, cur.id);
      if (!out.skipped) await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.send', entityType: 'announcement', entityId: cur.id });
    }
    res.json({ announcement: dto(await load(u.tenantId, cur.id)) });
  }));

  r.post('/announcements-v2/:id/pin', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ pinned: boolean }>(z.object({ pinned: z.boolean() }).strict(), req.body ?? {});
    const cur = await load(u.tenantId, pid(req));
    await pool.query('UPDATE announcements SET pinned=$2, updated_at=now() WHERE id=$1', [cur.id, b.pinned]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'announcement.pin', entityType: 'announcement', entityId: cur.id, meta: { pinned: b.pinned } });
    res.json({ announcement: dto(await load(u.tenantId, cur.id)) });
  }));
  return r;
}

import { Router } from 'express';
import { z } from 'zod';
import { toCsv } from '../csv';
import { Deps, me, requireRole, pid } from '../context';
import { totalPackage } from '../drives';
import { ApiError, notFound, parse, wrap } from '../errors';
import { recordAudit } from '../policy/audit';
import { iso, isoDate, likeEscape, pageOf, paging, textSchema, uuid } from '../ops/util';
import { emailSchema, httpsUrlSchema, phoneSchema } from '../validation';

export const STAGES = ['prospect', 'contacted', 'interested', 'mou', 'hiring'] as const;
const SUFFIX = /\b(incorporated|inc|limited|ltd|private|pvt|llp|llc|corporation|corp|company|co|plc|technologies|technology|solutions|services)\b/g;
export function normalizeName(n: string): string {
  return n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

const contactSchema = z.object({
  name: textSchema(80, 1), role: textSchema(60).optional(), email: emailSchema.optional(), phone: phoneSchema.optional(),
}).strict();
const companyBody = z.object({
  name: textSchema(100, 2), website: httpsUrlSchema.nullable().optional(), industry: textSchema(60).optional(), hq: textSchema(80).optional(),
  contacts: z.array(contactSchema).max(10).optional(), notes: textSchema(3000).optional(), tags: z.array(textSchema(30, 1)).max(15).optional(),
  verified: z.boolean().optional(), logoFileId: uuid.nullable().optional(), stage: z.enum(STAGES).optional(), force: z.boolean().optional(),
}).strict();

const dto = (c: any) => ({
  id: c.id, name: c.name, website: c.website, industry: c.industry, hq: c.hq, contacts: c.contacts, notes: c.notes, tags: c.tags, verified: c.verified,
  logoFileId: c.logo_file_id, stage: c.stage, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at),
  ...(c.drive_count !== undefined ? { driveCount: c.drive_count, lastInteractionAt: iso(c.last_interaction), nextFollowUpAt: iso(c.next_follow_up) } : {}),
});
const LIST_SQL = `SELECT c.*, (SELECT count(*)::int FROM drives d WHERE d.company_id=c.id) AS drive_count,
    (SELECT max(occurred_at) FROM company_interactions i WHERE i.company_id=c.id) AS last_interaction,
    (SELECT min(follow_up_at) FROM company_interactions i WHERE i.company_id=c.id AND i.follow_up_done=false AND i.follow_up_at IS NOT NULL) AS next_follow_up
  FROM companies c`;

export function companyRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');

  const load = async (tenantId: string, id: string) => {
    const c = (await pool.query(`${LIST_SQL} WHERE c.id=$1 AND c.tenant_id=$2`, [id, tenantId])).rows[0];
    if (!c) throw notFound('Company not found', 'COMPANY_NOT_FOUND');
    return c;
  };
  async function findDuplicates(tenantId: string, name: string, website: string | null, exceptId?: string) {
    const key = normalizeName(name);
    const host = hostOf(website);
    return (await pool.query(
      `SELECT id, name, website FROM companies WHERE tenant_id=$1 AND ($4::uuid IS NULL OR id<>$4) AND (name_key=$2 OR ($3::text IS NOT NULL AND website_host=$3))`,
      [tenantId, key, host, exceptId ?? null])).rows;
  }

  r.get('/crm/companies', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      q: z.string().max(100).optional(), stage: z.enum(STAGES).optional(), tag: z.string().max(30).optional(), verified: z.enum(['true', 'false']).optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const { limit, offset } = paging(q);
    const p: unknown[] = [u.tenantId]; let w = 'c.tenant_id=$1';
    if (q.q) { p.push(`%${likeEscape(q.q)}%`); w += ` AND (c.name ILIKE $${p.length} OR c.industry ILIKE $${p.length} OR c.hq ILIKE $${p.length})`; }
    if (q.stage) { p.push(q.stage); w += ` AND c.stage=$${p.length}`; }
    if (q.tag) { p.push(q.tag); w += ` AND $${p.length} = ANY(c.tags)`; }
    if (q.verified) { p.push(q.verified === 'true'); w += ` AND c.verified=$${p.length}`; }
    const rows = (await pool.query(`${LIST_SQL} WHERE ${w} ORDER BY c.name, c.id LIMIT ${limit + 1} OFFSET ${offset}`, p)).rows;
    res.json(pageOf(rows.map(dto), limit, offset));
  }));

  r.post('/crm/companies', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<z.infer<typeof companyBody>>(companyBody, req.body ?? {});
    if (!b.force) {
      const dups = await findDuplicates(u.tenantId, b.name, b.website ?? null);
      if (dups.length) throw new ApiError(409, 'DUPLICATE_COMPANY', `A similar company already exists: ${dups[0].name}`, { existingId: dups[0].id });
    }
    const row = (await pool.query(
      `INSERT INTO companies (tenant_id,name,name_key,website,website_host,industry,hq,contacts,notes,tags,verified,logo_file_id,stage,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [u.tenantId, b.name, normalizeName(b.name), b.website ?? null, hostOf(b.website), b.industry ?? '', b.hq ?? '', JSON.stringify(b.contacts ?? []), b.notes ?? '', b.tags ?? [],
        b.verified ?? false, b.logoFileId ?? null, b.stage ?? 'prospect', u.id])).rows[0];
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.create', entityType: 'company', entityId: row.id, meta: { name: b.name, forced: !!b.force } });
    res.status(201).json({ company: dto(await load(u.tenantId, row.id)) });
  }));

  r.get('/crm/companies/duplicates', off, wrap(async (req, res) => {
    const rows = (await pool.query('SELECT id, name, website, name_key, website_host FROM companies WHERE tenant_id=$1 ORDER BY name', [me(req).tenantId])).rows;
    const groups = new Map<string, any[]>();
    const add = (k: string, c: any) => { if (!groups.has(k)) groups.set(k, []); if (!groups.get(k)!.some((x) => x.id === c.id)) groups.get(k)!.push({ id: c.id, name: c.name, website: c.website }); };
    for (const c of rows) { add(`name:${c.name_key}`, c); if (c.website_host) add(`site:${c.website_host}`, c); }
    res.json({ groups: [...groups.entries()].filter(([, v]) => v.length > 1).map(([key, companies]) => ({ key, companies })) });
  }));

  r.get('/crm/companies/export', off, wrap(async (req, res) => {
    const u = me(req);
    const rows = (await pool.query(`${LIST_SQL} WHERE c.tenant_id=$1 ORDER BY c.name`, [u.tenantId])).rows;
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.export', meta: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="companies.csv"');
    res.send(toCsv(['name', 'website', 'industry', 'hq', 'stage', 'verified', 'tags', 'contacts', 'drives', 'lastInteractionAt', 'nextFollowUpAt'],
      rows.map((c) => [c.name, c.website, c.industry, c.hq, c.stage, c.verified ? 'yes' : 'no', (c.tags || []).join('; '), (c.contacts || []).length, c.drive_count, iso(c.last_interaction), iso(c.next_follow_up)])));
  }));

  r.get('/crm/follow-ups', off, wrap(async (req, res) => {
    const q = parse<{ days: number }>(z.object({ days: z.coerce.number().int().min(1).max(180).default(14) }), req.query);
    const rows = (await pool.query(
      `SELECT i.*, c.name AS company_name FROM company_interactions i JOIN companies c ON c.id=i.company_id
        WHERE i.tenant_id=$1 AND i.follow_up_done=false AND i.follow_up_at IS NOT NULL AND i.follow_up_at < now() + ($2 || ' days')::interval ORDER BY i.follow_up_at`, [me(req).tenantId, String(q.days)])).rows;
    res.json({ items: rows.map((i) => ({ id: i.id, companyId: i.company_id, companyName: i.company_name, type: i.type, summary: i.summary, followUpAt: iso(i.follow_up_at), overdue: new Date(i.follow_up_at) < new Date() })) });
  }));

  r.get('/crm/companies/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const c = await load(u.tenantId, pid(req));
    const drives = (await pool.query(`SELECT id, role, status, deadline, ctc FROM drives WHERE company_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [c.id, u.tenantId])).rows;
    res.json({ company: dto(c), drives: drives.map((d) => ({ id: d.id, role: d.role, status: d.status, deadline: iso(d.deadline), totalLpa: totalPackage(d.ctc) })) });
  }));

  r.put('/crm/companies/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(companyBody.partial().omit({ force: true }).strict(), req.body ?? {});
    const cur = await load(u.tenantId, pid(req));
    const name = b.name ?? cur.name; const website = b.website === undefined ? cur.website : b.website;
    if (b.name !== undefined || b.website !== undefined) {
      const dups = await findDuplicates(u.tenantId, name, website, cur.id);
      if (dups.length) throw new ApiError(409, 'DUPLICATE_COMPANY', `A similar company already exists: ${dups[0].name}`, { existingId: dups[0].id });
    }
    await pool.query(
      `UPDATE companies SET name=$2, name_key=$3, website=$4, website_host=$5, industry=$6, hq=$7, contacts=$8, notes=$9, tags=$10, verified=$11, logo_file_id=$12, stage=$13, updated_at=now() WHERE id=$1`,
      [cur.id, name, normalizeName(name), website, hostOf(website), b.industry ?? cur.industry, b.hq ?? cur.hq, JSON.stringify(b.contacts ?? cur.contacts), b.notes ?? cur.notes,
        b.tags ?? cur.tags, b.verified ?? cur.verified, b.logoFileId === undefined ? cur.logo_file_id : b.logoFileId, b.stage ?? cur.stage]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.update', entityType: 'company', entityId: cur.id, meta: { fields: Object.keys(b) } });
    res.json({ company: dto(await load(u.tenantId, cur.id)) });
  }));

  r.delete('/crm/companies/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const cur = await load(u.tenantId, pid(req));
    await pool.query('DELETE FROM companies WHERE id=$1', [cur.id]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.delete', entityType: 'company', entityId: cur.id, meta: { name: cur.name } });
    res.json({ ok: true });
  }));

  r.post('/crm/companies/:id/stage', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ stage: (typeof STAGES)[number]; note?: string }>(z.object({ stage: z.enum(STAGES), note: textSchema(500).optional() }).strict(), req.body ?? {});
    const cur = await load(u.tenantId, pid(req));
    await pool.query('UPDATE companies SET stage=$2, updated_at=now() WHERE id=$1', [cur.id, b.stage]);
    if (b.note || cur.stage !== b.stage) {
      await pool.query(`INSERT INTO company_interactions (tenant_id,company_id,type,occurred_at,summary,created_by) VALUES ($1,$2,'other',now(),$3,$4)`,
        [u.tenantId, cur.id, `Stage changed ${cur.stage} -> ${b.stage}${b.note ? `: ${b.note}` : ''}`, u.id]);
    }
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.stage', entityType: 'company', entityId: cur.id, meta: { from: cur.stage, to: b.stage } });
    res.json({ company: dto(await load(u.tenantId, cur.id)) });
  }));

  const iDto = (i: any) => ({ id: i.id, companyId: i.company_id, type: i.type, occurredAt: iso(i.occurred_at), summary: i.summary, followUpAt: iso(i.follow_up_at), followUpDone: i.follow_up_done, createdBy: i.created_by, createdAt: iso(i.created_at) });
  r.get('/crm/companies/:id/interactions', off, wrap(async (req, res) => {
    const u = me(req);
    const c = await load(u.tenantId, pid(req));
    const rows = (await pool.query('SELECT * FROM company_interactions WHERE company_id=$1 ORDER BY occurred_at DESC, created_at DESC', [c.id])).rows;
    res.json({ items: rows.map(iDto) });
  }));
  r.post('/crm/companies/:id/interactions', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ type: z.enum(['call', 'meeting', 'email', 'other']), occurredAt: isoDate, summary: textSchema(2000, 3), followUpAt: isoDate.optional() }).strict(), req.body ?? {});
    const c = await load(u.tenantId, pid(req));
    if (b.followUpAt && new Date(b.followUpAt) < new Date(b.occurredAt)) throw new ApiError(400, 'VALIDATION_ERROR', 'Follow-up must be after the interaction', { followUpAt: 'Must be after occurredAt' });
    const row = (await pool.query(`INSERT INTO company_interactions (tenant_id,company_id,type,occurred_at,summary,follow_up_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [u.tenantId, c.id, b.type, b.occurredAt, b.summary, b.followUpAt ?? null, u.id])).rows[0];
    res.status(201).json({ interaction: iDto(row) });
  }));
  r.put('/crm/companies/:id/interactions/:iid', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ summary: textSchema(2000, 3).optional(), followUpAt: isoDate.nullable().optional(), followUpDone: z.boolean().optional() }).strict(), req.body ?? {});
    const cur = (await pool.query('SELECT * FROM company_interactions WHERE id=$1 AND company_id=$2 AND tenant_id=$3', [req.params.iid, pid(req), u.tenantId])).rows[0];
    if (!cur) throw notFound('Interaction not found', 'INTERACTION_NOT_FOUND');
    const row = (await pool.query(`UPDATE company_interactions SET summary=$2, follow_up_at=$3, follow_up_done=$4 WHERE id=$1 RETURNING *`,
      [cur.id, b.summary ?? cur.summary, b.followUpAt === undefined ? cur.follow_up_at : b.followUpAt, b.followUpDone ?? cur.follow_up_done])).rows[0];
    res.json({ interaction: iDto(row) });
  }));

  r.post('/crm/companies/:id/drives', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ driveId: string }>(z.object({ driveId: uuid }).strict(), req.body ?? {});
    const c = await load(u.tenantId, pid(req));
    const d = await pool.query('UPDATE drives SET company_id=$1 WHERE id=$2 AND tenant_id=$3', [c.id, b.driveId, u.tenantId]);
    if (!d.rowCount) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.link_drive', entityType: 'company', entityId: c.id, meta: { driveId: b.driveId } });
    res.json({ ok: true });
  }));
  r.delete('/crm/companies/:id/drives/:driveId', off, wrap(async (req, res) => {
    const u = me(req);
    const d = await pool.query('UPDATE drives SET company_id=NULL WHERE id=$1 AND company_id=$2 AND tenant_id=$3', [req.params.driveId, pid(req), u.tenantId]);
    if (!d.rowCount) throw notFound('Linked drive not found', 'DRIVE_NOT_FOUND');
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'company.unlink_drive', entityType: 'company', entityId: pid(req), meta: { driveId: req.params.driveId } });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- student-facing directory (public fields only)
  const VISIBLE = `(c.verified OR c.stage IN ('mou','hiring'))`;
  const pastVisits = `(SELECT jsonb_build_object('count', count(*)::int, 'lastVisitAt', max(d.deadline)) FROM drives d
        WHERE d.company_id=c.id AND d.status IN ('open','closed') AND (d.status='closed' OR d.deadline <= now()))`;
  const pub = (c: any) => ({
    id: c.id, name: c.name, website: c.website, industry: c.industry, hq: c.hq, logoFileId: c.logo_file_id, verified: c.verified,
    pastVisits: { count: c.visits?.count ?? 0, lastVisitAt: c.visits?.lastVisitAt ? new Date(c.visits.lastVisitAt).toISOString() : null },
  });
  r.get('/company-directory', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ q: z.string().max(100).optional(), cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const { limit, offset } = paging(q);
    const p: unknown[] = [u.tenantId]; let w = `c.tenant_id=$1 AND ${VISIBLE}`;
    if (q.q) { p.push(`%${likeEscape(q.q)}%`); w += ` AND (c.name ILIKE $${p.length} OR c.industry ILIKE $${p.length})`; }
    const rows = (await pool.query(`SELECT c.*, ${pastVisits} AS visits FROM companies c WHERE ${w} ORDER BY c.name LIMIT ${limit + 1} OFFSET ${offset}`, p)).rows;
    res.json(pageOf(rows.map(pub), limit, offset));
  }));
  r.get('/company-directory/:id', wrap(async (req, res) => {
    const u = me(req);
    const c = (await pool.query(`SELECT c.*, ${pastVisits} AS visits FROM companies c WHERE c.id=$1 AND c.tenant_id=$2 AND ${VISIBLE}`, [pid(req), u.tenantId])).rows[0];
    if (!c) throw notFound('Company not found', 'COMPANY_NOT_FOUND');
    const drives = (await pool.query(
      `SELECT role, ctc FROM drives WHERE company_id=$1 AND tenant_id=$2 AND status IN ('open','closed') AND (status='closed' OR deadline <= now())`, [c.id, u.tenantId])).rows;
    const totals = drives.filter((d) => (d.ctc?.kind || 'annual') === 'annual' && typeof d.ctc?.fixedLpa === 'number').map((d) => totalPackage(d.ctc));
    res.json({
      company: pub(c), roles: [...new Set(drives.map((d) => d.role).filter(Boolean))].sort(),
      ctcRange: totals.length ? { minLpa: Math.min(...totals), maxLpa: Math.max(...totals), drives: totals.length } : null,
    });
  }));
  return r;
}

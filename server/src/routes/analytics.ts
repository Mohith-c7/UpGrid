import { Router } from 'express';
import { z } from 'zod';
import * as Q from '../analytics/queries';
import { csvCell, toCsv } from '../csv';
import { Deps, me, requireRole } from '../context';
import { parse, wrap } from '../errors';
import { recordAudit } from '../policy/audit';
import { getOpsSettings, saveOpsSettings } from '../policy/store';
import { ApiError } from '../errors';

const DATASETS = ['drives', 'branches', 'batches', 'companies', 'funnel', 'students'] as const;

export async function studentExportRows(db: Deps['pool'], tenantId: string, f: Q.Filters) {
  const studs = await db.query(
    `SELECT u.id, p.data, p.verification, (SELECT count(*)::int FROM resumes r WHERE r.user_id=u.id) AS resumes,
       EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.status IN ('offer_accepted','joined')) AS placed
       FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL
        AND ($2::text IS NULL OR p.data->'academics'->>'batchYear' = $2) AND ($3::text IS NULL OR lower(p.data->'academics'->>'department') = $3)
      ORDER BY 1`, [tenantId, f.batch ? String(f.batch) : null, f.department ? f.department.toLowerCase() : null]);
  const band = (c: unknown) => (typeof c !== 'number' ? 'unknown' : c >= 9 ? '9+' : c >= 8 ? '8-9' : c >= 7 ? '7-8' : c >= 6 ? '6-7' : '<6');
  return studs.rows.map((s) => ({
    department: s.data?.academics?.department ?? '', batchYear: s.data?.academics?.batchYear ?? '', cgpaBand: band(s.data?.academics?.cgpa),
    profileCompletionPct: (require('../profile') as typeof import('../profile')).computeCompletion(s.data || {}, s.resumes).percent, placed: s.placed ? 'yes' : 'no',
  }));
}

async function dataset(deps: Deps, tenantId: string, name: (typeof DATASETS)[number], f: Q.Filters): Promise<Record<string, unknown>[]> {
  switch (name) {
    case 'drives': return (await Q.driveTable(deps.pool, tenantId, f)).map(({ completenessGaps, ...r }) => ({ ...r, completenessGaps: completenessGaps.join('; ') }));
    case 'branches': return (await Q.placement(deps.pool, tenantId, f)).byBranch;
    case 'batches': return (await Q.placement(deps.pool, tenantId, f)).byBatch;
    case 'companies': return (await Q.placement(deps.pool, tenantId, f)).byCompany;
    case 'funnel': return (await Q.funnel(deps.pool, tenantId, f)).stages;
    case 'students': return studentExportRows(deps.pool, tenantId, f);
  }
}

export function analyticsRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');

  r.get('/analytics/dashboard', off, wrap(async (req, res) => {
    res.json(await Q.dashboard(pool, me(req).tenantId, Q.parseFilters(req.query)));
  }));
  r.get('/analytics/placement', off, wrap(async (req, res) => {
    res.json(await Q.placement(pool, me(req).tenantId, Q.parseFilters(req.query)));
  }));
  r.get('/analytics/funnel', off, wrap(async (req, res) => {
    const { driveId, ...rest } = req.query as Record<string, string>;
    if (driveId !== undefined && !z.string().uuid().safeParse(driveId).success) throw new ApiError(400, 'VALIDATION_ERROR', 'driveId must be a valid id', { driveId: 'Must be a valid id' });
    res.json(await Q.funnel(pool, me(req).tenantId, Q.parseFilters(rest), driveId));
  }));
  r.get('/analytics/drives', off, wrap(async (req, res) => {
    res.json({ items: await Q.driveTable(pool, me(req).tenantId, Q.parseFilters(req.query)) });
  }));
  r.get('/analytics/reminders', off, wrap(async (req, res) => {
    res.json(await Q.reminderStats(pool, me(req).tenantId, Q.parseFilters(req.query)));
  }));
  r.get('/analytics/workload', off, wrap(async (req, res) => {
    res.json(await Q.workload(pool, me(req).tenantId));
  }));

  r.get('/analytics/export', off, wrap(async (req, res) => {
    const u = me(req);
    const { dataset: ds, format, ...rest } = req.query as Record<string, string>;
    const q = parse<{ dataset: (typeof DATASETS)[number]; format: 'csv' | 'json' }>(
      z.object({ dataset: z.enum(DATASETS, { message: `dataset must be one of ${DATASETS.join(', ')}` }), format: z.enum(['csv', 'json']).default('csv') }), { dataset: ds, format });
    const rows = await dataset(deps, u.tenantId, q.dataset, Q.parseFilters(rest));
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'analytics.export', entityType: 'dataset', entityId: q.dataset, meta: { format: q.format, rows: rows.length } });
    if (q.format === 'json') return res.json({ dataset: q.dataset, generatedAt: new Date().toISOString(), rows });
    const header = rows.length ? Object.keys(rows[0]) : [];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${q.dataset}.csv"`);
    res.send(toCsv(header, rows.map((x) => header.map((h) => x[h]))));
    void csvCell;
  }));

  r.get('/analytics/report-pack', off, wrap(async (req, res) => {
    const u = me(req);
    const f = Q.parseFilters(req.query);
    const [dashboard, placement, funnel, drives, reminders, tenant] = await Promise.all([
      Q.dashboard(pool, u.tenantId, f), Q.placement(pool, u.tenantId, f), Q.funnel(pool, u.tenantId, f), Q.driveTable(pool, u.tenantId, f),
      Q.reminderStats(pool, u.tenantId, f), pool.query('SELECT name FROM tenants WHERE id=$1', [u.tenantId]),
    ]);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'analytics.report_pack', meta: { filters: Q.filtersOut(f) } });
    res.json({ meta: { tenantName: tenant.rows[0]?.name ?? '', generatedAt: new Date().toISOString(), filters: Q.filtersOut(f) }, dashboard, placement, funnel, drives, reminders });
  }));

  r.get('/stats/public', wrap(async (req, res) => {
    const u = me(req);
    const s = await getOpsSettings(pool, u.tenantId);
    if (!s.publicStatsEnabled) return res.json({ enabled: false });
    res.json(await Q.publicStats(pool, u.tenantId, s.publicStatsMinGroup));
  }));

  r.get('/ops/settings', off, wrap(async (req, res) => {
    res.json(await getOpsSettings(pool, me(req).tenantId));
  }));
  r.put('/ops/settings', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({
      publicStatsEnabled: z.boolean().optional(),
      publicStatsMinGroup: z.number().int().min(5, 'Minimum group size cannot be below 5').max(100).optional(),
      restrictionApproval: z.enum(['required', 'not_required']).optional(),
      policyApproval: z.enum(['required', 'not_required']).optional(),
    }).strict(), req.body ?? {});
    const out = await saveOpsSettings(pool, u.tenantId, body);
    await recordAudit(pool, { tenantId: u.tenantId, actorId: u.id, action: 'settings.update', entityType: 'tenant_settings', entityId: u.tenantId, meta: body });
    res.json(out);
  }));
  return r;
}

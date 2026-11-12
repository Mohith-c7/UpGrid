import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, forbidden, notFound, parse, unprocessable, wrap } from '../errors';
import { validateConditions } from '../policy/conditions';
import { recordAudit } from '../policy/audit';
import { EMPTY_POLICY, POLICY_TEMPLATES, validatePolicy, Policy } from '../policy/schema';
import { simulatePolicy } from '../policy/simulate';
import { activateVersion, getActivePolicy, getOpsSettings } from '../policy/store';
import { iso, pageOf, paging, textSchema, uuid } from '../ops/util';

const versionDto = (v: any, withPolicy = false) => ({
  id: v.id, policyId: v.policy_id, version: v.version, status: v.status, effectiveFrom: iso(v.effective_from), note: v.note,
  createdBy: v.created_by, approvedBy: v.approved_by, approvedAt: iso(v.approved_at), activatedAt: iso(v.activated_at), rollbackOf: v.rollback_of, createdAt: iso(v.created_at),
  ...(withPolicy ? { policy: v.policy } : {}),
});
const policyDto = (p: any) => ({ id: p.id, name: p.name, description: p.description, createdAt: iso(p.created_at), updatedAt: iso(p.updated_at) });

/** validates policy JSON and maps problems to a 400 with field paths */
function requirePolicy(input: unknown): Policy {
  const v = validatePolicy(input);
  if (!v.valid) {
    const fields: Record<string, string> = {};
    for (const e of v.errors) fields[`policy.${e.path}`] ||= e.message;
    throw new ApiError(400, 'VALIDATION_ERROR', v.errors[0].message, fields);
  }
  return v.normalized!;
}
const effectiveFromSchema = z.string().datetime({ offset: true }).nullable().optional();

export function policyRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');

  r.get('/policy/templates', off, (_req, res) => {
    res.json({ items: POLICY_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, policy: t.policy })) });
  });

  r.get('/policy/active', off, wrap(async (req, res) => {
    const a = await getActivePolicy(pool, me(req).tenantId);
    res.json({ policy: a?.policy ?? null, version: a ? { id: a.version.id, version: a.version.version, policyId: a.version.policyId, name: a.version.name, effectiveFrom: a.version.effectiveFrom } : null });
  }));

  r.post('/policy/validate-draft', off, wrap(async (req, res) => {
    const body = parse<{ policy: unknown }>(z.object({ policy: z.unknown() }).strict(), req.body ?? {});
    res.json(validatePolicy(body.policy));
  }));
  r.post('/policy/validate-conditions', off, wrap(async (req, res) => {
    const body = parse<{ conditions: unknown }>(z.object({ conditions: z.unknown() }).strict(), req.body ?? {});
    res.json(validateConditions(body.conditions));
  }));

  r.get('/policy/policies', off, wrap(async (req, res) => {
    const u = me(req);
    const rows = (await pool.query(
      `SELECT pp.*,
         (SELECT jsonb_build_object('id',v.id,'version',v.version,'status',v.status) FROM policy_versions v WHERE v.policy_id=pp.id AND v.status IN ('active','scheduled') ORDER BY v.status LIMIT 1) AS active,
         (SELECT max(version) FROM policy_versions v WHERE v.policy_id=pp.id) AS latest
       FROM placement_policies pp WHERE pp.tenant_id=$1 ORDER BY pp.created_at DESC`, [u.tenantId])).rows;
    res.json({ items: rows.map((p) => ({ ...policyDto(p), activeVersion: p.active, latestVersion: p.latest })) });
  }));

  r.post('/policy/policies', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({
      name: textSchema(80, 2), description: textSchema(300).optional(), templateId: z.string().max(40).optional(), policy: z.unknown().optional(),
    }).strict(), req.body ?? {});
    let json: Policy = EMPTY_POLICY;
    if (body.policy !== undefined) json = requirePolicy(body.policy);
    else if (body.templateId) {
      const t = POLICY_TEMPLATES.find((x) => x.id === body.templateId);
      if (!t) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown template', { templateId: 'Unknown template' });
      json = t.policy;
    }
    const out = await withTx(pool, async (c) => {
      const p = (await c.query(`INSERT INTO placement_policies (tenant_id,name,description,created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [u.tenantId, body.name, body.description ?? '', u.id])).rows[0];
      const v = (await c.query(`INSERT INTO policy_versions (tenant_id,policy_id,version,policy,created_by,note) VALUES ($1,$2,1,$3,$4,$5) RETURNING *`,
        [u.tenantId, p.id, JSON.stringify(json), u.id, body.templateId ? `From template ${body.templateId}` : ''])).rows[0];
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.create', entityType: 'policy', entityId: p.id, meta: { name: body.name, templateId: body.templateId ?? null } });
      return { p, v };
    });
    res.status(201).json({ policy: policyDto(out.p), version: versionDto(out.v, true) });
  }));

  const loadPolicy = async (tenantId: string, id: string, db: any = pool, lock = false) => {
    const p = (await db.query(`SELECT * FROM placement_policies WHERE id=$1 AND tenant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, tenantId])).rows[0];
    if (!p) throw notFound('Policy not found', 'POLICY_NOT_FOUND');
    return p;
  };
  const loadVersion = async (tenantId: string, id: string, db: any = pool, lock = false) => {
    const v = (await db.query(`SELECT * FROM policy_versions WHERE id=$1 AND tenant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, tenantId])).rows[0];
    if (!v) throw notFound('Policy version not found', 'POLICY_VERSION_NOT_FOUND');
    return v;
  };

  r.get('/policy/policies/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const p = await loadPolicy(u.tenantId, pid(req));
    const vs = (await pool.query('SELECT * FROM policy_versions WHERE policy_id=$1 ORDER BY version DESC', [p.id])).rows;
    res.json({ policy: policyDto(p), versions: vs.map((v) => versionDto(v)) });
  }));
  r.get('/policy/versions/:id', off, wrap(async (req, res) => {
    res.json({ version: versionDto(await loadVersion(me(req).tenantId, pid(req)), true) });
  }));

  const newVersion = async (c: any, tenantId: string, policyId: string, actor: string, json: Policy, o: { effectiveFrom?: string | null; note?: string; status?: string; rollbackOf?: string }) => {
    const n = (await c.query('SELECT COALESCE(max(version),0)+1 AS n FROM policy_versions WHERE policy_id=$1', [policyId])).rows[0].n;
    return (await c.query(
      `INSERT INTO policy_versions (tenant_id,policy_id,version,policy,effective_from,note,created_by,status,rollback_of,approved_by,approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tenantId, policyId, n, JSON.stringify(json), o.effectiveFrom ?? null, o.note ?? '', actor, o.status ?? 'draft', o.rollbackOf ?? null,
        o.status === 'approved' ? actor : null, o.status === 'approved' ? new Date() : null])).rows[0];
  };

  r.post('/policy/policies/:id/versions', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({ policy: z.unknown().optional(), effectiveFrom: effectiveFromSchema, note: textSchema(300).optional() }).strict(), req.body ?? {});
    const v = await withTx(pool, async (c) => {
      const p = await loadPolicy(u.tenantId, pid(req), c, true);
      let json: Policy;
      if (body.policy !== undefined) json = requirePolicy(body.policy);
      else {
        const latest = (await c.query('SELECT policy FROM policy_versions WHERE policy_id=$1 ORDER BY version DESC LIMIT 1', [p.id])).rows[0];
        json = latest ? (latest.policy as Policy) : EMPTY_POLICY;
      }
      const row = await newVersion(c, u.tenantId, p.id, u.id, json, { effectiveFrom: body.effectiveFrom, note: body.note });
      await c.query('UPDATE placement_policies SET updated_at=now() WHERE id=$1', [p.id]);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.version_create', entityType: 'policy_version', entityId: row.id, meta: { policyId: p.id, version: row.version } });
      return row;
    });
    res.status(201).json({ version: versionDto(v, true) });
  }));

  r.put('/policy/versions/:id', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({ policy: z.unknown().optional(), effectiveFrom: effectiveFromSchema, note: textSchema(300).optional() }).strict(), req.body ?? {});
    const v = await withTx(pool, async (c) => {
      const cur = await loadVersion(u.tenantId, pid(req), c, true);
      if (cur.status !== 'draft') throw conflict('VERSION_NOT_DRAFT', 'Only draft versions can be edited. Create a new version instead.');
      const json = body.policy !== undefined ? requirePolicy(body.policy) : cur.policy;
      const row = (await c.query(
        `UPDATE policy_versions SET policy=$2, effective_from=$3, note=$4 WHERE id=$1 RETURNING *`,
        [cur.id, JSON.stringify(json), body.effectiveFrom !== undefined ? body.effectiveFrom : cur.effective_from, body.note ?? cur.note])).rows[0];
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.version_update', entityType: 'policy_version', entityId: cur.id, meta: { version: cur.version } });
      return row;
    });
    res.json({ version: versionDto(v, true) });
  }));

  r.post('/policy/versions/:id/approve', off, wrap(async (req, res) => {
    const u = me(req);
    const settings = await getOpsSettings(pool, u.tenantId);
    const v = await withTx(pool, async (c) => {
      const cur = await loadVersion(u.tenantId, pid(req), c, true);
      if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Only draft versions can be approved');
      if (settings.policyApproval === 'required' && cur.created_by === u.id) throw forbidden('You cannot approve a policy version you created. Ask another officer.', 'SELF_APPROVAL');
      const row = (await c.query(`UPDATE policy_versions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`, [cur.id, u.id])).rows[0];
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.approve', entityType: 'policy_version', entityId: cur.id, meta: { version: cur.version } });
      return row;
    });
    res.json({ version: versionDto(v) });
  }));

  r.post('/policy/versions/:id/activate', off, wrap(async (req, res) => {
    const u = me(req);
    const settings = await getOpsSettings(pool, u.tenantId);
    const out = await withTx(pool, async (c) => {
      const cur = await loadVersion(u.tenantId, pid(req), c, true);
      if (!['draft', 'approved'].includes(cur.status)) throw conflict('VERSION_NOT_ACTIVATABLE', `A ${cur.status} version cannot be activated. Use rollback to restore an earlier version.`);
      if (cur.status === 'draft' && settings.policyApproval === 'required') throw unprocessable('APPROVAL_REQUIRED', 'This version must be approved by another officer before it can be activated');
      if (cur.status === 'draft') await c.query(`UPDATE policy_versions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [cur.id, u.id]);
      const a = await activateVersion(c, u.tenantId, cur.id, u.id);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.activate', entityType: 'policy_version', entityId: cur.id, meta: { version: cur.version, policyId: cur.policy_id, immediate: a.active } });
      return { v: (await loadVersion(u.tenantId, cur.id, c)), active: a.active };
    });
    res.json({ version: versionDto(out.v), active: out.active });
  }));

  r.post('/policy/policies/:id/rollback', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ toVersionId: string; note?: string }>(z.object({ toVersionId: uuid, note: textSchema(300).optional() }).strict(), req.body ?? {});
    const v = await withTx(pool, async (c) => {
      const p = await loadPolicy(u.tenantId, pid(req), c, true);
      const target = await loadVersion(u.tenantId, body.toVersionId, c);
      if (target.policy_id !== p.id) throw notFound('Policy version not found', 'POLICY_VERSION_NOT_FOUND');
      if (!target.activated_at) throw unprocessable('NOT_ROLLBACKABLE', 'Only versions that were active before can be rolled back to');
      const row = await newVersion(c, u.tenantId, p.id, u.id, target.policy as Policy, { note: body.note ?? `Rollback to v${target.version}`, status: 'approved', rollbackOf: target.id });
      await activateVersion(c, u.tenantId, row.id, u.id);
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.rollback', entityType: 'policy_version', entityId: row.id, meta: { toVersion: target.version, newVersion: row.version, policyId: p.id } });
      return await loadVersion(u.tenantId, row.id, c);
    });
    res.status(201).json({ version: versionDto(v, true) });
  }));

  r.post('/policy/policies/:id/clone', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ name: string }>(z.object({ name: textSchema(80, 2) }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const src = await loadPolicy(u.tenantId, pid(req), c);
      const latest = (await c.query('SELECT policy FROM policy_versions WHERE policy_id=$1 ORDER BY version DESC LIMIT 1', [src.id])).rows[0];
      const p = (await c.query(`INSERT INTO placement_policies (tenant_id,name,description,created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [u.tenantId, body.name, src.description, u.id])).rows[0];
      const v = await newVersion(c, u.tenantId, p.id, u.id, latest.policy, { note: `Cloned from ${src.name}` });
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'policy.clone', entityType: 'policy', entityId: p.id, meta: { from: src.id, name: body.name } });
      return { p, v };
    });
    res.status(201).json({ policy: policyDto(out.p), version: versionDto(out.v, true) });
  }));

  r.post('/policy/simulate', off, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({ draft: z.unknown().optional(), versionId: uuid.optional(), driveId: uuid.optional() }).strict(), req.body ?? {});
    if ((body.draft === undefined) === (body.versionId === undefined)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send exactly one of draft or versionId', { draft: 'Send exactly one of draft or versionId' });
    let candidate: Policy; let label: string;
    if (body.draft !== undefined) { candidate = requirePolicy(body.draft); label = 'draft'; }
    else { candidate = (await loadVersion(u.tenantId, body.versionId)).policy as Policy; label = body.versionId; }
    if (body.driveId) {
      const d = await pool.query(`SELECT 1 FROM drives WHERE id=$1 AND tenant_id=$2 AND status<>'draft'`, [body.driveId, u.tenantId]);
      if (!d.rowCount) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    }
    res.json(await simulatePolicy(pool, u.tenantId, { candidate, candidateLabel: label, driveId: body.driveId }));
  }));

  r.get('/policy/evaluations', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ studentId: uuid.optional(), driveId: uuid.optional(), cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const { limit, offset } = paging(q);
    const rows = (await pool.query(
      `SELECT * FROM eligibility_evaluations WHERE tenant_id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND ($3::uuid IS NULL OR drive_id=$3)
        ORDER BY created_at DESC, id LIMIT ${limit + 1} OFFSET ${offset}`, [u.tenantId, q.studentId ?? null, q.driveId ?? null])).rows;
    res.json(pageOf(rows.map((e) => ({ id: e.id, studentId: e.user_id, driveId: e.drive_id, policyVersionId: e.policy_version_id, status: e.status, reasons: e.reasons, context: e.context, createdAt: iso(e.created_at) })), limit, offset));
  }));
  return r;
}

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { withTx } from '../db';
import { toCompany, toCtc } from '../drives';
import { ApiError, notFound, parse, wrap } from '../errors';
import { loadDriveAccess, normalizePermissions, getSettings, permissionsSchema } from '../pipeline/access';
import { inviteDto, inviteRecruiter, memberDto, resendInvite } from '../pipeline/invites';
import { funnel, listRounds } from '../pipeline/rounds';
import { audit, isUuid, Outbox, plainBody, requiredText } from '../pipeline/shared';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

/** Officer-side recruiter management (invite / list / permissions / revoke) and the recruiter's own drive list. */
export function registerRecruiterAdmin(deps: Deps, r: Router) {
  const { pool, push } = deps;
  const auth = authenticate(deps);
  const officer = [auth, requireRole('officer')];
  const staff = [auth, requireRole(['officer', 'recruiter'])];

  r.post('/drives/:id/recruiters', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    const body = plainBody(req.body, ['email', 'name', 'permissions']);
    const permissions = body.permissions === undefined ? normalizePermissions({}) : normalizePermissions(parse(permissionsSchema, body.permissions));
    const out = await inviteRecruiter(pool, push, u, drive, { email: body.email, name: body.name, permissions });
    res.status(out.status).json(out.body);
  }));

  r.get('/drives/:id/recruiters', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    const includeRevoked = req.query.includeRevoked === '1';
    const members = (await pool.query(
      `SELECT cr.*, u.name, u.email, u.phone FROM company_recruiters cr JOIN users u ON u.id=cr.user_id AND u.deleted_at IS NULL
        WHERE cr.drive_id=$1 AND cr.tenant_id=$2 ${includeRevoked ? '' : 'AND cr.revoked_at IS NULL'} ORDER BY cr.created_at`, [drive.id, u.tenantId])).rows;
    const invites = (await pool.query(`SELECT * FROM recruiter_invites WHERE drive_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 100`, [drive.id, u.tenantId])).rows;
    res.json({ members: members.map(memberDto), invites: invites.map(inviteDto) });
  }));

  r.patch('/drives/:id/recruiters/:userId', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    if (!isUuid(req.params.userId)) throw notFound('Recruiter not found', 'RECRUITER_NOT_FOUND');
    const body = plainBody(req.body, ['permissions']);
    const patch = parse<Record<string, boolean>>(permissionsSchema, body.permissions ?? {});
    const row = await withTx(pool, async (c) => {
      const m = (await c.query('SELECT permissions FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 AND tenant_id=$3 AND revoked_at IS NULL FOR UPDATE', [drive.id, req.params.userId, u.tenantId])).rows[0];
      if (!m) throw notFound('Recruiter not found', 'RECRUITER_NOT_FOUND');
      const next = normalizePermissions({ ...normalizePermissions(m.permissions), ...patch });
      await c.query('UPDATE company_recruiters SET permissions=$3 WHERE drive_id=$1 AND user_id=$2', [drive.id, req.params.userId, JSON.stringify(next)]);
      await audit(c, u.tenantId, u.id, 'recruiter.permissions', { driveId: drive.id, userId: req.params.userId, permissions: next });
      return (await c.query(`SELECT cr.*, u.name, u.email, u.phone FROM company_recruiters cr JOIN users u ON u.id=cr.user_id WHERE cr.drive_id=$1 AND cr.user_id=$2`, [drive.id, req.params.userId])).rows[0];
    });
    res.json({ member: memberDto(row) });
  }));

  r.delete('/drives/:id/recruiters/:userId', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    if (!isUuid(req.params.userId)) throw notFound('Recruiter not found', 'RECRUITER_NOT_FOUND');
    const body = plainBody(req.body, ['reason']);
    const reason = body.reason === undefined || body.reason === '' ? null : requiredText(body.reason, 1, 300, 'Reason', 'reason');
    const ob: Outbox[] = [];
    const out = await withTx(pool, async (c) => {
      const m = (await c.query('SELECT revoked_at FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 AND tenant_id=$3 FOR UPDATE', [drive.id, req.params.userId, u.tenantId])).rows[0];
      if (!m) throw notFound('Recruiter not found', 'RECRUITER_NOT_FOUND');
      if (m.revoked_at) return { ok: true, revoked: true, alreadyRevoked: true };
      await c.query('UPDATE company_recruiters SET revoked_at=now(), revoked_by=$3, revoke_reason=$4 WHERE drive_id=$1 AND user_id=$2', [drive.id, req.params.userId, u.id, reason]);
      const ox = new Outbox(c, u.tenantId);
      ob.push(ox);
      await ox.send(String(req.params.userId), 'recruiter_access', 'Access removed', `Your access to ${toCompany(drive.company).name} (${drive.role}) was removed by the placement cell.`, { driveId: drive.id });
      await audit(c, u.tenantId, u.id, 'recruiter.revoke', { driveId: drive.id, userId: req.params.userId, reason });
      return { ok: true, revoked: true, alreadyRevoked: false };
    });
    for (const o of ob) await o.flush(push, pool);
    res.json(out);
  }));

  r.delete('/drives/:id/recruiter-invites/:inviteId', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    if (!isUuid(req.params.inviteId)) throw notFound('Invite not found', 'INVITE_NOT_FOUND');
    const upd = await pool.query(`UPDATE recruiter_invites SET revoked_at=now() WHERE id=$1 AND drive_id=$2 AND tenant_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL`, [req.params.inviteId, drive.id, u.tenantId]);
    if (!upd.rowCount) {
      const exists = (await pool.query('SELECT 1 FROM recruiter_invites WHERE id=$1 AND drive_id=$2 AND tenant_id=$3', [req.params.inviteId, drive.id, u.tenantId])).rowCount;
      if (!exists) throw notFound('Invite not found', 'INVITE_NOT_FOUND');
    } else await audit(pool, u.tenantId, u.id, 'recruiter.invite_revoke', { driveId: drive.id, inviteId: req.params.inviteId });
    res.json({ ok: true });
  }));

  r.post('/drives/:id/recruiter-invites/:inviteId/resend', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const { drive } = await loadDriveAccess(pool, u, pid(req));
    if (!isUuid(req.params.inviteId)) throw notFound('Invite not found', 'INVITE_NOT_FOUND');
    res.json(await resendInvite(pool, u, drive, String(req.params.inviteId)));
  }));

  // ------------------------------------------------------------------ recruiter home
  const driveItem = (d: any, perms: any, counts: any) => ({
    driveId: d.id, company: toCompany(d.company), role: d.role, status: d.status, deadline: d.deadline ? new Date(d.deadline).toISOString() : null, permissions: perms, counts,
  });

  r.get('/recruiter/drives', ...staff, wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ status: z.enum(['open', 'closed']).optional(), cursor: z.string().max(100).optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId];
    let where = "d.tenant_id=$1 AND d.status <> 'draft'";
    if (u.role === 'recruiter') { params.push(u.id); where += ` AND EXISTS (SELECT 1 FROM company_recruiters cr WHERE cr.drive_id=d.id AND cr.user_id=$${params.length} AND cr.revoked_at IS NULL)`; }
    if (q.status) { params.push(q.status); where += ` AND d.status=$${params.length}`; }
    const rows = (await pool.query(
      `SELECT d.*, cr.permissions AS my_permissions FROM drives d LEFT JOIN company_recruiters cr ON cr.drive_id=d.id AND cr.user_id=${u.role === 'recruiter' ? '$2' : 'NULL'}
        WHERE ${where} ORDER BY d.created_at DESC, d.id LIMIT ${limit + 1} OFFSET ${offset}`, u.role === 'recruiter' ? params.slice(0, 2).concat(params.slice(2)) : params)).rows;
    const page = rows.slice(0, limit);
    const items = [];
    for (const d of page) {
      const st = await getSettings(pool, d.id);
      const vis = u.role === 'recruiter' ? `AND a.status <> 'submitted' ${st.showUnscreened ? '' : ''}` : '';
      const c = (await pool.query(
        `SELECT count(*) FILTER (WHERE a.status <> 'withdrawn' ${u.role === 'recruiter' && !st.showUnscreened ? "AND a.status <> 'submitted'" : ''})::int AS candidates,
                count(*) FILTER (WHERE cd.decision='shortlisted' AND a.status <> 'withdrawn')::int AS shortlisted,
                count(*) FILTER (WHERE cd.decision='rejected' AND a.status <> 'withdrawn')::int AS rejected
           FROM applications a LEFT JOIN candidate_decisions cd ON cd.application_id=a.id WHERE a.drive_id=$1 ${vis ? '' : ''}`, [d.id])).rows[0];
      const inRounds = (await pool.query(`SELECT count(DISTINCT rc.application_id)::int n FROM round_candidates rc JOIN applications a ON a.id=rc.application_id AND a.status <> 'withdrawn' WHERE rc.drive_id=$1`, [d.id])).rows[0].n;
      const offers = (await pool.query(`SELECT count(*)::int n FROM offers WHERE drive_id=$1 AND status IN ('pending_approval','issued','accepted','joined')`, [d.id])).rows[0].n;
      items.push(driveItem(d, d.my_permissions ? normalizePermissions(d.my_permissions) : null, { ...c, inRounds, offers }));
    }
    res.json({ items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  r.get('/recruiter/drives/:id', ...staff, wrap(async (req, res) => {
    const u = me(req);
    const a = await loadDriveAccess(pool, u, pid(req));
    const d = a.drive;
    if (d.status === 'draft') throw new ApiError(404, 'DRIVE_NOT_FOUND', 'Drive not found');
    const st = await getSettings(pool, d.id);
    res.json({
      drive: {
        id: d.id, company: toCompany(d.company), role: d.role, workMode: d.work_mode, locations: d.locations, ctc: toCtc(d.ctc), jd: d.jd, requirements: d.requirements,
        status: d.status, deadline: d.deadline ? new Date(d.deadline).toISOString() : null,
      },
      permissions: a.permissions, settings: st, rounds: await listRounds(pool, d.id), funnel: await funnel(pool, d.id, a.role === 'officer' || st.showUnscreened),
    });
  }));
}

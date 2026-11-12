import type { Request, RequestHandler } from 'express';
import type { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import type { Config } from './config';
import type { PushSender } from './push';
import { forbidden, unauthorized, wrap } from './errors';
import type { Integrations } from './integrations';

export interface Deps {
  pool: Pool;
  cfg: Config;
  push: PushSender;
  /** email / Google / Turnstile / file storage (see docs/integrations-api.md) */
  integrations?: Integrations;
}

export type Role = 'student' | 'officer' | 'recruiter';
export interface AuthUser { id: string; tenantId: string; role: Role; name: string }
export type AuthedRequest = Request & { user: AuthUser };
export const me = (req: Request) => (req as AuthedRequest).user;

export function signAccessToken(cfg: Config, u: { id: string; tenant_id: string; role: string }) {
  return jwt.sign({ sub: u.id, tid: u.tenant_id, role: u.role }, cfg.jwtSecret, { expiresIn: cfg.accessTtlSeconds, algorithm: 'HS256' });
}

export function authenticate({ pool, cfg }: Deps): RequestHandler {
  return wrap(async (req, _res, next) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(m[1], cfg.jwtSecret, { algorithms: ['HS256'] });
    } catch (e: any) {
      throw unauthorized(e?.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token', e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
    }
    const r = await pool.query('SELECT id, tenant_id, role, name FROM users WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [payload.sub, payload.tid]);
    if (!r.rows[0]) throw unauthorized('Account not found');
    (req as AuthedRequest).user = { id: r.rows[0].id, tenantId: r.rows[0].tenant_id, role: r.rows[0].role, name: r.rows[0].name };
    next();
  });
}

const ROLE_DENIED: Record<Role, string> = {
  officer: 'Placement officer access required',
  student: 'Student access required',
  recruiter: 'Recruiter access required',
};
/** Allows one role or any of several. Existing single-role calls behave exactly as before. */
export const requireRole = (role: Role | Role[]): RequestHandler => (req, _res, next) => {
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(me(req).role)) return next(forbidden(allowed.length === 1 ? ROLE_DENIED[allowed[0]] : 'You do not have access to this resource'));
  next();
};
/** Recruiters only use /recruiter/* and /pipeline/*; endpoints written for students/officers must not leak tenant data to them. */
export const denyRecruiter: RequestHandler = (req, _res, next) => {
  if (me(req).role === 'recruiter') return next(forbidden('Recruiter accounts cannot use this endpoint'));
  next();
};

export const pid = (req: Request) => String(req.params.id);

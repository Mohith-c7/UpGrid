import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError, forbidden, wrap } from '../errors';
import { me } from '../context';
import { assertAvailable, AiUser } from './service';

export const aiUser = (req: Request): AiUser => {
  const u = me(req);
  return { id: u.id, tenantId: u.tenantId, role: u.role as AiUser['role'], name: u.name };
};

/** like wrap(), but also emits Retry-After for AI quota/burst errors */
export const aiWrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  wrap(async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (e) {
      const ra = (e as { retryAfter?: number })?.retryAfter;
      if (ra && !res.headersSent) res.setHeader('Retry-After', String(ra));
      throw e;
    }
  });

/** 503 AI_NOT_CONFIGURED / AI_DISABLED before anything else runs */
export const gate: RequestHandler = (_req, _res, next) => {
  try { assertAvailable(); next(); } catch (e) { next(e); }
};

export const onlyRoles = (...roles: AiUser['role'][]): RequestHandler => (req, _res, next) =>
  roles.includes(aiUser(req).role) ? next() : next(forbidden(roles.includes('student') && roles.length === 1 ? 'Student access required' : 'This tool is for placement officers and recruiters'));

export function pageParams(req: Request): { offset: number; limit: number } {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  let offset = 0;
  if (typeof req.query.cursor === 'string' && req.query.cursor) {
    const n = Number(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(n) || n < 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
    offset = n;
  }
  return { offset, limit };
}
export const nextCursor = (offset: number, limit: number, got: number) =>
  got > limit ? Buffer.from(String(offset + limit)).toString('base64url') : null;

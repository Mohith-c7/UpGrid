import { Router } from 'express';
import type { Deps } from '../context';
import { wrap } from '../errors';
import { userDto } from './auth';
import { lookupInvite, registerRecruiter } from '../pipeline/invites';

/** Public (no auth) recruiter onboarding endpoints. Mounted under /auth so the auth rate limiter applies. */
export function recruiterPublicRouter(deps: Deps) {
  const r = Router();
  r.post('/recruiter-invite/lookup', wrap(async (req, res) => {
    res.json(await lookupInvite(deps.pool, req.body?.inviteToken));
  }));
  r.post('/register-recruiter', wrap(async (req, res) => {
    const out = await registerRecruiter(deps.pool, deps.cfg, req.body);
    res.status(201).json({ user: userDto(out.user), accessToken: out.accessToken, refreshToken: out.refreshToken, memberships: out.memberships });
  }));
  return r;
}

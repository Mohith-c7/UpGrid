import { Router } from 'express';
import { Deps } from '../context';
import { registerFeatureFlags } from '../features';
import { bindPipelinePool } from '../pipeline/policy';
import { registerPipelineCandidates } from './pipelineCandidates';
import { registerPipelineOffers } from './pipelineOffers';
import { registerPipelineRounds } from './pipelineRounds';
import { registerPipelineSlots } from './pipelineSlots';
import { registerRecruiterAdmin } from './recruiterAdmin';

registerFeatureFlags(() => ({ recruiter: true }));

/**
 * Hiring pipeline + recruiter module. Mounted at '/' (see MODULES marker in app.ts), so every route carries its own
 * authenticate/requireRole guards instead of a router-wide one (which would block later modules' routes).
 */
export function pipelineRouter(deps: Deps) {
  bindPipelinePool(deps.pool);
  const r = Router();
  registerRecruiterAdmin(deps, r);
  registerPipelineRounds(deps, r);
  registerPipelineCandidates(deps, r);
  registerPipelineSlots(deps, r);
  registerPipelineOffers(deps, r);
  return r;
}

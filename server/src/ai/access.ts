import type { Pool } from 'pg';

type AccessFn = (userId: string, applicationId: string) => Promise<boolean | { allowed?: boolean }> | boolean;
let override: AccessFn | null = null;
/** Test/integration hook. */
export function setCandidateAccess(fn: AccessFn | null) { override = fn; }

function pipelineAccess(): AccessFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../pipeline/access');
    return typeof mod?.canAccessCandidate === 'function' ? (mod.canAccessCandidate as AccessFn) : null;
  } catch {
    return null;
  }
}

/**
 * May `userId` (officer/recruiter) see this candidate's SHARED application data?
 * Order: injected override > pipeline module's canAccessCandidate (once merged) > local fallback.
 */
export async function canAccessCandidate(pool: Pool, userId: string, applicationId: string): Promise<boolean> {
  const fn = override || pipelineAccess();
  if (fn) {
    const r = await fn(userId, applicationId);
    return typeof r === 'object' && r !== null ? !!r.allowed : !!r;
  }
  // TODO(integration): remove this fallback when src/pipeline/access.ts exports canAccessCandidate().
  // Fallback: placement officers of the SAME tenant only. Recruiters are denied until the pipeline module's
  // company-membership check is available (we cannot know which companies they belong to).
  const r = await pool.query(
    `SELECT 1 FROM users u JOIN applications a ON a.tenant_id = u.tenant_id
      WHERE u.id=$1 AND a.id=$2 AND u.role='officer' AND u.deleted_at IS NULL`, [userId, applicationId]);
  return (r.rowCount ?? 0) > 0;
}

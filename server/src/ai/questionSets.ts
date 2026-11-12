import type { Db } from '../db';
import { notFound } from '../errors';

export const questionSetDto = (r: any) => ({
  id: r.id, applicationId: r.application_id, driveId: r.drive_id ?? null, roundType: r.round_type, difficulty: r.difficulty,
  status: r.status, draft: r.status === 'draft', groundedOn: r.grounded_on || [], questions: r.questions || [], focus: r.focus || [],
  createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null, scorecardRef: r.scorecard_ref ?? null,
});

/**
 * For the pipeline module: link an APPROVED question set to a scorecard. Throws unless a human approved it.
 */
export async function markQuestionSetAttached(db: Db, tenantId: string, questionSetId: string, scorecardRef: string) {
  const r = await db.query(
    `UPDATE ai_question_sets SET scorecard_ref=$3, updated_at=now() WHERE id=$2 AND tenant_id=$1 AND status='approved' RETURNING *`,
    [tenantId, questionSetId, scorecardRef]);
  if (!r.rows[0]) throw notFound('Approved question set not found');
  return questionSetDto(r.rows[0]);
}

export async function getApprovedQuestionSet(db: Db, tenantId: string, questionSetId: string) {
  const r = await db.query(`SELECT * FROM ai_question_sets WHERE id=$2 AND tenant_id=$1 AND status='approved'`, [tenantId, questionSetId]);
  return r.rows[0] ? questionSetDto(r.rows[0]) : null;
}

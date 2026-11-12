import type { Pool } from 'pg';
import { ApiError } from '../errors';

/**
 * Integration point for the assessments module. The assessments agent registers ONE adapter at startup:
 *
 *   registerQuestionBankAdapter({ async insertMcq(db, tenantId, userId, q) { ...insert into its bank...; return String(newId); } });
 *
 * until then importing is refused (501 QUESTION_BANK_NOT_LINKED) and nothing is faked.
 */
export interface McqForBank {
  topic: string; difficulty: 'easy' | 'medium' | 'hard'; tags: string[];
  stem: string; options: string[]; correctIndex: number; explanation: string;
}
export interface QuestionBankAdapter {
  insertMcq(db: Pool, tenantId: string, userId: string, q: McqForBank): Promise<string>;
}
let adapter: QuestionBankAdapter | null = null;
export function registerQuestionBankAdapter(a: QuestionBankAdapter | null) { adapter = a; }
export const questionBankLinked = () => adapter !== null;

export async function importDraftsToBank(pool: Pool, tenantId: string, userId: string, ids: string[]) {
  if (!adapter) throw new ApiError(501, 'QUESTION_BANK_NOT_LINKED', 'The assessments question bank is not linked to the AI module yet');
  const imported: Array<{ draftId: string; questionId: string }> = [];
  const skipped: Array<{ draftId: string; reason: string }> = [];
  for (const id of ids) {
    const d = (await pool.query(`SELECT * FROM ai_question_drafts WHERE id=$1 AND tenant_id=$2`, [id, tenantId])).rows[0];
    if (!d) { skipped.push({ draftId: id, reason: 'not found' }); continue; }
    if (d.status !== 'draft') { skipped.push({ draftId: id, reason: `already ${d.status}` }); continue; }
    try {
      const qid = await adapter.insertMcq(pool, tenantId, userId, {
        topic: d.topic, difficulty: d.difficulty, tags: d.tags || [], stem: d.stem, options: d.options, correctIndex: d.correct_index, explanation: d.explanation,
      });
      await pool.query(`UPDATE ai_question_drafts SET status='imported', imported_question_id=$2, updated_at=now() WHERE id=$1`, [id, qid]);
      imported.push({ draftId: id, questionId: qid });
    } catch (e) {
      skipped.push({ draftId: id, reason: (e as Error).message.slice(0, 120) });
    }
  }
  return { imported, skipped };
}

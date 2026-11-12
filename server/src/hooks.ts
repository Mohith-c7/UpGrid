import type { Deps } from './context';
import { setFileStore, MAX_RESUME_BYTES } from './ai/resumeText';
import { registerQuestionBankAdapter } from './ai/questionBank';
import { importRowToInput, insertQuestion } from './assessments/bank';
import { AudienceUnresolvedError, setCohortResolver } from './assessments/service';
import { sendMail } from './mail';
import { canAccessCandidate, setResumeSigner } from './pipeline/access';
import { setInviteMailer } from './pipeline/mailer';
import { resolveCohort } from './policy/cohorts';
import { registerFileAccessRule, URL_EXPIRES } from './routes/files';
import { integ } from './integrations';

const LETTERS = 'ABCDEFGH';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let fileRuleRegistered = false;

/**
 * Cross-module wiring. Each module exposes a setter / registry so it does not import its neighbours; this is the one place that
 * binds them. Called once per createApp (the setters are process-wide, the last app wins, which is correct for a single server
 * and harmless in tests because every app shares the same pool).
 */
export function bindModuleHooks(deps: Deps): void {
  const { pool } = deps;
  const storage = integ(deps).storage;

  // (a) AI reads uploaded resumes through the files table + R2 (null when R2 is not configured -> AI asks for pasted text)
  setFileStore(storage?.get ? {
    async get(fileId, ctx) {
      const f = (await pool.query(
        `SELECT id, owner_id, key, size FROM files WHERE id=$1 AND tenant_id=$2 AND purpose='resume' AND status='ready'`, [fileId, ctx.tenantId])).rows[0];
      if (!f) return null;
      if (Number(f.size) > MAX_RESUME_BYTES) return { bytes: Buffer.alloc(0), size: Number(f.size), ownerId: f.owner_id };
      const o = await storage.get!(f.key, MAX_RESUME_BYTES);
      return o ? { bytes: o.bytes, mime: o.contentType ?? undefined, size: o.bytes.length, etag: o.etag ?? undefined, ownerId: f.owner_id } : null;
    },
  } : null);

  // (b) assessments cohort audiences resolve through the ops cohort engine
  setCohortResolver(async (db, tenantId, cohortId) => {
    if (!UUID_RE.test(cohortId)) throw new AudienceUnresolvedError('Cohort not found');
    return resolveCohort(db, cohortId, tenantId);
  });

  // (c) AI-generated MCQ drafts are imported into the assessments question bank
  registerQuestionBankAdapter({
    async insertMcq(db, tenantId, userId, q) {
      const row: Record<string, unknown> = {
        type: 'mcq_single', title: q.stem.replace(/\s+/g, ' ').trim().slice(0, 200), body: q.stem, topic: q.topic, tags: q.tags,
        difficulty: q.difficulty, explanation: q.explanation, options: q.options, correct: LETTERS[q.correctIndex] ?? '',
      };
      const r = importRowToInput(row);
      if (!r.input) throw new Error(Object.values(r.errors ?? { question: 'Invalid question' })[0]);
      return String((await insertQuestion(db, tenantId, userId, r.input)).id);
    },
  });

  // (e) recruiters may read the resume file of candidates they are allowed to see; resume links are signed through R2
  if (!fileRuleRegistered) {
    fileRuleRegistered = true;
    registerFileAccessRule(async ({ db, user, file }) => {
      if (user.role !== 'recruiter' || file.purpose !== 'resume') return false;
      const apps = (await db.query(
        `SELECT id FROM applications WHERE tenant_id=$1 AND resume_snapshot->>'fileId' = $2 LIMIT 5`, [file.tenant_id, file.id])).rows;
      for (const a of apps) if ((await canAccessCandidate(user.id, a.id, db as any)).allowed) return true;
      return false;
    });
  }
  setResumeSigner(async (url, ctx) => {
    if (!ctx.fileId || !storage) throw new Error('not a stored file'); // caller falls back to the saved https link
    const f = (await pool.query(
      `SELECT f.key, f.file_name FROM files f JOIN applications a ON a.resume_snapshot->>'fileId' = f.id::text
        WHERE a.id=$1 AND f.id=$2 AND f.status='ready'`, [ctx.applicationId, ctx.fileId])).rows[0];
    if (!f) throw new Error('file not found');
    return { url: await storage.presignGet(f.key, URL_EXPIRES, f.file_name), expiresAt: new Date(Date.now() + URL_EXPIRES * 1000) };
  });

  // (f) recruiter invitations go out through the shared mail helper
  setInviteMailer((m) => sendMail(m.to, 'generic_notification', {
    name: m.name ?? undefined,
    title: `${m.invitedBy} invited you to review candidates for ${m.companyName}`,
    body: `You have been invited to the ${m.driveRole} drive for ${m.companyName} on UpGrid.\n\nOpen the app, choose "Recruiter sign up" and enter this invite code:\n\n${m.inviteToken}\n\nThe invite expires on ${m.expiresAt.toUTCString()}.`,
  }));
}

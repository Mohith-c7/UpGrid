import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../context';
import { ApiError, notFound, parse, unprocessable } from '../errors';
import { AiService } from '../ai/service';
import { aiUser, aiWrap, gate, onlyRoles } from '../ai/http';
import { requireConsent } from '../ai/consent';
import { extractResumeText, fileIdForResume, MAX_RESUME_CHARS } from '../ai/resumeText';
import { resumeReviewOut, ResumeReviewOut } from '../ai/schemas';
import { cleanText, detectInjection, INJECTION_RULE, maskUnsupportedNumbers, quoteIn, redactPii, untrusted } from '../ai/sanitize';
import { getProfileRow } from '../profile';

const body = z.object({
  resumeId: z.string().uuid().optional(),
  fileId: z.string().min(1).max(200).optional(),
  text: z.string().min(50, 'Paste at least 50 characters of resume text').max(MAX_RESUME_CHARS * 2).optional(),
  driveId: z.string().uuid().optional(),
}).strict().refine((b) => [b.resumeId, b.fileId, b.text].filter((x) => x !== undefined).length === 1, { message: 'Send exactly one of resumeId, fileId or text', path: ['resumeId'] });

const SYSTEM = (hasJd: boolean) => `You are a careful resume reviewer for Indian campus placements. Review the resume inside the <untrusted_data kind="resume"> block.
${INJECTION_RULE}
OUTPUT: return ONLY JSON matching the schema:
{"score": integer 0-100 (advisory quality of the resume as a document, not a hiring prediction),
 "strengths": string[], "gaps": string[], "ats_keywords_missing": string[],
 "rewrite_suggestions": [{"section": string, "before": string, "after": string}],
 "jd_match": ${hasJd ? '{"matched_skills": string[], "missing_skills": string[], "percent": integer 0-100}' : 'null'}}
RULES for rewrite_suggestions: "before" must be copied EXACTLY from the resume. "after" may only reword, tighten or restructure what "before" already says. Do NOT add employers, projects, tools, achievements, certifications or numbers that are not in the resume. When a metric would help, write the placeholder [X] and let the student supply it. At most 6 suggestions.
${hasJd ? 'jd_match: compare only skills literally evidenced in the resume with skills named in the job description block.' : ''}
Keep every string under 300 characters.`;

export function aiResumeRouter({ pool }: Deps) {
  const r = Router();
  const svc = new AiService(pool);

  r.post('/resume/review', onlyRoles('student'), gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof body>>(body, req.body);
    await requireConsent(pool, user.id);

    let raw: string;
    if (b.text !== undefined) raw = b.text;
    else {
      let fileId = b.fileId ?? null;
      if (b.resumeId) {
        const f = await fileIdForResume(pool, user.id, b.resumeId);
        if (!f.exists) throw notFound('Resume not found');
        fileId = f.fileId;
        if (!fileId) throw unprocessable('RESUME_NOT_READABLE', 'This resume is a link, which cannot be read. Paste your resume text instead.');
      }
      raw = await extractResumeText(pool, fileId as string, { userId: user.id, tenantId: user.tenantId });
    }

    const prof = await getProfileRow(pool, user.id);
    const u = (await pool.query('SELECT name, email, phone FROM users WHERE id=$1', [user.id])).rows[0];
    const text = cleanText(redactPii(raw, { names: [u?.name, prof.data.identity?.preferredName].filter(Boolean), registrationNumber: prof.data.identity?.registrationNumber, email: u?.email, phone: u?.phone }), MAX_RESUME_CHARS);
    if (text.length < 50) throw new ApiError(400, 'VALIDATION_ERROR', 'Resume text is too short to review', { text: 'Too short' });

    let jd: string | null = null;
    if (b.driveId) {
      const d = (await pool.query(`SELECT role, jd, requirements FROM drives WHERE id=$1 AND tenant_id=$2 AND status <> 'draft'`, [b.driveId, user.tenantId])).rows[0];
      if (!d) throw notFound('Drive not found');
      jd = `Role: ${d.role}\nRequirements: ${(d.requirements || []).join('; ')}\n${d.jd}`;
    }

    const flags = detectInjection(text);
    const content = [`Resume to review:`, untrusted('resume', text, MAX_RESUME_CHARS), jd ? `Job description to match against:\n${untrusted('job_description', jd, 4000)}` : ''].filter(Boolean).join('\n\n');

    const out = await svc.call<ResumeReviewOut>({
      user, feature: 'resume_review', system: SYSTEM(!!jd), messages: [{ role: 'user', text: content }],
      schema: resumeReviewOut, maxOutputTokens: 1800, temperature: 0.2, flags, cache: { scope: 'user' },
      after: (d) => {
        const suggestions = d.rewrite_suggestions
          .filter((s) => quoteIn(s.before, text)) // drop anything not actually quoted from the resume
          .map((s) => {
            const m = maskUnsupportedNumbers(s.after, `${text}`);
            return { section: s.section, before: s.before, after: m.text, needs_student_input: m.masked || /\[X\]/.test(s.after) };
          });
        return { ...d, rewrite_suggestions: suggestions as any, jd_match: jd ? d.jd_match ?? null : null };
      },
    });
    res.json({
      review: { advisory: true, ...out.data, jd_match: out.data.jd_match ?? null },
      disclaimer: 'Advisory only. This score is not used by recruiters or the placement cell.',
      ...(flags.length ? { warnings: ['The resume contained instruction-like text. It was treated as content and ignored.'] } : {}),
      usage: out.usage, quota: out.quota,
    });
  }));

  return r;
}

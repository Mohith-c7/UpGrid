import { Router, Request } from 'express';
import { z } from 'zod';
import type { Deps } from '../context';
import { ApiError, notFound, parse } from '../errors';
import { questionSchema } from '../drives';
import { evaluateEligibility } from '../eligibility';
import { AiService } from '../ai/service';
import { aiUser, aiWrap, gate, nextCursor, onlyRoles, pageParams } from '../ai/http';
import { canAccessCandidate } from '../ai/access';
import { getConsent } from '../ai/consent';
import { assertStaff, CandidateData, loadCandidate, redactFor } from '../ai/context';
import { extractResumeText, MAX_RESUME_CHARS } from '../ai/resumeText';
import {
  announcementOut, candidateSummaryOut, coerceRules, interviewQuestionsOut, jdParseOut, mcqOut, policyOut, storedQuestions,
} from '../ai/schemas';
import {
  cleanText, detectInjection, INJECTION_RULE, quoteIn, removeRecommendations, unsupportedNumbers, untrusted,
} from '../ai/sanitize';
import { questionSetDto } from '../ai/questionSets';
import { importDraftsToBank } from '../ai/questionBank';
import { toCompany } from '../drives';

const staff = onlyRoles('officer', 'recruiter');
const officer = onlyRoles('officer');
const DIFF = z.enum(['easy', 'medium', 'hard']);

// ---------------------------------------------------------------- candidate grounding
interface Grounding { c: CandidateData; sources: Record<'resume' | 'jd' | 'skills' | 'profile', string>; blocks: string; groundedOn: string[]; flags: string[] }

export async function groundCandidate(pool: Deps['pool'], user: ReturnType<typeof aiUser>, applicationId: string, pasted?: string): Promise<Grounding> {
  assertStaff(user);
  if (!(await canAccessCandidate(pool, user.id, applicationId))) throw notFound('Application not found');
  const c = await loadCandidate(pool, user.tenantId, applicationId);
  if (process.env.AI_REQUIRE_CANDIDATE_CONSENT !== 'false' && !(await getConsent(pool, c.studentUserId)).granted) {
    throw new ApiError(403, 'CANDIDATE_NO_AI_CONSENT', 'This candidate has not allowed AI tools to process their application data.');
  }
  let resume = '';
  if (pasted) resume = pasted;
  else if (c.resumeFileId) {
    try { resume = await extractResumeText(pool, c.resumeFileId, { userId: c.studentUserId, tenantId: user.tenantId }); } catch { resume = ''; }
  }
  resume = cleanText(redactFor(resume, c), MAX_RESUME_CHARS);
  const sh = c.shared;
  const profileText = [
    sh.department && `Department: ${sh.department}`, sh.program && `Program: ${sh.program}`, sh.batchYear && `Batch: ${sh.batchYear}`,
    sh.cgpa !== undefined && `CGPA: ${sh.cgpa}/${sh.cgpaScale ?? 10}`,
    ...Object.entries(sh.answers).map(([q, a]) => `${q}: ${redactFor(a, c)}`),
  ].filter(Boolean).join('\n');
  const jd = `Role: ${c.drive.role}\nCompany: ${c.drive.company}\nRequirements: ${c.drive.requirements.join('; ')}\n${c.drive.jd}`;
  const skills = sh.skills.join(', ');
  const sources = { resume, jd, skills, profile: profileText };
  const blocks = [
    resume ? `Candidate resume:\n${untrusted('resume', resume, MAX_RESUME_CHARS)}` : 'Candidate resume: NOT AVAILABLE (do not guess its content).',
    skills ? `Candidate skills (self-declared):\n${untrusted('skills', skills, 800)}` : '',
    profileText ? `Candidate profile and application answers:\n${untrusted('profile', profileText, 3000)}` : '',
    `Job description:\n${untrusted('job_description', jd, 5000)}`,
  ].filter(Boolean).join('\n\n');
  return {
    c, sources, blocks,
    groundedOn: (['resume', 'jd', 'skills', 'profile'] as const).filter((k) => sources[k].trim().length > 0),
    flags: detectInjection(`${resume}\n${profileText}`),
  };
}

const verifyEvidence = <T extends { source: string; quote: string }>(e: T | null | undefined, sources: Grounding['sources']) =>
  e ? quoteIn(e.quote, (sources as Record<string, string>)[e.source] || '') : false;

// ---------------------------------------------------------------- request schemas
const iqBody = z.object({
  applicationId: z.string().uuid(), roundType: z.string().trim().min(2).max(40), count: z.number().int().min(1).max(15),
  difficulty: DIFF, focus: z.array(z.string().trim().min(1).max(60)).max(8).optional(), resumeText: z.string().max(MAX_RESUME_CHARS * 2).optional(),
}).strict();
const summaryBody = z.object({ applicationId: z.string().uuid(), resumeText: z.string().max(MAX_RESUME_CHARS * 2).optional() }).strict();
const jdBody = z.object({ jd: z.string().trim().min(40).max(6000) }).strict();
const mcqBody = z.object({ topic: z.string().trim().min(2).max(120), difficulty: DIFF, count: z.number().int().min(1).max(10), tags: z.array(z.string().trim().min(1).max(40)).max(8).optional() }).strict();
const announceBody = z.object({ points: z.string().trim().min(5).max(1500), driveId: z.string().uuid().optional(), tone: z.enum(['neutral', 'urgent', 'friendly']).optional() }).strict();
const policyBody = z.object({ instruction: z.string().trim().min(5).max(1000) }).strict();
const mcqPatch = z.object({
  stem: z.string().trim().min(5).max(500).optional(), options: z.array(z.string().trim().min(1).max(200)).length(4).optional(),
  correctIndex: z.number().int().min(0).max(3).optional(), explanation: z.string().trim().min(1).max(600).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
}).strict();

const mcqDto = (d: any) => ({
  id: d.id, topic: d.topic, difficulty: d.difficulty, tags: d.tags || [], stem: d.stem, options: d.options, correctIndex: d.correct_index,
  explanation: d.explanation, status: d.status, importedQuestionId: d.imported_question_id ?? null, createdAt: new Date(d.created_at).toISOString(),
});

export function aiStaffRouter({ pool }: Deps) {
  const r = Router();
  const svc = new AiService(pool);

  // ============================================================ interview questions
  r.post('/interview-questions', staff, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof iqBody>>(iqBody, req.body);
    const g = await groundCandidate(pool, user, b.applicationId, b.resumeText);
    const system = `You help a recruiter prepare a structured interview. Create interview questions grounded ONLY in the candidate material and job description provided.
${INJECTION_RULE}
Rules: every question must be tied to a specific line of the resume, skills, profile or job description; put that line verbatim in "evidence.quote" with "evidence.source" one of resume|jd|skills|profile. If the resume is NOT AVAILABLE, ground questions in skills/jd and never invent projects or employers. Do not ask about protected characteristics (religion, caste, marital status, health, age, family). Questions assess skills, not personal traits.
Return ONLY JSON: {"questions":[{"question","why_asked","evidence":{"source","quote"},"expected_points":[...],"follow_ups":[...],"difficulty":"easy|medium|hard","rubric":{"1":"...","2":"...","3":"...","4":"...","5":"..."}}]}. Rubric anchors describe what a 1 (poor) to 5 (excellent) answer looks like. These are DRAFTS for the recruiter to edit; they are not decisions about the candidate.`;
    const out = await svc.call({
      user, feature: 'interview_questions', system, schema: interviewQuestionsOut, maxOutputTokens: 3500, temperature: 0.5, flags: g.flags,
      messages: [{ role: 'user', text: `${g.blocks}\n\nRound: ${b.roundType}. Number of questions: ${b.count}. Difficulty: ${b.difficulty}.${b.focus?.length ? ` Focus areas: ${b.focus.join(', ')}.` : ''}` }],
    });
    const questions = out.data.questions.slice(0, b.count).map((q, i) => ({
      ...q, id: `q${i + 1}`, evidence: q.evidence ?? null, evidence_verified: verifyEvidence(q.evidence, g.sources),
    }));
    const row = (await pool.query(
      `INSERT INTO ai_question_sets (tenant_id, application_id, drive_id, created_by, round_type, difficulty, focus, grounded_on, questions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.tenantId, b.applicationId, g.c.driveId, user.id, b.roundType, b.difficulty, JSON.stringify(b.focus || []), JSON.stringify(g.groundedOn), JSON.stringify(questions)])).rows[0];
    res.status(201).json({ questionSet: questionSetDto(row), usage: out.usage, quota: out.quota });
  }));

  const loadSet = async (req: Request) => {
    const user = aiUser(req);
    assertStaff(user);
    const row = (await pool.query('SELECT * FROM ai_question_sets WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenantId])).rows[0];
    if (!row || !(await canAccessCandidate(pool, user.id, row.application_id))) throw notFound('Question set not found');
    return { user, row };
  };

  r.get('/question-sets', staff, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const { offset, limit } = pageParams(req);
    const q = z.object({ applicationId: z.string().uuid().optional(), status: z.enum(['draft', 'approved', 'discarded']).optional() }).parse(req.query.applicationId || req.query.status ? { applicationId: req.query.applicationId, status: req.query.status } : {});
    const rows = (await pool.query(
      `SELECT * FROM ai_question_sets WHERE tenant_id=$1 AND ($2::uuid IS NULL OR application_id=$2) AND ($3::text IS NULL OR status=$3)
         AND (created_by=$4 OR $5::boolean) ORDER BY created_at DESC LIMIT $6 OFFSET $7`,
      [user.tenantId, q.applicationId ?? null, q.status ?? null, user.id, user.role === 'officer', limit + 1, offset])).rows;
    const visible = [];
    for (const row of rows.slice(0, limit)) if (await canAccessCandidate(pool, user.id, row.application_id)) visible.push(questionSetDto(row));
    res.json({ items: visible, nextCursor: nextCursor(offset, limit, rows.length) });
  }));

  r.get('/question-sets/:id', staff, aiWrap(async (req, res) => {
    const { row } = await loadSet(req);
    res.json({ questionSet: questionSetDto(row) });
  }));

  r.patch('/question-sets/:id', staff, aiWrap(async (req, res) => {
    const { row } = await loadSet(req);
    if (row.status !== 'draft') throw new ApiError(409, 'NOT_DRAFT', 'Only draft question sets can be edited');
    const b = parse<{ questions: z.infer<typeof storedQuestions> }>(z.object({ questions: storedQuestions }).strict(), req.body);
    const questions = b.questions.map((q, i) => ({ ...q, id: q.id || `q${i + 1}`, evidence: q.evidence ?? null, evidence_verified: q.evidence_verified ?? false }));
    const upd = await pool.query('UPDATE ai_question_sets SET questions=$2, updated_at=now() WHERE id=$1 RETURNING *', [row.id, JSON.stringify(questions)]);
    res.json({ questionSet: questionSetDto(upd.rows[0]) });
  }));

  r.post('/question-sets/:id/approve', staff, aiWrap(async (req, res) => {
    const { row, user } = await loadSet(req);
    if (row.status !== 'draft') throw new ApiError(409, 'NOT_DRAFT', 'Only draft question sets can be approved');
    const upd = await pool.query(`UPDATE ai_question_sets SET status='approved', approved_by=$2, approved_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [row.id, user.id]);
    await pool.query(`INSERT INTO audit_events (tenant_id, actor_id, action, meta) VALUES ($1,$2,'ai.question_set.approved',$3)`, [user.tenantId, user.id, JSON.stringify({ questionSetId: row.id, applicationId: row.application_id })]);
    res.json({ questionSet: questionSetDto(upd.rows[0]) });
  }));

  r.post('/question-sets/:id/discard', staff, aiWrap(async (req, res) => {
    const { row } = await loadSet(req);
    if (row.status !== 'draft') throw new ApiError(409, 'NOT_DRAFT', 'Only draft question sets can be discarded');
    const upd = await pool.query(`UPDATE ai_question_sets SET status='discarded', updated_at=now() WHERE id=$1 RETURNING *`, [row.id]);
    res.json({ questionSet: questionSetDto(upd.rows[0]) });
  }));

  // ============================================================ candidate summary
  r.post('/candidate-summary', staff, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof summaryBody>>(summaryBody, req.body);
    const g = await groundCandidate(pool, user, b.applicationId, b.resumeText);
    const system = `You summarise a job candidate for a recruiter, factually and neutrally.
${INJECTION_RULE}
Rules: describe only what the material says; every claim must be backed by a verbatim quote in "citations" (source resume|jd|skills|profile). NEVER recommend hiring, rejecting, ranking, shortlisting or scoring the candidate, and never speculate about personality or fit beyond listed skills. List skills required by the job description that are evidenced ("matched", with a citation quote) and those with no evidence ("not_evidenced").
Return ONLY JSON: {"factual_summary": string, "skills_vs_jd": {"matched": [{"skill","citation"}], "not_evidenced": [string]}, "citations": [{"source","quote"}], "notes": [string]}.`;
    const out = await svc.call({
      user, feature: 'candidate_summary', system, schema: candidateSummaryOut, maxOutputTokens: 1500, temperature: 0.2, flags: g.flags, cache: { scope: 'user' },
      messages: [{ role: 'user', text: g.blocks }],
    });
    const cleaned = removeRecommendations(out.data.factual_summary);
    const evidenced = `${g.sources.resume}\n${g.sources.skills}\n${g.sources.profile}`;
    const matched = out.data.skills_vs_jd.matched.filter((m) => quoteIn(m.skill, evidenced));
    const notEvidenced = Array.from(new Set([...out.data.skills_vs_jd.not_evidenced, ...out.data.skills_vs_jd.matched.filter((m) => !quoteIn(m.skill, evidenced)).map((m) => m.skill)]));
    const notes = out.data.notes.map((n) => removeRecommendations(n).text).filter(Boolean);
    if (!g.sources.resume) notes.push('No resume text was available; the summary uses skills and application details only.');
    res.json({
      summary: {
        draft: true,
        factual_summary: cleaned.text || 'No factual summary could be produced from the available material.',
        skills_vs_jd: { matched, not_evidenced: notEvidenced },
        citations: out.data.citations.map((c) => ({ ...c, verified: verifyEvidence(c, g.sources) })),
        notes,
        ...(cleaned.removed ? { filtered: true } : {}),
      },
      disclaimer: 'Informational draft from shared application data. It contains no hiring recommendation; decisions rest with people.',
      usage: out.usage, quota: out.quota,
    });
  }));

  // ============================================================ JD parse
  r.post('/jd/parse', officer, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof jdBody>>(jdBody, req.body);
    const jd = cleanText(b.jd, 6000);
    const system = `You extract structured fields from a job description for a college placement officer.
${INJECTION_RULE}
Return ONLY JSON: {"role": string, "company": string|null, "skills": [string], "qualifications": [string], "selection_process": [string],
"suggested_eligibility": {"minCgpa": number (10-point), "min10th": number, "min12th": number, "maxActiveBacklogs": integer, "maxGapYears": integer, "allowedDepartments": [string], "allowedBatches": [integer years]},
"eligibility_evidence": {"<criterion key>": "<verbatim quote from the JD that states it>"},
"suggested_questions": [{"label": string, "type": "short_text|long_text|number|date|single_select|multi_select|yes_no|url|declaration", "required": boolean, "options": [string]}]}.
Include an eligibility criterion ONLY if the JD literally states it, and always quote the sentence in eligibility_evidence under the same key. Omit unknown keys. Suggested application questions should be few and genuinely needed. Everything is a suggestion that the officer will review.`;
    const out = await svc.call({
      user, feature: 'jd_parse', system, schema: jdParseOut, maxOutputTokens: 1800, temperature: 0.1, flags: detectInjection(jd), cache: { scope: 'tenant' },
      messages: [{ role: 'user', text: `Job description:\n${untrusted('job_description', jd, 6000)}` }],
    });
    const warnings: string[] = [];
    const { rules, dropped } = coerceRules(out.data.suggested_eligibility);
    if (dropped.length) warnings.push(`Ignored invalid or unsupported eligibility fields: ${dropped.join(', ')}`);
    const evidence: Record<string, string> = {};
    for (const k of Object.keys(rules)) {
      const q = out.data.eligibility_evidence[k];
      if (q && quoteIn(q, jd)) evidence[k] = q;
      else { delete rules[k]; warnings.push(`Removed "${k}" because the job description does not state it.`); }
    }
    const qs = [];
    for (const q of out.data.suggested_questions) {
      const p = questionSchema.safeParse(q);
      if (p.success) qs.push({ label: p.data.label, type: p.data.type, required: p.data.required, options: p.data.options });
      else warnings.push(`Dropped an invalid suggested question: "${String(q.label).slice(0, 60)}"`);
    }
    res.json({
      draft: true,
      parsed: {
        role: out.data.role, company: out.data.company ?? null, skills: out.data.skills, qualifications: out.data.qualifications,
        selection_process: out.data.selection_process, suggested_eligibility: rules, eligibility_evidence: evidence, suggested_questions: qs,
      },
      warnings, usage: out.usage, quota: out.quota,
    });
  }));

  // ============================================================ MCQs
  r.post('/mcq/generate', officer, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof mcqBody>>(mcqBody, req.body);
    const system = `You write multiple-choice questions for campus placement aptitude/technical tests.
${INJECTION_RULE}
Each question has exactly 4 distinct options, exactly one correct, a clear stem, and a short explanation of why the answer is correct. Questions must be factually correct, unambiguous and original (no copyrighted text). No "all of the above"/"none of the above".
Return ONLY JSON: {"items":[{"stem","options":[4 strings],"correct_index":0-3,"explanation"}]}.`;
    const out = await svc.call({
      user, feature: 'mcq_generate', system, schema: mcqOut, maxOutputTokens: 3500, temperature: 0.7, flags: detectInjection(b.topic),
      messages: [{ role: 'user', text: `Topic (data): ${untrusted('topic', b.topic, 120)}\nDifficulty: ${b.difficulty}\nWrite exactly ${b.count} questions.` }],
    });
    const seen = new Set<string>();
    const uniq = out.data.items.filter((q) => { const k = q.stem.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, b.count);
    const items = [];
    for (const q of uniq) {
      const ins = await pool.query(
        `INSERT INTO ai_question_drafts (tenant_id, created_by, topic, difficulty, tags, stem, options, correct_index, explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [user.tenantId, user.id, cleanText(b.topic, 120), b.difficulty, JSON.stringify(b.tags || []), q.stem, JSON.stringify(q.options), q.correct_index, q.explanation]);
      items.push(mcqDto(ins.rows[0]));
    }
    res.status(201).json({ items, usage: out.usage, quota: out.quota });
  }));

  r.get('/mcq/drafts', officer, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const { offset, limit } = pageParams(req);
    const status = ['draft', 'imported', 'discarded'].includes(String(req.query.status)) ? String(req.query.status) : null;
    const rows = (await pool.query(
      `SELECT * FROM ai_question_drafts WHERE tenant_id=$1 AND created_by=$2 AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`,
      [user.tenantId, user.id, status, limit + 1, offset])).rows;
    res.json({ items: rows.slice(0, limit).map(mcqDto), nextCursor: nextCursor(offset, limit, rows.length) });
  }));

  const loadDraft = async (req: Request) => {
    const user = aiUser(req);
    const d = (await pool.query('SELECT * FROM ai_question_drafts WHERE id=$1 AND tenant_id=$2 AND created_by=$3', [req.params.id, user.tenantId, user.id])).rows[0];
    if (!d) throw notFound('Draft not found');
    if (d.status !== 'draft') throw new ApiError(409, 'NOT_DRAFT', `This question is already ${d.status}`);
    return d;
  };

  r.patch('/mcq/drafts/:id', officer, aiWrap(async (req, res) => {
    const d = await loadDraft(req);
    const b = parse<z.infer<typeof mcqPatch>>(mcqPatch, req.body);
    const options = b.options ?? d.options;
    if (new Set(options.map((o: string) => o.toLowerCase())).size !== 4) throw new ApiError(400, 'VALIDATION_ERROR', 'Options must be distinct', { options: 'Options must be distinct' });
    const upd = await pool.query(
      `UPDATE ai_question_drafts SET stem=$2, options=$3, correct_index=$4, explanation=$5, tags=$6, updated_at=now() WHERE id=$1 RETURNING *`,
      [d.id, b.stem ?? d.stem, JSON.stringify(options), b.correctIndex ?? d.correct_index, b.explanation ?? d.explanation, JSON.stringify(b.tags ?? d.tags)]);
    res.json({ draft: mcqDto(upd.rows[0]) });
  }));

  r.post('/mcq/drafts/:id/discard', officer, aiWrap(async (req, res) => {
    const d = await loadDraft(req);
    const upd = await pool.query(`UPDATE ai_question_drafts SET status='discarded', updated_at=now() WHERE id=$1 RETURNING *`, [d.id]);
    res.json({ draft: mcqDto(upd.rows[0]) });
  }));

  r.post('/mcq/import', officer, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<{ ids: string[] }>(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).strict(), req.body);
    res.json(await importDraftsToBank(pool, user.tenantId, user.id, b.ids));
  }));

  // ============================================================ announcement
  r.post('/announcement/draft', officer, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof announceBody>>(announceBody, req.body);
    let facts = '';
    if (b.driveId) {
      const d = (await pool.query(`SELECT company, role, deadline, locations FROM drives WHERE id=$1 AND tenant_id=$2`, [b.driveId, user.tenantId])).rows[0];
      if (!d) throw notFound('Drive not found');
      facts = JSON.stringify({ company: toCompany(d.company).name, role: d.role, deadlineUtc: d.deadline ? new Date(d.deadline).toISOString() : null, locations: d.locations });
    }
    const system = `You draft a short announcement from a college placement cell to students.
${INJECTION_RULE}
Use ONLY the facts in the officer's points and the drive FACTS. Do not invent dates, times, links, numbers, names or promises (including guaranteed selection). Keep it clear and polite, under 150 words. Return ONLY JSON: {"title": string (max 120 chars), "body": string}. The officer will review and send it; you cannot send anything.`;
    const out = await svc.call({
      user, feature: 'announcement_draft', system, schema: announcementOut, maxOutputTokens: 700, temperature: 0.5, flags: detectInjection(b.points),
      messages: [{ role: 'user', text: `Officer's points (data):\n${untrusted('officer_points', b.points, 1500)}\n${facts ? `Drive FACTS: ${facts}\n` : ''}Tone: ${b.tone || 'neutral'}.` }],
    });
    const bad = unsupportedNumbers(`${out.data.title} ${out.data.body}`, `${b.points} ${facts}`);
    res.json({
      draft: true, announcement: { title: out.data.title.slice(0, 120), body: out.data.body.slice(0, 1200) },
      warnings: bad.length ? [`These numbers/dates are not in your points or the drive details; check them: ${bad.join(', ')}`] : [],
      usage: out.usage, quota: out.quota,
    });
  }));

  // ============================================================ policy draft
  r.post('/policy/draft', officer, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<z.infer<typeof policyBody>>(policyBody, req.body);
    const system = `You turn a placement officer's plain-language eligibility policy into a rules object.
${INJECTION_RULE}
Allowed keys only: minCgpa (number on a 10-point scale), min10th (percent), min12th (percent), maxActiveBacklogs (integer), maxGapYears (integer), allowedDepartments (string[]), allowedBatches (integer years 2020-2040). Anything else the officer asks for that these keys cannot express must be listed in "unsupported" (do not approximate it). Return ONLY JSON: {"rules": {...}, "explanation": string, "unsupported": [string]}. This is a draft that the officer must simulate and approve; you never apply rules.`;
    const out = await svc.call({
      user, feature: 'policy_draft', system, schema: policyOut, maxOutputTokens: 800, temperature: 0.1, flags: detectInjection(b.instruction),
      messages: [{ role: 'user', text: `Policy in plain language (data):\n${untrusted('policy_text', b.instruction, 1000)}` }],
    });
    const { rules, dropped } = coerceRules(out.data.rules);
    const students = (await pool.query(
      `SELECT p.data, p.verification FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [user.tenantId])).rows;
    const sim = { total: students.length, eligible: 0, not_eligible: 0, pending: 0, byCriterion: {} as Record<string, number> };
    for (const s of students) {
      const e = evaluateEligibility(rules as any, { academics: s.data?.academics, verification: s.verification });
      sim[e.status] += 1;
      for (const rs of e.reasons) if (rs.met === false) sim.byCriterion[rs.criterion] = (sim.byCriterion[rs.criterion] || 0) + 1;
    }
    res.json({
      draft: true, approved: false, rules, explanation: out.data.explanation,
      unsupported: [...out.data.unsupported, ...dropped.map((d) => `Ignored invalid field: ${d}`)],
      simulation: sim, usage: out.usage, quota: out.quota,
    });
  }));

  return r;
}

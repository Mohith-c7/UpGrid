import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, denyRecruiter, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { effectiveStatus, toCompany } from '../drives';
import { ApiError, conflict, forbidden, notFound, parse, unprocessable, wrap } from '../errors';
import { createNotification } from '../notify';
import { integ } from '../integrations';
import { dispatchMail, MailJob, userMailJob } from '../mail';
import { applyPatch, getProfileRow, saveProfile, VERIFIABLE } from '../profile';
import { cancelForUserDrive, syncForUser } from '../reminders';
import { latestSchedule } from '../schedule';
import { validateHttpsUrl, formatPhone } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';
import { resumeDto, RESUME_SELECT } from './profile';
import { assertOfferNotExpired, notifyOfferResponded } from '../pipeline/offerHooks';
import { assessEligibility } from '../policy/assess';

export const STATUSES = [
  'submitted', 'screening', 'assessment', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'offer_declined',
  'rejected', 'withdrawn', 'joined',
] as const;
export type AppStatus = (typeof STATUSES)[number];

export const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  // officers may schedule an assessment / interview straight from `submitted` (no screening step required)
  submitted: ['screening', 'assessment', 'interview', 'rejected', 'withdrawn'],
  screening: ['assessment', 'interview', 'selected', 'rejected'],
  assessment: ['interview', 'selected', 'rejected'],
  interview: ['selected', 'rejected'],
  selected: ['offer_issued', 'rejected'],
  offer_issued: ['offer_accepted', 'offer_declined'],
  offer_accepted: ['joined'],
  offer_declined: [],
  rejected: [],
  withdrawn: [],
  joined: [],
};

const STATUS_LABEL: Record<string, string> = {
  screening: 'is under screening', assessment: 'moved to the assessment round', interview: 'moved to the interview round',
  selected: 'has been shortlisted as selected', offer_issued: 'has an offer issued', offer_accepted: 'offer accepted',
  offer_declined: 'offer declined', rejected: 'was not selected', joined: 'joined', withdrawn: 'was withdrawn',
};

export function validateAnswers(questions: any[], answers: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {};
  const ids = new Set(questions.map((q) => q.id));
  for (const k of Object.keys(answers)) if (!ids.has(k)) errs[`answers.${k}`] = 'Unknown question';
  for (const q of questions) {
    const key = `answers.${q.id}`;
    const v = answers[q.id];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
    if (q.type === 'declaration') {
      if (q.required && v !== true) errs[key] = 'You must accept this declaration';
      else if (v !== undefined && v !== null && typeof v !== 'boolean') errs[key] = 'Must be true or false';
      continue;
    }
    if (q.type === 'yes_no') {
      if (v === undefined || v === null) { if (q.required) errs[key] = 'This answer is required'; }
      else if (typeof v !== 'boolean') errs[key] = 'Answer yes or no';
      continue;
    }
    if (empty) { if (q.required) errs[key] = 'This answer is required'; continue; }
    switch (q.type) {
      case 'short_text':
      case 'long_text': {
        const max = q.maxLength || (q.type === 'short_text' ? 200 : 2000);
        if (typeof v !== 'string') errs[key] = 'Must be text';
        else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) errs[key] = 'Contains invalid characters';
        else if (v.trim().length > max) errs[key] = `Must be at most ${max} characters`;
        break;
      }
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errs[key] = 'Enter a number';
        break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) errs[key] = 'Enter a valid date (YYYY-MM-DD)';
        break;
      case 'single_select':
        if (typeof v !== 'string' || !q.options.includes(v)) errs[key] = 'Choose one of the listed options';
        break;
      case 'multi_select':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !q.options.includes(x)) || new Set(v).size !== v.length) errs[key] = 'Choose from the listed options';
        break;
      case 'url': {
        const r = validateHttpsUrl(v);
        if (!r.ok) errs[key] = r.message;
        break;
      }
    }
  }
  return errs;
}

function profileSnapshot(user: any, p: { data: any; verification: Record<string, string> }) {
  const a = p.data.academics || {};
  return {
    name: user.name, email: user.email, phone: user.phone,
    registrationNumber: p.data.identity?.registrationNumber ?? null,
    university: a.university ?? null, department: a.department ?? null, program: a.program ?? null, batchYear: a.batchYear ?? null,
    cgpa: a.cgpa ?? null, cgpaScale: a.cgpaScale ?? 10, tenthPercent: a.tenthPercent ?? null, twelfthPercent: a.twelfthPercent ?? null,
    activeBacklogs: a.activeBacklogs ?? null, gapYears: a.gapYears ?? null,
    linkedin: p.data.links?.linkedin ?? null, github: p.data.links?.github ?? null,
    verification: Object.fromEntries(Object.entries(p.verification).filter(([k]) => VERIFIABLE.has(k))),
  };
}

function mappedFields(user: any, p: { data: any; verification: Record<string, string> }, sharedWith: string) {
  const a = p.data.academics || {};
  const v = (k: string) => (p.verification[k] as any) || 'unverified';
  const f = (key: string, label: string, value: unknown, vk?: string) => ({
    key, label, value: value ?? null, source: 'profile' as const,
    verification: vk ? v(vk) : ('student_confirmed' as const), sharedWith,
  });
  return [
    f('name', 'Name', user.name),
    f('email', 'Email', user.email),
    f('phone', 'Mobile number', formatPhone(user.phone)),
    f('registrationNumber', 'Registration number', p.data.identity?.registrationNumber, 'identity.registrationNumber'),
    f('department', 'Department', a.department, 'academics.department'),
    f('program', 'Program', a.program, 'academics.program'),
    f('batchYear', 'Batch year', a.batchYear, 'academics.batchYear'),
    f('cgpa', 'CGPA', a.cgpa, 'academics.cgpa'),
    f('tenthPercent', '10th %', a.tenthPercent, 'academics.tenthPercent'),
    f('twelfthPercent', '12th %', a.twelfthPercent, 'academics.twelfthPercent'),
    f('activeBacklogs', 'Active backlogs', a.activeBacklogs, 'academics.activeBacklogs'),
    f('gapYears', 'Gap years', a.gapYears, 'academics.gapYears'),
    f('linkedin', 'LinkedIn', p.data.links?.linkedin, 'links.linkedin'),
  ];
}

const applyBodySchema = z.object({
  idempotencyKey: z.string().uuid('idempotencyKey must be a UUID'),
  resumeId: z.string().uuid('resumeId must be a UUID'),
  answers: z.record(z.string(), z.any()).default({}),
  declarationsAccepted: z.literal(true, { message: 'You must accept the declarations' }),
  saveToProfile: z.array(z.string().max(60)).max(10).optional(),
}).strict();

export function applicationRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps));

  const loadDrive = async (tenantId: string, id: string, db: any = pool, lock = false) => {
    const row = (await db.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2 AND status <> 'draft' ${lock ? 'FOR SHARE' : ''}`, [id, tenantId])).rows[0];
    if (!row) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
    return row;
  };
  const receipt = (a: any) => ({ id: a.id, reference: a.reference, submittedAt: new Date(a.submitted_at).toISOString() });

  // ------------------------------------------------------------ preview
  r.post('/drives/:id/application/preview', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const drive = await loadDrive(u.tenantId, pid(req));
    const user = (await pool.query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
    const p = await getProfileRow(pool, u.id);
    const now = new Date((await pool.query('SELECT now() AS n')).rows[0].n);
    const elig = await assessEligibility(pool, u.tenantId, drive, u.id, p);
    const resumes = (await pool.query(`${RESUME_SELECT} WHERE r.user_id=$1 ORDER BY r.is_default DESC, r.created_at`, [u.id])).rows;
    const existing = (await pool.query(`SELECT id FROM applications WHERE user_id=$1 AND drive_id=$2 AND status <> 'withdrawn'`, [u.id, drive.id])).rows[0];
    const status = effectiveStatus(drive, now);
    const companyName = toCompany(drive.company).name;

    let blockedReason: string | undefined;
    let blockedCode: string | undefined;
    if (status === 'closed') blockedReason = 'Applications for this drive are closed';
    else if (existing) blockedReason = 'You have already applied to this drive';
    else if (!user.phone) { blockedReason = 'Add your mobile number to apply'; blockedCode = 'PHONE_REQUIRED'; }
    else if (integ(deps).requireVerifiedEmail && !user.email_verified_at) { blockedReason = 'Verify your email address to apply'; blockedCode = 'EMAIL_NOT_VERIFIED'; }
    else if (elig.status === 'not_eligible') blockedReason = elig.reason;
    else if (elig.status === 'restricted') blockedReason = elig.reason;
    else if (elig.status === 'pending') blockedReason = `Complete your profile to apply: ${elig.reason}`;
    else if (resumes.length === 0) blockedReason = 'Add a resume link to apply';

    const a = p.data;
    res.json({
      mapped: mappedFields(user, p, companyName),
      conflicts: elig.reasons
        .filter((x) => x.met !== null && x.verification !== 'verified' && !['policy', 'restriction', 'custom'].includes(x.criterion as string))
        .map((x) => ({ key: x.criterion, label: x.label, value: x.actual, issue: 'Not yet verified by the placement cell', verification: x.verification })),
      missingProfileFields: elig.reasons.filter((x) => x.met === null).map((x) => ({ key: x.criterion, label: x.label, message: x.message })),
      questionsToAsk: (drive.questions || []).map((q: any) => {
        const [sec, fld] = (q.saveToProfileKey || '').split('.');
        const prefill = sec ? (a as any)[sec]?.[fld] ?? null : null;
        return { ...q, prefill };
      }),
      resumes: resumes.map(resumeDto),
      deadline: new Date(drive.deadline).toISOString(),
      serverNow: now.toISOString(),
      eligibility: { status: elig.status, reason: elig.reason, reasons: elig.reasons },
      canApply: !blockedReason,
      ...(blockedReason ? { blockedReason } : {}),
      ...(blockedCode ? { blockedCode } : {}),
    });
  }));

  // ------------------------------------------------------------ apply
  r.post('/drives/:id/apply', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const body = parse<z.infer<typeof applyBodySchema>>(applyBodySchema, req.body ?? {});
    const driveId = pid(req);

    const attempt = async () =>
      withTx(pool, async (c) => {
        // serialize per (drive,user) so concurrent submits queue up and later ones replay
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${driveId}:${u.id}`]);
        // 1. Idempotent replay (same key)
        const prior = (await c.query('SELECT * FROM applications WHERE user_id=$1 AND idempotency_key=$2', [u.id, body.idempotencyKey])).rows[0];
        if (prior) {
          if (prior.drive_id !== driveId) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different drive');
          return { replay: true, app: prior };
        }
        // 2. lock the drive row shared so close can't interleave
        const drive = await loadDrive(u.tenantId, driveId, c, true);
        const active = (await c.query(`SELECT 1 FROM applications WHERE user_id=$1 AND drive_id=$2 AND status <> 'withdrawn'`, [u.id, driveId])).rowCount;
        if (active) throw conflict('ALREADY_APPLIED', 'You have already applied to this drive');
        // 3. server time deadline check inside the transaction
        const now = new Date((await c.query('SELECT clock_timestamp() AS n')).rows[0].n);
        if (drive.status !== 'open' || !drive.deadline || new Date(drive.deadline).getTime() <= now.getTime()) {
          throw unprocessable('DEADLINE_PASSED', 'The deadline for this drive has passed');
        }
        const user = (await c.query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
        if (integ(deps).requireVerifiedEmail && !user.email_verified_at) throw forbidden('Verify your email address before applying', 'EMAIL_NOT_VERIFIED');
        if (!user.phone) throw forbidden('Add your mobile number to your profile before applying', 'PHONE_REQUIRED');
        const p = await getProfileRow(c, u.id);
        const elig = await assessEligibility(c, u.tenantId, drive, u.id, p, { record: 'apply', recordDb: pool });
        if (elig.status === 'restricted') {
          throw new ApiError(422, 'RESTRICTED', elig.reason, { restrictionId: elig.restriction!.id, appealPath: elig.restriction!.appealPath });
        }
        if (elig.status !== 'eligible') {
          throw unprocessable('NOT_ELIGIBLE', elig.status === 'pending' ? `Complete your profile to apply: ${elig.reason}` : elig.reason || 'You are not eligible for this drive');
        }
        // 4. answers + resume
        const errs = validateAnswers(drive.questions || [], body.answers);
        const resume = (await c.query("SELECT r.*, f.status AS file_status FROM resumes r LEFT JOIN files f ON f.id=r.file_id WHERE r.id=$1 AND r.user_id=$2", [body.resumeId, u.id])).rows[0];
        if (!resume) errs.resumeId = 'Choose one of your saved resumes';
        else if (resume.file_id && resume.file_status !== 'ready') errs.resumeId = 'This resume file is no longer available';
        const missingDecl = (drive.questions || []).some((q: any) => q.type === 'declaration' && q.required && body.answers[q.id] !== true);
        if (Object.keys(errs).length || missingDecl) {
          throw new ApiError(400, 'VALIDATION_ERROR', Object.values(errs)[0] || 'Please complete all required answers', errs);
        }
        const reference = `PL-${now.getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const ins = (
          await c.query(
            `INSERT INTO applications (tenant_id, drive_id, user_id, reference, status, idempotency_key, resume_id, resume_snapshot, answers, snapshot, submitted_at)
             VALUES ($1,$2,$3,$4,'submitted',$5,$6,$7,$8,$9,$10) RETURNING *`,
            [u.tenantId, driveId, u.id, reference, body.idempotencyKey, resume.id, JSON.stringify(resume.file_id ? { label: resume.label, url: null, kind: 'file', fileId: resume.file_id } : { label: resume.label, url: resume.url, kind: 'link' }),
              JSON.stringify(body.answers), JSON.stringify({ student: profileSnapshot(user, p), eligibility: elig.status, policy: elig.policy }), now],
          )
        ).rows[0];
        await c.query(`INSERT INTO application_events (application_id, status, note, actor_id, actor_role) VALUES ($1,'submitted','Application submitted',$2,'student')`, [ins.id, u.id]);
        await cancelForUserDrive(c as any, driveId, u.id);
        // optional: save answers back to profile
        if (body.saveToProfile?.length) {
          const patch: any = {};
          for (const q of drive.questions || []) {
            if (!q.saveToProfileKey || !body.saveToProfile.includes(q.saveToProfileKey)) continue;
            const val = body.answers[q.id];
            if (typeof val !== 'string' || !val.trim()) continue;
            const [sec, fld] = q.saveToProfileKey.split('.');
            if (sec === 'links') {
              const chk = validateHttpsUrl(val, fld === 'linkedin' ? 'linkedin' : fld === 'github' ? 'github' : undefined);
              if (!chk.ok) continue;
            }
            (patch[sec] ||= {})[fld] = val.trim();
          }
          if (Object.keys(patch).length) {
            await saveProfile(c, u.tenantId, u.id, applyPatch(p, patch));
          }
        }
        await createNotification(c as any, u.tenantId, u.id, 'application', 'Application submitted', `${toCompany(drive.company).name} · ${drive.role}. Reference ${reference}.`, { applicationId: ins.id, driveId });
        return { replay: false, app: ins };
      });

    let out;
    try {
      out = await attempt();
    } catch (e: any) {
      if (e?.code === '23505') {
        // lost a race: either same key (replay) or another submission got in first
        const prior = (await pool.query('SELECT * FROM applications WHERE user_id=$1 AND idempotency_key=$2', [u.id, body.idempotencyKey])).rows[0];
        if (prior && prior.drive_id === driveId) out = { replay: true, app: prior };
        else throw conflict('ALREADY_APPLIED', 'You have already applied to this drive');
      } else throw e;
    }
    res.status(out.replay ? 200 : 201).json({ application: receipt(out.app) });
  }));

  // ------------------------------------------------------------ list / detail
  const appDto = (a: any) => ({
    id: a.id, reference: a.reference, status: a.status, submittedAt: new Date(a.submitted_at).toISOString(),
    updatedAt: new Date(a.updated_at).toISOString(),
    drive: { id: a.drive_id, company: toCompany(a.company), role: a.role, deadline: a.deadline ? new Date(a.deadline).toISOString() : null },
  });

  r.get('/applications', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ status: z.string().max(30).optional(), cursor: z.string().optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.id, u.tenantId];
    let where = 'a.user_id=$1 AND a.tenant_id=$2';
    if (q.status) { params.push(q.status); where += ` AND a.status=$${params.length}`; }
    const rows = (await pool.query(
      `SELECT a.*, d.company, d.role, d.deadline FROM applications a JOIN drives d ON d.id=a.drive_id WHERE ${where}
        ORDER BY a.submitted_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    res.json({ items: rows.slice(0, limit).map(appDto), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  r.get('/applications/:id', denyRecruiter, wrap(async (req, res) => {
    const u = me(req);
    const a = (await pool.query(
      `SELECT a.*, d.company, d.role, d.deadline FROM applications a JOIN drives d ON d.id=a.drive_id WHERE a.id=$1 AND a.tenant_id=$2`,
      [pid(req), u.tenantId])).rows[0];
    if (!a || (u.role === 'student' && a.user_id !== u.id)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    const events = (await pool.query('SELECT status, note, actor_role, created_at FROM application_events WHERE application_id=$1 ORDER BY id', [a.id])).rows;
    const schedule = await latestSchedule(pool, a.id);
    res.json({
      schedule,
      application: {
        ...appDto(a), schedule, answers: a.answers, resume: a.resume_snapshot, student: u.role === 'officer' ? a.snapshot?.student : undefined,
        events: events.map((e) => ({ status: e.status, note: e.note, actorRole: e.actor_role, createdAt: new Date(e.created_at).toISOString() })),
        allowedNextStatuses: u.role === 'officer' ? TRANSITIONS[a.status as AppStatus] : (a.status === 'submitted' ? ['withdrawn'] : []),
        canRespondToOffer: u.role === 'student' && a.status === 'offer_issued',
      },
    });
  }));

  async function transition(applicationId: string, tenantId: string, actor: { id: string; role: string }, to: AppStatus, note: string | null, studentOnly?: string) {
    return withTx(pool, async (c) => {
      const a = (await c.query('SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [applicationId, tenantId])).rows[0];
      if (!a || (studentOnly && a.user_id !== studentOnly)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
      if (!TRANSITIONS[a.status as AppStatus].includes(to)) {
        throw unprocessable('INVALID_TRANSITION', `Cannot move an application from ${a.status} to ${to}`);
      }
      await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [a.id, to]);
      await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [a.id, to, note, actor.id, actor.role]);
      if (actor.role === 'officer') {
        const d = (await c.query('SELECT company, role FROM drives WHERE id=$1', [a.drive_id])).rows[0];
        await createNotification(c as any, tenantId, a.user_id, 'application_status', `Application update: ${toCompany(d.company).name}`,
          `Your application for ${d.role} ${STATUS_LABEL[to] || to}.${note ? ' ' + note : ''}`, { applicationId: a.id, driveId: a.drive_id, status: to });
      }
      if (to === 'withdrawn') await syncForUser(c as any, tenantId, a.user_id);
      return { id: a.id, status: to };
    });
  }

  r.post('/applications/:id/withdraw', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ note?: string }>(z.object({ note: z.string().max(300).optional() }), req.body ?? {});
    const out = await transition(pid(req), u.tenantId, { id: u.id, role: 'student' }, 'withdrawn', body.note ?? 'Withdrawn by student', u.id);
    res.json({ application: out });
  }));

  // Student accepts or declines an issued offer. Idempotent: repeating the same decision returns 200 with replayed=true and adds no event.
  r.post('/applications/:id/respond', requireRole('student'), wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ decision: 'accept' | 'decline'; note?: string }>(
      z.object({
        decision: z.enum(['accept', 'decline'], { message: 'Decision must be accept or decline' }),
        note: z.string().trim().max(300, 'Note must be at most 300 characters').optional(),
      }).strict(), req.body ?? {});
    if (body.note && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.note)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Note contains invalid characters', { note: 'Note contains invalid characters' });
    }
    const to: AppStatus = body.decision === 'accept' ? 'offer_accepted' : 'offer_declined';
    const mails: MailJob[] = [];
    const out = await withTx(pool, async (c) => {
      const a = (await c.query('SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE', [pid(req), u.tenantId, u.id])).rows[0];
      if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
      if (a.status === to) return { id: a.id, status: a.status as AppStatus, replayed: true };
      if (a.status !== 'offer_issued') {
        const decided = a.status === 'offer_accepted' || a.status === 'offer_declined' || a.status === 'joined';
        throw unprocessable(decided ? 'OFFER_ALREADY_DECIDED' : 'NO_OFFER_TO_RESPOND_TO',
          decided ? 'You have already responded to this offer' : 'There is no issued offer to respond to on this application');
      }
      await assertOfferNotExpired(c, a.id); // pipeline module: a lapsed offer cannot be answered
      await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [a.id, to]);
      await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)',
        [a.id, to, body.note || (body.decision === 'accept' ? 'Offer accepted by student' : 'Offer declined by student'), u.id, 'student']);
      const d = (await c.query('SELECT company, role, created_by FROM drives WHERE id=$1', [a.drive_id])).rows[0];
      const owner = d.created_by
        ? (await c.query(`SELECT id FROM users WHERE id=$1 AND role='officer' AND deleted_at IS NULL AND tenant_id=$2`, [d.created_by, u.tenantId])).rows
        : [];
      const officers = owner.length
        ? owner
        : (await c.query(`SELECT id FROM users WHERE role='officer' AND deleted_at IS NULL AND tenant_id=$1`, [u.tenantId])).rows;
      const company = toCompany(d.company).name;
      const verb = body.decision === 'accept' ? 'accepted' : 'declined';
      for (const o of officers) {
        await createNotification(c as any, u.tenantId, o.id, 'offer_response', `Offer ${verb}: ${company}`,
          `${u.name} ${verb} the offer for ${d.role} at ${company}. Reference ${a.reference}.${body.note ? ' Note: ' + body.note : ''}`,
          { applicationId: a.id, driveId: a.drive_id, studentId: u.id, status: to });
        mails.push(await userMailJob(c as any, u.tenantId, o.id, 'offer_response', {
          studentName: u.name, company, role: d.role, decision: body.decision === 'accept' ? 'accepted' : 'declined', reference: a.reference, note: body.note ?? null,
        }) as MailJob);
      }
      await notifyOfferResponded(c, u.tenantId, a, body.decision, u.name); // pipeline module: tell the proposing recruiter
      return { id: a.id, status: to, replayed: false };
    });
    dispatchMail(mails); // best effort, after commit
    res.json({ application: { id: out.id, status: out.status }, replayed: out.replayed });
  }));

  r.post('/applications/:id/status', requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ status: AppStatus; note?: string }>(
      z.object({ status: z.enum([...STATUSES], { message: `Status must be one of ${STATUSES.join(', ')}` }), note: z.string().trim().max(500).optional() }).strict(), req.body ?? {});
    const out = await transition(pid(req), u.tenantId, { id: u.id, role: 'officer' }, body.status, body.note ?? null);
    res.json({ application: out });
  }));

  void forbidden;
  return r;
}

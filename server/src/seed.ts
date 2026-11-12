import bcrypt from 'bcryptjs';
import { DEFAULT_TENANT_ID, loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrator';
import { LEGAL_VERSIONS } from './legal';
import { scheduleForDrive, upsertScheduleReminder } from './reminders';
import { normalizeEmail } from './validation';
import { seedAssessmentDemo } from './assessments/seed';
import { seedOpsDemo } from './ops/seed';

export const SEED = {
  recruiter: { email: 'recruiter@placement.demo', password: 'Recruiter@123' },
  officer: { email: 'officer@placement.demo', password: 'Officer@123' },
  students: [
    { email: 'aarav.sharma@students.demo', password: 'Student@123' },
    { email: 'diya.patel@students.demo', password: 'Student@123' },
    { email: 'rohan.mehta@students.demo', password: 'Student@123' },
  ],
};

const HOUR = 3600_000;

async function main() {
  const cfg = loadConfig();
  if (cfg.env === 'production' && process.env.SEED_FORCE !== '1') {
    throw new Error('Refusing to wipe a production database. Set SEED_FORCE=1 to override.');
  }
  const pool = createPool(cfg.databaseUrl);
  await migrate(pool);
  const rounds = Math.min(cfg.bcryptRounds, 10);
  const now = Date.now();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE ticket_messages, tickets, user_consents, audit_events, application_schedules, announcements, scheduled_reminders, devices, reminder_settings, notifications, application_events, applications, saved_drives, drives, resumes, profiles, refresh_tokens, users RESTART IDENTITY CASCADE`);

    const mkUser = async (role: string, name: string, email: string, phone: string, password: string) => {
      const em = normalizeEmail(email);
      if (!em.ok) throw new Error(em.message);
      const r = await c.query(
        `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash, email_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
        [DEFAULT_TENANT_ID, role, name, em.value.email, em.value.uniqueKey, phone, await bcrypt.hash(password, rounds)],
      );
      return r.rows[0].id as string;
    };
    const mkProfile = async (id: string, data: any, ver: Record<string, string>) =>
      c.query('INSERT INTO profiles (user_id, tenant_id, data, verification) VALUES ($1,$2,$3,$4)', [id, DEFAULT_TENANT_ID, JSON.stringify(data), JSON.stringify(ver)]);

    const officer = await mkUser('officer', 'Meera Nair', SEED.officer.email, '9811122233', SEED.officer.password);

    const aarav = await mkUser('student', 'Aarav Sharma', SEED.students[0].email, '9812345670', SEED.students[0].password);
    await mkProfile(aarav, {
      identity: { registrationNumber: 'CSE22B0142', preferredName: 'Aarav' },
      academics: { university: 'Demo University', department: 'Computer Science', program: 'B.Tech', batchYear: 2026, semester: 7, cgpa: 8.4, cgpaScale: 10, tenthPercent: 92.4, twelfthPercent: 90.2, activeBacklogs: 0, gapYears: 0 },
      contact: { city: 'Pune', state: 'Maharashtra' },
      links: { linkedin: 'https://www.linkedin.com/in/aarav-demo', github: 'https://github.com/aarav-demo' },
      skills: ['TypeScript', 'SQL', 'Data Structures', 'React'],
      preferences: { roles: ['Software Engineer', 'Backend'], locations: ['Pune', 'Bengaluru'], workMode: 'hybrid', relocate: true },
    }, {
      'identity.registrationNumber': 'verified', 'academics.department': 'verified', 'academics.program': 'verified', 'academics.batchYear': 'verified',
      'academics.cgpa': 'verified', 'academics.tenthPercent': 'verified', 'academics.twelfthPercent': 'verified',
      'academics.activeBacklogs': 'verified', 'academics.gapYears': 'verified', 'academics.university': 'verified', 'academics.semester': 'verified', 'academics.cgpaScale': 'verified',
      'contact.city': 'student_confirmed', 'contact.state': 'student_confirmed', 'links.linkedin': 'student_confirmed', 'links.github': 'student_confirmed',
    });
    const aaravResume = (await c.query(`INSERT INTO resumes (tenant_id,user_id,label,url,is_default) VALUES ($1,$2,'Resume - Software','https://example.com/resumes/aarav-software.pdf',true) RETURNING id`, [DEFAULT_TENANT_ID, aarav])).rows[0].id;

    const diya = await mkUser('student', 'Diya Patel', SEED.students[1].email, '9823456701', SEED.students[1].password);
    await mkProfile(diya, {
      identity: { registrationNumber: 'ECE22B0077' },
      academics: { department: 'Electronics', program: 'B.Tech', batchYear: 2026 },
      contact: { city: 'Ahmedabad' },
    }, { 'identity.registrationNumber': 'unverified', 'academics.department': 'unverified', 'academics.program': 'unverified', 'academics.batchYear': 'unverified', 'contact.city': 'student_confirmed' });

    const rohan = await mkUser('student', 'Rohan Mehta', SEED.students[2].email, '9834567012', SEED.students[2].password);
    await mkProfile(rohan, {
      identity: { registrationNumber: 'CSE22B0230' },
      academics: { university: 'Demo University', department: 'Computer Science', program: 'B.Tech', batchYear: 2026, semester: 7, cgpa: 5.8, cgpaScale: 10, tenthPercent: 71, twelfthPercent: 68.5, activeBacklogs: 2, gapYears: 1 },
      contact: { city: 'Jaipur', state: 'Rajasthan' },
      skills: ['C++'],
    }, { 'academics.cgpa': 'unverified', 'academics.activeBacklogs': 'unverified', 'academics.department': 'verified', 'academics.batchYear': 'verified' });
    await c.query(`INSERT INTO resumes (tenant_id,user_id,label,url,is_default) VALUES ($1,$2,'Resume','https://example.com/resumes/rohan.pdf',true)`, [DEFAULT_TENANT_ID, rohan]);

    const common = {
      requirements: ['Strong fundamentals in your discipline', 'Good written and spoken English'],
      rounds: [{ name: 'Online assessment', description: '60 minutes, aptitude and domain', mode: 'online' }, { name: 'Technical interview', description: 'Two 45-minute rounds', mode: 'in-person' }, { name: 'HR discussion', mode: 'in-person' }],
      policy: 'Demo data. One offer policy applies: students with an accepted offer are not eligible for further drives.',
      contact: { name: 'Meera Nair', email: 'officer@placement.demo', phone: '9811122233' },
    };
    const qs = [
      { id: 'q1', label: 'Why do you want this role?', type: 'long_text', required: true, options: [], maxLength: 500 },
      { id: 'q2', label: 'Notice period / earliest joining date', type: 'date', required: false, options: [] },
      { id: 'q3', label: 'Willing to relocate?', type: 'yes_no', required: true, options: [] },
      { id: 'q4', label: 'I confirm all details are accurate', type: 'declaration', required: true, options: [] },
    ];
    interface D { company: any; role: string; wm: string; loc: string[]; ctc: any; deadlineMs: number | null; jd: string; rules: any; questions?: any[]; state: 'open' | 'closed' | 'draft'; publishedAgoH?: number }
    const drives: D[] = [
      { company: { name: 'Kestrel Systems', industry: 'Enterprise software', verified: true }, role: 'Software Engineer', wm: 'hybrid', loc: ['Pune', 'Bengaluru'], ctc: { fixedLpa: 12, variableLpa: 2, bonusLpa: 1, esopNote: 'ESOP discussed at offer stage', breakdownProvided: true, kind: 'annual' }, deadlineMs: now + 5 * 24 * HOUR, jd: 'Build and operate backend services for a fictional enterprise platform. You will work in small teams, write tests and own features end to end.', rules: { minCgpa: 7, maxActiveBacklogs: 0, allowedDepartments: ['Computer Science', 'Information Technology'], allowedBatches: [2026] }, questions: qs, state: 'open', publishedAgoH: 30 },
      { company: { name: 'Lumora Health Tech', industry: 'Health technology', verified: true }, role: 'Data Analyst', wm: 'onsite', loc: ['Mumbai'], ctc: { fixedLpa: 8.5, variableLpa: 0.5, bonusLpa: 0, breakdownProvided: true, kind: 'annual' }, deadlineMs: now + 20 * HOUR, jd: 'Analyse anonymised demo healthcare datasets, build dashboards and present findings to operations teams.', rules: { minCgpa: 6.5, maxActiveBacklogs: 1 }, questions: qs.slice(0, 1).concat(qs.slice(3)), state: 'open', publishedAgoH: 12 },
      { company: { name: 'Quillbridge Finance', industry: 'Financial services', verified: true }, role: 'Graduate Analyst', wm: 'onsite', loc: ['Mumbai', 'Gurugram'], ctc: { fixedLpa: 10, variableLpa: 1.5, bonusLpa: 0.5, breakdownProvided: true, kind: 'annual' }, deadlineMs: now + 40 * 60_000, jd: 'Support the fictional Quillbridge risk team with modelling, reporting and client analytics during a two-year rotation programme.', rules: { minCgpa: 7.5 }, questions: qs.slice(2), state: 'open', publishedAgoH: 48 },
      { company: { name: 'Verdant Grid Energy', industry: 'Renewable energy', verified: false }, role: 'Graduate Engineer Trainee', wm: 'onsite', loc: ['Nagpur', 'Chennai'], ctc: { fixedLpa: 6.5, variableLpa: 0, bonusLpa: 0.4, breakdownProvided: false, kind: 'annual' }, deadlineMs: now + 9 * 24 * HOUR, jd: 'Join a fictional renewable energy utility as a trainee engineer across grid operations, maintenance and planning.', rules: { minCgpa: 6, maxGapYears: 2 }, state: 'open', publishedAgoH: 5 },
      { company: { name: 'Orbitrail Logistics', industry: 'Logistics', verified: false }, role: 'Operations Intern', wm: 'hybrid', loc: ['Hyderabad'], ctc: { fixedLpa: 25000, variableLpa: 0, bonusLpa: 0, breakdownProvided: true, kind: 'stipend_monthly' }, deadlineMs: now + 6 * 24 * HOUR, jd: 'Six-month internship at a fictional logistics company. Stipend is paid monthly in rupees (fixedLpa carries the monthly amount for stipend drives).', rules: { allowedBatches: [2026, 2027] }, questions: qs.slice(3), state: 'open', publishedAgoH: 2 },
      { company: { name: 'Zephyra Cloud', industry: 'Cloud infrastructure', verified: true }, role: 'Site Reliability Engineer', wm: 'remote', loc: ['Remote (India)'], ctc: { fixedLpa: 22, variableLpa: 4, bonusLpa: 2, esopNote: 'Fictional ESOP grant', breakdownProvided: true, kind: 'annual' }, deadlineMs: now + 4 * 24 * HOUR, jd: 'Keep the fictional Zephyra platform reliable: on-call rotations, automation, capacity planning and incident reviews.', rules: { minCgpa: 8.5, maxActiveBacklogs: 0, allowedDepartments: ['Computer Science', 'Information Technology', 'Electronics'] }, state: 'open', publishedAgoH: 20 },
      { company: { name: 'Pebblestone Labs', industry: 'Developer tools', verified: true }, role: 'Backend Intern', wm: 'remote', loc: ['Remote (India)'], ctc: { fixedLpa: 30000, variableLpa: 0, bonusLpa: 0, breakdownProvided: true, kind: 'stipend_monthly' }, deadlineMs: now - 3 * 24 * HOUR, jd: 'Closed demo drive for a fictional developer tools startup. Shown to demonstrate closed state.', rules: { minCgpa: 6 }, state: 'closed' },
      { company: { name: 'Marlow & Finch Consulting', industry: 'Management consulting', verified: false }, role: 'Associate Consultant', wm: 'onsite', loc: ['Delhi'], ctc: { fixedLpa: 9 }, deadlineMs: null, jd: '', rules: { minCgpa: 7 }, state: 'draft' },
    ];
    const ids: Record<string, string> = {};
    for (const d of drives) {
      const row = (await c.query(
        `INSERT INTO drives (tenant_id, created_by, status, company, role, work_mode, locations, ctc, deadline, jd, requirements, rounds, questions, policy_note, contact, rules, published_at, closed_at, last_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [DEFAULT_TENANT_ID, officer, d.state, d.company, d.role, d.wm, JSON.stringify(d.loc), d.ctc, d.deadlineMs ? new Date(d.deadlineMs) : null, d.jd,
          JSON.stringify(d.state === 'draft' ? [] : common.requirements), JSON.stringify(d.state === 'draft' ? [] : common.rounds), JSON.stringify(d.questions || []), common.policy, d.state === 'draft' ? {} : common.contact, d.rules,
          d.state === 'draft' ? null : new Date(now - (d.publishedAgoH ?? 100) * HOUR), d.state === 'closed' ? new Date(now - 3 * 24 * HOUR) : null, d.state === 'draft' ? null : new Date(now - 2 * HOUR)],
      )).rows[0];
      ids[d.company.name] = row.id;
      if (d.state === 'open') await scheduleForDrive(c, row.id, new Date(now));
    }

    // Aarav applied to Kestrel and is in screening
    const kestrel = ids['Kestrel Systems'];
    const app = (await c.query(
      `INSERT INTO applications (tenant_id, drive_id, user_id, reference, status, idempotency_key, resume_id, resume_snapshot, answers, snapshot, submitted_at)
       VALUES ($1,$2,$3,'PL-DEMO-0001','screening',gen_random_uuid(),$4,$5,$6,$7,$8) RETURNING id`,
      [DEFAULT_TENANT_ID, kestrel, aarav, aaravResume, JSON.stringify({ label: 'Resume - Software', url: 'https://example.com/resumes/aarav-software.pdf' }),
        JSON.stringify({ q1: 'I enjoy building reliable backend systems.', q3: true, q4: true }), JSON.stringify({ student: { name: 'Aarav Sharma', email: SEED.students[0].email, phone: '9812345670', registrationNumber: 'CSE22B0142', department: 'Computer Science', program: 'B.Tech', batchYear: 2026, cgpa: 8.4, cgpaScale: 10, tenthPercent: 92.4, twelfthPercent: 90.2, activeBacklogs: 0, gapYears: 0, linkedin: 'https://www.linkedin.com/in/aarav-demo', verification: { 'academics.cgpa': 'verified' } }, eligibility: 'eligible' }), new Date(now - 20 * HOUR)],
    )).rows[0];
    await c.query(`INSERT INTO application_events (application_id,status,note,actor_id,actor_role,created_at) VALUES ($1,'submitted','Application submitted',$2,'student',$3), ($1,'screening','Profile shortlisted for screening',$4,'officer',$5)`,
      [app.id, aarav, new Date(now - 20 * HOUR), officer, new Date(now - 6 * HOUR)]);
    await c.query(`UPDATE scheduled_reminders SET status='cancelled' WHERE drive_id=$1 AND user_id=$2`, [kestrel, aarav]);
    await c.query(`INSERT INTO notifications (tenant_id,user_id,type,title,body,data) VALUES ($1,$2,'application_status','Application update: Kestrel Systems','Your application for Software Engineer is under screening.',$3)`,
      [DEFAULT_TENANT_ID, aarav, JSON.stringify({ applicationId: app.id, driveId: kestrel })]);

    // Aarav has an online interview in two days (latest schedule on the application)
    const interviewAt = new Date(now + 2 * 24 * HOUR - (now % (15 * 60_000)) + 15 * 60_000); // quarter-hour boundary
    const sched = (await c.query(
      `INSERT INTO application_schedules (tenant_id, application_id, type, scheduled_at, mode, venue_or_link, instructions, created_by)
       VALUES ($1,$2,'interview',$3,'online','https://meet.example.com/kestrel-demo-interview','Join 5 minutes early with your resume open. Keep a government photo ID ready.',$4) RETURNING id`,
      [DEFAULT_TENANT_ID, app.id, interviewAt, officer])).rows[0];
    await c.query(`UPDATE applications SET status='interview', updated_at=now() WHERE id=$1`, [app.id]);
    await c.query(`INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,'interview','Interview scheduled (online)',$2,'officer')`, [app.id, officer]);
    await c.query(`INSERT INTO notifications (tenant_id,user_id,type,title,body,data) VALUES ($1,$2,'schedule','Interview scheduled: Kestrel Systems',$3,$4)`,
      [DEFAULT_TENANT_ID, aarav, 'Your interview for Software Engineer is scheduled (online). Link: https://meet.example.com/kestrel-demo-interview.',
        JSON.stringify({ applicationId: app.id, driveId: kestrel, scheduleType: 'interview', scheduledAt: interviewAt.toISOString() })]);
    await upsertScheduleReminder(c, { tenantId: DEFAULT_TENANT_ID, driveId: kestrel, userId: aarav, applicationId: app.id, scheduleId: sched.id, scheduledAt: interviewAt }, new Date(now));

    // ------------------------------------------------------------------ hiring pipeline + recruiter demo (Kestrel Systems)
    const recruiter = await mkUser('recruiter', 'Rhea Kapoor', SEED.recruiter.email, '9845012345', SEED.recruiter.password);
    await c.query(`INSERT INTO company_recruiters (drive_id, user_id, tenant_id, permissions, invited_by) VALUES ($1,$2,$3,'{}'::jsonb,$4)`, [kestrel, recruiter, DEFAULT_TENANT_ID, officer]);
    await c.query(`INSERT INTO drive_pipeline_settings (drive_id, tenant_id, settings) VALUES ($1,$2,$3)`, [kestrel, DEFAULT_TENANT_ID, JSON.stringify({ autoAcceptSlotProposals: false, showUnscreened: false, slotCancelCutoffMinutes: 120, blindScorecards: true })]);
    await c.query(`INSERT INTO drive_rubrics (tenant_id, drive_id, items, updated_by) VALUES ($1,$2,$3,$4)`, [DEFAULT_TENANT_ID, kestrel, JSON.stringify([
      { id: 'problem_solving', label: 'Problem solving', description: 'Breaks the problem down and reasons about trade-offs' },
      { id: 'technical_depth', label: 'Technical depth', description: 'Fundamentals of data structures, databases and APIs' },
      { id: 'communication', label: 'Communication', description: 'Explains thinking clearly' },
      { id: 'culture_fit', label: 'Collaboration', description: 'Works well with others and takes feedback' },
    ]), officer]);
    const mkRound = async (seq: number, name: string, kind: string, mode: string) =>
      (await c.query(`INSERT INTO drive_rounds (tenant_id, drive_id, seq, name, kind, mode, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [DEFAULT_TENANT_ID, kestrel, seq, name, kind, mode, officer])).rows[0].id as string;
    const r1 = await mkRound(1, 'Online assessment', 'assessment', 'online');
    const r2 = await mkRound(2, 'Technical interview', 'technical', 'online');
    const r3 = await mkRound(3, 'HR discussion', 'hr', 'in_person');
    await c.query(`UPDATE drive_rounds SET results_published_at=now() WHERE id=$1`, [r1]);

    const demoStudents = [
      { name: 'Ishaan Verma', email: 'ishaan.verma@students.demo', phone: '9856001101', reg: 'CSE22B0151', cgpa: 8.1, status: 'interview', r1: 'passed', r2: 'invited' },
      { name: 'Kavya Nair', email: 'kavya.nair@students.demo', phone: '9856001102', reg: 'CSE22B0163', cgpa: 9.0, status: 'selected', r1: 'passed', r2: 'passed' },
      { name: 'Neha Reddy', email: 'neha.reddy@students.demo', phone: '9856001103', reg: 'IT22B0044', cgpa: 7.6, status: 'screening', r1: 'passed', r2: null },
      { name: 'Arjun Iyer', email: 'arjun.iyer@students.demo', phone: '9856001104', reg: 'CSE22B0188', cgpa: 7.2, status: 'screening', r1: 'failed', r2: null },
    ];
    const rcInsert = async (round: string, appId: string, status: string, advanced = false) =>
      c.query(`INSERT INTO round_candidates (tenant_id, drive_id, round_id, application_id, status, advanced_at) VALUES ($1,$2,$3,$4,$5,$6)`, [DEFAULT_TENANT_ID, kestrel, round, appId, status, advanced ? new Date(now - 4 * HOUR) : null]);
    await rcInsert(r1, app.id, 'passed', true);
    await rcInsert(r2, app.id, 'invited');
    const demoApps: Record<string, string> = {};
    for (const [i, d] of demoStudents.entries()) {
      const uid = await mkUser('student', d.name, d.email, d.phone, 'Student@123');
      await mkProfile(uid, { identity: { registrationNumber: d.reg }, academics: { university: 'Demo University', department: d.reg.startsWith('IT') ? 'Information Technology' : 'Computer Science', program: 'B.Tech', batchYear: 2026, semester: 7, cgpa: d.cgpa, cgpaScale: 10, tenthPercent: 88, twelfthPercent: 86, activeBacklogs: 0, gapYears: 0 } }, { 'academics.cgpa': 'verified' });
      const res = (await c.query(`INSERT INTO resumes (tenant_id,user_id,label,url,is_default) VALUES ($1,$2,'Resume','https://example.com/resumes/demo-' || $3 || '.pdf',true) RETURNING id`, [DEFAULT_TENANT_ID, uid, String(i + 1)])).rows[0].id;
      const a2 = (await c.query(
        `INSERT INTO applications (tenant_id, drive_id, user_id, reference, status, idempotency_key, resume_id, resume_snapshot, answers, snapshot, submitted_at)
         VALUES ($1,$2,$3,$4,$5,gen_random_uuid(),$6,$7,$8,$9,$10) RETURNING id`,
        [DEFAULT_TENANT_ID, kestrel, uid, `PL-DEMO-010${i + 2}`, d.status, res, JSON.stringify({ label: 'Resume', url: `https://example.com/resumes/demo-${i + 1}.pdf` }),
          JSON.stringify({ q1: 'I like building dependable systems.', q3: true, q4: true }),
          JSON.stringify({ student: { name: d.name, email: d.email, phone: d.phone, registrationNumber: d.reg, department: d.reg.startsWith('IT') ? 'Information Technology' : 'Computer Science', program: 'B.Tech', batchYear: 2026, cgpa: d.cgpa, cgpaScale: 10, tenthPercent: 88, twelfthPercent: 86, activeBacklogs: 0, gapYears: 0, linkedin: null, verification: { 'academics.cgpa': 'verified' } }, eligibility: 'eligible' }),
          new Date(now - (22 - i) * HOUR)])).rows[0].id;
      demoApps[d.name] = a2;
      await c.query(`INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,'submitted','Application submitted',$2,'student'), ($1,'screening','Profile shortlisted for screening',$3,'officer')`, [a2, uid, officer]);
      if (d.status !== 'screening') await c.query(`INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,'Updated by placement cell',$3,'officer')`, [a2, d.status, officer]);
      await rcInsert(r1, a2, d.r1, !!d.r2);
      if (d.r2) await rcInsert(r2, a2, d.r2, d.r2 === 'passed');
      if (d.r2 === 'passed') await rcInsert(r3, a2, 'invited');
    }
    await c.query(`INSERT INTO candidate_decisions (application_id, tenant_id, drive_id, decision, reason, decided_by) VALUES ($1,$2,$3,'shortlisted',NULL,$4), ($5,$2,$3,'shortlisted',NULL,$4), ($6,$2,$3,'rejected','Did not clear the online assessment',$4)`,
      [app.id, DEFAULT_TENANT_ID, kestrel, recruiter, demoApps['Kavya Nair'], demoApps['Arjun Iyer']]);
    await c.query(`INSERT INTO scorecards (tenant_id, drive_id, round_id, application_id, recruiter_id, ratings, overall, comments, recommendation)
                   VALUES ($1,$2,$3,$4,$5,$6,4.25,'Strong fundamentals and clear communication.','hire')`,
      [DEFAULT_TENANT_ID, kestrel, r2, demoApps['Kavya Nair'], recruiter, JSON.stringify([
        { itemId: 'problem_solving', label: 'Problem solving', rating: 5 }, { itemId: 'technical_depth', label: 'Technical depth', rating: 4 },
        { itemId: 'communication', label: 'Communication', rating: 4 }, { itemId: 'culture_fit', label: 'Collaboration', rating: 4 }])]);
    await c.query(`INSERT INTO candidate_notes (tenant_id, drive_id, application_id, author_id, body, visibility) VALUES ($1,$2,$3,$4,'Follow up on the system design question.','team')`, [DEFAULT_TENANT_ID, kestrel, app.id, recruiter]);
    // an open technical-interview slot, panel = the demo recruiter
    const slotStart = new Date(now + 3 * 24 * HOUR - ((now + 3 * 24 * HOUR) % (30 * 60_000)) + 30 * 60_000);
    const slot = (await c.query(`INSERT INTO interview_slots (tenant_id, drive_id, round_id, starts_at, ends_at, mode, venue_or_link, capacity, status, proposed_by) VALUES ($1,$2,$3,$4,$5,'online','https://meet.example.com/kestrel-demo-slot',1,'open',$6) RETURNING id`,
      [DEFAULT_TENANT_ID, kestrel, r2, slotStart, new Date(slotStart.getTime() + 45 * 60_000), recruiter])).rows[0].id;
    await c.query(`INSERT INTO slot_panelists (slot_id, user_id, tenant_id, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,true)`, [slot, recruiter, DEFAULT_TENANT_ID, slotStart, new Date(slotStart.getTime() + 45 * 60_000)]);
    // a recruiter-proposed offer waiting for the officer
    const offerAt = new Date(now + 10 * 24 * HOUR);
    const offer = (await c.query(
      `INSERT INTO offers (tenant_id, drive_id, application_id, user_id, status, kind, ctc, total_lpa, tier, joining_date, location, expires_at, policy_result, proposed_by, proposed_by_role, notes)
       VALUES ($1,$2,$3,(SELECT user_id FROM applications WHERE id=$3),'pending_approval','annual',$4,15,'dream',$5,'Pune',$6,$7,$8,'recruiter','Standard graduate offer.') RETURNING id`,
      [DEFAULT_TENANT_ID, kestrel, demoApps['Kavya Nair'], JSON.stringify({ fixedLpa: 12, variableLpa: 2, bonusLpa: 1 }), new Date(now + 90 * 24 * HOUR).toISOString().slice(0, 10), offerAt, JSON.stringify({ result: 'allowed', reasons: [] }), recruiter])).rows[0].id;
    await c.query(`INSERT INTO offer_events (tenant_id, offer_id, type, from_status, to_status, actor_id, actor_role) VALUES ($1,$2,'created',NULL,'pending_approval',$3,'recruiter')`, [DEFAULT_TENANT_ID, offer, recruiter]);
    await c.query(`INSERT INTO drive_messages (tenant_id, drive_id, author_id, body) VALUES ($1,$2,$3,'Hi Meera, we will need the Friday afternoon for the technical interviews.'), ($1,$2,$4,'Noted. The online slot is open; I will confirm the HR round venue tomorrow.')`, [DEFAULT_TENANT_ID, kestrel, recruiter, officer]);

    // Diya has an open support ticket
    const ticket = (await c.query(
      `INSERT INTO tickets (tenant_id,user_id,category,subject,status) VALUES ($1,$2,'eligibility','I cannot see my CGPA on eligibility checks','open') RETURNING id`,
      [DEFAULT_TENANT_ID, diya])).rows[0];
    await c.query(`INSERT INTO ticket_messages (tenant_id,ticket_id,author_id,message,created_at) VALUES ($1,$2,$3,$4,$5), ($1,$2,$6,$7,$8)`,
      [DEFAULT_TENANT_ID, ticket.id, diya, 'My eligibility says pending because CGPA is missing, but my semester results are out. How do I get this updated?', new Date(now - 3 * HOUR),
        officer, 'Please add your CGPA in Profile > Academics. We will verify it against the university records within a day.', new Date(now - 1 * HOUR)]);

    // accepted the terms when the demo accounts were created
    await c.query(`INSERT INTO user_consents (tenant_id,user_id,policy_version) SELECT tenant_id, id, $1 FROM users`, [LEGAL_VERSIONS.terms]);
    await seedOpsDemo(c, { tenantId: DEFAULT_TENANT_ID, officerId: officer, passwordHash: await bcrypt.hash(SEED.students[0].password, rounds), driveIds: ids, studentIds: { [SEED.students[0].email]: aarav, [SEED.students[1].email]: diya, [SEED.students[2].email]: rohan } });
    await c.query('COMMIT');
    await seedAssessmentDemo(pool);
    console.log('Seeded: officer@placement.demo / Officer@123; recruiter@placement.demo / Recruiter@123; students aarav.sharma@students.demo, diya.patel@students.demo, rohan.mehta@students.demo / Student@123');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

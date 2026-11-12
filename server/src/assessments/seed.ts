import type { Pool } from 'pg';
import { DEFAULT_TENANT_ID } from '../config';
import { withTx } from '../db';
import { gradeAttempt } from './attempts';
import { insertQuestion, parseQuestion } from './bank';
import { codeHash } from './compare';
import { saveStructure } from './service';
import { newSeed } from './random';

const HOUR = 3600_000;

const mcq = (title: string, body: string, opts: string[], correct: string, o: Record<string, unknown> = {}) => ({
  type: 'mcq_single', title, body, topic: 'Aptitude', tags: ['aptitude'], difficulty: 'easy', marks: 2, negativeMarks: 0.5,
  options: opts.map((t, i) => ({ id: 'abcdefgh'[i], text: t })), answer: { correct }, explanation: '', ...o,
});

const SUM_PY = 'a, b = map(int, input().split())\nprint(a + b)\n';
const SUM_CPP = '#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << "\\n"; }\n';
const REV_PY = 's = input()\nprint(s[::-1])\n';
const REV_CPP = '#include <iostream>\n#include <string>\n#include <algorithm>\nint main() { std::string s; std::getline(std::cin, s); std::reverse(s.begin(), s.end()); std::cout << s << "\\n"; }\n';
const MAX_PY = 'n = int(input())\nv = list(map(int, input().split()))\nprint(max(v))\n';

const codingQ = (title: string, body: string, difficulty: string, tests: [string, string, 'sample' | 'hidden', number][], starter: Record<string, string>, ref: { language: string; code: string }, tags: string[]) => ({
  type: 'coding', title, body, topic: 'Programming', tags, difficulty, marks: 10, negativeMarks: 0, practice: true,
  coding: {
    constraints: 'Time limit 2 seconds, memory 256 MB.', languages: ['python3', 'cpp'], timeLimitMs: 2000, memoryLimitMb: 256, starterCode: starter, referenceSolution: ref,
    testCases: tests.map(([input, expectedOutput, kind, weight]) => ({ kind, input, expectedOutput, weight })),
  },
});

/** Demo questions, one live assessment, one completed assessment with attempts and a practice set. All data is fictional. */
export async function seedAssessmentDemo(pool: Pool, now = new Date()) {
  const officer = (await pool.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='officer' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [DEFAULT_TENANT_ID])).rows[0]?.id as string | undefined;
  const students = (await pool.query(`SELECT id, email FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL ORDER BY email`, [DEFAULT_TENANT_ID])).rows;
  if (!officer || students.length === 0) return { skipped: true };
  const drive = (await pool.query(`SELECT id FROM drives WHERE tenant_id=$1 AND company->>'name'='Kestrel Systems' LIMIT 1`, [DEFAULT_TENANT_ID])).rows[0]?.id as string | undefined;

  return withTx(pool, async (c) => {
    const add = async (raw: any) => (await insertQuestion(c, DEFAULT_TENANT_ID, officer, parseQuestion(raw))).id as string;
    const A = [
      await add(mcq('Percentage increase', 'A price rises from 80 to 100. What is the percentage increase?', ['20%', '25%', '30%', '15%'], 'b', { explanation: '(100-80)/80 = 25%.', tags: ['aptitude', 'percentages'] })),
      await add(mcq('Next in series', 'What comes next: 2, 6, 12, 20, 30, ?', ['38', '40', '42', '44'], 'c', { explanation: 'Differences 4, 6, 8, 10, 12.', difficulty: 'medium', tags: ['aptitude', 'series'] })),
      await add(mcq('Work and time', 'A can finish a job in 12 days and B in 6 days. Together they finish in:', ['3 days', '4 days', '5 days', '9 days'], 'b', { explanation: '1/12 + 1/6 = 1/4.', difficulty: 'medium' })),
      await add(mcq('Synonym of "candid"', 'Choose the word closest in meaning to "candid".', ['Frank', 'Secretive', 'Shy', 'Rude'], 'a', { topic: 'Verbal', tags: ['verbal'] })),
      await add(mcq('Odd one out', 'Which one does not belong: Python, Java, HTML, C++?', ['Python', 'Java', 'HTML', 'C++'], 'c', { topic: 'Computer Science', tags: ['cs'], explanation: 'HTML is a markup language.' })),
      await add(mcq('Time complexity of binary search', 'What is the worst-case time complexity of binary search on a sorted array of n items?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 'b', { topic: 'Computer Science', tags: ['cs', 'dsa'], explanation: 'The search space halves each step.' })),
      await add(mcq('Data structure for LIFO', 'Which data structure follows last-in first-out order?', ['Queue', 'Stack', 'Heap', 'Graph'], 'b', { topic: 'Computer Science', tags: ['cs', 'dsa'] })),
      await add({
        type: 'mcq_multi', title: 'Primes', body: 'Select all prime numbers.', topic: 'Aptitude', tags: ['aptitude'], difficulty: 'easy', marks: 4, negativeMarks: 1,
        options: [{ id: 'a', text: '2' }, { id: 'b', text: '9' }, { id: 'c', text: '11' }, { id: 'd', text: '15' }], answer: { correct: ['a', 'c'] }, explanation: '2 and 11 are prime.',
      }),
      await add({ type: 'numeric', title: 'Average speed', body: 'A car covers 120 km in 2 hours and 180 km in 3 hours. What is its average speed in km/h?', topic: 'Aptitude', tags: ['aptitude'], difficulty: 'easy', marks: 3, negativeMarks: 1, answer: { value: 60 }, explanation: '300 km / 5 h.' }),
      await add({ type: 'short_text', title: 'Full form of SQL', body: 'Write the full form of SQL.', topic: 'Computer Science', tags: ['cs', 'sql'], difficulty: 'easy', marks: 2, negativeMarks: 0, answer: { accepted: ['structured query language'], mode: 'exact' } }),
    ];
    const sumQ = await add(codingQ('Sum of two numbers', 'Read two integers `a` and `b` from one line and print their sum.', 'easy',
      [['1 2\n', '3\n', 'sample', 1], ['10 -4\n', '6\n', 'hidden', 2], ['1000000000 1000000000\n', '2000000000\n', 'hidden', 2], ['0 0\n', '0\n', 'hidden', 1]],
      { python3: 'a, b = map(int, input().split())\n# print the sum\n', cpp: '#include <iostream>\nint main() {\n  // read a and b, print a + b\n}\n' }, { language: 'python3', code: SUM_PY }, ['basics', 'math']));
    const revQ = await add(codingQ('Reverse a string', 'Read one line and print it reversed.', 'easy',
      [['hello\n', 'olleh\n', 'sample', 1], ['a\n', 'a\n', 'hidden', 1], ['upgrid\n', 'dirgpu\n', 'hidden', 2], ['racecar\n', 'racecar\n', 'hidden', 1]],
      { python3: 's = input()\n', cpp: '#include <iostream>\n#include <string>\nint main() {\n  std::string s;\n  std::getline(std::cin, s);\n}\n' }, { language: 'python3', code: REV_PY }, ['strings']));
    const maxQ = await add(codingQ('Maximum element', 'The first line has n, the second has n integers. Print the largest.', 'medium',
      [['5\n3 9 2 7 1\n', '9\n', 'sample', 1], ['1\n-5\n', '-5\n', 'hidden', 1], ['4\n-1 -2 -3 -4\n', '-1\n', 'hidden', 2], ['6\n10 10 10 10 10 10\n', '10\n', 'hidden', 1]],
      { python3: 'n = int(input())\nv = list(map(int, input().split()))\n' }, { language: 'python3', code: MAX_PY }, ['arrays']));
    void SUM_CPP; void REV_CPP;

    const mk = async (o: { title: string; instructions: string; practice?: boolean; opens: Date | null; closes: Date | null; duration: number; sections: any[]; settings: any; audience: any; driveId?: string | null; published: Date }) => {
      const id = (await c.query(
        `INSERT INTO assessments (tenant_id, created_by, title, instructions, drive_id, audience, opens_at, closes_at, duration_minutes, settings, is_practice, status, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',$12) RETURNING id`,
        [DEFAULT_TENANT_ID, officer, o.title, o.instructions, o.driveId ?? null, JSON.stringify(o.audience), o.opens, o.closes, o.duration, JSON.stringify(o.settings), !!o.practice, o.published])).rows[0].id as string;
      await saveStructure(c, DEFAULT_TENANT_ID, id, o.sections);
      await c.query(`INSERT INTO assessment_audience (assessment_id, user_id, tenant_id) SELECT $1, id, $2 FROM users WHERE tenant_id=$2 AND role='student' AND deleted_at IS NULL`, [id, DEFAULT_TENANT_ID]);
      return id;
    };
    const base = { randomiseQuestions: true, randomiseOptions: true, negativeMarking: true, passCutoff: { type: 'percent', value: 50 }, resultVisibility: 'immediate', allowReview: true, maxAttempts: 1, rankingEnabled: true };
    const everyone = { type: 'all_students' };

    const live = await mk({
      title: 'Kestrel Systems - Online Assessment', instructions: 'Aptitude and programming round. 60 minutes. The test auto-submits when time is up. Switching apps is logged and may trigger warnings.',
      opens: new Date(now.getTime() - 30 * 60_000), closes: new Date(now.getTime() + 48 * HOUR), duration: 60, driveId: drive ?? null, published: new Date(now.getTime() - 26 * HOUR),
      audience: everyone, settings: { ...base, proctoring: { enabled: true, maxWarnings: 3, autoSubmit: false } },
      sections: [
        { title: 'Aptitude', cutoffMarks: 4, questions: A.slice(0, 3).concat([A[7], A[8]]).map((questionId) => ({ questionId })) },
        { title: 'Computer Science', questions: [A[4], A[5], A[6], A[9]].map((questionId) => ({ questionId })) },
        { title: 'Coding', questions: [{ questionId: sumQ }, { questionId: revQ }] },
      ],
    });

    const done = await mk({
      title: 'Foundations Screening Test (completed)', instructions: 'Closed demo test with results.',
      opens: new Date(now.getTime() - 4 * 24 * HOUR), closes: new Date(now.getTime() - 3 * 24 * HOUR), duration: 45, driveId: drive ?? null, published: new Date(now.getTime() - 6 * 24 * HOUR),
      audience: everyone, settings: { ...base, proctoring: { enabled: true, maxWarnings: 3, autoSubmit: true } },
      sections: [
        { title: 'Aptitude', questions: A.slice(0, 3).concat([A[7], A[8]]).map((questionId) => ({ questionId })) },
        { title: 'Coding', questions: [{ questionId: maxQ }] },
      ],
    });
    await mk({
      title: 'Aptitude warm-up (practice)', instructions: 'Practice set: unlimited attempts, instant results, not ranked.', practice: true, opens: null, closes: null, duration: 20, published: now,
      audience: everyone, settings: { ...base, negativeMarking: false, rankingEnabled: false, passCutoff: null, allowReview: true, proctoring: { enabled: false, maxWarnings: 3, autoSubmit: false } },
      sections: [{ title: 'Practice', questions: A.slice(0, 4).map((questionId) => ({ questionId })) }],
    });

    // ---- the completed test gets real attempts, graded by the same code path as production
    const aqs = (await c.query('SELECT * FROM assessment_questions WHERE assessment_id=$1 ORDER BY ord', [done])).rows;
    const secs = (await c.query('SELECT id FROM assessment_sections WHERE assessment_id=$1 ORDER BY ord', [done])).rows;
    const byTitle = (t: string) => aqs.find((q) => q.snapshot.title === t);
    const plan: { who: number; answers: Record<string, unknown>; code?: { code: string; passed: string[] }; min: number; warnings: number; reason: string }[] = [
      { who: 0, min: 31, warnings: 0, reason: 'student', answers: { 'Percentage increase': 'b', 'Next in series': 'c', 'Work and time': 'b', Primes: ['a', 'c'], 'Average speed': 60 }, code: { code: MAX_PY, passed: ['t1', 't2', 't3', 't4'] } },
      { who: 1, min: 45, warnings: 4, reason: 'proctor', answers: { 'Percentage increase': 'b', 'Next in series': 'a', 'Work and time': 'c', Primes: ['a'], 'Average speed': 55 }, code: { code: 'n = int(input())\nv = input().split()\nprint(v[-1])\n', passed: ['t1', 't2'] } },
      { who: 2, min: 38, warnings: 1, reason: 'student', answers: { 'Percentage increase': 'a', 'Work and time': 'b', Primes: ['a', 'b'] } },
    ];
    for (const p of plan) {
      const st = students[p.who];
      if (!st) continue;
      const startedAt = new Date(now.getTime() - 3.5 * 24 * HOUR + p.who * 10 * 60_000);
      const submittedAt = new Date(startedAt.getTime() + p.min * 60_000);
      const att = (await c.query(
        `INSERT INTO assessment_attempts (tenant_id, assessment_id, user_id, attempt_no, seed, status, submit_reason, started_at, deadline_at, submitted_at, warnings, section_state)
         VALUES ($1,$2,$3,1,$4,'submitted',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [DEFAULT_TENANT_ID, done, st.id, newSeed(), p.reason, startedAt, new Date(startedAt.getTime() + 45 * 60_000), submittedAt, p.warnings, JSON.stringify({ [secs[0].id]: { enteredAt: startedAt.toISOString() } })])).rows[0].id as string;
      for (const [title, answer] of Object.entries(p.answers)) {
        await c.query(`INSERT INTO assessment_answers (attempt_id, aq_id, tenant_id, answer, answer_ts, time_spent_ms) VALUES ($1,$2,$3,$4,$5,$6)`,
          [att, byTitle(title).id, DEFAULT_TENANT_ID, JSON.stringify(answer), startedAt.getTime(), 20_000 + p.who * 7_000]);
      }
      if (p.code) {
        const cq = byTitle('Maximum element');
        await c.query(`INSERT INTO assessment_answers (attempt_id, aq_id, tenant_id, answer, answer_ts) VALUES ($1,$2,$3,$4,$5)`, [att, cq.id, DEFAULT_TENANT_ID, JSON.stringify({ language: 'python3', code: p.code.code }), startedAt.getTime()]);
        const tests = cq.snapshot.coding.testCases as any[];
        const results = tests.map((t) => ({ id: t.id, kind: t.kind, weight: t.weight, passed: p.code!.passed.includes(t.id), verdict: p.code!.passed.includes(t.id) ? 'accepted' : 'wrong_answer', timeMs: 20, memoryKb: 3000 }));
        const passed = results.filter((r) => r.passed).length;
        await c.query(
          `INSERT INTO assessment_code_submissions (tenant_id, user_id, attempt_id, aq_id, kind, source, language, code, status, verdict, passed, total, score, max_score, results, norm_hash, judged_at)
           VALUES ($1,$2,$3,$4,'submit','student','python3',$5,'judged',$6,$7,$8,0,$9,$10,$11,$12)`,
          [DEFAULT_TENANT_ID, st.id, att, cq.id, p.code.code, passed === results.length ? 'accepted' : 'wrong_answer', passed, results.length, Number(cq.marks), JSON.stringify(results), codeHash(p.code.code), submittedAt]);
      }
      for (let i = 0; i < p.warnings; i++) {
        await c.query(`INSERT INTO assessment_proctor_events (tenant_id, attempt_id, type, client_ts, counted) VALUES ($1,$2,'focus_lost',$3,true)`, [DEFAULT_TENANT_ID, att, startedAt.getTime() + (i + 1) * 60_000]);
      }
      await gradeAttempt(c, att, submittedAt);
    }

    // ---- the live test has one student part-way through (demonstrates resume)
    if (students[1]) {
      const startedAt = new Date(now.getTime() - 12 * 60_000);
      const att = (await c.query(
        `INSERT INTO assessment_attempts (tenant_id, assessment_id, user_id, attempt_no, seed, started_at, deadline_at, section_state)
         VALUES ($1,$2,$3,1,$4,$5,$6,'{}') RETURNING id`, [DEFAULT_TENANT_ID, live, students[1].id, newSeed(), startedAt, new Date(startedAt.getTime() + 60 * 60_000)])).rows[0].id as string;
      const first = (await c.query('SELECT id FROM assessment_questions WHERE assessment_id=$1 ORDER BY ord LIMIT 2', [live])).rows;
      const picks: unknown[] = ['b', 'c'];
      for (let i = 0; i < first.length; i++) {
        await c.query(`INSERT INTO assessment_answers (attempt_id, aq_id, tenant_id, answer, answer_ts, time_spent_ms) VALUES ($1,$2,$3,$4,$5,25000)`, [att, first[i].id, DEFAULT_TENANT_ID, JSON.stringify(picks[i]), startedAt.getTime() + 60_000]);
      }
    }
    return { questions: A.length + 3, live, done };
  });
}

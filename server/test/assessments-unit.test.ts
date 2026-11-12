import { describe, expect, it } from 'vitest';
import { aggregate, gradeCoding, gradeObjective, rankScores } from '../src/assessments/grading';
import { codeHash, codeTokens, jaccard, outputsMatch, shingles } from '../src/assessments/compare';
import { seededShuffle } from '../src/assessments/random';
import { createJudge0Client, evaluateCode, JudgeUnavailableError } from '../src/assessments/judge';
import { importRowToInput, parseQuestion, rowsFromBody } from '../src/assessments/bank';
import { parseCsv } from '../src/assessments/csvParse';
import { regexProblem } from '../src/assessments/schemas';
import { MockJudge } from './assessments-judge-mock';

const q = (type: any, answer: any, marks = 4, negativeMarks = 1) => ({ type, marks, negativeMarks, answer });

describe('grading matrix', () => {
  it('mcq_single', () => {
    const k = q('mcq_single', { correct: 'b' });
    expect(gradeObjective(k, 'b', true)).toEqual({ score: 4, correct: 'correct' });
    expect(gradeObjective(k, 'a', true)).toEqual({ score: -1, correct: 'wrong' });
    expect(gradeObjective(k, 'a', false)).toEqual({ score: 0, correct: 'wrong' });
    expect(gradeObjective(k, null, true)).toEqual({ score: 0, correct: 'unanswered' });
  });
  it('mcq_multi partial credit rule', () => {
    const k = q('mcq_multi', { correct: ['a', 'c', 'd'] }, 6, 2);
    expect(gradeObjective(k, ['a', 'c', 'd'], true)).toEqual({ score: 6, correct: 'correct' });
    expect(gradeObjective(k, ['a', 'c'], true)).toEqual({ score: 4, correct: 'partial' }); // 6*2/3, no deduction
    expect(gradeObjective(k, ['d'], true)).toEqual({ score: 2, correct: 'partial' });
    expect(gradeObjective(k, ['a', 'b'], true)).toEqual({ score: -2, correct: 'wrong' }); // any wrong option => wrong
    expect(gradeObjective(k, ['a', 'b'], false)).toEqual({ score: 0, correct: 'wrong' });
    expect(gradeObjective(k, [], true).correct).toBe('unanswered');
  });
  it('numeric tolerance and short_text', () => {
    const n = q('numeric', { value: 3.14, tolerance: 0.01 });
    expect(gradeObjective(n, 3.145, true).correct).toBe('correct');
    expect(gradeObjective(n, '3.2', true).correct).toBe('wrong');
    const s = q('short_text', { accepted: ['New Delhi', 'Delhi'], mode: 'exact' });
    expect(gradeObjective(s, '  new   delhi ', true).correct).toBe('correct');
    expect(gradeObjective(s, 'Mumbai', true).score).toBe(-1);
    const re = q('short_text', { accepted: ['colou?r'], mode: 'regex' });
    expect(gradeObjective(re, 'Color', true).correct).toBe('correct');
    expect(gradeObjective(re, 'colour', true).correct).toBe('correct');
    expect(gradeObjective(re, 'colours', true).correct).toBe('wrong'); // whole-answer match
    const cs = q('short_text', { accepted: ['NaCl'], caseSensitive: true });
    expect(gradeObjective(cs, 'nacl', true).correct).toBe('wrong');
  });
  it('coding weighted partial', () => {
    expect(gradeCoding(10, [{ weight: 1, passed: true }, { weight: 3, passed: false }])).toEqual({ score: 2.5, correct: 'partial' });
    expect(gradeCoding(10, [{ weight: 1, passed: true }])).toEqual({ score: 10, correct: 'correct' });
    expect(gradeCoding(10, [{ weight: 2, passed: false }]).correct).toBe('wrong');
  });
  it('aggregate: sections, cutoffs, pass', () => {
    const secs = [{ id: 's1', cutoffMarks: 4 }, { id: 's2', cutoffMarks: null }];
    const qs = [{ sectionId: 's1', marks: 5, score: 3 }, { sectionId: 's2', marks: 5, score: 5 }];
    const t = aggregate(secs, qs, { type: 'marks', value: 8 });
    expect(t.score).toBe(8); expect(t.maxScore).toBe(10);
    expect(t.sections.s1.cutoffMet).toBe(false);
    expect(t.passed).toBe(false); // overall met but section cutoff failed
    expect(aggregate([{ id: 's1', cutoffMarks: null }], [{ sectionId: 's1', marks: 10, score: 5 }], { type: 'percent', value: 50 }).passed).toBe(true);
    expect(aggregate([{ id: 's1', cutoffMarks: null }], [{ sectionId: 's1', marks: 10, score: 5 }], null).passed).toBeNull();
    expect(aggregate([{ id: 's1', cutoffMarks: null }], [{ sectionId: 's1', marks: 10, score: 5 }], { type: 'marks', value: 8 }, 9).passed).toBe(true); // override
  });
  it('ranking with ties', () => {
    const r = rankScores([{ score: 5 }, { score: 10 }, { score: 10 }, { score: 7 }]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 4]);
  });
});

describe('output comparison and plagiarism helpers', () => {
  it('compares output', () => {
    expect(outputsMatch('3\n', '3')).toBe(true);
    expect(outputsMatch('1  2\r\n3', '1 2 3')).toBe(true);
    expect(outputsMatch('1 2', '1 3')).toBe(false);
    expect(outputsMatch('3.0000001', '3', { floatTolerance: 1e-5 })).toBe(true);
    expect(outputsMatch('3.01', '3', { floatTolerance: 1e-5 })).toBe(false);
    expect(outputsMatch('a b\n\n', 'a b', { mode: 'lines' })).toBe(true);
    expect(outputsMatch('a  b', 'a b', { mode: 'lines' })).toBe(false);
  });
  it('normalises code and measures similarity', () => {
    const a = 'def add(x, y):\n    # add them\n    return x + y\nprint(add(int(input()), int(input())))';
    const b = 'def plus(p,q):\n    return p+q  # sum\nprint(plus(int(input()),int(input())))';
    expect(codeHash(a)).toBe(codeHash(b));
    const c = 'for i in range(10):\n    print(i * 2)';
    expect(codeHash(a)).not.toBe(codeHash(c));
    expect(jaccard(shingles(codeTokens(a)), shingles(codeTokens(c)))).toBeLessThan(0.3);
  });
  it('shuffles deterministically', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 42, 'x')).toEqual(seededShuffle(items, 42, 'x'));
    expect(seededShuffle(items, 42, 'x')).not.toEqual(seededShuffle(items, 43, 'x'));
    expect([...seededShuffle(items, 1, 'y')].sort()).toEqual(items);
  });
  it('rejects dangerous regex', () => {
    expect(regexProblem('(a+)+$')).toBeTruthy();
    expect(regexProblem('(a)\\1')).toBeTruthy();
    expect(regexProblem('colou?r')).toBeNull();
  });
});

describe('bulk import parsing', () => {
  it('parses csv with quotes', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('maps rows and reports field errors', () => {
    const ok = importRowToInput({ title: 'Capital of France', optionA: 'Paris', optionB: 'Rome', optionC: 'Berlin', correct: 'A', tags: 'geo;gk', marks: '2' });
    expect(ok.input?.options.length).toBe(3);
    expect(ok.input?.answer.correct).toBe('a');
    expect(ok.input?.tags).toEqual(['geo', 'gk']);
    const multi = importRowToInput({ type: 'mcq_multi', title: 'Primes', optionA: '2', optionB: '3', optionC: '4', correct: 'A;B' });
    expect(multi.input?.answer.correct).toEqual(['a', 'b']);
    expect(importRowToInput({ title: 'x', optionA: 'only', correct: 'A' }).errors?.options).toBeTruthy();
    expect(importRowToInput({ title: 'x', optionA: '1', optionB: '2', correct: 'C' }).errors?.correct).toBeTruthy();
    expect(importRowToInput({ title: '', optionA: '1', optionB: '2', correct: 'A' }).errors?.title).toBeTruthy();
    expect(() => rowsFromBody({ format: 'json', rows: [] })).toThrow();
    expect(() => parseQuestion({ type: 'coding', title: 't', marks: 5, coding: { languages: ['python3'], testCases: [{ kind: 'sample', input: '1', expectedOutput: '1', weight: 0 }] } })).toThrow();
  });
});

describe('Judge0 client', () => {
  it('sends base64 batches with limits, auth headers and polls until done', async () => {
    const calls: { url: string; init: any }[] = [];
    let polls = 0;
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, init });
      if (init.method === 'POST') return new Response(JSON.stringify([{ token: 't1' }, { token: 't2' }]), { status: 201 });
      polls++;
      const done = polls >= 2;
      return new Response(JSON.stringify({
        submissions: [
          { token: 't1', status: { id: done ? 3 : 2 }, stdout: Buffer.from('3\n').toString('base64'), time: '0.01', memory: 1000 },
          { token: 't2', status: { id: done ? 6 : 2 }, compile_output: Buffer.from('bad').toString('base64'), time: null, memory: 0 },
        ],
      }), { status: 200 });
    }) as any;
    const c = createJudge0Client({ url: 'https://j0.example/', apiKey: 'K', apiHost: 'judge0.p.rapidapi.com', authToken: 'T', fetchImpl, pollIntervalMs: 1 });
    const out = await c.execute([{ language: 'python3', code: 'print(3)', stdin: '1 2' }, { language: 'cpp', code: 'x', stdin: '' }], { timeLimitMs: 2000, memoryLimitMb: 128 });
    expect(out.map((o) => o.status)).toEqual(['ok', 'compile_error']);
    expect(out[0].stdout).toBe('3\n');
    const post = calls[0];
    expect(post.url).toBe('https://j0.example/submissions/batch?base64_encoded=true');
    const body = JSON.parse(post.init.body);
    expect(body.submissions[0]).toMatchObject({ language_id: 71, cpu_time_limit: 2, memory_limit: 128 * 1024 });
    expect(body.submissions[1].language_id).toBe(54);
    expect(Buffer.from(body.submissions[0].source_code, 'base64').toString()).toBe('print(3)');
    expect(Buffer.from(body.submissions[0].stdin, 'base64').toString()).toBe('1 2');
    expect(post.init.headers['X-RapidAPI-Key']).toBe('K');
    expect(post.init.headers['X-RapidAPI-Host']).toBe('judge0.p.rapidapi.com');
    expect(post.init.headers['X-Auth-Token']).toBe('T');
    expect(polls).toBe(2);
  });
  it('maps errors to unavailable', async () => {
    const c = createJudge0Client({ url: 'https://j0.example', fetchImpl: (async () => new Response('x', { status: 503 })) as any, pollIntervalMs: 1 });
    await expect(c.execute([{ language: 'c', code: '', stdin: '' }], { timeLimitMs: 1000, memoryLimitMb: 64 })).rejects.toBeInstanceOf(JudgeUnavailableError);
    const timeout = createJudge0Client({
      url: 'https://j0.example', pollIntervalMs: 1, timeoutMs: 20,
      fetchImpl: (async (_u: string, init: any) => (init.method === 'POST'
        ? new Response(JSON.stringify([{ token: 'a' }]), { status: 201 })
        : new Response(JSON.stringify({ submissions: [{ token: 'a', status: { id: 2 } }] }), { status: 200 }))) as any,
    });
    await expect(timeout.execute([{ language: 'c', code: '', stdin: '' }], { timeLimitMs: 1000, memoryLimitMb: 64 })).rejects.toThrow(/timed out/);
  });
  it('treats a runtime error at the memory limit as MLE and verdict mapping per test', async () => {
    const j = createJudge0Client({
      url: 'https://j0.example', pollIntervalMs: 1,
      fetchImpl: (async (_u: string, init: any) => (init.method === 'POST'
        ? new Response(JSON.stringify([{ token: 'a' }, { token: 'b' }, { token: 'c' }]), { status: 201 })
        : new Response(JSON.stringify({ submissions: [
          { token: 'a', status: { id: 11 }, memory: 64 * 1024 }, { token: 'b', status: { id: 5 }, time: '3.0' }, { token: 'c', status: { id: 4 }, stdout: Buffer.from('9').toString('base64') },
        ] }), { status: 200 }))) as any,
    });
    const ev = await evaluateCode(j, { timeLimitMs: 1000, memoryLimitMb: 64 }, 'python3', 'x', [
      { id: 't1', kind: 'hidden', input: '', expectedOutput: '1', weight: 1 }, { id: 't2', kind: 'hidden', input: '', expectedOutput: '1', weight: 1 }, { id: 't3', kind: 'sample', input: '', expectedOutput: '1', weight: 1 },
    ]);
    expect(ev.outcomes.map((o) => o.verdict)).toEqual(['memory_limit_exceeded', 'time_limit_exceeded', 'wrong_answer']);
    expect(ev.verdict).toBe('time_limit_exceeded');
  });
  it('mock judge sanity', async () => {
    const m = new MockJudge();
    const r = await m.execute([{ language: 'python3', code: '# SUM', stdin: '2 3' }], { timeLimitMs: 1, memoryLimitMb: 1 });
    expect(r[0].stdout.trim()).toBe('5');
  });
});

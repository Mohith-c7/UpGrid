import { CODE_LANGUAGES, type CodeLanguage, type Difficulty, type Question, type QuestionType, type QuestionWrite, type TestCase } from '@/api/assessments';
import { parseNum } from './kit';

export interface TestForm { id?: string; kind: 'sample' | 'hidden'; input: string; expected: string; weight: string; explanation: string }
export interface QuestionForm {
  type: QuestionType;
  title: string; body: string; topic: string; tagsText: string; difficulty: Difficulty;
  marks: string; negativeMarks: string; explanation: string; practice: boolean;
  options: { text: string }[];
  correct: boolean[];
  numValue: string; numTol: string;
  acceptedText: string; shortMode: 'exact' | 'regex'; caseSensitive: boolean;
  constraints: string; languages: CodeLanguage[]; timeLimitMs: string; memoryLimitMb: string;
  compareMode: 'tokens' | 'lines'; floatTol: string;
  starter: Partial<Record<CodeLanguage, string>>;
  refLang: CodeLanguage | ''; refCode: string;
  tests: TestForm[];
}

export const EMPTY_FORM: QuestionForm = {
  type: 'mcq_single', title: '', body: '', topic: '', tagsText: '', difficulty: 'medium', marks: '1', negativeMarks: '0', explanation: '', practice: false,
  options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }], correct: [false, false, false, false],
  numValue: '', numTol: '0', acceptedText: '', shortMode: 'exact', caseSensitive: false,
  constraints: '', languages: ['python3'], timeLimitMs: '2000', memoryLimitMb: '256', compareMode: 'tokens', floatTol: '', starter: {}, refLang: '', refCode: '',
  tests: [{ kind: 'sample', input: '', expected: '', weight: '1', explanation: '' }, { kind: 'hidden', input: '', expected: '', weight: '1', explanation: '' }, { kind: 'hidden', input: '', expected: '', weight: '1', explanation: '' }],
};

export function fromQuestion(q: Question): QuestionForm {
  const f: QuestionForm = { ...EMPTY_FORM, type: q.type, title: q.title, body: q.body ?? '', topic: q.topic ?? '', tagsText: (q.tags ?? []).join(', '), difficulty: q.difficulty,
    marks: String(q.marks), negativeMarks: String(q.negativeMarks ?? 0), explanation: q.explanation ?? '', practice: !!q.practice };
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    const opts = q.options ?? [];
    f.options = opts.map((o) => ({ text: o.text }));
    const corr = q.type === 'mcq_single' ? [q.answer?.correct] : (q.answer?.correct ?? []);
    f.correct = opts.map((o) => corr.includes(o.id));
  } else if (q.type === 'numeric') {
    f.numValue = String(q.answer?.value ?? ''); f.numTol = String(q.answer?.tolerance ?? 0);
  } else if (q.type === 'short_text') {
    f.acceptedText = (q.answer?.accepted ?? []).join('\n'); f.shortMode = q.answer?.mode === 'regex' ? 'regex' : 'exact'; f.caseSensitive = !!q.answer?.caseSensitive;
  } else if (q.type === 'coding' && q.coding) {
    const c = q.coding;
    f.constraints = c.constraints ?? ''; f.languages = c.languages ?? []; f.timeLimitMs = String(c.timeLimitMs); f.memoryLimitMb = String(c.memoryLimitMb);
    f.compareMode = c.compare?.mode === 'lines' ? 'lines' : 'tokens'; f.floatTol = c.compare?.floatTolerance != null ? String(c.compare.floatTolerance) : '';
    f.starter = { ...(c.starterCode ?? {}) };
    f.refLang = c.referenceSolution?.language ?? ''; f.refCode = c.referenceSolution?.code ?? '';
    f.tests = (c.testCases ?? []).map((t) => ({ id: t.id, kind: t.kind, input: t.input, expected: t.expectedOutput, weight: String(t.weight ?? 1), explanation: t.explanation ?? '' }));
  }
  return f;
}

const LETTERS = 'abcdefgh';

/** Client-side mirror of the server rules. Keys match the server `fields` paths so both can share one error map. */
export function toWrite(f: QuestionForm): { body: QuestionWrite | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = f.title.trim();
  if (!title) errors.title = 'Enter a title.'; else if (title.length > 200) errors.title = 'Keep the title within 200 characters.';
  if (f.body.length > 20000) errors.body = 'Statement is too long (20000 characters max).';
  if (f.topic.trim().length > 80) errors.topic = 'Topic can be 80 characters at most.';
  const tags = Array.from(new Set(f.tagsText.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean)));
  if (tags.length > 10) errors.tags = 'Use at most 10 tags.';
  const marks = parseNum(f.marks);
  if (marks === null || marks < 0.25 || marks > 100) errors.marks = 'Marks must be between 0.25 and 100.';
  const neg = f.negativeMarks.trim() === '' ? 0 : parseNum(f.negativeMarks);
  if (neg === null || neg < 0 || (marks !== null && neg > marks)) errors.negativeMarks = 'Negative marks must be between 0 and the marks.';
  if (f.explanation.length > 5000) errors.explanation = 'Explanation is too long (5000 characters max).';

  let options: { id: string; text: string }[] | undefined;
  let answer: any = {};
  let coding: QuestionWrite['coding'] = null;

  if (f.type === 'mcq_single' || f.type === 'mcq_multi') {
    if (f.options.length < 2 || f.options.length > 8) errors.options = 'Use 2 to 8 options.';
    f.options.forEach((o, i) => { if (!o.text.trim()) errors[`options.${i}.text`] = 'Option text is required.'; });
    options = f.options.map((o, i) => ({ id: LETTERS[i], text: o.text.trim() }));
    const idx = f.correct.map((c, i) => (c ? i : -1)).filter((i) => i >= 0 && i < f.options.length);
    if (idx.length === 0) errors['answer.correct'] = f.type === 'mcq_single' ? 'Mark the correct option.' : 'Mark at least one correct option.';
    if (f.type === 'mcq_single' && idx.length > 1) errors['answer.correct'] = 'Single choice questions have exactly one correct option.';
    answer = f.type === 'mcq_single' ? { correct: LETTERS[idx[0] ?? 0] } : { correct: idx.map((i) => LETTERS[i]) };
  } else if (f.type === 'numeric') {
    const v = parseNum(f.numValue); const tol = f.numTol.trim() === '' ? 0 : parseNum(f.numTol);
    if (v === null) errors['answer.value'] = 'Enter the correct number.';
    if (tol === null || tol < 0) errors['answer.tolerance'] = 'Tolerance must be 0 or more.';
    answer = { value: v ?? 0, tolerance: tol ?? 0 };
  } else if (f.type === 'short_text') {
    const accepted = f.acceptedText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (accepted.length < 1 || accepted.length > 20) errors['answer.accepted'] = 'Enter 1 to 20 accepted answers, one per line.';
    if (accepted.some((a) => a.length > 200)) errors['answer.accepted'] = 'Each accepted answer can be 200 characters at most.';
    if (f.shortMode === 'regex') {
      for (const a of accepted) { try { new RegExp(a); } catch { errors['answer.accepted'] = `"${a}" is not a valid pattern.`; break; } }
    }
    answer = { accepted, mode: f.shortMode, caseSensitive: f.caseSensitive };
  } else {
    if (f.languages.length < 1) errors['coding.languages'] = 'Choose at least one language.';
    const tl = parseNum(f.timeLimitMs); const ml = parseNum(f.memoryLimitMb);
    if (tl === null || tl < 100 || tl > 15000) errors['coding.timeLimitMs'] = 'Time limit must be 100 to 15000 ms.';
    if (ml === null || ml < 16 || ml > 512) errors['coding.memoryLimitMb'] = 'Memory limit must be 16 to 512 MB.';
    const ft = f.floatTol.trim() === '' ? undefined : parseNum(f.floatTol);
    if (ft === null) errors['coding.compare.floatTolerance'] = 'Enter a number or leave blank.';
    if (f.tests.length < 1) errors['coding.testCases'] = 'Add at least one test case.';
    let totalW = 0;
    const tests: TestCase[] = f.tests.map((t, i) => {
      const w = parseNum(t.weight);
      if (w === null || !Number.isInteger(w) || w < 0 || w > 100) errors[`coding.testCases.${i}.weight`] = 'Weight is a whole number from 0 to 100.';
      else totalW += w;
      if (!t.expected.trim()) errors[`coding.testCases.${i}.expectedOutput`] = 'Expected output is required.';
      return { id: t.id ?? `t${i + 1}`, kind: t.kind, input: t.input, expectedOutput: t.expected, weight: w ?? 1, ...(t.explanation.trim() ? { explanation: t.explanation.trim() } : {}) };
    });
    if (f.tests.length && totalW <= 0 && !errors['coding.testCases']) errors['coding.testCases'] = 'Total test weight must be above 0.';
    const starterCode: Partial<Record<CodeLanguage, string>> = {};
    CODE_LANGUAGES.forEach((l) => { if (f.languages.includes(l) && (f.starter[l] ?? '').trim()) starterCode[l] = f.starter[l]; });
    if (starterCode.java && !/public\s+class\s+Main/.test(starterCode.java)) errors['coding.starterCode.java'] = 'Java starter code must declare "public class Main".';
    if (f.refCode.trim() && !f.refLang) errors['coding.referenceSolution'] = 'Choose the reference solution language.';
    coding = {
      constraints: f.constraints, languages: f.languages, timeLimitMs: tl ?? 2000, memoryLimitMb: ml ?? 256,
      compare: { mode: f.compareMode, ...(ft !== undefined && ft !== null ? { floatTolerance: ft } : {}) },
      starterCode, referenceSolution: f.refCode.trim() && f.refLang ? { language: f.refLang, code: f.refCode } : null, testCases: tests,
    };
    if (f.practice) {
      if (tests.filter((t) => t.kind === 'sample').length < 1) errors['coding.testCases'] = 'Practice coding problems need at least 1 sample test.';
      else if (tests.filter((t) => t.kind === 'hidden').length < 2) errors['coding.testCases'] = 'Practice coding problems need at least 2 hidden tests.';
    }
  }
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    errors,
    body: {
      type: f.type, title, body: f.body.trim() ? f.body : title, topic: f.topic.trim(), tags, difficulty: f.difficulty,
      marks: marks!, negativeMarks: neg ?? 0, explanation: f.explanation, practice: f.practice,
      ...(options ? { options } : {}), answer, coding,
    },
  };
}

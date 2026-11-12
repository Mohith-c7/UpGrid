import type { QuestionType } from './schemas';

export type Correctness = 'correct' | 'partial' | 'wrong' | 'unanswered';
export interface GradeResult { score: number; correct: Correctness }

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function normText(s: string, caseSensitive = false): string {
  const t = s.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLowerCase();
}

export interface KeyedQuestion {
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  answer: any;
}

/** Normalises a raw student answer; returns undefined when unanswered. */
export function isAnswered(type: QuestionType, answer: unknown): boolean {
  if (answer === null || answer === undefined) return false;
  switch (type) {
    case 'mcq_single': return typeof answer === 'string' && answer !== '';
    case 'mcq_multi': return Array.isArray(answer) && answer.length > 0;
    case 'numeric': return answer !== '' && Number.isFinite(Number(answer));
    case 'short_text': return typeof answer === 'string' && answer.trim() !== '';
    case 'coding': return typeof answer === 'object' && typeof (answer as any).code === 'string' && (answer as any).code.trim() !== '';
  }
}

/**
 * Deterministic grading for the non-coding types.
 * `negative` is the effective deduction for a wrong answer (already 0 when negative marking is off).
 */
export function gradeObjective(q: KeyedQuestion, answer: unknown, negative: boolean): GradeResult {
  if (!isAnswered(q.type, answer)) return { score: 0, correct: 'unanswered' };
  const neg = negative ? q.negativeMarks : 0;
  const wrong: GradeResult = { score: round2(-neg), correct: 'wrong' };
  const right: GradeResult = { score: round2(q.marks), correct: 'correct' };
  switch (q.type) {
    case 'mcq_single':
      return answer === q.answer?.correct ? right : wrong;
    case 'mcq_multi': {
      const key: string[] = Array.isArray(q.answer?.correct) ? q.answer.correct : [];
      const chosen = Array.from(new Set(answer as string[]));
      if (chosen.some((c) => !key.includes(c))) return wrong;
      if (chosen.length === key.length) return right;
      // strict subset of the correct set, no wrong option: proportional credit, no deduction
      return { score: round2((q.marks * chosen.length) / key.length), correct: 'partial' };
    }
    case 'numeric': {
      const v = Number(answer);
      const tol = typeof q.answer?.tolerance === 'number' ? q.answer.tolerance : 0;
      return Math.abs(v - Number(q.answer?.value)) <= tol + 1e-12 ? right : wrong;
    }
    case 'short_text': {
      const cs = !!q.answer?.caseSensitive;
      const given = normText(String(answer), cs);
      const accepted: string[] = q.answer?.accepted || [];
      let ok = false;
      if (q.answer?.mode === 'regex') {
        if (given.length <= 500) {
          ok = accepted.some((p) => {
            try { return new RegExp(`^(?:${p})$`, cs ? '' : 'i').test(given); } catch { return false; }
          });
        }
      } else {
        ok = accepted.some((a) => normText(a, cs) === given);
      }
      return ok ? right : wrong;
    }
    default:
      return { score: 0, correct: 'unanswered' };
  }
}

/** coding: weighted partial credit from per-test pass flags. */
export function gradeCoding(marks: number, tests: { weight: number; passed: boolean }[]): GradeResult {
  const total = tests.reduce((s, t) => s + t.weight, 0);
  if (total <= 0) return { score: 0, correct: 'unanswered' };
  const got = tests.reduce((s, t) => s + (t.passed ? t.weight : 0), 0);
  const score = round2((marks * got) / total);
  return { score, correct: got === total ? 'correct' : got > 0 ? 'partial' : 'wrong' };
}

export interface SectionDef { id: string; cutoffMarks: number | null }
export interface Totals {
  score: number; maxScore: number;
  sections: Record<string, { score: number; maxScore: number; cutoffMet: boolean | null }>;
  passed: boolean | null;
}

/** Aggregates question scores into section/attempt totals and applies the cutoffs. */
export function aggregate(
  sections: SectionDef[],
  questions: { sectionId: string; marks: number; score: number }[],
  passCutoff: { type: 'marks' | 'percent'; value: number } | null,
  override?: number | null,
): Totals {
  const out: Totals = { score: 0, maxScore: 0, sections: {}, passed: null };
  for (const s of sections) out.sections[s.id] = { score: 0, maxScore: 0, cutoffMet: null };
  for (const q of questions) {
    const sec = out.sections[q.sectionId];
    if (!sec) continue;
    sec.score = round2(sec.score + q.score);
    sec.maxScore = round2(sec.maxScore + q.marks);
  }
  for (const s of sections) {
    const sec = out.sections[s.id];
    out.score = round2(out.score + sec.score);
    out.maxScore = round2(out.maxScore + sec.maxScore);
    if (s.cutoffMarks !== null && s.cutoffMarks !== undefined) sec.cutoffMet = sec.score >= s.cutoffMarks;
  }
  const effective = override !== null && override !== undefined ? override : out.score;
  const hasSectionCutoff = sections.some((s) => s.cutoffMarks !== null && s.cutoffMarks !== undefined);
  if (passCutoff || hasSectionCutoff) {
    let ok = true;
    if (passCutoff) {
      const need = passCutoff.type === 'marks' ? passCutoff.value : (out.maxScore * passCutoff.value) / 100;
      ok = effective + 1e-9 >= need;
    }
    for (const s of sections) if (out.sections[s.id].cutoffMet === false) ok = false;
    out.passed = ok;
  }
  return out;
}

/** Standard competition ranking ("1,1,3") on descending scores. */
export function rankScores<T extends { score: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.slice().sort((a, b) => b.score - a.score);
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.score !== sorted[i - 1].score) rank = i + 1;
    return { ...r, rank };
  });
}

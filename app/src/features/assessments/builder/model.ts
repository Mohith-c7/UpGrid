import type { Assessment, AssessmentSettings, AssessmentWrite, Audience, Section } from '@/api/assessments';
import { istPartsToISO, isoToISTParts, type ISTParts } from '@/features/officer/format';
import { parseNum } from '../kit';

export const STEPS = ['Details', 'Questions', 'Rules', 'Audience', 'Schedule', 'Review'];

export const DEFAULT_SETTINGS: AssessmentSettings = {
  randomiseQuestions: false, randomiseOptions: false, negativeMarking: false, passCutoff: null,
  resultVisibility: 'after_close', allowReview: false, maxAttempts: 1, rankingEnabled: true,
  proctoring: { enabled: false, maxWarnings: 3, autoSubmit: false },
};

export interface BuilderForm {
  title: string;
  instructions: string;
  driveId: string | null;
  practice: boolean;
  duration: string;
  sections: Section[];
  settings: AssessmentSettings;
  cutoffType: 'none' | 'marks' | 'percent';
  cutoffValue: string;
  maxAttempts: string;
  maxWarnings: string;
  audience: Audience;
  studentNames: Record<string, string>;
  opens: ISTParts | null;
  closes: ISTParts | null;
}

export const emptySection = (n: number): Section => ({ title: `Section ${n}`, timeLimitMinutes: null, cutoffMarks: null, questions: [] });

export function newForm(driveId?: string | null): BuilderForm {
  return {
    title: '', instructions: '', driveId: driveId ?? null, practice: false, duration: '60',
    sections: [emptySection(1)], settings: DEFAULT_SETTINGS, cutoffType: 'none', cutoffValue: '', maxAttempts: '1', maxWarnings: '3',
    audience: { type: driveId ? 'drive_applicants' : 'all_students', driveId: driveId ?? null, statuses: ['submitted', 'screening', 'assessment'] },
    studentNames: {}, opens: null, closes: null,
  };
}

export function fromAssessment(a: Assessment): BuilderForm {
  const s = { ...DEFAULT_SETTINGS, ...a.settings, proctoring: { ...DEFAULT_SETTINGS.proctoring, ...(a.settings?.proctoring ?? {}) } };
  return {
    title: a.title, instructions: a.instructions ?? '', driveId: a.driveId ?? null, practice: !!a.practice, duration: String(a.durationMinutes ?? 60),
    sections: a.sections?.length ? a.sections.map((x) => ({ ...x, questions: x.questions.map((q) => ({ ...q })) })) : [emptySection(1)],
    settings: s, cutoffType: s.passCutoff ? s.passCutoff.type : 'none', cutoffValue: s.passCutoff ? String(s.passCutoff.value) : '',
    maxAttempts: String(s.maxAttempts ?? 1), maxWarnings: String(s.proctoring.maxWarnings ?? 3),
    audience: a.audience ?? { type: 'all_students' }, studentNames: {},
    opens: isoToISTParts(a.opensAt), closes: isoToISTParts(a.closesAt),
  };
}

export const totalMarks = (f: BuilderForm) => f.sections.reduce((n, s) => n + s.questions.reduce((m, q) => m + (q.marks || 0), 0), 0);
export const questionCount = (f: BuilderForm) => f.sections.reduce((n, s) => n + s.questions.length, 0);

/** The server schema is strict (no null driveId, at least one status/student), so incomplete audiences are sent as null while drafting. */
export function cleanAudience(f: BuilderForm): Audience | null {
  if (f.practice) return { type: 'all_students' };
  const a = f.audience;
  const driveId = a.driveId ?? f.driveId ?? undefined;
  switch (a.type) {
    case 'drive_applicants': return a.statuses?.length ? { type: 'drive_applicants', ...(driveId ? { driveId } : {}), statuses: a.statuses } : null;
    case 'all_eligible': return { type: 'all_eligible', ...(driveId ? { driveId } : {}) };
    case 'students': return a.studentIds?.length ? { type: 'students', studentIds: a.studentIds } : null;
    case 'cohort': return a.cohortId?.trim() ? { type: 'cohort', cohortId: a.cohortId.trim() } : null;
    default: return { type: 'all_students' };
  }
}

/** Builds the PUT/POST body. Never throws; values that do not parse fall back to sane defaults and are flagged by `problems`. */
export function toBody(f: BuilderForm): AssessmentWrite {
  const dur = parseNum(f.duration);
  const cut = parseNum(f.cutoffValue);
  const attempts = parseNum(f.maxAttempts);
  const warns = parseNum(f.maxWarnings);
  const settings: AssessmentSettings = {
    ...f.settings,
    passCutoff: f.cutoffType === 'none' || cut === null ? null : { type: f.cutoffType, value: cut },
    maxAttempts: Math.min(10, Math.max(1, Math.round(attempts ?? 1))),
    proctoring: { ...f.settings.proctoring, maxWarnings: Math.min(20, Math.max(1, Math.round(warns ?? 3))) },
  };
  const audience = cleanAudience(f);
  return {
    title: f.title.trim().slice(0, 150), instructions: f.instructions, driveId: f.driveId, audience,
    opensAt: f.practice || !f.opens ? null : istPartsToISO(f.opens),
    closesAt: f.practice || !f.closes ? null : istPartsToISO(f.closes),
    durationMinutes: Math.min(600, Math.max(1, Math.round(dur ?? 60))),
    practice: f.practice, settings,
    sections: f.sections.map((s) => ({
      ...(s.id ? { id: s.id } : {}), title: (s.title.trim() || 'Section').slice(0, 100), timeLimitMinutes: s.timeLimitMinutes, cutoffMarks: s.cutoffMarks,
      questions: s.questions.map((q) => ({ questionId: q.questionId, marks: q.marks, negativeMarks: q.negativeMarks })),
    })),
  };
}

export interface Problem { step: number; text: string }
/** Local checks that mirror the server publish checks, so most mistakes are caught before the round trip. */
export function localProblems(f: BuilderForm, serverNowMs: number): Problem[] {
  const out: Problem[] = [];
  if (!f.title.trim()) out.push({ step: 0, text: 'Add a title.' });
  const dur = parseNum(f.duration);
  if (dur === null || dur < 1 || dur > 600) out.push({ step: 0, text: 'Duration must be 1 to 600 minutes.' });
  if (questionCount(f) === 0) out.push({ step: 1, text: 'Add at least one question.' });
  f.sections.forEach((s, i) => {
    if (!s.title.trim()) out.push({ step: 1, text: `Section ${i + 1} needs a title.` });
    if (s.questions.length === 0 && f.sections.length > 1) out.push({ step: 1, text: `${s.title || `Section ${i + 1}`} has no questions.` });
  });
  const total = totalMarks(f);
  if (questionCount(f) > 0 && total <= 0) out.push({ step: 2, text: 'Total marks must be above 0.' });
  if (f.cutoffType !== 'none') {
    const c = parseNum(f.cutoffValue);
    if (c === null || c < 0) out.push({ step: 2, text: 'Enter the pass cutoff value.' });
    else if (f.cutoffType === 'marks' && c > total) out.push({ step: 2, text: `Pass cutoff (${c}) is more than the total marks (${total}).` });
    else if (f.cutoffType === 'percent' && c > 100) out.push({ step: 2, text: 'Pass cutoff percent cannot exceed 100.' });
  }
  if (!f.practice) {
    const t = f.audience.type;
    if ((t === 'drive_applicants' || t === 'all_eligible') && !(f.audience.driveId ?? f.driveId)) out.push({ step: 3, text: 'Choose the drive for this audience.' });
    if (t === 'students' && !(f.audience.studentIds?.length)) out.push({ step: 3, text: 'Pick at least one student.' });
    if (t === 'cohort' && !f.audience.cohortId?.trim()) out.push({ step: 3, text: 'Enter the cohort.' });
    if (!f.opens) out.push({ step: 4, text: 'Set when the test opens.' });
    if (!f.closes) out.push({ step: 4, text: 'Set when the test closes.' });
    if (f.opens && istPartsToISO(f.opens) && Date.parse(istPartsToISO(f.opens)) <= serverNowMs) out.push({ step: 4, text: 'The opening time must be in the future.' });
    if (f.opens && f.closes && dur !== null && Date.parse(istPartsToISO(f.closes)) <= Date.parse(istPartsToISO(f.opens)) + dur * 60000) out.push({ step: 4, text: 'The window must be longer than the test duration.' });
  }
  return out;
}

/** Map a server `fields` path to the step that owns it. */
export function stepForPath(path: string): number {
  const p = path.toLowerCase();
  if (p.startsWith('title') || p.startsWith('instructions') || p.startsWith('duration') || p.startsWith('drive')) return p.startsWith('drive') && p.includes('audience') ? 3 : 0;
  if (p.startsWith('sections') || p.startsWith('questions') || p.startsWith('section')) return 1;
  if (p.startsWith('settings') || p.startsWith('passcutoff') || p.startsWith('totalmarks') || p.startsWith('marks')) return 2;
  if (p.startsWith('audience')) return 3;
  if (p.startsWith('opensat') || p.startsWith('closesat') || p.startsWith('window')) return 4;
  return 5;
}

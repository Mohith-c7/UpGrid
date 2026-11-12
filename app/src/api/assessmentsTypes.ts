/** Types for the officer side of server/docs/assessments-api.md (question bank, assessments, results). */

export type QuestionType = 'mcq_single' | 'mcq_multi' | 'numeric' | 'short_text' | 'coding';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'active' | 'archived';
export type CodeLanguage = 'python3' | 'java' | 'cpp' | 'c' | 'javascript';
export const CODE_LANGUAGES: CodeLanguage[] = ['python3', 'java', 'cpp', 'c', 'javascript'];

export interface QOption { id: string; text: string }

export type QAnswer =
  | { correct: string }
  | { correct: string[] }
  | { value: number; tolerance?: number }
  | { accepted: string[]; mode?: 'exact' | 'regex'; caseSensitive?: boolean }
  | Record<string, never>;

export interface TestCase {
  id: string;
  kind: 'sample' | 'hidden';
  input: string;
  expectedOutput: string;
  weight: number;
  explanation?: string;
}

export interface CodingSpec {
  constraints?: string;
  languages: CodeLanguage[];
  timeLimitMs: number;
  memoryLimitMb: number;
  compare?: { mode: 'tokens' | 'lines'; floatTolerance?: number };
  starterCode?: Partial<Record<CodeLanguage, string>>;
  referenceSolution?: { language: CodeLanguage; code: string } | null;
  testCases: TestCase[];
}

export interface Question {
  id: string;
  type: QuestionType;
  title: string;
  body: string;
  topic: string;
  tags: string[];
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  explanation: string;
  practice: boolean;
  status: QuestionStatus;
  options?: QOption[];
  answer: any;
  coding: CodingSpec | null;
  usedIn?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  title: string;
  topic: string;
  tags: string[];
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  practice: boolean;
  status: QuestionStatus;
  usedIn?: number;
  testCaseCounts?: { sample: number; hidden: number };
  updatedAt?: string;
}

export interface QuestionWrite {
  type: QuestionType;
  title: string;
  body: string;
  topic: string;
  tags: string[];
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  explanation: string;
  practice: boolean;
  options?: QOption[];
  answer: any;
  coding?: CodingSpec | null;
}

export interface QuestionFilters {
  q?: string; type?: string; difficulty?: string; topic?: string; tag?: string;
  status?: 'active' | 'archived' | 'all'; practice?: boolean;
}

export interface ImportErrorRow { row: number; fields: Record<string, string> }
export interface ImportResult { total: number; imported: number; valid: number; dryRun: boolean; errors: ImportErrorRow[] }

/* ---------------- assessments ---------------- */
export type AssessmentStatus = 'draft' | 'published' | 'archived';
export type AudienceType = 'drive_applicants' | 'all_eligible' | 'students' | 'cohort' | 'all_students';
export interface Audience {
  type: AudienceType;
  driveId?: string | null;
  statuses?: string[];
  studentIds?: string[];
  cohortId?: string;
}
export interface PassCutoff { type: 'marks' | 'percent'; value: number }
export type ResultVisibility = 'immediate' | 'after_close' | 'manual';
export interface AssessmentSettings {
  randomiseQuestions: boolean;
  randomiseOptions: boolean;
  negativeMarking: boolean;
  passCutoff: PassCutoff | null;
  resultVisibility: ResultVisibility;
  allowReview: boolean;
  maxAttempts: number;
  rankingEnabled: boolean;
  proctoring: { enabled: boolean; maxWarnings: number; autoSubmit: boolean };
}
export interface SectionQuestion {
  id?: string; // assessment-question id (aqId) once saved
  questionId: string;
  type: QuestionType;
  title: string;
  marks: number;
  negativeMarks: number;
  difficulty: Difficulty;
}
export interface Section {
  id?: string;
  title: string;
  timeLimitMinutes: number | null;
  cutoffMarks: number | null;
  questions: SectionQuestion[];
}
export interface Assessment {
  id: string;
  title: string;
  instructions: string;
  status: AssessmentStatus;
  practice: boolean;
  driveId: string | null;
  drive?: { id: string; company: string; role: string } | null;
  audience: Audience;
  opensAt: string | null;
  closesAt: string | null;
  durationMinutes: number;
  settings: AssessmentSettings;
  sections: Section[];
  totalMarks: number;
  questionCount: number;
  audienceCount?: number;
  resultsPublishedAt: string | null;
  publishedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  counts?: { attempts: number; submitted: number; inProgress: number };
}
export type AssessmentSummary = Omit<Assessment, 'sections'> & { sections?: Section[] };

export interface AssessmentWrite {
  title: string;
  instructions: string;
  driveId: string | null;
  audience: Audience | null;
  opensAt: string | null;
  closesAt: string | null;
  durationMinutes: number;
  practice: boolean;
  settings: AssessmentSettings;
  sections: { id?: string; title: string; timeLimitMinutes: number | null; cutoffMarks: number | null; questions: { questionId: string; marks: number; negativeMarks: number }[] }[];
}

export interface AudiencePreview { count: number; sample: { id: string; name: string }[]; unresolved?: string }
export interface PublishResult { assessment: Assessment; audienceCount: number; notified: number; replayed: boolean }

export interface PreviewQuestion {
  id: string; sectionId: string; number: number; type: QuestionType; title: string; body: string;
  marks: number; negativeMarks: number; options?: QOption[]; multi?: boolean;
  coding?: { constraints?: string; languages: string[]; timeLimitMs: number; memoryLimitMb: number; samples: { id: string; input: string; expectedOutput: string; explanation?: string }[]; hiddenCount: number };
}
export interface AssessmentPreview {
  sections: { id: string; title: string; timeLimitMinutes: number | null; cutoffMarks?: number | null; questionIds?: string[] }[];
  questions: PreviewQuestion[];
  settings: any;
  durationMinutes: number;
}

/* ---------------- results ---------------- */
export interface ResultsSummary {
  audience: number; participants: number; notAttempted: number; inProgress: number;
  avg: number | null; median: number | null; max: number | null; min: number | null;
  passCount: number; passRate: number | null; pendingEvaluation: number;
}
export interface ResultRow {
  rank: number | null; studentId: string; name: string; email?: string; registrationNumber?: string | null;
  attemptId: string | null; attemptNo: number | null;
  status: 'submitted' | 'in_progress' | 'not_attempted';
  submitReason: string | null; evaluation: 'pending' | 'complete' | null;
  score: number | null; maxScore: number | null; percent: number | null; passed: boolean | null;
  timeTakenSeconds: number | null; sections?: { id: string; score: number }[]; proctorWarnings: number;
  flags: { plagiarism: boolean; overridden: boolean; autoSubmitted: boolean; proctor: boolean };
  override: { score: number; reason: string } | null;
}
export interface ResultsPage { summary: ResultsSummary; items: ResultRow[]; nextCursor: string | null; released: boolean }
export interface ResultsFilters { q?: string; status?: string; passed?: '1' | '0'; flagged?: boolean; sort?: 'rank' | 'score' | 'name' | 'time' }

export interface Analytics {
  summary: ResultsSummary;
  distribution: { bucketSize: number; buckets: { fromPercent: number; toPercent: number; count: number }[]; mean: number | null; median: number | null; stdDev: number | null };
  sections: { id: string; title: string; avgScore: number | null; maxScore: number }[];
  questions: {
    id: string; sectionId: string; number: number; type: QuestionType; title: string; difficulty: Difficulty; marks: number;
    attempted: number; attemptRate: number; correctCount: number; correctPercent: number; partialCount: number;
    avgTimeSeconds: number | null; difficultyIndex: number | null;
  }[];
}

export interface PlagiarismPair {
  questionId: string; title: string;
  a: { attemptId: string; studentId: string; name: string };
  b: { attemptId: string; studentId: string; name: string };
  similarity: number; identical: boolean;
}
export interface Plagiarism { threshold: number; pairs: PlagiarismPair[] }

export interface AnswerSheetAnswer {
  questionId: string; number: number; type: QuestionType; title: string; answer: any; correctAnswer?: any;
  correct: 'correct' | 'partial' | 'wrong' | 'unanswered'; score: number; maxScore: number;
  timeSpentMs?: number | null; flagged?: boolean;
  submissions?: { id: string; language: string; status?: string; code?: string; verdict: string; passed: number; total: number; score: number; createdAt: string; tests?: { id: string; kind: string; verdict: string; timeMs: number }[] }[];
}
export interface AnswerSheet {
  attempt: { id: string; attemptNo?: number; status: string; submitReason?: string | null; startedAt?: string; submittedAt?: string | null; score?: number; effectiveScore?: number; maxScore?: number; passed?: boolean | null; evaluation?: string; warnings?: number };
  student: { id: string; name: string; email?: string; registrationNumber?: string | null };
  answers: AnswerSheetAnswer[];
  proctorEvents: { type: string; clientTs: number | null; createdAt: string; counted: boolean }[];
  override: { score: number; reason: string } | null;
}

export interface ShortlistBody { minScore?: number; topN?: number; driveId?: string; toStatus: string; dryRun: boolean; note?: string }
export interface ShortlistItem {
  studentId: string; name: string; score: number; rank: number | null; applicationId: string | null;
  from: string | null; to: string; outcome: 'change' | 'unchanged' | 'skipped'; reason?: string;
}
export interface ShortlistResult {
  dryRun: boolean; criteria: any; matched: number; willChange?: number; changed?: number; unchanged: number; pendingEvaluation: number;
  skipped: { studentId: string; name: string; reason: string }[]; items: ShortlistItem[];
}

export interface Page<T> { items: T[]; nextCursor: string | null }

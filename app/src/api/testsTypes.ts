/** Types for the student side of the Assessments API (server/docs/assessments-api.md). */

export type QuestionType = 'mcq_single' | 'mcq_multi' | 'numeric' | 'short_text' | 'coding';
export type LanguageId = 'python3' | 'java' | 'cpp' | 'c' | 'javascript' | (string & {});
export type Bucket = 'upcoming' | 'live' | 'past';
export type Verdict =
  | 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'internal_error';

export interface CodeAnswer { language: LanguageId; code: string }
/** What the server stores per question type. numeric may be a number or a numeric string. */
export type AnswerValue = string | number | string[] | CodeAnswer | null;

export interface OptionItem { id: string; text: string }
export interface SampleCase { id: string; input: string; expectedOutput: string; explanation?: string }
export interface CodingSpec {
  constraints?: string;
  languages: LanguageId[];
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode?: Record<string, string>;
  samples: SampleCase[];
  hiddenCount: number;
}
export interface StudentQuestion {
  id: string;
  sectionId: string;
  number: number;
  type: QuestionType;
  title: string;
  body: string;
  marks: number;
  negativeMarks: number;
  options?: OptionItem[];
  multi?: boolean;
  coding?: CodingSpec;
}

export interface MyAssessmentItem {
  id: string;
  title: string;
  drive: { id: string; company: string; role: string } | null;
  opensAt: string | null;
  closesAt: string | null;
  durationMinutes: number;
  totalMarks: number;
  questionCount: number;
  sectionCount: number;
  bucket: Bucket;
  attemptsAllowed: number;
  attemptsUsed: number;
  activeAttempt: { id: string; deadlineAt: string } | null;
  canStart: boolean;
  resultReleased: boolean;
  myScore: { score: number; maxScore: number; percent: number; passed: boolean | null } | null;
  serverNow: string;
}

export interface MyAssessmentDetail extends MyAssessmentItem {
  instructions: string;
  sections: { id: string; title: string; timeLimitMinutes: number | null; cutoffMarks?: number | null; questionCount: number }[];
  settings: {
    negativeMarking: boolean;
    proctoring: { enabled: boolean; maxWarnings?: number; autoSubmit?: boolean };
    resultVisibility: 'immediate' | 'after_close' | 'manual';
    allowReview: boolean;
    rankingEnabled: boolean;
    maxAttempts: number;
    randomised: boolean;
  };
}
export interface AttemptSummary {
  id: string;
  attemptNo: number;
  status: 'in_progress' | 'submitted';
  startedAt: string;
  submittedAt: string | null;
  evaluation: 'pending' | 'complete';
}
export interface MyAssessmentResponse { assessment: MyAssessmentDetail; attempts: AttemptSummary[]; serverNow: string }

export interface AttemptMeta {
  id: string;
  assessmentId: string;
  attemptNo: number;
  status: 'in_progress' | 'submitted';
  submitReason: null | 'student' | 'deadline' | 'proctor' | 'closed' | 'admin';
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  remainingSeconds: number;
  warnings: number;
  maxWarnings: number | null;
  practice: boolean;
  evaluation: 'pending' | 'complete';
}
export interface AttemptSection {
  id: string;
  title: string;
  timeLimitMinutes: number | null;
  enteredAt: string | null;
  deadlineAt: string | null;
  locked: boolean;
  questionIds: string[];
}
export interface SavedAnswer { answer: AnswerValue; flagged: boolean; savedAt?: string }
export interface CodeSummary {
  submissions: number;
  best: { passed: number; total: number; score: number; maxScore: number; verdict: Verdict } | null;
  pending: boolean;
}
export interface AttemptState {
  attempt: AttemptMeta;
  serverNow: string;
  assessment: {
    id: string; title: string; instructions: string; durationMinutes: number; negativeMarking: boolean;
    proctoring: { enabled: boolean; maxWarnings?: number; autoSubmit?: boolean }; totalMarks: number;
  };
  sections: AttemptSection[];
  questions: StudentQuestion[];
  answers: Record<string, SavedAnswer>;
  code: Record<string, CodeSummary>;
  resumed?: boolean;
}

export interface AnswerItem { questionId: string; answer?: AnswerValue; flagged?: boolean; clientTs: number; timeSpentMs?: number }
export interface SaveAnswersResponse {
  saved: number;
  stale: string[];
  rejected: { questionId: string; reason: string }[];
  serverNow: string;
  remainingSeconds: number;
}
export interface EnterSectionResponse {
  section: { id: string; enteredAt: string; deadlineAt: string | null; locked: boolean };
  questions: StudentQuestion[];
}
export type ProctorEventType = 'focus_lost' | 'focus_regained' | 'app_background' | 'network_offline';
export interface ProctorEvent { type: ProctorEventType; clientTs: number; eventId?: string }
export interface EventsResponse { warnings: number; maxWarnings: number | null; autoSubmitted: boolean; status: string; ignored?: boolean }
export interface SubmitResponse {
  attempt: { id: string; status: string; submitReason: string | null; submittedAt: string | null; evaluation: 'pending' | 'complete' };
  replayed: boolean;
  resultAvailable: boolean;
}

/* ---- coding ---- */
export interface RunResultItem {
  id?: string;
  verdict: Verdict | string;
  passed?: boolean;
  stdout: string;
  stderr: string;
  expectedOutput?: string;
  input?: string;
  timeMs: number;
  memoryKb: number;
}
export interface RunResponse {
  run: { mode: 'samples' | 'custom'; compile: { ok: boolean; output?: string }; results: RunResultItem[] };
}
export interface SubmissionSample { id: string; verdict: Verdict | string; input: string; expectedOutput: string; stdout: string; timeMs: number }
export interface CodeSubmission {
  id: string;
  language: string;
  status: 'judged' | 'pending_judge';
  verdict: Verdict | string;
  passed: number;
  total: number;
  score: number;
  maxScore: number;
  compileOutput?: string;
  samples: SubmissionSample[];
  hiddenPassed: number;
  hiddenTotal: number;
  best: { passed: number; total: number; score: number; verdict: Verdict | string };
  improved: boolean;
}
export interface SubmitCodeResponse { submission: CodeSubmission }

/* ---- result ---- */
export type ResultUnavailableReason = 'AFTER_CLOSE' | 'MANUAL' | 'EVALUATION_PENDING';
export interface ResultBody {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean | null;
  rank: number | null;
  totalParticipants: number;
  percentile: number | null;
  timeTakenSeconds: number;
  submitReason: string | null;
  evaluation: 'complete' | 'pending';
  warnings: number;
  sections: { id: string; title: string; score: number; maxScore: number; cutoffMarks: number | null; cutoffMet: boolean | null }[];
  coding: { questionId: string; title: string; verdict: string; passed: number; total: number; score: number; maxScore: number; language: string | null }[];
}
export interface ReviewItem {
  questionId: string;
  sectionId: string;
  number: number;
  type: QuestionType;
  title: string;
  body: string;
  options?: OptionItem[];
  yourAnswer: AnswerValue;
  correctAnswer?: AnswerValue;
  correct: 'correct' | 'partial' | 'wrong' | 'unanswered';
  score: number;
  maxScore: number;
  explanation?: string;
}
export type ResultResponse =
  | { available: false; visibility: string; releaseAt: string | null; reason: ResultUnavailableReason }
  | { available: true; serverNow: string; result: ResultBody; review: ReviewItem[] | null };

/* ---- practice ---- */
export interface PracticeAssessmentItem { id: string; title: string; durationMinutes: number; questionCount: number; totalMarks: number; attemptsUsed: number; lastScore: number | null }
export interface PracticeProblemItem {
  id: string; title: string; difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[]; languages: LanguageId[];
  marks: number; solved: boolean; attempted: boolean; bestPercent: number;
}
export interface PracticeProblem {
  id: string; title: string; body: string; constraints?: string; difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[];
  languages: LanguageId[]; timeLimitMs: number; memoryLimitMb: number; starterCode?: Record<string, string>; samples: SampleCase[]; hiddenCount?: number;
  solved: boolean;
  lastSubmission: { language: string; code: string; verdict: string; passed: number; total: number } | null;
}

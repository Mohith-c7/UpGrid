/** Types for the AI API (server/docs/ai-api.md). Kept separate from the shared types file. */

export interface AiQuota { limit: number; used: number; remaining: number; resetsAt: string }
export interface AiUsageInfo { inputTokens: number; outputTokens: number; cached: boolean }

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  model?: string;
  quota: AiQuota;
  consent: { required: boolean; granted: boolean; grantedAt: string | null; version: string };
}
export interface AiConsent { granted: boolean; grantedAt: string | null; revokedAt: string | null; version: string }
export interface AiDeleteResult { deleted: { conversations: number; mockInterviews: number; cache: number } }
export interface AiUsage {
  today: AiQuota;
  last7Days: { day: string; requests: number; inputTokens: number; outputTokens: number }[];
}

export type AiIntent = 'explain_eligibility' | 'suggest_drives' | 'weekly_plan' | 'faq' | 'explain_jd' | 'cover_note' | 'compare_offers';
export interface SuggestedPrompt { id: string; label: string; prompt: string; intent: AiIntent }

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; draft?: boolean; createdAt: string }
export interface ContextUsed { profile: boolean; drives: number; applications: number; schedule: number }
export interface ChatResult {
  conversationId: string;
  title?: string;
  message: ChatMessage;
  userMessage?: ChatMessage;
  contextUsed: ContextUsed;
  consentRequired: boolean;
  usage?: AiUsageInfo;
  quota?: AiQuota;
}
export interface ChatRequest { message: string; conversationId?: string; driveId?: string; intent?: AiIntent }
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number }
export interface ConversationDetail {
  conversation: { id: string; title: string; createdAt: string; updatedAt: string };
  messages: ChatMessage[];
}

export interface RewriteSuggestion { section: string; before: string; after: string; needs_student_input: boolean }
export interface ResumeReview {
  advisory: boolean;
  score: number;
  strengths: string[];
  gaps: string[];
  ats_keywords_missing: string[];
  rewrite_suggestions: RewriteSuggestion[];
  jd_match: { matched_skills: string[]; missing_skills: string[]; percent: number } | null;
}
export interface ResumeReviewRequest { resumeId?: string; fileId?: string; text?: string; driveId?: string }
export interface ResumeReviewResult { review: ResumeReview; disclaimer: string; usage?: AiUsageInfo; quota?: AiQuota }

export type InterviewType = 'hr' | 'technical' | 'behavioural' | 'coding_concepts';
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface MockInterview {
  id: string; role: string; type: InterviewType; difficulty: Difficulty; numQuestions: number;
  status: 'in_progress' | 'finished'; createdAt: string; personalised?: boolean;
}
export interface MockStartRequest {
  role: string; type: InterviewType; difficulty: Difficulty; numQuestions: number;
  driveId?: string; personalise?: boolean; resumeText?: string;
}
export interface MockQuestion { index: number; text: string }
export interface MockStartResult { interview: MockInterview; question: MockQuestion; usage?: AiUsageInfo; quota?: AiQuota }
export interface MockFeedback { summary: string; strengths: string[]; improve: string[]; score: number }
export interface MockAnswerResult {
  feedback: MockFeedback; next: MockQuestion | null; done: boolean; replayed?: boolean; usage?: AiUsageInfo; quota?: AiQuota;
}
export interface MockReport {
  advisory: boolean;
  overall: number;
  communication: { score: number; notes: string };
  technical_depth: { score: number; notes: string };
  structure_star: { score: number; notes: string };
  per_question: { index: number; question: string; score: number; comment: string }[];
  top_tips: string[];
}
export interface MockFinishResult { report: MockReport; interview: MockInterview }
export interface MockHistoryItem {
  id: string; role: string; type: InterviewType; difficulty: Difficulty; status: 'in_progress' | 'finished';
  answered: number; numQuestions: number; overall: number | null; createdAt: string;
}
export interface MockTurn { index: number; question: string; answer: string | null; feedback: MockFeedback | null }
export interface MockDetail { interview: MockInterview; turns: MockTurn[]; report: MockReport | null }

/* ---- staff tools ---- */
export interface QuestionItem {
  id: string;
  question: string;
  why_asked: string;
  evidence: { source: string; quote: string } | null;
  evidence_verified: boolean;
  expected_points: string[];
  follow_ups: string[];
  difficulty: Difficulty;
  rubric: { '1': string; '2': string; '3': string; '4': string; '5': string };
}
export interface QuestionSet {
  id: string; applicationId: string; driveId: string; roundType: string; difficulty: Difficulty;
  status: 'draft' | 'approved' | 'discarded'; draft: boolean; groundedOn: ('resume' | 'jd' | 'profile')[];
  questions: QuestionItem[]; createdBy: string; createdAt: string; updatedAt: string;
  approvedBy: string | null; approvedAt: string | null; scorecardRef: string | null;
}
export interface InterviewQuestionsRequest {
  applicationId: string; roundType: string; count: number; difficulty: Difficulty; focus?: string[]; resumeText?: string;
}
export interface CandidateSummary {
  draft: true;
  factual_summary: string;
  skills_vs_jd: { matched: { skill: string; citation: string }[]; not_evidenced: string[] };
  citations: { source: 'resume' | 'jd' | 'profile'; quote: string; verified: boolean }[];
  notes: string[];
}
export interface CandidateSummaryResult { summary: CandidateSummary; disclaimer: string; usage?: AiUsageInfo; quota?: AiQuota }
export interface AnnouncementDraftRequest { points: string; driveId?: string; tone?: 'neutral' | 'urgent' | 'friendly' }
export interface AnnouncementDraftResult {
  draft: true; announcement: { title: string; body: string }; warnings: string[]; usage?: AiUsageInfo; quota?: AiQuota;
}
export interface McqDraft {
  id: string; topic: string; difficulty: Difficulty; tags: string[]; stem: string; options: string[]; correctIndex: number;
  explanation: string; status: 'draft' | 'imported' | 'discarded'; importedQuestionId: string | null; createdAt: string;
}
export interface McqGenerateRequest { topic: string; difficulty: Difficulty; count: number; tags?: string[] }
export interface McqImportResult { imported: { draftId: string; questionId: string }[]; skipped: { draftId: string; reason: string }[] }

export interface AiPage<T> { items: T[]; nextCursor: string | null }

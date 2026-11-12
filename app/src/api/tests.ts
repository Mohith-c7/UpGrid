/**
 * Student tests API client + hooks (server/docs/assessments-api.md: /my/assessments*, /attempts/*, /practice/*).
 * Time and scores are always decided by the server; the app only mirrors `serverNow`/`deadlineAt`.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import { useFeatures } from '@/config/features';
import type { Page } from './types';
import type {
  AnswerItem, AttemptState, Bucket, EnterSectionResponse, EventsResponse, MyAssessmentItem, MyAssessmentResponse, PracticeAssessmentItem,
  PracticeProblem, PracticeProblemItem, ProctorEvent, ResultResponse, RunResponse, SaveAnswersResponse, SubmitCodeResponse, SubmitResponse,
} from './testsTypes';

export const tk = {
  all: ['tests'] as const,
  mine: (bucket: string) => ['tests', 'mine', bucket] as const,
  detail: (id?: string) => ['tests', 'detail', id ?? ''] as const,
  attempt: (id?: string) => ['tests', 'attempt', id ?? ''] as const,
  result: (id?: string) => ['tests', 'result', id ?? ''] as const,
  problems: (f: object) => ['tests', 'practice', 'problems', f] as const,
  problem: (id?: string) => ['tests', 'practice', 'problem', id ?? ''] as const,
  practiceSets: ['tests', 'practice', 'sets'] as const,
};

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

/* ------------------------------------------------------------ feature flags */
export interface TestsFeatures {
  /** `features.assessments` */
  assessments: boolean;
  /** `features.codeExecution`; only trust `false` once the config really loaded */
  codeExecution: boolean;
  /** config call still loading */
  loading: boolean;
  /** config call failed (flags default to off) */
  failed: boolean;
  retry: () => void;
}
export function useTestsFeatures(): TestsFeatures {
  const { flags, status, refetch } = useFeatures();
  return {
    assessments: flags.assessments === true,
    codeExecution: flags.codeExecution === true,
    loading: status === 'loading',
    failed: status === 'fallback',
    retry: () => void refetch(),
  };
}
/** Entry points (Home card, profile row) show only when the server says assessments are on. */
export function useTestsEnabled(): boolean {
  return useTestsFeatures().assessments;
}

/* ------------------------------------------------------------ error helpers */
export const errCode = (e: unknown): string => (e instanceof ApiError ? e.code : '');
export const isNetworkErr = (e: unknown): boolean => e instanceof ApiError && e.isNetwork;
/** 503 CODE_EXECUTION_UNAVAILABLE: judge not reachable; submissions are stored and evaluated later. */
export const isCodeUnavailable = (e: unknown): boolean => e instanceof ApiError && (e.code === 'CODE_EXECUTION_UNAVAILABLE' || e.status === 503);
/** Submission stored by the server when the judge was unreachable (503 body: `submission: {id, status: 'pending_judge'}`). */
export const pendingSubmissionOf = (e: unknown): { id: string; status: string } | null => {
  if (!(e instanceof ApiError) || !e.body || typeof e.body !== 'object') return null;
  const s = (e.body as { submission?: { id?: unknown; status?: unknown } }).submission;
  return s && typeof s.id === 'string' ? { id: s.id, status: typeof s.status === 'string' ? s.status : 'pending_judge' } : null;
};
export const isAttemptOver = (e: unknown): boolean =>
  e instanceof ApiError && (e.code === 'DEADLINE_PASSED' || e.code === 'ATTEMPT_ALREADY_SUBMITTED');

/* ------------------------------------------------------------ my tests */
export function useMyAssessments(bucket: Bucket | 'all' = 'all', enabled = true) {
  return useInfiniteQuery({
    queryKey: tk.mine(bucket),
    queryFn: ({ pageParam }) =>
      api.get<Page<MyAssessmentItem>>(`/my/assessments${qs({ bucket, cursor: pageParam, limit: 30 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
  });
}
export function useMyAssessment(id?: string) {
  return useQuery({
    queryKey: tk.detail(id),
    queryFn: () => api.get<MyAssessmentResponse>(`/my/assessments/${id}`),
    enabled: !!id,
    staleTime: 0,
  });
}
export function startAttempt(assessmentId: string) {
  return api.post<AttemptState & { resumed: boolean }>(`/my/assessments/${assessmentId}/start`, {}, { timeoutMs: 25_000 });
}
export function useStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assessmentId: string) => startAttempt(assessmentId),
    onSuccess: (state) => {
      qc.setQueryData(tk.attempt(state.attempt.id), state);
      void qc.invalidateQueries({ queryKey: tk.all });
    },
  });
}

/* ------------------------------------------------------------ attempt calls */
export const fetchAttempt = (id: string) => api.get<AttemptState>(`/attempts/${id}`, { timeoutMs: 20_000 });
export const putAnswers = (id: string, answers: AnswerItem[]) =>
  api.put<SaveAnswersResponse>(`/attempts/${id}/answers`, { answers }, { timeoutMs: 20_000 });
export const enterSection = (id: string, sectionId: string) =>
  api.post<EnterSectionResponse>(`/attempts/${id}/sections/${sectionId}/enter`, {});
export const postEvents = (id: string, events: ProctorEvent[]) => api.post<EventsResponse>(`/attempts/${id}/events`, { events }, { timeoutMs: 10_000 });
export const submitAttempt = (id: string, answers?: AnswerItem[]) =>
  api.post<SubmitResponse>(`/attempts/${id}/submit`, answers && answers.length ? { answers } : {}, { timeoutMs: 30_000 });
export const runAttemptCode = (id: string, body: { questionId: string; language: string; code: string; stdin?: string }) =>
  api.post<RunResponse>(`/attempts/${id}/run`, body, { timeoutMs: 40_000 });
export const submitAttemptCode = (id: string, qid: string, body: { language: string; code: string }) =>
  api.post<SubmitCodeResponse>(`/attempts/${id}/questions/${qid}/submit-code`, body, { timeoutMs: 60_000 });
export const fetchResult = (id: string) => api.get<ResultResponse>(`/attempts/${id}/result`);

export function useResult(attemptId?: string) {
  return useQuery({
    queryKey: tk.result(attemptId),
    queryFn: () => fetchResult(attemptId as string),
    enabled: !!attemptId,
    staleTime: 0,
    // Evaluation (coding judging) finishes in the background: poll gently until it does.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (!d.available) return d.reason === 'EVALUATION_PENDING' ? 4000 : false;
      return d.result.evaluation === 'pending' ? 4000 : false;
    },
    retry: (c, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && c < 2,
  });
}

/* ------------------------------------------------------------ practice */
export interface ProblemFilters { q?: string; difficulty?: string; status?: string }
export function usePracticeProblems(f: ProblemFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: tk.problems(f),
    queryFn: ({ pageParam }) => api.get<Page<PracticeProblemItem>>(`/practice/problems${qs({ ...f, cursor: pageParam, limit: 30 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
    // keep the list (and the search box in its header) mounted while a new search or filter loads, otherwise typing loses focus
    placeholderData: keepPreviousData,
  });
}
export function usePracticeProblem(id?: string) {
  return useQuery({
    queryKey: tk.problem(id),
    queryFn: async () => (await api.get<{ problem: PracticeProblem }>(`/practice/problems/${id}`)).problem,
    enabled: !!id,
    staleTime: 0,
  });
}
export function usePracticeSets(enabled = true) {
  return useQuery({
    queryKey: tk.practiceSets,
    queryFn: async () => (await api.get<{ items: PracticeAssessmentItem[] }>('/practice/assessments')).items,
    enabled,
    staleTime: 15_000,
  });
}
export const runPracticeCode = (id: string, body: { language: string; code: string; stdin?: string }) =>
  api.post<RunResponse>(`/practice/problems/${id}/run`, body, { timeoutMs: 40_000 });
export const submitPracticeCode = (id: string, body: { language: string; code: string }) =>
  api.post<SubmitCodeResponse>(`/practice/problems/${id}/submit`, body, { timeoutMs: 60_000 });

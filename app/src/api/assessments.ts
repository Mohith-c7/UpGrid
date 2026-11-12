import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api, apiGetText } from './client';
import type {
  Analytics, AnswerSheet, Assessment, AssessmentPreview, AssessmentSummary, AssessmentWrite, AudiencePreview, ImportResult, Page,
  Plagiarism, PublishResult, Question, QuestionFilters, QuestionSummary, QuestionWrite, ResultsFilters, ResultsPage, ShortlistBody, ShortlistResult,
} from './assessmentsTypes';

export * from './assessmentsTypes';

const qs = (o: Record<string, unknown>): string => {
  const parts = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

/** Root key for every cache entry in this module. */
export const AK = 'assess';

export function useInvalidateAssessments() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [AK] });
}

export const flattenPages = <T,>(d?: InfiniteData<Page<T>>): T[] => (d ? d.pages.flatMap((p) => p.items) : []);

/** Drop repeated ids (cursor pages can overlap after edits). */
export function uniqueById<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => { if (!x.id) return true; if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}

/* ---------------- question bank ---------------- */
export const questionListPath = (f: QuestionFilters, cursor?: string, limit = 20) =>
  `/assessment-questions${qs({ q: f.q, type: f.type, difficulty: f.difficulty, topic: f.topic, tag: f.tag, status: f.status ?? 'active', practice: f.practice, cursor, limit })}`;

export const useQuestions = (f: QuestionFilters, enabled = true) =>
  useInfiniteQuery({
    queryKey: [AK, 'questions', f],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<QuestionSummary>>(questionListPath(f, pageParam)),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useQuestion = (id?: string) =>
  useQuery({
    queryKey: [AK, 'question', id],
    enabled: !!id && id !== 'new',
    queryFn: async () => (await api.get<{ question: Question }>(`/assessment-questions/${id}`)).question,
  });

export function useSaveQuestion() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (v: { id?: string; body: QuestionWrite }) => {
      const r = v.id
        ? await api.put<{ question: Question }>(`/assessment-questions/${v.id}`, v.body)
        : await api.post<{ question: Question }>('/assessment-questions', v.body);
      return r.question;
    },
    onSuccess: () => { void inv(); },
  });
}

export function useQuestionAction() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (v: { id: string; action: 'archive' | 'unarchive' | 'duplicate' | 'delete' }) => {
      if (v.action === 'delete') { await api.delete(`/assessment-questions/${v.id}`); return undefined; }
      return (await api.post<{ question: Question }>(`/assessment-questions/${v.id}/${v.action}`)).question;
    },
    onSuccess: () => { void inv(); },
  });
}

export type ImportPayload = { format: 'json'; rows: unknown[] } | { format: 'csv'; csv: string };
export function useImportQuestions() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { payload: ImportPayload; dryRun: boolean }) =>
      api.post<ImportResult>('/assessment-questions/import', { ...v.payload, dryRun: v.dryRun }, { timeoutMs: 45000 }),
    onSuccess: (_r, v) => { if (!v.dryRun) void inv(); },
  });
}

/* ---------------- assessments ---------------- */
export interface AssessmentFilters { status?: string; practice?: boolean; q?: string }
export const useAssessments = (f: AssessmentFilters) =>
  useInfiniteQuery({
    queryKey: [AK, 'list', f],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<AssessmentSummary>>(`/assessments${qs({ status: f.status, practice: f.practice, q: f.q, cursor: pageParam, limit: 20 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useAssessment = (id?: string) =>
  useQuery({
    queryKey: [AK, 'one', id],
    enabled: !!id && id !== 'new',
    queryFn: async () => (await api.get<{ assessment: Assessment }>(`/assessments/${id}`)).assessment,
  });

export function useSaveAssessment() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (v: { id?: string; body: Partial<AssessmentWrite> }) => {
      const r = v.id
        ? await api.put<{ assessment: Assessment }>(`/assessments/${v.id}`, v.body)
        : await api.post<{ assessment: Assessment }>('/assessments', v.body);
      return r.assessment;
    },
    onSuccess: () => { void inv(); },
  });
}

export function usePublishAssessment() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (id: string) => api.post<PublishResult>(`/assessments/${id}/publish`),
    onSuccess: () => { void inv(); },
  });
}
export function useArchiveAssessment() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ assessment: Assessment }>(`/assessments/${id}/archive`)).assessment,
    onSuccess: () => { void inv(); },
  });
}
export function useCloneAssessment() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ assessment: Assessment }>(`/assessments/${id}/clone`)).assessment,
    onSuccess: () => { void inv(); },
  });
}

export const useAssessmentPreview = (id?: string, seed?: number) =>
  useQuery({
    queryKey: [AK, 'preview', id, seed ?? 0],
    enabled: !!id,
    staleTime: 0,
    queryFn: () => api.get<AssessmentPreview>(`/assessments/${id}/preview${qs({ seed })}`),
  });

export const fetchAudience = (id: string) => api.get<AudiencePreview>(`/assessments/${id}/audience`);
export function useRefreshAudience() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (id: string) => api.post<{ added: number; audienceCount: number }>(`/assessments/${id}/audience/refresh`),
    onSuccess: () => { void inv(); },
  });
}

export function useFixKey() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { id: string; aqId: string; body: { reason: string; answer?: unknown; marks?: number; negativeMarks?: number; explanation?: string } }) =>
      api.put<{ assessment: Assessment; needsRegrade: boolean }>(`/assessments/${v.id}/questions/${v.aqId}/key`, v.body),
    onSuccess: () => { void inv(); },
  });
}
export function useRegrade() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { id: string; reason: string; rejudge?: boolean }) =>
      api.post<{ regraded: number; changed: number; rejudgeQueued: number }>(`/assessments/${v.id}/regrade`, { reason: v.reason, rejudge: v.rejudge || undefined }, { timeoutMs: 60000 }),
    onSuccess: () => { void inv(); },
  });
}

/* ---------------- results ---------------- */
export const useResults = (id: string | undefined, f: ResultsFilters) =>
  useInfiniteQuery({
    queryKey: [AK, 'results', id, f],
    enabled: !!id,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<ResultsPage>(`/assessments/${id}/results${qs({ q: f.q, status: f.status, passed: f.passed, flagged: f.flagged, sort: f.sort, cursor: pageParam, limit: 30 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useAnalytics = (id?: string) =>
  useQuery({ queryKey: [AK, 'analytics', id], enabled: !!id, queryFn: () => api.get<Analytics>(`/assessments/${id}/analytics`) });

export const usePlagiarism = (id: string | undefined, threshold: number) =>
  useQuery({ queryKey: [AK, 'plagiarism', id, threshold], enabled: !!id, queryFn: () => api.get<Plagiarism>(`/assessments/${id}/plagiarism${qs({ threshold })}`) });

export const useAnswerSheet = (id?: string, attemptId?: string) =>
  useQuery({ queryKey: [AK, 'sheet', id, attemptId], enabled: !!id && !!attemptId, queryFn: () => api.get<AnswerSheet>(`/assessments/${id}/attempts/${attemptId}`) });

export function useOverride() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { id: string; attemptId: string; score: number | null; reason: string }) =>
      api.put(`/assessments/${v.id}/attempts/${v.attemptId}/override`, { score: v.score, reason: v.reason }),
    onSuccess: () => { void inv(); },
  });
}

export function usePublishResults() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { id: string; publish: boolean }) =>
      api.post<{ released: boolean; resultsPublishedAt: string | null; notified?: number; alreadyPublished?: boolean }>(`/assessments/${v.id}/results/${v.publish ? 'publish' : 'unpublish'}`),
    onSuccess: () => { void inv(); },
  });
}

export const fetchResultsCsv = (id: string) => apiGetText(`/assessments/${id}/results/export`, 'text/csv', 60000);

export function useShortlist() {
  const inv = useInvalidateAssessments();
  return useMutation({
    mutationFn: (v: { id: string; body: ShortlistBody }) => api.post<ShortlistResult>(`/assessments/${v.id}/shortlist`, v.body, { timeoutMs: 45000 }),
    onSuccess: (_r, v) => { if (!v.body.dryRun) void inv(); },
  });
}

/**
 * AI API client + TanStack hooks (server/docs/ai-api.md). All AI calls live here so shared api files stay untouched.
 * Every mutation resolves with the server payload and rejects with ApiError; use `aiErrorInfo(e)` to render it.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { fetch as streamFetch } from 'expo/fetch';
import { api, ApiError, API_URL } from './client';
import { session } from '@/state/session';
import type {
  AiConsent, AiDeleteResult, AiQuota, AiPage, AiStatus, AiUsage, AnnouncementDraftRequest, AnnouncementDraftResult, CandidateSummaryResult,
  ChatRequest, ChatResult, ConversationDetail, ConversationSummary, InterviewQuestionsRequest, McqDraft, McqGenerateRequest,
  McqImportResult, MockAnswerResult, MockDetail, MockFinishResult, MockHistoryItem, MockStartRequest, MockStartResult,
  QuestionItem, QuestionSet, ResumeReviewRequest, ResumeReviewResult, SuggestedPrompt,
} from './aiTypes';

export const aiKeys = {
  all: ['ai'] as const,
  status: ['ai', 'status'] as const,
  usage: ['ai', 'usage'] as const,
  prompts: (driveId?: string) => ['ai', 'prompts', driveId ?? ''] as const,
  conversations: ['ai', 'conversations'] as const,
  conversation: (id?: string) => ['ai', 'conversation', id ?? ''] as const,
  mocks: ['ai', 'mocks'] as const,
  mock: (id?: string) => ['ai', 'mock', id ?? ''] as const,
};

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

/* ------------------------------------------------------------------ error classification */
export type AiErrorKind =
  | 'not_configured' | 'disabled' | 'consent' | 'quota' | 'rate' | 'rejected' | 'bad_output' | 'upstream' | 'timeout' | 'offline'
  | 'resume_unreadable' | 'candidate_consent' | 'other';

export function aiErrorKind(e: unknown): AiErrorKind {
  if (!(e instanceof ApiError)) return 'other';
  switch (e.code) {
    case 'AI_NOT_CONFIGURED': return 'not_configured';
    case 'AI_DISABLED': return 'disabled';
    case 'AI_CONSENT_REQUIRED': return 'consent';
    case 'AI_QUOTA_EXCEEDED': return 'quota';
    case 'AI_RATE_LIMITED': return 'rate';
    case 'AI_REQUEST_REJECTED': return 'rejected';
    case 'AI_BAD_OUTPUT': return 'bad_output';
    case 'AI_UPSTREAM_ERROR': return 'upstream';
    case 'AI_TIMEOUT': return 'timeout';
    case 'RESUME_NOT_READABLE': case 'RESUME_TOO_LARGE': case 'RESUME_UNSUPPORTED_TYPE': case 'RESUME_EMPTY': return 'resume_unreadable';
    case 'CANDIDATE_NO_AI_CONSENT': return 'candidate_consent';
    default: return e.isNetwork ? 'offline' : 'other';
  }
}

export interface AiErrorInfo { kind: AiErrorKind; title: string; message: string; retryable: boolean }

export function aiErrorInfo(e: unknown): AiErrorInfo {
  const kind = aiErrorKind(e);
  const server = e instanceof ApiError ? e.message : '';
  switch (kind) {
    case 'not_configured':
      return { kind, title: 'AI is not set up yet', message: 'The AI features have not been switched on for this app yet. Everything else works as usual.', retryable: false };
    case 'disabled':
      return { kind, title: 'AI is turned off', message: 'The placement team has paused the AI features for now. Please check back later.', retryable: false };
    case 'consent':
      return { kind, title: 'Turn on AI personalisation', message: 'This needs your permission to use your profile details. You can turn it on or off any time.', retryable: false };
    case 'quota':
      return { kind, title: 'Daily AI limit reached', message: 'You have used all of today\'s AI requests. The limit resets at 5:30 AM IST.', retryable: false };
    case 'rate':
      return { kind, title: 'Slow down a little', message: 'You are sending requests too quickly. Wait a minute and try again.', retryable: true };
    case 'rejected':
      return { kind, title: 'Request not allowed', message: server || 'That request cannot be handled. Please rephrase it.', retryable: false };
    case 'bad_output':
      return { kind, title: 'The answer was unusable', message: 'The AI returned something we could not use. Try again.', retryable: true };
    case 'upstream':
      return { kind, title: 'AI service problem', message: 'The AI service had a problem. Try again shortly.', retryable: true };
    case 'timeout':
      return { kind, title: 'The AI took too long', message: 'It did not answer in time. Try again.', retryable: true };
    case 'offline':
      return { kind, title: 'No connection', message: server || 'Check your connection and try again.', retryable: true };
    case 'resume_unreadable':
      return { kind, title: 'Could not read that resume', message: server || 'Paste your resume text instead.', retryable: false };
    case 'candidate_consent':
      return { kind, title: 'Candidate has not opted in', message: 'This candidate has not turned on AI assistance, so AI tools cannot be used on their application.', retryable: false };
    default:
      return { kind, title: 'Something went wrong', message: server || 'Please try again.', retryable: true };
  }
}

/** True when the failure means "this feature is unavailable", so the screen should show a state instead of a toast. */
export const isBlockingAiError = (e: unknown) => ['not_configured', 'disabled'].includes(aiErrorKind(e));

/* ------------------------------------------------------------------ status, consent, usage */
export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: aiKeys.status,
    queryFn: () => api.get<AiStatus>('/ai/status'),
    enabled,
    staleTime: 20_000,
    retry: (c, err) => !(err instanceof ApiError && err.status < 500 && err.status !== 0) && c < 1,
  });
}
export function useAiUsage(enabled = true) {
  return useQuery({ queryKey: aiKeys.usage, queryFn: () => api.get<AiUsage>('/ai/usage'), enabled, staleTime: 20_000 });
}

function useRefreshQuota() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: aiKeys.status });
    void qc.invalidateQueries({ queryKey: aiKeys.usage });
  };
}

export function useSetAiConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { granted: boolean; deleteData?: boolean }) => api.put<AiConsent>('/ai/consent', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.all });
    },
  });
}
export function useDeleteAiData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<AiDeleteResult>('/ai/data'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.all });
    },
  });
}

/* ------------------------------------------------------------------ chat */
export function useSuggestedPrompts(driveId?: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.prompts(driveId),
    queryFn: async () => (await api.get<{ items: SuggestedPrompt[] }>(`/ai/suggested-prompts${qs({ driveId })}`)).items,
    enabled,
    staleTime: 60_000,
  });
}
export function useConversations(enabled = true) {
  return useInfiniteQuery({
    queryKey: aiKeys.conversations,
    queryFn: ({ pageParam }) => api.get<AiPage<ConversationSummary>>(`/ai/conversations${qs({ cursor: pageParam, limit: 20 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}
export function flattenPages<T>(data?: InfiniteData<AiPage<T>>): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}
export function useConversation(id?: string) {
  return useQuery({
    queryKey: aiKeys.conversation(id),
    queryFn: () => api.get<ConversationDetail>(`/ai/conversations/${id}`),
    enabled: !!id,
    staleTime: 0,
  });
}
export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/ai/conversations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.conversations }),
  });
}

/** Non-streaming chat turn (JSON fallback). */
export function chatOnce(body: ChatRequest): Promise<ChatResult> {
  return api.post<ChatResult>('/ai/chat', body, { timeoutMs: 40_000 });
}

export interface StreamHandlers {
  onMeta?: (m: { conversationId: string; userMessageId: string }) => void;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

interface SseEvent { event: string; data: string }
function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

async function errorFromResponse(res: { status: number; text: () => Promise<string> }): Promise<ApiError> {
  let parsed: { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null = null;
  try { parsed = JSON.parse(await res.text()); } catch { parsed = null; }
  const e = parsed?.error;
  return new ApiError(e?.message ?? (res.status === 429 ? 'Too many requests. Please wait and try again.' : 'Request failed.'), e?.code ?? `HTTP_${res.status}`, res.status, e?.fields);
}

/**
 * Stream a chat turn over SSE (expo/fetch supports ReadableStream bodies). Falls back to a single JSON call when the runtime
 * has no TextDecoder / readable body. Resolves with the final `done` payload; callers must replace streamed text with it.
 */
export async function streamChat(body: ChatRequest, h: StreamHandlers = {}): Promise<ChatResult> {
  if (typeof TextDecoder === 'undefined') return chatOnce(body);
  // A stalled connection (no bytes at all) must end by itself instead of leaving "Thinking..." on screen forever.
  const IDLE_MS = 45_000;
  const ctl = new AbortController();
  let idled = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const poke = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idled = true; ctl.abort(); }, IDLE_MS);
  };
  const onUserAbort = () => ctl.abort();
  if (h.signal?.aborted) ctl.abort();
  else h.signal?.addEventListener('abort', onUserAbort);
  const timeoutError = () => new ApiError('The AI did not answer in time. Try again.', 'AI_TIMEOUT', 504);
  try {
    poke();
    return await streamChatInner(body, h, ctl.signal, poke);
  } catch (e) {
    if (idled && !h.signal?.aborted) throw timeoutError();
    throw e;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    h.signal?.removeEventListener('abort', onUserAbort);
  }
}

async function streamChatInner(body: ChatRequest, h: StreamHandlers, signal: AbortSignal, poke: () => void): Promise<ChatResult> {
  const attempt = async (token: string | null) => {
    try {
      return await streamFetch(`${API_URL}/ai/chat?stream=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ApiError('Could not reach the server. Check your connection and try again.', 'NETWORK', 0, undefined, true);
    }
  };
  let res = await attempt(session.getAccessToken());
  if (res.status === 401 && session.getRefreshToken()) {
    try { await api.get('/ai/status'); } catch { /* refresh attempted; fall through */ }
    res = await attempt(session.getAccessToken());
  }
  if (!res.ok) throw await errorFromResponse(res);
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) return JSON.parse(await res.text()) as ChatResult;

  let final: ChatResult | null = null;
  const handle = (ev: SseEvent) => {
    let payload: any;
    try { payload = JSON.parse(ev.data); } catch { return; }
    if (ev.event === 'meta') h.onMeta?.(payload);
    else if (ev.event === 'delta') h.onDelta?.(String(payload.text ?? ''));
    else if (ev.event === 'done') final = { ...payload, conversationId: payload.conversationId ?? payload.message?.conversationId };
    else if (ev.event === 'error') throw new ApiError(payload.message ?? 'The AI could not finish.', payload.code ?? 'AI_UPSTREAM_ERROR', 502);
  };
  const feed = (buf: string, flush: boolean): string => {
    const norm = buf.replace(/\r\n/g, '\n');
    const parts = norm.split('\n\n');
    const rest = flush ? '' : (parts.pop() ?? '');
    for (const p of flush ? parts : parts) {
      const ev = parseSseBlock(p);
      if (ev) handle(ev);
    }
    return rest;
  };

  const reader = res.body?.getReader();
  let buffer = '';
  if (!reader) {
    feed(await res.text(), true);
  } else {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        poke();
        buffer += dec.decode(value, { stream: true });
        buffer = feed(buffer, false);
      }
      buffer += dec.decode();
      feed(buffer, true);
    } catch (e) {
      if (e instanceof ApiError || signal.aborted) throw e;
      throw new ApiError('The connection dropped before the answer finished. Try again.', 'NETWORK', 0, undefined, true);
    }
  }
  if (!final) throw new ApiError('The answer did not finish. Try again.', 'AI_UPSTREAM_ERROR', 502);
  return final;
}

/* ------------------------------------------------------------------ resume review */
export function useResumeReview() {
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: ResumeReviewRequest) => api.post<ResumeReviewResult>('/ai/resume/review', v, { timeoutMs: 45_000 }),
    onSettled: refresh,
  });
}

/* ------------------------------------------------------------------ mock interview */
export function useStartMock() {
  const qc = useQueryClient();
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: MockStartRequest) => api.post<MockStartResult>('/ai/mock-interview/start', v, { timeoutMs: 45_000 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.mocks }),
    onSettled: refresh,
  });
}
export function useAnswerMock(id: string) {
  const qc = useQueryClient();
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: { answer: string; questionIndex?: number }) => api.post<MockAnswerResult>(`/ai/mock-interview/${id}/answer`, v, { timeoutMs: 45_000 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.mock(id) }),
    onSettled: refresh,
  });
}
export function useFinishMock(id: string) {
  const qc = useQueryClient();
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: () => api.post<MockFinishResult>(`/ai/mock-interview/${id}/finish`, {}, { timeoutMs: 45_000 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.mock(id) });
      void qc.invalidateQueries({ queryKey: aiKeys.mocks });
    },
    onSettled: refresh,
  });
}
export function useMockHistory(enabled = true) {
  return useInfiniteQuery({
    queryKey: aiKeys.mocks,
    queryFn: ({ pageParam }) => api.get<AiPage<MockHistoryItem>>(`/ai/mock-interview${qs({ cursor: pageParam, limit: 20 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}
export function useMockDetail(id?: string) {
  return useQuery({ queryKey: aiKeys.mock(id), queryFn: () => api.get<MockDetail>(`/ai/mock-interview/${id}`), enabled: !!id, staleTime: 0 });
}
export function useDeleteMock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/ai/mock-interview/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.mocks }),
  });
}

/* ------------------------------------------------------------------ staff tools (officer / recruiter) */
export function useGenerateQuestions() {
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: InterviewQuestionsRequest) =>
      api.post<{ questionSet: QuestionSet; quota?: AiQuota }>('/ai/interview-questions', v, { timeoutMs: 60_000 }),
    onSettled: refresh,
  });
}
export function useQuestionSets(applicationId?: string, status?: QuestionSet['status']) {
  return useQuery({
    queryKey: ['ai', 'question-sets', applicationId ?? '', status ?? ''],
    queryFn: async () => (await api.get<AiPage<QuestionSet>>(`/ai/question-sets${qs({ applicationId, status, limit: 20 })}`)).items,
    enabled: !!applicationId,
  });
}
export function useUpdateQuestionSet() {
  return useMutation({
    mutationFn: (v: { id: string; questions: QuestionItem[] }) =>
      api.patch<{ questionSet: QuestionSet }>(`/ai/question-sets/${v.id}`, { questions: v.questions }),
  });
}
export function useApproveQuestionSet() {
  return useMutation({ mutationFn: (id: string) => api.post<{ questionSet: QuestionSet }>(`/ai/question-sets/${id}/approve`, {}) });
}
export function useDiscardQuestionSet() {
  return useMutation({ mutationFn: (id: string) => api.post<{ questionSet: QuestionSet }>(`/ai/question-sets/${id}/discard`, {}) });
}
export function useCandidateSummary() {
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: { applicationId: string; resumeText?: string }) =>
      api.post<CandidateSummaryResult>('/ai/candidate-summary', v, { timeoutMs: 45_000 }),
    onSettled: refresh,
  });
}
export function useAnnouncementDraft() {
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: AnnouncementDraftRequest) => api.post<AnnouncementDraftResult>('/ai/announcement/draft', v, { timeoutMs: 45_000 }),
    onSettled: refresh,
  });
}
export function useGenerateMcqs() {
  const refresh = useRefreshQuota();
  return useMutation({
    mutationFn: (v: McqGenerateRequest) => api.post<{ items: McqDraft[]; quota?: AiQuota }>('/ai/mcq/generate', v, { timeoutMs: 60_000 }),
    onSettled: refresh,
  });
}
export function useUpdateMcqDraft() {
  return useMutation({
    mutationFn: (v: { id: string; stem?: string; options?: string[]; correctIndex?: number; explanation?: string; tags?: string[] }) => {
      const { id, ...patch } = v;
      return api.patch<{ draft?: McqDraft } & Partial<McqDraft>>(`/ai/mcq/drafts/${id}`, patch);
    },
  });
}
export function useDiscardMcqDraft() {
  return useMutation({ mutationFn: (id: string) => api.post<unknown>(`/ai/mcq/drafts/${id}/discard`, {}) });
}
export function useImportMcqDrafts() {
  return useMutation({ mutationFn: (ids: string[]) => api.post<McqImportResult>('/ai/mcq/import', { ids }) });
}

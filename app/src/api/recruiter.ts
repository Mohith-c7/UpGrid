/**
 * Recruiter + pipeline API client and TanStack hooks (server/docs/pipeline-api.md).
 * Every mutation resolves with the server payload and rejects with ApiError.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { session } from '@/state/session';
import { newIdempotencyKey } from '@/lib/idempotency';
import type {
  AttendanceToken, BulkResult, CandidateDetail, CandidatePage, CandidateQuery, Decision, InviteInfo, Message, Note, Offer, OfferCtc, Outcome,
  Paged, PolicyResult, RecruiterAuthResponse, RecruiterDriveDetail, RecruiterDriveItem, RegisterRecruiterBody, Recommendation, Round,
  RoundCandidate, RoundCandidateStatus, Rubric, Scorecard, Slot, SlotInput,
} from './recruiterTypes';

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export const rk = {
  all: ['recruiter'] as const,
  drives: ['recruiter', 'drives'] as const,
  drive: (id?: string) => ['recruiter', 'drive', id ?? ''] as const,
  candidates: (id?: string) => ['recruiter', 'candidates', id ?? ''] as const,
  candidateList: (id: string | undefined, q: object) => ['recruiter', 'candidates', id ?? '', 'list', q] as const,
  candidate: (id?: string, app?: string) => ['recruiter', 'candidate', id ?? '', app ?? ''] as const,
  rubric: (id?: string, round?: string) => ['recruiter', 'rubric', id ?? '', round ?? ''] as const,
  scorecards: (id?: string, app?: string, round?: string) => ['recruiter', 'scorecards', id ?? '', app ?? '', round ?? ''] as const,
  slots: (id?: string) => ['recruiter', 'slots', id ?? ''] as const,
  rounds: (id?: string) => ['recruiter', 'rounds', id ?? ''] as const,
  roundCandidates: (id?: string, round?: string, q?: object) => ['recruiter', 'round-candidates', id ?? '', round ?? '', q ?? {}] as const,
  offers: (id?: string) => ['recruiter', 'offers', id ?? ''] as const,
  messages: (id?: string) => ['recruiter', 'messages', id ?? ''] as const,
};

/* ------------------------------------------------------------------ onboarding (public) */
export async function lookupInvite(inviteToken: string): Promise<InviteInfo> {
  const r = await api.post<{ invite: InviteInfo }>('/auth/recruiter-invite/lookup', { inviteToken }, { auth: false });
  return r.invite;
}

export function useRegisterRecruiter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RegisterRecruiterBody) => {
      const r = await api.post<RecruiterAuthResponse>('/auth/register-recruiter', body, { auth: false });
      qc.clear();
      await session.setAuth({ user: r.user, accessToken: r.accessToken, refreshToken: r.refreshToken });
      return r;
    },
  });
}

/* ------------------------------------------------------------------ drives */
export function useRecruiterDrives() {
  return useInfiniteQuery({
    queryKey: rk.drives,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Paged<RecruiterDriveItem>>(`/recruiter/drives${qs({ cursor: pageParam, limit: 30 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function useRecruiterDrive(id?: string) {
  return useQuery({
    queryKey: rk.drive(id),
    enabled: !!id,
    queryFn: () => api.get<RecruiterDriveDetail>(`/recruiter/drives/${id}`),
  });
}

/* ------------------------------------------------------------------ candidates */
export function useCandidates(driveId: string | undefined, query: CandidateQuery) {
  return useInfiniteQuery({
    queryKey: rk.candidateList(driveId, query),
    enabled: !!driveId,
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<CandidatePage>(`/pipeline/drives/${driveId}/candidates${qs({ ...query, cursor: pageParam, limit: 30 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function useCandidate(driveId?: string, appId?: string) {
  return useQuery({
    queryKey: rk.candidate(driveId, appId),
    enabled: !!driveId && !!appId,
    queryFn: async () => (await api.get<{ candidate: CandidateDetail }>(`/pipeline/drives/${driveId}/candidates/${appId}`)).candidate,
  });
}

/** Signed URLs live 300 s: always fetch fresh at tap time, never cache. */
export async function fetchResumeUrl(driveId: string, appId: string) {
  return api.get<{ url: string; signed: boolean; expiresAt?: string | null }>(`/pipeline/drives/${driveId}/candidates/${appId}/resume`);
}

function useInvalidateCandidates(driveId?: string) {
  const qc = useQueryClient();
  return async (appId?: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: rk.candidates(driveId) }),
      qc.invalidateQueries({ queryKey: rk.drive(driveId) }),
      qc.invalidateQueries({ queryKey: rk.drives }),
      appId ? qc.invalidateQueries({ queryKey: rk.candidate(driveId, appId) }) : Promise.resolve(),
    ]);
  };
}

export function useDecision(driveId?: string) {
  const inv = useInvalidateCandidates(driveId);
  return useMutation({
    mutationFn: (v: { applicationId: string; decision: Decision | 'clear'; reason?: string }) =>
      api.post<{ decision: Decision | null; reason?: string | null }>(`/pipeline/drives/${driveId}/candidates/${v.applicationId}/decision`, { decision: v.decision, reason: v.reason }),
    onSuccess: (_r, v) => inv(v.applicationId),
  });
}

export function useBulkDecision(driveId?: string) {
  const inv = useInvalidateCandidates(driveId);
  return useMutation({
    mutationFn: (v: { applicationIds: string[]; decision: Decision; reason?: string }) =>
      api.post<{ updated: number; failed: { applicationId: string; reason: string }[] }>(`/pipeline/drives/${driveId}/candidates/bulk-decision`, v),
    onSuccess: () => inv(),
  });
}

export function useAddNote(driveId?: string, appId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { body: string; visibility: 'team' | 'private' }) =>
      (await api.post<{ note: Note }>(`/pipeline/drives/${driveId}/candidates/${appId}/notes`, v)).note,
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.candidate(driveId, appId) }),
  });
}
export function useDeleteNote(driveId?: string, appId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.delete<{ ok: boolean }>(`/pipeline/drives/${driveId}/candidates/${appId}/notes/${noteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.candidate(driveId, appId) }),
  });
}

/* ------------------------------------------------------------------ rubric + scorecards */
export function useRubric(driveId?: string, roundId?: string) {
  return useQuery({
    queryKey: rk.rubric(driveId, roundId),
    enabled: !!driveId && !!roundId,
    queryFn: async () => (await api.get<{ rubric: Rubric | null }>(`/pipeline/drives/${driveId}/rubric${qs({ roundId })}`)).rubric,
  });
}

export function useScorecards(driveId?: string, appId?: string, roundId?: string) {
  return useQuery({
    queryKey: rk.scorecards(driveId, appId, roundId),
    enabled: !!driveId && !!appId && !!roundId,
    queryFn: () => api.get<{ items: Scorecard[]; hiddenCount: number }>(`/pipeline/drives/${driveId}/candidates/${appId}/scorecards${qs({ roundId })}`),
  });
}

export function useSubmitScorecard(driveId?: string, appId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { roundId: string; ratings: { itemId: string; rating: number }[]; comments?: string; recommendation: Recommendation }) => {
      const { roundId, ...body } = v;
      return (await api.put<{ scorecard: Scorecard }>(`/pipeline/drives/${driveId}/candidates/${appId}/scorecards/${roundId}`, body)).scorecard;
    },
    onSuccess: async (_s, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: rk.scorecards(driveId, appId, v.roundId) }),
        qc.invalidateQueries({ queryKey: rk.candidate(driveId, appId) }),
        qc.invalidateQueries({ queryKey: rk.candidates(driveId) }),
      ]);
    },
  });
}

/* ------------------------------------------------------------------ outcomes */
export function useProposeOutcome(driveId?: string, appId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { kind: 'select' | 'reject'; reason?: string; note?: string }) =>
      (await api.post<{ outcome: Outcome }>(`/pipeline/drives/${driveId}/candidates/${appId}/outcomes`, v)).outcome,
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.candidate(driveId, appId) }),
  });
}

/* ------------------------------------------------------------------ interview slots */
export function useSlots(driveId?: string) {
  return useQuery({
    queryKey: rk.slots(driveId),
    enabled: !!driveId,
    queryFn: async () => (await api.get<Paged<Slot>>(`/pipeline/drives/${driveId}/slots?limit=50`)).items,
  });
}
export function useCreateSlots(driveId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { roundId: string; slots: SlotInput[] }) =>
      (await api.post<{ items: Slot[] }>(`/pipeline/drives/${driveId}/rounds/${v.roundId}/slots`, { slots: v.slots })).items,
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.slots(driveId) }),
  });
}
/** Officer-only on the server; recruiters never see this action. */
export function useApproveSlot(driveId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ slot: Slot }>(`/pipeline/slots/${id}/approve`)).slot,
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.slots(driveId) }),
  });
}
export function useCancelSlot(driveId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.post<{ slot: Slot; cancelledBookings: number }>(`/pipeline/slots/${v.id}/cancel`, { reason: v.reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.slots(driveId) }),
  });
}

/* ------------------------------------------------------------------ rounds + attendance */
export function useRounds(driveId?: string) {
  return useQuery({
    queryKey: rk.rounds(driveId),
    enabled: !!driveId,
    queryFn: async () => (await api.get<{ items: Round[] }>(`/pipeline/drives/${driveId}/rounds`)).items,
  });
}
export function useRoundCandidates(driveId?: string, roundId?: string, status?: string) {
  return useInfiniteQuery({
    queryKey: rk.roundCandidates(driveId, roundId, { status }),
    enabled: !!driveId && !!roundId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paged<RoundCandidate> & { counts?: Record<string, number> }>(`/pipeline/drives/${driveId}/rounds/${roundId}/candidates${qs({ status, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}
function useInvalidateRounds(driveId?: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['recruiter', 'round-candidates', driveId ?? ''] }),
      qc.invalidateQueries({ queryKey: rk.rounds(driveId) }),
      qc.invalidateQueries({ queryKey: rk.drive(driveId) }),
    ]);
}
export function useMarkAttendance(driveId?: string, roundId?: string) {
  const inv = useInvalidateRounds(driveId);
  return useMutation({
    mutationFn: (marks: { applicationId: string; present: boolean }[]) =>
      api.post<BulkResult>(`/pipeline/drives/${driveId}/rounds/${roundId}/attendance`, { marks }),
    onSuccess: () => inv(),
  });
}
export function useRoundStatus(driveId?: string, roundId?: string) {
  const inv = useInvalidateRounds(driveId);
  return useMutation({
    mutationFn: (updates: { applicationId: string; status: RoundCandidateStatus; remark?: string }[]) =>
      api.post<BulkResult>(`/pipeline/drives/${driveId}/rounds/${roundId}/status`, { updates }),
    onSuccess: () => inv(),
  });
}
export function useAttendanceToken(driveId?: string, roundId?: string) {
  return useMutation({
    mutationFn: (v: { validMinutes?: number } = {}) =>
      api.post<AttendanceToken>(`/pipeline/drives/${driveId}/rounds/${roundId}/attendance-token`, { session: 'default', validMinutes: v.validMinutes ?? 60 }),
  });
}

/* ------------------------------------------------------------------ offers */
export function useOffers(driveId?: string) {
  return useQuery({
    queryKey: rk.offers(driveId),
    enabled: !!driveId,
    queryFn: async () => (await api.get<{ items: Offer[] }>(`/pipeline/drives/${driveId}/offers?limit=50`)).items,
  });
}
export function usePolicyCheck() {
  return useMutation({
    mutationFn: async (v: { applicationId: string; ctc: OfferCtc }) =>
      (await api.post<{ policy: PolicyResult }>('/pipeline/offers/policy-check', v)).policy,
  });
}
export interface OfferInput { ctc: OfferCtc; joiningDate: string; location: string; expiresAt: string; letterUrl?: string; notes?: string }
export function useCreateOffer(driveId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { applicationId: string; body: OfferInput }) =>
      (await api.post<{ offer: Offer }>(`/pipeline/drives/${driveId}/candidates/${v.applicationId}/offers`, v.body)).offer,
    onSuccess: async (_o, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: rk.offers(driveId) }),
        qc.invalidateQueries({ queryKey: rk.candidate(driveId, v.applicationId) }),
        qc.invalidateQueries({ queryKey: rk.drive(driveId) }),
      ]);
    },
  });
}

/* ------------------------------------------------------------------ messages */
export function useMessages(driveId?: string) {
  return useInfiniteQuery({
    queryKey: rk.messages(driveId),
    enabled: !!driveId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Paged<Message>>(`/pipeline/drives/${driveId}/messages${qs({ cursor: pageParam, limit: 30 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
}
export function usePostMessage(driveId?: string) {
  const qc = useQueryClient();
  return useMutation({
    // clientId makes a retried send replay instead of posting twice
    mutationFn: async (v: { body: string; clientId?: string }) =>
      (await api.post<{ message: Message }>(`/pipeline/drives/${driveId}/messages`, { body: v.body, clientId: v.clientId ?? newIdempotencyKey() })).message,
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.messages(driveId) }),
  });
}

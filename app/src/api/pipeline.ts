/** Hiring-pipeline API client + TanStack Query hooks (server/docs/pipeline-api.md). All mutations reject with ApiError. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type {
  AdvanceOptions, AdvancePreview, AdvanceResult, AttendanceToken, Booking, BulkResult, CandidateRow, Funnel, InviteResult, Offer, OfferBody,
  Outcome, PermissionMap, RecruitersResponse, ResultRow, ResultsUploadResult, Round, RoundBody, RoundCandidatesPage, RubricItem,
  RubricResponse, ScanResult, Slot, SlotInput, StudentRound, StudentSlotsResponse,
} from './pipelineTypes';

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

/* ---------------------------------------------------------------- errors */
const FRIENDLY: Record<string, string> = {
  SLOT_FULL: 'This slot has just filled up. Pick another slot.',
  SLOT_NOT_OPEN: 'This slot is no longer open for booking.',
  SLOT_STARTED: 'This slot has already started.',
  SLOT_NOT_FOUND: 'This slot no longer exists. Refresh the list.',
  ALREADY_BOOKED: 'You already have a booking for this round. Cancel it first to choose another slot.',
  CANDIDATE_BUSY: 'This time overlaps another booking or schedule you have. Choose a different time.',
  NOT_IN_ROUND: 'You are not in this round, so you cannot book or change a slot for it.',
  CANCEL_WINDOW_CLOSED: 'It is too close to the start time to cancel here. Contact the placement cell.',
  TOKEN_INVALID: 'This code is not valid. Check it and try again, or ask the organiser for a new code.',
  TOKEN_NOT_STARTED: 'Attendance for this session has not opened yet. Try again at the start time.',
  TOKEN_EXPIRED: 'This attendance code has expired. Ask the organiser for a new one.',
  NOT_SHORTLISTED: 'You are not on the invited list for this round, so attendance cannot be marked.',
  ALREADY_DECIDED: 'Your result for this round is already recorded.',
  OFFER_EXPIRED: 'This offer has expired and can no longer be answered.',
  PANELIST_BUSY: 'A panelist already has another open slot at this time.',
  ROUND_HAS_CANDIDATES: 'This round has candidates, so it cannot be deleted.',
  INVALID_ROUND_TRANSITION: 'That change is not allowed from the candidate\'s current round status.',
  NO_NEXT_ROUND: 'There is no next round to move candidates into.',
  OFFER_BLOCKED_BY_POLICY: 'The placement policy blocks this offer.',
  OVERRIDE_REQUIRED: 'This offer needs an override reason because of the placement policy.',
  NOT_SELECTED: 'The candidate must be in Selected status before an offer can be made.',
  OFFER_EXISTS: 'This candidate already has an open offer.',
  OFFER_NOT_REVOCABLE: 'This offer can no longer be revoked.',
  OFFER_EXPIRED_ON_APPROVAL: 'The offer\'s expiry time has already passed. Create a new offer with a later expiry.',
  OUTCOME_PENDING: 'There is already a pending proposal for this candidate.',
  OUTCOME_DECIDED: 'This proposal was already decided by someone else.',
  ALREADY_MEMBER: 'This recruiter is already a member of the drive.',
  EMAIL_BELONGS_TO_OTHER_ROLE: 'That email belongs to a student or officer account and cannot be invited as a recruiter.',
  DRIVE_CLOSED: 'The drive is closed, so rounds cannot be added.',
};
/** Friendly message for pipeline error codes; falls back to the server message. */
export function pipeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (FRIENDLY[e.code]) return FRIENDLY[e.code];
    if (e.isNetwork) return e.message;
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}
export const pipeCode = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : undefined);
export const isOfflineError = (e: unknown): boolean => e instanceof ApiError && e.isNetwork;

/* ------------------------------------------------------------ query keys */
export const pk = {
  all: ['pipeline'] as const,
  appRounds: (id?: string) => ['pipeline', 'app-rounds', id] as const,
  appSlots: (id?: string) => ['pipeline', 'app-slots', id] as const,
  appOffer: (id?: string) => ['pipeline', 'app-offer', id] as const,
  recruiters: (d?: string, rev?: boolean) => ['pipeline', 'recruiters', d, !!rev] as const,
  rounds: (d?: string) => ['pipeline', 'rounds', d] as const,
  roundCands: (d?: string, r?: string, f?: unknown) => ['pipeline', 'round-cands', d, r, f] as const,
  funnel: (d?: string) => ['pipeline', 'funnel', d] as const,
  rubric: (d?: string, r?: string | null) => ['pipeline', 'rubric', d, r ?? null] as const,
  slots: (d?: string, s?: string) => ['pipeline', 'slots', d, s] as const,
  offers: (d?: string, s?: string) => ['pipeline', 'offers', d, s] as const,
  outcomes: (d?: string, s?: string) => ['pipeline', 'outcomes', d, s] as const,
  cands: (d?: string, s?: string) => ['pipeline', 'cands', d, s] as const,
};

function useInvalidatePipeline() {
  const qc = useQueryClient();
  return (extra?: readonly unknown[][]) =>
    Promise.all([qc.invalidateQueries({ queryKey: pk.all }), ...(extra ?? []).map((k) => qc.invalidateQueries({ queryKey: k }))]);
}

/* ============================================================== STUDENT == */
export const useAppRounds = (appId?: string) =>
  useQuery({ queryKey: pk.appRounds(appId), enabled: !!appId, queryFn: async () => (await api.get<{ items: StudentRound[] }>(`/pipeline/applications/${appId}/rounds`)).items ?? [] });

export const useAppSlots = (appId?: string, enabled = true) =>
  useQuery({ queryKey: pk.appSlots(appId), enabled: !!appId && enabled, staleTime: 0, queryFn: () => api.get<StudentSlotsResponse>(`/pipeline/applications/${appId}/slots`) });

export const useAppOffer = (appId?: string) =>
  useQuery({ queryKey: pk.appOffer(appId), enabled: !!appId, queryFn: async () => (await api.get<{ offer: Offer | null }>(`/pipeline/applications/${appId}/offer`)).offer ?? null });

export function useBookSlot(appId: string) {
  const inv = useInvalidatePipeline();
  return useMutation({
    mutationFn: (slotId: string) => api.post<{ booking: Booking; replayed?: boolean }>(`/pipeline/applications/${appId}/slots/${slotId}/book`, {}),
    onSettled: () => inv([['applications']]),
  });
}
export function useCancelBooking(appId: string) {
  const inv = useInvalidatePipeline();
  return useMutation({
    mutationFn: (v: { roundId: string; reason?: string }) =>
      api.post<{ ok: boolean; cancelled: boolean }>(`/pipeline/applications/${appId}/rounds/${v.roundId}/booking/cancel`, v.reason ? { reason: v.reason } : {}),
    onSettled: () => inv([['applications']]),
  });
}
export function useScanAttendance() {
  const inv = useInvalidatePipeline();
  return useMutation({
    mutationFn: (token: string) => api.post<ScanResult>('/pipeline/attendance/scan', { token }),
    onSuccess: () => { void inv(); },
  });
}

/* ============================================================= RECRUITERS == */
export const useRecruiters = (driveId?: string, includeRevoked = false) =>
  useQuery({
    queryKey: pk.recruiters(driveId, includeRevoked), enabled: !!driveId,
    queryFn: () => api.get<RecruitersResponse>(`/drives/${driveId}/recruiters${qs({ includeRevoked: includeRevoked ? 1 : undefined })}`),
  });
export function useRecruiterActions(driveId: string) {
  const inv = useInvalidatePipeline();
  const done = () => { void inv(); };
  return {
    invite: useMutation({
      mutationFn: (b: { email: string; name?: string; permissions: Partial<PermissionMap> }) => api.post<InviteResult>(`/drives/${driveId}/recruiters`, b),
      onSuccess: done,
    }),
    resend: useMutation({
      mutationFn: (inviteId: string) => api.post<{ inviteToken?: string; emailSent?: boolean }>(`/drives/${driveId}/recruiter-invites/${inviteId}/resend`, {}),
      onSuccess: done,
    }),
    revokeInvite: useMutation({ mutationFn: (inviteId: string) => api.delete<{ ok: boolean }>(`/drives/${driveId}/recruiter-invites/${inviteId}`), onSuccess: done }),
    revokeMember: useMutation({
      mutationFn: (v: { userId: string; reason?: string }) => api.delete<{ ok: boolean }>(`/drives/${driveId}/recruiters/${v.userId}`, v.reason ? { reason: v.reason } : {}),
      onSuccess: done,
    }),
    setPermissions: useMutation({
      mutationFn: (v: { userId: string; permissions: Partial<PermissionMap> }) => api.patch<unknown>(`/drives/${driveId}/recruiters/${v.userId}`, { permissions: v.permissions }),
      onSuccess: done,
    }),
  };
}

/* ================================================================ ROUNDS == */
export const useRounds = (driveId?: string) =>
  useQuery({ queryKey: pk.rounds(driveId), enabled: !!driveId, queryFn: async () => (await api.get<{ items: Round[] }>(`/pipeline/drives/${driveId}/rounds`)).items ?? [] });

export function useRoundActions(driveId: string) {
  const inv = useInvalidatePipeline();
  const done = () => { void inv(); };
  return {
    create: useMutation({ mutationFn: (b: RoundBody) => api.post<{ round: Round }>(`/pipeline/drives/${driveId}/rounds`, b), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: RoundBody }) => api.patch<{ round: Round }>(`/pipeline/drives/${driveId}/rounds/${v.id}`, v.body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/pipeline/drives/${driveId}/rounds/${id}`), onSuccess: done }),
    reorder: useMutation({ mutationFn: (roundIds: string[]) => api.post<{ items: Round[] }>(`/pipeline/drives/${driveId}/rounds/reorder`, { roundIds }), onSettled: done }),
    publish: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; notified: number }>(`/pipeline/drives/${driveId}/rounds/${id}/publish-results`, {}), onSuccess: done }),
  };
}

export const useFunnel = (driveId?: string) =>
  useQuery({ queryKey: pk.funnel(driveId), enabled: !!driveId, queryFn: () => api.get<Funnel>(`/pipeline/drives/${driveId}/funnel`) });

export function useRoundCandidates(driveId?: string, roundId?: string, f: { status?: string; waitlisted?: boolean; q?: string } = {}) {
  return useInfiniteQuery({
    queryKey: pk.roundCands(driveId, roundId, f), enabled: !!driveId && !!roundId, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<RoundCandidatesPage>(`/pipeline/drives/${driveId}/rounds/${roundId}/candidates${qs({ status: f.status, waitlisted: f.waitlisted ? 1 : undefined, q: f.q, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

export function useRoundCandidateActions(driveId: string, roundId: string) {
  const inv = useInvalidatePipeline();
  const base = `/pipeline/drives/${driveId}/rounds/${roundId}`;
  const done = () => { void inv(); };
  return {
    addCandidates: useMutation({ mutationFn: (b: { applicationIds?: string[]; allScreened?: boolean }) => api.post<BulkResult>(`${base}/candidates`, b), onSuccess: done }),
    setStatus: useMutation({ mutationFn: (updates: { applicationId: string; status: string; remark?: string }[]) => api.post<BulkResult>(`${base}/status`, { updates }), onSuccess: done }),
    attendance: useMutation({ mutationFn: (marks: { applicationId: string; present: boolean }[]) => api.post<BulkResult>(`${base}/attendance`, { marks }), onSuccess: done }),
    waitlist: useMutation({ mutationFn: (applicationIds: string[]) => api.post<{ updated: number }>(`${base}/waitlist`, { applicationIds }), onSuccess: done }),
    promote: useMutation({ mutationFn: (applicationIds: string[]) => api.post<{ promoted: number }>(`${base}/promote`, { applicationIds }), onSuccess: done }),
    uploadResults: useMutation({ mutationFn: (rows: ResultRow[]) => api.post<ResultsUploadResult>(`${base}/results`, { rows }), onSuccess: done }),
    advancePreview: useMutation({ mutationFn: (o: AdvanceOptions) => api.post<AdvancePreview>(`${base}/advance/preview`, o) }),
    advance: useMutation({
      mutationFn: (o: AdvanceOptions & { idempotencyKey: string }) => api.post<AdvanceResult>(`${base}/advance`, { ...o, confirm: true }),
      onSuccess: done,
    }),
    createToken: useMutation({
      mutationFn: (b: { session?: string; validMinutes?: number }) => api.post<AttendanceToken>(`${base}/attendance-token`, b),
    }),
    revokeToken: useMutation({ mutationFn: (session: string) => api.delete<{ ok: boolean }>(`${base}/attendance-token/${encodeURIComponent(session)}`) }),
  };
}

/* ================================================================ RUBRIC == */
export const useRubric = (driveId?: string, roundId?: string | null) =>
  useQuery({ queryKey: pk.rubric(driveId, roundId), enabled: !!driveId, queryFn: () => api.get<RubricResponse>(`/pipeline/drives/${driveId}/rubric${qs({ roundId: roundId ?? undefined })}`) });
export function useSaveRubric(driveId: string) {
  const inv = useInvalidatePipeline();
  return useMutation({
    mutationFn: (v: { roundId?: string | null; items: RubricItem[] }) =>
      api.put<RubricResponse>(`/pipeline/drives/${driveId}/rubric`, { ...(v.roundId ? { roundId: v.roundId } : {}), items: v.items }),
    onSuccess: () => { void inv(); },
  });
}

/* ================================================================= SLOTS == */
export const useSlots = (driveId?: string, status?: string) =>
  useInfiniteQuery({
    queryKey: pk.slots(driveId, status), enabled: !!driveId, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<{ items: Slot[]; nextCursor?: string | null }>(`/pipeline/drives/${driveId}/slots${qs({ status, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
export function useSlotActions(driveId: string) {
  const inv = useInvalidatePipeline();
  const done = () => { void inv(); };
  return {
    create: useMutation({ mutationFn: (v: { roundId: string; slots: SlotInput[] }) => api.post<{ items: Slot[] }>(`/pipeline/drives/${driveId}/rounds/${v.roundId}/slots`, { slots: v.slots }), onSuccess: done }),
    approve: useMutation({ mutationFn: (id: string) => api.post<{ slot: Slot }>(`/pipeline/slots/${id}/approve`, {}), onSuccess: done }),
    decline: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.post<{ slot: Slot }>(`/pipeline/slots/${v.id}/decline`, { reason: v.reason }), onSuccess: done }),
    cancel: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.post<{ slot: Slot; cancelledBookings: number }>(`/pipeline/slots/${v.id}/cancel`, { reason: v.reason }), onSuccess: done }),
  };
}

/* ================================================================ OFFERS == */
export const useOffers = (driveId?: string, status?: string) =>
  useInfiniteQuery({
    queryKey: pk.offers(driveId, status), enabled: !!driveId, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<{ items: Offer[]; nextCursor?: string | null }>(`/pipeline/drives/${driveId}/offers${qs({ status, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
export function useOfferActions(driveId: string) {
  const inv = useInvalidatePipeline();
  const done = () => { void inv(); };
  return {
    create: useMutation({ mutationFn: (v: { applicationId: string; body: OfferBody }) => api.post<{ offer: Offer }>(`/pipeline/drives/${driveId}/candidates/${v.applicationId}/offers`, v.body), onSuccess: done }),
    policyCheck: useMutation({ mutationFn: (v: { applicationId: string; ctc: OfferBody['ctc'] }) => api.post<{ policy: { result: string; reasons: { code: string; message: string }[]; tier?: string } }>('/pipeline/offers/policy-check', v) }),
    approve: useMutation({ mutationFn: (v: { id: string; overrideReason?: string }) => api.post<{ offer: Offer }>(`/pipeline/offers/${v.id}/approve`, v.overrideReason ? { overrideReason: v.overrideReason } : {}), onSuccess: done }),
    reject: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.post<{ offer: Offer }>(`/pipeline/offers/${v.id}/reject`, { reason: v.reason }), onSuccess: done }),
    revoke: useMutation({ mutationFn: (v: { id: string; reason: string }) => api.post<{ offer: Offer }>(`/pipeline/offers/${v.id}/revoke`, { reason: v.reason }), onSuccess: done }),
    joined: useMutation({ mutationFn: (v: { id: string; joinedOn?: string; note?: string }) => api.post<{ offer: Offer }>(`/pipeline/offers/${v.id}/joined`, { joinedOn: v.joinedOn, note: v.note }), onSuccess: done }),
  };
}
/** Candidates already `selected` (for creating offers). */
export const useSelectedCandidates = (driveId?: string, enabled = true) =>
  useQuery({
    queryKey: pk.cands(driveId, 'selected'), enabled: !!driveId && enabled,
    queryFn: async () => (await api.get<{ items: CandidateRow[] }>(`/pipeline/drives/${driveId}/candidates${qs({ status: 'selected', limit: 50 })}`)).items ?? [],
  });

/* =============================================================== OUTCOMES == */
export const useOutcomes = (driveId?: string, status?: string) =>
  useInfiniteQuery({
    queryKey: pk.outcomes(driveId, status), enabled: !!driveId, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<{ items: Outcome[]; nextCursor?: string | null }>(`/pipeline/drives/${driveId}/outcomes${qs({ status, cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
export function useDecideOutcome() {
  const inv = useInvalidatePipeline();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'decline'; note?: string }) =>
      api.post<{ outcome: Outcome; replayed?: boolean }>(`/pipeline/outcomes/${v.id}/decide`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => { void inv([['applications'], ['officer']]); },
  });
}

export const flattenPages = <T,>(pages?: { items: T[] }[]): T[] => (pages ?? []).flatMap((p) => p.items);

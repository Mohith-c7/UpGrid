import { useCallback, useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { api, getServerOffsetMs, syncServerTime } from './client';
import { queryClient } from './queryClient';
import { session, useSession } from '@/state/session';
import { registerForPush, unregisterPush } from '@/lib/push';
import type {
  Announcement,
  Application,
  AppStatus,
  ApplyBody,
  ApplyPreview,
  ApplyReceipt,
  AuthResponse,
  BulkScheduleBody,
  BulkScheduleResult,
  NewTicketBody,
  ScheduleBody,
  StudentImportResult,
  StudentImportRow,
  Ticket,
  TicketStatus,
  TicketThread,
  TicketMessage,
  DashboardData,
  DriveDetail,
  DrivePayload,
  DriveQuery,
  DriveSummary,
  EligibleCount,
  Notification,
  Page,
  ProfilePatch,
  ProfileResponse,
  RegisterBody,
  ReminderSettings,
  RespondToOfferBody,
  RespondToOfferResult,
  UpdateMeBody,
  Resume,
  Role,
  StudentDetail,
  StudentSummary,
  User,
} from './types';

/* ---------- helpers ---------- */
const qs = (o: Record<string, unknown>): string => {
  const parts = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function flatten<T>(data?: InfiniteData<Page<T>>): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}

function asArray<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const items = (r as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

function unwrap<T>(r: unknown, key: string): T {
  if (r && typeof r === 'object' && key in (r as Record<string, unknown>)) return (r as Record<string, T>)[key];
  return r as T;
}

/* ---------- query keys ---------- */
// NOTE: the officer keys below end in '-raw' / 'raw' on purpose: src/features/officer/data.ts caches adapted data under
// ['officer', 'dashboard' | 'applicants' | 'students' | 'student', ...]; same key + different shape would corrupt the cache.
export const qk = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  resumes: ['resumes'] as const,
  drives: ['drives'] as const,
  drivesList: (q: object) => ['drives', 'list', q] as const,
  drive: (id: string | undefined) => ['drives', 'detail', id] as const,
  preview: (id: string | undefined) => ['drives', 'preview', id] as const,
  applications: ['applications'] as const,
  application: (id: string | undefined) => ['applications', 'detail', id] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  reminderSettings: ['reminder-settings'] as const,
  announcements: ['announcements'] as const,
  dashboard: ['officer', 'dashboard', 'raw'] as const,
  eligibleCount: (id: string | undefined) => ['officer', 'eligible-count', id] as const,
  applicants: (id: string | undefined, status?: string) => ['officer', 'applicants-raw', id, status ?? 'all'] as const,
  students: (p: object) => ['officer', 'students-raw', p] as const,
  student: (id: string | undefined) => ['officer', 'student-raw', id] as const,
  time: ['time'] as const,
  tickets: ['tickets'] as const,
  ticketList: (status?: string) => ['tickets', 'list', status ?? 'all'] as const,
  ticket: (id: string | undefined) => ['tickets', 'detail', id] as const,
};

function invalidateDrives(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.drives }),
    qc.invalidateQueries({ queryKey: ['officer'] }),
  ]);
}

/* ---------- auth ---------- */
export interface UseAuthResult {
  user: User | null;
  role: Role | null;
  status: 'loading' | 'signedOut' | 'signedIn';
  login: (email: string, password: string) => Promise<User>;
  register: (body: RegisterBody) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const s = useSession();
  const qc = useQueryClient();

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<AuthResponse>('/auth/login', { email, password }, { auth: false });
      qc.clear();
      await session.setAuth(r);
      return r.user;
    },
    [qc],
  );
  const register = useCallback(
    async (body: RegisterBody) => {
      const r = await api.post<AuthResponse>('/auth/register', body, { auth: false });
      qc.clear();
      await session.setAuth(r);
      return r.user;
    },
    [qc],
  );
  const logout = useCallback(async () => {
    await unregisterPush();
    try {
      const rt = session.getRefreshToken();
      await api.post('/auth/logout', rt ? { refreshToken: rt } : {});
    } catch {
      /* local logout always succeeds */
    }
    await session.clear();
    qc.clear();
  }, [qc]);
  const refreshUser = useCallback(async () => {
    const r = await api.get<{ user?: User } | User>('/me');
    const u = unwrap<User>(r, 'user');
    if (u && u.id) await session.setUser(u);
  }, []);

  return { user: s.user, role: s.role, status: s.status, login, register, logout, refreshUser };
}

/** Fire-and-forget push registration + time sync once signed in; used by the root layout. */
export function useSessionBootstrap(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void syncServerTime();
    void registerForPush();
  }, [enabled]);
}

export function useServerOffset(): number {
  const q = useQuery({
    queryKey: qk.time,
    queryFn: () => syncServerTime(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return q.data ?? getServerOffsetMs();
}

/** PATCH /me: edit name, email, phone. Updates the stored session user. Rejects with ApiError (fields: name/email/phone). */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateMeBody) => {
      const r = await api.patch<{ user?: User } | User>('/me', body);
      const u = unwrap<User>(r, 'user');
      if (u && u.id) await session.setUser(u);
      return u;
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.profile }), qc.invalidateQueries({ queryKey: qk.me })]);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (v: { currentPassword: string; newPassword: string }) => {
      const r = await api.post<Partial<AuthResponse> | undefined>('/me/change-password', v);
      if (r?.accessToken && r.refreshToken) await session.setTokens(r.accessToken, r.refreshToken);
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      await unregisterPush();
      await api.delete('/me');
      await session.clear();
      queryClient.clear();
    },
  });
}

/* ---------- student profile ---------- */
export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: () => api.get<ProfileResponse>('/profile') });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.put<ProfileResponse | undefined>('/profile', patch),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.profile }),
        qc.invalidateQueries({ queryKey: qk.drives }),
        qc.invalidateQueries({ queryKey: qk.me }),
      ]);
    },
  });
}

export function useResumes() {
  return useQuery({
    queryKey: qk.resumes,
    queryFn: async () => {
      const r = await api.get<unknown>('/profile/resumes');
      const list = Array.isArray(r) ? r : ((r as { resumes?: unknown; items?: unknown })?.resumes ?? (r as { items?: unknown })?.items);
      return (Array.isArray(list) ? list : []) as Resume[];
    },
  });
}

export function useAddResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; url: string; isDefault?: boolean }) =>
      unwrap<Resume | undefined>(await api.post<unknown>('/profile/resumes', v), 'resume'),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.resumes }), qc.invalidateQueries({ queryKey: qk.profile })]);
    },
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/profile/resumes/${encodeURIComponent(id)}`);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.resumes }), qc.invalidateQueries({ queryKey: qk.profile })]);
    },
  });
}

export function useSetDefaultResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/profile/resumes/${encodeURIComponent(id)}/default`);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.resumes }), qc.invalidateQueries({ queryKey: qk.profile })]);
    },
  });
}

/* ---------- drives ---------- */
export function useDrives(query: DriveQuery & { limit?: number } = {}) {
  const { limit = 20, ...rest } = query;
  return useInfiniteQuery({
    queryKey: qk.drivesList({ ...rest, limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<DriveSummary>>(`/drives${qs({ ...rest, saved: rest.saved ? true : undefined, cursor: pageParam, limit })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDrive(id?: string) {
  return useQuery({
    queryKey: qk.drive(id),
    enabled: !!id,
    queryFn: async () => unwrap<DriveDetail>(await api.get<unknown>(`/drives/${id}`), 'drive'),
  });
}

export function useSaveDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; saved: boolean }) => {
      if (v.saved) await api.put(`/drives/${v.id}/save`);
      else await api.delete(`/drives/${v.id}/save`);
    },
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...qk.drives, 'list'] }),
        qc.invalidateQueries({ queryKey: qk.drive(v.id) }),
      ]);
    },
  });
}

export function useApplyPreview(driveId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.preview(driveId),
    enabled: !!driveId && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    queryFn: () => api.post<ApplyPreview>(`/drives/${driveId}/application/preview`, {}),
  });
}

export function useApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { driveId: string; body: ApplyBody }) => api.post<ApplyReceipt>(`/drives/${v.driveId}/apply`, v.body),
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.applications }),
        qc.invalidateQueries({ queryKey: qk.drives }),
        qc.invalidateQueries({ queryKey: qk.drive(v.driveId) }),
        qc.invalidateQueries({ queryKey: qk.profile }),
        qc.invalidateQueries({ queryKey: qk.notifications }),
      ]);
    },
  });
}

/* ---------- applications ---------- */
export function useApplications() {
  return useQuery({
    queryKey: qk.applications,
    queryFn: async () => asArray<Application>(await api.get<unknown>('/applications?limit=50')),
  });
}

export function useApplication(id?: string) {
  return useQuery({
    queryKey: qk.application(id),
    enabled: !!id,
    queryFn: async () => unwrap<Application>(await api.get<unknown>(`/applications/${id}`), 'application'),
  });
}

export function useWithdrawApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/applications/${id}/withdraw`);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.applications }), qc.invalidateQueries({ queryKey: qk.drives })]);
    },
  });
}

/** POST /applications/:id/respond: student accepts or declines an issued offer. Safe to retry (idempotent). */
export function useRespondToOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string } & RespondToOfferBody) =>
      api.post<RespondToOfferResult>(`/applications/${v.id}/respond`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: async (_r, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.applications }),
        qc.invalidateQueries({ queryKey: qk.application(v.id) }),
        qc.invalidateQueries({ queryKey: qk.notifications }),
      ]);
    },
  });
}

/* ---------- notifications & reminders ---------- */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<Notification>>(`/notifications${qs({ cursor: pageParam, limit: 20 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: qk.unread,
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
    queryFn: async () => {
      const r = await api.get<{ unreadCount?: number; count?: number }>('/notifications/unread-count');
      return r?.unreadCount ?? r?.count ?? 0;
    },
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { ids?: string[]; all?: boolean }) => {
      await api.post('/notifications/read', v.all ? { all: true } : { ids: v.ids ?? [] });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });
}

export function useReminderSettings() {
  return useQuery({
    queryKey: qk.reminderSettings,
    queryFn: async () => unwrap<ReminderSettings>(await api.get<unknown>('/reminder-settings'), 'settings'),
  });
}

export function useUpdateReminderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: ReminderSettings) => {
      const r = await api.put<unknown>('/reminder-settings', v);
      return (r ? unwrap<ReminderSettings>(r, 'settings') : v) as ReminderSettings;
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.reminderSettings, data);
    },
  });
}

export function useResetReminderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/reminder-settings/reset');
      return unwrap<ReminderSettings>(await api.get<unknown>('/reminder-settings'), 'settings');
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.reminderSettings, data);
    },
  });
}

export function useAnnouncements() {
  return useQuery({
    queryKey: qk.announcements,
    queryFn: async () => asArray<Announcement>(await api.get<unknown>('/announcements')),
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { title: string; body: string; driveId?: string }) =>
      unwrap<Announcement | undefined>(await api.post<unknown>('/announcements', v), 'announcement'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.announcements });
    },
  });
}

/* ---------- officer ---------- */
export function useOfficerDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<DashboardData>('/officer/dashboard') });
}

export function useCreateDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DrivePayload) => unwrap<DriveDetail>(await api.post<unknown>('/drives', payload), 'drive'),
    onSuccess: () => invalidateDrives(qc),
  });
}

export function useUpdateDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; payload: DrivePayload }) =>
      unwrap<DriveDetail>(await api.put<unknown>(`/drives/${v.id}`, v.payload), 'drive'),
    onSuccess: () => invalidateDrives(qc),
  });
}

export function usePublishDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<DriveDetail>(await api.post<unknown>(`/drives/${id}/publish`), 'drive'),
    onSuccess: () => invalidateDrives(qc),
  });
}

export function useCloseDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<DriveDetail>(await api.post<unknown>(`/drives/${id}/close`), 'drive'),
    onSuccess: () => invalidateDrives(qc),
  });
}

export function useDuplicateDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap<DriveDetail>(await api.post<unknown>(`/drives/${id}/duplicate`), 'drive'),
    onSuccess: () => invalidateDrives(qc),
  });
}

export function useEligibleCount(driveId?: string) {
  return useQuery({
    queryKey: qk.eligibleCount(driveId),
    enabled: !!driveId,
    queryFn: () => api.get<EligibleCount>(`/drives/${driveId}/eligible-count`),
  });
}

export function useApplicants(driveId?: string, status?: string) {
  return useQuery({
    queryKey: qk.applicants(driveId, status),
    enabled: !!driveId,
    queryFn: async () => asArray<Application>(await api.get<unknown>(`/drives/${driveId}/applicants${qs({ status })}`)),
  });
}

export function useUpdateApplicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: AppStatus; note?: string }) =>
      unwrap<Application | undefined>(
        await api.post<unknown>(`/applications/${v.id}/status`, { status: v.status, note: v.note || undefined }),
        'application',
      ),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['officer'] }), qc.invalidateQueries({ queryKey: qk.applications })]);
    },
  });
}

export function useStudents(params: { q?: string; branch?: string; batch?: string; verified?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: qk.students(params),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<StudentSummary>>(`/students${qs({ ...params, cursor: pageParam, limit: 20 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useStudent(id?: string) {
  return useQuery({
    queryKey: qk.student(id),
    enabled: !!id,
    queryFn: async () => unwrap<StudentDetail>(await api.get<unknown>(`/students/${id}`), 'student'),
  });
}

export function useVerifyStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; fields: string[] }) => {
      await api.post(`/students/${v.id}/verify`, { fields: v.fields });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['officer'] });
    },
  });
}


/* ---------- scheduling (officer) ---------- */
function invalidateApplications(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['officer'] }),
    qc.invalidateQueries({ queryKey: qk.applications }),
  ]);
}
export function useScheduleApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ScheduleBody }) => api.post<unknown>(`/applications/${id}/schedule`, body),
    onSuccess: () => invalidateApplications(qc),
  });
}
export function useScheduleBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ driveId, body }: { driveId: string; body: BulkScheduleBody }) =>
      api.post<BulkScheduleResult>(`/drives/${driveId}/schedule-bulk`, body),
    onSuccess: () => invalidateApplications(qc),
  });
}

/* ---------- student data import (officer) ---------- */
export function useImportStudents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: StudentImportRow[]) => api.post<StudentImportResult>('/students/import', { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['officer'] }),
  });
}

/* ---------- support tickets ---------- */
export function useTickets(status?: TicketStatus) {
  return useInfiniteQuery({
    queryKey: qk.ticketList(status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<Ticket>>(`/tickets${qs({ status, cursor: pageParam, limit: 20 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}
export function useTicket(id?: string) {
  return useQuery({
    queryKey: qk.ticket(id),
    enabled: !!id,
    queryFn: async (): Promise<TicketThread> => {
      const r = await api.get<Partial<TicketThread>>(`/tickets/${id}`);
      return { ticket: r.ticket as Ticket, messages: Array.isArray(r.messages) ? (r.messages as TicketMessage[]) : [] };
    },
  });
}
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewTicketBody) => api.post<{ ticket?: Ticket } | Ticket>('/tickets', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tickets }),
  });
}
export function useReplyTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api.post<unknown>(`/tickets/${id}/messages`, { message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tickets }),
  });
}
export function useSetTicketStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TicketStatus) => api.post<unknown>(`/tickets/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tickets }),
  });
}

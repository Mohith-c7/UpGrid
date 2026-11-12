/**
 * Student "me" data layer: applications, profile, resumes, notifications, reminders, account.
 * All network access for these screens goes through here, so adapting to the shared client/hooks is a one-file change.
 * Response shapes follow server/README.md and server/src/routes/*.ts.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import {
  qk, useAddResume, useAuth, useChangePassword, useDeleteAccount, useDeleteResume, useMarkNotificationsRead, useNotifications, useProfile,
  useReminderSettings, useResetReminderSettings, useResumes, useSetDefaultResume, useUnreadCount, useUpdateMe, useUpdateProfile, useUpdateReminderSettings,
  useRespondToOffer,
  useWithdrawApplication,
} from '../../../api/hooks';
import type {
  AppStatus, Completion, DriveSummary, EligibilityReason, Notification, Profile, ProfilePatch, ReminderSettings, Schedule,
} from '../../../api/types';

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

/* ------------------------------------------------------------------ errors */
export function errMessage(e: unknown): string {
  const x = e as any;
  return x?.message || 'Something went wrong. Please try again.';
}
export function errFields(e: unknown): Record<string, string> | undefined {
  const x = e as any;
  return x?.fields ?? x?.body?.error?.fields ?? x?.data?.error?.fields;
}
export function errCode(e: unknown): string | undefined {
  const x = e as any;
  return x?.code ?? x?.body?.error?.code;
}
export function isNetworkError(e: unknown): boolean {
  const x = e as any;
  return x?.isNetwork === true || ['NETWORK', 'OFFLINE', 'TIMEOUT'].includes(x?.code);
}

/* ------------------------------------------------------------ applications */
export interface AppDrive { id: string; role: string; deadline?: string | null; company: { name: string; logoUrl?: string | null; industry?: string | null; verified?: boolean } }
export interface AppRow {
  id: string; reference: string; status: AppStatus; submittedAt: string; updatedAt?: string; drive: AppDrive;
}
export interface AppEventRow { status: AppStatus; note?: string | null; actorRole?: string | null; createdAt: string }
export interface AppDetail extends AppRow {
  answers?: Record<string, unknown> | null;
  resume?: { label?: string; url?: string } | null;
  events: AppEventRow[];
  allowedNextStatuses: string[];
  canRespondToOffer?: boolean;
  schedule?: Schedule | null;
}

export const useApplications = () =>
  useInfiniteQuery({
    queryKey: [...qk.applications, 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<{ items: AppRow[]; nextCursor?: string | null }>(`/applications${qs({ cursor: pageParam, limit: 50 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useApplication = (id?: string) =>
  useQuery({
    queryKey: [...qk.application(id), 'student'],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get<any>(`/applications/${id}`);
      const a = r?.application ?? r;
      return { ...a, events: a?.events ?? [], allowedNextStatuses: a?.allowedNextStatuses ?? [] } as AppDetail;
    },
  });

export { useUpdateMe, useRespondToOffer };

export function useWithdraw(id: string) {
  const m = useWithdrawApplication();
  return { mutateAsync: (_note?: string) => m.mutateAsync(id) };
}

/* ----------------------------------------------------------------- profile */
/** GET /profile. `completion.nextStep` is a label string on the real server (typed as an item in api/types). */
export interface ProfileFull extends Omit<Profile, 'completion'> {
  user?: { id: string; name: string; email: string; phone?: string | null; phoneDisplay?: string };
  completion: Omit<Completion, 'nextStep'> & { nextStep: string | null };
}
export const useProfileFull = () => {
  const q = useProfile();
  return q as unknown as Omit<typeof q, 'data'> & { data: ProfileFull | undefined };
};
export const useSaveProfile = () => {
  const m = useUpdateProfile();
  return {
    mutateAsync: async (patch: ProfilePatch) => { await m.mutateAsync(patch); },
  };
};

/* ----------------------------------------------------------------- resumes */
export { useResumes };
export function useResumeMutations() {
  return { add: useAddResume(), setDefault: useSetDefaultResume(), remove: useDeleteResume() };
}

/* ----------------------------------------------------------- notifications */
export const isRead = (n: Notification) => !!n.readAt;
export { useNotifications, useUnreadCount };
export const useMarkRead = useMarkNotificationsRead;

/* ------------------------------------------------------ reminder settings */
export { useReminderSettings };
type SettingsPatch = Partial<Omit<ReminderSettings, 'quietHours'>> & { quietHours?: Partial<ReminderSettings['quietHours']> };
export function useReminderMutations() {
  const q = useReminderSettings();
  const upd = useUpdateReminderSettings();
  const reset = useResetReminderSettings();
  return {
    save: {
      mutateAsync: async (patch: SettingsPatch) => {
        const cur = q.data;
        if (!cur) throw new Error('Settings have not loaded yet. Pull down to retry.');
        return upd.mutateAsync({ ...cur, ...patch, quietHours: { ...cur.quietHours, ...(patch.quietHours ?? {}) } } as ReminderSettings);
      },
    },
    reset,
  };
}

/* ----------------------------------------------------------------- account */
export { useChangePassword, useDeleteAccount, useAuth };

/* ------------------------------------------------------------- eligibility */
export interface EligDrive extends DriveSummary { eligibility: { status: 'eligible' | 'not_eligible' | 'pending'; reason?: string } }
export const useEligibilityDrives = () =>
  useQuery({
    queryKey: [...qk.drives, 'eligibility'],
    queryFn: async () => {
      const out: EligDrive[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const r = await api.get<{ items: EligDrive[]; nextCursor?: string | null }>(`/drives${qs({ status: 'open', sort: 'closing', limit: 50, cursor })}`);
        out.push(...r.items.filter((d) => d.eligibility));
        if (!r.nextCursor) break;
        cursor = r.nextCursor;
      }
      return out;
    },
  });

export interface ReasonRow extends EligibilityReason { label?: string; message?: string }
/** Per-criterion reasons live on the drive detail (`eligibilityReasons`). Fetched lazily per expanded drive. */
export const useDriveReasons = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [...qk.drives, 'reasons', id],
    enabled,
    queryFn: async () => {
      const r = await api.get<any>(`/drives/${id}`);
      return ((r?.drive ?? r)?.eligibilityReasons ?? []) as ReasonRow[];
    },
  });


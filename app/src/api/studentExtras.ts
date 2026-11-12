// API calls and hooks for student extras: restrictions + appeals, public stats, calendar, documents status.
// Contract: server/docs/ops-api.md. Types: ./studentExtrasTypes.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, API_URL } from './client';
import type {
  ApplyGateCode, FeedTokenCreated, FeedTokenStatus, MyDocuments, MyRestriction, MyRestrictionsResponse, PublicStats, CalendarItem,
} from './studentExtrasTypes';

export const sxKeys = {
  restrictions: ['student-extras', 'restrictions'] as const,
  stats: ['student-extras', 'stats'] as const,
  calendar: (from: string, to: string) => ['student-extras', 'calendar', from, to] as const,
  feed: ['student-extras', 'feed-token'] as const,
  docs: ['student-extras', 'documents'] as const,
};

/** True for "the server does not have this route / module" so screens can degrade instead of failing. */
export const isMissingRoute = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 404 || e.status === 501 || e.code === 'NOT_FOUND') && !e.isNetwork;

const noRetryOnClientError = (count: number, e: unknown) =>
  !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2;

/* ------------------------------------------------------------ restrictions */
export async function fetchMyRestrictions(): Promise<MyRestriction[]> {
  try {
    const r = await api.get<MyRestrictionsResponse | MyRestriction[]>('/my/restrictions');
    return Array.isArray(r) ? r : r?.items ?? [];
  } catch (e) {
    if (isMissingRoute(e)) return [];
    throw e;
  }
}

/** Active restrictions that apply to the signed-in student. `enabled` should be the opsRestrictions flag AND student role. */
export const useMyRestrictions = (enabled = true) =>
  useQuery({ queryKey: sxKeys.restrictions, queryFn: fetchMyRestrictions, enabled, staleTime: 60_000, retry: noRetryOnClientError });

export function useAppealRestriction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; message: string }) =>
      api.post<{ appeal: unknown }>(`/my/restrictions/${encodeURIComponent(v.id)}/appeal`, { message: v.message }),
    onSettled: () => { void qc.invalidateQueries({ queryKey: sxKeys.restrictions }); },
  });
}

/* ------------------------------------------------------------------- stats */
export const usePublicStats = (enabled = true) =>
  useQuery({
    queryKey: sxKeys.stats, enabled, staleTime: 5 * 60_000, retry: noRetryOnClientError,
    queryFn: () => api.get<PublicStats>('/stats/public'),
  });

/* ---------------------------------------------------------------- calendar */
export const useCalendar = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: sxKeys.calendar(from, to), enabled, staleTime: 60_000, retry: noRetryOnClientError,
    queryFn: async () => {
      const r = await api.get<{ items: CalendarItem[] } | CalendarItem[]>(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      return Array.isArray(r) ? r : r?.items ?? [];
    },
  });

export const useFeedTokenStatus = (enabled = true) =>
  useQuery({ queryKey: sxKeys.feed, enabled, retry: noRetryOnClientError, queryFn: () => api.get<FeedTokenStatus>('/calendar/feed-token') });

/** Turn the relative `url` from POST /calendar/feed-token into an absolute https link. */
export function absoluteFeedUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  let origin = '';
  try { origin = new URL(API_URL).origin; } catch { origin = ''; }
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function useCreateFeedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await api.post<FeedTokenCreated>('/calendar/feed-token', {});
      return { ...r, url: absoluteFeedUrl(r.url) };
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: sxKeys.feed }); },
  });
}
export function useRevokeFeedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ ok: true }>('/calendar/feed-token'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: sxKeys.feed }); },
  });
}

/* --------------------------------------------------------------- documents */
export const useMyDocuments = (enabled = true) =>
  useQuery({
    queryKey: sxKeys.docs, enabled, retry: noRetryOnClientError,
    queryFn: async (): Promise<MyDocuments> => {
      const r = await api.get<MyDocuments>('/documents/mine');
      return { items: r?.items ?? [], completion: r?.completion };
    },
  });

/* ------------------------------------------------------------- apply gates */
/** Maps an apply/preview error or blockedCode to one of the three gates we show fix-it actions for. */
export function applyGateCode(e: unknown): ApplyGateCode | null {
  const code = e instanceof ApiError ? e.code : typeof e === 'string' ? e : '';
  return code === 'EMAIL_NOT_VERIFIED' || code === 'PHONE_REQUIRED' || code === 'RESTRICTED' ? code : null;
}
/** `fields.restrictionId` from a RESTRICTED apply error, when present. */
export const restrictionIdOf = (e: unknown): string | null => (e instanceof ApiError ? e.fields?.restrictionId ?? null : null);

/* ---------------------------------------------------------- prep hub: tests */
export interface UpcomingTestEntry {
  id: string; title: string; opensAt?: string | null; closesAt?: string | null; durationMinutes?: number | null;
  drive?: { company?: string; role?: string } | null; bucket?: string;
}
/** Entries only (first few upcoming/live tests). The tests screens themselves belong to the assessments module. */
export const useUpcomingTestEntries = (enabled = true) =>
  useQuery({
    queryKey: ['student-extras', 'upcoming-tests'], enabled, staleTime: 60_000, retry: noRetryOnClientError,
    queryFn: async (): Promise<UpcomingTestEntry[]> => {
      try {
        const r = await api.get<{ items?: UpcomingTestEntry[] }>('/my/assessments?bucket=upcoming&limit=5');
        return r?.items ?? [];
      } catch (e) {
        if (isMissingRoute(e)) return [];
        throw e;
      }
    },
  });

/**
 * Placement Operations API client + hooks (server/docs/ops-api.md). Officer only.
 * Everything goes through the shared `api` client (auth, refresh, typed errors).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api, apiGetText } from './client';
import type {
  ActivePolicy, AiPolicyDraft, AnalyticsDashboard, AnalyticsFunnel, AnalyticsPlacement, Appeal, AnnouncementInput, AnnouncementTemplate,
  AnnouncementV2, AuditEntry, AuditFilters, CalendarItem, Cohort, CohortFilter, CohortMember, CohortPreview, CompanyInput, CompanyStage,
  CrmCompany, DocType, DriveStat, DuplicateGroup, ExportDataset, FeedTokenCreated, FeedTokenStatus, Interaction, OpsFilters, OpsSettings,
  Page, PolicyDetail, PolicyJson, PolicyListItem, PolicyTemplate, PolicyVersion, ReminderStats, ReportPack, Restriction, RestrictionDetail,
  RestrictionInput, SimulateResult, ValidateConditionsResult, ValidateDraftResult, VerifyDoc, Workload, Condition,
} from './opsTypes';

export const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export const opsKeys = {
  all: ['ops'] as const,
  analytics: (name: string, f?: unknown) => ['ops', 'analytics', name, f ?? null] as const,
  settings: ['ops', 'settings'] as const,
  policies: ['ops', 'policies'] as const,
  policy: (id?: string) => ['ops', 'policy', id] as const,
  version: (id?: string) => ['ops', 'version', id] as const,
  active: ['ops', 'policy-active'] as const,
  templates: ['ops', 'policy-templates'] as const,
};

function useInvalidate(...keys: (readonly unknown[])[]) {
  const qc = useQueryClient();
  return () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function flattenPages<T>(data?: InfiniteData<Page<T>>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of data?.pages ?? []) for (const it of p.items ?? []) {
    const id = (it as { id?: string }).id;
    if (id) { if (seen.has(id)) continue; seen.add(id); }
    out.push(it);
  }
  return out;
}

function useList<T>(key: readonly unknown[], path: string, params: Record<string, unknown>, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key, params],
    initialPageParam: undefined as string | undefined,
    enabled,
    queryFn: ({ pageParam }) => api.get<Page<T>>(`${path}${qs({ ...params, cursor: pageParam, limit: 20 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

/* ================= Analytics ================= */
const fq = (f: OpsFilters) => qs({ batch: f.batch, department: f.department, from: f.from, to: f.to });
export const useAnalyticsDashboard = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('dashboard', f), queryFn: () => api.get<AnalyticsDashboard>(`/analytics/dashboard${fq(f)}`) });
export const useAnalyticsPlacement = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('placement', f), queryFn: () => api.get<AnalyticsPlacement>(`/analytics/placement${fq(f)}`) });
export const useAnalyticsFunnel = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('funnel', f), queryFn: () => api.get<AnalyticsFunnel>(`/analytics/funnel${fq(f)}`) });
export const useAnalyticsDrives = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('drives', f), queryFn: () => api.get<{ items: DriveStat[] }>(`/analytics/drives${fq(f)}`) });
export const useAnalyticsReminders = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('reminders', f), queryFn: () => api.get<ReminderStats>(`/analytics/reminders${fq(f)}`) });
export const useAnalyticsWorkload = (f: OpsFilters) => useQuery({ queryKey: opsKeys.analytics('workload', f), queryFn: () => api.get<Workload>(`/analytics/workload${fq(f)}`) });
export const fetchAnalyticsExport = (dataset: ExportDataset, format: 'csv' | 'json', f: OpsFilters) =>
  apiGetText(`/analytics/export${qs({ dataset, format, batch: f.batch, department: f.department, from: f.from, to: f.to })}`, format === 'csv' ? 'text/csv' : 'application/json', 45000);
export const fetchReportPack = (f: OpsFilters) => api.get<ReportPack>(`/analytics/report-pack${fq(f)}`, { timeoutMs: 45000 });

/* ================= Settings ================= */
export const useOpsSettings = () => useQuery({ queryKey: opsKeys.settings, queryFn: () => api.get<OpsSettings>('/ops/settings') });
export function useUpdateOpsSettings() {
  const inv = useInvalidate(opsKeys.settings);
  return useMutation({ mutationFn: (v: Partial<OpsSettings>) => api.put<OpsSettings>('/ops/settings', v), onSuccess: () => inv() });
}

/* ================= Policy ================= */
export const usePolicyTemplates = () => useQuery({ queryKey: opsKeys.templates, queryFn: async () => (await api.get<{ items: PolicyTemplate[] }>('/policy/templates')).items ?? [], staleTime: 10 * 60_000 });
export const useActivePolicy = () => useQuery({ queryKey: opsKeys.active, queryFn: () => api.get<ActivePolicy>('/policy/active') });
export const usePolicies = () => useQuery({ queryKey: opsKeys.policies, queryFn: async () => (await api.get<{ items: PolicyListItem[] }>('/policy/policies')).items ?? [] });
export const usePolicy = (id?: string) => useQuery({ queryKey: opsKeys.policy(id), enabled: !!id, queryFn: () => api.get<PolicyDetail>(`/policy/policies/${id}`) });
export const usePolicyVersion = (vid?: string) => useQuery({ queryKey: opsKeys.version(vid), enabled: !!vid, queryFn: async () => (await api.get<{ version: PolicyVersion }>(`/policy/versions/${vid}`)).version });

function usePolicyInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ops'], predicate: (q) => ['policies', 'policy', 'version', 'policy-active'].includes(String(q.queryKey[1])) });
}
export function useCreatePolicy() {
  const inv = usePolicyInvalidate();
  return useMutation({
    mutationFn: (v: { name: string; description?: string; templateId?: string; policy?: PolicyJson }) => api.post<{ policy: { id: string }; version: { id: string } }>('/policy/policies', v),
    onSuccess: () => inv(),
  });
}
export function useCreateVersion(policyId: string) {
  const inv = usePolicyInvalidate();
  return useMutation({
    mutationFn: (v: { policy?: PolicyJson; effectiveFrom?: string; note?: string }) => api.post<{ version: PolicyVersion }>(`/policy/policies/${policyId}/versions`, v),
    onSuccess: () => inv(),
  });
}
export function useUpdateVersion(vid: string) {
  const inv = usePolicyInvalidate();
  return useMutation({
    mutationFn: (v: { policy?: PolicyJson; effectiveFrom?: string | null; note?: string }) => api.put<{ version: PolicyVersion }>(`/policy/versions/${vid}`, v),
    onSuccess: () => inv(),
  });
}
export function useApproveVersion() {
  const inv = usePolicyInvalidate();
  return useMutation({ mutationFn: (vid: string) => api.post<{ version: PolicyVersion }>(`/policy/versions/${vid}/approve`, {}), onSuccess: () => inv() });
}
export function useActivateVersion() {
  const inv = usePolicyInvalidate();
  return useMutation({ mutationFn: (vid: string) => api.post<{ version: PolicyVersion; active: boolean }>(`/policy/versions/${vid}/activate`, {}), onSuccess: () => inv() });
}
export function useRollbackPolicy(policyId: string) {
  const inv = usePolicyInvalidate();
  return useMutation({ mutationFn: (v: { toVersionId: string; note?: string }) => api.post<{ version: PolicyVersion }>(`/policy/policies/${policyId}/rollback`, v), onSuccess: () => inv() });
}
export function useClonePolicy(policyId: string) {
  const inv = usePolicyInvalidate();
  return useMutation({ mutationFn: (name: string) => api.post<{ policy: { id: string }; version?: { id: string } }>(`/policy/policies/${policyId}/clone`, { name }), onSuccess: () => inv() });
}
export const validatePolicyDraft = (policy: PolicyJson) => api.post<ValidateDraftResult>('/policy/validate-draft', { policy });
export const validateConditions = (conditions: Condition) => api.post<ValidateConditionsResult>('/policy/validate-conditions', { conditions });
export const simulatePolicy = (body: { draft?: PolicyJson; versionId?: string; driveId?: string }) => api.post<SimulateResult>('/policy/simulate', body, { timeoutMs: 45000 });
/** POST /ai/policy/draft (ai-api.md). Output is a draft of eligibility rules; nothing is saved. */
export const aiPolicyDraft = (instruction: string) => api.post<AiPolicyDraft>('/ai/policy/draft', { instruction }, { timeoutMs: 45000 });

/* ================= Restrictions ================= */
const rk = ['ops', 'restrictions'] as const;
export const useRestrictions = (p: { status?: string; scope?: string }) => useList<Restriction>(rk, '/restrictions', p);
export const useRestriction = (id?: string) => useQuery({ queryKey: [...rk, 'one', id], enabled: !!id, queryFn: () => api.get<RestrictionDetail>(`/restrictions/${id}`) });
export const useAppeals = (status = 'pending') => useQuery({ queryKey: [...rk, 'appeals', status], queryFn: async () => (await api.get<{ items: Appeal[] }>(`/restrictions/appeals${qs({ status })}`)).items ?? [] });
export function useRestrictionMutations() {
  const inv = useInvalidate(rk);
  const done = <T,>(p: Promise<T>) => p.then(async (r) => { await inv(); return r; });
  return {
    create: (v: RestrictionInput) => done(api.post<{ restriction: Restriction }>('/restrictions', v)),
    approve: (id: string, note?: string) => done(api.post<{ restriction: Restriction }>(`/restrictions/${id}/approve`, note ? { note } : {})),
    reject: (id: string, note: string) => done(api.post<{ restriction: Restriction }>(`/restrictions/${id}/reject`, { note })),
    lift: (id: string, reason: string) => done(api.post<{ restriction: Restriction }>(`/restrictions/${id}/lift`, { reason })),
    decideAppeal: (appealId: string, decision: 'uphold' | 'overturn', note: string) => done(api.post<unknown>(`/restrictions/appeals/${appealId}/decide`, { decision, note })),
  };
}

/* ================= Cohorts ================= */
const ck = ['ops', 'cohorts'] as const;
export const useCohorts = () => useQuery({ queryKey: ck, queryFn: async () => (await api.get<{ items: Cohort[] }>('/cohorts')).items ?? [] });
export const useCohort = (id?: string) => useQuery({ queryKey: [...ck, 'one', id], enabled: !!id, queryFn: async () => (await api.get<{ cohort: Cohort }>(`/cohorts/${id}`)).cohort });
export const useCohortMembers = (id?: string) =>
  useInfiniteQuery({
    queryKey: [...ck, 'members', id], enabled: !!id, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Page<CohortMember> & { total: number }>(`/cohorts/${id}/members${qs({ cursor: pageParam, limit: 30 })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
export const previewCohort = (v: { kind: 'dynamic' | 'fixed'; filter?: CohortFilter; studentIds?: string[] }) => api.post<CohortPreview>('/cohorts/preview', v);
export function useCohortMutations() {
  const inv = useInvalidate(ck);
  const done = <T,>(p: Promise<T>) => p.then(async (r) => { await inv(); return r; });
  return {
    create: (v: { name: string; description?: string; kind: 'dynamic' | 'fixed'; filter?: CohortFilter; studentIds?: string[] }) => done(api.post<{ cohort: Cohort }>('/cohorts', v)),
    update: (id: string, v: { name?: string; description?: string; filter?: CohortFilter }) => done(api.put<{ cohort: Cohort }>(`/cohorts/${id}`, v)),
    remove: (id: string) => done(api.delete<unknown>(`/cohorts/${id}`)),
    members: (id: string, v: { add?: string[]; remove?: string[] }) => done(api.put<unknown>(`/cohorts/${id}/members`, v)),
  };
}
export const searchStudentsForCohort = (q: string) =>
  api.get<{ items: { id: string; name: string; registrationNumber?: string | null; department?: string | null; batchYear?: number | null }[] }>(`/students${qs({ q, limit: 20 })}`);

/* ================= Announcements v2 ================= */
const ak = ['ops', 'announcements'] as const;
export const useAnnouncementsV2 = (status?: string) => useList<AnnouncementV2>(ak, '/announcements-v2', { status });
export const useAnnouncementV2 = (id?: string) => useQuery({ queryKey: [...ak, 'one', id], enabled: !!id, queryFn: async () => { const r = await api.get<{ announcement?: AnnouncementV2 } & Partial<AnnouncementV2>>(`/announcements-v2/${id}`); return (r.announcement ?? r) as AnnouncementV2; } });
export const useAnnouncementTemplates = () => useQuery({ queryKey: [...ak, 'templates'], queryFn: async () => (await api.get<{ items: AnnouncementTemplate[] }>('/announcement-templates')).items ?? [] });
export function useAnnouncementMutations() {
  const inv = useInvalidate(ak);
  const done = <T,>(p: Promise<T>) => p.then(async (r) => { await inv(); return r; });
  return {
    create: (v: AnnouncementInput) => done(api.post<{ announcement?: AnnouncementV2 }>('/announcements-v2', v)),
    update: (id: string, v: Partial<AnnouncementInput>) => done(api.put<{ announcement?: AnnouncementV2 }>(`/announcements-v2/${id}`, v)),
    remove: (id: string) => done(api.delete<unknown>(`/announcements-v2/${id}`)),
    send: (id: string) => done(api.post<unknown>(`/announcements-v2/${id}/send`, {})),
    pin: (id: string, pinned: boolean) => done(api.post<unknown>(`/announcements-v2/${id}/pin`, { pinned })),
    createTemplate: (v: { name: string; title: string; body: string }) => done(api.post<unknown>('/announcement-templates', v)),
    deleteTemplate: (id: string) => done(api.delete<unknown>(`/announcement-templates/${id}`)),
  };
}

/* ================= Calendar ================= */
export const useCalendar = (from: string, to: string) =>
  useQuery({ queryKey: ['ops', 'calendar', from, to], queryFn: async () => (await api.get<{ items: CalendarItem[] }>(`/calendar${qs({ from, to })}`)).items ?? [] });
export const useFeedToken = () => useQuery({ queryKey: ['ops', 'feed-token'], queryFn: () => api.get<FeedTokenStatus>('/calendar/feed-token') });
export function useFeedTokenMutations() {
  const inv = useInvalidate(['ops', 'feed-token']);
  return {
    create: () => api.post<FeedTokenCreated>('/calendar/feed-token', {}).then(async (r) => { await inv(); return r; }),
    revoke: () => api.delete<unknown>('/calendar/feed-token').then(async (r) => { await inv(); return r; }),
  };
}

/* ================= Company CRM ================= */
const mk = ['ops', 'crm'] as const;
export const useCrmCompanies = (p: { q?: string; stage?: string; verified?: string }) => useList<CrmCompany>(mk, '/crm/companies', p);
export const useCrmDuplicates = () => useQuery({ queryKey: [...mk, 'dups'], queryFn: async () => (await api.get<{ groups: DuplicateGroup[] }>('/crm/companies/duplicates')).groups ?? [] });
export const useCrmCompany = (id?: string) => useQuery({ queryKey: [...mk, 'one', id], enabled: !!id, queryFn: async () => { const r = await api.get<{ company?: CrmCompany } & Partial<CrmCompany>>(`/crm/companies/${id}`); return (r.company ?? r) as CrmCompany; } });
export const useInteractions = (id?: string) => useQuery({ queryKey: [...mk, 'interactions', id], enabled: !!id, queryFn: async () => (await api.get<{ items: Interaction[] }>(`/crm/companies/${id}/interactions`)).items ?? [] });
export const fetchCrmExport = () => apiGetText('/crm/companies/export', 'text/csv', 45000);
export function useCrmMutations() {
  const inv = useInvalidate(mk);
  const done = <T,>(p: Promise<T>) => p.then(async (r) => { await inv(); return r; });
  return {
    create: (v: CompanyInput) => done(api.post<{ company?: CrmCompany }>('/crm/companies', v)),
    update: (id: string, v: Partial<CompanyInput>) => done(api.put<unknown>(`/crm/companies/${id}`, v)),
    remove: (id: string) => done(api.delete<unknown>(`/crm/companies/${id}`)),
    stage: (id: string, stage: CompanyStage, note?: string) => done(api.post<unknown>(`/crm/companies/${id}/stage`, { stage, note })),
    addInteraction: (id: string, v: { type: Interaction['type']; occurredAt: string; summary: string; followUpAt?: string }) => done(api.post<unknown>(`/crm/companies/${id}/interactions`, v)),
    updateInteraction: (id: string, iid: string, v: { summary?: string; followUpAt?: string | null; followUpDone?: boolean }) => done(api.put<unknown>(`/crm/companies/${id}/interactions/${iid}`, v)),
  };
}

/* ================= Audit ================= */
export const useAudit = (f: AuditFilters) => useList<AuditEntry>(['ops', 'audit'], '/audit', { ...f });
export const useAuditActions = () => useQuery({ queryKey: ['ops', 'audit-actions'], queryFn: async () => (await api.get<{ items: string[] }>('/audit/actions')).items ?? [], staleTime: 5 * 60_000 });
export const fetchAuditExport = (f: AuditFilters, format: 'csv' | 'json') =>
  apiGetText(`/audit/export${qs({ ...f, format })}`, format === 'csv' ? 'text/csv' : 'application/json', 60000);

/* ================= Documents ================= */
const dk = ['ops', 'documents'] as const;
export const useDocQueue = (p: { status?: string; docType?: DocType | ''; q?: string }) => useList<VerifyDoc>(dk, '/documents/queue', p);
export const fetchFileUrl = (fileId: string) => api.get<{ url: string; expiresIn?: number }>(`/files/${fileId}/url`);
export function useDocMutations() {
  const inv = useInvalidate(dk);
  const done = <T,>(p: Promise<T>) => p.then(async (r) => { await inv(); return r; });
  return {
    verify: (id: string, note?: string) => done(api.post<unknown>(`/documents/${id}/verify`, note ? { note } : {})),
    reject: (id: string, reason: string) => done(api.post<unknown>(`/documents/${id}/reject`, { reason })),
  };
}

/**
 * Officer data layer. All network access for officer screens goes through here so that
 * adapting to the shared API client/hook names is a one-file change.
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Applicant, DriveDraft, DriveItem, EligibleCount, StudentRow } from './types';
import { EMPTY_DRAFT } from './types';

const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export interface Dashboard {
  openDrives: number; closingToday: number; applicationsToday: number; pendingVerifications: number;
  upcoming: DriveItem[];
}

/** Server: upcoming[] = {id, company: string, role, deadline, applicants}. Adapted to DriveItem. */
export const useDashboard = () =>
  useQuery({
    queryKey: ['officer', 'dashboard'],
    queryFn: async (): Promise<Dashboard> => {
      const r = await api.get<any>('/officer/dashboard');
      return {
        openDrives: r.openDrives ?? 0, closingToday: r.closingToday ?? 0, applicationsToday: r.applicationsToday ?? 0,
        pendingVerifications: r.pendingVerifications ?? 0,
        upcoming: (r.upcoming ?? []).map((u: any): DriveItem => ({
          id: u.id, company: { name: typeof u.company === 'string' ? u.company : u.company?.name ?? '' }, role: u.role,
          deadline: u.deadline, status: 'open', applicantCount: u.applicants,
        })),
      };
    },
  });

export const useDrivesOfficer = (status?: string, q?: string) =>
  useInfiniteQuery({
    queryKey: ['officer', 'drives', status ?? 'all', q ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<{ items: DriveItem[]; nextCursor?: string | null }>(`/drives${qs({ status, q, cursor: pageParam, limit: 20, sort: 'newest' })}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

/** GET/POST/PUT drive responses are `{ drive }`. */
const unwrapDrive = (r: any) => (r && typeof r === 'object' && 'drive' in r ? r.drive : r);

export function fromApiDrive(raw: any): DriveDraft {
  const d = unwrapDrive(raw);
  const c = d?.company ?? {};
  const ctc = d?.ctc ?? {};
  const contact = d?.contact && typeof d.contact === 'object' ? d.contact : {};
  const req = d?.requirements;
  return {
    ...EMPTY_DRAFT,
    id: d?.id, status: d?.status,
    companyName: c.name ?? '', industry: c.industry ?? '', companyWebsite: '', logoUrl: c.logoUrl ?? null,
    role: d?.role ?? '', workMode: d?.workMode ?? 'onsite', locations: d?.locations ?? [],
    jd: d?.jd ?? '', requirements: Array.isArray(req) ? req.join('\n') : typeof req === 'string' ? req : '',
    ctc: {
      providedStatus: 'provided', kind: ctc.kind ?? 'annual', fixedLpa: ctc.fixedLpa ?? null, variableLpa: ctc.variableLpa ?? null,
      bonusLpa: ctc.bonusLpa ?? null, esopNote: ctc.esopNote ?? '', breakdownProvided: !!ctc.breakdownProvided,
    },
    rules: { allowedDepartments: [], allowedBatches: [], ...(d?.rules ?? {}) },
    questions: (d?.questions ?? []).map((q: any) => ({ ...q, options: q.options ?? [] })),
    rounds: d?.rounds?.length ? d.rounds.map((r: any) => ({ name: r.name, mode: r.mode, notes: r.description })) : EMPTY_DRAFT.rounds,
    policyNote: d?.policyNote ?? '', contactName: contact.name ?? '', contactEmail: contact.email ?? '',
    opensAt: null, deadline: d?.deadline ?? null,
  };
}

const SAVE_KEYS = ['contact.city', 'contact.state', 'links.linkedin', 'links.github', 'links.portfolio', 'preferences.workMode'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The server schema is strict (unknown keys are rejected), so only known keys are sent. */
export function toApiDrive(d: DriveDraft) {
  const out: Record<string, unknown> = {
    company: {
      name: d.companyName.trim(), ...(d.industry.trim() ? { industry: d.industry.trim() } : {}),
      ...(d.logoFileId !== undefined ? { logoFileId: d.logoFileId } : {}),
    },
    role: d.role.trim(), workMode: d.workMode, locations: d.locations.map((l) => l.trim()).filter(Boolean),
    jd: d.jd.trim(),
    requirements: d.requirements.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 200)).slice(0, 20),
    ctc: {
      kind: d.ctc.kind ?? 'annual', fixedLpa: num(d.ctc.fixedLpa), variableLpa: num(d.ctc.variableLpa), bonusLpa: num(d.ctc.bonusLpa),
      esopNote: d.ctc.esopNote?.trim() ? d.ctc.esopNote.trim() : null, breakdownProvided: !!d.ctc.breakdownProvided,
    },
    rules: {
      minCgpa: num(d.rules.minCgpa), min10th: num(d.rules.min10th), min12th: num(d.rules.min12th),
      maxActiveBacklogs: num(d.rules.maxActiveBacklogs), maxGapYears: num(d.rules.maxGapYears),
      allowedDepartments: d.rules.allowedDepartments ?? [], allowedBatches: d.rules.allowedBatches ?? [],
    },
    questions: d.questions.map((q) => ({
      ...(q.id && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? { id: q.id } : {}),
      label: q.label.trim(), type: q.type, required: !!q.required, options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
      ...(q.maxLength ? { maxLength: q.maxLength } : {}), ...(q.helpText?.trim() ? { helpText: q.helpText.trim() } : {}),
      ...((q as any).saveToProfileKey && SAVE_KEYS.includes((q as any).saveToProfileKey) ? { saveToProfileKey: (q as any).saveToProfileKey } : {}),
    })),
    rounds: d.rounds.map((r) => ({ name: r.name.trim(), ...(r.mode?.trim() ? { mode: r.mode.trim() } : {}), ...(r.notes?.trim() ? { description: r.notes.trim() } : {}) })),
    policyNote: d.policyNote.trim(),
    contact: {
      ...(d.contactName.trim() ? { name: d.contactName.trim() } : {}),
      ...(d.contactEmail.trim() ? { email: d.contactEmail.trim().toLowerCase() } : {}),
    },
  };
  if (d.deadline) out.deadline = d.deadline;
  return out;
}

export const useDrive = (id?: string) =>
  useQuery({
    queryKey: ['officer', 'drive', id], enabled: !!id,
    queryFn: async () => fromApiDrive(await api.get<any>(`/drives/${id}`)),
  });

/** Create/update/publish/close/duplicate all answer `{ drive }`. Publish failures are 422 DRIVE_INCOMPLETE with the gaps in `error.fields`. */
export const createDrive = async (d: DriveDraft) =>
  ({ id: unwrapDrive(await api.post<any>('/drives', toApiDrive(d))).id as string });
export const updateDrive = async (id: string, d: DriveDraft) =>
  unwrapDrive(await api.put<any>(`/drives/${id}`, toApiDrive(d)));
export const publishDrive = async (id: string) =>
  unwrapDrive(await api.post<any>(`/drives/${id}/publish`, {}));
export const closeDrive = async (id: string) =>
  unwrapDrive(await api.post<any>(`/drives/${id}/close`, {}));
export const duplicateDrive = async (id: string) =>
  ({ id: unwrapDrive(await api.post<any>(`/drives/${id}/duplicate`, {})).id as string });

const CRITERION_LABEL: Record<string, string> = {
  minCgpa: 'Minimum CGPA', min10th: '10th percentage', min12th: '12th percentage', maxActiveBacklogs: 'Active backlogs',
  maxGapYears: 'Gap years', allowedDepartments: 'Department', allowedBatches: 'Batch',
};
/** Server: { total, eligible, notEligible, pending, perReason: { criterion: { failed, missing } } } */
export const eligibleCount = async (id: string): Promise<EligibleCount> => {
  const r = await api.get<any>(`/drives/${id}/eligible-count`);
  const per = (r.perReason ?? {}) as Record<string, { failed?: number; missing?: number }>;
  return {
    total: r.total, eligible: r.eligible ?? 0, notEligible: r.notEligible, pending: r.pending,
    reasons: Object.entries(per)
      .map(([criterion, v]) => ({ criterion, label: CRITERION_LABEL[criterion] ?? criterion, count: (v.failed ?? 0) + (v.missing ?? 0) }))
      .filter((x) => x.count > 0),
  };
};
export const getServerTime = async () => api.get<{ now: string }>('/time');

/** Server items: { applicationId, reference, status, submittedAt, student:{id,name,email,department,cgpa,batchYear,...}, resume }. */
export const useApplicants = (driveId?: string, status?: string) =>
  useInfiniteQuery({
    queryKey: ['officer', 'applicants', driveId, status ?? 'all'], enabled: !!driveId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<any>(`/drives/${driveId}/applicants${qs({ status, limit: 50, cursor: pageParam })}`);
      const items = (Array.isArray(r) ? r : r.items ?? []) as any[];
      return {
        items: items.map((a): Applicant => ({
          id: a.applicationId ?? a.id, reference: a.reference, status: a.status, submittedAt: a.submittedAt,
          student: {
            id: a.student?.id, name: a.student?.name ?? 'Student', department: a.student?.department ?? undefined,
            cgpa: a.student?.cgpa ?? null, batchYear: a.student?.batchYear ?? undefined,
          },
        })),
        nextCursor: (Array.isArray(r) ? null : r.nextCursor ?? null) as string | null,
      };
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

/** Allowed next statuses come from the server (GET /applications/:id -> application.allowedNextStatuses). */
export const useAllowedNext = (applicationId?: string) =>
  useQuery({
    queryKey: ['officer', 'application', applicationId], enabled: !!applicationId, staleTime: 0,
    queryFn: async () => {
      const r = await api.get<any>(`/applications/${applicationId}`);
      const a = r?.application ?? r;
      return { allowed: (a?.allowedNextStatuses ?? []) as string[], events: (a?.events ?? []) as { status: string; note?: string; createdAt: string }[] };
    },
  });

export const setApplicationStatus = async (id: string, status: string, note?: string) =>
  api.post<any>(`/applications/${id}/status`, { status, note: note || undefined });

const VERIFIED_PARAM: Record<string, string> = { verified: 'true', pending: 'false', unverified: 'false' };
/** Server items: { id,name,email,phone,registrationNumber,department,batchYear,cgpa,pendingVerificationFields[],verified:boolean } */
export const useStudents = (p: { q?: string; branch?: string; batch?: string; verified?: string }) =>
  useInfiniteQuery({
    queryKey: ['officer', 'students', p],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<any>(`/students${qs({ ...p, verified: p.verified ? VERIFIED_PARAM[p.verified] : undefined, cursor: pageParam, limit: 20 })}`);
      const items = (r.items ?? []).map((s: any): StudentRow => {
        const pending: string[] = s.pendingVerificationFields ?? s.pendingFields ?? [];
        return {
          id: s.id, name: s.name, email: s.email, department: s.department ?? undefined, batchYear: s.batchYear ?? undefined, cgpa: s.cgpa ?? null,
          pendingFields: pending, verification: s.verified ? 'verified' : pending.length ? 'pending' : 'unverified',
        };
      });
      return { items, nextCursor: (r.nextCursor ?? null) as string | null };
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

/** Server: { student:{id,name,email,phone,...}, identity, academics, contact, links, skills, preferences, verification (dotted keys), pendingVerificationFields, completion, resumes, applications }. */
export const useStudent = (id?: string) =>
  useQuery({
    queryKey: ['officer', 'student', id], enabled: !!id,
    queryFn: async () => {
      const r = await api.get<any>(`/students/${id}`);
      return { ...r, name: r.student?.name, email: r.student?.email, phone: r.student?.phone, id: r.student?.id } as any;
    },
  });

export const verifyStudent = async (id: string, fields: string[]) =>
  api.post<any>(`/students/${id}/verify`, { fields });

export const postAnnouncement = async (b: { title: string; body: string; driveId?: string }) => {
  const r = await api.post<any>('/announcements', b);
  return r?.announcement ?? r;
};
export const useAnnouncements = () =>
  useQuery({ queryKey: ['officer', 'announcements'], queryFn: async () => {
    const r = await api.get<any>('/announcements'); return (Array.isArray(r) ? r : r.items ?? []) as { id: string; title: string; body: string; createdAt: string; audience?: string }[];
  } });

export function useInvalidateOfficer() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['officer'] }),
    qc.invalidateQueries({ queryKey: ['drives'] }),
    qc.invalidateQueries({ queryKey: ['applications'] }),
  ]);
}
export { useMutation };

/** Error helpers */
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

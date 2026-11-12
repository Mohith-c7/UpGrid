/** Types for the Placement Operations API (server/docs/ops-api.md). Kept separate from the shared types file. */

export type Page<T> = { items: T[]; nextCursor?: string | null };

/* ---------- Analytics ---------- */
export interface OpsFilters { batch?: string; department?: string; from?: string; to?: string }
export interface CountPair { applications: number; students: number }
export interface AnalyticsDashboard {
  filters?: Record<string, unknown>;
  kpis: {
    students: number; profileCompletePct: number | null; avgProfileCompletionPct: number | null; verifiedPct: number | null;
    drivesOpen: number; drivesClosed: number; drivesDraft: number; applications: number;
    eligibleVsApplied: { eligibleSlots: number; appliedSlots: number; appliedOfEligiblePct: number | null };
    selected: CountPair; offers: CountPair; accepted: CountPair; joined: CountPair;
  };
  generatedAt: string;
}
export interface PlacementGroupRow { department?: string; batchYear?: number; students: number; placed: number; placedPct: number | null; avgLpa: number | null; highestLpa: number | null }
export interface AnalyticsPlacement {
  totals: { students: number; placedStudents: number; placedPct: number | null; offeredStudents: number; offersIssued: number; offersPerStudent: number | null };
  ctc: { highestLpa: number | null; averageLpa: number | null; medianLpa: number | null; count: number };
  byBranch: PlacementGroupRow[]; byBatch: PlacementGroupRow[];
  byCompany: { company: string; hires: number; avgLpa: number | null; highestLpa: number | null }[];
  ctcBands: { label: string; minLpa: number; maxLpa: number | null; count: number }[];
}
export interface FunnelStage { key: string; label: string; count: number; pctOfApplied: number | null }
export interface AnalyticsFunnel { driveId: string | null; stages: FunnelStage[]; rejected: number; withdrawn: number }
export interface DriveStat {
  id: string; company: string; role: string; status: string; deadline: string | null; publishedAt: string | null;
  completenessScore: number; completenessGaps: string[]; eligibleCount: number; applied: number; appliedOfEligiblePct: number | null;
  deadlineMissEstimate: number; medianHoursToApply: number | null; selected: number; offers: number; accepted: number; joined: number;
}
export interface ReminderStats {
  byKind: { kind: string; pending: number; sent: number; cancelled: number; skipped: number; total: number }[];
  deliveryRatePct: number | null; pushDevices: number;
}
export interface Workload {
  officers: { id: string; name: string; statusChanges30d: number; drivesCreated: number; pendingDocuments: number; openTickets?: number }[];
  unassigned: { applicationsAwaitingScreening: number; documentsPending: number; openTickets: number };
}
export type ExportDataset = 'drives' | 'branches' | 'batches' | 'companies' | 'funnel' | 'students';
export interface ReportPack {
  meta: { tenantName?: string; generatedAt: string; filters?: Record<string, unknown> };
  dashboard: AnalyticsDashboard; placement: AnalyticsPlacement; funnel: AnalyticsFunnel; drives: DriveStat[]; reminders: ReminderStats;
}

/* ---------- Settings ---------- */
export interface OpsSettings {
  publicStatsEnabled: boolean; publicStatsMinGroup: number;
  restrictionApproval: 'required' | 'not_required'; policyApproval: 'required' | 'not_required';
}

/* ---------- Policy ---------- */
export interface PolicyJson {
  schemaVersion: 1;
  oneOffer: { enabled: boolean };
  tiers: { enabled: boolean; dreamMinLpa: number; superDreamMinLpa: number };
  upgrade: { enabled: boolean; multiplier: number };
  defaults: { minCgpa: number | null; maxActiveBacklogs: number | null; maxGapYears: number | null; min10th: number | null; min12th: number | null };
  requireVerifiedAcademics: boolean;
  notes: string;
}
export interface PolicyTemplate { id: string; name: string; description: string; policy: PolicyJson }
export type VersionStatus = 'draft' | 'approved' | 'active' | 'scheduled' | 'superseded' | 'rolled_back' | string;
export interface PolicyVersionSummary {
  id: string; version: number; status: VersionStatus; effectiveFrom: string | null; note: string | null;
  createdBy?: string | null; approvedBy?: string | null; activatedAt?: string | null; createdAt: string;
}
export interface PolicyVersion extends PolicyVersionSummary { policy: PolicyJson; policyId?: string }
export interface PolicyListItem {
  id: string; name: string; description: string | null;
  activeVersion: { id: string; version: number; status: string } | null; latestVersion: number | null; updatedAt: string;
}
export interface PolicyDetail { policy: { id: string; name: string; description: string | null; [k: string]: unknown }; versions: PolicyVersionSummary[] }
export interface ActivePolicy {
  policy: PolicyJson | null;
  version: { id: string; version: number; policyId: string; name: string; effectiveFrom: string | null } | null;
}
export interface ValidateDraftResult { valid: boolean; errors: { path: string; message: string }[]; warnings: string[]; normalized: PolicyJson | null }
export interface SimCounts { eligible: number; notEligible: number; pending: number; restricted: number }
export interface SimulateResult {
  against: { currentVersion: unknown; candidate: string }; drives: number; current: SimCounts; candidate: SimCounts;
  perReason: { criterion: string; failed: number; missing: number }[];
  diff: { newlyEligible: number; newlyIneligible: number; newlyPending: number; unchanged: number };
  samples: {
    newlyIneligible: { studentId: string; name: string; driveId: string; reason: string }[];
    newlyEligible: { studentId: string; name: string; driveId: string; reason: string }[];
  };
}
export type Condition =
  | { field: string; op: string; value?: unknown }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };
export interface ValidateConditionsResult { valid: boolean; errors: { path: string; message: string }[] }
export interface AiPolicyDraft {
  draft: true; approved: false;
  rules: { minCgpa?: number | null; min10th?: number | null; min12th?: number | null; maxActiveBacklogs?: number | null; maxGapYears?: number | null; allowedDepartments?: string[]; allowedBatches?: number[] };
  explanation: string; unsupported: string[];
  simulation?: { total: number; eligible: number; not_eligible: number; pending: number; byCriterion?: Record<string, number> };
}

/* ---------- Restrictions ---------- */
export type RestrictionScope = 'student' | 'company' | 'drive' | 'department' | 'batch' | 'tenant';
export interface Restriction {
  id: string; scope: RestrictionScope; scopeValue: string | null; studentId: string | null; reason: string; studentMessage: string;
  evidenceNotes: string | null; status: string; effectiveStatus: string; startsAt: string | null; endsAt: string | null;
  requestedBy: string | null; approvedBy: string | null; approvedAt: string | null; liftedBy: string | null; liftedAt: string | null;
  liftReason: string | null; exemptStudentIds?: string[]; createdAt: string;
}
export interface RestrictionHistory { id: string; type: string; actorId: string | null; actorName: string | null; note: string | null; createdAt: string }
export interface Appeal {
  id: string; restrictionId: string; studentId: string; studentName: string; message: string; status: string; createdAt: string;
  decisionNote?: string | null; restriction?: { scope: string; studentMessage: string };
}
export interface RestrictionDetail { restriction: Restriction; history: RestrictionHistory[]; appeals: Appeal[] }
export interface RestrictionInput {
  scope: RestrictionScope; scopeValue?: string; studentId?: string; reason: string; studentMessage: string; evidenceNotes?: string;
  startsAt?: string; endsAt?: string;
}

/* ---------- Cohorts ---------- */
export interface CohortFilter {
  departments?: string[]; batches?: number[]; minCgpa?: number; maxCgpa?: number; maxActiveBacklogs?: number; verified?: boolean;
  placement?: 'placed' | 'unplaced' | 'offered'; appliedToDriveId?: string; notAppliedToDriveId?: string; registrationPrefix?: string;
}
export interface Cohort { id: string; name: string; description: string | null; kind: 'dynamic' | 'fixed'; filter: CohortFilter | null; memberCount: number; createdAt: string; updatedAt: string }
export interface CohortMember { id: string; name: string; registrationNumber: string | null; department: string | null; batchYear: number | null; cgpa: number | null }
export interface CohortPreview { count: number; sample: { id: string; name: string; department: string | null; batchYear: number | null }[] }

/* ---------- Announcements v2 ---------- */
export type Audience =
  | { type: 'all' } | { type: 'cohort'; cohortId: string }
  | { type: 'drive_participants'; driveId: string } | { type: 'eligible_not_applied'; driveId: string };
export interface AnnouncementV2 {
  id: string; title: string; body: string; status: 'draft' | 'scheduled' | 'sent'; audience: Audience; sendAt: string | null; sentAt: string | null;
  pinned: boolean; expiresAt: string | null; channels: { inApp: boolean; push: boolean; email: boolean }; templateId: string | null;
  recipients: number; delivered: number; read: number; createdAt: string; audienceCount?: number;
}
export interface AnnouncementInput {
  title: string; body: string; audience: Audience; channels?: { inApp: boolean; push: boolean; email: boolean };
  sendAt?: string | null; pinned?: boolean; expiresAt?: string | null; templateId?: string | null; draft?: boolean;
}
export interface AnnouncementTemplate { id: string; name: string; title: string; body: string }

/* ---------- Calendar ---------- */
export interface CalendarItem {
  id: string; kind: string; title: string; startsAt: string; endsAt: string | null; driveId: string | null; applicationId: string | null;
  refId?: string | null; detail?: string | null; link?: string | null;
}
export interface FeedTokenStatus { active: boolean; createdAt?: string | null }
export interface FeedTokenCreated { token: string; url: string }

/* ---------- CRM ---------- */
export type CompanyStage = 'prospect' | 'contacted' | 'interested' | 'mou' | 'hiring';
export interface CompanyContact { name: string; role?: string; email?: string; phone?: string }
export interface CrmCompany {
  id: string; name: string; website: string | null; industry: string | null; hq: string | null; contacts: CompanyContact[]; notes: string | null;
  tags: string[]; verified: boolean; logoFileId: string | null; stage: CompanyStage; createdAt: string; updatedAt: string;
  driveCount: number; lastInteractionAt: string | null; nextFollowUpAt: string | null;
  drives?: { id: string; role?: string; status?: string; company?: string; deadline?: string | null }[];
}
export interface Interaction { id: string; type: 'call' | 'meeting' | 'email' | 'other'; occurredAt: string; summary: string; followUpAt: string | null; followUpDone?: boolean; createdAt?: string }
export interface CompanyInput {
  name: string; website?: string; industry?: string; hq?: string; contacts?: CompanyContact[]; notes?: string; tags?: string[];
  verified?: boolean; stage?: CompanyStage; force?: boolean;
}
export interface DuplicateGroup { key: string; companies: { id: string; name: string; website: string | null }[] }

/* ---------- Audit ---------- */
export interface AuditEntry { id: string; actorId: string | null; actorName: string | null; action: string; entityType: string | null; entityId: string | null; meta: Record<string, unknown> | null; createdAt: string }
export interface AuditFilters { actorId?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; q?: string }

/* ---------- Documents ---------- */
export type DocType = 'marksheet' | 'id_proof' | 'resume' | 'certificate' | 'offer_letter' | 'other';
export interface VerifyDoc {
  id: string; studentId: string; docType: DocType; label: string; fileId: string | null; url: string | null; status: 'pending' | 'verified' | 'rejected';
  rejectReason: string | null; reviewedBy: string | null; reviewedAt: string | null; createdAt: string;
  student?: { id: string; name: string; registrationNumber: string | null; department: string | null };
}

// Types for the student extras API (ops-api.md sections 1, 3, 6, 9 student sides). Kept separate from api/types.ts.

/* ---------- restrictions ---------- */
export interface MyRestrictionAppeal { id: string; status: 'pending' | 'upheld' | 'overturned' | string; decisionNote?: string | null }
export interface MyRestriction {
  id: string;
  scope: 'student' | 'company' | 'drive' | 'department' | 'batch' | 'tenant' | string;
  /** respectful message written for the student; internal reason and evidence are never sent */
  message: string;
  startsAt?: string | null;
  endsAt?: string | null;
  canAppeal: boolean;
  appeal: MyRestrictionAppeal | null;
  appealPath?: string;
}
export interface MyRestrictionsResponse { items: MyRestriction[] }

/* ---------- public campus stats ---------- */
export interface PublicStats {
  enabled: boolean;
  minGroupSize?: number;
  totals?: { students: number; placedPct: number | null };
  byBranch?: { department: string; students: number; placedPct: number | null }[];
  byBatch?: { batchYear: number; students: number; placedPct: number | null }[];
  ctc?: { averageLpa: number | null; medianLpa: number | null; highestLpa: number | null } | null;
  suppressedGroups?: number;
}

/* ---------- calendar ---------- */
export type CalendarKind = 'deadline' | 'test' | 'interview' | 'assessment' | 'offer_expiry' | 'drive_closing' | 'attendance';
export interface CalendarItem {
  id: string;
  kind: CalendarKind | string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  driveId?: string | null;
  applicationId?: string | null;
  refId?: string | null;
  detail?: string | null;
  link?: string | null;
}
export interface FeedTokenStatus { active: boolean; createdAt?: string | null }
export interface FeedTokenCreated { token: string; url: string }

/* ---------- documents (verification status) ---------- */
export type DocType = 'marksheet' | 'id_proof' | 'resume' | 'certificate' | 'offer_letter' | 'other';
export interface MyDocument {
  id: string; docType: DocType | string; label: string; status: 'pending' | 'verified' | 'rejected' | string;
  rejectReason?: string | null; reviewedAt?: string | null; createdAt?: string;
}
export interface MyDocuments {
  items: MyDocument[];
  completion?: { required: string[]; verified: string[]; percent: number };
}

/* ---------- apply gate codes ---------- */
export type ApplyGateCode = 'EMAIL_NOT_VERIFIED' | 'PHONE_REQUIRED' | 'RESTRICTED';

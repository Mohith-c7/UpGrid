/** Types for the hiring-pipeline API (server/docs/pipeline-api.md). */

export type RoundKind = 'aptitude' | 'assessment' | 'coding' | 'technical' | 'hr' | 'gd' | 'custom';
export type RoundMode = 'online' | 'in_person';
export type RoundCandStatus = 'pending' | 'invited' | 'attended' | 'absent' | 'passed' | 'failed' | 'on_hold';
export type StudentRoundStatus = RoundCandStatus | 'pending_results';

export const RECRUITER_PERMISSIONS = [
  'viewCandidates', 'shortlist', 'notes', 'scorecards', 'proposeSlots', 'proposeOutcomes', 'proposeOffers', 'uploadResults', 'markAttendance', 'message',
] as const;
export type RecruiterPermission = (typeof RECRUITER_PERMISSIONS)[number];
export type PermissionMap = Record<RecruiterPermission, boolean>;

/* ---------------------------------------------------------------- recruiters */
export interface RecruiterMember {
  userId: string; name: string; email: string; phoneDisplay?: string | null;
  permissions: PermissionMap; addedAt: string; revokedAt?: string | null;
}
export interface RecruiterInvite {
  id: string; email: string; name?: string | null; status: 'pending' | 'expired' | 'revoked' | 'accepted';
  expiresAt: string; createdAt: string; permissions?: PermissionMap; driveId?: string;
}
export interface RecruitersResponse { members: RecruiterMember[]; invites: RecruiterInvite[] }
export interface InviteResult {
  invite?: RecruiterInvite | null; member?: RecruiterMember | null; inviteToken?: string; emailSent?: boolean;
  inAppNotified?: boolean; reissued?: boolean;
}

/* -------------------------------------------------------------------- rounds */
export interface Round {
  id: string; driveId: string; seq: number; name: string; kind: RoundKind; assessmentId?: string | null;
  description?: string | null; mode?: RoundMode | null; venueOrLink?: string | null; scheduledAt?: string | null;
  resultsPublishedAt?: string | null; counts?: Record<string, number>;
}
export interface RoundBody {
  name?: string; kind?: RoundKind; description?: string | null; mode?: RoundMode | null; venueOrLink?: string | null; scheduledAt?: string | null;
}
export interface RubricItem { id?: string; label: string; description?: string | null }
export interface Rubric { id: string; roundId: string | null; version: number; items: RubricItem[] }
export interface RubricResponse { rubric: Rubric | null; effective?: boolean }

/* ---------------------------------------------------------------- candidates */
export interface RoundCandidate {
  applicationId: string; reference: string; name: string; department?: string | null; cgpa?: number | null;
  applicationStatus: string; status: RoundCandStatus; waitlisted: boolean; waitlistRank?: number | null;
  remark?: string | null; score?: number | null; avgScore?: number | null; updatedAt?: string;
}
export interface RoundCandidatesPage { items: RoundCandidate[]; nextCursor?: string | null; counts?: Record<string, number> }
export interface BulkResult { updated?: number; unchanged?: number; failed?: { applicationId?: string; row?: number; reference?: string; reason: string }[]; added?: number; alreadyIn?: number; promoted?: number }
export interface ResultRow { applicationId?: string; reference?: string; result: 'passed' | 'failed' | 'absent' | 'on_hold'; score?: number; remark?: string }
export interface ResultsUploadResult { total: number; updated: number; unchanged: number; failed: { row: number; reference?: string; reason: string }[] }

export interface AdvanceOptions { applicationIds?: string[]; toRoundId?: string; capacity?: number }
export interface AdvancePerson { applicationId: string; name?: string; avgScore?: number | null }
export interface AdvancePreview {
  fromRound: { id: string; name: string }; toRound: { id: string; name: string };
  toInvite: AdvancePerson[]; toWaitlist: AdvancePerson[]; skipped: { applicationId: string; name?: string; reason: string }[];
  counts?: Record<string, number>;
}
export interface AdvanceResult { moved: AdvancePerson[]; waitlisted: AdvancePerson[]; skipped: { applicationId: string; reason: string }[]; replayed: boolean }

export interface AttendanceToken { token: string; qrPayload: string; session: string; validFrom: string; validUntil: string }
export interface ScanResult { attended: boolean; replayed: boolean; round: { id: string; name: string }; driveId: string; markedAt: string }

export interface Funnel {
  applications: { total: number; byStatus: Record<string, number> };
  rounds: { roundId: string; name: string; seq: number; kind: RoundKind; pending: number; invited: number; attended: number; absent: number; passed: number; failed: number; onHold: number; waitlisted: number; total: number }[];
  decisions: { shortlisted?: number; rejected?: number; on_hold?: number };
  offers: Record<string, number>;
}

/* ------------------------------------------------------------- student side */
export interface StudentRound { roundId: string; name: string; kind: RoundKind; seq: number; status: StudentRoundStatus; waitlisted: boolean }
export interface StudentSlot {
  id: string; roundId: string; roundName: string; startsAt: string; endsAt: string; mode: RoundMode; venueOrLink?: string | null;
  instructions?: string | null; remaining: number;
}
export interface Booking { id: string; slotId: string; roundId: string; startsAt: string; endsAt: string; mode: RoundMode; venueOrLink?: string | null; status: string }
export interface StudentSlotsResponse { items: StudentSlot[]; booking: Booking | null }

export interface OfferCtc {
  fixedLpa: number; variableLpa?: number | null; bonusLpa?: number | null; joiningBonusLpa?: number | null; esopNote?: string | null;
  other?: { label: string; amountLpa: number }[]; totalLpa?: number | null;
}
export type OfferStatus = 'pending_approval' | 'rejected' | 'issued' | 'accepted' | 'declined' | 'expired' | 'revoked' | 'joined';
export interface OfferPolicy { result: 'allowed' | 'needs_override' | 'blocked'; reasons: { code: string; message: string }[] }
export interface Offer {
  id: string; applicationId: string; driveId: string; status: OfferStatus; kind: 'annual' | 'stipend_monthly'; ctc: OfferCtc;
  joiningDate?: string | null; location?: string | null; expiresAt?: string | null; letter?: { fileId?: string | null; url?: string | null } | null;
  notes?: string | null; tier?: 'regular' | 'dream' | 'super_dream'; policy?: OfferPolicy; overrideReason?: string | null;
  proposedBy?: { id: string; name: string; role: string }; approvedBy?: unknown; rejectedReason?: string | null; revokedReason?: string | null;
  createdAt?: string; issuedAt?: string | null; respondedAt?: string | null; joinedAt?: string | null;
  candidate?: { name: string; applicationReference?: string };
  canRespond?: boolean;
}
export interface OfferBody {
  ctc: { fixedLpa: number; variableLpa?: number; bonusLpa?: number; joiningBonusLpa?: number; esopNote?: string };
  joiningDate: string; location: string; expiresAt: string; letterUrl?: string; notes?: string; overrideReason?: string;
}

/* ------------------------------------------------------------------- slots */
export interface Slot {
  id: string; driveId: string; roundId: string; startsAt: string; endsAt: string; mode: RoundMode; venueOrLink?: string | null;
  instructions?: string | null; capacity: number; booked: number; status: 'proposed' | 'open' | 'cancelled' | 'declined';
  panel?: { userId: string; name: string; role: string }[]; proposedBy?: { id: string; name: string; role?: string } | string | null; createdAt?: string;
}
export interface SlotInput { startsAt: string; endsAt: string; mode: RoundMode; venueOrLink: string; instructions?: string; capacity?: number }

/* ---------------------------------------------------------------- outcomes */
export interface Outcome {
  id: string; applicationId: string; kind: 'select' | 'reject'; reason?: string | null; status: 'pending' | 'approved' | 'declined';
  proposedBy?: { id: string; name: string }; decidedBy?: { id: string; name: string } | null; decidedAt?: string | null; decisionNote?: string | null;
  createdAt: string; candidate?: { name?: string; applicationReference?: string; reference?: string; department?: string | null };
}

export interface CandidateRow {
  applicationId: string; reference: string; status: string; candidate: { name: string; department?: string | null; cgpa?: number | null };
  hasOffer?: boolean; decision?: string | null;
}

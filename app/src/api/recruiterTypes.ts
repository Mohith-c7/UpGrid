/** Types for the recruiter + hiring pipeline API (server/docs/pipeline-api.md). */

export type RecruiterPermissionKey =
  | 'viewCandidates' | 'shortlist' | 'notes' | 'scorecards' | 'proposeSlots'
  | 'proposeOutcomes' | 'proposeOffers' | 'uploadResults' | 'markAttendance' | 'message';
export type RecruiterPermissions = Partial<Record<RecruiterPermissionKey, boolean>>;

export interface InviteInfo { email: string; name?: string | null; driveId: string; companyName: string; role: string; expiresAt: string }
export interface RegisterRecruiterBody { inviteToken: string; name: string; phone: string; password: string; acceptTerms: true }
export interface RecruiterAuthResponse {
  user: import('./types').User; accessToken: string; refreshToken: string;
  memberships?: { driveId: string; permissions: RecruiterPermissions }[];
}

export interface DriveCounts { candidates: number; shortlisted: number; rejected: number; inRounds: number; offers: number }
export interface RecruiterDriveItem {
  driveId: string;
  company: { name: string; logoUrl?: string | null; industry?: string | null; verified?: boolean };
  role: string; status: string; deadline?: string | null; permissions: RecruiterPermissions; counts: DriveCounts;
}
export interface PipelineSettings { autoAcceptSlotProposals: boolean; showUnscreened: boolean; slotCancelCutoffMinutes: number; blindScorecards: boolean }
export type RoundKind = 'aptitude' | 'assessment' | 'coding' | 'technical' | 'hr' | 'gd' | 'custom';
export interface Round {
  id: string; driveId: string; seq: number; name: string; kind: RoundKind; assessmentId?: string | null; description?: string | null;
  mode?: 'online' | 'in_person' | null; venueOrLink?: string | null; scheduledAt?: string | null; resultsPublishedAt?: string | null;
  counts?: Record<string, number>;
}
export interface FunnelRound {
  roundId: string; name: string; seq: number; kind: RoundKind;
  pending: number; invited: number; attended: number; absent: number; passed: number; failed: number; onHold: number; waitlisted: number; total: number;
}
export interface Funnel {
  applications: { total: number; byStatus: Record<string, number> };
  rounds: FunnelRound[];
  decisions: { shortlisted: number; rejected: number; on_hold: number };
  offers: Record<string, number>;
}
export interface RecruiterDriveDetail {
  drive: {
    id: string; company: { name: string; logoUrl?: string | null; industry?: string | null; verified?: boolean }; role: string; workMode?: string | null;
    locations?: string[]; ctc?: import('./types').Ctc | null; jd?: string | null; requirements?: unknown; status: string; deadline?: string | null;
  };
  permissions: RecruiterPermissions; settings: PipelineSettings; rounds: Round[]; funnel: Funnel;
}

export type Decision = 'shortlisted' | 'rejected' | 'on_hold';
export interface SharedFields {
  name: string | null; email: string | null; phone: string | null; phoneDisplay?: string | null; registrationNumber: string | null;
  department: string | null; program: string | null; batchYear: number | null; cgpa: number | null; cgpaScale?: number | null;
  tenthPercent: number | null; twelfthPercent: number | null; activeBacklogs: number | null; gapYears: number | null; linkedin: string | null;
}
export interface CandidateRow {
  applicationId: string; reference: string; status: string; submittedAt: string; candidate: SharedFields; resume: { label: string };
  decision: Decision | null; decisionReason?: string | null;
  currentRound: { roundId: string; name: string; seq: number; status: string } | null;
  scorecardCount: number; avgScore: number | null; hasOffer: boolean;
}
export interface CandidatePage { items: CandidateRow[]; nextCursor: string | null; total: number }
export interface CandidateQuery { q?: string; status?: string; decision?: string; roundId?: string; roundStatus?: string; sort?: 'newest' | 'name' | 'cgpa' | 'score' }

export interface Note { id: string; body: string; visibility: 'team' | 'private'; author: { id: string; name: string; role: string }; createdAt: string }
export type Recommendation = 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
export interface Scorecard {
  id: string; roundId: string; applicationId: string; recruiter: { id: string; name: string };
  ratings: { itemId: string; label: string; rating: number }[]; overall: number; comments?: string | null;
  recommendation: Recommendation; rubricVersion: number; revision: number; submittedAt: string; updatedAt: string;
}
export interface Outcome {
  id: string; applicationId: string; kind: 'select' | 'reject'; reason?: string | null; status: 'pending' | 'approved' | 'declined';
  proposedBy: { id: string; name: string }; decidedAt?: string | null; decisionNote?: string | null; createdAt: string;
}
export interface Rubric { id: string; roundId: string | null; version: number; items: { id: string; label: string; description?: string | null }[] }

export type OfferStatus = 'pending_approval' | 'rejected' | 'issued' | 'accepted' | 'declined' | 'expired' | 'revoked' | 'joined';
export interface OfferCtc { fixedLpa: number; variableLpa?: number; bonusLpa?: number; joiningBonusLpa?: number; esopNote?: string; other?: { label: string; amountLpa: number }[]; totalLpa?: number }
export interface PolicyResult { result: 'allowed' | 'needs_override' | 'blocked'; reasons: { code: string; message: string }[]; tier?: string; existing?: unknown[] }
export interface Offer {
  id: string; applicationId: string; driveId: string; status: OfferStatus; kind: 'annual' | 'stipend_monthly'; ctc: OfferCtc;
  joiningDate?: string | null; location?: string | null; expiresAt?: string | null; notes?: string | null; tier?: string;
  policy?: PolicyResult; rejectedReason?: string | null; revokedReason?: string | null; createdAt: string; issuedAt?: string | null;
  candidate?: { name: string; applicationReference?: string };
}
export interface OfferSummary { id: string; status: OfferStatus; totalLpa?: number | null }

export interface CandidateDetail {
  applicationId: string; reference: string; status: string; submittedAt: string;
  fields: SharedFields; fieldKeys: string[]; verification?: Record<string, string>;
  resume: { label: string; url?: string | null; signed?: boolean; expiresAt?: string | null };
  answers: { id: string; label: string; value: unknown }[];
  events: { status: string; note?: string | null; actorRole: string; createdAt: string }[];
  rounds: { roundId: string; name: string; seq: number; kind: RoundKind; status: string; waitlisted?: boolean }[];
  decision: Decision | null; decisionReason?: string | null;
  notes: Note[]; scorecards: Scorecard[];
  scoreSummary?: { count: number; avg: number | null; byRecommendation?: Record<string, number> };
  schedule?: unknown; outcome: Outcome | null; offer: OfferSummary | null;
}

export interface Slot {
  id: string; driveId: string; roundId: string; startsAt: string; endsAt: string; mode: 'online' | 'in_person'; venueOrLink: string; instructions?: string | null;
  capacity: number; booked: number; status: 'proposed' | 'open' | 'cancelled' | 'declined';
  panel: { userId: string; name: string; role?: string }[]; proposedBy?: { id: string; name: string; role?: string } | string | null; createdAt?: string;
}
export interface SlotInput { startsAt: string; endsAt: string; mode: 'online' | 'in_person'; venueOrLink: string; instructions?: string; capacity?: number }

export type RoundCandidateStatus = 'pending' | 'invited' | 'attended' | 'absent' | 'passed' | 'failed' | 'on_hold';
export interface RoundCandidate {
  applicationId: string; reference: string; name: string; department?: string | null; cgpa?: number | null; applicationStatus: string;
  status: RoundCandidateStatus; waitlisted: boolean; waitlistRank?: number | null; remark?: string | null; score?: number | null; avgScore?: number | null; updatedAt?: string;
}
export interface BulkResult { updated?: number; unchanged?: number; failed?: { applicationId: string; reason: string }[] }
export interface AttendanceToken { token: string; qrPayload: string; session: string; validFrom: string; validUntil: string }

export interface Message { id: string; body: string; author: { id: string; name: string; role: string }; createdAt: string }
export interface Paged<T> { items: T[]; nextCursor: string | null }

export type Role = 'student' | 'officer' | 'recruiter';
export type Verification = 'unverified' | 'verified' | 'student_confirmed';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
}
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface CompletionItem { key: string; label: string; done: boolean; why: string }
export interface Completion { percent: number; items: CompletionItem[]; nextStep: string | null }
export interface Verified<T> { value: T; verification: Verification }

export interface Profile {
  identity: { registrationNumber?: string | null; preferredName?: string | null; name?: string; email?: string; phone?: string | null };
  academics: {
    university?: string | null; department?: string | null; program?: string | null;
    batchYear?: number | null; semester?: number | null; cgpa?: number | null; cgpaScale?: number | null;
    tenthPercent?: number | null; twelfthPercent?: number | null; activeBacklogs?: number | null; gapYears?: number | null;
  };
  contact: { city?: string | null; state?: string | null };
  links: { linkedin?: string | null; github?: string | null; portfolio?: string | null };
  skills: string[];
  preferences: { roles?: string[]; locations?: string[]; workMode?: string | null; relocate?: boolean | null };
  verification?: Record<string, Verification>;
  resumes?: Resume[];
  completion: Completion;
}
export type ProfilePatch = Partial<{
  identity: Partial<Profile['identity']>;
  academics: Partial<Profile['academics']>;
  contact: Partial<Profile['contact']>;
  links: Partial<Profile['links']>;
  skills: string[];
  preferences: Partial<Profile['preferences']>;
}>;
export interface Resume { id: string; label: string; url: string; isDefault: boolean; createdAt?: string }

export type DriveStatus = 'draft' | 'open' | 'closing' | 'closed';
export type EligibilityStatus = 'eligible' | 'not_eligible' | 'pending' | 'restricted';
export interface EligibilityReason {
  criterion: string; required: string | number | string[] | null; actual: string | number | null; met: boolean | null;
  source?: string; verification?: Verification;
}
export interface Eligibility { status: EligibilityStatus; reason?: string; reasons?: EligibilityReason[] }
export interface Ctc {
  fixedLpa?: number | null; variableLpa?: number | null; bonusLpa?: number | null; esopNote?: string | null;
  breakdownProvided: boolean; kind: 'annual' | 'stipend_monthly';
  totalLpa?: number | null; stipendMonthly?: number | null;
}
export interface Company { name: string; logoUrl?: string | null; industry?: string | null; verified?: boolean }
export interface DriveSummary {
  id: string; company: Company; role: string; workMode?: string | null; locations: string[]; ctc: Ctc;
  deadline: string; status: DriveStatus; eligibility: Eligibility; saved: boolean; applied: boolean;
}
export type QuestionType = 'short_text' | 'long_text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'yes_no' | 'url' | 'declaration';
export interface Question {
  id: string; label: string; type: QuestionType; required: boolean; options?: string[]; maxLength?: number;
  helpText?: string; saveToProfileKey?: string;
}
export interface Round { name: string; mode?: string; date?: string | null; description?: string }
export interface DriveDetail extends DriveSummary {
  description?: string; jd?: string; requirements?: string[] | string; rounds?: Round[]; questions?: Question[];
  policyNote?: string; contact?: { name?: string; email?: string; phone?: string } | string | null;
  lastVerifiedAt?: string | null; dataSharedPreview?: string[]; rules?: Record<string, unknown>;
  employmentType?: string; bondNote?: string | null; offerType?: string;
}
export interface DriveList { items: DriveSummary[]; nextCursor: string | null }
export interface DriveQuery {
  q?: string; status?: 'open' | 'closing' | 'closed'; eligibility?: EligibilityStatus; sort?: 'closing' | 'newest' | 'package'; saved?: boolean;
}

export interface MappedField {
  key: string; label: string; value: string | number | null; source: string; verification: Verification; sharedWith?: string;
}
export interface ResumeOption { id: string; label: string; url?: string; isDefault?: boolean }
export interface ApplyPreview {
  mapped: MappedField[]; conflicts: { key: string; message: string }[]; missingProfileFields: { key: string; label: string }[];
  questionsToAsk: Question[]; resumeOptions?: ResumeOption[]; resumes?: ResumeOption[]; deadline: string; serverNow: string;
  canApply: boolean; blockedReason?: string; blockedCode?: string;
}
export interface ApplyBody {
  idempotencyKey: string; resumeId: string | null; answers: Record<string, unknown>; declarationsAccepted: true; saveToProfile?: string[];
}
export interface ApplyReceipt { application: { id: string; reference: string; submittedAt: string } }

export type AppStatus = 'submitted' | 'screening' | 'assessment' | 'interview' | 'selected' | 'offer_issued' | 'offer_accepted' | 'offer_declined' | 'rejected' | 'withdrawn' | 'joined';
export interface ApplicationEvent { id?: string; status: AppStatus; at: string; note?: string | null; by?: string }
export interface Application {
  id: string; reference: string; status: AppStatus; submittedAt: string; updatedAt?: string;
  drive: { id: string; role: string; company: Company; deadline?: string };
  events?: ApplicationEvent[];
  student?: { id: string; name: string; email?: string; department?: string; cgpa?: number | null };
  answers?: Record<string, unknown>; canWithdraw?: boolean; resumeLabel?: string;
  /** Student view: true only while status is offer_issued. */
  canRespondToOffer?: boolean;
  /** Interview/assessment schedule posted by the placement cell, or null. */
  schedule?: Schedule | null;
}
export type OfferDecision = 'accept' | 'decline';
export interface RespondToOfferBody { decision: OfferDecision; note?: string }
export interface RespondToOfferResult { application: { id: string; status: AppStatus }; replayed: boolean }
/** PATCH /me: any subset of these; role cannot be changed. */
export interface UpdateMeBody { name?: string; email?: string; phone?: string }

export interface Notification {
  id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null; data?: { driveId?: string; applicationId?: string } | null;
}
export interface ReminderSettings {
  t60: boolean; t30: boolean; t15: boolean; push: boolean; inApp: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}

// Officer
export interface DashboardData {
  openDrives: number; closingToday: number; applicationsToday: number; pendingVerifications: number;
  upcoming: { id: string; company: string | Company; role: string; deadline: string }[];
}
export interface EligibleCount { total: number; eligible: number; notEligible?: number; pending?: number; byReason?: Record<string, number> }
export interface StudentSummary {
  id: string; name: string; email?: string; department?: string | null; batchYear?: number | null; cgpa?: number | null;
  verified?: boolean; pendingFields?: string[]; completionPercent?: number;
}
export interface StudentDetail extends StudentSummary { profile?: Profile; applications?: Application[] }
export interface Announcement { id: string; title: string; body: string; driveId?: string | null; createdAt: string }
export interface DrivePayload {
  companyName?: string; role?: string; description?: string; workMode?: string; locations?: string[];
  ctc?: Partial<Ctc>; deadline?: string; rules?: Record<string, unknown>; rounds?: Round[]; questions?: Question[];
  policyNote?: string; contact?: unknown; [k: string]: unknown;
}
export interface Page<T> { items: T[]; nextCursor: string | null }

export interface ApiErrorBody { error: { code: string; message: string; fields?: Record<string, string> } }

// ---- Foundation additions ----
export interface ProfileResponse extends Profile {
  user?: User;
}
export interface RegisterBody {
  name: string; email: string; phone: string; password: string; role: Exclude<Role, 'recruiter'>; inviteCode?: string; acceptTerms: true;
}

// ---- Scheduling ----
export type ScheduleType = 'assessment' | 'interview';
export type ScheduleMode = 'online' | 'in_person';
export interface Schedule {
  type: ScheduleType; scheduledAt: string; mode: ScheduleMode; venueOrLink: string; instructions?: string | null;
}
export interface ScheduleBody {
  type: ScheduleType; scheduledAt: string; mode: ScheduleMode; venueOrLink: string; instructions?: string;
}
export interface BulkScheduleBody extends ScheduleBody { applicationIds: string[] }
export interface BulkScheduleResult { scheduled: number; failed: { applicationId: string; reason: string }[] }

// ---- Student import ----
export interface StudentImportRow {
  registrationNumber: string; email?: string; department?: string; program?: string; batchYear?: number; semester?: number;
  cgpa?: number; cgpaScale?: number; tenthPercent?: number; twelfthPercent?: number; activeBacklogs?: number; gapYears?: number;
}
export interface StudentImportResult {
  total: number; updated: number; unchanged: number;
  unmatched: { row: number; registrationNumber: string; reason: string }[];
  invalid: { row: number; registrationNumber: string; fields: Record<string, string> | string[] | string }[];
}

// ---- Support tickets ----
export type TicketCategory = 'profile' | 'eligibility' | 'application' | 'document' | 'other';
export type TicketStatus = 'open' | 'resolved';
export interface Ticket {
  id: string; category: TicketCategory; subject: string; status: TicketStatus; message?: string;
  createdAt: string; updatedAt?: string; lastMessageAt?: string | null; messageCount?: number;
  student?: { id: string; name: string } | null;
}
export interface TicketMessage {
  id: string; author: { id: string; name: string; role: Role }; message: string; createdAt: string;
}
export interface TicketThread { ticket: Ticket; messages: TicketMessage[] }
export interface NewTicketBody { category: TicketCategory; subject: string; message: string }

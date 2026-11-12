export type DriveStatus = 'draft' | 'pending_approval' | 'open' | 'closing' | 'closed';

export type QuestionType =
  | 'short_text' | 'long_text' | 'number' | 'date' | 'single_select'
  | 'multi_select' | 'yes_no' | 'url' | 'declaration';

export interface DriveQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  maxLength?: number;
  helpText?: string;
}

export interface DriveRound { name: string; mode?: string; notes?: string }

export interface DriveRules {
  minCgpa?: number | null;
  min10th?: number | null;
  min12th?: number | null;
  maxActiveBacklogs?: number | null;
  maxGapYears?: number | null;
  allowedDepartments?: string[];
  allowedBatches?: number[];
}

export interface DriveCtc {
  providedStatus?: 'provided' | 'not_provided';
  kind?: 'annual' | 'stipend_monthly';
  fixedLpa?: number | null;
  variableLpa?: number | null;
  bonusLpa?: number | null;
  esopNote?: string;
  breakdownProvided?: boolean;
}

/** Shape the stepper edits. Mapped to/from the API in data.ts. */
export interface DriveDraft {
  id?: string;
  status?: DriveStatus;
  companyName: string;
  industry: string;
  companyWebsite: string;
  /** set by LogoUploader: file id to send as company.logoFileId (null clears, undefined leaves unchanged) */
  logoFileId?: string | null;
  /** current/preview logo url (display only) */
  logoUrl?: string | null;
  role: string;
  workMode: 'onsite' | 'hybrid' | 'remote';
  locations: string[];
  jd: string;
  requirements: string;
  ctc: DriveCtc;
  rules: DriveRules;
  questions: DriveQuestion[];
  rounds: DriveRound[];
  policyNote: string;
  contactName: string;
  contactEmail: string;
  opensAt: string | null; // ISO UTC
  deadline: string | null; // ISO UTC
}

export interface DriveItem {
  id: string;
  company: { name: string; logoUrl?: string | null; industry?: string; verified?: boolean };
  role: string;
  workMode?: string;
  locations?: string[];
  ctc?: DriveCtc;
  deadline?: string | null;
  status: DriveStatus;
  applicantCount?: number;
}

export interface EligibleCount {
  eligible: number;
  notEligible?: number;
  pending?: number;
  total?: number;
  reasons?: { criterion: string; count: number; label?: string }[];
}

export interface Applicant {
  id: string; // application id
  reference?: string;
  status: string;
  submittedAt?: string;
  student: { id: string; name: string; department?: string; cgpa?: number | null; batchYear?: number };
  allowedNext?: string[];
}

export interface StudentRow {
  id: string;
  name: string;
  email?: string;
  department?: string;
  batchYear?: number;
  cgpa?: number | null;
  verification?: 'verified' | 'unverified' | 'partial' | 'student_confirmed' | 'pending';
  pendingFields?: string[];
}

export const EMPTY_DRAFT: DriveDraft = {
  companyName: '', industry: '', companyWebsite: '', role: '', workMode: 'onsite',
  locations: [], jd: '', requirements: '',
  ctc: { providedStatus: 'provided', kind: 'annual', fixedLpa: null, variableLpa: null, bonusLpa: null, esopNote: '', breakdownProvided: false },
  rules: { allowedDepartments: [], allowedBatches: [] },
  questions: [], rounds: [{ name: 'Online assessment' }, { name: 'Interview' }],
  policyNote: '', contactName: '', contactEmail: '', opensAt: null, deadline: null,
};

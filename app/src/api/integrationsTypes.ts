// Types for the integrations API (server/docs/integrations-api.md). Kept separate from api/types.ts
// so other modules can edit that file without conflicts.
import type { Role, User } from './types';

/* ---------- GET /config ---------- */
export interface FeatureFlags {
  googleLogin: boolean;
  emailVerification: boolean;
  fileUploads: boolean;
  turnstile: boolean;
  requireVerifiedEmail: boolean;
  /** module flags: only present when that module is deployed (absent = off) */
  ai: boolean;
  codeExecution: boolean;
  assessments: boolean;
  recruiter: boolean;
  opsRestrictions: boolean;
  opsAnalytics: boolean;
  opsCalendar: boolean;
  opsDocuments: boolean;
  /** any other flag registered by a server module */
  [flag: string]: boolean;
}
export interface GoogleClientIds { web?: string; android?: string; ios?: string }
export interface UploadLimits { resumeMb: number; photoMb: number; logoMb: number; documentMb: number }
export interface AppConfig {
  features: FeatureFlags;
  googleClientIds: GoogleClientIds;
  turnstileSiteKey: string | null;
  limits: UploadLimits;
}
export interface ConfigResponse {
  features?: Partial<FeatureFlags>;
  googleClientIds?: GoogleClientIds;
  turnstileSiteKey?: string;
  limits?: Partial<UploadLimits>;
}

/* ---------- user / auth ---------- */
export type AuthProvider = 'password' | 'google';
/** `User` from api/types.ts plus the fields the integrations module adds. All optional: older cached sessions lack them. */
export type AuthUser = User & {
  phoneDisplay?: string | null;
  tenantId?: string;
  createdAt?: string;
  emailVerified?: boolean;
  authProvider?: AuthProvider;
  hasPassword?: boolean;
};
export interface AuthResult { user: AuthUser; accessToken: string; refreshToken: string }
export interface GoogleAuthResult extends AuthResult { isNewUser: boolean; needsPhone: boolean }
export type { Role };

export interface SendVerificationResult { ok: true; alreadyVerified?: boolean; expiresInSeconds?: number; resendAfterSeconds?: number }
export interface VerifyEmailResult { ok: true; user: AuthUser }

/* ---------- files ---------- */
export type UploadPurpose = 'resume' | 'photo' | 'company_logo' | 'document';
export interface PresignRequest { purpose: UploadPurpose; fileName: string; contentType: string; size: number }
export interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}
export interface UploadedFile {
  id: string;
  purpose: UploadPurpose;
  fileName: string;
  contentType: string;
  size: number;
  status: 'ready';
  createdAt: string;
  /** only for company_logo */
  publicUrl?: string;
}
/** Resume as returned by the API once file resumes exist (`url` is null for kind "file"). */
export interface ResumeEntry {
  id: string;
  label: string;
  url: string | null;
  isDefault: boolean;
  createdAt?: string;
  fileId: string | null;
  kind: 'file' | 'link';
  fileName: string | null;
  size: number | null;
}

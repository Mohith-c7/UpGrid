// API calls for the integrations module (config, Google, email OTP, password reset, file uploads).
// Contract: server/docs/integrations-api.md. Types: ./integrationsTypes.ts.
import { api } from './client';
import { queryClient } from './queryClient';
import { session } from '@/state/session';
import { DEFAULT_CONFIG } from '@/config/defaults';
import type {
  AppConfig,
  AuthResult,
  AuthUser,
  ConfigResponse,
  GoogleAuthResult,
  PresignRequest,
  PresignResponse,
  ResumeEntry,
  SendVerificationResult,
  UploadedFile,
  VerifyEmailResult,
} from './integrationsTypes';
import type { RegisterBody } from './types';

/* ---------- config ---------- */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** GET /config, merged over the safe defaults so callers never see undefined fields. */
export async function fetchConfig(): Promise<AppConfig> {
  const r = await api.get<ConfigResponse>('/config', { auth: false, timeoutMs: 8000 });
  const flags = { ...DEFAULT_CONFIG.features };
  for (const [k, v] of Object.entries(r?.features ?? {})) flags[k] = v === true;
  const lim = r?.limits ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d);
  return {
    features: flags,
    googleClientIds: {
      web: str(r?.googleClientIds?.web),
      android: str(r?.googleClientIds?.android),
      ios: str(r?.googleClientIds?.ios),
    },
    turnstileSiteKey: str(r?.turnstileSiteKey) ?? null,
    limits: {
      resumeMb: num(lim.resumeMb, DEFAULT_CONFIG.limits.resumeMb),
      photoMb: num(lim.photoMb, DEFAULT_CONFIG.limits.photoMb),
      logoMb: num(lim.logoMb, DEFAULT_CONFIG.limits.logoMb),
      documentMb: num(lim.documentMb, DEFAULT_CONFIG.limits.documentMb),
    },
  };
}

/* ---------- sign in / up (these carry the Turnstile token; the base hooks do not) ---------- */
async function adopt<T extends AuthResult>(r: T): Promise<T> {
  queryClient.clear();
  await session.setAuth(r);
  return r;
}

export async function loginRequest(email: string, password: string, turnstileToken?: string | null): Promise<AuthUser> {
  const r = await api.post<AuthResult>('/auth/login', { email, password, ...(turnstileToken ? { turnstileToken } : {}) }, { auth: false });
  return (await adopt(r)).user;
}

export async function registerRequest(body: RegisterBody, turnstileToken?: string | null): Promise<AuthUser> {
  const r = await api.post<AuthResult>('/auth/register', { ...body, ...(turnstileToken ? { turnstileToken } : {}) }, { auth: false });
  return (await adopt(r)).user;
}

/** POST /auth/google. Throws ApiError TERMS_REQUIRED for a new user until `acceptTerms` is true. */
export async function googleSignIn(idToken: string, opts: { acceptTerms?: boolean; turnstileToken?: string | null } = {}): Promise<GoogleAuthResult> {
  const body: Record<string, unknown> = { idToken };
  if (opts.acceptTerms === true) body.acceptTerms = true;
  if (opts.turnstileToken) body.turnstileToken = opts.turnstileToken;
  const r = await api.post<GoogleAuthResult>('/auth/google', body, { auth: false });
  return adopt(r);
}

/* ---------- email verification ---------- */
export const sendEmailVerification = () => api.post<SendVerificationResult>('/auth/email/send-verification', {});

export async function verifyEmailCode(code: string): Promise<AuthUser> {
  const r = await api.post<VerifyEmailResult>('/auth/email/verify', { code });
  if (r?.user) await session.setUser(r.user);
  return r.user;
}

/* ---------- profile helpers ---------- */
/** PATCH /me for phone/email and keep the stored session user in sync. */
export async function patchMe(body: { phone?: string; email?: string; name?: string }): Promise<AuthUser> {
  const r = await api.patch<{ user?: AuthUser } | AuthUser>('/me', body);
  const u = (r && typeof r === 'object' && 'user' in r && r.user ? r.user : r) as AuthUser;
  if (u && u.id) await session.setUser(u);
  return u;
}

/** GET /me and store it (use after verify / phone changes made elsewhere). */
export async function refreshMe(): Promise<AuthUser | null> {
  const r = await api.get<{ user?: AuthUser } | AuthUser>('/me');
  const u = (r && typeof r === 'object' && 'user' in r && r.user ? r.user : r) as AuthUser;
  if (u && u.id) {
    await session.setUser(u);
    return u;
  }
  return null;
}

/* ---------- forgot / reset ---------- */
export const forgotPassword = (email: string, turnstileToken?: string | null) =>
  api.post<{ ok: true; message: string }>('/auth/forgot-password', { email, ...(turnstileToken ? { turnstileToken } : {}) }, { auth: false });

export const resetPassword = (email: string, code: string, newPassword: string) =>
  api.post<{ ok: true }>('/auth/reset-password', { email, code, newPassword }, { auth: false });

/* ---------- files ---------- */
export const presignUpload = (req: PresignRequest) => api.post<PresignResponse>('/files/presign', req);
export const confirmUpload = (fileId: string) => api.post<{ file: UploadedFile }>(`/files/${encodeURIComponent(fileId)}/confirm`, {});
export const deleteFile = (fileId: string) => api.delete<{ ok: true }>(`/files/${encodeURIComponent(fileId)}`);
/** Signed GET url, valid 300 s. Do not cache. */
export const fileUrl = (fileId: string) => api.get<{ url: string; expiresIn: number }>(`/files/${encodeURIComponent(fileId)}/url`);
/** Attach an uploaded (ready, purpose=resume) file as a resume entry. */
export async function addFileResume(body: { label: string; fileId: string; isDefault?: boolean }): Promise<ResumeEntry | undefined> {
  const r = await api.post<{ resume?: ResumeEntry } | ResumeEntry>('/profile/resumes', body);
  return (r && typeof r === 'object' && 'resume' in r ? r.resume : (r as ResumeEntry)) ?? undefined;
}

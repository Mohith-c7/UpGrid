/**
 * What a signed-in user still has to do before using the app.
 *  - Google sign-up without a mobile number  -> /complete-profile  (blocking: the server refuses applications without a phone)
 *  - Fresh email sign-up, email not verified -> /verify-email      (skippable, shown once per sign-up)
 * app/_layout.tsx (Gate) reads `useAuthStep()` and redirects.
 */
import { useSyncExternalStore } from 'react';
import { useSession } from '@/state/session';
import { useFeatures } from '@/config/features';
import type { AuthUser } from '@/api/integrationsTypes';

let verifyPrompt = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const postAuth = {
  /** call right after a successful email registration */
  promptVerify() {
    verifyPrompt = true;
    emit();
  },
  /** user skipped or finished verification */
  dismissVerify() {
    verifyPrompt = false;
    emit();
  },
};

export type AuthStepKey = 'complete-profile' | 'verify-email';
export interface AuthStep { key: AuthStepKey; href: string }

export function useAuthStep(): AuthStep | null {
  const s = useSession();
  const { flags } = useFeatures();
  const prompt = useSyncExternalStore(subscribe, () => verifyPrompt, () => false);
  const user = s.user as AuthUser | null;
  if (s.status !== 'signedIn' || !user) return null;
  if (user.role === 'student' && user.authProvider === 'google' && !user.phone) {
    return { key: 'complete-profile', href: '/complete-profile' };
  }
  if (prompt && flags.emailVerification && user.emailVerified === false) {
    return { key: 'verify-email', href: '/verify-email?fresh=1' };
  }
  return null;
}

/** True when the email is unverified and verification is possible: drive a "Verify your email" banner with this. */
export function useNeedsEmailVerification(): boolean {
  const s = useSession();
  const { flags } = useFeatures();
  const user = s.user as AuthUser | null;
  return s.status === 'signedIn' && flags.emailVerification && user?.emailVerified === false;
}

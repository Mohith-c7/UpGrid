import { ApiError, errMessage } from '@/api/client';

/** Friendly copy for the integration error codes. Falls back to the server message. */
export function authErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return errMessage(e);
  switch (e.code) {
    case 'CAPTCHA_FAILED':
      return 'The security check did not pass or has expired. Complete it again and retry.';
    case 'CAPTCHA_UNAVAILABLE':
      return 'The security check service is unavailable right now. Please try again in a few minutes.';
    case 'INVALID_GOOGLE_TOKEN':
      return 'Google sign-in could not be verified. Please try again.';
    case 'GOOGLE_EMAIL_UNVERIFIED':
      return 'Your Google account email is not verified. Verify it with Google, or sign up with email.';
    case 'GOOGLE_ACCOUNT_CONFLICT':
      return 'This email is already linked to a different Google account. Log in with that account or use your password.';
    case 'GOOGLE_LOGIN_NOT_CONFIGURED':
      return 'Google sign-in is not available right now. Please use email and password.';
    case 'EMAIL_NOT_CONFIGURED':
      return 'Email codes are not available right now. Please try again later.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'EMAIL_TAKEN':
      return 'This email is already registered. Try logging in instead.';
    case 'PHONE_TAKEN':
      return 'This mobile number is already registered with another account.';
    default:
      return e.message || errMessage(e);
  }
}

export const isCode = (e: unknown, ...codes: string[]): boolean => e instanceof ApiError && codes.includes(e.code);

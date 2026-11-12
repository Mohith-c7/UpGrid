import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity { sub: string; email: string; emailVerified: boolean; name: string | null; picture: string | null }
/** Verifies a Google ID token for one of the allowed audiences; throws on any problem. Injectable for tests. */
export type GoogleVerifier = (idToken: string, audiences: string[]) => Promise<GoogleIdentity>;

export const googleVerifier: GoogleVerifier = async (idToken, audiences) => {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken, audience: audiences });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw new Error('Token has no subject or email');
  return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name ?? null, picture: p.picture ?? null };
};

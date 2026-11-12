/** Versions of the legal documents the user must accept at registration. Bump when the text changes. */
export const LEGAL_VERSIONS = { terms: 'v1', privacy: 'v1' } as const;
/** Value stored in user_consents.policy_version (terms and privacy are accepted together). */
export const CONSENT_POLICY_VERSION = 'v1';

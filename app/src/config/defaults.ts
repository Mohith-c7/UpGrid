import type { AppConfig, FeatureFlags } from '@/api/integrationsTypes';

export const DEFAULT_FLAGS: FeatureFlags = {
  googleLogin: false,
  emailVerification: false,
  fileUploads: false,
  turnstile: false,
  requireVerifiedEmail: false,
  ai: false,
  codeExecution: false,
  assessments: false,
  recruiter: false,
  opsRestrictions: false,
  opsAnalytics: false,
  opsCalendar: false,
  opsDocuments: false,
};

export const DEFAULT_CONFIG: AppConfig = {
  features: DEFAULT_FLAGS,
  googleClientIds: {},
  turnstileSiteKey: null,
  limits: { resumeMb: 5, photoMb: 2, logoMb: 1, documentMb: 5 },
};

import { Router } from 'express';
import type { Deps } from '../context';
import { integ } from '../integrations';
import { collectFeatureFlags } from '../features';
import { LIMITS_MB } from '../storage';

/** GET /api/v1/config — public. Feature flags + public client identifiers, computed from env on every call. */
export function configRouter(deps: Deps) {
  const i = integ(deps);
  const r = Router();
  r.get('/', (_req, res) => {
    const s = i.settings;
    const features = {
      ...collectFeatureFlags(),
      googleLogin: i.googleEnabled,
      emailVerification: i.emailEnabled,
      fileUploads: !!i.storage,
      turnstile: i.turnstileEnabled,
      requireVerifiedEmail: i.requireVerifiedEmail,
    };
    res.set('Cache-Control', 'no-store');
    res.json({
      features,
      googleClientIds: i.googleEnabled ? s.google.clientIds : {},
      ...(i.turnstileEnabled && s.turnstile.siteKey ? { turnstileSiteKey: s.turnstile.siteKey } : {}),
      limits: { ...LIMITS_MB },
    });
  });
  return r;
}

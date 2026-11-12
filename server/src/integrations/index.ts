import { GoogleVerifier, googleVerifier } from '../google';
import { configureMail, createMailer, Mailer } from '../mail';
import { createR2Storage, ObjectStorage } from '../storage';
import type { FetchLike } from '../turnstile';
import { Env, IntegrationSettings, loadIntegrationSettings } from './settings';

export * from './settings';

export interface IntegrationOverrides {
  env?: Env;
  mailer?: Mailer;
  googleVerifier?: GoogleVerifier;
  fetch?: FetchLike;
  storage?: ObjectStorage | null;
  log?: (m: string) => void;
}

export interface Integrations {
  settings: IntegrationSettings;
  /** mail can really be delivered (SMTP configured, or a mailer was injected) */
  emailEnabled: boolean;
  /** effective: applying needs a verified email */
  requireVerifiedEmail: boolean;
  googleEnabled: boolean;
  turnstileEnabled: boolean;
  mailer: Mailer;
  googleVerifier: GoogleVerifier;
  fetch: FetchLike;
  storage: ObjectStorage | null;
}

export function buildIntegrations(o: IntegrationOverrides = {}): Integrations {
  const env: Env = o.env ?? (process.env.NODE_ENV === 'test' ? { NODE_ENV: 'test' } : process.env);
  const settings = loadIntegrationSettings(env);
  const log = o.log ?? ((m: string) => console.log(m));
  const mailer = o.mailer ?? createMailer(settings, log);
  const emailEnabled = settings.mail.smtpConfigured || !!o.mailer || (!settings.isProd && settings.mail.devEcho);
  // default: on when real mail is configured; never on when no mail can be sent (users would be locked out)
  const requested = settings.requireVerifiedEmailRequested ?? (settings.mail.smtpConfigured || !!o.mailer);
  const requireVerifiedEmail = emailEnabled && requested;
  const storage = o.storage !== undefined ? o.storage : settings.r2 ? createR2Storage(settings.r2) : null;
  configureMail({ mailer, from: settings.mail.from, appName: settings.appName, devEcho: settings.mail.devEcho, isProd: settings.isProd, log, enabled: emailEnabled && mailer.kind !== 'noop' });
  return {
    settings, emailEnabled, requireVerifiedEmail,
    googleEnabled: settings.google.all.length > 0,
    turnstileEnabled: !!settings.turnstile.secret,
    mailer, googleVerifier: o.googleVerifier ?? googleVerifier,
    fetch: o.fetch ?? ((url, init) => fetch(url, init) as any),
    storage,
  };
}

/** Integrations of a Deps object (always present when Deps comes from createApp). */
export function integ(d: { integrations?: Integrations }): Integrations {
  if (!d.integrations) throw new Error('Deps.integrations is not set; build Deps through createApp');
  return d.integrations;
}

/** One line per integration for the start-up log (no secrets). */
export function integrationSummary(s: IntegrationSettings): string[] {
  const out = [
    `email: ${s.mail.smtpConfigured ? `SMTP ${s.mail.host}:${s.mail.port}` : s.isProd ? 'OFF (SMTP_HOST not set; verification/reset/notification emails disabled)' : 'console transport (dev)'}`,
    `google login: ${s.google.all.length ? `on (${s.google.all.length} client id${s.google.all.length > 1 ? 's' : ''})` : 'OFF (GOOGLE_CLIENT_IDS not set)'}`,
    `turnstile: ${s.turnstile.secret ? (s.turnstile.siteKey ? 'on' : 'ON but TURNSTILE_SITE_KEY missing (clients cannot render the widget!)') : 'OFF (TURNSTILE_SECRET_KEY not set)'}`,
    `file uploads (R2): ${s.r2 ? `on (bucket ${s.r2.bucket}${s.r2.publicBaseUrl ? '' : ', no R2_PUBLIC_BASE_URL: company logo uploads disabled'})` : 'OFF (R2_* not set)'}`,
  ];
  return out;
}

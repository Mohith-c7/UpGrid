// Environment-driven settings for every external integration. Pure: takes an env object, never touches process.env itself.
export type Env = Record<string, string | undefined>;

export interface IntegrationSettings {
  isProd: boolean;
  appName: string;
  mail: {
    smtpConfigured: boolean; host?: string; port: number; secure: boolean; user?: string; pass?: string; from: string; devEcho: boolean;
  };
  requireVerifiedEmailRequested: boolean | null;
  google: { clientIds: { web?: string; android?: string; ios?: string }; all: string[] };
  turnstile: { secret?: string; siteKey?: string };
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string | null } | null;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v || '').trim().toLowerCase());

/** GOOGLE_CLIENT_IDS: comma separated. Entries may be labelled (`web:…,android:…,ios:…`); unlabelled entries are assigned in order web, android, ios. */
export function parseGoogleClientIds(env: Env): IntegrationSettings['google'] {
  const ids: { web?: string; android?: string; ios?: string } = {};
  const unlabelled: string[] = [];
  for (const raw of (env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(web|android|ios)\s*[:=]\s*(.+)$/i.exec(raw);
    if (m) ids[m[1].toLowerCase() as 'web' | 'android' | 'ios'] = m[2].trim();
    else unlabelled.push(raw);
  }
  for (const k of ['web', 'android', 'ios'] as const) {
    const sep = clean(env[`GOOGLE_${k.toUpperCase()}_CLIENT_ID`]);
    if (!ids[k] && sep) ids[k] = sep;
  }
  for (const k of ['web', 'android', 'ios'] as const) {
    if (!ids[k] && unlabelled.length) ids[k] = unlabelled.shift();
  }
  const all = Array.from(new Set([...Object.values(ids), ...unlabelled].filter(Boolean) as string[]));
  return { clientIds: ids, all };
}

export function loadIntegrationSettings(env: Env): IntegrationSettings {
  const isProd = env.NODE_ENV === 'production';
  const appName = clean(env.APP_NAME) || 'UpGrid';
  const host = clean(env.SMTP_HOST);
  const port = Number(clean(env.SMTP_PORT) || 587);
  const secureEnv = clean(env.SMTP_SECURE);
  const secure = secureEnv !== undefined ? truthy(secureEnv) : port === 465;
  const user = clean(env.SMTP_USER);
  const from = clean(env.MAIL_FROM) || (user && user.includes('@') ? `${appName} <${user}>` : `${appName} <no-reply@localhost>`);
  const rv = clean(env.REQUIRE_VERIFIED_EMAIL);
  const r2Parts = {
    accountId: clean(env.R2_ACCOUNT_ID), accessKeyId: clean(env.R2_ACCESS_KEY_ID), secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY), bucket: clean(env.R2_BUCKET),
  };
  const r2 = r2Parts.accountId && r2Parts.accessKeyId && r2Parts.secretAccessKey && r2Parts.bucket
    ? { ...(r2Parts as Record<keyof typeof r2Parts, string>), publicBaseUrl: clean(env.R2_PUBLIC_BASE_URL)?.replace(/\/+$/, '') || null }
    : null;
  return {
    isProd,
    appName,
    mail: {
      smtpConfigured: !!host, host, port: Number.isFinite(port) ? port : 587, secure, user, pass: clean(env.SMTP_PASS), from,
      devEcho: !isProd && env.EMAIL_DEV_ECHO === '1',
    },
    requireVerifiedEmailRequested: rv === undefined ? null : truthy(rv),
    google: parseGoogleClientIds(env),
    turnstile: { secret: clean(env.TURNSTILE_SECRET_KEY), siteKey: clean(env.TURNSTILE_SITE_KEY) },
    r2,
  };
}

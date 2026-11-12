import nodemailer from 'nodemailer';
import type { Db } from '../db';
import type { IntegrationSettings } from '../integrations/settings';
import { renderTemplate, TemplateData, TemplateName } from './templates';

export interface MailMessage { from: string; to: string; subject: string; text: string; html: string }
export interface Mailer { kind: 'smtp' | 'console' | 'noop' | 'custom'; send(m: MailMessage): Promise<void> }

type Log = (m: string) => void;

/** SMTP when SMTP_HOST is set; a console (JSON) transport in dev/test; a logged no-op in production. Never throws at construction. */
export function createMailer(s: IntegrationSettings, log: Log = (m) => console.log(m)): Mailer {
  if (s.mail.smtpConfigured) {
    const transport = nodemailer.createTransport({
      host: s.mail.host, port: s.mail.port, secure: s.mail.secure,
      auth: s.mail.user ? { user: s.mail.user, pass: s.mail.pass || '' } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    return { kind: 'smtp', send: async (m) => { await transport.sendMail(m); } };
  }
  if (s.isProd) {
    return { kind: 'noop', send: async (m) => { log(`[mail:disabled] SMTP is not configured; not sent: "${m.subject}"`); } };
  }
  const json = nodemailer.createTransport({ jsonTransport: true });
  return {
    kind: 'console',
    send: async (m) => {
      await json.sendMail(m);
      log(`[mail:console] "${m.subject}" (not delivered; set SMTP_HOST to send real mail)`);
    },
  };
}

interface MailContext { mailer: Mailer; from: string; appName: string; devEcho: boolean; isProd: boolean; log: Log; enabled: boolean }
let ctx: MailContext | null = null;

/** Called once by createApp. `enabled` = mail can really be delivered (SMTP or an injected mailer). */
export function configureMail(c: MailContext) { ctx = c; }
export const mailEnabled = () => !!ctx && ctx.enabled;

/**
 * Reusable helper for every module: renders the template and sends it. Never throws and never blocks on failure.
 * Resolves true when the mailer accepted the message, false when mail is off or sending failed.
 */
export function sendMail<T extends TemplateName>(to: string, template: T, data: TemplateData[T]): Promise<boolean> {
  const c = ctx;
  if (!c || !c.enabled || !to) return Promise.resolve(false);
  try {
    const r = renderTemplate(template, data, c.appName);
    const code = (data as any)?.code;
    if (c.devEcho && !c.isProd && code) c.log(`[mail:dev-echo] ${template} code for ${to}: ${code}`);
    return c.mailer.send({ from: c.from, to, subject: r.subject, text: r.text, html: r.html }).then(
      () => true,
      (e) => { c.log(`[mail:error] ${template}: ${(e as Error)?.message || e}`); return false; },
    );
  } catch (e) {
    c.log(`[mail:error] ${template}: ${(e as Error)?.message || e}`);
    return Promise.resolve(false);
  }
}

export interface MailJob { to: string; template: TemplateName; data: any }

/** Builds a job for a user if mail is on, the user exists and has not switched email notifications off. Safe to call inside a transaction. */
export async function userMailJob<T extends TemplateName>(
  db: Db, tenantId: string, userId: string, template: T, data: Omit<TemplateData[T], 'name'>,
): Promise<MailJob | null> {
  if (!mailEnabled()) return null;
  try {
    const r = await db.query(
      `SELECT u.email, u.name, rs.settings FROM users u LEFT JOIN reminder_settings rs ON rs.user_id=u.id
        WHERE u.id=$1 AND u.tenant_id=$2 AND u.deleted_at IS NULL`, [userId, tenantId]);
    const row = r.rows[0];
    if (!row || row.settings?.email === false) return null;
    return { to: row.email, template, data: { ...data, name: row.name } };
  } catch {
    return null;
  }
}

/** Fire and forget; call after the transaction committed. */
export function dispatchMail(jobs: (MailJob | null | undefined)[]): void {
  for (const j of jobs) if (j) void sendMail(j.to, j.template as any, j.data);
}

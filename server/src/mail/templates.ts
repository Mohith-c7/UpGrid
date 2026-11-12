// Plain, responsive HTML + text templates. No images, no external CSS. Brand teal #126B63.
export const BRAND = '#126B63';

export interface TemplateData {
  verification_code: { name?: string; code: string; expiresMinutes: number };
  password_reset_code: { name?: string; code: string; expiresMinutes: number };
  schedule_notification: {
    name?: string; company: string; role: string; type: 'assessment' | 'interview'; whenText: string;
    mode: 'online' | 'in_person'; venueOrLink: string; instructions?: string | null; rescheduled?: boolean;
  };
  offer_response: { name?: string; studentName: string; company: string; role: string; decision: 'accepted' | 'declined'; reference: string; note?: string | null };
  ticket_reply: { name?: string; subject: string; authorName: string; message: string };
  generic_notification: { name?: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string };
}
export type TemplateName = keyof TemplateData;
export const TEMPLATE_NAMES: TemplateName[] = ['verification_code', 'password_reset_code', 'schedule_notification', 'offer_response', 'ticket_reply', 'generic_notification'];

export interface Rendered { subject: string; text: string; html: string }

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, '<br>');
const safeHttps = (u: unknown) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
/** header/subject values must not contain line breaks */
const oneLine = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

function layout(appName: string, preheader: string, heading: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F6F8F9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F6F8F9;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8F9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E9EC;border-radius:12px;">
<tr><td style="background:${BRAND};border-radius:12px 12px 0 0;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;">${esc(appName)}</td></tr>
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#172B3A;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#172B3A;">${esc(heading)}</h1>
${inner}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E4E9EC;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#64748B;">You received this email because of activity on your ${esc(appName)} account. You can turn off email notifications in the app under Settings.</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;
const codeBox = (code: string) =>
  `<p style="margin:18px 0;text-align:center;"><span style="display:inline-block;padding:12px 20px;background:#F6F8F9;border:1px solid #E4E9EC;border-radius:8px;font-family:'Courier New',Courier,monospace;font-size:30px;letter-spacing:8px;font-weight:bold;color:${BRAND};">${esc(code)}</span></p>`;
const rows = (items: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #E4E9EC;border-radius:8px;">${items
    .map(([k, v]) => `<tr><td style="padding:8px 12px;width:34%;font-size:13px;color:#64748B;vertical-align:top;">${esc(k)}</td><td style="padding:8px 12px;font-size:14px;color:#172B3A;vertical-align:top;">${v}</td></tr>`)
    .join('')}</table>`;
const hello = (name?: string) => (name ? `Hi ${oneLine(name)},` : 'Hello,');

export function renderTemplate<T extends TemplateName>(template: T, data: TemplateData[T], appName = 'UpGrid'): Rendered {
  const d: any = data;
  switch (template) {
    case 'verification_code':
    case 'password_reset_code': {
      const reset = template === 'password_reset_code';
      const heading = reset ? 'Reset your password' : 'Verify your email';
      const lead = reset ? 'Use this code to reset your password.' : 'Use this code to verify your email address.';
      return {
        subject: reset ? `Your ${appName} password reset code` : `Your ${appName} verification code`,
        text: `${hello(d.name)}\n\n${lead}\n\n  ${d.code}\n\nThe code expires in ${d.expiresMinutes} minutes. Never share it with anyone.${reset ? ' If you did not ask for this, you can ignore this email; your password will not change.' : ' If you did not create an account, ignore this email.'}\n\n${appName}`,
        html: layout(appName, `${d.code} is your code`, heading,
          p(esc(hello(d.name))) + p(esc(lead)) + codeBox(d.code) +
          p(`The code expires in <strong>${esc(d.expiresMinutes)} minutes</strong>. Never share it with anyone.`) +
          p(reset ? 'If you did not ask for this, you can ignore this email; your password will not change.' : 'If you did not create an account, ignore this email.')),
      };
    }
    case 'schedule_notification': {
      const label = d.type === 'assessment' ? 'Assessment' : 'Interview';
      const verb = d.rescheduled ? 'rescheduled' : 'scheduled';
      const where = d.mode === 'online' ? 'Link' : 'Venue';
      const link = d.mode === 'online' ? safeHttps(d.venueOrLink) : null;
      const items: [string, string][] = [
        ['Company', esc(d.company)], ['Role', esc(d.role)], ['When', `<strong>${esc(d.whenText)}</strong>`],
        ['Mode', d.mode === 'online' ? 'Online' : 'In person'],
        [where, link ? `<a href="${esc(link)}" style="color:${BRAND};">${esc(link)}</a>` : esc(d.venueOrLink)],
      ];
      if (d.instructions) items.push(['Instructions', nl2br(d.instructions)]);
      return {
        subject: oneLine(`${label} ${verb}: ${d.company}`),
        text: `${hello(d.name)}\n\nYour ${d.type} for ${d.role} at ${d.company} has been ${verb}.\n\nWhen: ${d.whenText}\nMode: ${d.mode === 'online' ? 'Online' : 'In person'}\n${where}: ${d.venueOrLink}${d.instructions ? `\nInstructions: ${d.instructions}` : ''}\n\n${appName}`,
        html: layout(appName, `${label} ${verb} for ${d.whenText}`, `${label} ${verb}`,
          p(esc(hello(d.name))) + p(`Your ${esc(d.type)} for <strong>${esc(d.role)}</strong> at <strong>${esc(d.company)}</strong> has been ${verb}.`) + rows(items)),
      };
    }
    case 'offer_response': {
      return {
        subject: oneLine(`Offer ${d.decision}: ${d.company}`),
        text: `${hello(d.name)}\n\n${d.studentName} ${d.decision} the offer for ${d.role} at ${d.company}.\nReference: ${d.reference}${d.note ? `\nNote: ${d.note}` : ''}\n\n${appName}`,
        html: layout(appName, `${d.studentName} ${d.decision} the offer`, `Offer ${d.decision}`,
          p(esc(hello(d.name))) + p(`<strong>${esc(d.studentName)}</strong> ${esc(d.decision)} the offer for <strong>${esc(d.role)}</strong> at <strong>${esc(d.company)}</strong>.`) +
          rows([['Reference', esc(d.reference)], ...(d.note ? ([['Note', nl2br(d.note)]] as [string, string][]) : [])])),
      };
    }
    case 'ticket_reply': {
      return {
        subject: oneLine(`New reply: ${d.subject}`),
        text: `${hello(d.name)}\n\n${d.authorName} replied to "${d.subject}":\n\n${d.message}\n\nOpen the app to respond.\n\n${appName}`,
        html: layout(appName, `${d.authorName} replied`, 'New reply on your ticket',
          p(esc(hello(d.name))) + p(`<strong>${esc(d.authorName)}</strong> replied to <strong>${esc(d.subject)}</strong>:`) +
          `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid ${BRAND};background:#F6F8F9;">${nl2br(d.message)}</blockquote>` + p('Open the app to respond.')),
      };
    }
    case 'generic_notification': {
      const url = safeHttps(d.ctaUrl);
      const cta = url && d.ctaLabel
        ? `<p style="margin:18px 0;"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:${BRAND};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:bold;">${esc(d.ctaLabel)}</a></p>`
        : '';
      return {
        subject: oneLine(d.title),
        text: `${hello(d.name)}\n\n${d.body}${url && d.ctaLabel ? `\n\n${d.ctaLabel}: ${url}` : ''}\n\n${appName}`,
        html: layout(appName, oneLine(d.body).slice(0, 90), oneLine(d.title), p(esc(hello(d.name))) + p(nl2br(d.body)) + cta),
      };
    }
    default:
      throw new Error(`Unknown mail template: ${String(template)}`);
  }
}

// Renders a ResumeDoc to a flat, single-column, ATS-friendly HTML page (A4). Real text only: no tables, images, icons or columns.
import type { ResumeDoc, TemplateId } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS: Record<TemplateId, string> = {
  classic: `
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11pt;line-height:1.35;margin:0}
    .page{padding:14mm 16mm}
    h1{font-size:22pt;margin:0 0 4pt;text-align:center;font-weight:700}
    .contact{text-align:center;font-size:10pt;color:#333;margin-bottom:10pt}
    h2{font-size:11.5pt;text-transform:uppercase;letter-spacing:.8pt;margin:14pt 0 6pt;padding-bottom:2pt;border-bottom:1px solid #444}
    .entry{margin-bottom:8pt}
    .row{display:flex;justify-content:space-between;gap:12pt}
    .head{font-weight:700}
    .sub{color:#333}
    .date{white-space:nowrap;color:#333}
    ul{margin:3pt 0 0;padding-left:16pt}
    li{margin-bottom:2pt}
    p{margin:0}
  `,
  compact: `
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10pt;line-height:1.3;margin:0}
    .page{padding:11mm 13mm}
    h1{font-size:19pt;margin:0 0 3pt;text-align:left;font-weight:700;color:#0D4F4A}
    .contact{text-align:left;font-size:9.5pt;color:#333;margin-bottom:6pt}
    h2{font-size:10.5pt;text-transform:uppercase;letter-spacing:.6pt;margin:10pt 0 4pt;padding-bottom:1pt;border-bottom:1.5px solid #126B63;color:#0D4F4A}
    .entry{margin-bottom:5pt}
    .row{display:flex;justify-content:space-between;gap:10pt}
    .head{font-weight:700}
    .sub{color:#333}
    .date{white-space:nowrap;color:#333}
    ul{margin:2pt 0 0;padding-left:14pt}
    li{margin-bottom:1pt}
    p{margin:0}
  `,
};

export function renderResumeHtml(doc: ResumeDoc, template: TemplateId, opts: { preview?: boolean } = {}): string {
  const body: string[] = [];
  body.push(`<h1>${esc(doc.name)}</h1>`);
  if (doc.contact.length) body.push(`<div class="contact">${doc.contact.map(esc).join(' &nbsp;|&nbsp; ')}</div>`);
  for (const s of doc.sections) {
    body.push(`<h2>${esc(s.title)}</h2>`);
    if (s.inline) body.push(`<p>${esc(s.inline)}</p>`);
    if (s.bullets?.length) body.push(`<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    for (const e of s.entries ?? []) {
      const head = `<span class="head">${esc(e.heading)}</span>${e.link ? ` <span class="sub">(${esc(e.link)})</span>` : ''}`;
      body.push(`<div class="entry"><div class="row"><div>${head}</div>${e.right ? `<div class="date">${esc(e.right)}</div>` : ''}</div>`);
      if (e.sub) body.push(`<div class="sub">${esc(e.sub)}</div>`);
      if (e.bullets.length) body.push(`<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
      body.push('</div>');
    }
  }
  // preview: lay the A4 width (794 css px) out and let the WebView scale it to the screen
  const meta = opts.preview ? '<meta name="viewport" content="width=794, user-scalable=yes">' : '';
  const size = opts.preview ? 'body{width:794px;background:#fff}' : '@page{size:A4;margin:13mm 15mm}.page{padding:0 !important}';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${meta}<title>${esc(doc.name)} - Resume</title><style>${CSS[template]}${size}</style></head><body><div class="page">${body.join('')}</div></body></html>`;
}

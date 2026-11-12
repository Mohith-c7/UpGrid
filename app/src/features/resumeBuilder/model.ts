// Resume builder data model. Everything prefilled comes from the student's profile; projects, experience, summary and
// achievements start EMPTY and are only what the student types. We never generate or embellish content.
import type { ProfileResponse } from '@/api/types';
import { validateEmail, validateText, validateUrl } from '@/lib/validation';

export type TemplateId = 'classic' | 'compact';
export const TEMPLATES: { value: TemplateId; label: string; hint: string }[] = [
  { value: 'classic', label: 'Classic', hint: 'Centered name, comfortable spacing' },
  { value: 'compact', label: 'Compact', hint: 'Left aligned, fits more on one page' },
];

export interface EducationItem { id: string; institution: string; degree: string; period: string; score: string; details: string }
export interface ProjectItem { id: string; title: string; link: string; description: string }
export interface ExperienceItem { id: string; role: string; organisation: string; from: string; to: string; description: string }

export interface ResumeDraft {
  name: string; email: string; phone: string; city: string;
  linkedin: string; github: string; portfolio: string;
  summary: string;
  education: EducationItem[];
  skills: string; // comma or line separated
  projects: ProjectItem[];
  experience: ExperienceItem[];
  achievements: string; // one per line
  template: TemplateId;
}

export const LIMITS = { projects: 6, experience: 6, education: 4, skills: 40, achievements: 10, bullets: 6 } as const;

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
export const emptyEducation = (): EducationItem => ({ id: newId(), institution: '', degree: '', period: '', score: '', details: '' });
export const emptyProject = (): ProjectItem => ({ id: newId(), title: '', link: '', description: '' });
export const emptyExperience = (): ExperienceItem => ({ id: newId(), role: '', organisation: '', from: '', to: '', description: '' });

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/** Prefill ONLY from the profile (and the account's name/email/phone). Nothing else is guessed. */
export function draftFromProfile(p: ProfileResponse | undefined, user?: { name?: string; email?: string; phone?: string | null } | null): ResumeDraft {
  const a = p?.academics ?? {};
  const u = p?.user ?? user ?? null;
  const school: string[] = [];
  if (a.tenthPercent != null) school.push(`Class X: ${a.tenthPercent}%`);
  if (a.twelfthPercent != null) school.push(`Class XII: ${a.twelfthPercent}%`);
  const degree = [clean(a.program), clean(a.department)].filter(Boolean).join(', ');
  const hasEdu = !!(clean(a.university) || degree);
  const ten = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    name: clean(p?.identity?.name) || clean(u?.name),
    email: clean(p?.identity?.email) || clean(u?.email),
    phone: clean(u?.phone ?? p?.identity?.phone ?? ''),
    city: [clean(p?.contact?.city), clean(p?.contact?.state)].filter(Boolean).join(', '),
    linkedin: ten(p?.links?.linkedin), github: ten(p?.links?.github), portfolio: ten(p?.links?.portfolio),
    summary: '',
    education: hasEdu
      ? [{
        id: newId(), institution: clean(a.university), degree,
        period: a.batchYear ? `Batch of ${a.batchYear}` : '',
        score: a.cgpa != null ? `CGPA ${Number(a.cgpa).toFixed(2)} / ${a.cgpaScale ?? 10}` : '',
        details: school.join('\n'),
      }]
      : [emptyEducation()],
    skills: (p?.skills ?? []).map(clean).filter(Boolean).join(', '),
    projects: [], experience: [], achievements: '',
    template: 'classic',
  };
}

/** True when the draft has anything beyond what the profile gave us. Used to decide whether to warn before leaving. */
export const lines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean);
export const skillList = (s: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of s.split(/[,\n;]/)) {
    const t = x.trim().replace(/\s+/g, ' ');
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
};

/* ------------------------------------------------------------- validation */
export type DraftErrors = Record<string, string>;
const hasText = (s: string) => s.trim().length > 0;
const rowEmpty = (o: Record<string, unknown>) => Object.entries(o).every(([k, v]) => k === 'id' || !hasText(String(v ?? '')));

export function validateDraft(d: ResumeDraft): DraftErrors {
  const e: DraftErrors = {};
  const n = validateText(d.name, { required: true, max: 80, label: 'Name' });
  if (!n.ok) e.name = n.error;
  const em = validateEmail(d.email);
  if (!em.ok) e.email = em.error;
  if (hasText(d.phone) && d.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a 10-digit mobile number';
  if (d.city.length > 80) e.city = 'Keep this under 80 characters';
  for (const [k, kind] of [['linkedin', 'linkedin'], ['github', 'github'], ['portfolio', 'any']] as const) {
    if (hasText(d[k])) { const r = validateUrl(d[k], kind, false); if (!r.ok) e[k] = r.error; }
  }
  if (d.summary.length > 600) e.summary = 'Keep the summary under 600 characters';
  if (skillList(d.skills).length > LIMITS.skills) e.skills = `Add at most ${LIMITS.skills} skills`;
  if (d.skills.length > 800) e.skills = 'Keep skills under 800 characters';
  d.education.forEach((x, i) => {
    if (rowEmpty(x as unknown as Record<string, unknown>)) return;
    if (!hasText(x.institution)) e[`edu.${i}.institution`] = 'Add the institution';
    if (x.details.length > 400) e[`edu.${i}.details`] = 'Keep this under 400 characters';
  });
  d.projects.forEach((x, i) => {
    if (!hasText(x.title)) e[`proj.${i}.title`] = 'Add a project title';
    if (hasText(x.link)) { const r = validateUrl(x.link, 'any', false); if (!r.ok) e[`proj.${i}.link`] = r.error; }
    if (lines(x.description).length > LIMITS.bullets) e[`proj.${i}.description`] = `Use at most ${LIMITS.bullets} lines`;
    if (x.description.length > 900) e[`proj.${i}.description`] = 'Keep this under 900 characters';
  });
  d.experience.forEach((x, i) => {
    if (!hasText(x.role)) e[`exp.${i}.role`] = 'Add your role';
    if (!hasText(x.organisation)) e[`exp.${i}.organisation`] = 'Add the organisation';
    if (lines(x.description).length > LIMITS.bullets) e[`exp.${i}.description`] = `Use at most ${LIMITS.bullets} lines`;
    if (x.description.length > 900) e[`exp.${i}.description`] = 'Keep this under 900 characters';
  });
  if (lines(d.achievements).length > LIMITS.achievements) e.achievements = `Add at most ${LIMITS.achievements} lines`;
  const filledEdu = d.education.filter((x) => !rowEmpty(x as unknown as Record<string, unknown>));
  if (filledEdu.length === 0 && d.projects.length === 0 && d.experience.length === 0) e.content = 'Add at least your education, a project or experience.';
  return e;
}

/* ----------------------------------------------------- neutral document model */
export interface DocEntry { heading: string; sub?: string; right?: string; link?: string; bullets: string[] }
export interface DocSection { title: string; inline?: string; entries?: DocEntry[]; bullets?: string[] }
export interface ResumeDoc { name: string; contact: string[]; sections: DocSection[] }

const stripProto = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');

export function buildDoc(d: ResumeDraft): ResumeDoc {
  const contact = [
    d.phone.trim() ? d.phone.trim() : '', d.email.trim(), d.city.trim(),
    d.linkedin.trim() ? stripProto(d.linkedin.trim()) : '', d.github.trim() ? stripProto(d.github.trim()) : '', d.portfolio.trim() ? stripProto(d.portfolio.trim()) : '',
  ].filter(Boolean);
  const sections: DocSection[] = [];
  if (hasText(d.summary)) sections.push({ title: 'Summary', inline: d.summary.trim() });

  const edu = d.education.filter((x) => !rowEmpty(x as unknown as Record<string, unknown>));
  if (edu.length) {
    sections.push({
      title: 'Education',
      entries: edu.map((x) => ({
        heading: x.institution.trim(),
        sub: [x.degree.trim(), x.score.trim()].filter(Boolean).join(' | ') || undefined,
        right: x.period.trim() || undefined,
        bullets: lines(x.details),
      })),
    });
  }
  const skills = skillList(d.skills);
  if (skills.length) sections.push({ title: 'Skills', inline: skills.join(', ') });
  if (d.projects.length) {
    sections.push({
      title: 'Projects',
      entries: d.projects.map((x) => ({ heading: x.title.trim(), link: x.link.trim() ? stripProto(x.link.trim()) : undefined, bullets: lines(x.description) })),
    });
  }
  if (d.experience.length) {
    sections.push({
      title: 'Experience',
      entries: d.experience.map((x) => ({
        heading: x.role.trim(), sub: x.organisation.trim(),
        right: [x.from.trim(), x.to.trim()].filter(Boolean).join(' - ') || undefined,
        bullets: lines(x.description),
      })),
    });
  }
  const ach = lines(d.achievements);
  if (ach.length) sections.push({ title: 'Achievements', bullets: ach });
  return { name: d.name.trim(), contact, sections };
}

export const safeFileName = (name: string) => {
  const base = name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Resume';
  return `${base}_Resume.pdf`;
};

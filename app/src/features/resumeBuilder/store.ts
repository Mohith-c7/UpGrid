// Tiny local draft store so a half-written resume survives leaving the screen. Private app storage only; cleared by "Start over".
import { File, Paths } from 'expo-file-system';
import type { ResumeDraft } from './model';

const fileFor = (userId: string) => new File(Paths.document, `resume-draft-${userId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}.json`);

export async function loadDraft(userId: string): Promise<Partial<ResumeDraft> | null> {
  try {
    const f = fileFor(userId);
    if (!f.exists) return null;
    const v = JSON.parse(await f.text());
    return v && typeof v === 'object' ? (v as Partial<ResumeDraft>) : null;
  } catch {
    return null;
  }
}
export function saveDraft(userId: string, d: ResumeDraft): void {
  try {
    const f = fileFor(userId);
    if (!f.exists) f.create();
    f.write(JSON.stringify(d));
  } catch { /* storage full or unavailable: the draft just is not persisted */ }
}
export function clearDraft(userId: string): void {
  try { const f = fileFor(userId); if (f.exists) f.delete(); } catch { /* ignore */ }
}

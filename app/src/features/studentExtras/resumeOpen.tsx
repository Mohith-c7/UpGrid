import React, { useState } from 'react';
import { Linking } from 'react-native';
import { api, ApiError } from '@/api/client';
import { fileUrl } from '@/api/integrations';
import { Button, useToast } from '@/ui';
import { formatBytes } from '@/features/uploads';

/** Shape of a resume entry as the API returns it. Old servers omit kind/fileId, so everything but id/label is optional. */
export interface ResumeLike {
  id: string;
  label: string;
  url?: string | null;
  kind?: 'file' | 'link';
  fileId?: string | null;
  fileName?: string | null;
  size?: number | null;
  isDefault?: boolean;
}

export const isFileResume = (r: Pick<ResumeLike, 'kind' | 'url' | 'fileId'>): boolean => r.kind === 'file' || (!r.url && !!r.fileId);

/** One-line description that never prints a null url. */
export function resumeSubtitle(r: ResumeLike): string {
  if (isFileResume(r)) {
    const bits = [r.fileName ?? 'Uploaded file', typeof r.size === 'number' && r.size > 0 ? formatBytes(r.size) : null].filter(Boolean);
    return bits.join(' · ');
  }
  return r.url ?? 'No link saved';
}

export function resumeErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'FILE_STORAGE_NOT_CONFIGURED') return 'File storage is not available right now, so this file cannot be opened.';
    if (e.code === 'RESUME_NOT_AVAILABLE' || e.code === 'FILE_NOT_FOUND') return 'This resume file is no longer available.';
    if (e.isNetwork) return 'You appear to be offline. Reconnect and try again.';
    return e.message;
  }
  return 'Could not open the resume. Please try again.';
}

async function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported link');
  await Linking.openURL(url);
}

/** Student side: link resumes open their https url, file resumes get a fresh 300 s signed url (never cached). */
export async function openResume(r: ResumeLike): Promise<void> {
  if (isFileResume(r)) {
    if (!r.fileId) throw new Error('This resume file is no longer available.');
    const { url } = await fileUrl(r.fileId);
    return openUrl(url);
  }
  if (!r.url) throw new Error('This resume has no link saved.');
  return openUrl(r.url);
}

/** Officer side: GET /applications/:id/resume-url answers {kind,label,url,fileName?,expiresIn?}. */
export async function openApplicationResume(applicationId: string): Promise<void> {
  const r = await api.get<{ kind?: 'file' | 'link'; url: string | null }>(`/applications/${encodeURIComponent(applicationId)}/resume-url`);
  if (!r?.url) throw new Error('This application has no resume to open.');
  return openUrl(r.url);
}

export function OpenResumeButton({ resume, label = 'Open', size = 'sm', variant = 'secondary' }: {
  resume: ResumeLike; label?: string; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={label} icon="open-in-new" size={size} variant={variant} loading={busy}
      accessibilityLabel={`Open resume ${resume.label}`}
      onPress={async () => {
        setBusy(true);
        try { await openResume(resume); } catch (e) { toast.show(resumeErrorText(e), 'error'); } finally { setBusy(false); }
      }}
    />
  );
}

/** Officer applicant row: opens the resume the student sent with this application. */
export function ApplicantResumeButton({ applicationId }: { applicationId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label="Resume" icon="description" size="sm" variant="secondary" loading={busy}
      accessibilityLabel="Open the resume sent with this application"
      onPress={async () => {
        setBusy(true);
        try { await openApplicationResume(applicationId); } catch (e) { toast.show(resumeErrorText(e), 'error'); } finally { setBusy(false); }
      }}
    />
  );
}

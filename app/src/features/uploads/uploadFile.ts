// Core of the R2 presigned-upload flow: validate -> POST /files/presign -> PUT bytes -> POST /files/:id/confirm.
// No React in here; useFileUpload.ts wraps it.
import { ApiError } from '@/api/client';
import { confirmUpload, presignUpload } from '@/api/integrations';
import type { UploadLimits, UploadPurpose, UploadedFile } from '@/api/integrationsTypes';

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface Rule {
  /** accepted content types (exact match, same as the server allowlist) */
  types: string[];
  limitKey: keyof UploadLimits;
  /** human wording for errors */
  accepts: string;
}
export const RULES: Record<UploadPurpose, Rule> = {
  resume: { types: ['application/pdf', DOCX], limitKey: 'resumeMb', accepts: 'a PDF or Word (.docx) file' },
  photo: { types: ['image/png', 'image/jpeg', 'image/webp'], limitKey: 'photoMb', accepts: 'a PNG, JPG or WebP image' },
  company_logo: { types: ['image/png', 'image/jpeg', 'image/webp'], limitKey: 'logoMb', accepts: 'a PNG, JPG or WebP image (no SVG)' },
  document: { types: ['application/pdf', 'image/png', 'image/jpeg'], limitKey: 'documentMb', accepts: 'a PDF, PNG or JPG file' },
};

const EXT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX,
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface PickedFile {
  uri: string;
  name: string;
  /** as reported by the picker (may be empty or generic) */
  mimeType?: string | null;
  /** bytes as reported by the picker; measured again from the data before upload */
  size?: number | null;
}

export type UploadStage = 'checking' | 'presign' | 'upload' | 'confirm';

export class UploadError extends Error {
  code: string;
  stage: UploadStage;
  retryable: boolean;
  /** set when the bytes are already uploaded and only confirm failed: pass back as `resumeFileId` */
  fileId?: string;
  constructor(message: string, code: string, stage: UploadStage, retryable: boolean, fileId?: string) {
    super(message);
    Object.setPrototypeOf(this, UploadError.prototype);
    this.name = 'UploadError';
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
    this.fileId = fileId;
  }
}

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

export function resolveContentType(purpose: UploadPurpose, file: PickedFile): string | null {
  const allowed = RULES[purpose].types;
  const declared = (file.mimeType ?? '').toLowerCase().trim();
  if (allowed.includes(declared)) return declared;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXT_TYPE[ext];
  // generic or missing mime types are common from document providers: trust the extension only then
  if (byExt && allowed.includes(byExt) && (!declared || declared === 'application/octet-stream' || declared === '*/*')) return byExt;
  return null;
}

/** Cheap checks before any network call. Returns an error message or null. */
export function checkPicked(purpose: UploadPurpose, file: PickedFile, limits: UploadLimits): string | null {
  const rule = RULES[purpose];
  if (!resolveContentType(purpose, file)) return `Choose ${rule.accepts}.`;
  const maxMb = limits[rule.limitKey];
  if (file.size === 0) return 'This file is empty. Choose another file.';
  if (file.size != null && file.size > maxMb * 1024 * 1024) return `This file is ${formatBytes(file.size)}. The limit is ${maxMb} MB.`;
  return null;
}

function explain(e: unknown, stage: UploadStage, fileId?: string): UploadError {
  if (e instanceof UploadError) return e;
  if (e instanceof ApiError) {
    const f = e.fields ? Object.values(e.fields)[0] : undefined;
    switch (e.code) {
      case 'FILE_STORAGE_NOT_CONFIGURED':
        return new UploadError('File uploads are not available right now.', e.code, stage, false);
      case 'FILE_QUOTA_EXCEEDED':
        return new UploadError('You have reached the limit of 20 stored files. Delete an old file and try again.', e.code, stage, false);
      case 'RATE_LIMITED':
        return new UploadError('Too many uploads in a short time. Wait a few minutes and try again.', e.code, stage, true);
      case 'FORBIDDEN':
        return new UploadError('Your account cannot upload this kind of file.', e.code, stage, false);
      case 'VALIDATION_ERROR':
        return new UploadError(f ?? 'The server rejected this file.', e.code, stage, false);
      case 'FILE_MISMATCH':
        return new UploadError('The uploaded file did not match its details. Please try again.', e.code, stage, true);
      case 'UPLOAD_NOT_FOUND':
        return new UploadError('The upload did not finish. Please try again.', e.code, stage, true, fileId);
      case 'FILE_NOT_FOUND':
        return new UploadError('That upload expired. Please try again.', e.code, stage, true);
      default:
        return new UploadError(e.message, e.code, stage, e.isNetwork || e.status >= 500 || e.status === 429, stage === 'confirm' ? fileId : undefined);
    }
  }
  return new UploadError('Something went wrong while uploading. Please try again.', 'UNKNOWN', stage, true, stage === 'confirm' ? fileId : undefined);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function putBlob(
  url: string,
  headers: Record<string, string>,
  blob: Blob,
  onProgress: (fraction: number) => void,
  register: (abort: () => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(() => xhr.abort());
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) onProgress(Math.min(1, ev.loaded / ev.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else if (xhr.status === 403 || xhr.status === 401) {
        reject(new UploadError('The upload link expired.', 'URL_EXPIRED', 'upload', true));
      } else {
        reject(new UploadError(`Upload failed (${xhr.status}). Please try again.`, 'UPLOAD_FAILED', 'upload', xhr.status >= 500 || xhr.status === 408 || xhr.status === 429));
      }
    };
    xhr.onerror = () => reject(new UploadError('Network problem during upload. Check your connection and retry.', 'NETWORK', 'upload', true));
    xhr.ontimeout = () => reject(new UploadError('The upload is taking too long. Check your connection and retry.', 'TIMEOUT', 'upload', true));
    xhr.onabort = () => reject(new UploadError('Upload cancelled.', 'CANCELLED', 'upload', true));
    xhr.send(blob);
  });
}

export interface StartUploadOptions {
  purpose: UploadPurpose;
  file: PickedFile;
  limits: UploadLimits;
  onProgress?: (fraction: number) => void;
  onStage?: (stage: UploadStage) => void;
  /** skip straight to confirm for a file whose bytes were already uploaded (after a failed confirm) */
  resumeFileId?: string;
}
export interface UploadHandle {
  promise: Promise<UploadedFile>;
  cancel: () => void;
}

export function startUpload(opts: StartUploadOptions): UploadHandle {
  const { purpose, file, limits } = opts;
  let cancelled = false;
  let abortPut: (() => void) | null = null;
  const cancel = () => {
    cancelled = true;
    abortPut?.();
  };
  const guard = (stage: UploadStage) => {
    if (cancelled) throw new UploadError('Upload cancelled.', 'CANCELLED', stage, true);
  };

  const promise = (async (): Promise<UploadedFile> => {
    let fileId = opts.resumeFileId;
    if (!fileId) {
      opts.onStage?.('checking');
      const pre = checkPicked(purpose, file, limits);
      if (pre) throw new UploadError(pre, 'INVALID_FILE', 'checking', false);
      const contentType = resolveContentType(purpose, file)!;

      let blob: Blob;
      try {
        blob = await (await fetch(file.uri)).blob();
      } catch {
        throw new UploadError('Could not read this file. Choose it again.', 'READ_FAILED', 'checking', false);
      }
      guard('checking');
      const maxMb = limits[RULES[purpose].limitKey];
      if (blob.size === 0) throw new UploadError('This file is empty. Choose another file.', 'INVALID_FILE', 'checking', false);
      if (blob.size > maxMb * 1024 * 1024) {
        throw new UploadError(`This file is ${formatBytes(blob.size)}. The limit is ${maxMb} MB.`, 'INVALID_FILE', 'checking', false);
      }

      // presign + PUT; one automatic fresh presign if the link has expired
      for (let attempt = 0; attempt < 2; attempt++) {
        opts.onStage?.('presign');
        let p;
        try {
          p = await presignUpload({ purpose, fileName: file.name.slice(0, 200), contentType, size: blob.size });
        } catch (e) {
          throw explain(e, 'presign');
        }
        guard('presign');
        fileId = p.fileId;
        opts.onStage?.('upload');
        opts.onProgress?.(0);
        try {
          await putBlob(p.uploadUrl, p.headers ?? { 'Content-Type': contentType }, blob, (f) => opts.onProgress?.(f), (a) => (abortPut = a));
          break;
        } catch (e) {
          if (e instanceof UploadError && e.code === 'URL_EXPIRED' && attempt === 0 && !cancelled) continue;
          throw e;
        }
      }
    }

    opts.onStage?.('confirm');
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      guard('confirm');
      try {
        const r = await confirmUpload(fileId!);
        return r.file;
      } catch (e) {
        lastErr = e;
        // storage can lag a moment behind the PUT
        if (e instanceof ApiError && e.code === 'UPLOAD_NOT_FOUND' && i < 2) {
          await sleep(1200);
          continue;
        }
        break;
      }
    }
    throw explain(lastErr, 'confirm', fileId);
  })().catch((e) => {
    throw e instanceof UploadError ? e : explain(e, 'upload', opts.resumeFileId);
  });

  return { promise, cancel };
}

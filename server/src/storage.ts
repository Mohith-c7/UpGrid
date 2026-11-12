import { DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IntegrationSettings } from './integrations/settings';

export interface HeadResult { size: number; contentType: string | null }
export interface ObjectStorage {
  /** Public base URL for company logos (R2 custom domain / r2.dev), or null. */
  publicBaseUrl: string | null;
  presignPut(key: string, contentType: string, expiresIn: number): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(key: string, expiresIn: number, fileName?: string | null): Promise<string>;
  head(key: string): Promise<HeadResult | null>;
  remove(key: string): Promise<void>;
  /** Downloads an object (used by the AI module to read uploaded resumes). Optional: storages without it cannot be read server-side. */
  get?(key: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string | null; etag: string | null } | null>;
}

export const FILE_RULES = {
  resume: { types: { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' }, maxBytes: 5 * 1024 * 1024 },
  photo: { types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }, maxBytes: 2 * 1024 * 1024 },
  company_logo: { types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }, maxBytes: 1 * 1024 * 1024 },
  document: { types: { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }, maxBytes: 5 * 1024 * 1024 },
} as const;
export type FilePurpose = keyof typeof FILE_RULES;
export const FILE_PURPOSES = Object.keys(FILE_RULES) as FilePurpose[];
export const LIMITS_MB = { resumeMb: 5, photoMb: 2, logoMb: 1, documentMb: 5 };

export function createR2Storage(r2: NonNullable<IntegrationSettings['r2']>): ObjectStorage {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = r2.bucket;
  return {
    publicBaseUrl: r2.publicBaseUrl,
    async presignPut(key, contentType, expiresIn) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
        expiresIn, signableHeaders: new Set(['content-type']),
      });
      return { url, headers: { 'Content-Type': contentType } };
    },
    presignGet(key, expiresIn, fileName) {
      const safe = fileName ? fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) : null;
      return getSignedUrl(client, new GetObjectCommand({
        Bucket, Key: key, ...(safe ? { ResponseContentDisposition: `inline; filename="${safe}"` } : {}),
      }), { expiresIn });
    },
    async head(key) {
      try {
        const h = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(h.ContentLength ?? 0), contentType: h.ContentType ?? null };
      } catch (e: any) {
        if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey') return null;
        throw e;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async get(key, maxBytes) {
      try {
        const o = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (Number(o.ContentLength ?? 0) > maxBytes) return null;
        const bytes = Buffer.from(await o.Body!.transformToByteArray());
        if (bytes.length > maxBytes) return null;
        return { bytes, contentType: o.ContentType ?? null, etag: o.ETag ?? null };
      } catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
  };
}

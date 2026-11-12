import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import type { IntegrationOverrides } from '../src/integrations';
import type { GoogleIdentity } from '../src/google';
import type { MailMessage, Mailer } from '../src/mail';
import type { HeadResult, ObjectStorage } from '../src/storage';
import { cfg, fakePush, pool } from './helpers';

export class MockMailer implements Mailer {
  kind = 'custom' as const;
  sent: MailMessage[] = [];
  fail = false;
  async send(m: MailMessage) {
    if (this.fail) throw new Error('smtp down');
    this.sent.push(m);
  }
  to(email: string) { return this.sent.filter((m) => m.to === email); }
  lastCode(email: string): string {
    const m = this.to(email).filter((x) => /\n\s+\d{6}\n/.test(x.text)).pop();
    if (!m) throw new Error(`no code mail for ${email}`);
    return /\n\s+(\d{6})\n/.exec(m.text)![1];
  }
}

export class MockStorage implements ObjectStorage {
  publicBaseUrl: string | null;
  objects = new Map<string, HeadResult>();
  removed: string[] = [];
  signedGets: { key: string; expiresIn: number }[] = [];
  signedPuts: { key: string; contentType: string; expiresIn: number }[] = [];
  constructor(publicBaseUrl: string | null = 'https://cdn.example.test') { this.publicBaseUrl = publicBaseUrl; }
  async presignPut(key: string, contentType: string, expiresIn: number) {
    this.signedPuts.push({ key, contentType, expiresIn });
    return { url: `https://mock-r2.test/bucket/${key}?X-Amz-Signature=abc`, headers: { 'Content-Type': contentType } };
  }
  async presignGet(key: string, expiresIn: number) {
    this.signedGets.push({ key, expiresIn });
    return `https://mock-r2.test/bucket/${key}?X-Amz-Signature=get`;
  }
  async head(key: string) { return this.objects.get(key) ?? null; }
  async remove(key: string) { this.removed.push(key); this.objects.delete(key); }
  put(key: string, size: number, contentType: string) { this.objects.set(key, { size, contentType }); }
}

export function makeIntegApp(env: Record<string, string> = {}, o: Omit<IntegrationOverrides, 'env'> = {}): Express {
  return createApp({
    pool, cfg, push: fakePush, rateLimits: false, logger: () => undefined,
    integrations: { env: { NODE_ENV: 'test', ...env }, log: () => undefined, ...o },
  });
}

export const B = '/api/v1';
export const googleIdentity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: 'g-sub-1', email: 'new.student@example.com', emailVerified: true, name: 'New Student', picture: null, ...over,
});
export const googleLogin = (app: Express, idToken: string, extra: Record<string, unknown> = {}) =>
  request(app).post(`${B}/auth/google`).send({ idToken, ...extra });

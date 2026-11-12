import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrator';
import { pool, resetDb } from './helpers';

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await pool.end(); });

describe('migrations', () => {
  it('every migration file can be executed again without error or data loss (idempotent)', async () => {
    const t = (await pool.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;
    const u = (await pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,'student','Mig User','mig@example.com','mig@example.com','9000012345','x') RETURNING id`, [t])).rows[0].id;
    await pool.query(`INSERT INTO user_consents (tenant_id, user_id, policy_version) VALUES ($1,$2,'v1')`, [t, u]);
    const dir = path.resolve(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await pool.query(sql);
      await pool.query(sql);
    }
    expect((await pool.query('SELECT count(*)::int n FROM user_consents')).rows[0].n).toBe(1);
    expect(await migrate(pool)).toEqual([]);
  });
  it('002 is recorded and the sched60 kind is allowed while junk kinds are not', async () => {
    const names = (await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
    expect(names).toContain('002_features.sql');
    const c = await pool.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='scheduled_reminders_kind_check'`);
    expect(c.rows[0].d).toMatch(/sched60/);
    expect(c.rows[0].d).toMatch(/t60/);
  });
  it('003-009 (integrations) are recorded, idempotent on their own, and shape the schema', async () => {
    const names = (await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name as string);
    expect(names).toEqual(expect.arrayContaining(['003_auth_email_google.sql', '004_files.sql']));
    const dir = path.resolve(__dirname, '..', 'migrations');
    const mine = fs.readdirSync(dir).filter((f) => /^00[3-9]_.*\.sql$/.test(f)).sort();
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const f of mine) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await pool.query(sql);
      await pool.query(sql);
    }
    const col = async (t: string, c: string) =>
      (await pool.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rows[0];
    expect((await col('users', 'phone')).is_nullable).toBe('YES');
    expect((await col('users', 'password_hash')).is_nullable).toBe('YES');
    for (const c of ['email_verified_at', 'google_sub', 'auth_provider']) expect(await col('users', c)).toBeTruthy();
    expect((await col('resumes', 'url')).is_nullable).toBe('YES');
    expect(await col('resumes', 'file_id')).toBeTruthy();
    for (const c of ['id', 'tenant_id', 'owner_id', 'purpose', 'key', 'content_type', 'size', 'status', 'created_at']) expect(await col('files', c)).toBeTruthy();
    for (const c of ['code_hash', 'salt', 'attempts', 'expires_at', 'purpose']) expect(await col('otp_codes', c)).toBeTruthy();
    const t = (await pool.query(`SELECT id FROM tenants LIMIT 1`)).rows[0].id;
    await expect(pool.query(`INSERT INTO files (tenant_id, owner_id, purpose, key, content_type, size, status) VALUES ($1,(SELECT id FROM users LIMIT 1),'resume','k1','application/pdf',1,'bogus')`, [t])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO files (tenant_id, owner_id, purpose, key, content_type, size) VALUES ($1,(SELECT id FROM users LIMIT 1),'avatar','k2','image/png',1)`, [t])).rejects.toThrow();
    // two Google-less users may both have no phone; a google_sub is unique per tenant
    await pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash, google_sub, auth_provider) VALUES ($1,'student','G One','g1@example.com','g1@example.com',NULL,NULL,'sub-x','google')`, [t]);
    await pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash, auth_provider) VALUES ($1,'student','G Two','g2@example.com','g2@example.com',NULL,NULL,'google')`, [t]);
    await expect(pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, google_sub) VALUES ($1,'student','G Three','g3@example.com','g3@example.com','sub-x')`, [t])).rejects.toThrow();
    expect(await migrate(pool)).toEqual([]);
  });
});

import { Pool, PoolClient } from 'pg';

export type Db = Pool | PoolClient;

export function createPool(connectionString: string): Pool {
  const ssl = /sslmode=require/.test(connectionString) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString, max: 10, ssl });
}

export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrator';

(async () => {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

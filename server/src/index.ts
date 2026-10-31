import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const pool = createPool();
await migrate(pool);
// First start on a fresh database: create the admin account from the environment.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  await seed(pool, {
    demo: process.env.SEED_DEMO === 'true',
    adminEmail: process.env.ADMIN_EMAIL.toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD,
  });
}
const app = await buildApp({ pool, logger: true });
await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

/**
 * Entry point for serverless hosting (Vercel). The office web app is served
 * as static files by the host, so this handles /api only. Set up once per
 * warm instance: run migrations, create the first admin, build the app.
 */
let ready: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const pool = createPool();
  await migrate(pool);
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await seed(pool, {
      demo: process.env.SEED_DEMO === 'true',
      adminEmail: process.env.ADMIN_EMAIL.toLowerCase(),
      adminPassword: process.env.ADMIN_PASSWORD,
    });
  }
  const app = await buildApp({ pool, serveWeb: false, logger: true });
  await app.ready();
  return app;
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= init().catch((err) => {
    ready = null;
    throw err;
  });
  const app = await ready;
  app.server.emit('request', req, res);
}

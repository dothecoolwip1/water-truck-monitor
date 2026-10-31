import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type pg from 'pg';
import { config } from './config.js';
import { HttpError } from './http.js';
import { LiveBus } from './lib/events.js';
import { expoPush, type PushSender } from './lib/push.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import jobRoutes from './routes/jobs.js';
import driverRoutes from './routes/driver.js';
import ingestRoutes from './routes/ingest.js';
import reportRoutes from './routes/reports.js';
import liveRoutes from './routes/live.js';
import fileRoutes from './routes/files.js';

export interface AppDeps {
  pool: pg.Pool;
  push?: PushSender;
  bus?: LiveBus;
  logger?: boolean;
  serveWeb?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    pool: pg.Pool;
    push: PushSender;
    bus: LiveBus;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Driver sync batches can carry meter photos and signatures.
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });
  app.decorate('pool', deps.pool);
  app.decorate('push', deps.push ?? expoPush);
  app.decorate('bus', deps.bus ?? new LiveBus());

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyJwt, { secret: config.jwtSecret, sign: { expiresIn: '30d' } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message, details: err.details });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'That already exists' });
    if (pgCode === '23503') return reply.status(400).send({ error: 'Refers to a record that does not exist' });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply.status((err as { statusCode: number }).statusCode).send({ error: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server' });
  });

  app.get('/api/health', async () => {
    await deps.pool.query('select 1');
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(jobRoutes, { prefix: '/api' });
  await app.register(driverRoutes, { prefix: '/api/driver' });
  await app.register(ingestRoutes, { prefix: '/api/ingest' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(liveRoutes, { prefix: '/api' });
  await app.register(fileRoutes, { prefix: '/api' });

  if ((deps.serveWeb ?? true) && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    // Client-side routing: unknown non-API paths load the web app.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

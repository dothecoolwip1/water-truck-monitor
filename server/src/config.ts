import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// The server package root, whether running from src/ (tsx) or dist/src/ (compiled).
function findServerRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not locate server package root');
    dir = parent;
  }
  return dir;
}
const serverRoot = findServerRoot();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://postgres@localhost:5432/watertruck'),
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-secret-change-me'),
  // Where the built office web app lives; served at / when present.
  webDist: process.env.WEB_DIST ?? path.resolve(serverRoot, '../web/dist'),
  migrationsDir: path.join(serverRoot, 'migrations'),
  timezone: process.env.APP_TIMEZONE ?? 'America/Edmonton',
  expoPushUrl: process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send',
  pushEnabled: process.env.PUSH_ENABLED !== 'false',
};

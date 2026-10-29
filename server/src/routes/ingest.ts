import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http.js';
import { readingToLitres } from '../lib/tank.js';
import { hashKey } from './admin.js';

const reading = z.object({
  ts: z.union([z.string().datetime({ offset: true }), z.number()]).optional(),
  volume_l: z.coerce.number().nullish(),
  level_mm: z.coerce.number().nullish(),
  level_pct: z.coerce.number().nullish(),
  distance_mm: z.coerce.number().nullish(),
});

function toDate(ts: string | number | undefined): Date {
  if (ts === undefined) return new Date();
  // Unix seconds or milliseconds, as many sensor gateways send.
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts);
  return new Date(ts);
}

/**
 * Tank level feed. Any sensor or gateway that can make an HTTPS POST can
 * report here. Authenticate with the device id and the key shown when the
 * tank was added, either as headers or as a bearer token.
 */
const routes: FastifyPluginAsync = async (app) => {
  app.post('/tank-readings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = (req.headers['x-device-id'] as string | undefined) ?? (body.device_id as string | undefined);
    const auth = req.headers.authorization;
    const key = (req.headers['x-device-key'] as string | undefined) ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!deviceId || !key) throw new HttpError(401, 'Device id and key required');

    const { rows } = await app.pool.query('select * from source_tanks where device_id = $1', [deviceId]);
    const tank = rows[0];
    const expected = tank ? Buffer.from(tank.device_key_hash, 'hex') : Buffer.alloc(32);
    const given = Buffer.from(hashKey(key), 'hex');
    if (!tank || !crypto.timingSafeEqual(expected, given)) throw new HttpError(401, 'Unknown device or wrong key');

    const list = parse(z.array(reading).min(1).max(1000), Array.isArray(body.readings) ? body.readings : [body]);
    let stored = 0;
    let latest: { ts: Date; volume_l: number } | null = null;
    for (const r of list) {
      const volume = readingToLitres(tank, r);
      if (volume === null) throw new HttpError(400, 'Each reading needs volume_l, level_mm, distance_mm or level_pct');
      const ts = toDate(r.ts);
      if (Number.isNaN(ts.getTime())) throw new HttpError(400, 'Bad timestamp');
      const res = await app.pool.query(
        `insert into tank_readings (tank_id, ts, level_mm, level_pct, volume_l, raw) values ($1,$2,$3,$4,$5,$6)
         on conflict (tank_id, ts) do nothing`,
        [tank.id, ts, r.level_mm ?? null, r.level_pct ?? null, volume, JSON.stringify(r)],
      );
      stored += res.rowCount ?? 0;
      if (!latest || ts > latest.ts) latest = { ts, volume_l: volume };
    }
    if (latest) app.bus.publish({ type: 'tank', tankId: tank.id, volume_l: latest.volume_l, ts: latest.ts.toISOString() });
    reply.status(202);
    return { stored, received: list.length };
  });
};

export default routes;

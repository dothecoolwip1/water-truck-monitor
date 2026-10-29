import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { LiveEvent } from '../lib/events.js';
import { HttpError, office } from '../http.js';

const routes: FastifyPluginAsync = async (app) => {
  // Latest known position of everyone on duty, for the dispatch map.
  app.get('/live/positions', { preHandler: office }, async () => {
    const { rows } = await app.pool.query(
      `select s.driver_id, u.name as driver_name, s.truck_id, t.name as truck_name, s.started_at,
              p.lat, p.lng, p.ts, p.speed_mps, p.heading,
              (select j.number from jobs j where j.driver_id = s.driver_id and j.status in ('en_route','arrived')
                order by j.started_at desc limit 1) as current_job_number
       from shifts s join users u on u.id = s.driver_id join trucks t on t.id = s.truck_id
       left join lateral (select lat, lng, ts, speed_mps, heading from gps_points g
                          where g.driver_id = s.driver_id and g.ts >= s.started_at order by ts desc limit 1) p on true
       where s.ended_at is null order by u.name`,
    );
    return rows;
  });

  // Server-sent events so dispatch screens update without refreshing. EventSource
  // can't set headers, so the token comes in the query string.
  app.get('/live/stream', async (req, reply) => {
    // Serverless hosts can't fan events out between instances; the office app polls instead.
    if (process.env.LIVE_STREAM === 'off') return reply.status(204).send();
    const { token } = z.object({ token: z.string() }).parse(req.query);
    try {
      const user = app.jwt.verify<{ role: string }>(token);
      if (!['admin', 'dispatcher'].includes(user.role)) throw new Error('role');
    } catch {
      throw new HttpError(401, 'Sign in required');
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');
    const send = (e: LiveEvent) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    app.bus.on('event', send);
    req.raw.on('close', () => {
      clearInterval(ping);
      app.bus.off('event', send);
    });
    return reply.hijack();
  });
};

export default routes;

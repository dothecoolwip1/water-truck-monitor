import type { FastifyPluginAsync } from 'fastify';
import { LIVE_CHANNEL, type LiveEvent } from '../lib/events.js';
import { office } from '../http.js';

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

  // How this browser should get live events: Ably (serverless) or our own stream.
  app.get('/live/config', { preHandler: office }, async (req) => {
    if (!app.bus.relayed) return { mode: process.env.LIVE_STREAM === 'off' ? 'poll' : 'sse' };
    const token = (await app.bus.token(req.user.id)) as { token: string; expires: number };
    return { mode: 'ably', channel: LIVE_CHANNEL, token: token.token, expires: token.expires };
  });

  // Server-sent events so dispatch screens update without refreshing. EventSource
  // can't set headers, so the token comes in the query string.
  app.get('/live/stream', { preHandler: office }, async (req, reply) => {
    // Serverless hosts can't fan events out between instances; the office app polls instead.
    if (process.env.LIVE_STREAM === 'off') return reply.status(204).send();
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

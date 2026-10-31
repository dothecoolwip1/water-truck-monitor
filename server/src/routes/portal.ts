import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { distanceM } from '../lib/geo.js';
import { notifyUsers, officeUsers } from '../lib/notify.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, optionalText, parse, requireRole, uuid } from '../http.js';

const resident = requireRole('resident');
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

// A small in-memory brake on guessing account codes. Serverless instances each keep their own, which is fine as a brake.
const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 8) throw new HttpError(429, 'Too many tries. Please wait a few minutes and try again.');
  attempts.set(key, a && a.until > now ? { n: a.n + 1, until: a.until } : { n: 1, until: now + 10 * 60_000 });
}

const firstName = (n: string | null) => (n ? n.split(/\s+/)[0] : null);

/** Public status for a tracking link: where the job is, and the truck when it's on the way. */
async function trackInfo(app: Parameters<FastifyPluginAsync>[0], token: string) {
  const { rows } = await app.pool.query(
    `select j.id, j.number, j.status, j.scheduled_date, j.requested_litres, j.priority, j.created_at, j.started_at, j.arrived_at, j.completed_at, j.cancelled_at,
            j.driver_id, s.label as site_label, s.address as site_address, s.lat as site_lat, s.lng as site_lng,
            d.name as driver_name, t.name as truck_name, dl.litres as delivered_litres,
            (select count(*)::int from jobs q where q.driver_id = j.driver_id and q.scheduled_date = j.scheduled_date
               and q.status in ('scheduled', 'en_route', 'arrived') and q.sort_order < j.sort_order) as stops_before
     from jobs j join sites s on s.id = j.site_id left join users d on d.id = j.driver_id left join trucks t on t.id = j.truck_id
     left join deliveries dl on dl.job_id = j.id where j.track_token = $1`,
    [token],
  );
  const j = rows[0];
  if (!j) throw new HttpError(404, 'We could not find that request. Check the link.');
  let truck: { lat: number; lng: number; ts: string } | null = null;
  let eta_minutes: number | null = null;
  if (j.status === 'en_route' && j.driver_id) {
    const p = await app.pool.query(
      `select lat, lng, ts from gps_points where driver_id = $1 and ts > now() - interval '15 minutes' order by ts desc limit 1`,
      [j.driver_id],
    );
    if (p.rows[0]) {
      truck = p.rows[0];
      if (j.site_lat !== null) {
        // Town driving: about 25 km/h door to door, plus a minute to get going.
        const km = (distanceM(p.rows[0].lat, p.rows[0].lng, j.site_lat, j.site_lng) * 1.3) / 1000;
        eta_minutes = Math.max(1, Math.round((km / 25) * 60) + 1);
      }
    }
  }
  return {
    number: j.number, status: j.status, scheduled_date: j.scheduled_date, requested_litres: j.requested_litres, urgent: j.priority === 2,
    site_label: j.site_label, site_address: j.site_address, site_lat: j.site_lat, site_lng: j.site_lng,
    driver_first_name: firstName(j.driver_name), truck_name: j.truck_name, delivered_litres: j.delivered_litres,
    created_at: j.created_at, started_at: j.started_at, arrived_at: j.arrived_at, completed_at: j.completed_at, cancelled_at: j.cancelled_at,
    stops_before: j.status === 'scheduled' ? j.stops_before : null, truck, eta_minutes,
  };
}

const routes: FastifyPluginAsync = async (app) => {
  app.get('/config', async () => {
    const s = await getSettings(app.pool);
    return { enabled: s.portal.enabled, org_name: s.company.name, phone: s.company.phone, message: s.portal.message, max_litres: s.portal.max_litres };
  });

  // Residents sign in with their account number and the phone number on file.
  app.post('/sign-in', async (req) => {
    const s = await getSettings(app.pool);
    if (!s.portal.enabled) throw new HttpError(403, 'Online requests are turned off. Please phone the office.');
    const b = parse(z.object({ account_code: z.string().trim().min(1).max(40), phone: z.string().trim().min(4).max(40) }), req.body);
    throttle(`${req.ip}`);
    const { rows } = await app.pool.query(
      `select id, name, phone from customers where active and lower(account_code) = lower($1)`,
      [b.account_code],
    );
    const c = rows[0];
    const given = digits(b.phone);
    const onFile = digits(c?.phone);
    // The last seven digits must match (enough to rule out guessing, forgiving of area codes and formatting).
    if (!c || onFile.length < 4 || given.length < 4 || onFile.slice(-7) !== given.slice(-7)) {
      throw new HttpError(401, "That account number and phone don't match our records. Phone the office if you need help.");
    }
    attempts.delete(`${req.ip}`);
    const token = app.jwt.sign({ id: c.id, role: 'resident', name: c.name }, { expiresIn: '12h' });
    return { token, customer_name: c.name };
  });

  app.get('/me', { preHandler: resident }, async (req) => {
    const [sites, jobs] = await Promise.all([
      app.pool.query(`select id, label, address, lat, lng, tank_capacity_l from sites where customer_id = $1 and active order by label`, [req.user.id]),
      app.pool.query(
        `select j.number, j.status, j.scheduled_date, j.requested_litres, j.created_at, j.completed_at, j.track_token, s.label as site_label, dl.litres as delivered_litres
         from jobs j join sites s on s.id = j.site_id left join deliveries dl on dl.job_id = j.id
         where j.customer_id = $1 and j.status <> 'cancelled' order by j.created_at desc limit 12`,
        [req.user.id],
      ),
    ]);
    return { customer_name: req.user.name, sites: sites.rows, jobs: jobs.rows };
  });

  app.post('/requests', { preHandler: resident }, async (req, reply) => {
    const s = await getSettings(app.pool);
    if (!s.portal.enabled) throw new HttpError(403, 'Online requests are turned off. Please phone the office.');
    const b = parse(
      z.object({
        site_id: uuid,
        litres: z.number().int().min(100).max(s.portal.max_litres).nullish(),
        out_of_water: z.boolean().default(false),
        name: z.string().trim().min(1).max(80),
        phone: z.string().trim().min(4).max(40),
        notes: optionalText,
      }),
      req.body,
    );
    const job = await tx(app.pool, async (c) => {
      const site = (await c.query('select id, label from sites where id = $1 and customer_id = $2 and active', [b.site_id, req.user.id])).rows[0];
      if (!site) throw new HttpError(404, 'That address is not on your account');
      const open = await c.query(
        `select number, track_token from jobs where site_id = $1 and status in ('requested', 'scheduled', 'en_route', 'arrived') order by created_at desc limit 1`,
        [b.site_id],
      );
      if (open.rows[0]) {
        throw new HttpError(409, `There is already a delivery on the way for ${site.label} (request #${open.rows[0].number}).`, { track_token: open.rows[0].track_token });
      }
      const token = randomBytes(12).toString('base64url');
      const { rows } = await c.query(
        `insert into jobs (customer_id, site_id, requested_litres, priority, notes, status, source, track_token, requester_name, requester_phone)
         values ($1,$2,$3,$4,$5,'requested','portal',$6,$7,$8) returning id, number`,
        [req.user.id, b.site_id, b.litres ?? null, b.out_of_water ? 2 : 0, b.notes ?? null, token, b.name, b.phone],
      );
      await audit(c, 'job', rows[0].id, 'created', null, { source: 'portal', by: b.name, phone: b.phone });
      await notifyUsers(app, c, await officeUsers(c), {
        kind: 'request',
        title: b.out_of_water ? `Out of water: ${site.label}` : `New request: ${site.label}`,
        body: `${b.name} asked for ${b.litres ? `${b.litres.toLocaleString('en-CA')} L` : 'a fill'} (#${rows[0].number})`,
        jobId: rows[0].id,
      });
      return { id: rows[0].id, number: rows[0].number, track_token: token };
    });
    app.bus.publish({ type: 'job', jobId: job.id, status: 'requested' });
    reply.status(201);
    return { number: job.number, track_token: job.track_token };
  });

  app.get('/track/:token', async (req) => {
    const token = parse(z.string().min(10).max(40), (req.params as { token: string }).token);
    return trackInfo(app, token);
  });
};

export default routes;

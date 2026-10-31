import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { insideGeofence } from '../lib/geo.js';
import { arriveJob, completeJob, JOB_SELECT, startJob } from '../lib/jobs.js';
import { HttpError, optionalText, parse, requireRole, uuid, type AuthUser } from '../http.js';
import { config } from '../config.js';

const driverOnly = requireRole('driver', 'admin');

const at = z.string().datetime({ offset: true });
const clientId = z.string().min(8).max(100);
const file = z.object({ mime: z.enum(['image/jpeg', 'image/png']), data_base64: z.string().max(12_000_000) });

const op = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shift_start'), client_id: clientId, at, truck_id: uuid, start_meter: z.number().min(0).nullish() }),
  z.object({ type: z.literal('shift_end'), client_id: clientId, at, end_meter: z.number().min(0).nullish() }),
  z.object({ type: z.literal('job_start'), client_id: clientId, at, job_id: uuid }),
  z.object({ type: z.literal('job_arrive'), client_id: clientId, at, job_id: uuid, source: z.enum(['geofence', 'manual']) }),
  z.object({
    type: z.literal('job_complete'),
    client_id: clientId,
    at,
    job_id: uuid,
    litres: z.number().min(0).max(100_000),
    meter_start: z.number().min(0).nullish(),
    meter_end: z.number().min(0).nullish(),
    recipient_name: optionalText,
    notes: optionalText,
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    meter_photo: file.nullish(),
    signature: file.nullish(),
  }),
  z.object({
    type: z.literal('fill'),
    client_id: clientId,
    started_at: at,
    ended_at: at,
    tank_id: uuid.nullish(),
    litres_reported: z.number().min(0).max(100_000).nullish(),
  }),
  z.object({
    type: z.literal('gps'),
    client_id: clientId,
    points: z
      .array(
        z.object({
          ts: at,
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracy_m: z.number().nullish(),
          speed_mps: z.number().nullish(),
          heading: z.number().nullish(),
        }),
      )
      .max(2000),
  }),
]);
type Op = z.infer<typeof op>;

export interface OpResult {
  client_id: string;
  ok: boolean;
  error?: string;
  // Permanent failures will never succeed on retry; the phone should stop sending them.
  permanent?: boolean;
}

async function openShift(c: pg.PoolClient | pg.Pool, driverId: string) {
  const { rows } = await c.query(
    `select s.*, t.name as truck_name from shifts s join trucks t on t.id = s.truck_id
     where s.driver_id = $1 and s.ended_at is null order by s.started_at desc limit 1`,
    [driverId],
  );
  return rows[0] ?? null;
}

async function saveFile(c: pg.PoolClient, clientKey: string, kind: string, f: z.infer<typeof file>, userId: string) {
  const data = Buffer.from(f.data_base64, 'base64');
  const { rows } = await c.query(
    `insert into files (client_id, kind, mime, data, created_by) values ($1,$2,$3,$4,$5)
     on conflict (client_id) do update set client_id = excluded.client_id returning id`,
    [clientKey, kind, f.mime, data, userId],
  );
  return rows[0].id as string;
}

async function assertOwnJob(c: pg.PoolClient, jobId: string, user: AuthUser) {
  const { rows } = await c.query('select driver_id, number from jobs where id = $1', [jobId]);
  if (!rows[0]) throw new HttpError(404, 'Job not found');
  if (user.role === 'driver' && rows[0].driver_id && rows[0].driver_id !== user.id) {
    throw new HttpError(403, `Job #${rows[0].number} was reassigned to another driver`);
  }
}

const routes: FastifyPluginAsync = async (app) => {
  app.get('/today', { preHandler: driverOnly }, async (req) => {
    const driverId = req.user.id;
    const [shift, jobs, trucks, tanks] = await Promise.all([
      openShift(app.pool, driverId),
      // Today's jobs plus anything older that's still open, so nothing slips off the list.
      app.pool.query(
        `${JOB_SELECT}
         where j.driver_id = $1 and (
           (j.scheduled_date = (now() at time zone $2)::date and j.status <> 'cancelled')
           or (j.scheduled_date < (now() at time zone $2)::date and j.status in ('scheduled', 'en_route', 'arrived')))
         order by j.status = 'completed', j.scheduled_date, j.sort_order, j.number`,
        [driverId, config.timezone],
      ),
      app.pool.query('select id, name, plate, capacity_l, last_meter_reading from trucks where active order by name'),
      app.pool.query('select id, name, lat, lng, geofence_m from source_tanks order by name'),
    ]);
    return { shift, jobs: jobs.rows, trucks: trucks.rows, tanks: tanks.rows, server_time: new Date().toISOString() };
  });

  app.get('/history', { preHandler: driverOnly }, async (req) => {
    const { rows } = await app.pool.query(
      `${JOB_SELECT} where j.driver_id = $1 and j.status = 'completed' order by j.completed_at desc limit 50`,
      [req.user.id],
    );
    return rows;
  });

  app.post('/sync', { preHandler: driverOnly }, async (req) => {
    const body = parse(z.object({ ops: z.array(z.unknown()).max(200) }), req.body);
    const results: OpResult[] = [];
    for (const raw of body.ops) {
      const parsed = op.safeParse(raw);
      const cid = (raw as { client_id?: string })?.client_id ?? 'unknown';
      if (!parsed.success) {
        results.push({ client_id: cid, ok: false, permanent: true, error: parsed.error.issues[0]?.message ?? 'Invalid' });
        continue;
      }
      try {
        await applyOp(parsed.data, req.user);
        results.push({ client_id: parsed.data.client_id, ok: true });
      } catch (err) {
        const status = (err as HttpError).statusCode ?? 500;
        if (status >= 500) req.log.error(err);
        results.push({
          client_id: parsed.data.client_id,
          ok: false,
          permanent: status >= 400 && status < 500,
          error: status >= 500 ? 'Server error, will retry' : (err as Error).message,
        });
      }
    }
    return { results };
  });

  async function applyOp(o: Op, user: AuthUser) {
    const userId = user.id;
    switch (o.type) {
      case 'shift_start': {
        await tx(app.pool, async (c) => {
          const dup = await c.query('select id from shifts where client_id = $1', [o.client_id]);
          if (dup.rows[0]) return;
          // A new shift closes any shift the phone forgot to end.
          await c.query('update shifts set ended_at = $2 where driver_id = $1 and ended_at is null and started_at < $2', [userId, o.at]);
          const { rows } = await c.query(
            'insert into shifts (client_id, driver_id, truck_id, started_at, start_meter) values ($1,$2,$3,$4,$5) returning id',
            [o.client_id, userId, o.truck_id, o.at, o.start_meter ?? null],
          );
          // Today's unstarted jobs ride on the truck the driver picked.
          await c.query(
            `update jobs set truck_id = $2 where driver_id = $1 and status = 'scheduled' and truck_id is null`,
            [userId, o.truck_id],
          );
          await audit(c, 'shift', rows[0].id, 'started', userId, { truck_id: o.truck_id, start_meter: o.start_meter ?? null });
        });
        app.bus.publish({ type: 'shift', driverId: userId, onDuty: true });
        return;
      }
      case 'shift_end': {
        await tx(app.pool, async (c) => {
          const { rows } = await c.query(
            `update shifts set ended_at = $2, end_meter = $3 where id = (
               select id from shifts where driver_id = $1 and ended_at is null order by started_at desc limit 1)
             returning id, truck_id`,
            [userId, o.at, o.end_meter ?? null],
          );
          if (!rows[0]) return;
          if (o.end_meter != null) {
            await c.query('update trucks set last_meter_reading = greatest(coalesce(last_meter_reading,0), $2) where id = $1', [rows[0].truck_id, o.end_meter]);
          }
          await audit(c, 'shift', rows[0].id, 'ended', userId, { end_meter: o.end_meter ?? null });
        });
        app.bus.publish({ type: 'shift', driverId: userId, onDuty: false });
        return;
      }
      case 'job_start': {
        await tx(app.pool, async (c) => {
          await assertOwnJob(c, o.job_id, user);
          const shift = await openShift(c, userId);
          if (shift) await c.query('update jobs set truck_id = coalesce(truck_id, $2) where id = $1', [o.job_id, shift.truck_id]);
          await startJob(c, o.job_id, new Date(o.at), userId);
        });
        app.bus.publish({ type: 'job', jobId: o.job_id, status: 'en_route' });
        return;
      }
      case 'job_arrive': {
        await tx(app.pool, async (c) => {
          await assertOwnJob(c, o.job_id, user);
          await arriveJob(c, o.job_id, new Date(o.at), o.source, userId);
        });
        app.bus.publish({ type: 'job', jobId: o.job_id, status: 'arrived' });
        return;
      }
      case 'job_complete': {
        await tx(app.pool, async (c) => {
          await assertOwnJob(c, o.job_id, user);
          const shift = await openShift(c, userId);
          const photoId = o.meter_photo ? await saveFile(c, `${o.client_id}:meter`, 'meter_photo', o.meter_photo, userId) : null;
          const sigId = o.signature ? await saveFile(c, `${o.client_id}:signature`, 'signature', o.signature, userId) : null;
          await completeJob(
            c,
            o.job_id,
            {
              client_id: o.client_id,
              litres: o.litres,
              meter_start: o.meter_start,
              meter_end: o.meter_end,
              meter_photo_id: photoId,
              signature_id: sigId,
              recipient_name: o.recipient_name,
              notes: o.notes,
              lat: o.lat,
              lng: o.lng,
              recorded_at: new Date(o.at),
              shift_id: shift?.id ?? null,
              truck_id: shift?.truck_id ?? null,
            },
            userId,
          );
        });
        app.bus.publish({ type: 'job', jobId: o.job_id, status: 'completed' });
        return;
      }
      case 'fill': {
        if (new Date(o.ended_at) < new Date(o.started_at)) throw new HttpError(400, 'Fill ends before it starts');
        await tx(app.pool, async (c) => {
          const shift = await openShift(c, userId);
          if (!shift) throw new HttpError(400, 'Go on duty before logging a fill');
          const tankId = o.tank_id ?? (await c.query('select id from source_tanks order by created_at limit 1')).rows[0]?.id ?? null;
          const { rows } = await c.query(
            `insert into fills (client_id, shift_id, truck_id, driver_id, tank_id, started_at, ended_at, litres_reported)
             values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (client_id) do nothing returning id`,
            [o.client_id, shift.id, shift.truck_id, userId, tankId, o.started_at, o.ended_at, o.litres_reported ?? null],
          );
          if (rows[0]) await audit(c, 'fill', rows[0].id, 'logged', userId, { litres_reported: o.litres_reported ?? null });
        });
        return;
      }
      case 'gps': {
        await ingestGps(o.points, userId);
        return;
      }
    }
  }

  async function ingestGps(points: Extract<Op, { type: 'gps' }>['points'], driverId: string) {
    if (points.length === 0) return;
    const sorted = [...points].sort((a, b) => a.ts.localeCompare(b.ts));
    await tx(app.pool, async (c) => {
      // Tag each point with the shift and the job under way at that moment.
      await c.query(
        `insert into gps_points (driver_id, ts, lat, lng, accuracy_m, speed_mps, heading, shift_id, truck_id, job_id)
         select $1, p.ts, p.lat, p.lng, p.accuracy_m, p.speed_mps, p.heading, s.id, s.truck_id, j.id
         from jsonb_to_recordset($2::jsonb) as p(ts timestamptz, lat float8, lng float8, accuracy_m real, speed_mps real, heading real)
         left join lateral (
           select id, truck_id from shifts where driver_id = $1 and started_at <= p.ts and (ended_at is null or ended_at >= p.ts)
           order by started_at desc limit 1) s on true
         left join lateral (
           select id from jobs where driver_id = $1 and started_at <= p.ts and (completed_at is null or completed_at >= p.ts)
             and status <> 'cancelled'
           order by started_at desc limit 1) j on true
         on conflict (driver_id, ts) do nothing`,
        [driverId, JSON.stringify(sorted)],
      );

      // Server-side arrival check, a backstop for when the phone's geofence doesn't fire.
      const { rows: open } = await c.query(
        `select j.id, j.started_at, s.lat, s.lng, s.geofence_m from jobs j join sites s on s.id = j.site_id
         where j.driver_id = $1 and j.status = 'en_route' and s.lat is not null and s.lng is not null`,
        [driverId],
      );
      for (const job of open) {
        const hit = sorted.find(
          (p) =>
            new Date(p.ts) >= new Date(job.started_at) &&
            insideGeofence(p, { lat: job.lat, lng: job.lng, radius_m: job.geofence_m }),
        );
        if (hit && (await arriveJob(c, job.id, new Date(hit.ts), 'gps', null))) {
          app.bus.publish({ type: 'job', jobId: job.id, status: 'arrived' });
        }
      }
    });
    const last = sorted[sorted.length - 1];
    const shift = await openShift(app.pool, driverId);
    app.bus.publish({ type: 'position', driverId, truckId: shift?.truck_id ?? null, lat: last.lat, lng: last.lng, ts: last.ts });
  }
};

export default routes;

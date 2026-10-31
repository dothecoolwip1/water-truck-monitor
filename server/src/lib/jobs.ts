import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { HttpError, notFound } from '../http.js';
import { audit } from './audit.js';

export const JOB_SELECT = `
  select j.id, j.number, j.status, j.scheduled_date, j.requested_litres, j.priority, j.sort_order, j.notes, j.tags,
         j.customer_id, c.name as customer_name, c.phone as customer_phone,
         j.site_id, s.label as site_label, s.address as site_address, s.lat as site_lat, s.lng as site_lng,
         s.geofence_m as site_geofence_m, s.access_notes as site_access_notes,
         j.driver_id, d.name as driver_name, j.truck_id, t.name as truck_name,
         j.created_at, j.updated_at, j.started_at, j.arrived_at, j.arrival_source, j.completed_at, j.cancelled_at,
         dl.litres as delivered_litres, dl.meter_start, dl.meter_end, dl.recipient_name, dl.notes as delivery_notes,
         dl.meter_photo_id, dl.signature_id, dl.recorded_at as delivered_at
  from jobs j
  join customers c on c.id = j.customer_id
  join sites s on s.id = j.site_id
  left join users d on d.id = j.driver_id
  left join trucks t on t.id = j.truck_id
  left join deliveries dl on dl.job_id = j.id`;

export async function getJob(db: pg.Pool | pg.PoolClient, id: string) {
  const { rows } = await db.query(`${JOB_SELECT} where j.id = $1`, [id]);
  if (!rows[0]) throw notFound('Job not found');
  return rows[0];
}

const OPEN = ['requested', 'scheduled', 'en_route', 'arrived'];

async function lockJob(c: pg.PoolClient, id: string) {
  const { rows } = await c.query('select * from jobs where id = $1 for update', [id]);
  if (!rows[0]) throw notFound('Job not found');
  return rows[0];
}

export async function startJob(c: pg.PoolClient, jobId: string, at: Date, actorId: string) {
  const job = await lockJob(c, jobId);
  // Replays from an offline queue are fine: starting twice is a no-op.
  if (job.status === 'en_route' || job.status === 'arrived' || job.status === 'completed') return false;
  if (job.status === 'cancelled') throw new HttpError(409, `Job #${job.number} was cancelled`);
  await c.query(
    `update jobs set status = 'en_route', started_at = $2, updated_at = now(),
       driver_id = coalesce(driver_id, $3) where id = $1`,
    [jobId, at, actorId],
  );
  await audit(c, 'job', jobId, 'started', actorId, { at: at.toISOString() });
  return true;
}

export async function arriveJob(c: pg.PoolClient, jobId: string, at: Date, source: 'geofence' | 'gps' | 'manual', actorId: string | null) {
  const job = await lockJob(c, jobId);
  if (job.arrived_at || !['scheduled', 'en_route'].includes(job.status)) return false;
  await c.query(
    `update jobs set status = 'arrived', arrived_at = $2, arrival_source = $3, updated_at = now(),
       started_at = coalesce(started_at, $2) where id = $1`,
    [jobId, at, source],
  );
  await audit(c, 'job', jobId, 'arrived', actorId, { at: at.toISOString(), source });
  return true;
}

export interface DeliveryInput {
  client_id?: string | null;
  litres: number;
  meter_start?: number | null;
  meter_end?: number | null;
  meter_photo_id?: string | null;
  signature_id?: string | null;
  recipient_name?: string | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  recorded_at: Date;
  shift_id?: string | null;
  truck_id?: string | null;
}

export async function completeJob(c: pg.PoolClient, jobId: string, d: DeliveryInput, actorId: string) {
  const job = await lockJob(c, jobId);
  if (job.status === 'completed') {
    const existing = await c.query('select client_id from deliveries where job_id = $1', [jobId]);
    // Same delivery replayed from the phone's queue: accept quietly.
    if (d.client_id && existing.rows[0]?.client_id === d.client_id) return false;
    throw new HttpError(409, `Job #${job.number} is already completed`);
  }
  if (!OPEN.includes(job.status)) throw new HttpError(409, `Job #${job.number} was cancelled`);
  if (d.meter_start != null && d.meter_end != null && d.meter_end < d.meter_start) {
    throw new HttpError(400, 'Meter end reading is lower than the start reading');
  }
  const truckId = d.truck_id ?? job.truck_id;
  await c.query(
    `insert into deliveries (client_id, job_id, shift_id, truck_id, driver_id, litres, meter_start, meter_end,
       meter_photo_id, signature_id, recipient_name, notes, lat, lng, recorded_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [d.client_id ?? null, jobId, d.shift_id ?? null, truckId, job.driver_id ?? actorId, d.litres, d.meter_start ?? null,
      d.meter_end ?? null, d.meter_photo_id ?? null, d.signature_id ?? null, d.recipient_name ?? null, d.notes ?? null,
      d.lat ?? null, d.lng ?? null, d.recorded_at],
  );
  await c.query(
    `update jobs set status = 'completed', completed_at = $2, updated_at = now(),
       started_at = coalesce(started_at, $2), truck_id = coalesce(truck_id, $3), driver_id = coalesce(driver_id, $4)
     where id = $1`,
    [jobId, d.recorded_at, truckId, actorId],
  );
  if (truckId && d.meter_end != null) {
    await c.query('update trucks set last_meter_reading = greatest(coalesce(last_meter_reading, 0), $2) where id = $1', [truckId, d.meter_end]);
  }
  await audit(c, 'job', jobId, 'completed', actorId, {
    litres: d.litres, meter_start: d.meter_start ?? null, meter_end: d.meter_end ?? null, at: d.recorded_at.toISOString(),
  });
  return true;
}

/** Tells a driver about a job that was just assigned to them. */
export async function notifyAssignment(app: FastifyInstance, jobId: string) {
  const { rows } = await app.pool.query(
    `select j.number, j.requested_litres, j.scheduled_date, s.label, u.push_token
     from jobs j join sites s on s.id = j.site_id join users u on u.id = j.driver_id
     where j.id = $1 and u.push_token is not null`,
    [jobId],
  );
  const r = rows[0];
  if (!r) return;
  const litres = r.requested_litres ? `, ${Number(r.requested_litres).toLocaleString('en-CA')} L` : '';
  await app.push([
    { to: r.push_token, title: `New job #${r.number}`, body: `${r.label}${litres}`, data: { jobId, kind: 'job_assigned' } },
  ]);
}

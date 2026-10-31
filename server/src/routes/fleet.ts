import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx, updateRow } from '../db.js';
import { audit } from '../lib/audit.js';
import { fleetStatus } from '../lib/fleet.js';
import { forecastSites } from '../lib/forecast.js';
import { optimizeStops, routeLength } from '../lib/routing.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, isoDate, office, optionalText, parse, uuid, parsePatch } from '../http.js';

const taskFields = z.object({
  truck_id: uuid,
  name: z.string().trim().min(1).max(120),
  every_km: z.number().int().positive().max(1_000_000).nullish(),
  every_hours: z.number().int().positive().max(100_000).nullish(),
  every_days: z.number().int().positive().max(3650).nullish(),
  last_done_at: isoDate.nullish(),
  last_done_km: z.number().min(0).nullish(),
  last_done_hours: z.number().min(0).nullish(),
  notes: optionalText,
  active: z.boolean().optional(),
});

const routes: FastifyPluginAsync = async (app) => {
  // Which houses are about to run dry, from their own delivery history.
  app.get('/forecast', { preHandler: office }, async () => {
    const s = await getSettings(app.pool);
    return { warn_days: s.forecast.warn_days, sites: await forecastSites(app.pool, s.forecast.warn_days) };
  });

  // Every truck with its last inspection and what maintenance is coming up.
  // Suggested stop order for one driver's day. The office reviews it, then saves it with /jobs/reorder.
  app.post('/dispatch/optimize', { preHandler: office }, async (req) => {
    const b = parse(z.object({ driver_id: uuid, scheduled_date: isoDate }), req.body);
    const settings = await getSettings(app.pool);
    const { rows: jobs } = await app.pool.query(
      `select j.id, j.number, j.status, j.priority, j.sort_order, s.lat, s.lng from jobs j join sites s on s.id = j.site_id
       where j.driver_id = $1 and j.scheduled_date = $2 and j.status in ('scheduled', 'en_route', 'arrived') order by j.sort_order, j.number`,
      [b.driver_id, b.scheduled_date],
    );
    let depot: { lat: number; lng: number } | null = settings.depot.lat != null && settings.depot.lng != null ? { lat: settings.depot.lat, lng: settings.depot.lng } : null;
    if (!depot) {
      const t = (await app.pool.query('select lat, lng from source_tanks where lat is not null order by name limit 1')).rows[0];
      depot = t ? { lat: t.lat, lng: t.lng } : null;
    }
    // Jobs already under way stay first, and stops with no map point keep their place at the end.
    const started = jobs.filter((j) => j.status !== 'scheduled');
    const placed = jobs.filter((j) => j.status === 'scheduled' && j.lat != null && j.lng != null);
    const unplaced = jobs.filter((j) => j.status === 'scheduled' && (j.lat == null || j.lng == null));
    const startPt = started.length && started[started.length - 1].lat != null ? started[started.length - 1] : depot;
    const best = optimizeStops(startPt, placed.map((j) => ({ id: j.id, lat: j.lat, lng: j.lng, urgent: j.priority === 2 })));
    const before = routeLength(startPt, placed);
    const after = routeLength(startPt, best);
    return {
      job_ids: [...started.map((j) => j.id), ...best.map((x) => x.id), ...unplaced.map((j) => j.id)],
      before_km: Math.round(before / 100) / 10,
      after_km: Math.round(after / 100) / 10,
      changed: best.some((x, i) => x.id !== placed[i]?.id),
      depot: depot ? { ...depot, label: settings.depot.label } : null,
    };
  });

  app.get('/fleet/status', { preHandler: office }, async () => fleetStatus(app.pool));

  app.get('/inspections', { preHandler: office }, async (req) => {
    const q = parse(z.object({ truck_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const { rows } = await app.pool.query(
      `select i.*, u.name as driver_name, t.name as truck_name from inspections i
       join trucks t on t.id = i.truck_id left join users u on u.id = i.driver_id
       where ($1::uuid is null or i.truck_id = $1) order by i.at desc limit $2`,
      [q.truck_id ?? null, q.limit],
    );
    return rows;
  });

  app.post('/maintenance/tasks', { preHandler: office }, async (req, reply) => {
    const b = parse(taskFields, req.body);
    const { rows } = await app.pool.query(
      `insert into maintenance_tasks (truck_id, name, every_km, every_hours, every_days, last_done_at, last_done_km, last_done_hours, notes, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [b.truck_id, b.name, b.every_km ?? null, b.every_hours ?? null, b.every_days ?? null, b.last_done_at ?? null, b.last_done_km ?? null, b.last_done_hours ?? null, b.notes ?? null, b.active ?? true],
    );
    reply.status(201);
    return rows[0];
  });
  app.patch('/maintenance/tasks/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const row = await updateRow(app.pool, 'maintenance_tasks', id, parsePatch(taskFields.omit({ truck_id: true }), req.body));
    if (!row) throw new HttpError(404, 'Task not found');
    return row;
  });
  app.delete('/maintenance/tasks/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await app.pool.query('delete from maintenance_tasks where id = $1', [id]);
    return { ok: true };
  });

  // Record work done; when it's for a scheduled task, that task's clock restarts.
  app.get('/maintenance/log', { preHandler: office }, async (req) => {
    const q = parse(z.object({ truck_id: uuid.optional() }), req.query);
    const { rows } = await app.pool.query(
      `select l.*, u.name as created_by_name, t.name as truck_name from maintenance_log l join trucks t on t.id = l.truck_id
       left join users u on u.id = l.created_by where ($1::uuid is null or l.truck_id = $1) order by l.done_at desc, l.created_at desc limit 100`,
      [q.truck_id ?? null],
    );
    return rows;
  });
  app.post('/maintenance/log', { preHandler: office }, async (req, reply) => {
    const b = parse(
      z.object({
        truck_id: uuid, task_id: uuid.nullish(), title: z.string().trim().min(1).max(160), done_at: isoDate.optional(),
        odometer_km: z.number().min(0).nullish(), engine_hours: z.number().min(0).nullish(), cost: z.number().min(0).max(1_000_000).nullish(),
        notes: optionalText, back_in_service: z.boolean().optional(),
      }),
      req.body,
    );
    const row = await tx(app.pool, async (c) => {
      const { rows } = await c.query(
        `insert into maintenance_log (truck_id, task_id, title, done_at, odometer_km, engine_hours, cost, notes, created_by)
         values ($1,$2,$3,coalesce($4::date, current_date),$5,$6,$7,$8,$9) returning *`,
        [b.truck_id, b.task_id ?? null, b.title, b.done_at ?? null, b.odometer_km ?? null, b.engine_hours ?? null, b.cost ?? null, b.notes ?? null, req.user.id],
      );
      if (b.task_id) {
        await c.query(
          `update maintenance_tasks set last_done_at = $2, last_done_km = coalesce($3, last_done_km), last_done_hours = coalesce($4, last_done_hours) where id = $1`,
          [b.task_id, rows[0].done_at, b.odometer_km ?? null, b.engine_hours ?? null],
        );
      }
      // Readings only ever move the truck's counters forward.
      await c.query(
        `update trucks set odometer_km = greatest(coalesce(odometer_km, 0), coalesce($2, 0)), engine_hours = greatest(coalesce(engine_hours, 0), coalesce($3, 0)),
                out_of_service = case when $4 then false else out_of_service end, out_of_service_reason = case when $4 then null else out_of_service_reason end
         where id = $1`,
        [b.truck_id, b.odometer_km ?? null, b.engine_hours ?? null, !!b.back_in_service],
      );
      await audit(c, 'truck', b.truck_id, 'maintenance_logged', req.user.id, { title: b.title, task_id: b.task_id ?? null });
      return rows[0];
    });
    reply.status(201);
    return row;
  });
};

export default routes;

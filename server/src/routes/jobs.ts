import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.js';
import { audit, diff } from '../lib/audit.js';
import { completeJob, getJob, JOB_SELECT, notifyAssignment } from '../lib/jobs.js';
import { ticketPdf } from '../lib/pdf.js';
import { ensureRecurring } from '../lib/recurring.js';
import { config } from '../config.js';
import { badRequest, HttpError, isoDate, office, optionalText, parse, uuid, parsePatch } from '../http.js';

const jobFields = z.object({
  customer_id: uuid,
  site_id: uuid,
  requested_litres: z.number().int().positive().max(100_000).nullish(),
  scheduled_date: isoDate.nullish(),
  priority: z.number().int().min(0).max(2).optional(),
  driver_id: uuid.nullish(),
  truck_id: uuid.nullish(),
  notes: optionalText,
  tags: z.array(z.string().max(50)).optional(),
});

/** A job with a date and a driver is scheduled; otherwise it waits in the request queue. */
function statusFor(j: { scheduled_date?: string | null; driver_id?: string | null }) {
  return j.scheduled_date && j.driver_id ? 'scheduled' : 'requested';
}

const routes: FastifyPluginAsync = async (app) => {
  app.get('/jobs', { preHandler: office }, async (req) => {
    const q = parse(
      z.object({
        date: isoDate.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        status: z.string().optional(),
        driver_id: uuid.optional(),
        customer_id: uuid.optional(),
        unscheduled: z.enum(['true', 'false']).optional(),
        tag: z.string().max(50).optional(),
        approval: z.enum(['pending', 'approved', 'rejected']).optional(),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(2000).default(500),
      }),
      req.query,
    );
    if (q.date || q.to) await ensureRecurring(app.pool, q.date ?? q.to, config.timezone);
    const where: string[] = [];
    const vals: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      vals.push(v);
      where.push(sql.replace('?', `$${vals.length}`));
    };
    if (q.date) add('j.scheduled_date = ?', q.date);
    if (q.from) add('j.scheduled_date >= ?', q.from);
    if (q.to) add('j.scheduled_date <= ?', q.to);
    if (q.status) add('j.status = any(?::job_status[])', q.status.split(','));
    if (q.driver_id) add('j.driver_id = ?', q.driver_id);
    if (q.customer_id) add('j.customer_id = ?', q.customer_id);
    if (q.tag) add('? = any(j.tags)', q.tag);
    if (q.approval) add('j.approval_status = ?', q.approval);
    if (q.q) add(`(c.name ilike '%' || ? || '%' or s.label ilike '%' || $${vals.length + 1} || '%' or j.number::text = $${vals.length + 1})`, q.q);
    if (q.unscheduled === 'true') where.push(`(j.scheduled_date is null or j.driver_id is null) and j.status = 'requested'`);
    vals.push(q.limit);
    const { rows } = await app.pool.query(
      `${JOB_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''}
       order by j.scheduled_date nulls first, d.name nulls first, j.sort_order, j.priority desc, j.number
       limit $${vals.length}`,
      vals,
    );
    return rows;
  });

  app.get('/jobs/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const job = await getJob(app.pool, id);
    const [trail, log] = await Promise.all([
      app.pool.query(
        `select ts, lat, lng, accuracy_m, speed_mps from gps_points
         where job_id = $1 order by ts`,
        [id],
      ),
      app.pool.query(
        `select a.action, a.at, a.changes, u.name as actor_name from audit_log a
         left join users u on u.id = a.actor_id where a.entity = 'job' and a.entity_id = $1 order by a.at`,
        [id],
      ),
    ]);
    return { ...job, trail: trail.rows, audit: log.rows };
  });

  app.post('/jobs', { preHandler: office }, async (req, reply) => {
    const body = parse(jobFields, req.body);
    const job = await tx(app.pool, async (c) => {
      const site = await c.query('select customer_id from sites where id = $1', [body.site_id]);
      if (!site.rows[0]) throw badRequest('Delivery point not found');
      if (site.rows[0].customer_id !== body.customer_id) throw badRequest('That delivery point belongs to another customer');
      const { rows } = await c.query(
        `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, priority, driver_id, truck_id, notes, tags,
           status, created_by, sort_order)
         values ($1,$2,$3,$4,coalesce($5,0),$6,$7,$8,coalesce($9::text[],'{}'),$10,$11,
           coalesce((select max(sort_order) + 1 from jobs where scheduled_date = $4 and driver_id is not distinct from $6), 0))
         returning id`,
        [body.customer_id, body.site_id, body.requested_litres ?? null, body.scheduled_date ?? null, body.priority ?? null,
          body.driver_id ?? null, body.truck_id ?? null, body.notes ?? null, body.tags ?? null, statusFor(body), req.user.id],
      );
      await audit(c, 'job', rows[0].id, 'created', req.user.id, body);
      await c.query('insert into job_followers (job_id, user_id) values ($1,$2) on conflict do nothing', [rows[0].id, req.user.id]);
      return getJob(c, rows[0].id);
    });
    app.bus.publish({ type: 'job', jobId: job.id, status: job.status });
    if (job.driver_id) await notifyAssignment(app, job.id);
    reply.status(201);
    return job;
  });

  app.patch('/jobs/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parsePatch(jobFields.extend({ sort_order: z.number().int().optional() }), req.body) as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length === 0) throw badRequest('Nothing to update');
    const { job, reassigned } = await tx(app.pool, async (c) => {
      const before = (await c.query('select * from jobs where id = $1 for update', [id])).rows[0];
      if (!before) throw new HttpError(404, 'Job not found');
      if (['completed', 'cancelled'].includes(before.status)) {
        throw new HttpError(409, `Job #${before.number} is ${before.status} and can no longer be changed`);
      }
      const merged = { ...before, ...body };
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      const vals = keys.map((k) => body[k]);
      // Only jobs that haven't started move between requested and scheduled.
      if (['requested', 'scheduled'].includes(before.status)) {
        vals.push(statusFor(merged));
        sets.push(`status = $${vals.length + 1}`);
      }
      await c.query(`update jobs set ${sets.join(', ')}, updated_at = now() where id = $1`, [id, ...vals]);
      const after = (await c.query('select * from jobs where id = $1', [id])).rows[0];
      const changes = diff(before, after);
      delete changes.updated_at;
      await audit(c, 'job', id, 'updated', req.user.id, changes);
      return { job: await getJob(c, id), reassigned: !!after.driver_id && after.driver_id !== before.driver_id };
    });
    app.bus.publish({ type: 'job', jobId: id, status: job.status });
    if (reassigned) await notifyAssignment(app, id);
    return job;
  });

  app.post('/jobs/:id/cancel', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(z.object({ reason: optionalText }).default({}), req.body ?? {});
    const job = await tx(app.pool, async (c) => {
      const { rows } = await c.query(
        `update jobs set status = 'cancelled', cancelled_at = now(), updated_at = now()
         where id = $1 and status not in ('completed', 'cancelled') returning id`,
        [id],
      );
      if (!rows[0]) throw new HttpError(409, 'Job is already completed or cancelled');
      await audit(c, 'job', id, 'cancelled', req.user.id, { reason: body.reason ?? null });
      return getJob(c, id);
    });
    app.bus.publish({ type: 'job', jobId: id, status: 'cancelled' });
    return job;
  });

  app.post('/jobs/:id/clone', { preHandler: office }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(z.object({ scheduled_date: isoDate.nullish(), keep_assignment: z.boolean().default(true) }), req.body ?? {});
    const job = await tx(app.pool, async (c) => {
      const src = (await c.query('select * from jobs where id = $1', [id])).rows[0];
      if (!src) throw new HttpError(404, 'Job not found');
      const date = body.scheduled_date === undefined ? src.scheduled_date : body.scheduled_date;
      const driver = body.keep_assignment ? src.driver_id : null;
      const truck = body.keep_assignment ? src.truck_id : null;
      const { rows } = await c.query(
        `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, priority, driver_id, truck_id, notes, tags, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [src.customer_id, src.site_id, src.requested_litres, date, src.priority, driver, truck, src.notes, src.tags,
          statusFor({ scheduled_date: date, driver_id: driver }), req.user.id],
      );
      await audit(c, 'job', rows[0].id, 'created', req.user.id, { cloned_from: src.number });
      return getJob(c, rows[0].id);
    });
    app.bus.publish({ type: 'job', jobId: job.id, status: job.status });
    if (job.driver_id) await notifyAssignment(app, job.id);
    reply.status(201);
    return job;
  });

  // Dispatch board drag-and-drop: set a driver's run order (and optionally move jobs onto them).
  app.post('/jobs/reorder', { preHandler: office }, async (req) => {
    const body = parse(
      z.object({ scheduled_date: isoDate, driver_id: uuid.nullable(), truck_id: uuid.nullish(), job_ids: z.array(uuid).max(500) }),
      req.body,
    );
    const moved = await tx(app.pool, async (c) => {
      const movedIds: string[] = [];
      for (const [i, jobId] of body.job_ids.entries()) {
        const before = (await c.query('select * from jobs where id = $1 for update', [jobId])).rows[0];
        if (!before) throw new HttpError(404, 'Job not found');
        if (['completed', 'cancelled'].includes(before.status)) continue;
        const changed = before.driver_id !== body.driver_id || before.scheduled_date !== body.scheduled_date;
        // Started jobs keep their driver; only their position changes.
        const lockedToDriver = ['en_route', 'arrived'].includes(before.status);
        if (changed && lockedToDriver) throw new HttpError(409, `Job #${before.number} is under way and can't be moved to another driver`);
        const truck = body.truck_id !== undefined ? body.truck_id : before.truck_id;
        const status = lockedToDriver ? before.status : statusFor({ scheduled_date: body.scheduled_date, driver_id: body.driver_id });
        await c.query(
          `update jobs set sort_order = $2, driver_id = $3, scheduled_date = $4, truck_id = $5, status = $6, updated_at = now() where id = $1`,
          [jobId, i, body.driver_id, body.scheduled_date, truck, status],
        );
        if (changed) {
          await audit(c, 'job', jobId, 'assigned', req.user.id, {
            driver_id: [before.driver_id, body.driver_id],
            scheduled_date: [before.scheduled_date, body.scheduled_date],
          });
          if (body.driver_id) movedIds.push(jobId);
        }
      }
      return movedIds;
    });
    for (const jobId of body.job_ids) app.bus.publish({ type: 'job', jobId, status: 'reordered' });
    for (const jobId of moved) await notifyAssignment(app, jobId);
    return { ok: true };
  });

  // Office entry of a delivery, for when a driver hands in a paper ticket.
  app.post('/jobs/:id/complete', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(
      z.object({
        litres: z.number().min(0).max(100_000),
        meter_start: z.number().min(0).nullish(),
        meter_end: z.number().min(0).nullish(),
        recipient_name: optionalText,
        notes: optionalText,
        delivered_at: z.string().datetime({ offset: true }).optional(),
      }),
      req.body,
    );
    const job = await tx(app.pool, async (c) => {
      await completeJob(c, id, { ...body, recorded_at: body.delivered_at ? new Date(body.delivered_at) : new Date() }, req.user.id, { office: true });
      await audit(c, 'job', id, 'entered_by_office', req.user.id);
      return getJob(c, id);
    });
    app.bus.publish({ type: 'job', jobId: id, status: 'completed' });
    return job;
  });

  app.get('/jobs/:id/ticket.pdf', { preHandler: office }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const job = await getJob(app.pool, id);
    if (job.status !== 'completed') throw new HttpError(409, 'A ticket is available once the job is completed');
    const files = await app.pool.query('select id, mime, data from files where id = any($1::uuid[])', [
      [job.meter_photo_id, job.signature_id].filter(Boolean),
    ]);
    const byId = new Map(files.rows.map((f) => [f.id, f]));
    const pdf = await ticketPdf(job, {
      meterPhoto: byId.get(job.meter_photo_id)?.data,
      signature: byId.get(job.signature_id)?.data,
    });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="ticket-${job.number}.pdf"`);
    return reply.send(pdf);
  });
};

export default routes;

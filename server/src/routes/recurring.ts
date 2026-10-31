import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { localToday } from '../lib/dates.js';
import { scheduleDates } from '../lib/recurring.js';
import { addDays } from '../lib/dates.js';
import { config } from '../config.js';
import { badRequest, HttpError, isoDate, office, optionalText, parse, uuid } from '../http.js';

const fields = z.object({
  customer_id: uuid,
  site_id: uuid,
  requested_litres: z.number().int().positive().max(100_000).nullish(),
  every_days: z.number().int().min(1).max(90).default(7),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
  start_date: isoDate,
  end_date: isoDate.nullish(),
  driver_id: uuid.nullish(),
  truck_id: uuid.nullish(),
  notes: optionalText,
  tags: z.array(z.string().max(50)).max(20).default([]),
  active: z.boolean().default(true),
});

const SELECT = `
  select r.*, c.name as customer_name, s.label as site_label, d.name as driver_name
  from recurring_jobs r join customers c on c.id = r.customer_id join sites s on s.id = r.site_id left join users d on d.id = r.driver_id`;

const routes: FastifyPluginAsync = async (app) => {
  app.get('/recurring', { preHandler: office }, async (req) => {
    const q = parse(z.object({ customer_id: uuid.optional() }), req.query);
    const today = localToday(config.timezone);
    const { rows } = await app.pool.query(`${SELECT} where ($1::uuid is null or r.customer_id = $1) order by r.active desc, c.name`, [q.customer_id ?? null]);
    return rows.map((r) => ({ ...r, next_dates: r.active ? scheduleDates(r, today, addDays(today, 60)).slice(0, 3) : [] }));
  });

  app.post('/recurring', { preHandler: office }, async (req, reply) => {
    const b = parse(fields, req.body);
    const row = await tx(app.pool, async (c) => {
      const site = (await c.query('select customer_id from sites where id = $1', [b.site_id])).rows[0];
      if (!site || site.customer_id !== b.customer_id) throw badRequest('That delivery point belongs to another customer');
      const { rows } = await c.query(
        `insert into recurring_jobs (customer_id, site_id, requested_litres, every_days, weekdays, start_date, end_date, driver_id, truck_id, notes, tags, active, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [b.customer_id, b.site_id, b.requested_litres ?? null, b.every_days, b.weekdays?.length ? b.weekdays : null, b.start_date, b.end_date ?? null,
          b.driver_id ?? null, b.truck_id ?? null, b.notes ?? null, b.tags, b.active, req.user.id],
      );
      await audit(c, 'recurring', rows[0].id, 'created', req.user.id, b);
      return (await c.query(`${SELECT} where r.id = $1`, [rows[0].id])).rows[0];
    });
    reply.status(201);
    return row;
  });

  app.patch('/recurring/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(fields.partial(), req.body) as Record<string, unknown>;
    if (Array.isArray(b.weekdays) && b.weekdays.length === 0) b.weekdays = null;
    const keys = Object.keys(b);
    if (!keys.length) throw badRequest('Nothing to update');
    return tx(app.pool, async (c) => {
      const r = await c.query(
        `update recurring_jobs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, generated_through = null where id = $1 returning id`,
        [id, ...keys.map((k) => b[k])],
      );
      if (!r.rows[0]) throw new HttpError(404, 'Schedule not found');
      // Future jobs not yet started follow the new pattern.
      await c.query(
        `delete from jobs where recurring_id = $1 and status in ('requested', 'scheduled') and scheduled_date > $2`,
        [id, localToday(config.timezone)],
      );
      await audit(c, 'recurring', id, 'updated', req.user.id, b);
      return (await c.query(`${SELECT} where r.id = $1`, [id])).rows[0];
    });
  });

  app.delete('/recurring/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await tx(app.pool, async (c) => {
      await c.query(`delete from jobs where recurring_id = $1 and status in ('requested', 'scheduled') and scheduled_date > $2`, [id, localToday(config.timezone)]);
      await c.query('delete from recurring_jobs where id = $1', [id]);
      await audit(c, 'recurring', id, 'deleted', req.user.id);
    });
    return { ok: true };
  });

};

export default routes;

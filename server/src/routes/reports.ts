import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toCsv } from '../lib/csv.js';
import { customerTotals, dailyReport, deliveriesForExport, fillsWithTankVolumes } from '../lib/reports.js';
import { badRequest, isoDate, office, parse, uuid } from '../http.js';

const range = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, 'from must be on or before to')
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 366, 'Range is limited to one year');

const routes: FastifyPluginAsync = async (app) => {
  app.get('/reports/daily', { preHandler: office }, async (req) => {
    const q = parse(range, req.query);
    return dailyReport(app.pool, q.from, q.to);
  });

  app.get('/reports/customers', { preHandler: office }, async (req) => {
    const q = parse(range, req.query);
    return customerTotals(app.pool, q.from, q.to);
  });

  app.get('/reports/fills', { preHandler: office }, async (req) => {
    const q = parse(range, req.query);
    return fillsWithTankVolumes(app.pool, q.from, q.to);
  });

  app.get('/exports/deliveries.csv', { preHandler: office }, async (req, reply) => {
    const q = parse(range, req.query);
    const rows = await deliveriesForExport(app.pool, q.from, q.to);
    const csv = toCsv(
      ['Ticket', 'Delivered', 'Account', 'Customer', 'Delivery point', 'Address', 'Litres', 'Meter start', 'Meter end',
        'Truck', 'Driver', 'Received by', 'Requested litres', 'Notes'],
      rows.map((r) => [r.number, r.delivered_local, r.account_code, r.customer, r.site, r.address, r.litres, r.meter_start,
        r.meter_end, r.truck, r.driver, r.recipient_name, r.requested_litres, r.notes]),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="deliveries-${q.from}-to-${q.to}.csv"`);
    return reply.send('﻿' + csv);
  });

  app.get('/tanks/:id/readings', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const q = parse(z.object({ since: z.string().datetime({ offset: true }).optional(), hours: z.coerce.number().min(1).max(24 * 31).default(48) }), req.query);
    const since = q.since ? new Date(q.since) : new Date(Date.now() - q.hours * 3_600_000);
    if (Number.isNaN(since.getTime())) throw badRequest('Bad since');
    const { rows } = await app.pool.query(
      'select ts, volume_l, level_mm, level_pct from tank_readings where tank_id = $1 and ts >= $2 order by ts limit 20000',
      [id, since],
    );
    return rows;
  });
};

export default routes;

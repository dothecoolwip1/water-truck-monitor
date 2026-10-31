import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { checkDelivery, generateInvoices, invoiceDetail, quickbooksCsv, quickbooksIif, recalcInvoice, setApproval } from '../lib/billing.js';
import { JOB_SELECT } from '../lib/jobs.js';
import { invoicePdf } from '../lib/pdf.js';
import { getSettings } from '../lib/settings.js';
import { HttpError, isoDate, office, optionalText, parse, requireRole, uuid } from '../http.js';

const adminOnly = requireRole('admin');
const money = z.number().min(0).max(1_000_000);

const itemFields = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20).default('each'),
  unit_price: money,
  kind: z.enum(['water', 'delivery', 'other']).default('other'),
  auto_add: z.boolean().default(false),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
});

const lineFields = z.object({
  price_item_id: uuid.nullish(),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().min(-100_000).max(1_000_000),
  unit: z.string().max(20).nullish(),
  unit_price: money,
  taxable: z.boolean().default(true),
});

const routes: FastifyPluginAsync = async (app) => {
  // ----- Price book -----
  app.get('/price-items', { preHandler: office }, async () => {
    const { rows } = await app.pool.query(
      `select p.*, coalesce((select jsonb_object_agg(cr.customer_class, cr.unit_price) from class_rates cr where cr.price_item_id = p.id), '{}') as class_rates
       from price_items p order by active desc, kind, name`,
    );
    return rows;
  });
  // Rates by customer class (e.g. public housing pays one rate, businesses another).
  app.put('/price-items/:id/class-rates', { preHandler: adminOnly }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ rates: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), money.nullable()) }), req.body);
    await tx(app.pool, async (c) => {
      for (const [cls, price] of Object.entries(b.rates)) {
        if (price === null) await c.query('delete from class_rates where customer_class = $1 and price_item_id = $2', [cls, id]);
        else {
          await c.query(
            `insert into class_rates (customer_class, price_item_id, unit_price) values ($1,$2,$3)
             on conflict (customer_class, price_item_id) do update set unit_price = excluded.unit_price`,
            [cls, id, price],
          );
        }
      }
      await audit(c, 'price_item', id, 'class_rates_changed', req.user.id, b.rates);
    });
    return { ok: true };
  });
  app.post('/price-items', { preHandler: adminOnly }, async (req, reply) => {
    const b = parse(itemFields, req.body);
    const { rows } = await app.pool.query(
      `insert into price_items (code, name, unit, unit_price, kind, auto_add, taxable, active) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [b.code, b.name, b.unit, b.unit_price, b.kind, b.auto_add, b.taxable, b.active],
    );
    reply.status(201);
    return rows[0];
  });
  app.patch('/price-items/:id', { preHandler: adminOnly }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(itemFields.partial(), req.body) as Record<string, unknown>;
    const keys = Object.keys(b);
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    const { rows } = await app.pool.query(
      `update price_items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
      [id, ...keys.map((k) => b[k])],
    );
    if (!rows[0]) throw new HttpError(404, 'Item not found');
    return rows[0];
  });

  // Customer-specific rates (rate agreements).
  app.get('/customers/:id/rates', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const { rows } = await app.pool.query(
      `select p.id as price_item_id, p.code, p.name, p.unit, p.unit_price as list_price, r.unit_price
       from price_items p left join customer_rates r on r.price_item_id = p.id and r.customer_id = $1
       where p.active order by p.kind, p.name`,
      [id],
    );
    return rows;
  });
  app.put('/customers/:id/rates', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ rates: z.array(z.object({ price_item_id: uuid, unit_price: money.nullable() })).max(200) }), req.body);
    await tx(app.pool, async (c) => {
      for (const r of b.rates) {
        if (r.unit_price === null) await c.query('delete from customer_rates where customer_id = $1 and price_item_id = $2', [id, r.price_item_id]);
        else {
          await c.query(
            `insert into customer_rates (customer_id, price_item_id, unit_price) values ($1,$2,$3)
             on conflict (customer_id, price_item_id) do update set unit_price = excluded.unit_price`,
            [id, r.price_item_id, r.unit_price],
          );
        }
      }
      await audit(c, 'customer', id, 'rates_changed', req.user.id, { rates: b.rates });
    });
    return { ok: true };
  });

  // ----- Line items on a job -----
  app.get('/jobs/:id/lines', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const settings = await getSettings(app.pool);
    const [lines, check] = await Promise.all([
      app.pool.query(`select *, round(quantity * unit_price, 2)::float8 as amount from job_lines where job_id = $1 order by sort`, [id]),
      checkDelivery(app.pool, id, settings),
    ]);
    return { lines: lines.rows, check, tax: settings.tax };
  });
  app.put('/jobs/:id/lines', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ lines: z.array(lineFields).max(50) }), req.body);
    await tx(app.pool, async (c) => {
      const j = (await c.query('select invoice_id, number from jobs where id = $1 for update', [id])).rows[0];
      if (!j) throw new HttpError(404, 'Job not found');
      if (j.invoice_id) {
        const inv = (await c.query('select status from invoices where id = $1', [j.invoice_id])).rows[0];
        if (inv?.status !== 'draft') throw new HttpError(409, `Job #${j.number} is on a ${inv?.status} invoice; void it to make changes`);
      }
      await c.query('delete from job_lines where job_id = $1', [id]);
      for (const [i, l] of b.lines.entries()) {
        await c.query(
          `insert into job_lines (job_id, price_item_id, description, quantity, unit, unit_price, taxable, sort) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, l.price_item_id ?? null, l.description, l.quantity, l.unit ?? null, l.unit_price, l.taxable, i],
        );
      }
      if (j.invoice_id) await recalcInvoice(c, j.invoice_id);
      await audit(c, 'job', id, 'lines_changed', req.user.id, { lines: b.lines.length });
    });
    return { ok: true };
  });

  // ----- Approvals -----
  app.get('/approvals', { preHandler: office }, async (req) => {
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending'), limit: z.coerce.number().int().max(1000).default(300) }), req.query);
    const { rows } = await app.pool.query(
      `${JOB_SELECT} where j.status = 'completed' and j.approval_status = $1 order by j.completed_at desc limit $2`,
      [q.status, q.limit],
    );
    return rows;
  });
  const decide = (status: 'approved' | 'rejected') => async (req: { params: unknown; body: unknown; user: { id: string } }) => {
    const b = parse(z.object({ job_ids: z.array(uuid).min(1).max(500), note: optionalText }), req.body);
    await tx(app.pool, async (c) => {
      for (const id of b.job_ids) {
        await setApproval(c, id, status, req.user.id, b.note);
        await audit(c, 'job', id, status, req.user.id, b.note ? { note: b.note } : undefined);
      }
    });
    for (const id of b.job_ids) app.bus.publish({ type: 'job', jobId: id, status: 'completed' });
    return { ok: true, count: b.job_ids.length };
  };
  app.post('/approvals/approve', { preHandler: office }, decide('approved'));
  app.post('/approvals/reject', { preHandler: office }, decide('rejected'));

  // ----- Invoices (pre-invoice batches) -----
  app.get('/billing/summary', { preHandler: office }, async () => {
    const settings = await getSettings(app.pool);
    const { rows } = await app.pool.query(
      `select
         (select count(*)::int from jobs where status = 'completed' and approval_status = 'pending') as pending_approvals,
         (select count(*)::int from jobs where status = 'completed' and approval_status = 'approved' and invoice_id is null) as unbilled_jobs,
         (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0)::float8 from job_lines l join jobs j on j.id = l.job_id
            where j.status = 'completed' and j.approval_status = 'approved' and j.invoice_id is null) as unbilled_subtotal,
         (select coalesce(sum(total), 0)::float8 from invoices where status = 'draft') as draft_total,
         (select count(*)::int from invoices where status = 'draft') as draft_count,
         (select coalesce(sum(total), 0)::float8 from invoices where status = 'sent') as outstanding_total,
         (select count(*)::int from invoices where status = 'sent' and due_date < current_date) as overdue_count,
         (select coalesce(sum(total), 0)::float8 from invoices where status = 'paid' and paid_at >= date_trunc('month', now())) as paid_this_month`,
    );
    return { ...rows[0], tax: settings.tax };
  });

  app.get('/invoices', { preHandler: office }, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), customer_id: uuid.optional() }), req.query);
    const { rows } = await app.pool.query(
      `select i.*, c.name as customer_name, c.account_code, (select count(*)::int from jobs j where j.invoice_id = i.id) as job_count
       from invoices i join customers c on c.id = i.customer_id
       where ($1::text[] is null or i.status = any($1)) and ($2::uuid is null or i.customer_id = $2)
       order by i.created_at desc, i.number desc limit 500`,
      [q.status ? q.status.split(',') : null, q.customer_id ?? null],
    );
    return rows;
  });

  app.get('/invoices/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    return invoiceDetail(app.pool, id);
  });

  app.post('/invoices/generate', { preHandler: office }, async (req) => {
    const b = parse(z.object({ from: isoDate, to: isoDate, customer_id: uuid.nullish() }), req.body);
    if (b.to < b.from) throw new HttpError(400, 'The end date is before the start date');
    const ids = await tx(app.pool, async (c) => {
      const created = await generateInvoices(c, { from: b.from, to: b.to, customerId: b.customer_id, userId: req.user.id });
      for (const id of created) await audit(c, 'invoice', id, 'created', req.user.id, { from: b.from, to: b.to });
      return created;
    });
    return { created: ids.length, ids };
  });

  app.patch('/invoices/:id', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ status: z.enum(['draft', 'sent', 'paid', 'void']).optional(), notes: optionalText }), req.body);
    return tx(app.pool, async (c) => {
      const before = (await c.query('select * from invoices where id = $1 for update', [id])).rows[0];
      if (!before) throw new HttpError(404, 'Invoice not found');
      if (before.status === 'void') throw new HttpError(409, 'This invoice was voided');
      if (b.status === 'void') {
        // Voiding frees the deliveries so they can be billed again.
        await c.query('update jobs set invoice_id = null where invoice_id = $1', [id]);
      }
      await c.query(
        `update invoices set status = coalesce($2, status), notes = case when $3::boolean then $4 else notes end,
           sent_at = case when $2 = 'sent' and sent_at is null then now() else sent_at end,
           paid_at = case when $2 = 'paid' then now() when $2 is not null and $2 <> 'paid' then null else paid_at end
         where id = $1`,
        [id, b.status ?? null, b.notes !== undefined, b.notes ?? null],
      );
      await audit(c, 'invoice', id, b.status ? `marked_${b.status}` : 'updated', req.user.id, b);
      return invoiceDetail(c, id);
    });
  });

  app.get('/invoices/:id/pdf', { preHandler: office }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const [inv, settings] = await Promise.all([invoiceDetail(app.pool, id), getSettings(app.pool)]);
    const pdf = await invoicePdf(inv, settings);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="invoice-${inv.number}.pdf"`);
    return reply.send(pdf);
  });

  // Accounting exports: QuickBooks Online CSV import, QuickBooks Desktop IIF.
  app.get('/exports/quickbooks.:fmt', { preHandler: office }, async (req, reply) => {
    const fmt = parse(z.enum(['csv', 'iif']), (req.params as { fmt: string }).fmt);
    const q = parse(z.object({ ids: z.string().optional(), status: z.string().default('draft,sent') }), req.query);
    const ids = q.ids
      ? q.ids.split(',').map((s) => parse(uuid, s))
      : (await app.pool.query('select id from invoices where status = any($1) order by number', [q.status.split(',')])).rows.map((r) => r.id);
    const settings = await getSettings(app.pool);
    const invoices = [];
    for (const id of ids) invoices.push(await invoiceDetail(app.pool, id));
    const body = fmt === 'csv' ? quickbooksCsv(invoices, settings) : quickbooksIif(invoices, settings);
    reply.header('content-type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="quickbooks-invoices.${fmt}"`);
    return body;
  });
};

export default routes;

import { toCsv } from './csv.js';
import { config } from '../config.js';
import type pg from 'pg';
import type { Db } from '../db.js';
import { HttpError } from '../http.js';
import { distanceM } from './geo.js';
import { getSettings, type Settings } from './settings.js';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Price for one customer: their own agreed rate, else their class's rate, else the price book. */
export async function rateFor(c: Db, customerId: string, itemId: string, fallback: number): Promise<number> {
  const { rows } = await c.query(
    `select coalesce(
       (select unit_price from customer_rates where customer_id = $1 and price_item_id = $2),
       (select cr.unit_price from class_rates cr join customers cu on cu.customer_class = cr.customer_class where cu.id = $1 and cr.price_item_id = $2)
     ) as unit_price`,
    [customerId, itemId],
  );
  return rows[0]?.unit_price != null ? Number(rows[0].unit_price) : Number(fallback);
}

/** Line items for a just-completed job, from the price book: water by the litre, a delivery fee, and anything set to auto-add. */
export async function buildLines(c: pg.PoolClient, jobId: string): Promise<void> {
  const existing = await c.query('select 1 from job_lines where job_id = $1 limit 1', [jobId]);
  if (existing.rows[0]) return;
  const { rows: jr } = await c.query(
    `select j.customer_id, d.litres from jobs j join deliveries d on d.job_id = j.id where j.id = $1`,
    [jobId],
  );
  const job = jr[0];
  if (!job) return;
  const { rows: items } = await c.query(
    `select * from price_items where active and (kind in ('water', 'delivery') or auto_add) order by kind = 'water' desc, kind = 'delivery' desc, name`,
  );
  // One per-litre water price and one delivery fee per job (an auto-add one wins), plus every other auto-add item.
  const pick = (kind: string) => items.find((x) => x.kind === kind && x.auto_add) ?? items.find((x) => x.kind === kind);
  const chosen = new Set([pick('water')?.id, pick('delivery')?.id]);
  let sort = 0;
  for (const it of items) {
    if ((it.kind === 'water' || it.kind === 'delivery') && !chosen.has(it.id)) continue;
    const qty = it.kind === 'water' ? Number(job.litres) : 1;
    if (qty <= 0) continue;
    const price = await rateFor(c, job.customer_id, it.id, it.unit_price);
    await c.query(
      `insert into job_lines (job_id, price_item_id, description, quantity, unit, unit_price, taxable, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [jobId, it.id, it.name, qty, it.unit, price, it.taxable, sort++],
    );
  }
}

export interface ApprovalCheck {
  ok: boolean;
  reasons: string[];
  passed: string[];
}

/** Checks a delivery against the auto-approval rules: meter agrees, delivered at the house, not more than the tank holds. */
export async function checkDelivery(c: Db, jobId: string, settings: Settings): Promise<ApprovalCheck> {
  const { rows } = await c.query(
    `select d.litres, d.meter_start, d.meter_end, d.lat as d_lat, d.lng as d_lng, j.arrival_source,
            s.lat, s.lng, s.geofence_m, s.tank_capacity_l
     from jobs j join deliveries d on d.job_id = j.id join sites s on s.id = j.site_id where j.id = $1`,
    [jobId],
  );
  const r = rows[0];
  const reasons: string[] = [];
  const passed: string[] = [];
  if (!r) return { ok: false, reasons: ['No delivery recorded'], passed };
  const rules = settings.approvals;
  if (r.meter_start !== null && r.meter_end !== null) {
    const diff = Number(r.meter_end) - Number(r.meter_start);
    if (Math.abs(diff - Number(r.litres)) > rules.meter_tolerance_l) {
      reasons.push(`Meter shows ${Math.round(diff).toLocaleString('en-CA')} L but ${Math.round(Number(r.litres)).toLocaleString('en-CA')} L was entered`);
    } else passed.push('Meter readings match the litres entered');
  } else {
    reasons.push('No meter readings');
  }
  if (rules.require_at_site) {
    const atSite =
      ['geofence', 'gps'].includes(r.arrival_source) ||
      (r.d_lat !== null && r.lat !== null && distanceM(r.d_lat, r.d_lng, r.lat, r.lng) <= Math.max(r.geofence_m * 2, 100));
    if (atSite) passed.push('Recorded at the delivery point');
    else reasons.push('Not confirmed at the delivery point by GPS');
  }
  if (r.tank_capacity_l && Number(r.litres) > Number(r.tank_capacity_l) * (1 + rules.max_over_tank_pct / 100)) {
    reasons.push(`More than the ${Number(r.tank_capacity_l).toLocaleString('en-CA')} L tank holds`);
  } else if (r.tank_capacity_l) passed.push('Within the tank size');
  return { ok: reasons.length === 0, reasons, passed };
}

/** After a delivery is recorded: price it and approve it automatically when every check passes. */
export async function afterDelivery(c: pg.PoolClient, jobId: string, enteredBy?: { id: string; office: boolean }): Promise<void> {
  await buildLines(c, jobId);
  const settings = await getSettings(c);
  if (enteredBy?.office) {
    // The office keyed in a paper ticket: they've reviewed it as they typed it.
    await c.query(
      `update jobs set approval_status = 'approved', approved_by = $2, approved_at = now(), approval_note = 'Entered from a paper ticket' where id = $1`,
      [jobId, enteredBy.id],
    );
    return;
  }
  const check = await checkDelivery(c, jobId, settings);
  if (settings.approvals.auto && check.ok) {
    await c.query(
      `update jobs set approval_status = 'approved', approved_by = null, approved_at = now(), approval_note = $2 where id = $1`,
      [jobId, `Auto-approved: ${check.passed.join('; ').toLowerCase()}`],
    );
  } else {
    await c.query(`update jobs set approval_status = 'pending', approval_note = $2 where id = $1`, [
      jobId,
      check.reasons.length ? `Needs review: ${check.reasons.join('; ')}` : 'Waiting for review',
    ]);
  }
}

export async function setApproval(c: pg.PoolClient, jobId: string, status: 'approved' | 'rejected', userId: string, note?: string | null) {
  const { rows } = await c.query('select status, invoice_id, number from jobs where id = $1 for update', [jobId]);
  const j = rows[0];
  if (!j) throw new HttpError(404, 'Job not found');
  if (j.status !== 'completed') throw new HttpError(409, `Job #${j.number} isn't delivered yet`);
  if (j.invoice_id) throw new HttpError(409, `Job #${j.number} is already on an invoice`);
  await c.query(
    `update jobs set approval_status = $2, approved_by = $3, approved_at = now(), approval_note = coalesce($4, approval_note) where id = $1`,
    [jobId, status, userId, note ?? null],
  );
}

export async function jobTotals(c: Db, jobIds: string[], taxRate: number) {
  const { rows } = await c.query(
    `select coalesce(sum(round(quantity * unit_price, 2)), 0)::float8 as subtotal,
            coalesce(sum(case when taxable then round(quantity * unit_price, 2) else 0 end), 0)::float8 as taxable
     from job_lines where job_id = any($1::uuid[])`,
    [jobIds],
  );
  const subtotal = round2(rows[0].subtotal);
  const tax = round2(rows[0].taxable * taxRate);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/** One draft invoice per customer for approved, uninvoiced deliveries in the date range (a "pre-invoice" batch). */
export async function generateInvoices(c: pg.PoolClient, opts: { from: string; to: string; customerId?: string | null; userId: string }) {
  const settings = await getSettings(c);
  const { rows } = await c.query(
    `select j.customer_id, array_agg(j.id order by j.completed_at) as job_ids
     from jobs j
     where j.status = 'completed' and j.approval_status = 'approved' and j.invoice_id is null
       and (j.completed_at at time zone $4)::date between $1 and $2
       and ($3::uuid is null or j.customer_id = $3)
     group by j.customer_id`,
    [opts.from, opts.to, opts.customerId ?? null, config.timezone],
  );
  const created: string[] = [];
  for (const g of rows) {
    const t = await jobTotals(c, g.job_ids, settings.tax.rate);
    const ins = await c.query(
      `insert into invoices (customer_id, period_start, period_end, due_date, subtotal, tax, total, created_by)
       values ($1,$2,$3,current_date + $4::int,$5,$6,$7,$8) returning id`,
      [g.customer_id, opts.from, opts.to, settings.invoice.terms_days, t.subtotal, t.tax, t.total, opts.userId],
    );
    await c.query('update jobs set invoice_id = $1 where id = any($2::uuid[])', [ins.rows[0].id, g.job_ids]);
    created.push(ins.rows[0].id);
  }
  return created;
}

export async function recalcInvoice(c: Db, invoiceId: string) {
  const settings = await getSettings(c);
  const { rows } = await c.query('select array_agg(id) as ids from jobs where invoice_id = $1', [invoiceId]);
  const t = await jobTotals(c, rows[0].ids ?? [], settings.tax.rate);
  await c.query('update invoices set subtotal = $2, tax = $3, total = $4 where id = $1', [invoiceId, t.subtotal, t.tax, t.total]);
}

export async function invoiceDetail(c: Db, id: string) {
  const [inv] = await invoiceDetails(c, [id]);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return inv;
}

/** Invoices with their lines, in two queries however many there are. Kept in the order asked for. */
export async function invoiceDetails(c: Db, ids: string[]) {
  const [inv, lines] = await Promise.all([
    c.query(
      `select i.*, c.name as customer_name, c.account_code, c.email as customer_email, c.phone as customer_phone
       from invoices i join customers c on c.id = i.customer_id where i.id = any($1::uuid[])`,
      [ids],
    ),
    c.query(
      `select l.*, round(l.quantity * l.unit_price, 2)::float8 as amount, j.invoice_id, j.number as job_number, j.completed_at, s.label as site_label,
              p.code as item_code
       from job_lines l join jobs j on j.id = l.job_id join sites s on s.id = j.site_id left join price_items p on p.id = l.price_item_id
       where j.invoice_id = any($1::uuid[]) order by j.completed_at, j.number, l.sort`,
      [ids],
    ),
  ]);
  const byId = new Map(inv.rows.map((r) => [r.id as string, { ...r, lines: [] as typeof lines.rows }]));
  for (const l of lines.rows) byId.get(l.invoice_id)?.lines.push(l);
  return ids.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
}

const mdy = (d: string | Date) => {
  const x = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00`) : d;
  return `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()}`;
};

type InvoiceDetail = Awaited<ReturnType<typeof invoiceDetail>>;

/** QuickBooks Online "Import invoices" CSV: one row per line item. */
export function quickbooksCsv(invoices: InvoiceDetail[], settings: Settings): string {
  const head = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'ItemTaxCode'];
  const rows: unknown[][] = [];
  for (const inv of invoices) {
    for (const l of inv.lines) {
      rows.push([
        `${settings.invoice.prefix}${inv.number}`, inv.customer_name, mdy(inv.issue_date), inv.due_date ? mdy(inv.due_date) : '',
        `Net ${settings.invoice.terms_days}`, `Water deliveries ${inv.period_start ?? ''} to ${inv.period_end ?? ''}`,
        l.item_code ?? l.description, `Job #${l.job_number} · ${l.site_label} · ${l.description}`, l.quantity, l.unit_price, l.amount,
        l.taxable ? settings.tax.label : 'Exempt',
      ]);
    }
  }
  return toCsv(head, rows);
}

/** QuickBooks Desktop IIF transactions (INVOICE with SPL lines). */
export function quickbooksIif(invoices: InvoiceDetail[], settings: Settings): string {
  const t = (a: unknown[]) => a.map((v) => String(v ?? '').replace(/[\t\r\n]/g, ' ')).join('\t');
  const out = [
    t(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE']),
    t(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'INVITEM', 'QNTY', 'PRICE', 'TAXABLE']),
    t(['!ENDTRNS']),
  ];
  for (const inv of invoices) {
    out.push(t(['TRNS', 'INVOICE', mdy(inv.issue_date), 'Accounts Receivable', inv.customer_name, Number(inv.total).toFixed(2), `${settings.invoice.prefix}${inv.number}`, 'Water deliveries', inv.due_date ? mdy(inv.due_date) : '']));
    for (const l of inv.lines) {
      out.push(t(['SPL', 'INVOICE', mdy(inv.issue_date), 'Sales', inv.customer_name, (-Number(l.amount)).toFixed(2), `${settings.invoice.prefix}${inv.number}`,
        `Job #${l.job_number} ${l.site_label}`, l.item_code ?? l.description, -Number(l.quantity), l.unit_price, l.taxable ? 'Y' : 'N']));
    }
    if (Number(inv.tax) > 0) {
      out.push(t(['SPL', 'INVOICE', mdy(inv.issue_date), `${settings.tax.label} Payable`, '', (-Number(inv.tax)).toFixed(2), `${settings.invoice.prefix}${inv.number}`, settings.tax.label, '', '', '', 'N']));
    }
    out.push(t(['ENDTRNS']));
  }
  return out.join('\r\n') + '\r\n';
}

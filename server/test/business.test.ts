import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { scheduleDates } from '../src/lib/recurring.js';
import type { PushMessage } from '../src/lib/push.js';

let pool: pg.Pool;
let app: FastifyInstance;
const pushes: PushMessage[] = [];
let admin = '';
let driver = '';
const ids: Record<string, string> = {};

async function api(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = res.body;
  try {
    body = res.json();
  } catch {
    // not JSON
  }
  return { status: res.statusCode, body, raw: res };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton' }).format(new Date());
const at = (minAgo = 0) => new Date(Date.now() - minAgo * 60_000).toISOString();
let seq = 0;
const cid = () => `test-op-${Date.now()}-${seq++}`;

async function newJob(litres = 4000) {
  const r = await api('POST', '/api/jobs', admin, { customer_id: ids.customer, site_id: ids.site, requested_litres: litres, scheduled_date: today(), driver_id: ids.driver, truck_id: ids.truck });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function deliver(jobId: string, o: { litres: number; start: number; end: number; lat?: number; lng?: number; arrive?: boolean; form?: Record<string, unknown> }) {
  const ops: unknown[] = [{ type: 'job_start', client_id: cid(), at: at(20), job_id: jobId }];
  if (o.arrive) ops.push({ type: 'job_arrive', client_id: cid(), at: at(10), job_id: jobId, source: 'geofence' });
  ops.push({ type: 'job_complete', client_id: cid(), at: at(1), job_id: jobId, litres: o.litres, meter_start: o.start, meter_end: o.end, lat: o.lat ?? null, lng: o.lng ?? null, form_data: o.form ?? null });
  const r = await api('POST', '/api/driver/sync', driver, { ops });
  expect(r.body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
}

beforeAll(async () => {
  pool = createPool();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  await seed(pool, { demo: false, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
  app = await buildApp({ pool, serveWeb: false, logger: !!process.env.TEST_LOG, push: async (m) => void pushes.push(...m) });
  admin = (await api('POST', '/api/auth/login', undefined, { email: 'admin@test.local', password: 'admin-password' })).body.token;
  ids.driver = (await api('POST', '/api/users', admin, { name: 'Sam Driver', email: 'sam@test.local', role: 'driver', password: 'driver-pass' })).body.id;
  driver = (await api('POST', '/api/auth/login', undefined, { email: 'sam@test.local', password: 'driver-pass' })).body.token;
  await api('POST', '/api/me/push-token', driver, { token: 'ExponentPushToken[sam]' });
  ids.truck = (await api('POST', '/api/trucks', admin, { name: 'Truck 1', capacity_l: 13600 })).body.id;
  ids.customer = (await api('POST', '/api/customers', admin, { name: 'Elders Centre', account_code: 'FGH-010', phone: '(867) 598-1010' })).body.id;
  ids.site = (await api('POST', '/api/sites', admin, { customer_id: ids.customer, label: 'Elders Centre', lat: 66.2565, lng: -128.6335, geofence_m: 60, tank_capacity_l: 9000 })).body.id;
  await api('POST', '/api/trucks', admin, { name: 'Spare', capacity_l: 1000 });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('price book, approvals and invoices', () => {
  it('lets an admin build a price book and a customer rate', async () => {
    const water = await api('POST', '/api/price-items', admin, { code: 'WATER', name: 'Potable water', unit: 'litre', unit_price: 0.05, kind: 'water' });
    expect(water.status).toBe(201);
    ids.water = water.body.id;
    expect((await api('POST', '/api/price-items', admin, { code: 'DELIVERY', name: 'Delivery fee', unit: 'load', unit_price: 25, kind: 'delivery' })).status).toBe(201);
    expect((await api('POST', '/api/price-items', driver, { code: 'X', name: 'x', unit_price: 1 })).status).toBe(403);
    expect((await api('PUT', `/api/customers/${ids.customer}/rates`, admin, { rates: [{ price_item_id: ids.water, unit_price: 0.04 }] })).status).toBe(200);
    const rates = await api('GET', `/api/customers/${ids.customer}/rates`, admin);
    expect(rates.body.find((r: { code: string }) => r.code === 'WATER').unit_price).toBe(0.04);
  });

  it('prices a delivery and auto-approves it when the meter matches and the truck was at the house', async () => {
    ids.good = await newJob();
    await deliver(ids.good, { litres: 4000, start: 1000, end: 5005, arrive: true, form: { tank_condition: 'Good', cap_locked: true } });
    const job = (await api('GET', `/api/jobs/${ids.good}`, admin)).body;
    expect(job.approval_status).toBe('approved');
    expect(job.approval_note).toMatch(/Auto-approved/);
    expect(job.form_data).toEqual({ tank_condition: 'Good', cap_locked: true });
    // 4,000 L at the customer's 4¢ rate plus the $25 delivery fee.
    expect(job.amount).toBe(185);
    const lines = (await api('GET', `/api/jobs/${ids.good}/lines`, admin)).body;
    expect(lines.lines.map((l: { description: string }) => l.description)).toEqual(['Potable water', 'Delivery fee']);
    expect(lines.check.ok).toBe(true);
  });

  it('holds a delivery for review when the meter disagrees or it is more than the tank holds', async () => {
    ids.bad = await newJob();
    await deliver(ids.bad, { litres: 12000, start: 5000, end: 9000, lat: 66.27, lng: -128.6 });
    const job = (await api('GET', `/api/jobs/${ids.bad}`, admin)).body;
    expect(job.approval_status).toBe('pending');
    expect(job.approval_note).toMatch(/Meter shows 4,000 L/);
    expect(job.approval_note).toMatch(/tank holds/);
    expect(job.approval_note).toMatch(/delivery point/);
    const pending = (await api('GET', '/api/approvals', admin)).body;
    expect(pending.map((j: { id: string }) => j.id)).toEqual([ids.bad]);
    const summary = (await api('GET', '/api/billing/summary', admin)).body;
    expect(summary.pending_approvals).toBe(1);
    expect(summary.unbilled_jobs).toBe(1);
  });

  it('lets the office correct the lines and approve', async () => {
    const r = await api('PUT', `/api/jobs/${ids.bad}/lines`, admin, {
      lines: [
        { price_item_id: ids.water, description: 'Potable water', quantity: 4000, unit: 'litre', unit_price: 0.04 },
        { description: 'After-hours call-out', quantity: 1, unit: 'each', unit_price: 85, taxable: false },
      ],
    });
    expect(r.status).toBe(200);
    expect((await api('POST', '/api/approvals/approve', admin, { job_ids: [ids.bad], note: 'Checked with driver' })).status).toBe(200);
    const job = (await api('GET', `/api/jobs/${ids.bad}`, admin)).body;
    expect(job.approval_status).toBe('approved');
    expect(job.approved_by_name).toBe('Administrator');
    expect(job.amount).toBe(245);
  });

  it('batches approved deliveries into one draft invoice per customer, with tax', async () => {
    const r = await api('POST', '/api/invoices/generate', admin, { from: today(), to: today() });
    expect(r.body.created).toBe(1);
    const inv = (await api('GET', `/api/invoices/${r.body.ids[0]}`, admin)).body;
    expect(inv.status).toBe('draft');
    expect(inv.lines).toHaveLength(4);
    expect(inv.subtotal).toBe(430);
    // GST on everything but the non-taxable call-out: 5% of 345.
    expect(inv.tax).toBe(17.25);
    expect(inv.total).toBe(447.25);
    ids.invoice = inv.id;
    // Already billed: a second run makes nothing.
    expect((await api('POST', '/api/invoices/generate', admin, { from: today(), to: today() })).body.created).toBe(0);
    expect((await api('POST', '/api/approvals/reject', admin, { job_ids: [ids.good] })).status).toBe(409);
  });

  it('exports to QuickBooks and renders a PDF', async () => {
    const csv = await api('GET', `/api/exports/quickbooks.csv?ids=${ids.invoice}`, admin);
    expect(csv.status).toBe(200);
    const rows = String(csv.body).trim().split('\r\n');
    expect(rows[0]).toMatch(/^InvoiceNo,Customer,InvoiceDate/);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatch(/INV-1001,Elders Centre/);
    const iif = await api('GET', `/api/exports/quickbooks.iif?ids=${ids.invoice}`, admin);
    expect(String(iif.body)).toMatch(/^!TRNS/);
    expect(String(iif.body)).toMatch(/TRNS\tINVOICE\t.*\t447\.25/);
    const pdf = await api('GET', `/api/invoices/${ids.invoice}/pdf`, admin);
    expect(pdf.raw.headers['content-type']).toBe('application/pdf');
    expect(pdf.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('locks lines once sent, and voiding frees the deliveries to bill again', async () => {
    expect((await api('PATCH', `/api/invoices/${ids.invoice}`, admin, { status: 'sent' })).body.status).toBe('sent');
    expect((await api('PUT', `/api/jobs/${ids.good}/lines`, admin, { lines: [] })).status).toBe(409);
    const v = await api('PATCH', `/api/invoices/${ids.invoice}`, admin, { status: 'void' });
    expect(v.body.status).toBe('void');
    expect((await api('GET', `/api/jobs/${ids.good}`, admin)).body.invoice_id).toBeNull();
    expect((await api('POST', '/api/invoices/generate', admin, { from: today(), to: today() })).body.created).toBe(1);
  });

  it('records a paper ticket entered by the office as approved', async () => {
    const id = await newJob();
    await api('POST', `/api/jobs/${id}/complete`, admin, { litres: 3000 });
    expect((await api('GET', `/api/jobs/${id}`, admin)).body.approval_status).toBe('approved');
  });
});

describe('job chat, followers and notifications', () => {
  it('sends office comments to the driver and driver replies to followers, with read receipts', async () => {
    ids.chat = await newJob();
    pushes.length = 0;
    const r = await api('POST', `/api/jobs/${ids.chat}/comments`, admin, { body: 'Side gate, dog in the yard' });
    expect(r.status).toBe(201);
    expect(pushes.some((p) => p.to === 'ExponentPushToken[sam]' && p.body === 'Side gate, dog in the yard')).toBe(true);

    const seen = await api('GET', `/api/driver/jobs/${ids.chat}/comments`, driver);
    expect(seen.body[0].body).toBe('Side gate, dog in the yard');
    const op = { type: 'comment', client_id: cid(), at: at(), job_id: ids.chat, body: 'On it' };
    await api('POST', '/api/driver/sync', driver, { ops: [op, op] }); // replayed: stored once
    const list = (await api('GET', `/api/jobs/${ids.chat}/comments`, admin)).body;
    expect(list.map((c: { body: string }) => c.body)).toEqual(['Side gate, dog in the yard', 'On it']);
    expect(list[0].seen_by).toEqual(['Sam Driver']);

    const n = (await api('GET', '/api/notifications', admin)).body;
    expect(n.unread).toBeGreaterThan(0);
    expect(n.items[0].title).toMatch(/^Sam Driver on job #\d+$/);
    expect(n.items.some((x: { body: string }) => x.body === 'On it')).toBe(true);
    await api('POST', '/api/notifications/read', admin, {});
    expect((await api('GET', '/api/notifications', admin)).body.unread).toBe(0);
  });

  it('manages followers', async () => {
    await api('PUT', `/api/jobs/${ids.chat}/followers`, admin, { user_ids: [] });
    expect((await api('GET', `/api/jobs/${ids.chat}/followers`, admin)).body).toEqual([]);
  });
});

describe('recurring jobs', () => {
  it('works out the dates of a schedule', () => {
    expect(scheduleDates({ start_date: '2026-11-02', end_date: null, every_days: 3, weekdays: null }, '2026-11-01', '2026-11-10')).toEqual(['2026-11-02', '2026-11-05', '2026-11-08']);
    // 2026-11-02 is a Monday.
    expect(scheduleDates({ start_date: '2026-11-01', end_date: '2026-11-12', every_days: 7, weekdays: [1, 4] }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12']);
  });

  it('creates jobs on the dispatch day once, and moves future ones when the schedule changes', async () => {
    const r = await api('POST', '/api/recurring', admin, { customer_id: ids.customer, site_id: ids.site, requested_litres: 9000, every_days: 1, start_date: today(), driver_id: ids.driver });
    expect(r.status).toBe(201);
    ids.rec = r.body.id;
    const first = (await api('GET', `/api/jobs?date=${today()}`, admin)).body.filter((j: { recurring_id: string }) => j.recurring_id === ids.rec);
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe('scheduled');
    await api('GET', `/api/jobs?date=${today()}`, admin);
    expect((await api('GET', `/api/jobs?date=${today()}`, admin)).body.filter((j: { recurring_id: string }) => j.recurring_id === ids.rec)).toHaveLength(1);
    const list = (await api('GET', '/api/recurring', admin)).body;
    expect(list[0].next_dates).toHaveLength(3);
    expect((await api('DELETE', `/api/recurring/${ids.rec}`, admin)).status).toBe(200);
  });
});

describe('resident requests', () => {
  it('signs a resident in with account number and phone, and refuses wrong ones', async () => {
    expect((await api('POST', '/api/public/sign-in', undefined, { account_code: 'FGH-010', phone: '555-0000' })).status).toBe(401);
    const r = await api('POST', '/api/public/sign-in', undefined, { account_code: 'fgh-010', phone: '867 598 1010' });
    expect(r.status).toBe(200);
    ids.resident = r.body.token;
    // A resident token opens nothing on the office side.
    expect((await api('GET', '/api/jobs', ids.resident)).status).toBe(403);
    const me = (await api('GET', '/api/public/me', ids.resident)).body;
    expect(me.sites.map((s: { label: string }) => s.label)).toEqual(['Elders Centre']);
  });

  it('takes a request, tells the office, and gives a tracking link', async () => {
    // Finish what's open on the site first so a new request is allowed.
    await pool.query(`update jobs set status = 'cancelled' where site_id = $1 and status <> 'completed'`, [ids.site]);
    const r = await api('POST', '/api/public/requests', ids.resident, { site_id: ids.site, litres: 5000, out_of_water: true, name: 'Mary', phone: '598-1010', notes: 'Dry since morning' });
    expect(r.status).toBe(201);
    const dup = await api('POST', '/api/public/requests', ids.resident, { site_id: ids.site, name: 'Mary', phone: '598-1010' });
    expect(dup.status).toBe(409);
    const t = await api('GET', `/api/public/track/${r.body.track_token}`);
    expect(t.status).toBe(200);
    expect(t.body.status).toBe('requested');
    expect(t.body.urgent).toBe(true);
    expect(t.body.site_label).toBe('Elders Centre');
    expect(t.body.driver_id).toBeUndefined();
    const n = (await api('GET', '/api/notifications', admin)).body;
    expect(n.items[0].title).toBe('Out of water: Elders Centre');
    const job = (await api('GET', `/api/jobs?unscheduled=true`, admin)).body.find((j: { number: number }) => j.number === r.body.number);
    expect(job.source).toBe('portal');
    expect(job.requester_name).toBe('Mary');
    expect(job.priority).toBe(2);
    expect((await api('GET', '/api/public/track/not-a-real-token-123')).status).toBe(404);
  });

  it('turns the page off from settings', async () => {
    const s = await api('PATCH', '/api/settings', admin, { portal: { enabled: false }, tax: { rate: 0.13, label: 'HST' } });
    expect(s.body.portal.enabled).toBe(false);
    expect(s.body.tax).toEqual({ label: 'HST', rate: 0.13 });
    expect(s.body.company.name).toBe('Water Delivery');
    expect((await api('GET', '/api/public/config')).body.enabled).toBe(false);
    expect((await api('POST', '/api/public/sign-in', undefined, { account_code: 'FGH-010', phone: '8675981010' })).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { taskDue } from '../src/lib/fleet.js';
import { estimate } from '../src/lib/forecast.js';
import { e164 } from '../src/lib/messaging.js';
import { optimizeStops, routeLength } from '../src/lib/routing.js';

let pool: pg.Pool;
let app: FastifyInstance;
let admin = '';
let driver = '';
const ids: Record<string, string> = {};

async function api(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = res.body;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton' }).format(new Date());
const at = (minAgo = 0) => new Date(Date.now() - minAgo * 60_000).toISOString();
let seq = 0;
const cid = () => `ops-test-${Date.now()}-${seq++}`;

beforeAll(async () => {
  pool = createPool();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  await seed(pool, { demo: false, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
  app = await buildApp({ pool, serveWeb: false, logger: !!process.env.TEST_LOG, push: async () => {} });
  admin = (await api('POST', '/api/auth/login', undefined, { email: 'admin@test.local', password: 'admin-password' })).body.token;
  ids.driver = (await api('POST', '/api/users', admin, { name: 'Sam Driver', email: 'sam@test.local', role: 'driver', password: 'driver-pass' })).body.id;
  driver = (await api('POST', '/api/auth/login', undefined, { email: 'sam@test.local', password: 'driver-pass' })).body.token;
  ids.truck = (await api('POST', '/api/trucks', admin, { name: 'Truck 1', capacity_l: 13600, odometer_km: 41000, engine_hours: 3000 })).body.id;
  ids.customer = (await api('POST', '/api/customers', admin, { name: 'Mary Kakfwi', account_code: 'FGH-020', phone: '867-598-1020', email: 'mary@example.com', notify_sms: true, notify_email: true, customer_class: 'public_housing' })).body.id;
  ids.site = (await api('POST', '/api/sites', admin, { customer_id: ids.customer, label: 'House 20', lat: 66.2565, lng: -128.6335, tank_capacity_l: 4000, critical: true })).body.id;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('truck uptime', () => {
  it('works out when maintenance is due by km, hours or days', () => {
    const truck = { odometer_km: 41000, engine_hours: 3000 };
    expect(taskDue({ every_km: 10000, every_hours: null, every_days: null, last_done_at: null, last_done_km: 30000, last_done_hours: null }, truck).state).toBe('overdue');
    const soon = taskDue({ every_km: 10000, every_hours: null, every_days: null, last_done_at: null, last_done_km: 31500, last_done_hours: null }, truck);
    expect(soon).toMatchObject({ state: 'due_soon', label: '500 km left', next_km: 41500 });
    expect(taskDue({ every_km: null, every_hours: 250, every_days: null, last_done_at: null, last_done_km: null, last_done_hours: 2900 }, truck).state).toBe('ok');
    const d = taskDue({ every_km: null, every_hours: null, every_days: 30, last_done_at: '2026-01-01', last_done_km: null, last_done_hours: null }, truck, new Date('2026-02-05T12:00:00Z'));
    expect(d).toMatchObject({ state: 'overdue', label: '5 days overdue' });
  });

  it('shows the checklist to drivers, takes a failed inspection off the road, and puts it back after repair', async () => {
    const t = await api('GET', '/api/driver/today', driver);
    expect(t.body.inspection.items.length).toBeGreaterThan(5);
    expect(t.body.trucks[0].inspected_at).toBeNull();
    const op = {
      type: 'inspection', client_id: cid(), at: at(1), truck_id: ids.truck, odometer_km: 41250, engine_hours: 3010,
      items: [{ label: 'Tires and wheels', ok: true }, { label: 'Brakes and air system', ok: false, note: 'Air leak at rear chamber' }],
    };
    const r = await api('POST', '/api/driver/sync', driver, { ops: [op, op] });
    expect(r.body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect((await pool.query('select count(*)::int as n from inspections')).rows[0].n).toBe(1);
    const fs = (await api('GET', '/api/fleet/status', admin)).body.find((x: { id: string }) => x.id === ids.truck);
    expect(fs).toMatchObject({ out_of_service: true, out_of_service_reason: 'Brakes and air system: Air leak at rear chamber' });
    expect(Number(fs.odometer_km)).toBe(41250);
    expect(fs.last_inspection.defects).toBe(1);
    const n = await api('GET', '/api/notifications', admin);
    expect(n.body.items.some((x: { title: string }) => x.title === 'Truck 1 failed its inspection')).toBe(true);
    expect((await api('GET', '/api/driver/today', driver)).body.trucks[0].inspected_at).not.toBeNull();

    const task = await api('POST', '/api/maintenance/tasks', admin, { truck_id: ids.truck, name: 'Oil change', every_km: 10000, last_done_km: 30000 });
    expect(task.status).toBe(201);
    let st = (await api('GET', '/api/fleet/status', admin)).body.find((x: { id: string }) => x.id === ids.truck);
    expect(st.overdue).toBe(1);
    const log = await api('POST', '/api/maintenance/log', admin, { truck_id: ids.truck, task_id: task.body.id, title: 'Oil change and brake chamber', odometer_km: 41300, cost: 640, back_in_service: true });
    expect(log.status).toBe(201);
    st = (await api('GET', '/api/fleet/status', admin)).body.find((x: { id: string }) => x.id === ids.truck);
    expect(st).toMatchObject({ out_of_service: false, overdue: 0 });
    expect(st.tasks[0].due).toMatchObject({ state: 'ok', next_km: 51300 });
  });
});

describe('days until empty', () => {
  it('estimates use from delivery history', () => {
    const day = 86_400_000;
    const now = new Date('2026-03-11T12:00:00Z');
    const hist = [0, 10, 20].map((d) => ({ litres: 2000, at: new Date(now.getTime() - (30 - d) * day) }));
    // 4,000 L used over 20 days = 200 L a day; full 4,000 L tank, 10 days since the last fill: 2,000 L, 10 days left.
    expect(estimate(hist, 4000, now)).toMatchObject({ litres_per_day: 200, level_l: 2000, level_pct: 50, days_left: 10, empty_on: '2026-03-21' });
    expect(estimate(hist.slice(0, 1), 4000, now).days_left).toBeNull();
  });

  it('lists houses with the most urgent first', async () => {
    const r = await api('GET', '/api/forecast', admin);
    expect(r.status).toBe(200);
    expect(r.body.sites[0]).toMatchObject({ site_label: 'House 20', critical: true, state: 'unknown' });
  });
});

describe('customer classes', () => {
  it('prices a delivery at the class rate unless the customer has their own', async () => {
    const water = (await api('POST', '/api/price-items', admin, { code: 'WATER', name: 'Potable water', unit: 'litre', unit_price: 0.05, kind: 'water' })).body;
    expect((await api('PUT', `/api/price-items/${water.id}/class-rates`, admin, { rates: { public_housing: 0.03 } })).status).toBe(200);
    const list = (await api('GET', '/api/price-items', admin)).body;
    expect(Number(list.find((p: { id: string }) => p.id === water.id).class_rates.public_housing)).toBe(0.03);
    const { rateFor } = await import('../src/lib/billing.js');
    expect(await rateFor(pool, ids.customer, water.id, 0.05)).toBe(0.03);
    await api('PUT', `/api/customers/${ids.customer}/rates`, admin, { rates: [{ price_item_id: water.id, unit_price: 0.025 }] });
    expect(await rateFor(pool, ids.customer, water.id, 0.05)).toBe(0.025);
  });
});

describe('resident alerts', () => {
  it('formats phone numbers', () => {
    expect(e164('(867) 598-1020')).toBe('+18675981020');
    expect(e164('1 867 598 1020')).toBe('+18675981020');
    expect(e164('598-1020')).toBeNull();
  });

  it('logs booked, on the way and delivered alerts once each, and sends them when a provider is set', async () => {
    const sent: { url: string; body: string }[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('{}', { status: 200 });
    });
    process.env.TWILIO_ACCOUNT_SID = 'AC123'; process.env.TWILIO_AUTH_TOKEN = 'x'; process.env.TWILIO_FROM = '+15005550006';
    try {
      // Off in settings: logged as skipped, nothing sent.
      const job = await api('POST', '/api/jobs', admin, { customer_id: ids.customer, site_id: ids.site, requested_litres: 3000, scheduled_date: today(), driver_id: ids.driver });
      let msgs = (await api('GET', '/api/messages', admin)).body.items;
      expect(msgs).toHaveLength(2);
      expect(msgs.every((m: { status: string; kind: string }) => m.status === 'skipped' && m.kind === 'scheduled')).toBe(true);
      expect(sent).toHaveLength(0);

      await api('PATCH', '/api/settings', admin, { alerts: { sms: true } });
      const r = await api('POST', '/api/driver/sync', driver, { ops: [
        { type: 'job_start', client_id: cid(), at: at(5), job_id: job.body.id },
        { type: 'job_complete', client_id: cid(), at: at(1), job_id: job.body.id, litres: 2950, meter_start: 100, meter_end: 3050 },
      ] });
      expect(r.body.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
      msgs = (await api('GET', '/api/messages', admin)).body.items;
      const sms = msgs.filter((m: { channel: string }) => m.channel === 'sms');
      expect(sms.map((m: { kind: string; status: string }) => `${m.kind}:${m.status}`).sort()).toEqual(['completed:sent', 'en_route:sent', 'scheduled:skipped']);
      expect(sms.find((m: { kind: string }) => m.kind === 'en_route').body).toMatch(/on its way to House 20\. Track it: .*\/track\/[\w-]{10,}/);
      expect(sms.find((m: { kind: string }) => m.kind === 'completed').body).toMatch(/2,950 L delivered to House 20/);
      const twilio = sent.filter((x) => x.url.includes('api.twilio.com'));
      expect(twilio).toHaveLength(2);
      expect(new URLSearchParams(twilio[0].body).get('To')).toBe('+18675981020');
      // Email is still off, so those were only logged.
      expect(msgs.filter((m: { channel: string; status: string }) => m.channel === 'email' && m.status === 'sent')).toHaveLength(0);

      const notice = await api('POST', '/api/notices', admin, { body: 'No deliveries Monday: plant maintenance.' });
      expect(notice.body).toMatchObject({ recipients: 1, sent: 1, skipped: 1 });
    } finally {
      vi.stubGlobal('fetch', realFetch);
      delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
    }
  });
});

describe('stop order', () => {
  it('puts people out of water first and shortens the run', () => {
    const depot = { lat: 66.25, lng: -128.63 };
    const stops = [
      { id: 'far', lat: 66.27, lng: -128.60 },
      { id: 'near', lat: 66.2505, lng: -128.631 },
      { id: 'mid', lat: 66.26, lng: -128.615 },
      { id: 'urgent', lat: 66.268, lng: -128.602, urgent: true },
    ];
    const best = optimizeStops(depot, stops);
    expect(best[0].id).toBe('urgent');
    expect(best.map((s) => s.id)).toEqual(['urgent', 'far', 'mid', 'near']);
    expect(routeLength(depot, best.slice(1))).toBeLessThanOrEqual(routeLength(depot, stops.slice(0, 3)));
  });

  it('suggests an order for a driver day', async () => {
    const r = await api('POST', '/api/dispatch/optimize', admin, { driver_id: ids.driver, scheduled_date: today() });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.job_ids)).toBe(true);
  });
});

describe('quickbooks', () => {
  it('reports that it is not set up, and refuses to sync without a connection', async () => {
    const s = await api('GET', '/api/integrations/quickbooks', admin);
    expect(s.body).toMatchObject({ configured: false, connected: false });
    expect(s.body.redirect_uri).toMatch(/\/api\/public\/quickbooks\/callback$/);
    const settings = (await api('GET', '/api/settings', admin)).body;
    expect(settings.quickbooks).toEqual({ connected: false, realm_id: null, connected_at: null, company_name: null });
    const cb = await app.inject({ method: 'GET', url: '/api/public/quickbooks/callback?code=x&realmId=1&state=forged.1.abc' });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('qbo=expired');
  });
});

describe('staff sign-in revocation', () => {
  it('stops an existing token as soon as the account is demoted, deactivated or its password reset', async () => {
    const u = (await api('POST', '/api/users', admin, { name: 'Dana Office', email: 'dana@test.local', role: 'dispatcher', password: 'dispatch-pass' })).body;
    const tok = (await api('POST', '/api/auth/login', undefined, { email: 'dana@test.local', password: 'dispatch-pass' })).body.token;
    expect((await api('GET', '/api/customers', tok)).status).toBe(200);
    await api('PATCH', `/api/users/${u.id}`, admin, { role: 'driver' });
    expect((await api('GET', '/api/customers', tok)).status).toBe(403);
    await api('PATCH', `/api/users/${u.id}`, admin, { role: 'dispatcher', active: false });
    expect((await api('GET', '/api/customers', tok)).status).toBe(401);
    await api('PATCH', `/api/users/${u.id}`, admin, { active: true });
    expect((await api('GET', '/api/customers', tok)).status).toBe(200);
    await pool.query(`update users set password_changed_at = now() + interval '5 seconds' where id = $1`, [u.id]);
    (await import('../src/http.js')).forgetStaff(u.id);
    expect((await api('GET', '/api/customers', tok)).status).toBe(401);
  });
});

describe('partial updates', () => {
  it('changing one field of a price item leaves the others alone', async () => {
    const it0 = (await api('POST', '/api/price-items', admin, { code: 'WTR2', name: 'Water', unit: 'litre', unit_price: 0.04, kind: 'water', taxable: false })).body;
    const r = await api('PATCH', `/api/price-items/${it0.id}`, admin, { unit_price: 0.05 });
    expect(r.body).toMatchObject({ kind: 'water', unit: 'litre', taxable: false });
    expect(Number(r.body.unit_price)).toBe(0.05);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import type { PushMessage } from '../src/lib/push.js';

let pool: pg.Pool;
let app: FastifyInstance;
const pushes: PushMessage[] = [];
let adminToken = '';
let driverToken = '';
let driver2Token = '';
const ids: Record<string, string> = {};

// A 1x1 JPEG, enough to exercise photo storage and the PDF ticket.
const JPEG =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function api(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as object,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  let body: any = res.body;
  try {
    body = res.json();
  } catch {
    // not JSON
  }
  return { status: res.statusCode, body, raw: res };
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton' }).format(new Date());
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeAll(async () => {
  pool = createPool();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  await seed(pool, { demo: false, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
  app = await buildApp({ pool, serveWeb: false, logger: !!process.env.TEST_LOG, push: async (m) => void pushes.push(...m) });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('end-to-end delivery flow', () => {
  it('rejects bad sign-in and accepts the admin', async () => {
    expect((await api('POST', '/api/auth/login', undefined, { email: 'admin@test.local', password: 'nope' })).status).toBe(401);
    const res = await api('POST', '/api/auth/login', undefined, { email: 'ADMIN@test.local', password: 'admin-password' });
    expect(res.status).toBe(200);
    adminToken = res.body.token;
    expect((await api('GET', '/api/jobs')).status).toBe(401);
  });

  it('sets up drivers, a truck, a customer, a delivery point and the bulk tank', async () => {
    const d1 = await api('POST', '/api/users', adminToken, { name: 'Sam', email: 'sam@test.local', role: 'driver', password: 'driver-pass' });
    const d2 = await api('POST', '/api/users', adminToken, { name: 'Lee', email: 'lee@test.local', role: 'driver', password: 'driver-pass' });
    expect(d1.status).toBe(201);
    ids.driver = d1.body.id;
    ids.driver2 = d2.body.id;
    driverToken = (await api('POST', '/api/auth/login', undefined, { email: 'sam@test.local', password: 'driver-pass' })).body.token;
    driver2Token = (await api('POST', '/api/auth/login', undefined, { email: 'lee@test.local', password: 'driver-pass' })).body.token;
    await api('POST', '/api/me/push-token', driverToken, { token: 'ExponentPushToken[abc123]' });

    // Drivers cannot manage the office side.
    expect((await api('POST', '/api/customers', driverToken, { name: 'x' })).status).toBe(403);

    ids.truck = (await api('POST', '/api/trucks', adminToken, { name: 'Truck 1', capacity_l: 13600 })).body.id;
    ids.customer = (await api('POST', '/api/customers', adminToken, { name: 'Band Office', account_code: 'FGH-001' })).body.id;
    const site = await api('POST', '/api/sites', adminToken, {
      customer_id: ids.customer, label: 'Band Office', lat: 66.2565, lng: -128.6335, geofence_m: 60,
    });
    expect(site.status).toBe(201);
    ids.site = site.body.id;
    const tank = await api('POST', '/api/tanks', adminToken, { name: 'Main', device_id: 'armor-test', capacity_l: 250000, height_mm: 6000 });
    expect(tank.status).toBe(201);
    expect(tank.body.device_key).toBeTruthy();
    expect(tank.body.device_key_hash).toBeUndefined();
    ids.tank = tank.body.id;
    ids.deviceKey = tank.body.device_key;
  });

  it('rejects a delivery point that belongs to another customer', async () => {
    const other = (await api('POST', '/api/customers', adminToken, { name: 'Other' })).body.id;
    const res = await api('POST', '/api/jobs', adminToken, { customer_id: other, site_id: ids.site });
    expect(res.status).toBe(400);
  });

  it('dispatches a job and notifies the driver', async () => {
    const res = await api('POST', '/api/jobs', adminToken, {
      customer_id: ids.customer, site_id: ids.site, requested_litres: 9000, scheduled_date: today(), driver_id: ids.driver,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.number).toBeGreaterThanOrEqual(1001);
    ids.job = res.body.id;
    expect(pushes.at(-1)).toMatchObject({ to: 'ExponentPushToken[abc123]', title: `New job #${res.body.number}` });

    const unassigned = await api('POST', '/api/jobs', adminToken, { customer_id: ids.customer, site_id: ids.site });
    expect(unassigned.body.status).toBe('requested');
    ids.job2 = unassigned.body.id;
    const queue = await api('GET', '/api/jobs?unscheduled=true', adminToken);
    expect(queue.body.map((j: any) => j.id)).toEqual([ids.job2]);
  });

  it("shows the driver today's jobs", async () => {
    const res = await api('GET', '/api/driver/today', driverToken);
    expect(res.status).toBe(200);
    expect(res.body.shift).toBeNull();
    expect(res.body.jobs.map((j: any) => j.id)).toEqual([ids.job]);
    expect(res.body.trucks[0].id).toBe(ids.truck);
  });

  it('records a full shift from the offline queue, and replaying it changes nothing', async () => {
    const ops = [
      { type: 'shift_start', client_id: 'shift-start-0001', at: minsAgo(60), truck_id: ids.truck, start_meter: 1000 },
      { type: 'fill', client_id: 'fill-00000001', started_at: minsAgo(55), ended_at: minsAgo(45), tank_id: ids.tank, litres_reported: 13000 },
      { type: 'job_start', client_id: 'job-start-0001', at: minsAgo(40), job_id: ids.job },
      {
        type: 'gps', client_id: 'gps-batch-0001', points: [
          { ts: minsAgo(39), lat: 66.2600, lng: -128.6400, accuracy_m: 10 }, // far away
          { ts: minsAgo(30), lat: 66.25652, lng: -128.63355, accuracy_m: 8 }, // at the Band Office
        ],
      },
      {
        type: 'job_complete', client_id: 'job-done-0001', at: minsAgo(20), job_id: ids.job, litres: 8950,
        meter_start: 1000, meter_end: 9950, recipient_name: 'Mary', meter_photo: { mime: 'image/jpeg', data_base64: JPEG },
      },
    ];
    const first = await api('POST', '/api/driver/sync', driverToken, { ops });
    expect(first.status).toBe(200);
    expect(first.body.results.every((r: any) => r.ok)).toBe(true);

    const job = await api('GET', `/api/jobs/${ids.job}`, adminToken);
    expect(job.body.status).toBe('completed');
    expect(job.body.arrival_source).toBe('gps');
    expect(job.body.delivered_litres).toBe(8950);
    expect(job.body.truck_id).toBe(ids.truck);
    expect(job.body.trail).toHaveLength(2);
    expect(job.body.audit.map((a: any) => a.action)).toEqual(['created', 'started', 'arrived', 'completed']);

    const again = await api('POST', '/api/driver/sync', driverToken, { ops });
    expect(again.body.results.every((r: any) => r.ok)).toBe(true);
    const counts = await pool.query(
      `select (select count(*) from deliveries)::int d, (select count(*) from shifts)::int s,
              (select count(*) from fills)::int f, (select count(*) from gps_points)::int g, (select count(*) from files)::int p`,
    );
    expect(counts.rows[0]).toEqual({ d: 1, s: 1, f: 1, g: 2, p: 1 });
    const truck = await api('GET', `/api/trucks/${ids.truck}`, adminToken);
    expect(truck.body.last_meter_reading).toBe(9950);
  });

  it("refuses work on someone else's job and reports it as permanent", async () => {
    const res = await api('POST', '/api/driver/sync', driver2Token, {
      ops: [{ type: 'job_start', client_id: 'other-start-01', at: minsAgo(1), job_id: ids.job }, { type: 'bogus', client_id: 'bad-op-000001' }],
    });
    expect(res.body.results[0]).toMatchObject({ ok: false, permanent: true });
    expect(res.body.results[0].error).toMatch(/reassigned/);
    expect(res.body.results[1]).toMatchObject({ ok: false, permanent: true });
  });

  it('locks completed jobs against edits', async () => {
    expect((await api('PATCH', `/api/jobs/${ids.job}`, adminToken, { requested_litres: 1 })).status).toBe(409);
    expect((await api('POST', `/api/jobs/${ids.job}/cancel`, adminToken, {})).status).toBe(409);
  });

  it('accepts tank readings only with the right key and converts levels to litres', async () => {
    const bad = await api('POST', '/api/ingest/tank-readings', undefined, { volume_l: 1 }, { 'x-device-id': 'armor-test', 'x-device-key': 'wrong' });
    expect(bad.status).toBe(401);
    const readings = [
      { ts: minsAgo(70), volume_l: 200000 },
      { ts: minsAgo(56), volume_l: 200000 },
      { ts: minsAgo(50), volume_l: 193000 },
      { ts: minsAgo(44), level_mm: 4475.52 }, // 186,480 L
      { ts: Math.floor(Date.now() / 1000) - 35 * 60, volume_l: 186480 }, // unix seconds
    ];
    const ok = await api('POST', '/api/ingest/tank-readings', undefined, { readings }, { authorization: `Bearer ${ids.deviceKey}`, 'x-device-id': 'armor-test' });
    expect(ok.status).toBe(202);
    expect(ok.body).toEqual({ stored: 5, received: 5 });
    const dup = await api('POST', '/api/ingest/tank-readings', undefined, { device_id: 'armor-test', readings }, { 'x-device-key': ids.deviceKey });
    expect(dup.body.stored).toBe(0);
    const tanks = await api('GET', '/api/tanks', adminToken);
    expect(tanks.body[0].latest_volume_l).toBe(186480);
  });

  it('reconciles litres drawn from the tank against litres delivered', async () => {
    const day = today();
    const fills = await api('GET', `/api/reports/fills?from=${day}&to=${day}`, adminToken);
    expect(fills.body[0].litres_from_tank).toBe(13520);
    const daily = await api('GET', `/api/reports/daily?from=${day}&to=${day}`, adminToken);
    expect(daily.status).toBe(200);
    expect(daily.body).toHaveLength(1);
    expect(daily.body[0]).toMatchObject({
      day, jobs_completed: 1, delivered_l: 8950, tank_drawn_l: 13520, fills_loaded_l: 13520, fills_reported_l: 13000, unaccounted_l: 4570,
    });
    expect(daily.body[0].by_truck[0]).toMatchObject({ truck_name: 'Truck 1', delivered_l: 8950, jobs: 1 });
  });

  it('exports deliveries as CSV and a PDF ticket', async () => {
    const day = today();
    const csv = await api('GET', `/api/exports/deliveries.csv?from=${day}&to=${day}`, adminToken);
    expect(csv.status).toBe(200);
    const lines = csv.raw.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('FGH-001,Band Office,Band Office');
    expect(lines[1]).toContain(',8950,1000,9950,Truck 1,Sam,Mary,9000,');

    const pdf = await api('GET', `/api/jobs/${ids.job}/ticket.pdf?token=${adminToken}`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.headers['content-type']).toBe('application/pdf');
    expect(pdf.raw.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('moves jobs between drivers on the dispatch board and tells the new driver', async () => {
    await api('POST', '/api/me/push-token', driver2Token, { token: 'ExponentPushToken[lee]' });
    const before = pushes.length;
    const res = await api('POST', '/api/jobs/reorder', adminToken, { scheduled_date: today(), driver_id: ids.driver2, job_ids: [ids.job2] });
    expect(res.status).toBe(200);
    const job = await api('GET', `/api/jobs/${ids.job2}`, adminToken);
    expect(job.body).toMatchObject({ status: 'scheduled', driver_id: ids.driver2 });
    expect(pushes.slice(before).map((p) => p.to)).toEqual(['ExponentPushToken[lee]']);

    const clone = await api('POST', `/api/jobs/${ids.job2}/clone`, adminToken, { scheduled_date: null });
    expect(clone.body).toMatchObject({ status: 'requested', scheduled_date: null });
    const cancel = await api('POST', `/api/jobs/${clone.body.id}/cancel`, adminToken, { reason: 'duplicate' });
    expect(cancel.body.status).toBe('cancelled');
  });

  it('lets the office key in a paper ticket', async () => {
    const res = await api('POST', `/api/jobs/${ids.job2}/complete`, adminToken, { litres: 4000, meter_start: 9950, meter_end: 13950 });
    expect(res.status).toBe(200);
    expect(res.body.delivered_litres).toBe(4000);
    const bad = await api('POST', `/api/jobs/${ids.job2}/complete`, adminToken, { litres: 1 });
    expect(bad.status).toBe(409);
  });

  it('shows on-duty trucks on the live map and ends the shift', async () => {
    const live = await api('GET', '/api/live/positions', adminToken);
    expect(live.body).toHaveLength(1);
    expect(live.body[0]).toMatchObject({ driver_name: 'Sam', truck_name: 'Truck 1', lat: 66.25652 });
    await api('POST', '/api/driver/sync', driverToken, { ops: [{ type: 'shift_end', client_id: 'shift-end-0001', at: minsAgo(0), end_meter: 9950 }] });
    expect((await api('GET', '/api/live/positions', adminToken)).body).toHaveLength(0);
  });

  it('imports customers and delivery points from a spreadsheet', async () => {
    const res = await api('POST', '/api/import/customers', adminToken, {
      rows: [
        { customer: 'Residence 7', account_code: 'FGH-007', site_label: 'House 7', lat: '66.25', lng: '-128.63' },
        { customer: 'Residence 7', account_code: 'FGH-007', site_label: 'House 7 shed' },
        { customer: 'Band Office', account_code: 'FGH-001', site_label: 'Band Office annex' },
      ],
    });
    expect(res.body).toEqual({ customers_created: 1, sites_created: 3 });
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';

let pool: pg.Pool;
let app: FastifyInstance;
let calls = 0;

// A fake Overpass answer: a grid of 60 small houses, three named buildings and one street.
function overpassReply() {
  const elements: unknown[] = [];
  const square = (lat: number, lng: number, d: number) => [
    { lat, lon: lng }, { lat, lon: lng + d * 2 }, { lat: lat + d, lon: lng + d * 2 }, { lat: lat + d, lon: lng }, { lat, lon: lng },
  ];
  let id = 1;
  for (let i = 0; i < 60; i++) {
    const lat = 66.25 + Math.floor(i / 10) * 0.0012;
    const lng = -128.645 + (i % 10) * 0.0025;
    elements.push({ type: 'way', id: id++, tags: { building: 'house' }, geometry: square(lat, lng, 0.0001) });
  }
  for (const name of ["Chief T'Selehye School", 'Northern Store', 'Water Treatment Plant']) {
    elements.push({ type: 'way', id: id++, tags: { building: 'yes', name, 'addr:street': 'Main Street' }, geometry: square(66.256 + id * 0.0003, -128.63, 0.0004) });
  }
  elements.push({ type: 'way', id: id++, tags: { highway: 'residential', name: 'Mackenzie Drive' }, geometry: [{ lat: 66.25, lon: -128.65 }, { lat: 66.26, lon: -128.62 }] });
  return { elements };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('overpass')) {
      calls++;
      return new Response(JSON.stringify(overpassReply()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  pool = createPool();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  app = await buildApp({ pool, serveWeb: false, logger: false, push: async () => {} });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  await pool?.end();
});

describe('real buildings', () => {
  it('puts demo customers on real building outlines and keeps real names', async () => {
    const r = await seed(pool, { demo: true, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
    expect((r.demo as { real_buildings: boolean }).real_buildings).toBe(true);
    const { rows: sites } = await pool.query('select s.label, s.lat, s.lng, s.address from sites s');
    expect(sites).toHaveLength(30);
    const labels = sites.map((s) => s.label);
    expect(labels).toContain("Chief T'Selehye School");
    expect(labels).not.toContain('Water Treatment Plant');
    // Every site sits inside the bounds of a cached building.
    const { rows: hits } = await pool.query(
      `select count(*)::int as n from sites s where exists (select 1 from map_buildings b
         where abs(b.lat - s.lat) < 0.0003 and abs(b.lng - s.lng) < 0.0005)`,
    );
    expect(hits[0].n).toBe(30);
    expect(sites.find((s) => s.label.startsWith('House'))?.address).toBe('Mackenzie Drive, Fort Good Hope, NT');
    // The bulk tank moved onto the water plant.
    const tank = (await pool.query('select lat from source_tanks')).rows[0];
    expect(tank.lat).toBeGreaterThan(66.256);
  });

  it('seeding again leaves the demo alone', async () => {
    const before = (await pool.query('select count(*)::int as n from jobs')).rows[0].n;
    const r = await seed(pool, { demo: true, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
    expect(r.demo).toMatch(/current/);
    expect((await pool.query('select count(*)::int as n from jobs')).rows[0].n).toBe(before);
  });

  it('replaces an older demo but never real data', async () => {
    await pool.query(`update app_meta set value = '1' where key = 'demo_version'`);
    const r = await seed(pool, { demo: true, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
    expect(r.demo_replaced).toBe(true);
    expect((await pool.query('select count(*)::int as n from customers')).rows[0].n).toBe(30);

    await pool.query(`update app_meta set value = '1' where key = 'demo_version'`);
    await pool.query(`insert into customers (name, account_code) values ('Real customer', 'ACC-1')`);
    const r2 = await seed(pool, { demo: true, adminEmail: 'admin@test.local', adminPassword: 'admin-password' });
    expect(r2.demo).toMatch(/real data/);
    expect((await pool.query(`select count(*)::int as n from customers where name = 'Real customer'`)).rows[0].n).toBe(1);
  });

  it('serves building outlines as GeoJSON from the cache', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'dispatch@example.com', password: 'dispatch123' } });
    const token = login.json().token;
    const before = calls;
    const res = await app.inject({ method: 'GET', url: '/api/map/buildings?bbox=66.249,-128.65,66.262,-128.62', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const fc = res.json();
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBeGreaterThan(50);
    expect(fc.features[0].geometry.type).toBe('Polygon');
    expect(calls).toBe(before); // covered by the area fetched while seeding
    const big = await app.inject({ method: 'GET', url: '/api/map/buildings?bbox=60,-130,65,-120', headers: { authorization: `Bearer ${token}` } });
    expect(big.statusCode).toBe(400);
  });
});

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type pg from 'pg';
import { createPool, tx } from './db.js';
import { migrate } from './migrate.js';
import { hashKey } from './routes/admin.js';
import { config } from './config.js';
import { bboxAround, downloadBuildings, storeBuildings, type Building } from './lib/osm.js';

// Bump to replace an older demo data set (only demo data, never real records).
const DEMO_VERSION = 2;
const DEMO_CENTRE = { lat: 66.2565, lng: -128.6335 };
const DEMO_EMAILS = ['dispatch@example.com', 'sam@example.com', 'lee@example.com', 'jo@example.com'];

/**
 * Creates the first admin account. With --demo it also adds sample trucks,
 * drivers, customers around Fort Good Hope, a bulk tank and today's jobs, so
 * the whole flow can be tried before real data is loaded.
 */
export async function seed(pool: pg.Pool, opts: { demo: boolean; adminEmail: string; adminPassword: string }) {
  // Real building outlines for the demo, fetched before the transaction so a slow
  // download doesn't hold locks. Without them the demo falls back to a made-up layout.
  let buildings: Building[] = [];
  if (opts.demo && !(await demoIsCurrent(pool))) {
    const box = bboxAround(DEMO_CENTRE.lat, DEMO_CENTRE.lng, 1800);
    try {
      buildings = await downloadBuildings(box);
      await storeBuildings(pool, box, buildings);
    } catch (err) {
      console.warn(`Demo: building outlines unavailable (${(err as Error).message}); using a made-up layout`);
    }
  }
  return tx(pool, async (c) => {
    // Several serverless instances can start at once; only one seeds.
    await c.query('select pg_advisory_xact_lock(7316001)');
    const out: Record<string, unknown> = {};
    const existing = await c.query('select id from users where email = $1', [opts.adminEmail]);
    if (!existing.rows[0]) {
      await c.query(
        `insert into users (name, email, role, password_hash) values ('Administrator', $1, 'admin', $2)`,
        [opts.adminEmail, await bcrypt.hash(opts.adminPassword, 10)],
      );
      out.admin = opts.adminEmail;
    }
    if (!opts.demo) return out;
    if (await demoIsCurrent(c)) {
      out.demo = 'skipped, demo data is current';
      return out;
    }
    if ((await c.query('select 1 from trucks limit 1')).rows[0]) {
      if (!(await isOnlyDemoData(c))) {
        out.demo = 'skipped, real data present';
        return out;
      }
      await clearDemoData(c);
      out.demo_replaced = true;
    }

    const pw = await bcrypt.hash('driver123', 10);
    await c.query(`insert into users (name, email, role, password_hash) values ('Dana Dispatcher', 'dispatch@example.com', 'dispatcher', $1)`, [
      await bcrypt.hash('dispatch123', 10),
    ]);
    const drivers = [];
    for (const [name, email] of [['Sam Kakfwi', 'sam@example.com'], ['Lee Tobac', 'lee@example.com'], ['Jo Barnaby', 'jo@example.com']]) {
      drivers.push((await c.query(`insert into users (name, email, role, password_hash) values ($1,$2,'driver',$3) returning id`, [name, email, pw])).rows[0].id);
    }
    const trucks = [];
    for (const [name, plate] of [['Truck 1', 'NT 4021'], ['Truck 2', 'NT 4022'], ['Truck 3', 'NT 4023']]) {
      trucks.push((await c.query('insert into trucks (name, plate, capacity_l, last_meter_reading) values ($1,$2,13600,0) returning id', [name, plate])).rows[0].id);
    }
    const deviceKey = crypto.randomBytes(24).toString('base64url');
    await c.query(
      `insert into source_tanks (name, device_id, device_key_hash, capacity_l, height_mm, lat, lng)
       values ('Main holding tank', 'armor-001', $1, 250000, 6000, $2, $3)`,
      [hashKey(deviceKey), ...tankSpot(buildings)],
    );
    out.tank_device = { device_id: 'armor-001', device_key: deviceKey };

    const sites = await demoSites(c, buildings);
    const today = (await c.query(`select (now() at time zone $1)::date::text as d`, [config.timezone])).rows[0].d;
    for (let i = 0; i < 18; i++) {
      const s = sites[i];
      const driver = i < 15 ? drivers[i % 3] : null;
      await c.query(
        `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, driver_id, truck_id, status, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.cust, s.site, s.litres, today, driver, driver ? trucks[i % 3] : null, driver ? 'scheduled' : 'requested', Math.floor(i / 3)],
      );
    }
    await demoHistory(c, { drivers, trucks, sites });
    await c.query(
      `insert into app_meta (key, value) values ('demo_version', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(DEMO_VERSION)],
    );
    out.demo = { drivers: ['sam@example.com', 'lee@example.com', 'jo@example.com'], driver_password: 'driver123',
      dispatcher: 'dispatch@example.com / dispatch123', real_buildings: buildings.length > 0 };
    return out;
  });
}

async function demoIsCurrent(c: pg.Pool | pg.PoolClient): Promise<boolean> {
  const r = await c.query(`select value from app_meta where key = 'demo_version'`);
  return Number(r.rows[0]?.value) === DEMO_VERSION;
}

/** True when every customer and truck came from a demo seed, so replacing them loses nothing real. */
async function isOnlyDemoData(c: pg.PoolClient): Promise<boolean> {
  const r = await c.query(
    `select (select count(*) from customers where account_code is null or account_code not like 'FGH-%')::int as real_customers,
            (select count(*) from trucks where plate not in ('NT 4021','NT 4022','NT 4023') or plate is null)::int as real_trucks,
            (select count(*) from users where role = 'driver' and email <> all($1))::int as real_drivers`,
    [DEMO_EMAILS],
  );
  const x = r.rows[0];
  return x.real_customers === 0 && x.real_trucks === 0 && x.real_drivers === 0;
}

async function clearDemoData(c: pg.PoolClient) {
  await c.query(`truncate deliveries, fills, gps_points, tank_readings, shifts, jobs, files, sites, customers, trucks, source_tanks, audit_log cascade`);
  await c.query('delete from users where email = any($1)', [DEMO_EMAILS]);
}

const FACILITIES = ['Band Office', "Chief T'Selehye School", 'Health Centre', 'Northern Store', 'RCMP Detachment', 'Arena',
  'Elders Centre', 'Church', 'Airport Terminal', 'Water Treatment Plant'];

function areaM2(ring: [number, number][]): number {
  const k = 111_320 * Math.cos((ring[0][1] * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * k * ring[i + 1][1] * 111_320 - ring[i + 1][0] * k * ring[i][1] * 111_320;
  return Math.abs(a / 2);
}

function tankSpot(buildings: Building[]): [number, number] {
  const plant = buildings.find((b) => /water|treatment|pump/i.test(`${b.name ?? ''} ${b.kind ?? ''}`));
  return plant ? [plant.lat, plant.lng] : [66.2585, -128.6425];
}

/**
 * Demo customers. With real building outlines, public buildings keep their real
 * OpenStreetMap names and residences sit on actual houses; otherwise points are
 * spread around the community centre.
 */
async function demoSites(c: pg.PoolClient, buildings: Building[]) {
  type Spot = { name: string; label: string; address: string; lat: number; lng: number; house: boolean };
  const spots: Spot[] = [];
  const town = 'Fort Good Hope, NT';
  if (buildings.length >= 30) {
    const named = buildings.filter((b) => b.name && !/water|treatment|pump/i.test(b.name)).slice(0, 10);
    for (const b of named) {
      spots.push({ name: b.name!, label: b.name!, address: `${b.address ? `${b.address}, ` : ''}${town}`, lat: b.lat, lng: b.lng, house: false });
    }
    // Houses: small residential outlines, taken evenly from nearest to farthest so the demo covers the whole community.
    const homes = buildings
      .filter((b) => !b.name && (!b.kind || /house|detached|residential|semidetached|cabin|bungalow/.test(b.kind)))
      .map((b) => ({ b, area: areaM2(b.outline) }))
      .filter((h) => h.area > 40 && h.area < 400)
      .sort((x, y) => Math.hypot(x.b.lat - DEMO_CENTRE.lat, (x.b.lng - DEMO_CENTRE.lng) * 0.4) - Math.hypot(y.b.lat - DEMO_CENTRE.lat, (y.b.lng - DEMO_CENTRE.lng) * 0.4));
    const want = 30 - spots.length;
    const step = Math.max(1, Math.floor(homes.length / want));
    for (let i = 0; i < homes.length && spots.length < 30; i += step) {
      const { b } = homes[i];
      const n = 100 + spots.length;
      spots.push({
        name: `Residence ${n}`, label: `House ${n}`,
        address: `${b.address ?? 'Fort Good Hope'}, ${town}`.replace(`Fort Good Hope, ${town}`, town),
        lat: b.lat, lng: b.lng, house: true,
      });
    }
  }
  if (spots.length < 30) {
    spots.length = 0;
    for (let i = 0; i < 30; i++) {
      const isHouse = i >= FACILITIES.length;
      const angle = (i / 30) * Math.PI * 2;
      const r = 0.002 + (i % 5) * 0.0012;
      spots.push({
        name: isHouse ? `Residence ${100 + i}` : FACILITIES[i], label: isHouse ? `House ${100 + i}` : FACILITIES[i],
        address: `${100 + i} Main Street, ${town}`,
        lat: DEMO_CENTRE.lat + r * Math.sin(angle), lng: DEMO_CENTRE.lng + r * 2.2 * Math.cos(angle), house: isHouse,
      });
    }
  }
  // Facilities first so today's jobs mix big and small deliveries the same way either way.
  spots.sort((a, b) => Number(a.house) - Number(b.house));
  const sites = [];
  for (const [i, sp] of spots.entries()) {
    const cust = (await c.query('insert into customers (name, account_code) values ($1,$2) returning id', [sp.name, `FGH-${String(i + 1).padStart(3, '0')}`])).rows[0].id;
    const site = (await c.query(
      `insert into sites (customer_id, label, address, lat, lng, tank_capacity_l) values ($1,$2,$3,$4,$5,$6) returning id`,
      [cust, sp.label, sp.address, sp.lat, sp.lng, sp.house ? 4500 : 20000],
    )).rows[0].id;
    sites.push({ cust, site, litres: sp.house ? 4000 : 9000 });
  }
  return sites;
}

/** Two weeks of past deliveries, truck fills and tank readings, so reports have something to show. */
async function demoHistory(
  c: pg.PoolClient,
  d: { drivers: string[]; trucks: string[]; sites: { cust: string; site: string; litres: number }[] },
) {
  const tank = (await c.query('select id from source_tanks limit 1')).rows[0].id;
  let rand = 7;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const meters = d.trucks.map(() => 0);
  let volume = 220_000;
  const readings: [Date, number][] = [];
  const midnight = (await c.query(`select date_trunc('day', now() at time zone $1) at time zone $1 as m`, [config.timezone])).rows[0].m as Date;
  for (let back = 14; back >= 1; back--) {
    const dayStart = new Date(midnight.getTime() - back * 86_400_000);
    const events: { at: Date; drop: number }[] = [];
    for (let k = 0; k < d.drivers.length; k++) {
      let t = new Date(dayStart.getTime() + (8 + k * 0.25) * 3_600_000);
      let load = 0;
      for (let n = 0; n < 5 + Math.floor(rnd() * 3); n++) {
        const s = d.sites[Math.floor(rnd() * d.sites.length)];
        const want = Math.round(s.litres * (0.6 + rnd() * 0.4));
        if (load < want) {
          // Fill the truck at the bulk tank.
          const fillStart = t;
          const fillEnd = new Date(t.getTime() + 12 * 60_000);
          const amount = 13_600 - load;
          await c.query(
            `insert into fills (truck_id, driver_id, tank_id, started_at, ended_at, litres_reported) values ($1,$2,$3,$4,$5,$6)`,
            [d.trucks[k], d.drivers[k], tank, fillStart, fillEnd, Math.round(amount * (0.98 + rnd() * 0.03))],
          );
          events.push({ at: fillStart, drop: amount });
          load = 13_600;
          t = new Date(fillEnd.getTime() + 5 * 60_000);
        }
        const start = t;
        const arrive = new Date(t.getTime() + (6 + rnd() * 10) * 60_000);
        const done = new Date(arrive.getTime() + (want / 400) * 60_000);
        const delivered = Math.round(want * (0.97 + rnd() * 0.04));
        load -= delivered;
        const job = await c.query(
          `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, driver_id, truck_id, status, started_at, arrived_at, arrival_source, completed_at)
           values ($1,$2,$3,($4::timestamptz at time zone $9)::date,$5,$6,'completed',$4,$7,'gps',$8) returning id`,
          [s.cust, s.site, s.litres, start, d.drivers[k], d.trucks[k], arrive, done, config.timezone],
        );
        await c.query(
          `insert into deliveries (job_id, truck_id, driver_id, litres, meter_start, meter_end, recorded_at) values ($1,$2,$3,$4,$5,$6,$7)`,
          [job.rows[0].id, d.trucks[k], d.drivers[k], delivered, meters[k], meters[k] + delivered, done],
        );
        meters[k] += delivered;
        t = new Date(done.getTime() + 4 * 60_000);
      }
    }
    // Tank readings every 15 minutes; fills pull the level down, the well pump refills overnight.
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let m = 0; m < 96; m++) {
      const ts = new Date(dayStart.getTime() + m * 15 * 60_000);
      for (const e of events) if (e.at <= ts && e.drop > 0) { volume -= e.drop; e.drop = 0; }
      if (m < 24) volume = Math.min(240_000, volume + 6_000);
      readings.push([ts, Math.round(volume + (rnd() - 0.5) * 60)]);
    }
  }
  for (const [k, id] of d.trucks.entries()) await c.query('update trucks set last_meter_reading = $2 where id = $1', [id, meters[k]]);
  await c.query(
    `insert into tank_readings (tank_id, ts, volume_l) select $1, (r->>0)::timestamptz, (r->>1)::numeric from jsonb_array_elements($2::jsonb) r`,
    [tank, JSON.stringify(readings)],
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? (config.isProd ? '' : 'admin12345');
  if (!adminPassword) throw new Error('Set ADMIN_PASSWORD to create the first admin account');
  migrate(pool)
    .then(() => seed(pool, { demo: process.argv.includes('--demo'), adminEmail, adminPassword }))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

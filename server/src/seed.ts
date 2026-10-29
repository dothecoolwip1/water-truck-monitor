import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type pg from 'pg';
import { createPool, tx } from './db.js';
import { migrate } from './migrate.js';
import { hashKey } from './routes/admin.js';
import { config } from './config.js';

/**
 * Creates the first admin account. With --demo it also adds sample trucks,
 * drivers, customers around Fort Good Hope, a bulk tank and today's jobs, so
 * the whole flow can be tried before real data is loaded.
 */
export async function seed(pool: pg.Pool, opts: { demo: boolean; adminEmail: string; adminPassword: string }) {
  return tx(pool, async (c) => {
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
    if ((await c.query('select 1 from trucks limit 1')).rows[0]) {
      out.demo = 'skipped, data already present';
      return out;
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
       values ('Main holding tank', 'armor-001', $1, 250000, 6000, 66.2585, -128.6425)`,
      [hashKey(deviceKey)],
    );
    out.tank_device = { device_id: 'armor-001', device_key: deviceKey };

    // Spread delivery points around the community centre.
    const centre = { lat: 66.2565, lng: -128.6335 };
    const names = ['Band Office', 'Chief T\'Selehye School', 'Health Centre', 'Northern Store', 'RCMP Detachment', 'Arena',
      'Elders Centre', 'Church', 'Airport Terminal', 'Water Treatment Plant'];
    const sites = [];
    for (let i = 0; i < 30; i++) {
      const isHouse = i >= names.length;
      const cust = (await c.query('insert into customers (name, account_code) values ($1,$2) returning id', [
        isHouse ? `Residence ${100 + i}` : names[i], `FGH-${String(i + 1).padStart(3, '0')}`,
      ])).rows[0].id;
      const angle = (i / 30) * Math.PI * 2;
      const r = 0.002 + (i % 5) * 0.0012;
      const site = (await c.query(
        `insert into sites (customer_id, label, address, lat, lng, tank_capacity_l) values ($1,$2,$3,$4,$5,$6) returning id`,
        [cust, isHouse ? `House ${100 + i}` : names[i], `${100 + i} Main Street, Fort Good Hope, NT`,
          centre.lat + r * Math.sin(angle), centre.lng + r * 2.2 * Math.cos(angle), isHouse ? 4500 : 20000],
      )).rows[0].id;
      sites.push({ cust, site, litres: isHouse ? 4000 : 9000 });
    }
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
    out.demo = { drivers: ['sam@example.com', 'lee@example.com', 'jo@example.com'], driver_password: 'driver123',
      dispatcher: 'dispatch@example.com / dispatch123' };
    return out;
  });
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

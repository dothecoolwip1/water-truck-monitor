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
    out.demo = { drivers: ['sam@example.com', 'lee@example.com', 'jo@example.com'], driver_password: 'driver123',
      dispatcher: 'dispatch@example.com / dispatch123' };
    return out;
  });
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

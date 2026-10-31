import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type pg from 'pg';
import { createPool, tx } from './db.js';
import { migrate } from './migrate.js';
import { hashKey } from './routes/admin.js';
import { config } from './config.js';
import { bboxAround, downloadBuildings, storeBuildings, type Building } from './lib/osm.js';
import { afterDelivery, generateInvoices } from './lib/billing.js';
import { getSettings, updateSettings } from './lib/settings.js';

// Bump to replace an older demo data set (only demo data, never real records).
const DEMO_VERSION = 7;
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
  const meta = opts.demo ? await demoMeta(pool) : null;
  const needBuildings = meta && (meta.version !== DEMO_VERSION || (!meta.real && Date.now() - meta.triedAt > 10 * 60_000));
  if (needBuildings) {
    const box = bboxAround(DEMO_CENTRE.lat, DEMO_CENTRE.lng, 1800);
    try {
      buildings = await downloadBuildings(box);
      await storeBuildings(pool, box, buildings);
    } catch (err) {
      console.warn(`Demo: building outlines unavailable (${(err as Error).message}); using a made-up layout for now`);
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
    const m = await demoMeta(c);
    if (m.version === DEMO_VERSION) {
      // An earlier start couldn't reach OpenStreetMap: move the demo customers onto real houses now, keeping everything else.
      if (!m.real && needBuildings) {
        const moved = buildings.length >= 30 ? await relayoutDemo(c, buildings) : false;
        await setMeta(c, 'demo_real', moved);
        await setMeta(c, 'demo_buildings_tried', Date.now());
        out.demo = moved ? 'moved onto real buildings' : 'current; real buildings still unavailable';
        return out;
      }
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
    const fullness = await demoHistory(c, { drivers, trucks, sites });
    // Today's run goes to the emptiest tanks. A few low ones are left unbooked so "Running low" has work to show.
    const order = sites.map((_, i) => i).sort((a, b) => fullness[a] - fullness[b]).filter((_, n) => ![1, 4, 9].includes(n)).slice(0, 14);
    for (const [n, i] of order.entries()) {
      const s = sites[i];
      const driver = n < 12 ? drivers[n % 3] : null;
      await c.query(
        `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, driver_id, truck_id, status, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.cust, s.site, Math.round((s.cap * (1 - fullness[i])) / 100) * 100, today, driver, driver ? trucks[n % 3] : null, driver ? 'scheduled' : 'requested', Math.floor(n / 3)],
      );
    }
    await demoBusiness(c, { drivers, trucks, today });
    await demoOperations(c, { drivers, trucks, today });
    await setMeta(c, 'demo_version', DEMO_VERSION);
    await setMeta(c, 'demo_real', buildings.length >= 30);
    await setMeta(c, 'demo_buildings_tried', Date.now());
    out.demo = { drivers: ['sam@example.com', 'lee@example.com', 'jo@example.com'], driver_password: 'driver123',
      dispatcher: 'dispatch@example.com / dispatch123', real_buildings: buildings.length > 0 };
    return out;
  });
}

async function demoMeta(c: pg.Pool | pg.PoolClient) {
  const { rows } = await c.query(`select key, value from app_meta where key in ('demo_version', 'demo_real', 'demo_buildings_tried')`);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { version: Number(v.demo_version ?? 0), real: v.demo_real === true, triedAt: Number(v.demo_buildings_tried ?? 0) };
}

async function setMeta(c: pg.PoolClient, key: string, value: unknown) {
  await c.query(
    `insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
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
  await c.query(`truncate deliveries, fills, gps_points, tank_readings, shifts, jobs, files, sites, customers, trucks, source_tanks, audit_log,
    invoices, recurring_jobs, notifications, job_comments, job_followers, job_reads, job_lines,
    inspections, maintenance_log, maintenance_tasks, class_rates, outbound_messages cascade`);
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
type Spot = { name: string; label: string; address: string; lat: number; lng: number; house: boolean };

function demoSpots(buildings: Building[]): Spot[] {
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
  return spots.sort((a, b) => Number(a.house) - Number(b.house));
}

/** Moves existing demo customers onto real buildings, in place, so jobs and history stay attached. */
async function relayoutDemo(c: pg.PoolClient, buildings: Building[]): Promise<boolean> {
  const spots = demoSpots(buildings);
  const { rows } = await c.query(
    `select cu.id as customer_id, s.id as site_id from customers cu join sites s on s.customer_id = cu.id
     where cu.account_code like 'FGH-%' order by cu.account_code`,
  );
  if (rows.length !== spots.length) return false;
  for (const [i, r] of rows.entries()) {
    const sp = spots[i];
    await c.query('update customers set name = $2 where id = $1', [r.customer_id, sp.name]);
    await c.query('update sites set label = $2, address = $3, lat = $4, lng = $5 where id = $1', [r.site_id, sp.label, sp.address, sp.lat, sp.lng]);
  }
  const [lat, lng] = tankSpot(buildings);
  await c.query(`update source_tanks set lat = $1, lng = $2 where device_id = 'armor-001'`, [lat, lng]);
  return true;
}

async function demoSites(c: pg.PoolClient, buildings: Building[]) {
  const spots = demoSpots(buildings);
  const sites = [];
  for (const [i, sp] of spots.entries()) {
    const cust = (await c.query('insert into customers (name, account_code) values ($1,$2) returning id', [sp.name, `FGH-${String(i + 1).padStart(3, '0')}`])).rows[0].id;
    const site = (await c.query(
      `insert into sites (customer_id, label, address, lat, lng, tank_capacity_l) values ($1,$2,$3,$4,$5,$6) returning id`,
      [cust, sp.label, sp.address, sp.lat, sp.lng, sp.house ? 4500 : 20000],
    )).rows[0].id;
    sites.push({ cust, site, litres: sp.house ? 4000 : 9000, cap: sp.house ? 4500 : 20000 });
  }
  return sites;
}

/** Two weeks of past deliveries, truck fills and tank readings, so reports have something to show. */
async function demoHistory(
  c: pg.PoolClient,
  d: { drivers: string[]; trucks: string[]; sites: { cust: string; site: string; litres: number; cap: number }[] },
) {
  const tank = (await c.query('select id from source_tanks limit 1')).rows[0].id;
  let rand = 7;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const meters = d.trucks.map(() => 0);
  let volume = 220_000;
  const readings: [Date, number][] = [];
  const midnight = (await c.query(`select date_trunc('day', now() at time zone $1) at time zone $1 as m`, [config.timezone])).rows[0].m as Date;
  // Each place uses water at its own steady rate and is refilled when its tank drops below about a third,
  // so the running-low forecast has realistic history to learn from.
  const use = d.sites.map((s) => (s.cap > 5000 ? 1200 + rnd() * 1800 : 260 + rnd() * 380));
  const level = d.sites.map((s) => s.cap * (0.35 + rnd() * 0.6));
  for (let back = 14; back >= 1; back--) {
    const dayStart = new Date(midnight.getTime() - back * 86_400_000);
    const events: { at: Date; drop: number }[] = [];
    const due: number[] = [];
    d.sites.forEach((s, i) => {
      level[i] = Math.max(0, level[i] - use[i]);
      if (level[i] < s.cap * (0.3 + rnd() * 0.1)) due.push(i);
    });
    for (let k = 0; k < d.drivers.length; k++) {
      let t = new Date(dayStart.getTime() + (8 + k * 0.25) * 3_600_000);
      let load = 0;
      for (const i of due.filter((_, n) => n % d.drivers.length === k)) {
        const s = d.sites[i];
        const want = Math.round((s.cap - level[i]) / 50) * 50;
        level[i] = s.cap;
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
  // How full each tank will be by the end of today, as a share of its size.
  return d.sites.map((s, i) => Math.max(0, level[i] - use[i]) / s.cap);
}

/** Price book, approvals, invoices, chat, a recurring run and a resident request, so every screen has something in it. */
async function demoBusiness(c: pg.PoolClient, d: { drivers: string[]; trucks: string[]; today: string }) {
  const current = await getSettings(c);
  if (!current.company.address) {
    await updateSettings(c, {
      company: { name: 'Fort Good Hope Water Delivery', address: 'Fort Good Hope, NT X0E 0H0', phone: '(867) 598-2000', email: 'water@example.com', tax_number: '' },
      form: {
        fields: [
          { key: 'tank_condition', label: 'Tank condition', type: 'choice', options: ['Good', 'Needs cleaning', 'Damaged'] },
          { key: 'cap_locked', label: 'Fill cap closed and locked', type: 'yesno', required: true },
        ],
      },
    });
  }
  const items: [string, string, string, number, string, boolean][] = [
    ['WATER', 'Potable water', 'litre', 0.045, 'water', false],
    ['DELIVERY', 'Delivery fee', 'load', 25, 'delivery', false],
    ['AFTERHOURS', 'After-hours call-out', 'each', 85, 'other', false],
    ['TANKCLEAN', 'Tank cleaning', 'each', 150, 'other', false],
  ];
  for (const [code, name, unit, price, kind, auto] of items) {
    await c.query(
      `insert into price_items (code, name, unit, unit_price, kind, auto_add) values ($1,$2,$3,$4,$5,$6) on conflict (code) do nothing`,
      [code, name, unit, price, kind, auto],
    );
  }
  // Facilities have a negotiated water rate.
  await c.query(
    `insert into customer_rates (customer_id, price_item_id, unit_price)
     select cu.id, p.id, 0.038 from customers cu, price_items p
     where p.code = 'WATER' and cu.account_code like 'FGH-%' and cu.name not like 'Residence%' on conflict do nothing`,
  );
  // Phone numbers on file, so the resident page can be tried (account FGH-001 with phone 867-598-1001, and so on).
  await c.query(`update customers set phone = '(867) 598-1' || right(account_code, 3) where account_code like 'FGH-%' and phone is null`);

  // Price and approve history. A few recent deliveries have meter readings that don't add up and wait for review.
  const { rows: done } = await c.query(`select j.id, j.completed_at from jobs j where j.status = 'completed' order by j.completed_at`);
  const recent = done.slice(-40).filter((_, i) => i % 9 === 4).map((r) => r.id);
  if (recent.length) await c.query('update deliveries set meter_end = meter_end + 320 where job_id = any($1::uuid[])', [recent]);
  for (const j of done) await afterDelivery(c, j.id);

  // Bill the first week; mark some sent and paid.
  const weekStart = (await c.query(`select ($1::date - 14)::text as a, ($1::date - 8)::text as b`, [d.today])).rows[0];
  const admin = (await c.query(`select id from users where role = 'admin' order by created_at limit 1`)).rows[0]?.id ?? d.drivers[0];
  const ids = await generateInvoices(c, { from: weekStart.a, to: weekStart.b, userId: admin });
  for (const [i, id] of ids.entries()) {
    if (i % 3 === 0) await c.query(`update invoices set status = 'paid', sent_at = now() - interval '6 days', paid_at = now() - interval '2 days' where id = $1`, [id]);
    else if (i % 3 === 1) await c.query(`update invoices set status = 'sent', sent_at = now() - interval '6 days' where id = $1`, [id]);
  }

  // A resident asked online this morning; it's waiting in Requests.
  const req = (await c.query(`select j.id, s.label from jobs j join sites s on s.id = j.site_id where j.scheduled_date = $1 and j.driver_id is null order by j.number limit 1`, [d.today])).rows[0];
  if (req) {
    await c.query(
      `update jobs set source = 'portal', requester_name = 'Mary', requester_phone = '(867) 598-1016', priority = 2, notes = 'Tank ran dry overnight',
         track_token = $2 where id = $1`,
      [req.id, crypto.randomBytes(12).toString('base64url')],
    );
    await c.query(
      `insert into notifications (user_id, kind, title, body, job_id) select u.id, 'request', $2, 'Mary asked for a fill (online request)', $1
       from users u where u.role in ('admin', 'dispatcher')`,
      [req.id, `Out of water: ${req.label}`],
    );
  }

  // A short conversation on one of today's jobs.
  const dispatcher = (await c.query(`select id from users where email = 'dispatch@example.com'`)).rows[0].id;
  const chatJob = (await c.query(`select id, driver_id from jobs where scheduled_date = $1 and driver_id is not null order by sort_order, number limit 1`, [d.today])).rows[0];
  if (chatJob) {
    const base = Date.now() - 50 * 60_000;
    const msgs: [string, string][] = [
      [dispatcher, 'Dog in the yard here. Use the side gate and the fill pipe is behind the shed.'],
      [chatJob.driver_id, 'Got it, I\'ll go there first.'],
      [dispatcher, 'Thanks! They also asked for a receipt left in the mailbox.'],
    ];
    for (const [k, [author, body]] of msgs.entries()) {
      await c.query('insert into job_comments (job_id, author_id, body, created_at) values ($1,$2,$3,$4)', [chatJob.id, author, body, new Date(base + k * 6 * 60_000)]);
    }
    await c.query('insert into job_followers (job_id, user_id) values ($1,$2),($1,$3) on conflict do nothing', [chatJob.id, dispatcher, chatJob.driver_id]);
    await c.query('insert into job_reads (job_id, user_id, read_at) values ($1,$2,now()),($1,$3,now()) on conflict do nothing', [chatJob.id, dispatcher, chatJob.driver_id]);
  }

  // Facilities on a standing run: Monday and Thursday.
  const fac = (await c.query(
    `select cu.id as customer_id, s.id as site_id from customers cu join sites s on s.customer_id = cu.id
     where cu.account_code like 'FGH-%' and cu.name not like 'Residence%' order by cu.account_code limit 2`,
  )).rows;
  for (const [i, f] of fac.entries()) {
    await c.query(
      `insert into recurring_jobs (customer_id, site_id, requested_litres, weekdays, start_date, driver_id, truck_id, notes, created_by)
       values ($1,$2,9000,'{1,4}',$3,$4,$5,'Standing order',$6)`,
      [f.customer_id, f.site_id, d.today, d.drivers[i % d.drivers.length], d.trucks[i % d.trucks.length], admin],
    );
  }
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

/** Customer classes, alert opt-ins, critical sites, and a fleet with inspections and maintenance history. */
async function demoOperations(c: pg.PoolClient, d: { drivers: string[]; trucks: string[]; today: string }) {
  // Classes: facilities are institutional or commercial; a share of houses are public housing.
  await c.query(`update customers set customer_class = case when name ilike any(array['%store%', '%hotel%', '%co-op%', '%motel%', '%gas%']) then 'commercial' else 'institutional' end
    where account_code like 'FGH-%' and name not like 'Residence%'`);
  await c.query(`update customers set customer_class = 'public_housing' where account_code like 'FGH-%' and name like 'Residence%'
    and right(account_code, 1) in ('2', '5', '8')`);
  await c.query(`update sites s set critical = true from customers cu where cu.id = s.customer_id and cu.account_code like 'FGH-%' and (cu.name ilike '%health%' or cu.name ilike '%elder%' or cu.name ilike '%nursing%')`);
  // Email alerts only, to reserved example.com addresses. Demo phones stay opted out so no real number is ever texted.
  await c.query(`update customers set email = lower(replace(account_code, '-', '')) || '@example.com', notify_email = true
    where account_code like 'FGH-%' and name like 'Residence%' and right(account_code, 1) in ('1', '4', '7')`);
  await c.query(
    `insert into class_rates (customer_class, price_item_id, unit_price) select 'public_housing', id, 0.040 from price_items where code = 'WATER'
     on conflict do nothing`,
  );
  const tank = (await c.query('select lat, lng from source_tanks order by name limit 1')).rows[0];
  await updateSettings(c, {
    alerts: { sms: false, email: true, on_scheduled: true, on_en_route: true, on_completed: true },
    depot: { lat: tank?.lat ?? null, lng: tank?.lng ?? null, label: 'Water plant' },
  });

  // Trucks, their meters and a maintenance schedule. Truck 2 is overdue for an oil change; Truck 1 needs its tank sanitized soon.
  const fleet = [
    { odo: 84_210, hrs: 3_120, oilKm: 79_000, oilHrs: 2_950, sanitized: 26, cvip: 140, pumpHrs: 2_900 },
    { odo: 120_480, hrs: 4_580, oilKm: 111_900, oilHrs: 4_300, sanitized: 9, cvip: 352, pumpHrs: 4_420 },
    { odo: 45_230, hrs: 1_610, oilKm: 41_100, oilHrs: 1_480, sanitized: 14, cvip: 60, pumpHrs: 1_300 },
  ];
  const ago = (days: number) => `($1::date - ${days})`;
  const admin = (await c.query(`select id from users where role = 'admin' order by created_at limit 1`)).rows[0]?.id ?? null;
  for (const [i, truck] of d.trucks.entries()) {
    const f = fleet[i];
    await c.query('update trucks set odometer_km = $2, engine_hours = $3 where id = $1', [truck, f.odo, f.hrs]);
    const tasks: [string, number | null, number | null, number | null, number, number | null, number | null][] = [
      ['Engine oil and filter', 8000, 250, null, 40, f.oilKm, f.oilHrs],
      ['Tank sanitizing', null, null, 30, f.sanitized, null, null],
      ['CVIP safety inspection', null, null, 365, f.cvip, null, null],
      ['Pump and meter service', null, 500, null, 60, null, f.pumpHrs],
    ];
    for (const [name, km, hrs, days, doneAgo, doneKm, doneHrs] of tasks) {
      const t = (await c.query(
        `insert into maintenance_tasks (truck_id, name, every_km, every_hours, every_days, last_done_at, last_done_km, last_done_hours)
         values ($2,$3,$4,$5,$6,${ago(doneAgo)},$7,$8) returning id`,
        [d.today, truck, name, km, hrs, days, doneKm, doneHrs],
      )).rows[0].id;
      await c.query(
        `insert into maintenance_log (truck_id, task_id, title, done_at, odometer_km, engine_hours, cost, created_by) values ($2,$3,$4,${ago(doneAgo)},$5,$6,$7,$8)`,
        [d.today, truck, t, name, doneKm, doneHrs, name.startsWith('Engine') ? 285 : name.startsWith('Tank') ? 120 : name.startsWith('CVIP') ? 450 : 210, admin],
      );
    }
  }

  // Two weeks of daily pre-trip inspections. Truck 3 had a light out four days ago, fixed the same day.
  const items = (await getSettings(c)).inspection.items;
  const midnight = (await c.query(`select date_trunc('day', now() at time zone $1) at time zone $1 as m`, [config.timezone])).rows[0].m as Date;
  for (let back = 14; back >= 0; back--) {
    for (const [i, truck] of d.trucks.entries()) {
      if (back === 0 && i > 0) continue; // Only Truck 1 has been inspected so far today.
      const at = new Date(midnight.getTime() - back * 86_400_000 + (7.5 + i * 0.2) * 3_600_000);
      const defect = i === 2 && back === 4 ? 'Lights and signals' : null;
      const list = items.map((label) => ({ label, ok: label !== defect, note: label === defect ? 'Rear marker light out' : null }));
      const f = fleet[i];
      await c.query(
        `insert into inspections (client_id, truck_id, driver_id, at, odometer_km, engine_hours, items, defects, safe) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [`demo-${i}-${back}`, truck, d.drivers[i], at, f.odo - back * 38, f.hrs - back * 6, JSON.stringify(list), defect ? 1 : 0, !defect],
      );
      if (defect) {
        await c.query(
          `insert into maintenance_log (truck_id, title, done_at, odometer_km, cost, notes, created_by) values ($2, 'Replaced rear marker light', ${ago(back)}, $3, 18, 'Found on pre-trip inspection', $4)`,
          [d.today, truck, f.odo - back * 38, admin],
        );
      }
    }
  }
}

import type pg from 'pg';
import { config } from '../config.js';
import { findDrawdowns, litresDrawnBetween, type TimedVolume } from './tank.js';

export interface DayRow {
  day: string;
  jobs_completed: number;
  delivered_l: number;
  tank_drawn_l: number | null;
  fills_loaded_l: number | null;
  fills_reported_l: number;
  // Drawn from the tank but not recorded as delivered. Water left in a truck
  // overnight shows up here, so a small gap either way is normal.
  unaccounted_l: number | null;
  unaccounted_pct: number | null;
  by_truck: { truck_id: string | null; truck_name: string | null; delivered_l: number; jobs: number }[];
}

/** Bounds of a local calendar range as UTC instants, so day totals match the office clock. */
async function rangeBounds(db: pg.Pool, from: string, to: string) {
  const { rows } = await db.query(
    `select ($1::date)::timestamp at time zone $3 as start, ($2::date + 1)::timestamp at time zone $3 as end`,
    [from, to, config.timezone],
  );
  return { start: rows[0].start as Date, end: rows[0].end as Date };
}

function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function fillsWithTankVolumes(db: pg.Pool, from: string, to: string) {
  const { start, end } = await rangeBounds(db, from, to);
  const fills = await db.query(
    `select f.id, f.started_at, f.ended_at, f.litres_reported, f.tank_id, f.truck_id, t.name as truck_name,
            u.name as driver_name, st.name as tank_name
     from fills f join trucks t on t.id = f.truck_id join users u on u.id = f.driver_id
     left join source_tanks st on st.id = f.tank_id
     where f.started_at >= $1 and f.started_at < $2 order by f.started_at`,
    [start, end],
  );
  const readingsByTank = new Map<string, TimedVolume[]>();
  for (const f of fills.rows) {
    if (!f.tank_id || readingsByTank.has(f.tank_id)) continue;
    const r = await db.query(
      `select ts, volume_l from tank_readings where tank_id = $1 and ts >= $2::timestamptz - interval '1 hour'
         and ts < $3::timestamptz + interval '1 hour' order by ts`,
      [f.tank_id, start, end],
    );
    readingsByTank.set(f.tank_id, r.rows);
  }
  return fills.rows.map((f) => ({
    ...f,
    litres_from_tank: f.tank_id ? litresDrawnBetween(readingsByTank.get(f.tank_id) ?? [], f.started_at, f.ended_at) : null,
  }));
}

export async function dailyReport(db: pg.Pool, from: string, to: string): Promise<DayRow[]> {
  const { start, end } = await rangeBounds(db, from, to);
  const tz = config.timezone;

  const deliveries = await db.query(
    `select (d.recorded_at at time zone $3)::date::text as day, d.truck_id, t.name as truck_name,
            sum(d.litres)::float8 as litres, count(*)::int as jobs
     from deliveries d left join trucks t on t.id = d.truck_id
     where d.recorded_at >= $1 and d.recorded_at < $2
     group by 1, 2, 3 order by 1, 3`,
    [start, end, tz],
  );

  const tanks = await db.query('select id, noise_l from source_tanks');
  const drawnByDay = new Map<string, number>();
  for (const tank of tanks.rows) {
    const r = await db.query('select ts, volume_l from tank_readings where tank_id = $1 and ts >= $2 and ts < $3 order by ts', [
      tank.id, start, end,
    ]);
    for (const dd of findDrawdowns(r.rows, tank.noise_l)) {
      const day = localDay(dd.start);
      drawnByDay.set(day, (drawnByDay.get(day) ?? 0) + dd.litres);
    }
  }
  const hasTankData = tanks.rows.length > 0;

  const fills = await fillsWithTankVolumes(db, from, to);
  const fillsByDay = new Map<string, { loaded: number; matched: number; reported: number }>();
  for (const f of fills) {
    const day = localDay(f.started_at);
    const agg = fillsByDay.get(day) ?? { loaded: 0, matched: 0, reported: 0 };
    if (f.litres_from_tank !== null) {
      agg.loaded += f.litres_from_tank;
      agg.matched++;
    }
    agg.reported += f.litres_reported ?? 0;
    fillsByDay.set(day, agg);
  }

  const days: DayRow[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); localIso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = localIso(d);
    const rows = deliveries.rows.filter((r) => r.day === day);
    const delivered = round1(rows.reduce((s, r) => s + r.litres, 0));
    const drawn = hasTankData ? round1(drawnByDay.get(day) ?? 0) : null;
    const fill = fillsByDay.get(day);
    const unaccounted = drawn === null ? null : round1(drawn - delivered);
    days.push({
      day,
      jobs_completed: rows.reduce((s, r) => s + r.jobs, 0),
      delivered_l: delivered,
      tank_drawn_l: drawn,
      fills_loaded_l: fill && fill.matched > 0 ? round1(fill.loaded) : null,
      fills_reported_l: round1(fill?.reported ?? 0),
      unaccounted_l: unaccounted,
      unaccounted_pct: drawn ? round1((unaccounted! / drawn) * 100) : null,
      by_truck: rows.map((r) => ({ truck_id: r.truck_id, truck_name: r.truck_name, delivered_l: round1(r.litres), jobs: r.jobs })),
    });
  }
  return days;
}

export async function deliveriesForExport(db: pg.Pool, from: string, to: string) {
  const { start, end } = await rangeBounds(db, from, to);
  const { rows } = await db.query(
    `select j.number, to_char(d.recorded_at at time zone $3, 'YYYY-MM-DD HH24:MI') as delivered_local, c.account_code, c.name as customer, s.label as site,
            s.address, d.litres, d.meter_start, d.meter_end, t.name as truck, u.name as driver, d.recipient_name,
            j.requested_litres, d.notes, j.id as job_id
     from deliveries d join jobs j on j.id = d.job_id join customers c on c.id = j.customer_id
     join sites s on s.id = j.site_id left join trucks t on t.id = d.truck_id left join users u on u.id = d.driver_id
     where d.recorded_at >= $1 and d.recorded_at < $2 order by d.recorded_at`,
    [start, end, config.timezone],
  );
  return rows;
}

export async function customerTotals(db: pg.Pool, from: string, to: string) {
  const { start, end } = await rangeBounds(db, from, to);
  const { rows } = await db.query(
    `select c.id, c.name, c.account_code, count(*)::int as deliveries, sum(d.litres)::float8 as litres
     from deliveries d join jobs j on j.id = d.job_id join customers c on c.id = j.customer_id
     where d.recorded_at >= $1 and d.recorded_at < $2 group by c.id order by litres desc`,
    [start, end],
  );
  return rows;
}

function localIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

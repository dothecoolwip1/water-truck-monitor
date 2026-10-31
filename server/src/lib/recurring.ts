import type pg from 'pg';
import type { Db } from '../db.js';
import { addDays, localToday } from './dates.js';

/** The dates a schedule falls on between from and to, inclusive. */
export function scheduleDates(s: { start_date: string; end_date: string | null; every_days: number; weekdays: number[] | null }, from: string, to: string): string[] {
  const out: string[] = [];
  const start = from > s.start_date ? from : s.start_date;
  const end = s.end_date && s.end_date < to ? s.end_date : to;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (s.weekdays && s.weekdays.length) {
      if (s.weekdays.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d);
    } else {
      const n = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${s.start_date}T12:00:00Z`)) / 86_400_000);
      if (n % s.every_days === 0) out.push(d);
    }
  }
  return out;
}

/** Creates the jobs recurring schedules owe up to `through`. Safe to call often: each date is created once. */
export async function generateRecurring(db: Db | pg.Pool, through: string, today: string): Promise<number> {
  const { rows } = await db.query(
    `select * from recurring_jobs where active and start_date <= $1 and (end_date is null or end_date >= $2)
       and (generated_through is null or generated_through < $1)`,
    [through, today],
  );
  let made = 0;
  for (const s of rows) {
    const from = s.generated_through && s.generated_through >= today ? addDays(s.generated_through, 1) : today;
    for (const d of scheduleDates(s, from, through)) {
      const r = await db.query(
        `insert into jobs (customer_id, site_id, requested_litres, scheduled_date, driver_id, truck_id, notes, tags, status, source, recurring_id, created_by, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8, case when $5::uuid is null then 'requested'::job_status else 'scheduled'::job_status end, 'recurring', $9, $10,
           coalesce((select max(sort_order) + 1 from jobs where scheduled_date = $4 and driver_id is not distinct from $5), 0))
         on conflict (recurring_id, scheduled_date) where recurring_id is not null do nothing returning id`,
        [s.customer_id, s.site_id, s.requested_litres, d, s.driver_id, s.truck_id, s.notes, s.tags, s.id, s.created_by],
      );
      made += r.rowCount ?? 0;
    }
    await db.query('update recurring_jobs set generated_through = greatest(coalesce(generated_through, $2), $2) where id = $1', [s.id, through]);
  }
  return made;
}

/** Fills in recurring jobs up to the day being looked at (capped a month ahead). */
export async function ensureRecurring(db: Db | pg.Pool, through: string | undefined, timezone: string): Promise<void> {
  const today = localToday(timezone);
  const cap = addDays(today, 31);
  const upTo = !through || through < today ? today : through > cap ? cap : through;
  await generateRecurring(db, upTo, today);
}

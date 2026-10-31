import type { Db } from '../db.js';

export interface SiteForecast {
  site_id: string;
  site_label: string;
  site_address: string | null;
  customer_id: string;
  customer_name: string;
  critical: boolean;
  tank_capacity_l: number | null;
  deliveries: number;
  last_delivery_at: string | null;
  litres_per_day: number | null;
  level_l: number | null;
  level_pct: number | null;
  days_left: number | null;
  empty_on: string | null;
  state: 'empty' | 'low' | 'ok' | 'unknown';
  open_job: { id: string; number: number; status: string; scheduled_date: string | null } | null;
}

/**
 * Estimate how much water each house has left from its own delivery history.
 * Each delivery is taken to refill what was used since the one before, so the litres delivered
 * after the first, over the days they span, give a daily use rate. The tank is taken to be full
 * after the last delivery, and to drain at that rate since.
 */
export function estimate(
  deliveries: { litres: number; at: Date }[],
  capacity: number | null,
  now = new Date(),
): Pick<SiteForecast, 'litres_per_day' | 'level_l' | 'level_pct' | 'days_left' | 'empty_on'> {
  const none = { litres_per_day: null, level_l: null, level_pct: null, days_left: null, empty_on: null };
  const d = [...deliveries].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (d.length < 2) return none;
  const spanDays = (d[d.length - 1].at.getTime() - d[0].at.getTime()) / 86_400_000;
  if (spanDays < 1) return none;
  const used = d.slice(1).reduce((s, x) => s + x.litres, 0);
  const rate = used / spanDays;
  if (!(rate > 0)) return none;
  const cap = capacity && capacity > 0 ? capacity : Math.max(...d.map((x) => x.litres));
  const since = (now.getTime() - d[d.length - 1].at.getTime()) / 86_400_000;
  const level = Math.max(0, cap - rate * since);
  const daysLeft = level / rate;
  return {
    litres_per_day: Math.round(rate),
    level_l: Math.round(level),
    level_pct: Math.round((level / cap) * 100),
    days_left: Math.round(daysLeft * 10) / 10,
    empty_on: new Date(now.getTime() + daysLeft * 86_400_000).toISOString().slice(0, 10),
  };
}

export async function forecastSites(db: Db, warnDays: number, now = new Date()): Promise<SiteForecast[]> {
  const { rows } = await db.query(
    `select s.id as site_id, s.label as site_label, s.address as site_address, s.customer_id, c.name as customer_name, s.critical, s.tank_capacity_l,
            coalesce((select json_agg(json_build_object('litres', x.litres, 'at', x.completed_at) order by x.completed_at)
                      from (select d.litres, j.completed_at from jobs j join deliveries d on d.job_id = j.id
                            where j.site_id = s.id and j.status = 'completed' and d.litres > 0
                            order by j.completed_at desc limit 12) x), '[]') as history,
            (select json_build_object('id', j.id, 'number', j.number, 'status', j.status, 'scheduled_date', j.scheduled_date)
               from jobs j where j.site_id = s.id and j.status in ('requested', 'scheduled', 'en_route', 'arrived')
               order by j.created_at desc limit 1) as open_job
     from sites s join customers c on c.id = s.customer_id
     where s.active and c.active`,
  );
  const out = rows.map((r): SiteForecast => {
    const hist = (r.history as { litres: number; at: string }[]).map((h) => ({ litres: Number(h.litres), at: new Date(h.at) }));
    const e = estimate(hist, r.tank_capacity_l, now);
    const state: SiteForecast['state'] = e.days_left === null ? 'unknown' : e.days_left <= 0.05 ? 'empty' : e.days_left <= warnDays ? 'low' : 'ok';
    return {
      site_id: r.site_id, site_label: r.site_label, site_address: r.site_address, customer_id: r.customer_id, customer_name: r.customer_name,
      critical: r.critical, tank_capacity_l: r.tank_capacity_l, deliveries: hist.length,
      last_delivery_at: hist.length ? hist[hist.length - 1].at.toISOString() : null, ...e, state, open_job: r.open_job,
    };
  });
  // Most urgent first; critical places break ties; unknowns last.
  return out.sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || Number(b.critical) - Number(a.critical) || a.site_label.localeCompare(b.site_label));
}

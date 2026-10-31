import type { Db } from '../db.js';

export type DueState = 'overdue' | 'due_soon' | 'ok' | 'unknown';

export interface TaskDue {
  state: DueState;
  /** Plain words for the most pressing limit, e.g. "1,200 km left" or "3 days overdue". */
  label: string;
  next_km: number | null;
  next_hours: number | null;
  next_date: string | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-CA');

/** When a maintenance task is next due, by distance, engine hours or days, whichever comes first. */
export function taskDue(
  t: { every_km: number | null; every_hours: number | null; every_days: number | null; last_done_at: string | Date | null; last_done_km: number | string | null; last_done_hours: number | string | null },
  truck: { odometer_km: number | string | null; engine_hours: number | string | null },
  today = new Date(),
): TaskDue {
  const out: TaskDue = { state: 'unknown', label: 'Not done yet', next_km: null, next_hours: null, next_date: null };
  const checks: { left: number; soon: number; label: (l: number) => string }[] = [];
  const odo = truck.odometer_km == null ? null : Number(truck.odometer_km);
  const hrs = truck.engine_hours == null ? null : Number(truck.engine_hours);
  if (t.every_km && t.last_done_km != null) {
    out.next_km = Number(t.last_done_km) + t.every_km;
    if (odo != null) checks.push({ left: out.next_km - odo, soon: Math.max(250, t.every_km * 0.1), label: (l) => (l < 0 ? `${fmt(-l)} km overdue` : `${fmt(l)} km left`) });
  }
  if (t.every_hours && t.last_done_hours != null) {
    out.next_hours = Number(t.last_done_hours) + t.every_hours;
    if (hrs != null) checks.push({ left: out.next_hours - hrs, soon: Math.max(10, t.every_hours * 0.1), label: (l) => (l < 0 ? `${fmt(-l)} engine hours overdue` : `${fmt(l)} engine hours left`) });
  }
  if (t.every_days && t.last_done_at) {
    const last = new Date(t.last_done_at);
    const next = new Date(last.getTime() + t.every_days * 86_400_000);
    out.next_date = next.toISOString().slice(0, 10);
    // Whole calendar days between today and the due date.
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const left = Math.round((Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()) - todayUtc) / 86_400_000);
    checks.push({ left, soon: Math.max(7, Math.round(t.every_days * 0.1)), label: (l) => (l < 0 ? `${-l} day${l === -1 ? '' : 's'} overdue` : l === 0 ? 'Due today' : `${l} day${l === 1 ? '' : 's'} left`) });
  }
  if (!checks.length) return out;
  // The limit closest to (or furthest past) its due point decides.
  const worst = checks.reduce((a, b) => (b.left / b.soon < a.left / a.soon ? b : a));
  out.state = worst.left < 0 ? 'overdue' : worst.left <= worst.soon ? 'due_soon' : 'ok';
  out.label = worst.label(worst.left);
  return out;
}

export async function fleetStatus(db: Db) {
  const [{ rows: trucks }, { rows: tasks }, { rows: insp }] = await Promise.all([
    db.query(`select id, name, plate, capacity_l, odometer_km, engine_hours, out_of_service, out_of_service_reason, active from trucks order by name`),
    db.query(`select * from maintenance_tasks where active order by name`),
    db.query(
      `select distinct on (i.truck_id) i.*, u.name as driver_name from inspections i left join users u on u.id = i.driver_id
       order by i.truck_id, i.at desc`,
    ),
  ]);
  return trucks.map((t) => {
    const own = tasks.filter((x) => x.truck_id === t.id).map((x) => ({ ...x, due: taskDue(x, t) }));
    return {
      ...t,
      last_inspection: insp.find((i) => i.truck_id === t.id) ?? null,
      tasks: own,
      overdue: own.filter((x) => x.due.state === 'overdue').length,
      due_soon: own.filter((x) => x.due.state === 'due_soon').length,
    };
  });
}

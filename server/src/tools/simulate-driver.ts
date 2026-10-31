/**
 * Plays a driver's day against a running server, for demos and testing
 * without a phone: goes on duty, then drives to each of today's jobs in
 * turn, arrives (by GPS geofence), records the delivery and moves on.
 * Watch it on the dispatch board.
 *
 *   SERVER=http://localhost:3000 EMAIL=sam@example.com PASSWORD=driver123 npm run simulate-driver
 */
import crypto from 'node:crypto';

const server = process.env.SERVER ?? 'http://localhost:3000';
const email = process.env.EMAIL ?? 'sam@example.com';
const password = process.env.PASSWORD ?? 'driver123';
const stepMs = Number(process.env.STEP_MS ?? 1500);
const maxJobs = Number(process.env.JOBS ?? 3);

let token = '';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${server}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const id = () => crypto.randomUUID();

async function sync(ops: Record<string, unknown>[]) {
  const r = await call<{ results: { ok: boolean; error?: string }[] }>('POST', '/driver/sync', { ops });
  for (const x of r.results) if (!x.ok) console.warn('  rejected:', x.error);
}

async function main() {
  token = (await call<{ token: string }>('POST', '/auth/login', { email, password })).token;
  let today = await call<any>('GET', '/driver/today');
  console.log(`${email}: ${today.jobs.length} jobs today`);

  if (!today.shift) {
    const truck = today.trucks[0];
    await sync([{ type: 'shift_start', client_id: id(), at: new Date().toISOString(), truck_id: truck.id, start_meter: truck.last_meter_reading ?? 0 }]);
    console.log(`on duty in ${truck.name}`);
    today = await call<any>('GET', '/driver/today');
  }
  let meter = today.trucks.find((t: any) => t.id === today.shift.truck_id)?.last_meter_reading ?? 0;
  const tank = today.tanks[0];
  let pos = { lat: tank?.lat ?? 66.2585, lng: tank?.lng ?? -128.6425 };

  const todo = today.jobs.filter((j: any) => ['scheduled', 'en_route', 'arrived'].includes(j.status) && j.site_lat != null).slice(0, maxJobs);
  for (const job of todo) {
    console.log(`job #${job.number} ${job.site_label}`);
    if (job.status === 'scheduled') await sync([{ type: 'job_start', client_id: id(), at: new Date().toISOString(), job_id: job.id }]);
    // Drive there in a straight line, reporting position as we go.
    const steps = 12;
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      pos = { lat: from.lat + ((job.site_lat - from.lat) * i) / steps, lng: from.lng + ((job.site_lng - from.lng) * i) / steps };
      await sync([{ type: 'gps', client_id: id(), points: [{ ts: new Date().toISOString(), lat: pos.lat, lng: pos.lng, accuracy_m: 8, speed_mps: 9 }] }]);
      await sleep(stepMs);
    }
    const litres = Math.round((job.requested_litres ?? 4000) * (0.95 + Math.random() * 0.05));
    await sleep(stepMs * 2);
    await sync([{
      type: 'job_complete', client_id: id(), at: new Date().toISOString(), job_id: job.id, litres,
      meter_start: meter, meter_end: meter + litres, recipient_name: 'Simulated', lat: pos.lat, lng: pos.lng,
    }]);
    meter += litres;
    console.log(`  delivered ${litres} L`);
  }
  console.log('done; the shift is left open so the truck stays on the map');
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

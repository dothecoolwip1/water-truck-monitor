/**
 * Pretends to be the bulk tank's level sensor, for testing without hardware.
 * Posts a reading every few seconds; a truck fill drops the level by ~13,600 L
 * over a few minutes, and the tank slowly refills between fills.
 *
 *   SERVER=http://localhost:3000 DEVICE_ID=armor-001 DEVICE_KEY=... npm run simulate-tank
 */
const server = process.env.SERVER ?? 'http://localhost:3000';
const deviceId = process.env.DEVICE_ID ?? 'armor-001';
const deviceKey = process.env.DEVICE_KEY;
const intervalMs = Number(process.env.INTERVAL_MS ?? 5000);
if (!deviceKey) throw new Error('Set DEVICE_KEY to the key shown when the tank was added');

let volume = Number(process.env.START_L ?? 200_000);
let filling = 0;

async function tick() {
  if (filling > 0) {
    const step = Math.min(filling, 1100);
    volume -= step;
    filling -= step;
  } else {
    volume = Math.min(250_000, volume + 150);
    if (Math.random() < 0.04) filling = 13_600;
  }
  const res = await fetch(`${server}/api/ingest/tank-readings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId, 'x-device-key': deviceKey! },
    body: JSON.stringify({ ts: new Date().toISOString(), volume_l: Math.round(volume) }),
  });
  console.log(new Date().toISOString(), Math.round(volume), filling > 0 ? 'filling' : '', res.status);
}

setInterval(() => tick().catch((e) => console.error(e.message)), intervalMs);

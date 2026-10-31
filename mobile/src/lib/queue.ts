import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { api, ApiError, hasToken } from './api';
import { db } from './db';
import type { GpsPoint, Op, PhotoRef, Problem } from './types';

/**
 * Everything the driver does is saved on the phone first and sent to the
 * server when there is signal. Each action carries a unique id, so sending
 * it twice (after a dropped connection) is harmless.
 */

// Some hosts cap request bodies at 4.5 MB.
const MAX_BATCH_BYTES = 3_500_000;

let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

const MAX_GPS = 20_000;
const MAX_PROBLEMS = 50;

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((l) => l());

export const newId = () => Crypto.randomUUID();

/** Op without its id; the id is assigned here. */
type NewOp = Op extends infer O ? (O extends Op ? Omit<O, 'client_id'> : never) : never;

export async function enqueue(op: NewOp): Promise<Op> {
  const full = { ...op, client_id: newId() } as Op;
  await withLock(async () => {
    await (await db()).runAsync('insert or ignore into ops (client_id, body) values (?, ?)', full.client_id, JSON.stringify(full));
  });
  notify();
  void flush();
  return full;
}

/** Called from the background location task, so it must not depend on React. */
export async function addGpsPoints(points: GpsPoint[]): Promise<void> {
  if (points.length === 0) return;
  await withLock(async () => {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (t) => {
      for (const p of points) await t.runAsync('insert into gps (body) values (?)', JSON.stringify(p));
      // Keep at most ~3 days of points if the phone never gets signal.
      await t.runAsync('delete from gps where seq <= (select max(seq) from gps) - ?', MAX_GPS);
    });
  });
}

export async function pending(): Promise<Op[]> {
  const rows = await (await db()).getAllAsync<{ body: string }>('select body from ops order by seq');
  return rows.map((r) => JSON.parse(r.body) as Op);
}

export async function pendingGpsCount(): Promise<number> {
  return (await (await db()).getFirstAsync<{ n: number }>('select count(*) as n from gps'))?.n ?? 0;
}

export async function problems(): Promise<Problem[]> {
  const rows = await (await db()).getAllAsync<{ body: string }>('select body from problems order by seq');
  return rows.map((r) => JSON.parse(r.body) as Problem);
}

export async function clearProblems(): Promise<void> {
  await (await db()).runAsync('delete from problems');
  notify();
}

export interface FlushResult {
  sent: number;
  offline: boolean;
  remaining: number;
}

let flushing: Promise<FlushResult> | null = null;
let lastOnline: Date | null = null;
export const lastSyncedAt = () => lastOnline;

export function flush(): Promise<FlushResult> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
      notify();
    });
  }
  return flushing;
}

async function photoPayload(p: PhotoRef | null | undefined) {
  if (!p) return null;
  const f = new File(p.uri);
  if (!f.exists) return null;
  return { mime: p.mime, data_base64: await f.base64() };
}

async function toWire(op: Op): Promise<Record<string, unknown>> {
  if (op.type !== 'job_complete') return op;
  return { ...op, meter_photo: await photoPayload(op.meter_photo), signature: await photoPayload(op.signature) };
}

function deletePhotos(op: Op) {
  if (op.type !== 'job_complete') return;
  for (const p of [op.meter_photo, op.signature]) {
    if (!p) continue;
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

async function doFlush(): Promise<FlushResult> {
  if (!hasToken()) return { sent: 0, offline: false, remaining: (await pending()).length };

  // Fold buffered GPS points into the queue as batches.
  await withLock(async () => {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (t) => {
      const rows = await t.getAllAsync<{ seq: number; body: string }>('select seq, body from gps order by seq');
      if (rows.length === 0) return;
      const buf = rows.map((r) => JSON.parse(r.body) as GpsPoint);
      for (let i = 0; i < buf.length; i += 1000) {
        const op: Op = { type: 'gps', client_id: newId(), points: buf.slice(i, i + 1000) };
        await t.runAsync('insert into ops (client_id, body) values (?, ?)', op.client_id, JSON.stringify(op));
      }
      await t.runAsync('delete from gps where seq <= ?', rows[rows.length - 1].seq);
    });
  });

  let sent = 0;
  for (;;) {
    const q = await pending();
    if (q.length === 0) return { sent, offline: false, remaining: 0 };

    const batch: Op[] = [];
    const wire: Record<string, unknown>[] = [];
    let bytes = 0;
    for (const op of q.slice(0, 50)) {
      const w = await toWire(op);
      const size = JSON.stringify(w).length;
      if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
      batch.push(op);
      wire.push(w);
      bytes += size;
    }

    let results: { client_id: string; ok: boolean; error?: string; permanent?: boolean }[];
    try {
      results = (await api<{ results: typeof results }>('POST', '/driver/sync', { ops: wire }, 60_000)).results;
    } catch (e) {
      const offline = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
      return { sent, offline, remaining: q.length };
    }
    lastOnline = new Date();

    const done = new Set<string>();
    const newProblems: Problem[] = [];
    for (const r of results) {
      if (r.ok || r.permanent) done.add(r.client_id);
      if (!r.ok && r.permanent) {
        const op = batch.find((o) => o.client_id === r.client_id);
        if (op) {
          newProblems.push({
            client_id: r.client_id, type: op.type, error: r.error ?? 'Rejected by the server', at: new Date().toISOString(),
            job_id: 'job_id' in op ? op.job_id : undefined,
          });
        }
      }
    }
    await withLock(async () => {
      const d = await db();
      await d.withExclusiveTransactionAsync(async (t) => {
        for (const op of batch) {
          if (done.has(op.client_id)) await t.runAsync('delete from ops where client_id = ?', op.client_id);
          else {
            const r = results.find((x) => x.client_id === op.client_id);
            await t.runAsync('update ops set attempts = attempts + 1, last_error = ? where client_id = ?', r?.error ?? null, op.client_id);
          }
        }
        for (const pr of newProblems) await t.runAsync('insert into problems (body) values (?)', JSON.stringify(pr));
        await t.runAsync('delete from problems where seq <= (select max(seq) from problems) - ?', MAX_PROBLEMS);
      });
      // Files go only after the rows that point at them are gone.
      for (const op of batch) if (done.has(op.client_id)) deletePhotos(op);
    });
    sent += done.size;
    notify();
    // A batch where nothing could be settled means a server-side error: try again later.
    if (done.size === 0) return { sent, offline: true, remaining: q.length };
  }
}

/** Drops everything not yet sent. Only used when signing out with nothing pending. */
export async function resetLocal(): Promise<void> {
  await withLock(async () => {
    for (const op of await pending()) deletePhotos(op);
    await (await db()).execAsync('delete from ops; delete from gps; delete from problems;');
  });
  notify();
}

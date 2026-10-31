import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';

/**
 * The phone's own database. Unsent deliveries, GPS points and sync problems live here,
 * in SQLite with a write-ahead log, so a crash or a dead battery mid-save can't lose them
 * (AsyncStorage rewrote the whole queue as one JSON string on every change).
 */
let opened: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!opened) opened = open();
  return opened;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const d = await SQLite.openDatabaseAsync('watertruck.db');
  await d.execAsync(`
    pragma journal_mode = wal;
    pragma synchronous = normal;
    create table if not exists ops (
      seq integer primary key autoincrement,
      client_id text not null unique,
      body text not null,
      attempts integer not null default 0,
      last_error text,
      created_at text not null default (datetime('now'))
    );
    create table if not exists gps (seq integer primary key autoincrement, body text not null);
    create table if not exists problems (seq integer primary key autoincrement, body text not null);
    create table if not exists meta (key text primary key, value text);
  `);
  await migrateFromAsyncStorage(d);
  return d;
}

/** One-time move of anything an older version of the app left in AsyncStorage. */
async function migrateFromAsyncStorage(d: SQLite.SQLiteDatabase) {
  const done = await d.getFirstAsync<{ value: string }>(`select value from meta where key = 'migrated_v1'`);
  if (done) return;
  const [[, q], [, g], [, p]] = await AsyncStorage.multiGet(['wt.queue', 'wt.gps', 'wt.problems']);
  await d.withExclusiveTransactionAsync(async (t) => {
    for (const op of safeParse<{ client_id: string }[]>(q)) {
      await t.runAsync('insert or ignore into ops (client_id, body) values (?, ?)', op.client_id, JSON.stringify(op));
    }
    for (const pt of safeParse<unknown[]>(g)) await t.runAsync('insert into gps (body) values (?)', JSON.stringify(pt));
    for (const pr of safeParse<unknown[]>(p)) await t.runAsync('insert into problems (body) values (?)', JSON.stringify(pr));
    await t.runAsync(`insert into meta (key, value) values ('migrated_v1', datetime('now'))`);
  });
  await AsyncStorage.multiRemove(['wt.queue', 'wt.gps', 'wt.problems']);
}

function safeParse<T extends unknown[]>(raw: string | null): T {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return (Array.isArray(v) ? v : []) as T;
  } catch {
    return [] as unknown as T;
  }
}

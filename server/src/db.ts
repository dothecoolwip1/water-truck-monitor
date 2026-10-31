import { HttpError } from './http.js';
import pg from 'pg';
import { config } from './config.js';

// Return numeric and bigint columns as JS numbers; values here stay well inside safe range.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// Keep DATE columns as 'YYYY-MM-DD' strings instead of shifting them through local time.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

export function createPool(url = config.databaseUrl): pg.Pool {
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX ?? 10) });
}

export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `update <table> set ...` for the fields in a parsed partial body. Column names come from a zod
 * schema, never from the client, so they are safe to interpolate. Returns the updated row, or null.
 */
export async function updateRow<T = Record<string, unknown>>(db: Db, table: string, id: string, body: Record<string, unknown>, returning = '*'): Promise<T | null> {
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  const { rows } = await db.query(
    `update ${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning ${returning}`,
    [id, ...keys.map((k) => body[k] ?? null)],
  );
  return (rows[0] as T) ?? null;
}

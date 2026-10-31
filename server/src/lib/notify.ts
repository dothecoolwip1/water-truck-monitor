import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string | null;
  jobId?: string | null;
}

/**
 * Sends an in-app notification to office users and a phone push to drivers.
 * `exclude` is the person who caused it, so nobody is told about their own action.
 */
export async function notifyUsers(app: FastifyInstance, db: Db, userIds: string[], n: NotifyInput, exclude?: string | null) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== exclude);
  if (ids.length === 0) return;
  const { rows } = await db.query(
    `insert into notifications (user_id, kind, title, body, job_id)
     select u, $2, $3, $4, $5 from unnest($1::uuid[]) u
     returning user_id`,
    [ids, n.kind, n.title, n.body ?? null, n.jobId ?? null],
  );
  const tokens = await db.query(`select push_token from users where id = any($1::uuid[]) and push_token is not null and active`, [rows.map((r) => r.user_id)]);
  if (tokens.rows.length) {
    await app.push(tokens.rows.map((t) => ({ to: t.push_token, title: n.title, body: n.body ?? '', data: { jobId: n.jobId, kind: n.kind } })));
  }
  app.bus.publish({ type: 'notification', userIds: ids });
}

/** Everyone who should hear about a job: its followers and its driver. */
export async function jobAudience(db: Db, jobId: string): Promise<string[]> {
  const { rows } = await db.query(
    `select user_id as id from job_followers where job_id = $1
     union select driver_id from jobs where id = $1 and driver_id is not null`,
    [jobId],
  );
  return rows.map((r) => r.id);
}

export async function officeUsers(db: Db): Promise<string[]> {
  const { rows } = await db.query(`select id from users where role in ('admin', 'dispatcher') and active`);
  return rows.map((r) => r.id);
}

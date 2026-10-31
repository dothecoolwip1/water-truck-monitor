import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { jobAudience, notifyUsers } from './notify.js';

export async function addComment(
  app: FastifyInstance,
  c: Db,
  p: { jobId: string; authorId: string; authorName: string; body: string; clientId?: string | null; at?: Date },
) {
  const { rows } = await c.query(
    `insert into job_comments (client_id, job_id, author_id, body, created_at) values ($1,$2,$3,$4,coalesce($5, now()))
     on conflict (client_id) do nothing returning id`,
    [p.clientId ?? null, p.jobId, p.authorId, p.body, p.at ?? null],
  );
  if (!rows[0]) return null; // replayed from a phone's offline queue
  // Writing on a job means you want to hear the replies.
  await c.query('insert into job_followers (job_id, user_id) values ($1,$2) on conflict do nothing', [p.jobId, p.authorId]);
  await c.query(
    `insert into job_reads (job_id, user_id, read_at) values ($1,$2,now()) on conflict (job_id, user_id) do update set read_at = now()`,
    [p.jobId, p.authorId],
  );
  const job = (await c.query('select number from jobs where id = $1', [p.jobId])).rows[0];
  const audience = await jobAudience(c, p.jobId);
  await notifyUsers(app, c, audience, { kind: 'comment', title: `${p.authorName} on job #${job.number}`, body: p.body.slice(0, 180), jobId: p.jobId }, p.authorId);
  app.bus.publish({ type: 'comment', jobId: p.jobId });
  return rows[0].id as string;
}

/** Comments with who has seen each one (read receipts). */
export async function listComments(db: Db, jobId: string, viewerId: string) {
  const { rows } = await db.query(
    `select jc.id, jc.body, jc.created_at, jc.author_id, u.name as author_name, u.role as author_role,
            coalesce((select json_agg(ru.name order by ru.name) from job_reads r join users ru on ru.id = r.user_id
                      where r.job_id = jc.job_id and r.read_at >= jc.created_at and r.user_id is distinct from jc.author_id), '[]') as seen_by
     from job_comments jc left join users u on u.id = jc.author_id
     where jc.job_id = $1 order by jc.created_at`,
    [jobId],
  );
  await db.query(
    `insert into job_reads (job_id, user_id, read_at) values ($1,$2,now()) on conflict (job_id, user_id) do update set read_at = now()`,
    [jobId, viewerId],
  );
  return rows;
}

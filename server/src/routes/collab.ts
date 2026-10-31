import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.js';
import { addComment, listComments } from '../lib/comments.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { anyUser, office, parse, requireRole, uuid } from '../http.js';

const routes: FastifyPluginAsync = async (app) => {
  // ----- Job comments (office side; drivers post through their sync queue) -----
  app.get('/jobs/:id/comments', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    return listComments(app.pool, id, req.user.id);
  });
  app.post('/jobs/:id/comments', { preHandler: office }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ body: z.string().trim().min(1).max(4000) }), req.body);
    await tx(app.pool, (c) => addComment(app, c, { jobId: id, authorId: req.user.id, authorName: req.user.name, body: b.body }));
    reply.status(201);
    return listComments(app.pool, id, req.user.id);
  });

  // ----- Followers -----
  app.get('/jobs/:id/followers', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const { rows } = await app.pool.query(
      `select u.id, u.name, u.role from job_followers f join users u on u.id = f.user_id where f.job_id = $1 order by u.name`,
      [id],
    );
    return rows;
  });
  app.put('/jobs/:id/followers', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ user_ids: z.array(uuid).max(50) }), req.body);
    await tx(app.pool, async (c) => {
      await c.query('delete from job_followers where job_id = $1 and not (user_id = any($2::uuid[]))', [id, b.user_ids]);
      await c.query('insert into job_followers (job_id, user_id) select $1, u from unnest($2::uuid[]) u on conflict do nothing', [id, b.user_ids]);
    });
    return { ok: true };
  });

  // ----- Notifications -----
  app.get('/notifications', { preHandler: anyUser }, async (req) => {
    const { rows } = await app.pool.query(
      `select n.id, n.kind, n.title, n.body, n.job_id, n.created_at, n.read_at, j.number as job_number
       from notifications n left join jobs j on j.id = n.job_id
       where n.user_id = $1 order by n.created_at desc limit 50`,
      [req.user.id],
    );
    const unread = rows.filter((r) => !r.read_at).length;
    return { unread, items: rows };
  });
  app.post('/notifications/read', { preHandler: anyUser }, async (req) => {
    const b = parse(z.object({ ids: z.array(z.number().int()).max(200).optional() }), req.body ?? {});
    await app.pool.query(
      `update notifications set read_at = now() where user_id = $1 and read_at is null and ($2::bigint[] is null or id = any($2))`,
      [req.user.id, b.ids ?? null],
    );
    return { ok: true };
  });

  // ----- Settings -----
  app.get('/settings', { preHandler: office }, async () => getSettings(app.pool));
  app.patch('/settings', { preHandler: requireRole('admin') }, async (req) => {
    const b = parse(
      z.object({
        company: z.object({ name: z.string().max(120), address: z.string().max(300), phone: z.string().max(40), email: z.string().max(120), tax_number: z.string().max(40) }).partial(),
        tax: z.object({ label: z.string().min(1).max(20), rate: z.number().min(0).max(0.5) }).partial(),
        invoice: z.object({ terms_days: z.number().int().min(0).max(180), footer: z.string().max(300), prefix: z.string().max(10) }).partial(),
        approvals: z.object({ auto: z.boolean(), meter_tolerance_l: z.number().min(0).max(5000), require_at_site: z.boolean(), max_over_tank_pct: z.number().min(0).max(200) }).partial(),
        portal: z.object({ enabled: z.boolean(), max_litres: z.number().int().min(100).max(100_000), message: z.string().max(500) }).partial(),
        form: z.object({
          fields: z.array(z.object({
            key: z.string().regex(/^[a-z0-9_]{1,40}$/),
            label: z.string().min(1).max(80),
            type: z.enum(['text', 'number', 'yesno', 'choice']),
            options: z.array(z.string().min(1).max(60)).max(20).optional(),
            required: z.boolean().optional(),
          })).max(20),
        }),
      }).partial(),
      req.body,
    );
    return updateSettings(app.pool, b);
  });
};

export default routes;

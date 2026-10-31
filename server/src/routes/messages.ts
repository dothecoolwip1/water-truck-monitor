import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { deliver, providers } from '../lib/messaging.js';
import { getSettings } from '../lib/settings.js';
import { office, parse, uuid } from '../http.js';

const routes: FastifyPluginAsync = async (app) => {
  // What went out to residents (and what would have, while alerts are off).
  app.get('/messages', { preHandler: office }, async (req) => {
    const q = parse(z.object({ customer_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const { rows } = await app.pool.query(
      `select m.*, c.name as customer_name, j.number as job_number from outbound_messages m
       left join customers c on c.id = m.customer_id left join jobs j on j.id = m.job_id
       where ($1::uuid is null or m.customer_id = $1) order by m.created_at desc limit $2`,
      [q.customer_id ?? null, q.limit],
    );
    return { providers: providers(), items: rows };
  });

  // A notice to every resident who opted in, e.g. "No deliveries Monday: the plant is down for repairs."
  app.post('/notices', { preHandler: office }, async (req) => {
    const b = parse(
      z.object({
        body: z.string().trim().min(3).max(600),
        subject: z.string().trim().max(120).optional(),
        classes: z.array(z.string().max(40)).max(12).optional(),
        sms: z.boolean().default(true),
        email: z.boolean().default(true),
      }),
      req.body,
    );
    const s = await getSettings(app.pool);
    const { rows } = await app.pool.query(
      `select id, phone, email, notify_sms, notify_email from customers
       where active and (notify_sms or notify_email) and ($1::text[] is null or customer_class = any($1))`,
      [b.classes?.length ? b.classes : null],
    );
    const body = `${s.company.name}: ${b.body}`;
    const subject = b.subject || `Notice from ${s.company.name}`;
    const tally = { sent: 0, skipped: 0, failed: 0 };
    for (const c of rows) {
      for (const channel of ['sms', 'email'] as const) {
        if (channel === 'sms' && !(b.sms && c.notify_sms)) continue;
        if (channel === 'email' && !(b.email && c.notify_email)) continue;
        const r = await deliver(app.pool, { customerId: c.id, kind: 'notice', channel, to: channel === 'sms' ? c.phone : c.email, subject, body }, s);
        tally[r.status]++;
      }
    }
    await audit(app.pool, 'notice', req.user.id, 'sent', req.user.id, { recipients: rows.length, ...tally, body: b.body });
    return { recipients: rows.length, ...tally };
  });
};

export default routes;

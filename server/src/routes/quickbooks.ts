import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { authorizeUrl, connect, disconnect, pushInvoice, qboConfigured, QboClient, redirectUri } from '../lib/quickbooks.js';
import { getSettings } from '../lib/settings.js';
import { office, parse, requireRole, uuid } from '../http.js';

const admin = requireRole('admin');

// The OAuth "state" ties Intuit's redirect back to the admin who started it. It is its own HMAC,
// not a sign-in token, so it can never be used to call the API.
const mac = (v: string) => createHmac('sha256', `${config.jwtSecret}:qbo-state`).update(v).digest('base64url');
function signState(userId: string): string {
  const v = `${userId}.${Date.now() + 15 * 60_000}`;
  return `${v}.${mac(v)}`;
}
function verifyState(state: string): { id: string } | null {
  const [id, exp, sig] = state.split('.');
  if (!id || !exp || !sig) return null;
  const want = Buffer.from(mac(`${id}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got) || Number(exp) < Date.now()) return null;
  return { id };
}

export const quickbooksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/integrations/quickbooks', { preHandler: office }, async () => {
    const s = await getSettings(app.pool);
    return {
      configured: qboConfigured(), connected: !!s.quickbooks.refresh_token, company_name: s.quickbooks.company_name,
      connected_at: s.quickbooks.connected_at, redirect_uri: redirectUri(), environment: process.env.QBO_ENV === 'production' ? 'production' : 'sandbox',
    };
  });
  app.post('/integrations/quickbooks/connect', { preHandler: admin }, async (req) => {
    const state = signState(req.user.id);
    return { url: authorizeUrl(state) };
  });
  app.delete('/integrations/quickbooks', { preHandler: admin }, async (req) => {
    await disconnect(app.pool);
    await audit(app.pool, 'integration', req.user.id, 'quickbooks_disconnected', req.user.id, {});
    return { ok: true };
  });
  app.post('/invoices/:id/quickbooks', { preHandler: office }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    return pushInvoice(app.pool, id);
  });
  // Send every sent or paid invoice that isn't in QuickBooks yet.
  app.post('/quickbooks/sync', { preHandler: office }, async (req) => {
    const b = parse(z.object({ statuses: z.array(z.enum(['draft', 'sent', 'paid'])).default(['sent', 'paid']) }), req.body ?? {});
    const { rows } = await app.pool.query(`select id, number from invoices where qbo_id is null and status = any($1) order by number limit 100`, [b.statuses]);
    const client = await QboClient.open(app.pool);
    const out = { sent: 0, failed: [] as { number: number; error: string }[] };
    for (const r of rows) {
      try {
        await pushInvoice(app.pool, r.id, client);
        out.sent++;
      } catch (e) {
        out.failed.push({ number: r.number, error: (e as Error).message });
      }
    }
    return out;
  });
};

/** Intuit sends the browser back here after the admin approves the connection. */
export const quickbooksPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/quickbooks/callback', async (req, reply) => {
    const q = req.query as { code?: string; realmId?: string; state?: string; error?: string };
    const back = (msg: string) => reply.redirect(`/settings?tab=integrations&qbo=${encodeURIComponent(msg)}`);
    if (q.error) return back(q.error === 'access_denied' ? 'cancelled' : q.error);
    try {
      const st = verifyState(q.state ?? '');
      if (!st || !q.code || !q.realmId) throw new Error('bad state');
      await connect(app.pool, q.code, q.realmId);
      await audit(app.pool, 'integration', st.id, 'quickbooks_connected', st.id, { realm_id: q.realmId });
      return back('connected');
    } catch (e) {
      return back((e as Error).message === 'bad state' ? 'expired' : 'failed');
    }
  });
};

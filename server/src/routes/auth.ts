import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { anyUser, HttpError, parse } from '../http.js';

const routes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', async (req) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }), req.body);
    const { rows } = await app.pool.query(
      'select id, name, email, role, password_hash, active from users where email = $1',
      [body.email],
    );
    const user = rows[0];
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw new HttpError(401, 'Wrong email or password');
    }
    const token = app.jwt.sign({ id: user.id, role: user.role, name: user.name });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  app.get('/me', { preHandler: anyUser }, async (req) => {
    const { rows } = await app.pool.query('select id, name, email, phone, role from users where id = $1', [req.user.id]);
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
    return rows[0];
  });

  app.post('/me/push-token', { preHandler: anyUser }, async (req) => {
    const body = parse(z.object({ token: z.string().max(300).nullable() }), req.body);
    await app.pool.query('update users set push_token = $2 where id = $1', [req.user.id, body.token]);
    return { ok: true };
  });

  app.post('/me/password', { preHandler: anyUser }, async (req) => {
    const body = parse(z.object({ current: z.string(), next: z.string().min(8) }), req.body);
    const { rows } = await app.pool.query('select password_hash from users where id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(body.current, rows[0].password_hash))) {
      throw new HttpError(400, 'Current password is wrong');
    }
    await app.pool.query('update users set password_hash = $2 where id = $1', [req.user.id, await bcrypt.hash(body.next, 10)]);
    return { ok: true };
  });
};

export default routes;

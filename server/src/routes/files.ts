import type { FastifyPluginAsync } from 'fastify';
import { notFound, office, parse, uuid } from '../http.js';

const routes: FastifyPluginAsync = async (app) => {
  app.get('/files/:id', { preHandler: office }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const { rows } = await app.pool.query('select mime, data from files where id = $1', [id]);
    if (!rows[0]) throw notFound();
    reply.header('content-type', rows[0].mime);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(rows[0].data);
  });
};

export default routes;

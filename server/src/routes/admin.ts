import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyInstance, preHandlerHookHandler } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit, diff } from '../lib/audit.js';
import { tx } from '../db.js';
import { badRequest, notFound, office, optionalText, parse, requireRole, uuid } from '../http.js';

const adminOnly = requireRole('admin');

const lat = z.number().min(-90).max(90).nullish();
const lng = z.number().min(-180).max(180).nullish();

interface Resource {
  path: string;
  table: string;
  entity: string;
  schema: z.ZodObject<z.ZodRawShape>;
  // Columns returned to clients; never includes secrets.
  columns: string;
  order: string;
  read: preHandlerHookHandler;
  write: preHandlerHookHandler;
}

/** Registers list/get/create/update for a simple table, with audit logging. */
function crud(app: FastifyInstance, r: Resource) {
  app.get(`/${r.path}`, { preHandler: r.read }, async (req) => {
    const q = req.query as { active?: string };
    const where = q.active === 'all' ? '' : 'where active';
    const { rows } = await app.pool.query(`select ${r.columns} from ${r.table} ${where} order by ${r.order}`);
    return rows;
  });

  app.get(`/${r.path}/:id`, { preHandler: r.read }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const { rows } = await app.pool.query(`select ${r.columns} from ${r.table} where id = $1`, [id]);
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.post(`/${r.path}`, { preHandler: r.write }, async (req, reply) => {
    const body = parse(r.schema, req.body) as Record<string, unknown>;
    const keys = Object.keys(body);
    const row = await tx(app.pool, async (c) => {
      const { rows } = await c.query(
        `insert into ${r.table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})
         returning ${r.columns}`,
        keys.map((k) => body[k]),
      );
      await audit(c, r.entity, rows[0].id, 'created', req.user.id, body);
      return rows[0];
    });
    reply.status(201);
    return row;
  });

  app.patch(`/${r.path}/:id`, { preHandler: r.write }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(r.schema.partial(), req.body) as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length === 0) throw badRequest('Nothing to update');
    return tx(app.pool, async (c) => {
      const before = (await c.query(`select ${r.columns} from ${r.table} where id = $1 for update`, [id])).rows[0];
      if (!before) throw notFound();
      const { rows } = await c.query(
        `update ${r.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning ${r.columns}`,
        [id, ...keys.map((k) => body[k])],
      );
      await audit(c, r.entity, id, 'updated', req.user.id, diff(before, rows[0]));
      return rows[0];
    });
  });
}

const routes: FastifyPluginAsync = async (app) => {
  crud(app, {
    path: 'trucks',
    table: 'trucks',
    entity: 'truck',
    schema: z.object({
      name: z.string().trim().min(1).max(100),
      plate: optionalText,
      capacity_l: z.number().int().min(0).max(100_000),
      meter_serial: optionalText,
      last_meter_reading: z.number().min(0).nullish(),
      active: z.boolean().optional(),
      odometer_km: z.number().min(0).nullish(),
      engine_hours: z.number().min(0).nullish(),
      out_of_service: z.boolean().optional(),
      out_of_service_reason: optionalText,
    }),
    columns: 'id, name, plate, capacity_l, meter_serial, last_meter_reading, active, odometer_km, engine_hours, out_of_service, out_of_service_reason',
    order: 'name',
    read: requireRole('admin', 'dispatcher', 'driver'),
    write: office,
  });

  crud(app, {
    path: 'customers',
    table: 'customers',
    entity: 'customer',
    schema: z.object({
      name: z.string().trim().min(1).max(200),
      account_code: z.string().trim().max(50).nullish(),
      phone: optionalText,
      email: z.string().email().nullish(),
      notes: optionalText,
      active: z.boolean().optional(),
      customer_class: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
      notify_sms: z.boolean().optional(),
      notify_email: z.boolean().optional(),
    }),
    columns: 'id, name, account_code, phone, email, notes, active, customer_class, notify_sms, notify_email, qbo_id',
    order: 'name',
    read: office,
    write: office,
  });

  crud(app, {
    path: 'sites',
    table: 'sites',
    entity: 'site',
    schema: z.object({
      customer_id: uuid,
      label: z.string().trim().min(1).max(200),
      address: optionalText,
      lat,
      lng,
      geofence_m: z.number().int().min(10).max(2000).optional(),
      tank_capacity_l: z.number().int().min(0).nullish(),
      access_notes: optionalText,
      tags: z.array(z.string().max(50)).optional(),
      active: z.boolean().optional(),
      critical: z.boolean().optional(),
    }),
    columns: 'id, customer_id, label, address, lat, lng, geofence_m, tank_capacity_l, access_notes, tags, active, critical',
    order: 'label',
    read: office,
    write: office,
  });

  // Users: admins manage accounts; dispatchers can see the driver list.
  const userColumns = 'id, name, email, phone, role, active, (push_token is not null) as has_push';
  app.get('/users', { preHandler: office }, async (req) => {
    const q = req.query as { role?: string };
    const { rows } = await app.pool.query(
      `select ${userColumns} from users where ($1::user_role is null or role = $1) order by active desc, name`,
      [q.role ?? null],
    );
    return rows;
  });

  const userSchema = z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email(),
    phone: optionalText,
    role: z.enum(['admin', 'dispatcher', 'driver']),
    password: z.string().min(8).max(200),
    active: z.boolean().optional(),
  });

  app.post('/users', { preHandler: adminOnly }, async (req, reply) => {
    const body = parse(userSchema, req.body);
    const hash = await bcrypt.hash(body.password, 10);
    const row = await tx(app.pool, async (c) => {
      const { rows } = await c.query(
        `insert into users (name, email, phone, role, password_hash, active) values ($1,$2,$3,$4,$5,$6) returning ${userColumns}`,
        [body.name, body.email, body.phone ?? null, body.role, hash, body.active ?? true],
      );
      await audit(c, 'user', rows[0].id, 'created', req.user.id, { name: body.name, email: body.email, role: body.role });
      return rows[0];
    });
    reply.status(201);
    return row;
  });

  app.patch('/users/:id', { preHandler: adminOnly }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(userSchema.partial(), req.body);
    if (id === req.user.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('You cannot deactivate or demote your own account');
    }
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(body)) {
      if (k === 'password') {
        vals.push(await bcrypt.hash(v as string, 10));
        sets.push(`password_hash = $${vals.length}`);
      } else {
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
    }
    if (sets.length === 0) throw badRequest('Nothing to update');
    const { rows } = await app.pool.query(`update users set ${sets.join(', ')} where id = $1 returning ${userColumns}`, vals);
    if (!rows[0]) throw notFound();
    const logged = { ...body, password: body.password ? '(changed)' : undefined };
    await audit(app.pool, 'user', id, 'updated', req.user.id, logged);
    return rows[0];
  });

  // Source tanks: the device key is shown once at creation and stored hashed.
  const tankColumns = 'id, name, device_id, capacity_l, height_mm, lat, lng, geofence_m, noise_l';
  const tankSchema = z.object({
    name: z.string().trim().min(1).max(100),
    device_id: z.string().trim().min(1).max(100),
    capacity_l: z.number().int().positive(),
    height_mm: z.number().int().positive().nullish(),
    lat,
    lng,
    geofence_m: z.number().int().min(10).max(2000).optional(),
    noise_l: z.number().int().min(0).optional(),
  });

  app.get('/tanks', { preHandler: requireRole('admin', 'dispatcher', 'driver') }, async () => {
    const { rows } = await app.pool.query(
      `select ${tankColumns.split(', ').map((c) => `t.${c}`).join(', ')}, r.volume_l as latest_volume_l, r.ts as latest_ts
       from source_tanks t
       left join lateral (select volume_l, ts from tank_readings where tank_id = t.id order by ts desc limit 1) r on true
       order by t.name`,
    );
    return rows;
  });

  app.post('/tanks', { preHandler: adminOnly }, async (req, reply) => {
    const body = parse(tankSchema, req.body);
    const deviceKey = crypto.randomBytes(24).toString('base64url');
    const { rows } = await app.pool.query(
      `insert into source_tanks (name, device_id, device_key_hash, capacity_l, height_mm, lat, lng, geofence_m, noise_l)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, 100),coalesce($9, 200)) returning ${tankColumns}`,
      [body.name, body.device_id, hashKey(deviceKey), body.capacity_l, body.height_mm ?? null, body.lat ?? null,
        body.lng ?? null, body.geofence_m ?? null, body.noise_l ?? null],
    );
    await audit(app.pool, 'tank', rows[0].id, 'created', req.user.id, body);
    reply.status(201);
    return { ...rows[0], device_key: deviceKey };
  });

  app.patch('/tanks/:id', { preHandler: adminOnly }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const body = parse(tankSchema.partial(), req.body) as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.length === 0) throw badRequest('Nothing to update');
    const { rows } = await app.pool.query(
      `update source_tanks set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning ${tankColumns}`,
      [id, ...keys.map((k) => body[k])],
    );
    if (!rows[0]) throw notFound();
    await audit(app.pool, 'tank', id, 'updated', req.user.id, body);
    return rows[0];
  });

  app.post('/tanks/:id/rotate-key', { preHandler: adminOnly }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const deviceKey = crypto.randomBytes(24).toString('base64url');
    const { rowCount } = await app.pool.query('update source_tanks set device_key_hash = $2 where id = $1', [id, hashKey(deviceKey)]);
    if (!rowCount) throw notFound();
    await audit(app.pool, 'tank', id, 'key_rotated', req.user.id);
    return { device_key: deviceKey };
  });

  // Bulk import of customers with their delivery points, e.g. from a spreadsheet.
  const importSchema = z.object({
    rows: z
      .array(
        z.object({
          customer: z.string().trim().min(1),
          account_code: z.string().trim().nullish(),
          phone: optionalText,
          email: z.string().email().nullish().or(z.literal('')),
          site_label: z.string().trim().nullish(),
          address: optionalText,
          lat: z.coerce.number().min(-90).max(90).nullish(),
          lng: z.coerce.number().min(-180).max(180).nullish(),
          tank_capacity_l: z.coerce.number().int().nullish(),
          access_notes: optionalText,
        }),
      )
      .min(1)
      .max(5000),
  });

  app.post('/import/customers', { preHandler: office }, async (req) => {
    const { rows } = parse(importSchema, req.body);
    return tx(app.pool, async (c) => {
      let customers = 0;
      let sites = 0;
      const byKey = new Map<string, string>();
      for (const r of rows) {
        const key = r.account_code || r.customer.toLowerCase();
        let customerId = byKey.get(key);
        if (!customerId) {
          const existing = r.account_code
            ? await c.query('select id from customers where account_code = $1', [r.account_code])
            : await c.query('select id from customers where lower(name) = lower($1) limit 1', [r.customer]);
          if (existing.rows[0]) {
            customerId = existing.rows[0].id as string;
          } else {
            const ins = await c.query(
              'insert into customers (name, account_code, phone, email) values ($1,$2,$3,$4) returning id',
              [r.customer, r.account_code || null, r.phone || null, r.email || null],
            );
            customerId = ins.rows[0].id as string;
            customers++;
          }
          byKey.set(key, customerId);
        }
        await c.query(
          `insert into sites (customer_id, label, address, lat, lng, tank_capacity_l, access_notes)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [customerId, r.site_label || r.address || r.customer, r.address || null, r.lat ?? null, r.lng ?? null,
            r.tank_capacity_l ?? null, r.access_notes || null],
        );
        sites++;
      }
      await audit(c, 'import', req.user.id, 'customers_imported', req.user.id, { customers, sites });
      return { customers_created: customers, sites_created: sites };
    });
  });

  app.get('/audit', { preHandler: office }, async (req) => {
    const q = parse(z.object({ entity: z.string().optional(), entity_id: uuid.optional(), limit: z.coerce.number().int().max(500).default(100) }), req.query);
    const { rows } = await app.pool.query(
      `select a.id, a.entity, a.entity_id, a.action, a.at, a.changes, u.name as actor_name
       from audit_log a left join users u on u.id = a.actor_id
       where ($1::text is null or a.entity = $1) and ($2::uuid is null or a.entity_id = $2)
       order by a.at desc limit $3`,
      [q.entity ?? null, q.entity_id ?? null, q.limit],
    );
    return rows;
  });
};

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export default routes;

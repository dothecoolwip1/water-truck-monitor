import type pg from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/**
 * Parses a partial update. Zod 4 fills in `.default()` values even for fields the client left out,
 * which would silently reset them, so only the keys actually sent are kept.
 */
export function parsePatch<T extends z.ZodObject>(schema: T, data: unknown): Partial<z.infer<T>> {
  const out = parse(schema.partial(), data) as Record<string, unknown>;
  const sent = data && typeof data === 'object' ? new Set(Object.keys(data)) : new Set<string>();
  return Object.fromEntries(Object.entries(out).filter(([k]) => sent.has(k))) as Partial<z.infer<T>>;
}

export type Role = 'admin' | 'dispatcher' | 'driver' | 'resident';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    // Images and PDFs open via plain links, which can't carry a header.
    const queryToken = (req.query as { token?: string } | undefined)?.token;
    if (req.method === 'GET' && !req.headers.authorization && queryToken) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Sign in required');
    }
    if (req.user.role !== 'resident') req.user.role = await staffRole(req.server.pool, req.user as AuthUser & { iat?: number });
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Not allowed for your role');
  };
}

// Each instance remembers an account's state briefly, so dispatch polling doesn't add a query per request.
// Edits on this instance clear it at once; other serverless instances catch up within the TTL.
const STAFF_TTL_MS = 15_000;
const staffCache = new Map<string, { at: number; row: { role: Role; active: boolean; password_changed_at: Date | null } | undefined }>();
export const forgetStaff = (id: string) => staffCache.delete(id);
async function staffRow(pool: Pick<pg.Pool, 'query'>, id: string) {
  const hit = staffCache.get(id);
  if (hit && Date.now() - hit.at < STAFF_TTL_MS) return hit.row;
  const row = (await pool.query('select role, active, password_changed_at from users where id = $1', [id])).rows[0];
  staffCache.set(id, { at: Date.now(), row });
  return row;
}

/**
 * The staff member's current role from the database, so deactivating, demoting or resetting the
 * password of an account takes effect at once instead of when its sign-in token expires.
 */
export async function staffRole(pool: Pick<pg.Pool, 'query'>, user: { id: string; iat?: number }): Promise<Role> {
  const u = await staffRow(pool, user.id);
  if (!u || !u.active) throw new HttpError(401, 'Sign in required');
  // Tokens carry whole seconds; allow the second the password changed in.
  if (u.password_changed_at && user.iat !== undefined && user.iat * 1000 < new Date(u.password_changed_at).getTime() - 1000) {
    throw new HttpError(401, 'Your password was changed. Sign in again.');
  }
  return u.role as Role;
}

export const office = requireRole('admin', 'dispatcher');
export const anyUser = requireRole('admin', 'dispatcher', 'driver');

// Shared zod pieces.
export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const optionalText = z.string().trim().max(2000).nullish();

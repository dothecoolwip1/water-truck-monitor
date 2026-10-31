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
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Not allowed for your role');
  };
}

export const office = requireRole('admin', 'dispatcher');
export const anyUser = requireRole('admin', 'dispatcher', 'driver');

// Shared zod pieces.
export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const optionalText = z.string().trim().max(2000).nullish();

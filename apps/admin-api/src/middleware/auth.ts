import type { MiddlewareHandler } from 'hono';
import { createFactory } from 'hono/factory';

export interface AuthUser {
  userId: number;
  roles: string[];
  storeIds: number[];
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/**
 * Reads Kong-forwarded identity headers and populates c.get('user').
 * Must run after rejectIdentity middleware.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const userId = c.req.header('x-user-id');
  const rolesRaw = c.req.header('x-user-roles');
  const storeIdsRaw = c.req.header('x-store-ids');

  if (!userId) {
    return c.json({ statusCode: 401, error: 'Unauthorized', message: 'Missing identity headers' }, 401);
  }

  let roles: string[] = [];
  let storeIds: number[] = [];

  try {
    roles = rolesRaw ? (JSON.parse(rolesRaw) as string[]) : [];
    storeIds = storeIdsRaw ? (JSON.parse(storeIdsRaw) as number[]) : [];
  } catch {
    return c.json({ statusCode: 401, error: 'Unauthorized', message: 'Malformed identity headers' }, 401);
  }

  c.set('user', { userId: parseInt(userId, 10), roles, storeIds });
  await next();
};

export const { createMiddleware } = createFactory();

import type { MiddlewareHandler } from 'hono';

/**
 * Strips any client-supplied identity headers before they reach route handlers.
 * Kong is the only trusted source for these headers.
 */
export const rejectIdentity: MiddlewareHandler = async (c, next) => {
  c.req.raw.headers.delete('x-user-id');
  c.req.raw.headers.delete('x-user-roles');
  c.req.raw.headers.delete('x-store-ids');
  await next();
};

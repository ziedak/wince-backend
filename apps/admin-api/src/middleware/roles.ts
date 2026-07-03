import type { MiddlewareHandler } from 'hono';

/**
 * Factory that returns a middleware requiring the authenticated user to hold
 * at least one of the specified roles.
 */
export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user');
    const hasRole = roles.some((r) => user.roles.includes(r));
    if (!hasRole) {
      return c.json(
        { statusCode: 403, error: 'Forbidden', message: `Required role: ${roles.join(' or ')}` },
        403,
      );
    }
    await next();
  };
}

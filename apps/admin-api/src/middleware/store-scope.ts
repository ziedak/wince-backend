import type { MiddlewareHandler } from 'hono';

/**
 * Factory that returns a middleware asserting the requested store_id is in the
 * authenticated user's allowed store list. Prevents IDOR attacks.
 *
 * @param getStoreId - function that extracts store_id from the request context
 */
export function requireStoreAccess(
  getStoreId: (c: Parameters<MiddlewareHandler>[0]) => number | null,
): MiddlewareHandler {
  return async (c, next) => {
    const storeId = getStoreId(c);
    if (storeId === null) {
      return c.json({ statusCode: 400, error: 'Bad Request', message: 'store_id is required' }, 400);
    }

    const user = c.get('user');
    if (!user.storeIds.includes(storeId)) {
      return c.json({ statusCode: 403, error: 'Forbidden', message: 'Access to this store is not allowed' }, 403);
    }

    await next();
  };
}

import type { MiddlewareHandler } from 'hono';
import { jwtVerify, importSPKI } from 'jose';
import type { DbClient } from '../types';
import { adminUsers, eq } from '@org/db';

interface JwtPayload {
  token_version?: number;
  [key: string]: unknown;
}

/**
 * Factory: verifies that the JWT token_version claim matches the current value
 * stored in the DB, enabling immediate revocation without waiting for expiry.
 */
export function tokenVersionGuard(db: DbClient, publicKey: string): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ statusCode: 401, error: 'Unauthorized', message: 'Missing Bearer token' }, 401);
    }

    const token = authHeader.slice(7);

    let payload: JwtPayload;
    try {
      const key = await importSPKI(publicKey, 'RS256');
      const { payload: p } = await jwtVerify(token, key);
      payload = p as JwtPayload;
    } catch {
      return c.json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid token' }, 401);
    }

    const user = c.get('user');
    const [row] = await db
      .select({ tokenVersion: adminUsers.tokenVersion })
      .from(adminUsers)
      .where(eq(adminUsers.id, user.userId))
      .limit(1);

    if (!row) {
      return c.json({ statusCode: 401, error: 'Unauthorized', message: 'User not found' }, 401);
    }

    if ((payload.token_version ?? 0) !== row.tokenVersion) {
      return c.json({ statusCode: 401, error: 'Unauthorized', message: 'Token has been revoked' }, 401);
    }

    await next();
  };
}

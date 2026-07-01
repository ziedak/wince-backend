import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';

export type { Pool };

export interface DbOptions {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  onQuery?: (query: string, durationMs: number) => void;
  onError?: (err: Error, query: string) => void;
}

/**
 * Creates a Drizzle db instance backed by a pg connection pool.
 * Call pool.end() on shutdown (accessible via db.$client).
 */
export function createDb(options: DbOptions) {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 30_000,
  });

  if (options.onQuery ?? options.onError) {
    pool.on('connect', (client) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const origQuery = (client as any).query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).query = (...args: unknown[]) => {
        const start = Date.now();
        const queryText =
          typeof args[0] === 'string'
            ? args[0]
            : ((args[0] as Record<string, unknown>)?.['text'] as string | undefined) ?? '';
        const result = origQuery(...args);
        result.then(() => {
          options.onQuery?.(queryText, Date.now() - start);
        }).catch((err: Error) => {
          options.onError?.(err, queryText);
        });
        return result;
      };
    });
  }

  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Verifies the database connection is healthy by executing SELECT 1.
 * Returns true on success, false on any error.
 */
export async function healthCheck(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

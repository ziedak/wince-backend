import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export interface DbOptions {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
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

  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

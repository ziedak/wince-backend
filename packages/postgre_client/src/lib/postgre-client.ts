import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface PostgresClientOptions {
  connectionString: string;
  /** Maximum number of pool connections (default 10) */
  max?: number;
  /** Connection idle timeout in ms (default 10000) */
  idleTimeoutMillis?: number;
  /** Connection acquire timeout in ms (default 30000) */
  connectionTimeoutMillis?: number;
}

/**
 * Creates a pg connection pool.
 * The caller is responsible for calling .end() on shutdown.
 */
export function createPool(options: PostgresClientOptions): Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 10_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 30_000,
  });
}

/**
 * Executes a parameterised query and returns typed rows.
 */
export async function query<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

/**
 * Acquires a client from the pool, runs `fn` inside a BEGIN/COMMIT block,
 * and rolls back on error.
 */
export async function transaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns true if the pool can reach the database.
 */
export async function healthCheck(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}


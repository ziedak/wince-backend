import { createClient, type ClickHouseClient } from '@clickhouse/client';

export type { ClickHouseClient };

export interface ClickhouseClientOptions {
  url: string;
  /** Optional HTTP username (default 'default') */
  username?: string;
  /** Optional HTTP password */
  password?: string;
  database?: string;
  /** Request timeout in ms (default 30000) */
  request_timeout?: number;
}

/**
 * Creates and returns a @clickhouse/client instance.
 * The caller is responsible for calling .close() on shutdown.
 */
export function createClickhouseClient(options: ClickhouseClientOptions): ClickHouseClient {
  return createClient({
    url: options.url,
    username: options.username ?? 'default',
    password: options.password ?? '',
    database: options.database,
    request_timeout: options.request_timeout ?? 30_000,
    compression: {
      request: true,
    },
  });
}

/**
 * Inserts rows into a ClickHouse table using the JSON format.
 */
export async function insert<T extends Record<string, unknown>>(
  client: ClickHouseClient,
  table: string,
  rows: T[],
): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({
    table,
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Executes a SELECT query and returns typed rows.
 */
export async function query<T>(client: ClickHouseClient, sql: string): Promise<T[]> {
  const result = await client.query({ query: sql, format: 'JSONEachRow' });
  return result.json<T>();
}

/**
 * Returns true if ClickHouse responds to a ping.
 */
export async function healthCheck(client: ClickHouseClient): Promise<boolean> {
  return client.ping().then(() => true).catch(() => false);
}


import Redis, { type RedisOptions } from 'ioredis';

export interface RedisClientOptions {
  url: string;
  /** Connection timeout in ms (default 5000) */
  connectTimeout?: number;
  /** Max retries per request (default 3) */
  maxRetriesPerRequest?: number;
}

/**
 * Creates and returns a connected ioredis client.
 * The caller is responsible for calling .quit() on shutdown.
 */
export function createRedisClient(options: RedisClientOptions): Redis {
  const opts: RedisOptions = {
    lazyConnect: false,
    connectTimeout: options.connectTimeout ?? 5000,
    maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
    enableReadyCheck: true,
  };
  return new Redis(options.url, opts);
}

// ─── Bloom filter helpers ────────────────────────────────────────────────

/**
 * Returns true if `item` MAY exist in the Bloom filter.
 * A false result is definitive (item is not present).
 */
export async function bfExists(
  client: Redis,
  filterKey: string,
  item: string,
): Promise<boolean> {
  const result = await client.call('BF.EXISTS', filterKey, item);
  return result === 1;
}

/**
 * Adds `item` to the Bloom filter. Returns true if the item was newly added,
 * false if it was already present (possible false positive).
 */
export async function bfAdd(
  client: Redis,
  filterKey: string,
  item: string,
): Promise<boolean> {
  const result = await client.call('BF.ADD', filterKey, item);
  return result === 1;
}

// ─── Generic key/value helpers ─────────────────────────────────────────────

export async function get<T>(client: Redis, key: string): Promise<T | null> {
  const raw = await client.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export async function set(
  client: Redis,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds !== undefined) {
    await client.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await client.set(key, serialized);
  }
}

export async function hset(
  client: Redis,
  key: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const flat: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    flat.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  await client.hset(key, ...flat);
}

export async function hgetall<T extends Record<string, unknown>>(
  client: Redis,
  key: string,
): Promise<T | null> {
  const result = await client.hgetall(key);
  if (!result || Object.keys(result).length === 0) return null;
  return result as unknown as T;
}

export async function expire(
  client: Redis,
  key: string,
  ttlSeconds: number,
): Promise<void> {
  await client.expire(key, ttlSeconds);
}


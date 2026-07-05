/**
 * Minimal interface for a Redis client as expected by the cache package.
 * Implementations can wrap ioredis directly (see @org/redis_client) or any
 * compatible Redis library.
 */
export interface ICacheRedisClient {
  isHealthy(): Promise<boolean>;
  ping(): Promise<void>;
  safeGet(key: string): Promise<string | null>;
  safeSetEx(key: string, ttl: number, value: string): Promise<void>;
  safeDel(...keys: string[]): Promise<void>;
  safeKeys(pattern: string): Promise<string[]>;
  safeMget(...keys: string[]): Promise<(string | null)[]>;
  exists(key: string): Promise<number>;
  getRedis(): {
    pipeline(): unknown;
    incr(key: string): Promise<number>;
    incrby(key: string, delta: number): Promise<number>;
    expire(key: string, ttl: number): Promise<number>;
    ttl(key: string): Promise<number>;
  };
  createSubscriber(): {
    on(event: 'connect' | 'error', handler: (arg?: unknown) => void): void;
    on(event: 'message', handler: (channel: string, message: string) => void): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    subscribe(channel: string): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    quit(): Promise<void>;
    disconnect(): Promise<void>;
  };
  safePublish(channel: string, message: string): Promise<number>;
}

import { createLogger } from '@org/logger'
import { Redis, RedisOptions, type RedisKey } from 'ioredis'
import { type IMetricsCollector } from '@org/types'

const REDIS_DEFAULT_OPTIONS: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: undefined,
  db: 0,
  username: undefined,
  maxRetriesPerRequest: 3,
  connectTimeout: 10000,
  commandTimeout: 5000,
  lazyConnect: false,
  keepAlive: 30000,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  family: 4,
  tls: {
    rejectUnauthorized: true,
  },
}

export class RedisClient {
  private readonly redis: Redis
  private isConnected = false
  private connectionLock = false // Prevent concurrent connection operations
  private eventHandlersAttached = false
  private retryCount = 0
  private readonly maxRetries = 3
  private readonly reconnectDelay = 1000
  private reconnectTimeout?: NodeJS.Timeout
  private readonly logger = createLogger({ service: 'RedisClient' })
  private options: RedisOptions
  constructor(
    private readonly metrics?: IMetricsCollector,
    redisOptions: RedisOptions = {}
  ) {
    this.options = { ...REDIS_DEFAULT_OPTIONS, ...redisOptions }
    this.redis = new Redis(this.options)
    this.setupEventHandlers()
    this.redis.connect().catch((err: Error) => {
      this.logger.error({ message: 'Redis initial connect failed', err })
    })
  }

  static create(
    config: RedisOptions = {},
    metrics?: IMetricsCollector
  ): RedisClient {
    return new RedisClient(metrics, config)
  }

  private setupEventHandlers(): void {
    if (this.eventHandlersAttached) {
      return // Prevent duplicate event handler attachment
    }

    this.redis.on('connect', async () => {
      this.logger.info('Redis connected')
      this.isConnected = true
      this.retryCount = 0
      await this.metrics?.recordCounter?.('redis_connection_success')
    })

    this.redis.on('ready', async () => {
      this.logger.info('Redis ready to accept commands')
      await this.metrics?.recordCounter?.('redis_ready')
    })

    this.redis.on('error', async (error: Error) => {
      this.logger.error({ message: 'Redis error', error })
      this.isConnected = false
      await this.metrics?.recordCounter?.('redis_connection_error')
    })

    this.redis.on('close', async () => {
      this.logger.info({ message: 'Redis connection closed' })
      this.isConnected = false
      await this.metrics?.recordCounter?.('redis_connection_closed')
      this.scheduleReconnect()
    })

    this.redis.on('reconnecting', async () => {
      this.logger.info({ message: 'Redis reconnecting...' })
      await this.metrics?.recordCounter?.('redis_reconnecting')
    })

    this.redis.on('end', async () => {
      this.logger.warn({ message: 'Redis connection ended' })
      this.isConnected = false
      await this.metrics?.recordCounter?.('redis_connection_ended')
    })

    this.eventHandlersAttached = true
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      delete this.reconnectTimeout
    }

    if (this.retryCount >= this.maxRetries) {
      this.logger.error(
        `Max reconnection attempts (${this.maxRetries}) reached`
      )
      return
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.retryCount),
      30000
    ) // Cap at 30 seconds
    this.retryCount++
    this.logger.info(
      `Scheduling Redis reconnection in ${delay}ms (attempt ${this.retryCount})`
    )

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect()
      } catch (error) {
        this.logger.error({ message: 'Scheduled reconnection failed', error })
      } finally {
        delete this.reconnectTimeout
      }
    }, delay)
  }

  async connect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug({
        message: 'Connection operation already in progress, waiting...',
      })
      return
    }

    if (
      this.isConnected ||
      (this.redis && this.redis.status === 'connecting')
    ) {
      return
    }

    this.connectionLock = true
    try {
      await this.redis.connect()
    } catch (error) {
      this.logger.error({ message: 'Redis connect() failed', error })
      throw error
    } finally {
      this.connectionLock = false
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug({
        message: 'Connection operation already in progress',
      })
      return
    }

    this.connectionLock = true
    try {
      // Clear any pending reconnection
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
        delete this.reconnectTimeout
      }

      if (this.redis) {
        await this.redis.quit()
        this.isConnected = false
        this.logger.info({ message: 'Redis disconnected' })
      }
    } catch (error) {
      this.logger.error({ message: 'Redis disconnect() failed', error })
    } finally {
      this.connectionLock = false
    }
  }

  async bfExists(filterKey: string, item: string): Promise<boolean> {
    const result = await this.redis.call('BF.EXISTS', filterKey, item)
    return result === 1
  }

  /**
   * Adds `item` to the Bloom filter. Returns true if the item was newly added,
   * false if it was already present (possible false positive).
   */
  async bfAdd(filterKey: string, item: string): Promise<boolean> {
    const result = await this.redis.call('BF.ADD', filterKey, item)
    return result === 1
  }

  async exists(...args: RedisKey[]): Promise<number> {
    if (!args.length) {
      this.logger.warn({ message: 'No keys provided to exists' })
      return 0
    }

    // Validate key count to prevent abuse
    if (args.length > 100) {
      this.logger.warn({
        message: 'Too many keys provided to exists',
        keyCount: args.length,
      })
      return 0
    }

    try {
      return await this.redis.exists(...args)
    } catch (error) {
      this.logger.warn({ message: 'Exists operation failed', error })
      return 0
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping()
      return result === 'PONG'
    } catch (error) {
      this.logger.error({ message: 'Redis ping failed', error })
      return false
    }
  }

  async safeSetEx(key: string, ttl: number, value: string): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ message: 'Invalid key provided to safeSetEx', key })
      return false
    }

    if (typeof value !== 'string') {
      this.logger.warn({
        message: 'Invalid value provided to safeSetEx',
        valueType: typeof value,
      })
      return false
    }

    if (!Number.isInteger(ttl) || ttl < 0 || ttl > 365 * 24 * 60 * 60) {
      this.logger.warn({ message: 'Invalid TTL provided to safeSetEx', ttl })
      return false
    }

    // Basic validation
    if (key.length > 512) {
      this.logger.warn({
        message: 'Key too long for safeSetEx',
        keyLength: key.length,
      })
      return false
    }

    if (value.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn({
        message: 'Value too large for safeSetEx',
        valueLength: value.length,
      })
      return false
    }

    try {
      await this.redis.setex(key, ttl, value)

      return true
    } catch (error) {
      this.logger.warn({ err: error }, `Safe setex failed for key ${key}`)
      return false
    }
  }

  async safeKeys(pattern: string): Promise<string[]> {
    if (!pattern || typeof pattern !== 'string') {
      this.logger.warn({
        message: 'Invalid pattern provided to safeKeys',
        pattern,
      })
      return []
    }

    // Prevent dangerous patterns that could scan all keys
    if (pattern === '*' || pattern === '*:*' || pattern.length < 2) {
      this.logger.warn({
        message: 'Dangerous pattern provided to safeKeys, blocking',
        pattern,
      })
      return []
    }

    // Limit pattern length
    if (pattern.length > 256) {
      this.logger.warn({
        message: 'Pattern too long for safeKeys',
        patternLength: pattern.length,
      })
      return []
    }

    try {
      return await Promise.resolve(this.redis.keys(pattern))
    } catch (error) {
      this.logger.warn({
        message: `Safe keys failed for pattern ${pattern}`,
        error,
      })
      return []
    }
  }

  async safeDel(...args: RedisKey[]): Promise<number> {
    if (!args.length) {
      this.logger.warn({ message: 'No keys provided to safeDel' })
      return 0
    }

    // Validate key count to prevent abuse
    if (args.length > 1000) {
      this.logger.warn({
        message: 'Too many keys provided to safeDel',
        keyCount: args.length,
      })
      return 0
    }

    // Validate each key
    for (const key of args) {
      if (!key || typeof key !== 'string' || key.length > 512) {
        this.logger.warn({ message: 'Invalid key provided to safeDel', key })
        return 0
      }
    }

    try {
      return Promise.resolve(this.redis.del(...args))
    } catch (error) {
      this.logger.warn({
        message: `Safe del failed for keys ${args.join(', ')}`,
        error,
      })
      return 0
    }
  }

  getRedis(): InstanceType<typeof Redis> {
    return this.redis
  }

  async safeMget(...args: RedisKey[]): Promise<(string | null)[]> {
    if (!args.length) {
      this.logger.warn({ message: 'No keys provided to safeMget' })
      return []
    }

    // Validate key count to prevent abuse
    if (args.length > 1000) {
      this.logger.warn({
        message: 'Too many keys provided to safeMget',
        keyCount: args.length,
      })
      return new Array(args.length).fill(null)
    }

    // Validate each key
    for (const key of args) {
      if (!key || typeof key !== 'string' || key.length > 512) {
        this.logger.warn({ message: 'Invalid key provided to safeMget', key })
        return new Array(args.length).fill(null)
      }
    }

    try {
      return await Promise.resolve(this.redis.mget(...args))
    } catch (error) {
      this.logger.warn({
        message: `Safe mget failed for keys ${args.join(', ')}`,
        error,
      })
      return new Array(args.length).fill(null)
    }
  }

  /**
   * Safe get operation with fallback and input validation
   */
  async safeGet(
    key: string,
    defaultValue: string | null = null
  ): Promise<string | null> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ key }, 'Invalid key provided to safeGet')
      return defaultValue
    }

    // Basic key validation - prevent extremely long keys
    if (key.length > 512) {
      this.logger.warn({ keyLength: key.length }, 'Key too long for safeGet')
      return defaultValue
    }

    try {
      const result = await this.redis.get(key)

      return result ?? defaultValue
    } catch (error) {
      this.logger.warn({ err: error }, `Safe get failed for key ${key}`)
      return defaultValue
    }
  }

  /**
   * Safe set operation with fallback and input validation
   */
  async safeSet(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ key }, 'Invalid key provided to safeSet')
      return false
    }

    if (typeof value !== 'string') {
      this.logger.warn(
        { valueType: typeof value },
        'Invalid value provided to safeSet'
      )
      return false
    }

    // Basic validation
    if (key.length > 512) {
      this.logger.warn({ keyLength: key.length }, 'Key too long for safeSet')
      return false
    }

    if (value.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn(
        { valueLength: value.length },
        'Value too large for safeSet'
      )
      return false
    }

    if (
      ttlSeconds !== undefined &&
      (ttlSeconds < 0 || ttlSeconds > 365 * 24 * 60 * 60)
    ) {
      // Max 1 year
      this.logger.warn({ ttlSeconds }, 'Invalid TTL provided to safeSet')
      return false
    }

    try {
      if (ttlSeconds) {
        await this.redis.set(key, value, 'EX', ttlSeconds)
      } else {
        await this.redis.set(key, value)
      }

      return true
    } catch (error) {
      this.logger.warn({ err: error }, `Safe set failed for key ${key}`)
      return false
    }
  }

  async healthCheck(): Promise<{
    status: string
    latency?: number
    connectionState?: string
    retryCount?: number
  }> {
    try {
      const start = Date.now()
      const isHealthy = await this.ping()
      const latency = Date.now() - start

      if (!isHealthy) {
        return {
          status: 'unhealthy',
          connectionState: this.redis?.status || 'unknown',
          retryCount: this.retryCount,
        }
      }

      return {
        status: 'healthy',
        latency,
        connectionState: this.redis?.status || 'unknown',
        retryCount: this.retryCount,
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Redis healthCheck failed')
      return {
        status: 'unhealthy',
        connectionState: this.redis?.status || 'unknown',
        retryCount: this.retryCount,
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.redis) {
      return false
    }
    if (!this.isConnected) {
      return false
    }

    try {
      await this.redis.ping()
      return true
    } catch {
      return false
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    isConnected: boolean
    retryCount: number
    connectionStatus: string
  } {
    return {
      isConnected: this.isConnected,
      retryCount: this.retryCount,
      connectionStatus: this.redis?.status || 'not_initialized',
    }
  }

  /**
   * Publish a message to a Redis channel with validation
   */
  async safePublish(channel: string, message: string): Promise<number> {
    if (!channel || typeof channel !== 'string') {
      this.logger.warn(
        `Invalid channel provided to safePublish channel:${channel}`
      )
      return 0
    }

    if (typeof message !== 'string') {
      this.logger.warn(
        `Invalid message provided to safePublish messageType:${typeof message}`
      )
      return 0
    }

    // Basic validation
    if (channel.length > 256) {
      this.logger.warn(
        `Channel name too long for safePublish channelLength:${channel.length}`
      )
      return 0
    }

    if (message.length > 1024 * 1024) {
      // 1MB limit
      this.logger.warn(
        `Message too large for safePublish messageLength:${message.length}`
      )
      return 0
    }

    try {
      return await this.redis.publish(channel, message)
    } catch (error) {
      this.logger.error(
        { err: error },
        `Failed to publish to channel ${channel}`
      )
      return 0
    }
  }

  /**
   * Subscribe to Redis channels
   * Returns a new Redis client for subscription (pub/sub requires separate connection)
   */
  createSubscriber(config?: Partial<RedisOptions>): {
    on(event: string, handler: (...args: unknown[]) => void): void
    subscribe(channel: string): Promise<void>
    unsubscribe(channel: string): Promise<void>
    quit(): Promise<void>
    disconnect(): Promise<void>
  } {
    const sub = new Redis({
      ...this.options,
      enableReadyCheck: false,
      lazyConnect: true,
      ...config,
    })
    return {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        void sub.on(event, handler as Parameters<typeof sub.on>[1]),
      subscribe: (channel: string) =>
        sub.subscribe(channel).then(() => undefined),
      unsubscribe: (channel: string) =>
        sub.unsubscribe(channel).then(() => undefined),
      quit: () => sub.quit().then(() => undefined),
      disconnect: () => Promise.resolve(sub.disconnect()),
    }
  }

  /**
   * Get a JSON-serialized value and parse it into T
   */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.safeGet(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      this.logger.warn({ key }, 'getJson failed to parse value')
      return null
    }
  }

  /**
   * Serialize value as JSON and store it with an optional TTL
   */
  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number
  ): Promise<boolean> {
    try {
      return await this.safeSet(key, JSON.stringify(value), ttlSeconds)
    } catch {
      this.logger.warn({ key }, 'setJson failed to serialize value')
      return false
    }
  }

  /**
   * Set multiple hash fields on a key
   */
  async hset(key: string, fields: Record<string, unknown>): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ key }, 'Invalid key provided to hset')
      return false
    }
    const flat: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      flat.push(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    try {
      await this.redis.hset(key, ...flat)
      return true
    } catch (error) {
      this.logger.warn({ err: error }, `hset failed for key ${key}`)
      return false
    }
  }

  /**
   * Get all fields of a hash as a typed object, or null if key doesn't exist
   */
  async hgetall<T extends Record<string, unknown>>(
    key: string
  ): Promise<T | null> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ key }, 'Invalid key provided to hgetall')
      return null
    }
    try {
      const result = await this.redis.hgetall(key)
      if (!result || Object.keys(result).length === 0) return null
      return result as unknown as T
    } catch (error) {
      this.logger.warn({ err: error }, `hgetall failed for key ${key}`)
      return null
    }
  }

  /**
   * Set a TTL (in seconds) on an existing key
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!key || typeof key !== 'string') {
      this.logger.warn({ key }, 'Invalid key provided to expire')
      return false
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) {
      this.logger.warn({ ttlSeconds }, 'Invalid TTL provided to expire')
      return false
    }
    try {
      await this.redis.expire(key, ttlSeconds)
      return true
    } catch (error) {
      this.logger.warn({ err: error }, `expire failed for key ${key}`)
      return false
    }
  }

  /**
   * Force reconnection with thread safety
   */
  async forceReconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.debug('Connection operation already in progress')
      return
    }

    this.connectionLock = true
    try {
      // Clear any pending reconnection
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
        delete this.reconnectTimeout
      }

      if (this.redis) {
        this.redis.disconnect()
      }
      this.retryCount = 0
      await this.connect()
    } catch (error) {
      this.logger.error({ err: error }, 'Force reconnection failed')
      throw error
    } finally {
      this.connectionLock = false
    }
  }
}

// ============================================================
// Standalone utility functions
// These operate on a raw ioredis instance (from RedisClient.getRedis())
// so they can be used in isolation and tested without the full class.
// ============================================================

/** Minimal interface covering only the ioredis methods these helpers use. */
interface RawRedis {
  call(cmd: string, ...args: (string | number)[]): Promise<unknown>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  hset(key: string, ...fieldValues: (string | number)[]): Promise<number>
  hgetall(key: string): Promise<Record<string, string> | null>
}

export async function bfExists(
  redis: RawRedis,
  filterKey: string,
  item: string
): Promise<boolean> {
  const result = await redis.call('BF.EXISTS', filterKey, item)
  return result === 1
}

export async function bfAdd(
  redis: RawRedis,
  filterKey: string,
  item: string
): Promise<boolean> {
  const result = await redis.call('BF.ADD', filterKey, item)
  return result === 1
}

export async function get<T>(redis: RawRedis, key: string): Promise<T | null> {
  const val = await redis.get(key)
  if (!val) return null
  return JSON.parse(val) as T
}

export async function set<T>(
  redis: RawRedis,
  key: string,
  value: T
): Promise<void> {
  await redis.set(key, JSON.stringify(value))
}

export async function hset(
  redis: RawRedis,
  key: string,
  fields: Record<string, string | number>
): Promise<void> {
  const args: (string | number)[] = []
  for (const [k, v] of Object.entries(fields)) {
    args.push(k, v)
  }
  await redis.hset(key, ...args)
}

export async function hgetall<T = Record<string, string>>(
  redis: RawRedis,
  key: string
): Promise<T | null> {
  const result = await redis.hgetall(key)
  if (!result || Object.keys(result).length === 0) return null
  return result as T
}

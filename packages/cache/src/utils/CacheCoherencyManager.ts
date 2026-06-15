/**
 * Cache Coherency Manager
 * Fixes Issue #5: Cache Coherency Gaps
 */

import { generateUUId } from '@org/utils';
import type { ICacheRedisClient } from '../interfaces/ICacheRedisClient.js';
import { createLogger } from '@org/logger';
export interface CoherencyEvent {
  type: 'invalidate' | 'update' | 'clear';
  key?: string;
  pattern?: string;
  timestamp: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface CoherencyConfig {
  enableDistributedInvalidation: boolean;
  invalidationChannel: string;
  heartbeatInterval: number;
  maxEventHistory: number;
  enableEventDeduplication: boolean;
}

const DEFAULT_COHERENCY_CONFIG: CoherencyConfig = {
  enableDistributedInvalidation: true,
  invalidationChannel: 'cache:coherency',
  heartbeatInterval: 30000, // 30 seconds
  maxEventHistory: 1000,
  enableEventDeduplication: true,
};

/**
 * Manages cache coherency across multiple cache levels and instances
 */
export class CacheCoherencyManager {
  private readonly config: CoherencyConfig;
  private readonly eventHistory: CoherencyEvent[] = [];
  private readonly pendingInvalidations = new Map<string, number>();
  private readonly instanceId: string;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private subscriber?: ReturnType<ICacheRedisClient['createSubscriber']>;

  private readonly logger = createLogger({ service: 'CacheCoherencyManager' });
  constructor(
    config: Partial<CoherencyConfig> = {},
    private readonly redisClient: ICacheRedisClient,
  ) {
    this.config = { ...DEFAULT_COHERENCY_CONFIG, ...config };
    this.instanceId = generateUUId('cache');

    this.logger.info(
      { instanceId: this.instanceId },
      'CacheCoherencyManager initialized',
    );

    if (this.config.enableDistributedInvalidation) {
      this.initializeDistributedInvalidation().catch((error) => {
        this.logger.error(
          { error },
          'Failed to initialize distributed invalidation',
        );
      });
    }

    this.startHeartbeat();
  }

  /**
   * Record a cache operation for coherency tracking
   */
  recordOperation(event: Omit<CoherencyEvent, 'timestamp' | 'source'>): void {
    const coherencyEvent: CoherencyEvent = {
      ...event,
      timestamp: Date.now(),
      source: this.instanceId,
    };

    this.addToHistory(coherencyEvent);

    // Broadcast invalidation events to other instances
    if (
      this.config.enableDistributedInvalidation &&
      (event.type === 'invalidate' || event.type === 'clear')
    ) {
      this.broadcastInvalidation(coherencyEvent).catch((error) => {
        this.logger.error({ error }, 'Failed to broadcast invalidation');
      });
    }
  }

  /**
   * Invalidate cache entry with coherency guarantees
   */
  async invalidateWithCoherency(
    key: string,
    cacheInstances: Array<{ invalidate: (key: string) => Promise<void> }>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const event: CoherencyEvent = {
      type: 'invalidate',
      key,
      timestamp: Date.now(),
      source: this.instanceId,
      ...(metadata && { metadata }),
    };

    // Track pending invalidation
    this.pendingInvalidations.set(key, Date.now());

    try {
      // Invalidate in all local cache instances
      await Promise.all(cacheInstances.map((cache) => cache.invalidate(key)));

      // Record successful operation
      this.recordOperation(event);

      this.logger.debug({}, 'Cache invalidation completed', {
        key,
        instances: cacheInstances.length,
      });
    } catch (error) {
      this.logger.error({}, 'Cache invalidation failed', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      // Remove from pending
      this.pendingInvalidations.delete(key);
    }
  }

  /**
   * Clear all caches with coherency guarantees
   */
  async clearWithCoherency(
    cacheInstances: Array<{ clear?: () => Promise<void> }>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const event: CoherencyEvent = {
      type: 'clear',
      timestamp: Date.now(),
      source: this.instanceId,
      ...(metadata && { metadata }),
    };

    try {
      // Clear all cache instances that support it
      const clearPromises = cacheInstances
        .map((cache) => cache.clear)
        .filter((clear): clear is () => Promise<void> => clear !== undefined)
        .map((clear) => clear());

      await Promise.all(clearPromises);

      // Record successful operation
      this.recordOperation(event);

      this.logger.info({}, 'Cache clear completed', {
        instances: cacheInstances.length,
      });
    } catch (error) {
      this.logger.error({}, 'Cache clear failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Initialize distributed invalidation
   */
  private async initializeDistributedInvalidation(): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn(
        'Redis client not available, distributed invalidation disabled',
      );
      return;
    }

    try {
      // Create subscriber for pub/sub
      this.subscriber = this.redisClient.createSubscriber();

      this.subscriber.on('connect', () => {
        this.logger.info('Distributed invalidation subscriber connected');
      });

      this.subscriber.on('error', (error: Error | unknown) => {
        this.logger.error(
          {},
          'Distributed invalidation subscriber error',
          error,
        );
      });

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === this.config.invalidationChannel) {
          this.handleDistributedInvalidation(message);
        }
      });

      await this.subscriber.subscribe(this.config.invalidationChannel);

      this.logger.info({}, 'Distributed invalidation initialized', {
        channel: this.config.invalidationChannel,
      });
    } catch (error) {
      this.logger.error(
        {},
        'Failed to initialize distributed invalidation',
        error as Error,
      );
    }
  }

  /**
   * Broadcast invalidation to other instances
   */
  private async broadcastInvalidation(event: CoherencyEvent): Promise<void> {
    if (!this.redisClient) {
      this.logger.debug({}, 'Redis client not available, skipping broadcast');
      return;
    }

    try {
      const message = JSON.stringify(event);
      const publishResult = await this.redisClient.safePublish(
        this.config.invalidationChannel,
        message,
      );

      this.logger.debug({}, 'Invalidation broadcasted', {
        key: event.key,
        type: event.type,
        messageSize: message.length,
        recipients: publishResult,
      });
    } catch (error) {
      this.logger.error({}, 'Failed to broadcast invalidation', {
        error: error instanceof Error ? error.message : String(error),
        event,
      });
    }
  }

  /**
   * Handle distributed invalidation messages (for future implementation)
   */
  handleDistributedInvalidation(message: string): void {
    try {
      const event: CoherencyEvent = JSON.parse(message);

      // Ignore our own events
      if (event.source === this.instanceId) {
        return;
      }

      // Check for duplicate events
      if (
        this.config.enableEventDeduplication &&
        this.isDuplicateEvent(event)
      ) {
        this.logger.debug({}, 'Duplicate invalidation event ignored', {
          key: event.key,
        });
        return;
      }

      this.addToHistory(event);

      // Handle the invalidation event
      this.logger.info({}, 'Received distributed invalidation', {
        type: event.type,
        key: event.key,
        source: event.source,
      });

      // Emit event for cache instances to handle
      this.emit('distributed-invalidation', event);
    } catch (error) {
      this.logger.error({}, 'Failed to handle distributed invalidation', {
        error: error instanceof Error ? error.message : String(error),
        message,
      });
    }
  }

  /**
   * Check if event is duplicate
   */
  private isDuplicateEvent(event: CoherencyEvent): boolean {
    const recentEvents = this.eventHistory.slice(-100); // Check last 100 events

    return recentEvents.some(
      (existing) =>
        existing.type === event.type &&
        existing.key === event.key &&
        existing.source === event.source &&
        Math.abs(existing.timestamp - event.timestamp) < 1000, // Within 1 second
    );
  }

  /**
   * Add event to history
   */
  private addToHistory(event: CoherencyEvent): void {
    this.eventHistory.push(event);

    // Trim history if it gets too large
    if (this.eventHistory.length > this.config.maxEventHistory) {
      this.eventHistory.splice(
        0,
        this.eventHistory.length - this.config.maxEventHistory,
      );
    }
  }

  /**
   * Start heartbeat for health monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch((error) => {
        this.logger.error({}, 'Heartbeat failed', error);
      });
    }, this.config.heartbeatInterval);
  }

  /**
   * Send heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    try {
      const heartbeat = {
        instanceId: this.instanceId,
        timestamp: Date.now(),
        pendingInvalidations: this.pendingInvalidations.size,
        eventHistorySize: this.eventHistory.length,
      };

      const heartbeatKey = `cache:heartbeat:${this.instanceId}`;
      const ttl = Math.ceil((this.config.heartbeatInterval * 2) / 1000);

      await this.redisClient.safeSetEx(
        heartbeatKey,
        ttl,
        JSON.stringify(heartbeat),
      );

      this.logger.debug({}, 'Heartbeat sent', heartbeat);
    } catch (error) {
      this.logger.error({}, 'Failed to send heartbeat', error as Error);
    }
  }

  /**
   * Get coherency statistics
   */
  getCoherencyStats(): {
    eventHistorySize: number;
    pendingInvalidations: number;
    recentEvents: CoherencyEvent[];
    instanceId: string;
  } {
    return {
      eventHistorySize: this.eventHistory.length,
      pendingInvalidations: this.pendingInvalidations.size,
      recentEvents: this.eventHistory.slice(-10), // Last 10 events
      instanceId: this.instanceId,
    };
  }

  /**
   * Get active cache instances from heartbeats
   */
  async getActiveCacheInstances(): Promise<string[]> {
    if (!this.redisClient) {
      return [];
    }

    try {
      const pattern = 'cache:heartbeat:*';
      const keys = await this.redisClient.safeKeys(pattern);

      const activeInstances: string[] = [];
      const currentTime = Date.now();

      // Check each heartbeat to see if it's still active
      for (const key of keys) {
        try {
          const heartbeatData = await this.redisClient.safeGet(key);
          if (heartbeatData) {
            const heartbeat = JSON.parse(heartbeatData);
            // Consider instance active if heartbeat is within 2x the interval
            if (
              currentTime - heartbeat.timestamp <
              this.config.heartbeatInterval * 2
            ) {
              activeInstances.push(heartbeat.instanceId);
            }
          }
        } catch (error) {
          // Skip malformed heartbeats
          this.logger.warn({ key, error }, 'Failed to parse heartbeat data');
        }
      }

      return activeInstances;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get active instances');
      return [];
    }
  }

  /**
   * Simple event emitter for coherency events
   */
  private readonly eventListeners = new Map<string, Function[]>();

  private emit(event: string, data: CoherencyEvent): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        this.logger.error({ event, error }, 'Event listener error');
      }
    });
  }

  /**
   * Subscribe to coherency events
   */
  on(
    event: 'distributed-invalidation',
    listener: (event: CoherencyEvent) => void,
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.push(listener);
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.config.invalidationChannel);
      await this.subscriber.disconnect();
    }

    // Remove our heartbeat
    if (this.redisClient) {
      try {
        const heartbeatKey = `cache:heartbeat:${this.instanceId}`;
        await this.redisClient.safeDel(heartbeatKey);
        this.logger.debug({}, 'Heartbeat cleanup completed');
      } catch (error) {
        this.logger.error({ error }, 'Failed to cleanup heartbeat');
      }
    }

    this.logger.info('CacheCoherencyManager destroyed');
  }
}

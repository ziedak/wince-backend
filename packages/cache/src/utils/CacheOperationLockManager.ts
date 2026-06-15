/**
 * Cache Operation Lock Manager
 * Fixes Issue #2: Race Condition in Cache Operations
 */

import { createLogger } from "@org/logger";

export interface LockOptions {
  timeout?: number; // Max wait time in ms
  retryInterval?: number; // Retry check interval in ms
}

export interface LockInfo {
  key: string;
  acquiredAt: number;
  expiresAt: number;
  operationType: string;
}

/**
 * Manages operation locks to prevent race conditions
 */
export class CacheOperationLockManager {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lockInfo = new Map<string, LockInfo>();
  private readonly logger = createLogger({ service: "CacheOperationLockManager" });
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    // Cleanup expired locks every 30 seconds
    this.cleanupTimer = setInterval(() => this.cleanupExpiredLocks(), 30000);
  }

  /**
   * Acquire a lock for a cache operation
   */
  async acquireLock<T>(
    key: string,
    operationType: string,
    operation: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const { timeout = 10000, retryInterval = 10 } = options;
    const lockKey = `${operationType}:${key}`;
    const startTime = Date.now();

    // Wait for existing lock to release if present
    while (this.locks.has(lockKey)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Lock acquisition timeout for ${lockKey} after ${timeout}ms`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }

    // Create the operation promise
    const operationPromise = this.executeWithLock(
      key,
      operationType,
      operation
    );

    // Store the lock
    this.locks.set(lockKey, operationPromise);
    this.lockInfo.set(lockKey, {
      key,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + timeout,
      operationType,
    });

    try {
      const result = await operationPromise;
      return result;
    } finally {
      // Always cleanup the lock
      this.locks.delete(lockKey);
      this.lockInfo.delete(lockKey);
    }
  }

  /**
   * Execute operation with lock tracking
   */
  private async executeWithLock<T>(
    key: string,
    operationType: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      this.logger.debug({ message: "Lock acquired", key, operationType });
      const result = await operation();

      const duration = performance.now() - startTime;
      this.logger.debug({ message: "Lock released", key, operationType, duration });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error({ message: "Operation failed under lock", key, operationType, duration, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Check if a lock exists for a key and operation
   */
  hasLock(key: string, operationType: string): boolean {
    return this.locks.has(`${operationType}:${key}`);
  }

  /**
   * Get active locks (for monitoring)
   */
  getActiveLocks(): LockInfo[] {
    return Array.from(this.lockInfo.values());
  }

  /**
   * Force release a lock (dangerous - use with caution)
   */
  forceReleaseLock(key: string, operationType: string): boolean {
    const lockKey = `${operationType}:${key}`;
    const released =
      this.locks.delete(lockKey) || this.lockInfo.delete(lockKey);

    if (released) {
      this.logger.warn({ message: "Lock force released", key, operationType });
    }

    return released;
  }

  /**
   * Cleanup expired locks
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [lockKey, info] of this.lockInfo.entries()) {
      if (now > info.expiresAt) {
        this.locks.delete(lockKey);
        this.lockInfo.delete(lockKey);
        cleanedCount++;

        this.logger.warn({ message: "Expired lock cleaned up", key: info.key, operationType: info.operationType, age: now - info.acquiredAt });
      }
    }

    if (cleanedCount > 0) {
      this.logger.info({ message: "Lock cleanup completed", cleanedCount });
    }
  }

  /**
   * Get lock statistics
   */
  getStats(): {
    activeLocks: number;
    longestHeldLock: number;
    averageLockAge: number;
  } {
    const now = Date.now();
    const locks = Array.from(this.lockInfo.values());

    if (locks.length === 0) {
      return { activeLocks: 0, longestHeldLock: 0, averageLockAge: 0 };
    }

    const ages = locks.map((lock) => now - lock.acquiredAt);
    const longestHeldLock = Math.max(...ages);
    const averageLockAge =
      ages.reduce((sum, age) => sum + age, 0) / ages.length;

    return {
      activeLocks: locks.length,
      longestHeldLock,
      averageLockAge,
    };
  }

  /**
   * Cleanup resources and stop background timers
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);

    // Force release all remaining locks
    const lockCount = this.locks.size;
    this.locks.clear();
    this.lockInfo.clear();

    if (lockCount > 0) {
      this.logger.warn({ message: "Lock manager destroyed with active locks", releasedLocks: lockCount });
    }

    this.logger.info({ message: "CacheOperationLockManager destroyed" } );
  }
}

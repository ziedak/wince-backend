/**
 * Memory Tracker Utility
 * Provides accurate memory usage tracking for cache entries
 */

import { createLogger } from '@org/logger';

/**
 * Memory usage information for a cache entry
 */
export interface MemoryInfo {
  keySize: number; // Size of the key string in bytes
  valueSize: number; // Size of the value in bytes
  metadataSize: number; // Size of metadata (timestamps, etc.)
  totalSize: number; // Total memory usage
  lastCalculated: number; // When size was last calculated
}

/**
 * Memory tracking configuration
 */
export interface MemoryTrackerConfig {
  maxMemoryMB: number; // Maximum memory in MB
  warningThresholdPercent: number; // Warning at this percentage
  criticalThresholdPercent: number; // Critical at this percentage
  enableDetailedTracking: boolean; // Track per-entry memory
  sizeCalculationInterval: number; // Recalculate sizes every N operations
}
export interface MemoryStats {
  totalUsageBytes: number;
  totalUsageMB: number;
  usagePercent: number;
  entryCount: number;
  averageEntrySize: number;
  largestEntries: Array<{ key: string; size: number }>;
  isWithinLimits: boolean;
}
/**
 * Default memory tracker configuration
 */
export const DEFAULT_MEMORY_TRACKER_CONFIG: MemoryTrackerConfig = {
  maxMemoryMB: 100, // 100MB default
  warningThresholdPercent: 80, // Warn at 80%
  criticalThresholdPercent: 95, // Critical at 95%
  enableDetailedTracking: true,
  sizeCalculationInterval: 100, // Recalculate every 100 operations
};

/**
 * Memory tracker for accurate cache memory management
 */
export class MemoryTracker {
  private config: MemoryTrackerConfig;
  private readonly memoryMap: Map<string, MemoryInfo> = new Map();
  private totalMemoryUsage: number = 0;
  private operationCount: number = 0;
  private readonly logger = createLogger({ service: 'MemoryTracker' });

  constructor(config: Partial<MemoryTrackerConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_TRACKER_CONFIG, ...config };
  }

  /**
   * Calculate the size of a JavaScript object in bytes
   */
  calculateObjectSize(obj: unknown): number {
    if (obj === null || obj === undefined) return 0;

    const type = typeof obj;

    switch (type) {
      case 'boolean':
        return 4; // 4 bytes for boolean
      case 'number':
        return (obj as number) % 1 === 0 ? 8 : 16; // 8 bytes for int, 16 for float
      case 'string':
        return (obj as string).length * 2; // 2 bytes per character (UTF-16)
      case 'object':
        if (Array.isArray(obj)) {
          return (
            obj.reduce(
              (size, item) => size + this.calculateObjectSize(item),
              0,
            ) + 8
          ); // +8 for array overhead
        }

        // For plain objects, calculate size of all properties
        {
          let size = 8; // Object overhead
          const objAsRecord = obj as Record<string, unknown>;
          for (const key in objAsRecord) {
            if (Object.prototype.hasOwnProperty.call(objAsRecord, key)) {
              size += this.calculateObjectSize(key); // Key size
              size += this.calculateObjectSize(objAsRecord[key]); // Value size
            }
          }
          return size;
        }

      default:
        return 8; // Default overhead for other types
    }
  }

  /**
   * Calculate memory info for a cache entry
   */
  private calculateMemoryInfo(
    key: string,
    value: unknown,
    metadata?: unknown,
  ): MemoryInfo {
    const keySize = this.calculateObjectSize(key);
    const valueSize = this.calculateObjectSize(value);
    const metadataSize = metadata ? this.calculateObjectSize(metadata) : 0;

    return {
      keySize,
      valueSize,
      metadataSize,
      totalSize: keySize + valueSize + metadataSize,
      lastCalculated: Date.now(),
    };
  }

  /**
   * Track memory usage for a cache entry
   */
  trackEntry(key: string, value: unknown, metadata?: unknown): MemoryInfo {
    const memoryInfo = this.calculateMemoryInfo(key, value, metadata);

    // Update or add entry
    const existing = this.memoryMap.get(key);
    if (existing) {
      this.totalMemoryUsage -= existing.totalSize;
    }

    this.memoryMap.set(key, memoryInfo);
    this.totalMemoryUsage += memoryInfo.totalSize;

    this.operationCount++;
    this.checkMemoryThresholds();

    return memoryInfo;
  }

  /**
   * Remove memory tracking for an entry
   */
  removeEntry(key: string): boolean {
    const existing = this.memoryMap.get(key);
    if (existing) {
      this.memoryMap.delete(key);
      this.totalMemoryUsage -= existing.totalSize;
      return true;
    }
    return false;
  }

  /**
   * Get memory info for a specific entry
   */
  getEntryMemoryInfo(key: string): MemoryInfo | null {
    return this.memoryMap.get(key) ?? null;
  }

  /**
   * Get total memory usage in bytes
   */
  getTotalMemoryUsage(): number {
    return this.totalMemoryUsage;
  }

  /**
   * Get total memory usage in MB
   */
  getTotalMemoryUsageMB(): number {
    return this.totalMemoryUsage / (1024 * 1024);
  }

  /**
   * Get memory usage percentage
   */
  getMemoryUsagePercent(): number {
    const maxBytes = this.config.maxMemoryMB * 1024 * 1024;
    return maxBytes > 0 ? (this.totalMemoryUsage / maxBytes) * 100 : 0;
  }

  /**
   * Check if memory usage is within limits
   */
  isWithinLimits(): boolean {
    return this.getMemoryUsagePercent() < this.config.criticalThresholdPercent;
  }

  /**
   * Check memory thresholds and log warnings
   */
  private checkMemoryThresholds(): void {
    const usagePercent = this.getMemoryUsagePercent();

    if (usagePercent >= this.config.criticalThresholdPercent) {
      this.logger.error({
        message: 'Critical memory usage threshold exceeded',
        usagePercent: Math.round(usagePercent),
        threshold: this.config.criticalThresholdPercent,
        totalMB: Math.round(this.getTotalMemoryUsageMB()),
        maxMB: this.config.maxMemoryMB,
      });
    } else if (usagePercent >= this.config.warningThresholdPercent) {
      this.logger.warn({
        message: 'Memory usage warning threshold exceeded',
        usagePercent: Math.round(usagePercent),
        threshold: this.config.warningThresholdPercent,
        totalMB: Math.round(this.getTotalMemoryUsageMB()),
        maxMB: this.config.maxMemoryMB,
      });
    }
  }

  /**
   * Get entries sorted by memory usage (largest first)
   */
  getLargestEntries(
    limit: number = 10,
  ): Array<{ key: string; memoryInfo: MemoryInfo }> {
    return Array.from(this.memoryMap.entries())
      .map(([key, memoryInfo]) => ({ key, memoryInfo }))
      .sort((a, b) => b.memoryInfo.totalSize - a.memoryInfo.totalSize)
      .slice(0, limit);
  }

  /**
   * Get memory statistics
   */

  getMemoryStats(): MemoryStats {
    const largestEntries = this.getLargestEntries(5).map(
      ({ key, memoryInfo }) => ({
        key,
        size: memoryInfo.totalSize,
      }),
    );

    return {
      totalUsageBytes: this.totalMemoryUsage,
      totalUsageMB: this.getTotalMemoryUsageMB(),
      usagePercent: this.getMemoryUsagePercent(),
      entryCount: this.memoryMap.size,
      averageEntrySize:
        this.memoryMap.size > 0
          ? this.totalMemoryUsage / this.memoryMap.size
          : 0,
      largestEntries,
      isWithinLimits: this.isWithinLimits(),
    };
  }

  /**
   * Clear all memory tracking
   */
  clear(): void {
    this.memoryMap.clear();
    this.totalMemoryUsage = 0;
    this.operationCount = 0;
    this.logger.info({ message: 'Memory tracker cleared' });
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryTrackerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MemoryTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info({
      message: 'Memory tracker configuration updated',
      config: this.config,
    });
  }
}

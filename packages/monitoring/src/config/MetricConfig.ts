// ===================================================================
// PROMETHEUS METRICS CONFIGURATION
// ===================================================================

/**
 * Optimized histogram buckets for different use cases
 */
export const METRIC_BUCKETS = {
  // API response times (optimized for Elysia performance)
  API_DURATION: [
    0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
  ],

  // Database operation times
  DATABASE_DURATION: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],

  // Cache operation times (should be very fast)
  CACHE_DURATION: [0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],

  // Business process durations
  BUSINESS_DURATION: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],

  // File sizes
  FILE_SIZE: [1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216], // 1KB to 16MB

  // Queue sizes
  QUEUE_SIZE: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
} as const;

/**
 * Metric configuration with cardinality protection
 */
export interface MetricConfig {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
  maxLabels?: number; // Cardinality protection
  ttl?: number; // Auto-cleanup TTL in seconds
}

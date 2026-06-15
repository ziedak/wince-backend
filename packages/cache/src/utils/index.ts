/**
 * Cache Utils
 * Utility modules for advanced cache functionality
 */

export {
  MemoryTracker,
  type MemoryTrackerConfig,
  type MemoryInfo,
} from "./MemoryTracker.js";

export {
  compressGzip,
  decompressGzip,
  compressDeflate,
  decompressDeflate,
  smartCompress,
  isCompressionWorthwhile,
} from "./CompressionEngine.js";

export {
  CacheOperationLockManager,
  type LockOptions,
  type LockInfo,
} from "./CacheOperationLockManager.js";

export {
  CacheConfigValidator,
  type ValidationResult,
  type ConfigValidationOptions,
} from "./CacheConfigValidator.js";

export {
  CacheCoherencyManager,
  type CoherencyEvent,
  type CoherencyConfig,
} from "./CacheCoherencyManager.js";

export {
  compress,
  decompress,
  calculateDataSize,
  type CompressionAlgorithm,
  type CompressionConfig,
  type CompressionStats,
  type CompressionResult,
  type DecompressionResult,
  DEFAULT_COMPRESSION_CONFIG,
} from "./CacheCompressor.js";

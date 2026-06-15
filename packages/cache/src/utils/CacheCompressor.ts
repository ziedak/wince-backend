/**
 * Cache Compression Utilities
 * Provides compression and decompression for cache entries
 * Functional implementation for better testability and composability
 */

import {
  compressGzip,
  decompressGzip,
  compressDeflate,
  decompressDeflate,
  smartCompress,
  isCompressionWorthwhile,
} from "./CompressionEngine.js";

/**
 * Compression algorithm types
 */
export type CompressionAlgorithm =
  | "gzip"
  | "deflate"
  | "brotli"
  | "lz4"
  | "none";

/**
 * Compression configuration
 */
export interface CompressionConfig {
  algorithm: CompressionAlgorithm;
  level: number; // Compression level (1-9)
  thresholdBytes: number; // Minimum size to compress
  enableCompression: boolean;
  fallbackOnError: boolean; // Use uncompressed if compression fails
}

/**
 * Default compression configuration
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  algorithm: "gzip",
  level: 6, // Good balance of speed/size
  thresholdBytes: 1024, // Compress objects > 1KB
  enableCompression: true,
  fallbackOnError: true,
};
export interface DecompressionConfig
  extends Omit<
    CompressionConfig,
    "enableCompression" | "thresholdBytes" | "level"
  > {}

export const DEFAULT_DECOMPRESSION_CONFIG: Omit<
  CompressionConfig,
  "enableCompression" | "thresholdBytes" | "level"
> = {
  algorithm: "gzip",
  fallbackOnError: true,
};

/**
 * Compression statistics
 */
export interface CompressionStats {
  totalCompressed: number;
  totalUncompressed: number;
  compressionRatio: number;
  averageCompressionTime: number;
  compressionErrors: number;
  decompressionErrors: number;
}

/**
 * Compression result
 */
export interface CompressionResult {
  data: unknown;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  compressionTime: number;
  algorithm: CompressionAlgorithm;
}

export interface DecompressionResult {
  data: unknown;
  originalSize: number;
  compressedSize: number;
  decompressionTime: number;
  algorithm: CompressionAlgorithm;
}

/**
 * Internal compressed data structure
 */
interface InternalCompressedData {
  algorithm: CompressionAlgorithm;
  compressed: boolean;
  data: unknown;
  originalSize: number;
  compressedSize: number;
  compressionTime: number;
  compressionRatio: number;
}

/**
 * Compress data if it meets the threshold (pure function)
 */
export async function compress(
  data: unknown,
  config: CompressionConfig
): Promise<CompressionResult> {
  const startTime = performance.now();
  const originalSize = calculateDataSize(data);

  try {
    const jsonString = JSON.stringify(data);

    // Use CompressionEngine to check if compression is worthwhile
    const compressionCheck = isCompressionWorthwhile(
      jsonString,
      config.thresholdBytes
    );

    if (!compressionCheck.shouldCompress) {
      return {
        data,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
        compressionTime: performance.now() - startTime,
        algorithm: "none",
      };
    }

    // Use smart compression for gzip/deflate algorithms
    let compressedData: InternalCompressedData;
    if (config.algorithm === "gzip" || config.algorithm === "deflate") {
      const smartResult = await smartCompress(jsonString, {
        level: config.level,
        forceAlgorithm: config.algorithm as "gzip" | "deflate",
      });

      compressedData = {
        algorithm: smartResult.algorithm as CompressionAlgorithm,
        compressed: true,
        data: smartResult.data,
        originalSize: smartResult.originalSize,
        compressedSize: smartResult.compressedSize,
        compressionTime: smartResult.compressionTime,
        compressionRatio: smartResult.compressionRatio,
      };
    } else {
      // Fall back to regular compression for other algorithms
      compressedData = (await compressData(data)) as InternalCompressedData;
    }

    const compressionTime = performance.now() - startTime;

    return {
      data: compressedData,
      compressed: true,
      originalSize,
      compressedSize:
        compressedData.compressedSize || calculateDataSize(compressedData),
      compressionTime,
      algorithm: config.algorithm,
    };
  } catch (error) {
    if (!config.fallbackOnError) {
      throw error;
    }

    return {
      data,
      compressed: false,
      originalSize,
      compressedSize: originalSize,
      compressionTime: performance.now() - startTime,
      algorithm: "none",
    };
  }
}

/**
 * Decompress data if it was compressed (pure function)
 */
export async function decompress(
  compressedData: unknown,
  config: DecompressionConfig
): Promise<DecompressionResult> {
  const startTime = performance.now();

  try {
    const decompressedData = await decompressData(
      compressedData,
      config.algorithm
    );
    const decompressionTime = performance.now() - startTime;

    return {
      data: decompressedData,
      originalSize: calculateDataSize(decompressedData),
      compressedSize: calculateDataSize(compressedData),
      decompressionTime,
      algorithm: config.algorithm,
    };
  } catch (error) {
    if (!config.fallbackOnError) {
      throw error;
    }

    // Return original data if decompression fails
    const decompressionTime = performance.now() - startTime;
    const originalSize = calculateDataSize(compressedData);
    return {
      data: compressedData,
      originalSize,
      compressedSize: originalSize,
      decompressionTime,
      algorithm: config.algorithm,
    };
  }
}

/**
 * Compress data using the configured algorithm (pure function)
 */
async function compressData(
  data: unknown,
  algorithm: CompressionAlgorithm = "gzip"
): Promise<unknown> {
  const jsonString = JSON.stringify(data);

  switch (algorithm) {
    case "gzip":
      return gzipCompress(jsonString);
    case "deflate":
      return deflateCompress(jsonString);
    case "brotli":
    case "lz4":
    default:
      throw new Error(`Unsupported compression algorithm: ${algorithm}`);
  }
}

/**
 * Decompress data using the specified algorithm (pure function)
 */
async function decompressData(
  compressedData: unknown,
  algorithm: CompressionAlgorithm
): Promise<unknown> {
  let decompressedString: string;

  switch (algorithm) {
    case "gzip":
      decompressedString = await gzipDecompress(compressedData);
      break;
    case "deflate":
      decompressedString = await deflateDecompress(compressedData);
      break;
    case "brotli":
    case "lz4":
    default:
      throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
  }

  return JSON.parse(decompressedString);
}

/**
 * Gzip compression using production-grade CompressionEngine (pure function)
 */
async function gzipCompress(data: string, level?: number): Promise<unknown> {
  const result = await compressGzip(data, level);
  return {
    algorithm: "gzip",
    compressed: true,
    data: result.data,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    compressionTime: result.compressionTime,
    compressionRatio: result.compressionRatio,
  };
}

async function gzipDecompress(compressedData: unknown): Promise<string> {
  const data = compressedData as InternalCompressedData;
  if (data.algorithm !== "gzip" || !data.compressed) {
    throw new Error("Invalid gzip compressed data");
  }
  return decompressGzip(data.data as Buffer);
}

/**
 * Deflate compression using production-grade CompressionEngine (pure function)
 */
async function deflateCompress(data: string, level?: number): Promise<unknown> {
  const result = await compressDeflate(data, level);
  return {
    algorithm: "deflate",
    compressed: true,
    data: result.data,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    compressionTime: result.compressionTime,
    compressionRatio: result.compressionRatio,
  };
}

async function deflateDecompress(compressedData: unknown): Promise<string> {
  const data = compressedData as InternalCompressedData;
  if (data.algorithm !== "deflate" || !data.compressed) {
    throw new Error("Invalid deflate compressed data");
  }
  return decompressDeflate(data.data as Buffer);
}

/**
 * Calculate data size in bytes (pure function)
 */
export function calculateDataSize(data: unknown): number {
  if (data === null || data === undefined) return 0;

  if (typeof data === "string") {
    return data.length * 2; // UTF-16
  }

  if (typeof data === "number") {
    return data % 1 === 0 ? 8 : 16; // int vs float
  }

  if (typeof data === "boolean") {
    return 4;
  }

  // For objects and arrays, serialize and measure
  try {
    const jsonString = JSON.stringify(data);
    return jsonString.length * 2;
  } catch {
    return 8; // Fallback size
  }
}

/**
 * Real Compression Engine Implementation
 * Functional approach for better testability and composability
 */

import { gzip, gunzip, deflate, inflate } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export interface CompressionResult {
  data: Buffer | string;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  compressionTime: number;
  algorithm: string;
  compressionRatio: number;
}

/**
 * Compress data using gzip (pure function)
 */
export async function compressGzip(
  data: string,
  level: number = 6
): Promise<CompressionResult> {
  const startTime = performance.now();
  const originalBuffer = Buffer.from(data, "utf8");
  const originalSize = originalBuffer.length;

  try {
    const compressedBuffer = await gzipAsync(originalBuffer, { level });
    const compressedSize = compressedBuffer.length;
    const compressionTime = performance.now() - startTime;
    const compressionRatio = compressedSize / originalSize;

    return {
      data: compressedBuffer,
      compressed: true,
      originalSize,
      compressedSize,
      compressionTime,
      algorithm: "gzip",
      compressionRatio,
    };
  } catch (error) {
    throw new Error(
      `Gzip compression failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Decompress gzip data (pure function)
 */
export async function decompressGzip(compressedData: Buffer): Promise<string> {
  try {
    const decompressedBuffer = await gunzipAsync(compressedData);
    return decompressedBuffer.toString("utf8");
  } catch (error) {
    throw new Error(
      `Gzip decompression failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Compress data using deflate (pure function)
 */
export async function compressDeflate(
  data: string,
  level: number = 6
): Promise<CompressionResult> {
  const startTime = performance.now();
  const originalBuffer = Buffer.from(data, "utf8");
  const originalSize = originalBuffer.length;

  try {
    const compressedBuffer = await deflateAsync(originalBuffer, { level });
    const compressedSize = compressedBuffer.length;
    const compressionTime = performance.now() - startTime;
    const compressionRatio = compressedSize / originalSize;

    return {
      data: compressedBuffer,
      compressed: true,
      originalSize,
      compressedSize,
      compressionTime,
      algorithm: "deflate",
      compressionRatio,
    };
  } catch (error) {
    throw new Error(
      `Deflate compression failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Decompress deflate data (pure function)
 */
export async function decompressDeflate(
  compressedData: Buffer
): Promise<string> {
  try {
    const decompressedBuffer = await inflateAsync(compressedData);
    return decompressedBuffer.toString("utf8");
  } catch (error) {
    throw new Error(
      `Deflate decompression failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Smart compression - chooses best algorithm based on data characteristics (pure function)
 */
export async function smartCompress(
  data: string,
  options: {
    level?: number;
    forceAlgorithm?: "gzip" | "deflate";
    maxCompressionTime?: number;
  } = {}
): Promise<CompressionResult> {
  const { level = 6, forceAlgorithm, maxCompressionTime = 100 } = options;

  if (forceAlgorithm) {
    return forceAlgorithm === "gzip"
      ? compressGzip(data, level)
      : compressDeflate(data, level);
  }

  // Try both algorithms and pick the better one
  const [gzipResult, deflateResult] = await Promise.allSettled([
    compressGzip(data, level),
    compressDeflate(data, level),
  ]);

  const results: CompressionResult[] = [];

  if (
    gzipResult.status === "fulfilled" &&
    gzipResult.value.compressionTime <= maxCompressionTime
  ) {
    results.push(gzipResult.value);
  }

  if (
    deflateResult.status === "fulfilled" &&
    deflateResult.value.compressionTime <= maxCompressionTime
  ) {
    results.push(deflateResult.value);
  }

  if (results.length === 0) {
    throw new Error("All compression algorithms failed or exceeded time limit");
  }

  // Return the result with better compression ratio
  return results.reduce((best, current) =>
    current.compressionRatio < best.compressionRatio ? current : best
  );
}

/**
 * Check if data is worth compressing (pure function)
 */
export function isCompressionWorthwhile(
  data: string,
  thresholdBytes: number = 1024
): { shouldCompress: boolean; reason: string; dataSize: number } {
  const dataSize = Buffer.byteLength(data, "utf8");

  if (dataSize < thresholdBytes) {
    return {
      shouldCompress: false,
      reason: `Data size (${dataSize}B) below threshold (${thresholdBytes}B)`,
      dataSize,
    };
  }

  // Check for highly repetitive data (likely to compress well)
  const uniqueChars = new Set(data).size;
  const compressionPotential = 1 - uniqueChars / data.length;

  if (compressionPotential < 0.1) {
    return {
      shouldCompress: false,
      reason: `Low compression potential (${(
        compressionPotential * 100
      ).toFixed(1)}%)`,
      dataSize,
    };
  }

  return {
    shouldCompress: true,
    reason: `Good compression candidate (${(compressionPotential * 100).toFixed(
      1
    )}% potential)`,
    dataSize,
  };
}

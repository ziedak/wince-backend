export type ExecuteWithRetryOptions = {
  operationName: string;
  maxRetries: number;
  retryDelay: number;
};

import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  retry,
  handleAll,
  circuitBreaker,
  wrap,
} from 'cockatiel';
/**
 * Enhanced options for retry operations with circuit breaker and metrics
 */
export interface RetryOptions extends ExecuteWithRetryOptions {
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  enableMetrics?: boolean;
  jitterEnabled?: boolean;
}

/**
 * Execute operation with retry logic, optional circuit breaker, and metrics
 *
 * Uses cockatiel library for robust retry and circuit breaker policies when enabled.
 *
 * @template T - Return type of the operation
 * @param operation - Async operation to execute
 * @param onError - Error callback for logging/monitoring (called with error and attempt number)
 * @param options - Configuration for retry behavior
 * @param metrics - Optional metrics collector for recording operation statistics
 * @returns Promise resolving to operation result
 *
 * @example
 * ```typescript
 * // Basic retry
 * const result = await executeWithRetry(
 *   async () => fetchData(),
 *   (error) => logger.error('Operation failed', error),
 *   { operationName: 'fetchData', maxRetries: 3 }
 * );
 *
 * // With circuit breaker
 * const result = await executeWithRetry(
 *   async () => redis.get('key'),
 *   (error) => logger.error('Redis failed', error),
 *   {
 *     operationName: 'redis_get',
 *     maxRetries: 3,
 *     enableCircuitBreaker: true,
 *     circuitBreakerThreshold: 5
 *   }
 * );
 * ```
 */
export const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  onError: (error: unknown, attempt?: number) => void,
  options: Partial<RetryOptions> = {},
  metrics?: any,
): Promise<T> => {
  const config: Required<RetryOptions> = {
    operationName: 'Unknown Operation',
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: false,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 10000,
    enableMetrics: false,
    jitterEnabled: true,
    ...options,
  };

  const startTime = performance.now();

  try {
    let result: T;

    if (config.enableCircuitBreaker) {
      // Use cockatiel for retry + circuit breaker
      const retryPolicy = retry(handleAll, {
        maxAttempts: config.maxRetries,
        backoff: new ExponentialBackoff(),
      });

      const circuitBreakerPolicy = circuitBreaker(handleAll, {
        halfOpenAfter: config.circuitBreakerTimeout,
        breaker: new ConsecutiveBreaker(config.circuitBreakerThreshold),
      });

      const retryWithBreaker = wrap(retryPolicy, circuitBreakerPolicy);

      result = await retryWithBreaker.execute(operation);
    } else {
      // Use custom retry logic with jitter
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
          result = await operation();
          break; // Success, exit retry loop
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(`Unknown error in ${config.operationName}`);

          onError(lastError, attempt);

          if (attempt === config.maxRetries) {
            throw new Error(
              `[executeWithRetry] ${config.operationName} failed after ${config.maxRetries} attempts. Last error: ${lastError.message}`,
            );
          }

          // Calculate delay with exponential backoff and optional jitter
          let delay = config.retryDelay * Math.pow(2, attempt - 1);
          if (config.jitterEnabled) {
            delay = delay * (0.5 + Math.random() * 0.5);
          }

          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(delay)),
          );
        }
      }
    }

    // Record success metrics
    if (config.enableMetrics && metrics) {
      try {
        metrics.recordTimer(
          `${config.operationName}_duration`,
          performance.now() - startTime,
        );
        metrics.recordCounter(`${config.operationName}_success`);
      } catch (metricsError) {
        console.warn('Failed to record success metrics:', metricsError);
      }
    }

    return result!;
  } catch (error) {
    // Record failure metrics
    if (config.enableMetrics && metrics) {
      try {
        metrics.recordTimer(
          `${config.operationName}_duration`,
          performance.now() - startTime,
        );
        metrics.recordCounter(`${config.operationName}_failed`);
      } catch (metricsError) {
        console.warn('Failed to record failure metrics:', metricsError);
      }
    }

    throw error; // Re-throw the error
  }
};

/**
 * Execute Redis operation with enhanced retry logic and type safety
 * Specialized version for Redis operations with proper typing and optimized defaults
 *
 * @template T - Return type of the Redis operation
 * @template R - Redis client type (defaults to any for flexibility)
 */
export const executeRedisWithRetry = async <T, R = any>(
  redis: R,
  operation: (redis: R) => Promise<T>,
  onError: (error: unknown, attempt?: number) => void,
  options?: Partial<RetryOptions>,
): Promise<T> => {
  if (!redis) {
    throw new Error(
      `[executeRedisWithRetry] Redis client is required for operation`,
    );
  }

  // Set Redis-optimized defaults
  const redisOptions: Partial<RetryOptions> = {
    operationName: 'redis_operation',
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 10000,
    enableMetrics: true,
    jitterEnabled: true,
    ...options,
  };

  // Wrap the Redis operation
  const wrappedOperation = () => operation(redis);

  // Use the unified retry function
  return executeWithRetry(wrappedOperation, onError, redisOptions);
};

/**
 * WebSocket-specific retry options extending base retry functionality
 */
export interface WebSocketRetryOptions extends RetryOptions {
  /** Connection identifier for per-connection circuit breaker state */
  connectionId?: string;
  /** WebSocket connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Grace period during operation to keep connection alive */
  gracePeriod?: number;
  /** Whether this is a real-time critical operation */
  isRealTime?: boolean;
  /** Maximum concurrent operations per connection */
  maxConcurrentOperations?: number;
  /** WebSocket-specific error handling */
  handleWebSocketErrors?: boolean;
  /** Connection health check function */
  connectionHealthCheck?: () => Promise<boolean>;
}

/**
 * WebSocket operation context for tracking connection state
 */
export interface WebSocketOperationContext {
  connectionId: string;
  operationId: string;
  startTime: number;
  isRealTime: boolean;
  gracePeriodExpiry?: number;
  retryCount: number;
  lastError?: Error;
}

/**
 * WebSocket-specific error types
 */
export enum WebSocketErrorType {
  CONNECTION_LOST = 'CONNECTION_LOST',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  GRACE_PERIOD_EXPIRED = 'GRACE_PERIOD_EXPIRED',
  CONCURRENT_LIMIT_EXCEEDED = 'CONCURRENT_LIMIT_EXCEEDED',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
}

/**
 * Enhanced WebSocket error with context
 */
export class WebSocketOperationError extends Error {
  constructor(
    message: string,
    public readonly errorType: WebSocketErrorType,
    public readonly connectionId: string,
    public readonly operationId: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WebSocketOperationError';
  }
}

/**
 * Execute WebSocket operation with enhanced retry logic, circuit breaker, and real-time considerations
 *
 * Specialized for WebSocket operations with connection state management, grace periods,
 * and real-time operation handling. Includes per-connection circuit breaker state
 * and WebSocket-specific error handling.
 *
 * @template T - Return type of the WebSocket operation
 * @param operation - Async WebSocket operation to execute
 * @param onError - Error callback with WebSocket context
 * @param options - WebSocket-specific retry configuration
 * @param metrics - Optional metrics collector for recording operation statistics
 * @returns Promise resolving to operation result
 *
 * @example
 * ```typescript
 * // Token refresh for WebSocket connection
 * const result = await executeWebSocketWithRetry(
 *   async () => await keycloakClient.refreshToken(token),
 *   (error, context) => logger.error('WebSocket token refresh failed', {
 *     connectionId: context.connectionId,
 *     error: error.message
 *   }),
 *   {
 *     operationName: 'websocket_token_refresh',
 *     connectionId: 'ws_conn_123',
 *     maxRetries: 3,
 *     connectionTimeout: 30000,
 *     gracePeriod: 10000,
 *     isRealTime: true,
 *     enableCircuitBreaker: true,
 *     circuitBreakerThreshold: 5,
 *     enableMetrics: true
 *   },
 *   metricsCollector
 * );
 *
 * // Real-time message sending with connection health check
 * const messageResult = await executeWebSocketWithRetry(
 *   async () => await websocket.send(message),
 *   (error, context) => logger.error('WebSocket message failed', error),
 *   {
 *     operationName: 'websocket_send_message',
 *     connectionId: 'ws_conn_456',
 *     maxRetries: 2,
 *     connectionTimeout: 5000,
 *     isRealTime: true,
 *     connectionHealthCheck: async () => websocket.readyState === WebSocket.OPEN,
 *     handleWebSocketErrors: true
 *   }
 * );
 * ```
 */
export const executeWebSocketWithRetry = async <T>(
  operation: () => Promise<T>,
  onError: (
    error: unknown,
    context: WebSocketOperationContext,
    attempt?: number,
  ) => void,
  options: Partial<WebSocketRetryOptions> = {},
  metrics?: any,
): Promise<T> => {
  const config: WebSocketRetryOptions = {
    operationName: 'websocket_operation',
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 30000, // Longer for WebSocket operations
    enableMetrics: true,
    jitterEnabled: true,
    connectionId: `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    connectionTimeout: 30000,
    gracePeriod: 10000,
    isRealTime: false,
    maxConcurrentOperations: 3,
    handleWebSocketErrors: true,
    ...options,
  };

  // Ensure required properties are not undefined
  const safeConfig = {
    ...config,
    connectionId:
      config.connectionId ||
      `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    connectionTimeout: config.connectionTimeout ?? 30000,
    gracePeriod: config.gracePeriod ?? 10000,
    isRealTime: config.isRealTime ?? false,
    maxConcurrentOperations: config.maxConcurrentOperations ?? 3,
    circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
    circuitBreakerTimeout: config.circuitBreakerTimeout ?? 30000,
  };

  const operationId = `${config.operationName}_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  const startTime = performance.now();

  // Initialize operation context
  const context: WebSocketOperationContext = {
    connectionId: safeConfig.connectionId,
    operationId,
    startTime,
    isRealTime: safeConfig.isRealTime,
    retryCount: 0,
  };

  // Track concurrent operations per connection
  const concurrentOpsKey = `concurrent_${safeConfig.connectionId}`;
  if (!(global as any)[concurrentOpsKey]) {
    (global as any)[concurrentOpsKey] = new Set<string>();
  }
  const concurrentOps = (global as any)[concurrentOpsKey] as Set<string>;

  // Check concurrent operation limits
  if (concurrentOps.size >= safeConfig.maxConcurrentOperations) {
    const error = new WebSocketOperationError(
      `Maximum concurrent operations (${safeConfig.maxConcurrentOperations}) exceeded for connection ${safeConfig.connectionId}`,
      WebSocketErrorType.CONCURRENT_LIMIT_EXCEEDED,
      safeConfig.connectionId,
      operationId,
      { currentOperations: concurrentOps.size },
    );
    throw error;
  }

  concurrentOps.add(operationId);

  try {
    let result: T;

    // Set grace period for real-time operations
    if (safeConfig.isRealTime && safeConfig.gracePeriod > 0) {
      context.gracePeriodExpiry = Date.now() + safeConfig.gracePeriod;
    }

    // Connection health check
    if (safeConfig.connectionHealthCheck) {
      const isHealthy = await safeConfig.connectionHealthCheck();
      if (!isHealthy) {
        throw new WebSocketOperationError(
          `Connection health check failed for ${safeConfig.connectionId}`,
          WebSocketErrorType.HEALTH_CHECK_FAILED,
          safeConfig.connectionId,
          operationId,
        );
      }
    }

    if (safeConfig.enableCircuitBreaker) {
      // Use per-connection circuit breaker state
      const circuitBreakerKey = `circuit_${safeConfig.connectionId}`;
      if (!(global as any)[circuitBreakerKey]) {
        (global as any)[circuitBreakerKey] = circuitBreaker(handleAll, {
          halfOpenAfter: safeConfig.circuitBreakerTimeout,
          breaker: new ConsecutiveBreaker(safeConfig.circuitBreakerThreshold),
        });
      }

      const retryPolicy = retry(handleAll, {
        maxAttempts: safeConfig.maxRetries,
        backoff: new ExponentialBackoff(),
      });

      const circuitBreakerPolicy = (global as any)[circuitBreakerKey];
      const retryWithBreaker = wrap(retryPolicy, circuitBreakerPolicy);

      // Add timeout for WebSocket operations
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new WebSocketOperationError(
              `WebSocket operation timeout after ${safeConfig.connectionTimeout}ms`,
              WebSocketErrorType.CONNECTION_TIMEOUT,
              safeConfig.connectionId,
              operationId,
              { timeout: safeConfig.connectionTimeout },
            ),
          );
        }, safeConfig.connectionTimeout);
      });

      result = await Promise.race([
        retryWithBreaker.execute(operation),
        timeoutPromise,
      ]);
    } else {
      // Custom retry logic with WebSocket-specific enhancements
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= safeConfig.maxRetries; attempt++) {
        context.retryCount = attempt - 1;

        // Check grace period expiry for real-time operations
        if (
          safeConfig.isRealTime &&
          context.gracePeriodExpiry &&
          Date.now() > context.gracePeriodExpiry
        ) {
          throw new WebSocketOperationError(
            `Grace period expired for real-time operation`,
            WebSocketErrorType.GRACE_PERIOD_EXPIRED,
            safeConfig.connectionId,
            operationId,
            { gracePeriodExpiry: context.gracePeriodExpiry },
          );
        }

        try {
          // Add timeout for individual attempts
          const attemptTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new WebSocketOperationError(
                  `WebSocket operation attempt timeout after ${safeConfig.connectionTimeout}ms`,
                  WebSocketErrorType.CONNECTION_TIMEOUT,
                  safeConfig.connectionId,
                  operationId,
                  { attempt, timeout: safeConfig.connectionTimeout },
                ),
              );
            }, safeConfig.connectionTimeout);
          });

          result = await Promise.race([operation(), attemptTimeoutPromise]);

          break; // Success, exit retry loop
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(`Unknown error in ${safeConfig.operationName}`);
          context.lastError = lastError;

          // Enhanced WebSocket error handling
          if (safeConfig.handleWebSocketErrors && error instanceof Error) {
            if (
              error.message.includes('WebSocket') ||
              error.message.includes('connection')
            ) {
              lastError = new WebSocketOperationError(
                error.message,
                WebSocketErrorType.CONNECTION_LOST,
                safeConfig.connectionId,
                operationId,
                { originalError: error.message },
              );
            }
          }

          onError(lastError, context, attempt);

          if (attempt === safeConfig.maxRetries) {
            throw new Error(
              `[executeWebSocketWithRetry] ${safeConfig.operationName} failed after ${safeConfig.maxRetries} attempts. Last error: ${lastError.message}`,
            );
          }

          // Calculate delay with exponential backoff and jitter
          let delay = safeConfig.retryDelay * Math.pow(2, attempt - 1);
          if (safeConfig.jitterEnabled) {
            delay = delay * (0.5 + Math.random() * 0.5);
          }

          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(delay)),
          );
        }
      }
    }

    // Record success metrics with WebSocket context
    if (safeConfig.enableMetrics && metrics) {
      try {
        const duration = performance.now() - startTime;
        metrics.recordTimer(`${safeConfig.operationName}_duration`, duration, {
          connectionId: safeConfig.connectionId,
          operationId,
        });
        metrics.recordCounter(`${safeConfig.operationName}_success`, 1, {
          connectionId: safeConfig.connectionId,
          isRealTime: safeConfig.isRealTime.toString(),
        });
        if (safeConfig.isRealTime) {
          metrics.recordGauge(
            'websocket_realtime_operations_active',
            concurrentOps.size,
          );
        }
      } catch (metricsError) {
        console.warn(
          'Failed to record WebSocket success metrics:',
          metricsError,
        );
      }
    }

    return result!;
  } catch (error) {
    // Record failure metrics with WebSocket context
    if (safeConfig.enableMetrics && metrics) {
      try {
        const duration = performance.now() - startTime;
        metrics.recordTimer(`${safeConfig.operationName}_duration`, duration, {
          connectionId: safeConfig.connectionId,
          operationId,
        });
        metrics.recordCounter(`${safeConfig.operationName}_failed`, 1, {
          connectionId: safeConfig.connectionId,
          isRealTime: safeConfig.isRealTime.toString(),
          errorType:
            error instanceof WebSocketOperationError
              ? error.errorType
              : 'unknown',
        });
      } catch (metricsError) {
        console.warn(
          'Failed to record WebSocket failure metrics:',
          metricsError,
        );
      }
    }

    throw error; // Re-throw the error
  } finally {
    // Clean up concurrent operation tracking
    concurrentOps.delete(operationId);
  }
};

/**
 * Execute WebSocket token refresh with specialized retry logic
 * Optimized version specifically for OAuth token refresh in WebSocket contexts
 *
 * @template T - Return type of the token refresh operation
 * @param refreshOperation - Token refresh operation function
 * @param onError - Error callback with token refresh context
 * @param connectionId - WebSocket connection identifier
 * @param options - Token refresh specific options
 * @param metrics - Metrics collector for monitoring
 * @returns Promise resolving to refreshed token data
 *
 * @example
 * ```typescript
 * const refreshedToken = await executeWebSocketTokenRefresh(
 *   async () => await keycloakClient.refreshToken(refreshToken),
 *   (error, context) => logger.error('Token refresh failed', error),
 *   'ws_conn_123',
 *   {
 *     maxRetries: 3,
 *     gracePeriod: 15000, // 15 seconds grace period
 *     enableCircuitBreaker: true
 *   },
 *   metricsCollector
 * );
 * ```
 */
export const executeWebSocketTokenRefresh = async <T>(
  refreshOperation: () => Promise<T>,
  onError: (
    error: unknown,
    context: WebSocketOperationContext,
    attempt?: number,
  ) => void,
  connectionId: string,
  options: Partial<WebSocketRetryOptions> = {},
  metrics?: any,
): Promise<T> => {
  // Token refresh optimized defaults
  const tokenRefreshOptions: Partial<WebSocketRetryOptions> = {
    operationName: 'websocket_token_refresh',
    maxRetries: 3,
    retryDelay: 2000, // Slightly longer delays for token operations
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 3, // Lower threshold for auth operations
    circuitBreakerTimeout: 60000, // 1 minute recovery time
    enableMetrics: true,
    jitterEnabled: true,
    connectionId,
    connectionTimeout: 30000,
    gracePeriod: 15000, // 15 seconds grace period for token refresh
    isRealTime: true, // Token refresh is typically time-sensitive
    maxConcurrentOperations: 1, // Only one token refresh per connection at a time
    handleWebSocketErrors: true,
    ...options,
  };

  return executeWebSocketWithRetry(
    refreshOperation,
    onError,
    tokenRefreshOptions,
    metrics,
  );
};

import { createClient, ClickHouseClient as CHClient } from '@clickhouse/client';
import { createLogger } from '@org/logger';
import { executeWithRetry } from '@org/utils';
import { IMetricsCollector ,ICache} from "@org/types";
import { createHash } from 'crypto';

export interface IClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  requestTimeout: number;
  maxOpenConnections: number;
  compression: {
    response: boolean;
    request: boolean;
  };
}

/**
 * Interface for ClickHouse client operations.
 * Follows ISP by separating concerns.
 */
export interface IClickHouseClient {
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  healthCheck(): Promise<IHealthCheckResult>;
  isHealthy(): boolean;
  execute<T = unknown>(
    query: string,
    values?: Record<string, unknown>,
  ): Promise<T>;
  insert(
    table: string,
    data: Record<string, unknown>[],
    format?: string,
  ): Promise<void>;

  /**
   * High-throughput batch insert with configurable concurrency and batching.
   * Ideal for large dataset insertions with progress tracking.
   */
  batchInsert(
    table: string,
    data: Record<string, unknown>[],
    options?: IBatchInsertOptions,
    format?: string,
  ): Promise<IBatchInsertResult>;

  /**
   * ClickHouse-specific array operations for analytical workloads.
   */
  arrayOperations: IClickHouseArrayOperations;

  /**
   * ClickHouse-specific aggregation functions for advanced analytics.
   */
  aggregations: IClickHouseAggregations;

  /**
   * Time-series specific operations optimized for ClickHouse.
   */
  timeSeries: IClickHouseTimeSeries;

  /**
   * Sampling operations for large dataset analysis.
   */
  sampling: IClickHouseSampling;
}

/**
 * Configuration for ClickHouse resilience policies.
 */
export interface ClickHouseResilienceConfig {
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

/**
 * Query caching configuration.
 */
export interface ClickHouseQueryCacheConfig {
  enabled: boolean;
  defaultTTL: number; // seconds
  maxCacheSize: number; // maximum number of cached queries
  cacheKeyPrefix: string;
  excludePatterns: string[]; // regex patterns for queries to exclude from caching
}

/**
 * Cache-enabled query options.
 */
export interface QueryCacheOptions {
  useCache?: boolean;
  ttl?: number; // override default TTL
  cacheKey?: string; // custom cache key
}

/**
 * Result type for health checks.
 */
export interface IHealthCheckResult {
  status: HealthStatus;
  latency?: number;
  version?: string | undefined;
}

/**
 * Enum for health status to avoid magic strings.
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
}

/**
 * Simple interface for dependency injection container.
 * Only includes methods used by the registration function.
 */
// interface IDependencyContainer {
//   isRegistered(name: string): boolean;
//   register(name: string, registration: unknown): void;
// }

/**
 * Custom error class for ClickHouse operations.
 */
export class ClickHouseError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClickHouseError';
  }
}

/**
 * Optimized ClickHouse client with TSyringe dependency injection.
 * Uses singleton pattern for enterprise-wide database connection management.
 */
export class ClickHouseClient implements IClickHouseClient {
  private readonly client: CHClient;
  private isConnected = false;
  private connectionLock = false; // Prevent concurrent connection operations
  private cachedVersion?: string;
  private versionCacheTime = 0;
  private readonly versionCacheTTL = 300000; // 5 minutes
  private readonly config: IClickHouseConfig;
  private readonly resilienceConfig: ClickHouseResilienceConfig;
  private readonly queryCache: ClickHouseQueryCacheConfig;

  /**
   * TSyringe-managed ClickHouse client constructor with proper dependency injection.
   * All dependencies are automatically resolved by the container.
   */
    private readonly cacheService?: ICache;
  private readonly logger = createLogger({ service: 'ClickHouseClient' });

  // ClickHouse-specific operation implementations
  public readonly arrayOperations: IClickHouseArrayOperations;
  public readonly aggregations: IClickHouseAggregations;
  public readonly timeSeries: IClickHouseTimeSeries;
  public readonly sampling: IClickHouseSampling;

  constructor(
    config: IClickHouseConfig,
    cacheService?: ICache,
    private readonly metricsCollector?: IMetricsCollector
  ) {
    // this.config = this.createConfigFromEnv();
    this.config = config;
    this.resilienceConfig = this.createResilienceConfigFromEnv();
    this.queryCache = this.createQueryCacheConfigFromEnv();
    this.client = createClient(this.config);

    // Use injected cache service
    if (cacheService) {
      this.cacheService = cacheService;
      this.logger.info('Cache service injected into ClickHouse client');}

    // Initialize ClickHouse-specific operations
    this.arrayOperations = new ClickHouseArrayOperations(this);
    this.aggregations = new ClickHouseAggregations(this);
    this.timeSeries = new ClickHouseTimeSeries(this);
    this.sampling = new ClickHouseSampling(this);

    this.logger.info(
      {
        url: this.config.url,
        database: this.config.database,
        resilience: this.resilienceConfig,
        queryCache: this.queryCache,
          hasCache: !!this.cacheService,
      },
      'ClickHouse client initialized',
    );
  }

  static create(
    config: IClickHouseConfig,
    cacheService?: ICache,
    metricsCollector?: IMetricsCollector
  ): ClickHouseClient {
    return new ClickHouseClient(config, cacheService, metricsCollector);
  }
  /**
   * Creates configuration from environment variables.
   * Includes validation for required configs.
   */
  //   private createConfigFromEnv(): IClickHouseConfig {
  //     const config: IClickHouseConfig = {
  //       url: getEnv("CLICKHOUSE_URL", "http://localhost:8123"),
  //       username: getEnv("CLICKHOUSE_USERNAME", "default"),
  //       password: getEnv("CLICKHOUSE_PASSWORD", ""),
  //       database: getEnv("CLICKHOUSE_DATABASE", "cart_recovery"),
  //       requestTimeout: getNumberEnv("CLICKHOUSE_REQUEST_TIMEOUT", 30000),
  //       maxOpenConnections: getNumberEnv("CLICKHOUSE_MAX_CONNECTIONS", 10),
  //       compression: {
  //         response: getBooleanEnv("CLICKHOUSE_COMPRESSION", true),
  //         request: getBooleanEnv("CLICKHOUSE_REQUEST_COMPRESSION", false),
  //       },
  //     };

  //     // Validate required fields
  //     if (!config.url || !config.database) {
  //       throw new ClickHouseError("Missing required ClickHouse configuration");
  //     }

  //     return config;
  //   }

  /**
   * Creates resilience configuration from environment variables.
   */
  private createResilienceConfigFromEnv(
    config?: ClickHouseResilienceConfig,
  ): ClickHouseResilienceConfig {
    return {
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 5,
      circuitBreakerTimeout: config?.circuitBreakerTimeout ?? 30000,
    };
  }

  /**
   * Creates query cache configuration from environment variables.
   */
  private createQueryCacheConfigFromEnv(
    config?: ClickHouseQueryCacheConfig,
  ): ClickHouseQueryCacheConfig {
    return {
      enabled: config?.enabled ?? true,
      defaultTTL: config?.defaultTTL ?? 300, // 5 minutes
      maxCacheSize: config?.maxCacheSize ?? 1000, // maximum number of cached queries to prevent unbounded growth
      cacheKeyPrefix: config?.cacheKeyPrefix ?? 'clickhouse:', // prefix for all cache keys to allow easy invalidation
      excludePatterns:
        config?.excludePatterns ??
        'INSERT,UPDATE,DELETE,CREATE,DROP,ALTER'.split(','),
    };
  }

  /**
   * Generates a cache key for a query.
   */
  private generateCacheKey(query: string, params?: unknown[]): string {
    const paramString = params ? JSON.stringify(params) : '';
    const hash = createHash('md5')
      .update(query + paramString)
      .digest('hex');
    return `${this.queryCache.cacheKeyPrefix}query:${hash}`;
  }

  /**
   * Checks if a query should be cached based on exclude patterns.
   */
  private shouldCacheQuery(query: string): boolean {
    if (!this.queryCache.enabled) return false;

    const upperQuery = query.trim().toUpperCase();
    return !this.queryCache.excludePatterns.some((pattern) =>
      upperQuery.startsWith(pattern.toUpperCase()),
    );
  }

  async disconnect(): Promise<void> {
    if (this.connectionLock) {
      this.logger.warn('Connection operation already in progress');
      return;
    }

    this.connectionLock = true;
    try {
      if (this.isConnected) {
        await this.client.close();
        this.isConnected = false;
        delete this.cachedVersion;
        this.versionCacheTime = 0;
      }
    } finally {
      this.connectionLock = false;
    }
  }

  async ping(): Promise<boolean> {
    const startTime = Date.now();
    try {
      const result = await this.client.ping();
        await this.metricsCollector?.recordTimer(
          "clickhouse.ping.duration",
          Date.now() - startTime
        );
        await this.metricsCollector?.recordCounter("clickhouse.ping.success", 1);
      return result.success;
    } catch (error) {
        await this.metricsCollector?.recordCounter("clickhouse.ping.error", 1);
      this.logger.error(error, 'ClickHouse ping failed');
      throw new ClickHouseError('Ping failed', error);
    }
  }

  async healthCheck(): Promise<IHealthCheckResult> {
    const startTime = Date.now();
    try {
      const pingResult = await this.client.ping();
      const latency = Date.now() - startTime;

        await this.metricsCollector?.recordTimer(
          "clickhouse.healthcheck.duration",
          latency
        );

      if (pingResult.success) {
        // Use cached version if available and not expired
        let version: string | undefined;
        const now = Date.now();

        if (
          this.cachedVersion &&
          now - this.versionCacheTime < this.versionCacheTTL
        ) {
          version = this.cachedVersion;
            await this.metricsCollector?.recordCounter(
              "clickhouse.version.cache_hit",
              1
            );
        } else {
          // Fetch version from database
          const versionResult = await this.client.query({
            query: 'SELECT version() as version',
            format: 'JSONEachRow',
          });
          const versionData: { version: string }[] = await versionResult.json<{
            version: string;
          }>();
          version = versionData[0]?.version;

          // Cache the version
          if (typeof version === 'string') {
            this.cachedVersion = version;
            this.versionCacheTime = now;
            await this.metricsCollector?.recordCounter(
              "clickhouse.version.cache_miss",
              1
            );
          }
        }

        await this.metricsCollector?.recordCounter(
          "clickhouse.healthcheck.success",
          1
        );
        return {
          status: HealthStatus.HEALTHY,
          latency,
          version,
        };
      }

        await this.metricsCollector?.recordCounter(
          "clickhouse.healthcheck.unhealthy",
          1
        );
      return { status: HealthStatus.UNHEALTHY };
    } catch (error) {
            await this.metricsCollector?.recordCounter(
              "clickhouse.healthcheck.error",
              1
            );
      this.logger.error(error, 'ClickHouse health check failed');
      return { status: HealthStatus.UNHEALTHY };
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  async execute<T = unknown>(
    query: string,
    values?: Record<string, unknown>,
  ): Promise<T> {
    if (!query.trim()) {
      throw new ClickHouseError('Query cannot be empty');
    }

    const operationName = `ClickHouse Query: ${query.substring(0, 50)}...`;
    const startTime = Date.now();

    try {
      // Execute query with resilience and metrics tracking
      const result = await executeWithRetry(
        async () => {
          const queryResult = await this.client.query({
            query,
            query_params: values ?? {},
            format: 'JSONEachRow',
          });
          return queryResult.json() as T;
        },
        (error: unknown) => {
          this.logger.error(error, 'ClickHouse query failed');
          throw new ClickHouseError('Query execution failed', error);
        },
        {
          operationName,
          maxRetries: this.resilienceConfig.maxRetries,
          retryDelay: this.resilienceConfig.retryDelay,
          enableCircuitBreaker: true,
        },
      );

      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.query.duration",
        duration
      );
      await this.metricsCollector?.recordCounter("clickhouse.query.success", 1);

      this.logger.debug(
        {
          query: operationName,
          duration,
        },
        'ClickHouse query executed successfully',
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.query.error_duration",
        duration
      );
      await this.metricsCollector?.recordCounter("clickhouse.query.error", 1);

      this.logger.error(error, 'ClickHouse query failed', {
        query: operationName,
        duration,
      });
      throw new ClickHouseError('Query execution failed', error);
    }
  }

  /**
   * Execute a query with optional caching support.
   * Automatically caches SELECT queries while excluding write operations.
   */
  async executeWithCache<T = unknown>(
    query: string,
    values?: Record<string, unknown>,
    options?: QueryCacheOptions,
  ): Promise<T> {
    const cacheOptions = {
      useCache: this.shouldCacheQuery(query),
      ttl: this.queryCache.defaultTTL,
      ...options,
    };

    // If caching is disabled, execute directly
    if (cacheOptions.useCache === false) {
      return this.execute(query, values);
    }

    // Generate cache key
    const cacheKey =
      cacheOptions.cacheKey ??
      this.generateCacheKey(query, values ? Object.values(values) : undefined);

    try {
      // Check cache if available
        if (this.cacheService && this.shouldCacheQuery(query)) {
          const cacheResult = await this.cacheService.get<T>(cacheKey);
          if (cacheResult.data !== null) {
            // await this.metricsCollector?.recordCounter("clickhouse.cache.hit", 1);
            this.logger.debug({ message: 'Cache hit for ClickHouse query', cacheKey });
            return cacheResult.data;
          }
        }

      // Execute query if not in cache
      // await this.metricsCollector?.recordCounter("clickhouse.cache.miss", 1);
      const result = await this.execute<T>(query, values);

      // Store in cache if available
        if (this.cacheService) {
          await this.cacheService.set(cacheKey, result, cacheOptions.ttl);
          this.logger.debug(
            {
              cacheKey,
              ttl: cacheOptions.ttl,
            },
            'Cached ClickHouse query result'
          );
        }

      return result;
    } catch (error) {
      //   await this.metricsCollector?.recordCounter("clickhouse.cache.error", 1);
      this.logger.warn(
        { message: 'Cache operation failed, executing query directly', error },
        'Cache operation failed, executing query directly',
      );
      return this.execute<T>(query, values);
    }
  }

  /**
   * Invalidate cached queries matching a pattern.
   * Useful for cache invalidation after data modifications.
   */
    async invalidateCache(pattern?: string): Promise<void> {
      if (!this.cacheService) {
        this.logger.warn('Cache service not available for invalidation');
        return;
      }

      try {
        const searchPattern = pattern ?? `${this.queryCache.cacheKeyPrefix}*`;
        const invalidatedCount =
          await this.cacheService.invalidatePattern(searchPattern);
          await this.metricsCollector?.recordCounter(
            "clickhouse.cache.invalidated",
            invalidatedCount
          );
        this.logger.info({ message: 'Cache invalidated', pattern: searchPattern, invalidatedCount });
      } catch (error) {
          await this.metricsCollector?.recordCounter(
            "clickhouse.cache.invalidation_error",
            1
          );
        this.logger.error({ message: 'Cache invalidation failed', error });

        throw new ClickHouseError('Cache invalidation failed', error);
      }
    }

  async insert(
    table: string,
    data: Record<string, unknown>[],
    format = 'JSONEachRow',
  ): Promise<void> {
    if (!table.trim() || !data.length) {
      throw new ClickHouseError('Table name and data are required');
    }

    const operationName = `ClickHouse Insert: ${table}`;
    const startTime = Date.now();

    try {
      // Execute insert with resilience and metrics tracking
      await executeWithRetry(
        async () => {
          await this.client.insert({
            table,
            values: data,
            format: format as 'JSONEachRow' | 'TabSeparated', // Type-safe format
          });
        },
        (error: unknown) =>
          this.logger.error(error, 'ClickHouse insert failed'),
        { operationName, enableCircuitBreaker: true },
      );

      const duration = Date.now() - startTime;
      await this.metricsCollector?.recordTimer(
        "clickhouse.insert.duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.insert.success",
          1
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.insert.rows",
        data.length
       );

      this.logger.debug(
        {
          table,
          rowCount: data.length,
          duration,
        },
        `ClickHouse insert completed successfully`,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
          await this.metricsCollector?.recordTimer(
            "clickhouse.insert.error_duration",
            duration
          );
          await this.metricsCollector?.recordCounter("clickhouse.insert.error", 1);

      this.logger.error(error, 'ClickHouse insert failed', {
        table,
        rowCount: data.length,
        duration,
      });
      throw new ClickHouseError('Insert failed', error);
    }
  }

  async batchInsert(
    table: string,
    data: Record<string, unknown>[],
    options?: IBatchInsertOptions,
    format = 'JSONEachRow',
  ): Promise<IBatchInsertResult> {
    if (!table.trim() || !data.length) {
      throw new ClickHouseError('Table name and data are required');
    }

    // Default options for batch processing
    const opts: IBatchInsertOptions = {
      batchSize: options?.batchSize ?? 1000,
      maxConcurrency: options?.maxConcurrency ?? 3,
      delayBetweenBatches: options?.delayBetweenBatches ?? 100,
    };

    const startTime = Date.now();
    const totalRows = data.length;
    let successfulBatches = 0;
    let failedBatches = 0;
    const errors: string[] = [];

    this.logger.info(
      {
        totalRows,
        batchSize: opts.batchSize,
        maxConcurrency: opts.maxConcurrency,
      },
      `Starting batch insert for table ${table}`,
    );

    try {
      // Split data into batches
      const batches: Record<string, unknown>[][] = [];
      for (let i = 0; i < data.length; i += opts.batchSize) {
        batches.push(data.slice(i, i + opts.batchSize));
      }

      // Process batches with controlled concurrency
      const semaphore = new Array(opts.maxConcurrency).fill(null);
      let batchIndex = 0;

      const processBatch = async (
        batch: Record<string, unknown>[],
        index: number,
      ): Promise<void> => {
        try {
          await this.insert(table, batch, format);
          successfulBatches++;

          this.logger.debug(
            {
              batchSize: batch.length,
              progress: `${(((index + 1) / batches.length) * 100).toFixed(1)}%`,
            },
            `Batch ${index + 1}/${batches.length} completed`,
          );

          // Add delay between batches to prevent overwhelming the server
          if (opts.delayBetweenBatches > 0 && index < batches.length - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, opts.delayBetweenBatches),
            );
          }
        } catch (error) {
          failedBatches++;
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(`Batch ${index + 1}: ${errorMsg}`);

          this.logger.warn({ error: errorMsg }, `Batch ${index + 1} failed`);
        }
      };

      // Execute batches with concurrency control
      const workers = semaphore.map(async () => {
        while (batchIndex < batches.length) {
          const currentIndex = batchIndex++;
          const batch = batches[currentIndex];
          if (batch) {
            await processBatch(batch, currentIndex);
          }
        }
      });

      await Promise.all(workers);

      const duration = Date.now() - startTime;
      const result: IBatchInsertResult = {
        totalRows,
        batchesProcessed: batches.length,
        duration,
        successfulBatches,
        failedBatches,
        ...(errors.length > 0 && { errors }),
      };

      // Record comprehensive metrics
      await this.metricsCollector?.recordTimer(
        "clickhouse.batch_insert.duration",
        duration
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.total_rows",
        totalRows
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.batches_processed",
        batches.length
      );
      await this.metricsCollector?.recordCounter(
        "clickhouse.batch_insert.successful_batches",
        successfulBatches
      );
        await this.metricsCollector?.recordCounter(
          "clickhouse.batch_insert.failed_batches",
          failedBatches
        );

      this.logger.info(result, `Batch insert completed for table ${table}`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
        await this.metricsCollector?.recordTimer(
          "clickhouse.batch_insert.error_duration",
          duration
        );
        await this.metricsCollector?.recordCounter(
          "clickhouse.batch_insert.error",
          1
        );

      this.logger.error(error, 'Batch insert failed', {
        table,
        totalRows,
        duration,
      });
      throw new ClickHouseError('Batch insert failed', error);
    }
  }
}

/**
 * Batch insert interface for high-throughput scenarios (Phase 3).
 */
export interface IBatchInsertOptions {
  batchSize: number;
  maxConcurrency: number;
  delayBetweenBatches: number;
}

/**
 * Result interface for batch insert operations.
 */
export interface IBatchInsertResult {
  totalRows: number;
  batchesProcessed: number;
  duration: number;
  successfulBatches: number;
  failedBatches: number;
  errors?: string[];
}

/**
 * ClickHouse-specific array operations interface.
 */
export interface IClickHouseArrayOperations {
  /**
   * Unnest array columns into separate rows.
   */
  arrayJoin<T = unknown>(
    table: string,
    arrayColumn: string,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
      limit?: number;
    },
  ): Promise<T[]>;

  /**
   * Filter array elements based on conditions.
   */
  arrayFilter<T = unknown>(
    table: string,
    arrayColumn: string,
    filterCondition: string,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
    },
  ): Promise<T[]>;

  /**
   * Apply function to each array element.
   */
  arrayMap<T = unknown>(
    table: string,
    arrayColumn: string,
    mapFunction: string,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
    },
  ): Promise<T[]>;

  /**
   * Count elements in arrays.
   */
  arrayCount(
    table: string,
    arrayColumn: string,
    options?: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    },
  ): Promise<Array<{ count: number; [key: string]: unknown }>>;

  /**
   * Check if array contains specific value.
   */
  arrayHas(
    table: string,
    arrayColumn: string,
    searchValue: unknown,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
    },
  ): Promise<Array<{ has_value: boolean; [key: string]: unknown }>>;
}

/**
 * ClickHouse-specific aggregation functions interface.
 */
export interface IClickHouseAggregations {
  /**
   * Get the argument (row) that corresponds to the maximum value.
   */
  argMax<T = unknown>(
    table: string,
    argColumn: string,
    valueColumn: string,
    options?: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    },
  ): Promise<T[]>;

  /**
   * Get the argument (row) that corresponds to the minimum value.
   */
  argMin<T = unknown>(
    table: string,
    argColumn: string,
    valueColumn: string,
    options?: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    },
  ): Promise<T[]>;

  /**
   * Get top K values with their frequencies.
   */
  topK(
    table: string,
    column: string,
    k: number,
    options?: {
      where?: Record<string, unknown>;
      weightColumn?: string;
    },
  ): Promise<Array<{ value: unknown; count: number }>>;

  /**
   * Get top K weighted values.
   */
  topKWeighted(
    table: string,
    column: string,
    weightColumn: string,
    k: number,
    options?: {
      where?: Record<string, unknown>;
    },
  ): Promise<Array<{ value: unknown; weight: number }>>;

  /**
   * Calculate quantiles for numerical data.
   */
  quantiles(
    table: string,
    column: string,
    quantiles: number[],
    options?: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    },
  ): Promise<Array<{ [key: string]: number }>>;

  /**
   * Calculate statistical aggregations.
   */
  stats(
    table: string,
    column: string,
    options?: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    },
  ): Promise<
    Array<{
      count: number;
      sum: number;
      avg: number;
      min: number;
      max: number;
      variance: number;
      stddev: number;
    }>
  >;
}

/**
 * ClickHouse time-series operations interface.
 */
export interface IClickHouseTimeSeries {
  /**
   * Group data by time intervals (tumbling windows).
   */
  tumblingWindow<T = unknown>(
    table: string,
    timeColumn: string,
    windowSize: string, // e.g., '1 hour', '30 minute'
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
      groupBy?: string[];
      orderBy?: string;
    },
  ): Promise<T[]>;

  /**
   * Calculate moving averages over time windows.
   */
  movingAverage(
    table: string,
    valueColumn: string,
    timeColumn: string,
    windowSize: number,
    options?: {
      where?: Record<string, unknown>;
      partitionBy?: string[];
    },
  ): Promise<Array<{ timestamp: string; value: number; moving_avg: number }>>;

  /**
   * Detect anomalies in time-series data.
   */
  detectAnomalies(
    table: string,
    valueColumn: string,
    timeColumn: string,
    options?: {
      algorithm?: 'zscore' | 'iqr' | 'mad';
      threshold?: number;
      windowSize?: number;
      where?: Record<string, unknown>;
    },
  ): Promise<
    Array<{
      timestamp: string;
      value: number;
      is_anomaly: boolean;
      score: number;
    }>
  >;

  /**
   * Fill missing time series data points.
   */
  fillGaps<T = unknown>(
    table: string,
    timeColumn: string,
    interval: string,
    fillValue?: unknown,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
      startTime?: string;
      endTime?: string;
    },
  ): Promise<T[]>;
}

/**
 * ClickHouse sampling operations interface.
 */
export interface IClickHouseSampling {
  /**
   * Sample data using ClickHouse's SAMPLE clause.
   */
  sample<T = unknown>(
    table: string,
    sampleSize: number | string, // number (0-1) or string like '10000'
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
      orderBy?: string;
    },
  ): Promise<T[]>;

  /**
   * Sample data with consistent hashing for reproducible results.
   */
  sampleConsistent<T = unknown>(
    table: string,
    sampleSize: number,
    hashColumn: string,
    options?: {
      select?: string[];
      where?: Record<string, unknown>;
    },
  ): Promise<T[]>;

  /**
   * Get approximate distinct count using sampling.
   */
  approximateCountDistinct(
    table: string,
    column: string,
    sampleSize?: number,
    options?: {
      where?: Record<string, unknown>;
    },
  ): Promise<{ approximate_count: number; exact_count?: number }>;

  /**
   * Get sample statistics for data exploration.
   */
  sampleStats(
    table: string,
    columns: string[],
    sampleSize?: number,
    options?: {
      where?: Record<string, unknown>;
    },
  ): Promise<
    {
      column: string;
      count: number;
      distinct_count: number;
      null_count: number;
      min?: unknown;
      max?: unknown;
      avg?: number;
      sample_size: number;
    }[]
  >;
}

/**
 * TSyringe container registration helper.
 * Call this during application initialization to register dependencies.
 */
// export const registerClickHouseDependencies = (
//   container: IDependencyContainer,
// ): void => {

//   if (!container.isRegistered('IMetricsCollector')) {
//     container.register('IMetricsCollector', {
//       useFactory: () =>
//         MetricsCollector.getInstance
//           ? MetricsCollector.getInstance()
//           : new MetricsCollector(),
//     });
//   }
// };

// Pure TSyringe usage example:
// import { container } from "tsyringe";
// registerClickHouseDependencies(container);
// const client = container.resolve(ClickHouseClient);

/**
 * ClickHouse Array Operations Implementation
 */
class ClickHouseArrayOperations implements IClickHouseArrayOperations {
  constructor(private readonly client: ClickHouseClient) {}

  async arrayJoin<T = unknown>(
    table: string,
    arrayColumn: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
      limit?: number;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

    const query = `
      SELECT ${select}
      FROM ${table}
      ARRAY JOIN ${arrayColumn} AS ${arrayColumn}_item
      ${whereClause}
      ${limitClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async arrayFilter<T = unknown>(
    table: string,
    arrayColumn: string,
    filterCondition: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${select},
             arrayFilter(x -> ${filterCondition}, ${arrayColumn}) as filtered_array
      FROM ${table}
      ${whereClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async arrayMap<T = unknown>(
    table: string,
    arrayColumn: string,
    mapFunction: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${select},
             arrayMap(x -> ${mapFunction}, ${arrayColumn}) as mapped_array
      FROM ${table}
      ${whereClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async arrayCount(
    table: string,
    arrayColumn: string,
    options: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    } = {},
  ): Promise<Array<{ count: number; [key: string]: unknown }>> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';

    const query = `
      SELECT arrayCount(x -> 1, ${arrayColumn}) as count
             ${options.groupBy ? `, ${options.groupBy.join(', ')}` : ''}
      FROM ${table}
      ${whereClause}
      ${groupByClause}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async arrayHas(
    table: string,
    arrayColumn: string,
    searchValue: unknown,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
    } = {},
  ): Promise<Array<{ has_value: boolean; [key: string]: unknown }>> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${select},
             has(${arrayColumn}, {searchValue}) as has_value
      FROM ${table}
      ${whereClause}
    `.trim();

    return this.client.execute(query, { ...options.where, searchValue });
  }
}

/**
 * ClickHouse Aggregations Implementation
 */
class ClickHouseAggregations implements IClickHouseAggregations {
  constructor(private readonly client: ClickHouseClient) {}

  async argMax<T = unknown>(
    table: string,
    argColumn: string,
    valueColumn: string,
    options: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    } = {},
  ): Promise<T[]> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';

    const query = `
      SELECT argMax(${argColumn}, ${valueColumn}) as ${argColumn}
      ${options.groupBy ? `, ${options.groupBy.join(', ')}` : ''}
      FROM ${table}
      ${whereClause}
      ${groupByClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async argMin<T = unknown>(
    table: string,
    argColumn: string,
    valueColumn: string,
    options: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    } = {},
  ): Promise<T[]> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';

    const query = `
      SELECT argMin(${argColumn}, ${valueColumn}) as ${argColumn}
      ${options.groupBy ? `, ${options.groupBy.join(', ')}` : ''}
      FROM ${table}
      ${whereClause}
      ${groupByClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async topK(
    table: string,
    column: string,
    k: number,
    options: {
      where?: Record<string, unknown>;
      weightColumn?: string;
    } = {},
  ): Promise<Array<{ value: unknown; count: number }>> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${column} as value, count() as count
      FROM ${table}
      ${whereClause}
      GROUP BY ${column}
      ORDER BY count DESC
      LIMIT ${k}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async topKWeighted(
    table: string,
    column: string,
    weightColumn: string,
    k: number,
    options: {
      where?: Record<string, unknown>;
    } = {},
  ): Promise<Array<{ value: unknown; weight: number }>> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${column} as value, sum(${weightColumn}) as weight
      FROM ${table}
      ${whereClause}
      GROUP BY ${column}
      ORDER BY weight DESC
      LIMIT ${k}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async quantiles(
    table: string,
    column: string,
    quantiles: number[],
    options: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    } = {},
  ): Promise<Array<{ [key: string]: number }>> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';

    const quantileFunctions = quantiles
      .map((q) => `quantile(${q})(${column}) as p${Math.round(q * 100)}`)
      .join(', ');

    const query = `
      SELECT ${quantileFunctions}
      ${options.groupBy ? `, ${options.groupBy.join(', ')}` : ''}
      FROM ${table}
      ${whereClause}
      ${groupByClause}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async stats(
    table: string,
    column: string,
    options: {
      where?: Record<string, unknown>;
      groupBy?: string[];
    } = {},
  ): Promise<
    Array<{
      count: number;
      sum: number;
      avg: number;
      min: number;
      max: number;
      variance: number;
      stddev: number;
    }>
  > {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';

    const query = `
      SELECT count() as count,
             sum(${column}) as sum,
             avg(${column}) as avg,
             min(${column}) as min,
             max(${column}) as max,
             varPop(${column}) as variance,
             stddevPop(${column}) as stddev
      ${options.groupBy ? `, ${options.groupBy.join(', ')}` : ''}
      FROM ${table}
      ${whereClause}
      ${groupByClause}
    `.trim();

    return this.client.execute(query, options.where);
  }
}

/**
 * ClickHouse Time Series Implementation
 */
class ClickHouseTimeSeries implements IClickHouseTimeSeries {
  constructor(private readonly client: ClickHouseClient) {}

  async tumblingWindow<T = unknown>(
    table: string,
    timeColumn: string,
    windowSize: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
      groupBy?: string[];
      orderBy?: string;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const groupByClause = options.groupBy?.length
      ? `GROUP BY ${options.groupBy.join(', ')}`
      : '';
    const orderByClause = options.orderBy ? `ORDER BY ${options.orderBy}` : '';

    const query = `
      SELECT ${select},
             tumbleStart(${timeColumn}, INTERVAL ${windowSize}) as window_start,
             tumbleEnd(${timeColumn}, INTERVAL ${windowSize}) as window_end
      FROM ${table}
      ${whereClause}
      GROUP BY tumble(${timeColumn}, INTERVAL ${windowSize})
      ${groupByClause ? `, ${groupByClause}` : ''}
      ${orderByClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async movingAverage(
    table: string,
    valueColumn: string,
    timeColumn: string,
    windowSize: number,
    options: {
      where?: Record<string, unknown>;
      partitionBy?: string[];
    } = {},
  ): Promise<Array<{ timestamp: string; value: number; moving_avg: number }>> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const partitionClause = options.partitionBy?.length
      ? `PARTITION BY ${options.partitionBy.join(', ')}`
      : '';

    const query = `
      SELECT ${timeColumn} as timestamp,
             ${valueColumn} as value,
             avg(${valueColumn}) OVER (
               ${partitionClause}
               ORDER BY ${timeColumn}
               ROWS ${windowSize - 1} PRECEDING
             ) as moving_avg
      FROM ${table}
      ${whereClause}
      ORDER BY ${timeColumn}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async detectAnomalies(
    table: string,
    valueColumn: string,
    timeColumn: string,
    options: {
      algorithm?: 'zscore' | 'iqr' | 'mad';
      threshold?: number;
      windowSize?: number;
      where?: Record<string, unknown>;
    } = {},
  ): Promise<
    Array<{
      timestamp: string;
      value: number;
      is_anomaly: boolean;
      score: number;
    }>
  > {
    const algorithm = options.algorithm ?? 'zscore';
    const threshold = options.threshold ?? 3.0;
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    let anomalyCondition: string;
    switch (algorithm) {
      case 'zscore':
        anomalyCondition = `abs((${valueColumn} - avg(${valueColumn})) / stddev(${valueColumn})) > ${threshold}`;
        break;
      case 'iqr':
        anomalyCondition = `${valueColumn} < quantile(0.25)(${valueColumn}) - ${threshold} * (quantile(0.75)(${valueColumn}) - quantile(0.25)(${valueColumn})) OR ${valueColumn} > quantile(0.75)(${valueColumn}) + ${threshold} * (quantile(0.75)(${valueColumn}) - quantile(0.25)(${valueColumn}))`;
        break;
      case 'mad':
        anomalyCondition = `abs(${valueColumn} - median(${valueColumn})) / mad(${valueColumn}) > ${threshold}`;
        break;
      default:
        throw new Error(
          `Unsupported anomaly detection algorithm: ${algorithm}`,
        );
    }

    const query = `
      SELECT ${timeColumn} as timestamp,
             ${valueColumn} as value,
             ${anomalyCondition} as is_anomaly,
             CASE
               WHEN '${algorithm}' = 'zscore' THEN abs((${valueColumn} - avg(${valueColumn})) / stddev(${valueColumn}))
               WHEN '${algorithm}' = 'iqr' THEN
                 CASE
                   WHEN ${valueColumn} < quantile(0.25)(${valueColumn}) THEN (quantile(0.25)(${valueColumn}) - ${valueColumn}) / (quantile(0.75)(${valueColumn}) - quantile(0.25)(${valueColumn}))
                   ELSE (${valueColumn} - quantile(0.75)(${valueColumn})) / (quantile(0.75)(${valueColumn}) - quantile(0.25)(${valueColumn}))
                 END
               WHEN '${algorithm}' = 'mad' THEN abs(${valueColumn} - median(${valueColumn})) / mad(${valueColumn})
               ELSE 0
             END as score
      FROM ${table}
      ${whereClause}
      ORDER BY ${timeColumn}
    `.trim();

    return this.client.execute(query, options.where);
  }

  async fillGaps<T = unknown>(
    table: string,
    timeColumn: string,
    interval: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
      startTime?: string;
      endTime?: string;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const startTime = options.startTime
      ? `'${options.startTime}'`
      : `(SELECT min(${timeColumn}) FROM ${table})`;
    const endTime = options.endTime
      ? `'${options.endTime}'`
      : `(SELECT max(${timeColumn}) FROM ${table})`;

    const query = `
      SELECT ${select}
      FROM (
        SELECT arrayJoin(
          arrayMap(
            x -> ${startTime} + INTERVAL x ${interval},
            range(0, toUInt32((${endTime} - ${startTime}) / INTERVAL ${interval}) + 1)
          )
        ) as ${timeColumn}
      ) as time_series
      LEFT JOIN ${table} ON time_series.${timeColumn} = ${table}.${timeColumn}
      ${whereClause.replace(timeColumn, `time_series.${timeColumn}`)}
      ORDER BY time_series.${timeColumn}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }
}

/**
 * ClickHouse Sampling Implementation
 */
class ClickHouseSampling implements IClickHouseSampling {
  constructor(private readonly client: ClickHouseClient) {}

  async sample<T = unknown>(
    table: string,
    sampleSize: number | string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
      orderBy?: string;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';
    const orderByClause = options.orderBy ? `ORDER BY ${options.orderBy}` : '';
    const sampleClause =
      typeof sampleSize === 'number' && sampleSize < 1
        ? `SAMPLE ${sampleSize}`
        : `SAMPLE ${sampleSize}`;

    const query = `
      SELECT ${select}
      FROM ${table}
      ${sampleClause}
      ${whereClause}
      ${orderByClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async sampleConsistent<T = unknown>(
    table: string,
    sampleSize: number,
    hashColumn: string,
    options: {
      select?: string[];
      where?: Record<string, unknown>;
    } = {},
  ): Promise<T[]> {
    const select = options.select?.join(', ') ?? '*';
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT ${select}
      FROM ${table}
      SAMPLE ${sampleSize / 100}
      WHERE cityHash64(${hashColumn}) % 100 < ${sampleSize}
      ${whereClause}
    `.trim();

    return this.client.execute<T[]>(query, options.where);
  }

  async approximateCountDistinct(
    table: string,
    column: string,
    sampleSize = 0.1,
    options: {
      where?: Record<string, unknown>;
    } = {},
  ): Promise<{ approximate_count: number; exact_count?: number }> {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const query = `
      SELECT uniq(${column}) as approximate_count,
             exact_count_distinct(${column}) as exact_count
      FROM ${table}
      SAMPLE ${sampleSize}
      ${whereClause}
    `.trim();

    const result = await this.client.execute<
      Array<{ approximate_count: number; exact_count?: number }>
    >(query, options.where);
    return result[0] ?? { approximate_count: 0 };
  }

  async sampleStats(
    table: string,
    columns: string[],
    sampleSize = 0.1,
    options: {
      where?: Record<string, unknown>;
    } = {},
  ): Promise<
    {
      column: string;
      count: number;
      distinct_count: number;
      null_count: number;
      min?: unknown;
      max?: unknown;
      avg?: number;
      sample_size: number;
    }[]
  > {
    const whereClause = options.where
      ? `WHERE ${Object.entries(options.where)
          .map(([key]) => `${key} = {${key}:String}`)
          .join(' AND ')}`
      : '';

    const columnStats = columns
      .map(
        (col) => `
      SELECT '${col}' as column,
             count() as count,
             uniq(${col}) as distinct_count,
             countIf(${col} IS NULL) as null_count,
             min(${col}) as min,
             max(${col}) as max,
             avg(toFloat64OrNull(${col})) as avg,
             (SELECT count() FROM ${table} SAMPLE ${sampleSize}) as sample_size
      FROM ${table}
      SAMPLE ${sampleSize}
      ${whereClause}
    `,
      )
      .join(' UNION ALL ');

    return this.client.execute(columnStats, options.where);
  }
}

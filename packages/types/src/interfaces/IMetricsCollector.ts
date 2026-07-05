export interface IMetricsCollector {
  /**
   * Record counter metric
   */
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): Promise<void>;

  /**
   * Record timer metric (in milliseconds)
   */
  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;

  /**
   * Record gauge metric
   */
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;

  /**
   * Record histogram metric
   */
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): Promise<void>;

  /**
   * Record summary metric
   */
  recordSummary(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;

  /**
   * Get current metrics as Prometheus exposition format
   */
  getMetrics(): Promise<string>;

  // ===================================================================
  // HIGH-LEVEL BUSINESS METRICS
  // ===================================================================

  /**
   * Record API request with full context
   */
  recordApiRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    service?: string
  ): Promise<void>;

  /**
   * Record database operation
   */
  recordDatabaseOperation(
    clientType: "redis" | "postgres" | "clickhouse",
    operation: string,
    duration: number,
    success: boolean,
    service?: string
  ): Promise<void>;

  /**
   * Record authentication operation
   */
  recordAuthOperation(
    operation: "login" | "register" | "refresh" | "logout",
    result: "success" | "failure" | "error",
    userRole?: string
  ): Promise<void>;

  /**
   * Record WebSocket activity
   */
  recordWebSocketActivity(
    service: string,
    messageType: string,
    direction: "inbound" | "outbound",
    connectionCount?: number
  ): Promise<void>;

  /**
   * Record Node.js process metrics
   */
  recordNodeMetrics(service: string): Promise<void>;

  /**
   * Measure and record event loop lag
   */
  measureEventLoopLag(service: string): Promise<void>;
}

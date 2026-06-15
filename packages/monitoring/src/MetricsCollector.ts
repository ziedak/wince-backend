/**
 * High-Performance Prometheus Metrics Collector
 *
 * Enterprise-grade metrics collection with zero-allocation recording,
 * proper histogram buckets, and automatic Prometheus exposition.
 */

import { PrometheusMetricsCollector } from "./PrometheusMetricsCollector.js";

// ===================================================================
// METRICS COLLECTOR INTERFACE
// ===================================================================

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

// ===================================================================
// METRICS COLLECTOR IMPLEMENTATION
// ===================================================================

export class MetricsCollector implements IMetricsCollector {
  private collector: PrometheusMetricsCollector;

  constructor(collector?: PrometheusMetricsCollector) {
    this.collector = collector || new PrometheusMetricsCollector();
  }

  static create(collector?: PrometheusMetricsCollector): MetricsCollector {
    return new MetricsCollector(collector);
  }

  // ===================================================================
  // CORE METRIC METHODS
  // ===================================================================

  async recordCounter(
    name: string,
    value = 1,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.collector.recordCounter(name, value, labels);
  }

  async recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.collector.recordTimer(name, value, labels);
  }

  async recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.collector.recordGauge(name, value, labels);
  }

  async recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): Promise<void> {
    await this.collector.recordHistogram(name, value, labels, buckets);
  }

  async recordSummary(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.collector.recordSummary(name, value, labels);
  }

  async getMetrics(): Promise<string> {
    return this.collector.getMetrics();
  }

  // ===================================================================
  // HIGH-LEVEL BUSINESS METRICS
  // ===================================================================

  async recordApiRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    service = "unknown"
  ): Promise<void> {
    this.collector.recordApiRequest(
      method,
      route,
      statusCode,
      duration,
      service
    );
  }

  async recordDatabaseOperation(
    clientType: "redis" | "postgres" | "clickhouse",
    operation: string,
    duration: number,
    success: boolean,
    service = "unknown"
  ): Promise<void> {
    this.collector.recordDatabaseOperation(
      clientType,
      operation,
      duration,
      success,
      service
    );
  }

  async recordAuthOperation(
    operation: "login" | "register" | "refresh" | "logout",
    result: "success" | "failure" | "error",
    userRole = "unknown"
  ): Promise<void> {
    this.collector.recordAuthOperation(operation, result, userRole);
  }

  async recordWebSocketActivity(
    service: string,
    messageType: string,
    direction: "inbound" | "outbound",
    connectionCount?: number
  ): Promise<void> {
    this.collector.recordWebSocketActivity(
      service,
      messageType,
      direction,
      connectionCount
    );
  }

  async recordNodeMetrics(service: string): Promise<void> {
    this.collector.recordNodeMetrics(service);
  }

  async measureEventLoopLag(service: string): Promise<void> {
    this.collector.measureEventLoopLag(service);
  }
}

export { MetricsCollector as default };

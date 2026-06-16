export interface BatchOffset {
  topic: string;
  partition: number;
  offset: string;
}

/**
 * In-memory row buffer for accumulating ClickHouse rows across Kafka batches.
 *
 * Flush trigger logic:
 *   - Size trigger: `size >= batchSize`
 *   - Time trigger: at least one row AND `elapsed >= batchTimeoutMs` since last drain
 *
 * The batcher is intentionally free of async logic — all flush decisions are
 * made by the caller (AnalyticsConsumer) inside the eachBatch callback so that
 * KafkaJS offset management stays consistent.
 */
export class Batcher<T> {
  private rows: T[] = [];
  private offsets: BatchOffset[] = [];
  private lastDrainAt = Date.now();

  constructor(
    private readonly batchSize: number,
    private readonly batchTimeoutMs: number,
  ) {}

  /** Add a row and its corresponding Kafka offset to the buffer. */
  add(row: T, offset: string, partition: number, topic: string): void {
    this.rows.push(row);
    this.offsets.push({ topic, partition, offset });
  }

  /** Current number of buffered rows. */
  get size(): number {
    return this.rows.length;
  }

  /** True when the buffer is empty. */
  isEmpty(): boolean {
    return this.rows.length === 0;
  }

  /**
   * True when the size threshold has been reached.
   * Use this for mid-loop size-based flushing.
   */
  isSizeFull(): boolean {
    return this.rows.length >= this.batchSize;
  }

  /**
   * True when the time threshold has elapsed and there is at least one row.
   * Use this for time-based flushing at the end of each eachBatch call.
   */
  isTimeExpired(): boolean {
    return this.rows.length > 0 && Date.now() - this.lastDrainAt >= this.batchTimeoutMs;
  }

  /**
   * Drain the buffer and return a snapshot of rows + offsets.
   * Resets the timer. Calling drain() on an empty buffer returns empty arrays.
   */
  drain(): { rows: T[]; offsets: BatchOffset[] } {
    const rows = this.rows.splice(0);
    const offsets = this.offsets.splice(0);
    this.lastDrainAt = Date.now();
    return { rows, offsets };
  }

  /**
   * Discard the last `count` rows that were added.
   * Used to roll back rows added during a stale/aborted eachBatch call.
   */
  rollback(count: number): void {
    this.rows.splice(-count, count);
    this.offsets.splice(-count, count);
  }
}

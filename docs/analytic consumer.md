Analytics Consumer (Node.js / TypeScript) – Complete Detailed Plan

You already have the Rust Ingestion Service and the TypeScript Enrichment & Session Service running. The Analytics Consumer is the next logical microservice: it consumes enriched.events from Kafka and writes them to ClickHouse for long‑term analytics, reporting, and model training.

Below is a production‑ready specification  with all the details you need to implement it in TypeScript.
1. Service Overview
Aspect	Specification
Name	analytics-consumer
Language	Node.js 20+ / TypeScript
Runtime	bun for development, node for production
Kafka consumer group	analytics-group
Input topic	enriched.events (JSON format)
Output	ClickHouse events table
Role	Decouple real‑time pipeline from heavy analytics storage
2. Kafka Consumer Configuration
use packages/kafka_client
The consumer must not auto‑commit offsets; commits happen only after successful ClickHouse insertion.
typescript

const kafka = new Kafka({ brokers: process.env.KAFKA_BROKERS.split(',') });
const consumer = kafka.consumer({
  groupId: 'analytics-group',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxPollInterval: 300000,
  maxPollRecords: 1000,
  autoCommit: false,
  allowAutoTopicCreation: false,
  partitionAssignmentStrategy: 'CooperativeStickyAssignor'
});

Why cooperative rebalancing? It avoids the “stop‑the‑world” rebalance pause, keeping the consumer responsive during scaling events.
3. Batching & ClickHouse Insert Strategy
use packages/clickhouse_client
ClickHouse is optimised for batch inserts. Never insert one event at a time.
Parameter	Recommended Value	Environment variable
Batch size	10,000 events	BATCH_SIZE
Batch timeout	5 seconds	BATCH_TIMEOUT_MS
ClickHouse insert method	HTTP /v1/insert?format=JSONEachRow	built‑in
Retries on failure	3 attempts, exponential backoff (100ms, 200ms, 400ms)	fixed

Implementation outline:
typescript

let batch: Array<ClickHouseEvent> = [];
let flushTimer: NodeJS.Timeout;

async function addToBatch(event: ClickHouseEvent) {
  batch.push(event);
  if (batch.length >= batchSize) {
    await flushBatch();
  }
}

async function flushBatch() {
  if (batch.length === 0) return;
  const body = batch.map(e => JSON.stringify(e)).join('\n');
  try {
    await clickhouseClient.insert({
      table: 'events',
      format: 'JSONEachRow',
      values: body,
    });
    batch = [];
    // Commit Kafka offsets after successful insert
    await consumer.commitOffsets(offsetsToCommit);
  } catch (err) {
    // see error handling section
  }
}

The timer runs every batchTimeoutMs: if the batch is not empty, call flushBatch().
4. Data Transformation (Kafka Message → ClickHouse Row)

The enriched.events message already contains all necessary fields. Map them to the ClickHouse events table schema (as defined earlier).
typescript

interface KafkaEnrichedEvent {
  event_id?: string;
  event_type: string;
  session_id: string;
  distinct_id: string;
  store_id: number;
  customer_email?: string;
  session_cart_value: number;
  session_rage_click_count: number;
  session_is_frustrated: boolean;
  properties: Record<string, any>;
  timestamp: string;   // ISO string
  server_timestamp?: string;
}

interface ClickHouseEvent {
  timestamp: string;
  event_type: string;
  session_id: string;
  distinct_id: string;
  store_id: number;
  customer_email: string;
  cart_value: number;
  rage_click_count: number;
  is_frustrated: boolean;
  properties: string;  // JSON string
  server_timestamp: string;
}

function transform(event: KafkaEnrichedEvent): ClickHouseEvent {
  return {
    timestamp: event.timestamp,
    event_type: event.event_type,
    session_id: event.session_id,
    distinct_id: event.distinct_id,
    store_id: event.store_id,
    customer_email: event.customer_email || '',
    cart_value: event.session_cart_value ?? 0,
    rage_click_count: event.session_rage_click_count ?? 0,
    is_frustrated: event.session_is_frustrated ?? false,
    properties: JSON.stringify(event.properties || {}),
    server_timestamp: event.server_timestamp || new Date().toISOString()
  };
}

5. Error Handling & Dead Letter Queue
Scenario	Action
Temporary ClickHouse error (timeout, connection reset, overload)	Retry up to 3 times with exponential backoff. If still fails, pause consumer for 5 seconds and then resume. Do not commit offset.
Permanent ClickHouse error (schema mismatch, invalid data type)	Write the original Kafka message to dead.letters topic with error details. Commit offset (skip this message).
Kafka message deserialisation error	Same as permanent error: send to DLQ, commit offset.
Redis / idempotency failure (if used)	Log and continue – do not block.

DLQ helper:
typescript

async function sendToDLQ(originalMessage: KafkaMessage, error: string) {
  const dlqProducer = await getDLQProducer();
  await dlqProducer.send({
    topic: 'dead.letters',
    messages: [{
      key: originalMessage.key,
      value: JSON.stringify({
        original_topic: 'enriched.events',
        original_partition: originalMessage.partition,
        original_offset: originalMessage.offset,
        error,
        payload: originalMessage.value.toString(),
        timestamp: new Date().toISOString()
      })
    }]
  });
}

6. Idempotency & Duplicate Prevention

Because ClickHouse is append‑only and you commit offsets after successful insert, a consumer restart could re‑insert the same batch. Rare duplicates are acceptable for analytics (<0.01%). To minimise them:

    Use event_id (if present) as a deduplication key with a short‑term Redis set (TTL 5 minutes).

    Before adding to batch, check Redis SISMEMBER dedup:event_id.

    If duplicate, skip adding to batch and commit offset.

    If not duplicate, add to batch and later SADD after successful ClickHouse insert.

Trade‑off: Accept occasional duplicates for simplicity. For MVP, skip explicit dedup.
7. Observability & Metrics (Prometheus)

Export metrics via prom-client. Add an endpoint /metrics for scraping.
Metric	Type	Labels	Description
analytics_events_consumed_total	Counter	status (success, error, duplicate)	Events read from Kafka
analytics_batch_size	Histogram	–	Number of events per batch
analytics_insert_latency_seconds	Histogram	–	Time to insert batch into ClickHouse
analytics_consumer_lag	Gauge	partition	Current lag per partition (exposed by KafkaJS)
analytics_dlq_sent_total	Counter	–	Events sent to dead letter queue
analytics_batch_flush_failure_total	Counter	–	Failed batch insert attempts

Example metric update:
typescript

metrics.eventsConsumed.inc({ status: 'success' });
metrics.batchSize.observe(batch.length);
metrics.insertLatency.record(() => insertBatch());

8. Health Checks & Graceful Shutdown

    Liveness (/live): returns 200 if the process is running.

    Readiness (/ready): returns 200 only when the Kafka consumer has joined the group and ClickHouse is reachable.

Graceful shutdown (SIGTERM):

    Stop polling Kafka (consumer.pause()).

    Wait for current batch insertion to finish (timeout 10 seconds).

    Commit final offsets (consumer.commitOffsets()).

    Close ClickHouse client and Kafka consumer.

    Exit.

9. Configuration Environment Variables

Create a .env file or use Kubernetes secrets.
env

KAFKA_BROKERS=kafka:29092
KAFKA_TOPIC=enriched.events
KAFKA_CONSUMER_GROUP=analytics-group
CLICKHOUSE_HOST=http://clickhouse:8123
CLICKHOUSE_DATABASE=default
CLICKHOUSE_TABLE=events
BATCH_SIZE=10000
BATCH_TIMEOUT_MS=5000
REDIS_URL=redis://redis:6379   # optional, for dedup
LOG_LEVEL=info

10. Testing Strategy
Test type	Description
Unit	Transformation function, batch accumulation logic.
Integration	Spin up Kafka + ClickHouse via Docker Compose. Produce test messages to enriched.events. Verify they land in ClickHouse and offsets are committed.
Error injection	Simulate ClickHouse outage (e.g., wrong port). Assert consumer pauses and retries.
Performance	Load test with 10k events/sec. Measure lag and insertion latency.

Use testcontainers for local integration tests: start Kafka and ClickHouse in Docker, run the consumer, assert.
11. Implementation Checklist (for your plan)
for caching use packages/cache
for http call use packages/http-client
for retry use packages/utils
for monotoring use packages/monitoring
for loggin use packages/logger

    In‑memory batch buffer (10k events / 5s).

    ClickHouse HTTP client (use axios or undici).

    Transformation function KafkaMessage → ClickHouseRow.

    Batch insert with retry logic (3 attempts, exponential backoff).

    Dead letter queue producer (dead.letters topic).

    Prometheus metrics endpoint (/metrics).

    Health checks (/live, /ready).

    Graceful shutdown (SIGTERM handler).

    Configuration via environment variables.

    Unit and integration tests.

    Dockerfile and Kubernetes deployment (optional for dev, but planned).


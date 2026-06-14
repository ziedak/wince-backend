# Observability and Deployment

Shared operational concerns for metrics, logs, tracing, scaling, CI/CD, and runtime deployment.

## Observability

- Prometheus for metrics.
- Alertmanager for paging and actionable warnings.
- Jaeger or OpenTelemetry for tracing.
- Loki for structured logs.
- Service dashboards should expose ingestion rate, Kafka lag, Redis hit rate, API-key lookup latency, decision latency, and intervention delivery success rate.
- OpenTelemetry should trace HTTP requests and Kafka message hops end to end. Sample rate 10% in production.
- Structured JSON logs: `{timestamp, service, level, trace_id, store_id, session_id, message}`. Retention 30 days.

### Prometheus metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `ingestion_events_total` | Counter | `store_id`, `event_type`, `status` (accepted/rejected) |
| `enrichment_latency_seconds` | Histogram | `store_id` |
| `decision_latency_seconds` | Histogram | `store_id`, `model_used` (ai/rule) |
| `intervention_deliveries_total` | Counter | `via` (websocket/email/sms), `success` |
| `ai_inference_latency_seconds` | Histogram | — |
| `kafka_consumer_lag` | Gauge | `topic`, `consumer_group` |
| `redis_bloom_false_positive_rate` | Gauge | — |
| `clickhouse_events_written_total` | Counter | — |

## Deployment

- Kubernetes on EKS or GKE.
- HPA for CPU/memory-based scaling.
- KEDA for Kafka-consumer lag-based scaling (target lag 1,000).
- PgBouncer for PostgreSQL connection pooling (transaction mode, pool size 100, max connections 1,000).
- Stateless services should be horizontally scalable; stateful data belongs in managed backing services.
- Decision Engine uses canary deployments (start at 10% traffic) for model rollouts.

## CI/CD and infrastructure

- Build and publish images from main.
- Use ArgoCD or equivalent GitOps sync.
- Use Terraform for clusters, databases, caches, Kafka, and buckets.
- Deployment rollouts should preserve backward compatibility with event schemas and queue consumers.

## Notes

- Keep the global architecture doc focused on deployment principles and link to service docs for specific runtime behavior.
- Runtime tuning details such as timeouts, retry policies, and consumer group settings belong in the service docs.
- GitOps rollouts should preserve schema compatibility across event publishers and consumers.

## Alerts

| Condition | Severity | Action |
| --- | --- | --- |
| Kafka consumer lag above 5,000 for 5 minutes | Warning | Investigate consumer scaling |
| Rejected ingestion rate above 100/min | Warning | Investigate schema or API-key issues |
| Intervention delivery failure rate above 50/min | Critical | Check gateway and fallback delivery |
| Redis memory usage above 80% | Warning | Increase capacity or split workload |
| Reconciliation discrepancy above 0.1% | Critical | Run integrity review |

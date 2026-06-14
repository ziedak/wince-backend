# Decision Engine

Consumes enriched events and decides whether to intervene, and how.

## Responsibilities

- Consume `enriched.events` and filter abandonment-like events.
- Load store policy and cooldown state.
- Check daily budget constraints.
- Assemble real-time and batch features.
- Run rule-based logic and ONNX inference in parallel.
- Decide whether to push a discount, urgency, or free-shipping intervention.
- Emit intervention records and log to Kafka and PostgreSQL.
- Respect cooldowns and budget limits before any intervention is emitted.

## Decision flow

- Consume `enriched.events` consumer group `decision-group`. Filter for `event_type IN ('checkout_abandon', 'exit_intent', 'idle_timeout')`.
- Load `policy:store:{store_id}` from Redis (source: PostgreSQL). Apply cooldown check (`cooldown:{store_id}:{distinct_id}`) and daily budget check (`budget:{store_id}:{date}`, authoritative in PostgreSQL).
- Pull batch features from ClickHouse via Redis cache (`feature:{distinct_id}`, TTL 1 h): `abandonment_rate_7d`, `avg_cart_value_30d`, etc.
- Run rule-based calculation and ONNX inference **concurrently**. Use the ONNX result when it returns within 50 ms **and** confidence > 0.6; otherwise use the rule-based result.
- ONNX model loaded from S3 via init container into a shared volume. Version controlled via pod rollout.
- If intervention decided: generate a unique discount code (`CR-{store_id}-{random_alphanumeric(8)}`, 1 h expiry) and insert into PostgreSQL `discount_codes`.
- Call Intervention Gateway `POST /v1/push` with 100 ms timeout. On `200`, done. On `404` or timeout, call Notification Service `POST /v1/notify`.
- Write intervention record to `intervention.log` Kafka topic and PostgreSQL `interventions` table.

## A/B testing

- Bucket users by `hash(distinct_id) % 100`.
- Select control or variant routing from store experiment configuration.
- Record the chosen experiment and variant with the intervention.
- Support control, rule-based, AI-v1, and AI-v2 routing from the store experiment definition.

## Notes

- Keep the 50ms inference timeout and rule fallback.
- Do not move inference into a separate network service unless latency pressure forces it.
- Rule evaluation should always have a deterministic fallback if the model path is unavailable.

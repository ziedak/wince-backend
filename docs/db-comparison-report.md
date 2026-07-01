# `packages/db` vs PostHog Backend — Database Layer Comparison Report

**Reviewer:** Staff Architect  
**Date:** 2026-07-01  
**Scope:** Persistence layer — schema design, client management, data flow, migration strategy, multi-tenancy, and operational readiness.  
**Reference:** `/home/zied/Workspace/repos/posthog_backend` (PostHog)  
**User:** `packages/db` (WinCE backend)

---

## 1. Architecture Summary

### 1.1 Component Map

#### WinCE `packages/db`

| Component | File | Role |
| --- | --- | --- |
| DB factory | `src/client.ts:createDb` | Creates a `pg.Pool` + Drizzle instance. Single connection pool, no read/write split. |
| Schema barrel | `src/schema/index.ts` | Re-exports all 11 table definitions + Drizzle query operators. |
| Stores | `src/schema/stores.ts` | Tenant entity (id, name, apiKeyHash, domain, plan, rateLimit, config). |
| Customers | `src/schema/customers.ts` | Visitor profile (storeId FK, distinctId, email, consent, LTV). Unique on (storeId, distinctId). |
| Interventions | `src/schema/interventions.ts` | Decision output record (UUID, session, type, channel, discount, delivery, conversion, experiment). |
| Discount codes | `src/schema/discount_codes.ts` | Code lifecycle (code PK, storeId, interventionId, value, expiresAt, usedAt). |
| Policy rules | `src/schema/policy_rules.ts` | Per-store JSONB rule config. |
| Admin users | `src/schema/admin_users.ts` | Admin auth (email, passwordHash, role, storeIds array). |
| Store usage | `src/schema/store_usage.ts` | Daily usage counters (events, predictions, notifications). Composite PK (storeId, date). |
| Daily budget | `src/schema/daily_budget.ts` | Daily discount total. Composite PK (storeId, date). |
| Experiments | `src/schema/experiments.ts` | A/B test config (variants JSONB, active, time window). |
| Processed events | `src/schema/processed_events.ts` | Idempotency dedupe table (eventId UUID PK). |
| Audit logs | `src/schema/audit_logs.ts` | Admin action audit (adminUserId FK, action, target, details, inet IP). |
| CH features view | `src/schema/clickhouse-features-view.sql` | Standalone SQL file for ClickHouse materialized view. Not managed by Drizzle. |
| Drizzle config | `drizzle.config.ts` | Migration generation config. **No migrations generated yet.** |

#### PostHog Backend (database-relevant subset)

| Component | File | Role |
| --- | --- | --- |
| Organization | `posthog/models/organization.py:Organization` | Tenant entity with billing, features, plugins, AI consent, session config. 810 lines. |
| Team (environment) | `posthog/models/team/team.py:Team` | Project/environment with 100+ config fields, API token, secret token, caching, field access control. 1214 lines. |
| Person | `posthog/models/person/person.py:Person` | User identity with distinct IDs, properties, version-based CH sync, split/merge logic. 645 lines. |
| PersonDistinctId | `posthog/models/person/person.py:PersonDistinctId` | Distinct ID → Person mapping with version for CH collapse. |
| Event (CH) | `posthog/models/event/sql.py` | ClickHouse events table: sharded, distributed, Kafka-engine, materialized columns, TTL. 700 lines. |
| CH schema registry | `posthog/clickhouse/schema.py` | Central registry of all CH DDL (MergeTree, Distributed, Kafka, MV, dictionaries). 527 lines. |
| Replica router | `posthog/dbrouter.py:ReplicaRouter` | Read-replica opt-in routing for PostgreSQL. |
| Person DB router | `posthog/person_db_router.py:PersonDBRouter` | Routes Person/Group/Cohort models to a separate `persons_db`. Cross-DB FK handling. |
| Migrations | `posthog/migrations/` + `posthog/async_migrations/` + `rust/persons_migrations` | Django sync migrations + async backfill migrations + Rust-managed persons schema. |
| Team caching | `posthog/models/team/team_caching.py` | Redis-backed team lookup cache by API token. |
| Activity logging | `posthog/models/activity_logging/` | Structured audit log with change tracking. |

### 1.2 Request/Data Flow (Critical Path)

#### WinCE

```
Tracker → Kong → Ingestion (Rust) → Kafka raw.events
  → Enrichment Service (Node.js)
    → CustomerService.getOrCreate()
      → Redis cache:cache:customer:{storeId}:{distinctId} (L1)
      → Drizzle SELECT customers WHERE storeId+distinctId (L2)
      → INSERT ... ON CONFLICT DO NOTHING (if miss)
    → Redis session:{sessionId} (state)
    → Kafka enriched.events
  → Decision Engine (Node.js)
    → BudgetService.checkAndReserve() → Redis Lua script
    → BudgetService.reconcile() → Drizzle upsert daily_budget
    → InterventionWriter.write() → Drizzle INSERT interventions (delivered=false)
    → Kafka intervention.log
  → Analytics Consumer (Node.js)
    → Kafka enriched.events → ClickHouse batch insert
    → Redis Bloom filter dedup
```

**Key DB touchpoints:** `customers` (enrichment), `interventions` + `daily_budget` (decision), `processed_events` (enrichment idempotency fallback), ClickHouse `events` (analytics).

#### PostHog

```
SDK → Ingestion → Kafka events_json
  → ClickHouse Kafka engine table → Materialized View → sharded_events (MergeTree)
  → Plugin server → Person upsert (PostgreSQL persons_db) → Kafka persons → CH persons MV
  → Team lookup (Redis cache by API token) → PostgreSQL default DB
  → Event written to CH with person_id, person_properties (denormalized at write time)
```

**Key DB touchpoints:** `persons_db` (Person, PersonDistinctId — separate database), `default` (Organization, Team, User), ClickHouse (events, persons, sessions, app metrics, etc.).

### 1.3 Dependency Hotspots

#### WinCE

| Hotspot | Severity | Observation |
| --- | --- | --- |
| `packages/db` is a single shared package imported by 3+ services | Medium | All services depend on the same schema barrel. No service owns its own tables. Coupling is tight — any schema change affects all consumers simultaneously. |
| `createDb` creates one pool per service instance | Low | No shared pool management. Each service manages its own lifecycle. Acceptable for microservices but no central observability. |
| ClickHouse schema is a loose SQL file | Medium | `clickhouse-features-view.sql` is not integrated with Drizzle migrations or any migration runner. Drift risk is high. |
| No migration files exist | Critical | `drizzle.config.ts` points to `./src/migrations` but the directory doesn't exist. Schema is applied manually or not at all. |

#### PostHog

| Hotspot | Severity | Observation |
| --- | --- | --- |
| `Team` model has 100+ fields | High | God object. `posthog/models/team/team.py:264` — session recording, feature flags, surveys, heatmaps, logs, web analytics all on one table. Field access control wraps nearly every field. |
| Cross-database FKs with `db_constraint=False` | Medium | `person.py:182` — Person.team uses `DO_NOTHING` + `db_constraint=False` because Person lives in a separate database. Referential integrity is application-enforced, not DB-enforced. |
| `PersonQuerySet` team_id enforcement is commented out | High | `person.py:116-119` — the custom QuerySet that validates team_id presence is disabled. Partitioned table (64 partitions) will scan all partitions without team_id. |
| Three migration systems coexist | Medium | Django migrations (default DB), async migrations (backfills), Rust migrations (persons_db). Coordination is manual. |
| `schema.py` imports 50+ SQL constants | Low | `posthog/clickhouse/schema.py` — central registry but massive. Any new table requires touching this file + the model's SQL file. |

---

## 2. Scored Evaluation

| Criterion | WinCE `packages/db` | PostHog DB layer |
| --- | --- | --- |
| **Correctness** | **6/10** — Schema definitions are syntactically correct and domain-appropriate. But no migrations exist, so "correctness" is unverified against a real database. `numeric` for monetary values is correct. `processed_events` as a UUID PK dedupe table is correct but will grow unbounded. | **8/10** — Battle-tested in production. Version-based CH sync is well-designed. But `PersonQuerySet` enforcement being disabled is a latent correctness bug. |
| **Simplicity** | **9/10** — 11 tables, one factory function, one barrel export. Easy to reason about. No premature abstractions. Drizzle's type inference is leveraged well. | **3/10** — Extreme complexity. 3 database routers, 3 migration systems, 100+ field Team model, 50+ CH table definitions. Justified by scale but debt-laden. |
| **Maintainability** | **7/10** — Small surface area. Schema files are co-located and typed. But no migration history means changes are ad-hoc. No tests for the package itself. | **4/10** — Changes to Team require touching the model + migrations + caching + field access control. Cross-database relations make refactoring risky. Heavy reliance on Django signals creates implicit coupling. |
| **Scalability** | **4/10** — Single PostgreSQL pool per service. No read replica routing. No partitioning. `processed_events` will hit 100M+ rows quickly at 10k events/sec. No sharding strategy. `storeIds` array on `admin_users` is an anti-pattern for multi-tenant scaling. | **8/10** — Read replica routing, separate persons_db, 64-partition hash partitioning, CH sharding + distributed tables. Designed for PostHog Cloud scale. |
| **Reliability** | **5/10** — No transaction wrappers exported from the package. `InterventionWriter.write()` does INSERT then Kafka produce without a transaction — ghost interventions possible if process crashes between. `BudgetService.reconcile()` is fire-and-forget. | **7/10** — `transaction.atomic()` used consistently. Kafka-after-commit pattern in `split_person` is correct. But cross-database transactions are not atomic (persons_db + default). |
| **Security** | **5/10** — `apiKeyHash` stored (good). `passwordHash` on admin_users (good). But `storeIds` integer array on admin_users is a poor ACL model. No field-level access control. No PII classification. `emailHash` and `phone` stored in `customers` but no encryption at rest specified. | **7/10** — `field_access_control` decorator on Team fields. PII handling documented. Token rotation with audit logging. But `Person.properties` is a freeform JSONField with no schema enforcement. |
| **Operability** | **3/10** — No health check on the DB pool (the `postgre_client` package has one but `packages/db` doesn't expose it). No migration runner. No schema version tracking. No connection pool metrics. `drizzle.config.ts` hardcodes a fallback password. | **7/10** — `database_healthcheck.py` exists. Migration system with version tracking. Redis caching with invalidation signals. But 3 migration systems make operational runbooks complex. |
| **Testability** | **4/10** — No tests in `packages/db`. Drizzle schemas are pure declarations (testable by type inference). But `createDb` is not mockable without env vars. No test database setup documented. | **6/10** — Extensive test suite (`conftest.py`, `test/` dirs). But tests require Django setup + multiple database fixtures. Person tests need persons_db fixture. Slow. |
| **Cost** | **7/10** — Single PostgreSQL instance + single ClickHouse node for dev. PgBouncer planned. No over-provisioning. But `processed_events` UUID PK table will require expensive storage at scale. | **5/10** — Multiple databases (default + persons_db), read replicas, large CH clusters. Justified by revenue but expensive for a startup to replicate. |

**WinCE Average: 5.6/10**  
**PostHog Average: 6.1/10**

---

## 3. Capability Parity Matrix

| Capability | WinCE `packages/db` | PostHog | Gap |
| --- | --- | --- | --- |
| Schema-as-code | ✅ Drizzle table definitions | ✅ Django models | Parity |
| Migration generation | ❌ Not generated | ✅ Django makemigrations | **Critical gap** |
| Migration execution | ❌ No runner | ✅ `manage.py migrate` + async | **Critical gap** |
| Read replica routing | ❌ Single pool | ✅ `ReplicaRouter` (opt-in) | High gap |
| Separate database per domain | ❌ Single DB | ✅ `persons_db` for Person/Group | Medium gap (premature for WinCE) |
| Multi-tenant isolation | ⚠️ `storeId` FK on all tables | ✅ `team_id` partitioning + QuerySet enforcement | High gap |
| ClickHouse schema management | ❌ Loose SQL file | ✅ Central `schema.py` registry | High gap |
| ClickHouse Kafka ingestion | ❌ App-level batch insert | ✅ Kafka engine table + MV | Medium gap (different architecture) |
| Version-based PG→CH sync | ❌ Not applicable yet | ✅ `Person.version` + Kafka CDC | Low gap (WinCE doesn't need person sync) |
| Connection pooling | ⚠️ `pg.Pool` per service | ✅ Django CONNECTION_POOL | Low gap (PgBouncer covers this) |
| Field-level access control | ❌ | ✅ `field_access_control` decorator | Medium gap |
| Audit logging | ⚠️ `audit_logs` table exists but no writer | ✅ `activity_logging` module | Medium gap |
| Token rotation | ❌ `apiKeyHash` is static | ✅ `reset_token_and_save` + cache invalidation | Medium gap |
| Redis caching for entities | ⚠️ Done at service level (CustomerService) | ✅ `team_caching.py` at model level | Low gap (architectural choice) |
| Idempotency dedup | ⚠️ `processed_events` UUID table | ✅ Kafka offset + CH `_timestamp` | Medium gap |
| Partitioning | ❌ | ✅ 64 hash partitions on `posthog_person_new` | Low gap (premature for WinCE) |
| Schema evolution testing | ❌ | ✅ Migration tests + async migration framework | High gap |
| PII handling | ⚠️ `emailHash` exists but no policy | ✅ `anonymize_ips`, `person_processing_opt_out` | Medium gap |

---

## 4. Shared Blind Spots

### 4.1 Schema Evolution & Backward Compatibility

> **`packages/db/drizzle.config.ts:4`** — `out: './src/migrations'` points to a non-existent directory. **Severity**: Critical — **Impact**: No reproducible schema. Deployments rely on manual DDL or Drizzle's `push` command which is unsafe for production. **Recommendation**: Generate initial migration immediately with `drizzle-kit generate` and commit it. Add a migration runner to CI/CD.

> **`posthog/models/team/team.py:264`** — Team model has 15+ DEPRECATED fields still in the schema. **Severity**: Medium — **Impact**: Schema bloat, migration complexity, confusion for new engineers. **Recommendation**: WinCE should establish a deprecation policy from day one — mark deprecated columns in JSDoc and schedule removal.

### 4.2 Concurrency & Race Conditions

> **`apps/decision-engine/src/intervention/intervention.writer.ts:28-70`** — INSERT then Kafka produce without a transaction. **Severity**: High — **Impact**: If the process crashes after INSERT but before Kafka produce, the intervention exists in PostgreSQL as `delivered=false` forever (ghost intervention). If Kafka produce succeeds but INSERT failed, the downstream consumers see an intervention with no DB record. **Recommendation**: Use the transactional outbox pattern — INSERT + outbox row in the same transaction, then a separate relay publishes to Kafka. Alternatively, accept the current design but add a reconciliation worker that scans for stale `delivered=false` interventions.

> **`apps/decision-engine/src/budget/budget.service.ts:39-59`** — Redis Lua script for budget reservation is correct, but `reconcile()` is fire-and-forget. **Severity**: Medium — **Impact**: Redis and PostgreSQL can diverge silently. A Redis flush loses budget state with no recovery path except manual reconstruction. **Recommendation**: Add a periodic reconciliation job that compares Redis budget keys to `daily_budget` rows and logs discrepancies.

> **`posthog/models/person/person.py:278-372`** — `split_person` locks PDIs, creates new persons, reassigns PDIs, then publishes to Kafka after commit. **Severity**: Low — **Impact**: Correct pattern (DB is source of truth, Kafka catches up via versioning). But if Kafka publish fails after commit, CH is stale until a resync job runs. **Recommendation**: WinCE doesn't need person splitting, but should adopt the "DB first, Kafka after commit" pattern for critical writes.

### 4.3 Idempotency & Dedup

> **`packages/db/src/schema/processed_events.ts:3-6`** — `processed_events` table with UUID PK and no TTL or partitioning. **Severity**: High — **Impact**: At 10k events/sec, this table grows by ~864M rows/day. UUID PK means B-tree index becomes a hotspot. No cleanup mechanism. **Recommendation**: Either (a) partition by `processedAt` date with a 7-day TTL, or (b) rely solely on the Redis Bloom filter and drop this table entirely (the architecture doc says Bloom is the primary dedup, PG is only for false-positive fallback — a false-positive check doesn't need full history, just a sliding window).

> **`posthog/clickhouse/schema.py:421-449`** — PostHog uses Kafka engine tables that handle dedup via `ReplacingMergeTree` + `_timestamp` version. **Severity**: Low — **Impact**: CH-level dedup is eventual, not immediate. Duplicate events can appear in queries before merges run. **Recommendation**: WinCE's Bloom filter approach is actually better for its use case (event dedup at ingestion), but the PG fallback table needs a TTL.

### 4.4 Observability Gaps

> **`packages/db/src/client.ts:18-27`** — `createDb` exposes no pool metrics, no query latency hooks, no slow query logging. **Severity**: Medium — **Impact**: DB performance issues are invisible until they cause timeouts. No way to correlate service latency with DB query latency at the package level. **Recommendation**: Add optional `onQuery` and `onError` callbacks to `DbOptions`. Wire them to the `monitoring` package.

> **`packages/db` has no health check** — The `postgre_client` package has `healthCheck()` but `packages/db` doesn't re-export or use it. **Severity**: Medium — **Impact**: Services using `@org/db` can't expose a DB health check without importing `@org/postgre_client` separately. **Recommendation**: Add a `healthCheck(db)` function to `packages/db` that runs `SELECT 1` via the Drizzle instance.

### 4.5 Security & PII

> **`packages/db/src/schema/admin_users.ts:8`** — `storeIds: integer('store_ids').array().default([])` is an array of store IDs on the admin user. **Severity**: Medium — **Impact**: This is an ACL anti-pattern — no cascade on store deletion, no index on array membership, no role-based granularity. A junction table (`admin_user_stores`) with a FK is the correct pattern. **Recommendation**: Replace with a junction table or adopt PostHog's `OrganizationMembership` pattern (level-based access with a through table).

> **`packages/db/src/schema/customers.ts:23-24`** — `email` and `phone` stored in plaintext. `emailHash` exists but `phone` has no hash equivalent. **Severity**: Medium — **Impact**: PII at rest without encryption. If the database is compromised, customer contact info is exposed. **Recommendation**: Document PII columns. Consider application-level encryption for email/phone, or rely on PostgreSQL column-level encryption (pgcrypto). At minimum, add a `phoneHash` for consistency.

> **`packages/db/drizzle.config.ts:8`** — Fallback connection string contains `admin:password`. **Severity**: Low — **Impact**: Credentials in source code. Not a real secret (it's a dev fallback) but sets a bad precedent. **Recommendation**: Remove the fallback and fail fast if `DATABASE_URL` is unset.

### 4.6 Multi-Tenancy Isolation

> **`packages/db` — all tables use `storeId` FK but no row-level security, no partitioning, no query-level enforcement.** **Severity**: High — **Impact**: A bug in any service that forgets to filter by `storeId` will leak data across tenants. There is no safety net. PostHog has the same issue (PersonQuerySet is disabled) but at least has the mechanism. **Recommendation**: Add a Drizzle middleware or wrapper that injects `storeId` into all queries on tenant-scoped tables. Alternatively, enable PostgreSQL Row-Level Security (RLS) policies on all tenant tables.

---

## 5. Hybrid Proposal

### 5.1 Target Architecture

```
packages/db/
├── src/
│   ├── client.ts              # createDb() with pool metrics + health check
│   ├── schema/
│   │   ├── index.ts           # barrel export
│   │   ├── stores.ts          # tenant entity
│   │   ├── customers.ts       # visitor profile (partitioned by storeId in future)
│   │   ├── interventions.ts
│   │   ├── discount_codes.ts
│   │   ├── policy_rules.ts
│   │   ├── admin_users.ts
│   │   ├── admin_user_stores.ts  # NEW: junction table replacing storeIds array
│   │   ├── store_usage.ts
│   │   ├── daily_budget.ts
│   │   ├── experiments.ts
│   │   ├── processed_events.ts   # partitioned by processedAt with 7-day TTL
│   │   └── audit_logs.ts
│   ├── migrations/            # NEW: generated by drizzle-kit
│   │   ├── 0000_initial.sql
│   │   └── meta/
│   ├── clickhouse/            # NEW: CH schema management
│   │   ├── schema.ts          # DDL registry (inspired by PostHog schema.py)
│   │   ├── events.sql
│   │   └── daily_abandonment_stats.sql
│   ├── health.ts              # NEW: healthCheck(db)
│   └── rls.ts                 # NEW: RLS policy helpers
├── drizzle.config.ts
└── package.json
```

**Key design decisions:**

1. **Migration-first** — Generate and commit migrations. Never use `drizzle-kit push` in production. Add `drizzle-kit migrate` to CI/CD.
2. **ClickHouse schema co-located** — Move `clickhouse-features-view.sql` into a structured `clickhouse/` directory with a TypeScript registry (simpler than PostHog's `schema.py` but same principle).
3. **Junction table for admin-store ACL** — Replace `admin_users.storeIds` array with `admin_user_stores` junction table.
4. **Partitioned `processed_events`** — Add date partitioning + TTL. Or drop entirely if Bloom filter is sufficient.
5. **Pool observability** — Add optional callbacks to `DbOptions` for query timing and error tracking.
6. **Health check export** — `healthCheck(db)` function.
7. **No read replica routing (yet)** — Premature for WinCE's current scale. Add when throughput demands it. Design `createDb` to accept a `readConnectionString` option in the future.
8. **No separate persons_db (yet)** — Premature. WinCE's `customers` table is not high-cardinality enough to justify a separate database. Design schema to allow extraction if needed.

### 5.2 Migration Plan

#### Phase 1: Stabilize (Effort: 1 day, Risk: Low, Rollback: N/A)

- [ ] Generate initial Drizzle migration: `bun drizzle-kit generate`
- [ ] Commit `src/migrations/` to git
- [ ] Add `drizzle-kit migrate` script to `package.json`
- [ ] Remove hardcoded password from `drizzle.config.ts`
- [ ] Add `healthCheck(db)` to `client.ts`
- [ ] Add pool metrics callbacks to `DbOptions`

**Rollback:** Delete migration files. No schema changes applied yet.

#### Phase 2: Extract (Effort: 2 days, Risk: Medium, Rollback: Revert migration)

- [ ] Create `admin_user_stores` junction table
- [ ] Write migration to: (a) create junction table, (b) migrate existing `storeIds` arrays into junction rows, (c) drop `storeIds` column
- [ ] Update all consumers of `adminUsers.storeIds` to query the junction table
- [ ] Partition `processed_events` by `processedAt` (or drop if Bloom-only)
- [ ] Add `phoneHash` to `customers` schema

**Rollback:** Revert migration. Junction table data is derived from `storeIds` which is preserved until step (c).

#### Phase 3: Replace (Effort: 3 days, Risk: High, Rollback: Revert to app-level CH management)

- [ ] Create `src/clickhouse/schema.ts` DDL registry
- [ ] Move `clickhouse-features-view.sql` into `src/clickhouse/`
- [ ] Add CH migration runner script (simple version: execute SQL files in order, track applied in a `ch_migrations` table)
- [ ] Integrate CH migration runner into docker-compose startup
- [ ] Add RLS policies to all tenant-scoped PostgreSQL tables
- [ ] Add Drizzle middleware that enforces `storeId` on tenant-scoped queries (defense-in-depth alongside RLS)

**Rollback:** Disable RLS policies (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`). Revert to app-level CH DDL.

#### Phase 4: Optimize (Effort: Ongoing, Risk: Low, Rollback: Feature flags)

- [ ] Add read replica support to `createDb` (when throughput demands)
- [ ] Add `customers` table partitioning by `storeId` (when a single store exceeds 10M customers)
- [ ] Add transactional outbox pattern for `InterventionWriter` (when ghost interventions become a production issue)
- [ ] Add budget reconciliation worker (when Redis/PG budget divergence is observed)

### 5.3 Success Criteria

| Criterion | Target | Measurement |
| --- | --- | --- |
| Migration reproducibility | Fresh `docker-compose up` creates correct schema via migrations only | `bun drizzle-kit migrate` on empty DB succeeds |
| Schema version tracking | Every DB has a `__drizzle_migrations` table with applied versions | `SELECT * FROM __drizzle_migrations` returns expected rows |
| Health check coverage | Every service exposes `/live` and `/ready` that include DB health | `curl /ready` returns 503 when DB is down |
| No cross-tenant leakage | RLS policies block queries without `storeId` context | Integration test: query without `storeId` returns 0 rows |
| PII columns documented | All PII columns have JSDoc `@pii` tags | `grep -r "@pii" packages/db/src/schema/` returns expected count |
| CH schema versioned | `ch_migrations` table tracks applied CH DDL | `SELECT * FROM ch_migrations` returns expected rows |
| Pool metrics | DB pool active/idle/waiting counts exported to Prometheus | `pg_pool_active{service="..."} ` metric exists |
| No hardcoded credentials | `grep -r "password" packages/db/` returns 0 results (excluding test fixtures) | CI grep check |

**Benchmark targets (at 10k events/sec):**

| Metric | Target |
| --- | --- |
| `customers` lookup p99 | < 5ms (with Redis cache hit) |
| `interventions` insert p99 | < 10ms |
| `daily_budget` upsert p99 | < 8ms |
| `processed_events` dedup check p99 | < 3ms (Bloom hit) / < 15ms (Bloom miss + PG fallback) |
| Migration apply time (fresh) | < 30 seconds |

**Rollout signals (stop and rollback if):**

- Any migration fails to apply on a fresh database
- RLS policies block legitimate queries (false positive rate > 0.1%)
- Pool metrics show > 80% connection utilization at steady state
- `processed_events` table grows > 100M rows without TTL enforcement

---

## 6. Decision Prioritization

### MUST (Block production deployment)

1. **Generate and commit Drizzle migrations** — No migration = no reproducible deployment. `packages/db/drizzle.config.ts:4` + missing `src/migrations/`.
2. **Remove hardcoded password from `drizzle.config.ts:8`** — Security hygiene.
3. **Add `healthCheck(db)` to `packages/db`** — Services need this for Kubernetes readiness probes.
4. **Partition or drop `processed_events`** — Unbounded growth at 10k events/sec will cause operational failure within weeks.

### SHOULD (Address before scaling beyond 1k events/sec)

5. **Replace `admin_users.storeIds` array with junction table** — ACL correctness and cascade integrity.
6. **Add RLS policies or Drizzle middleware for tenant isolation** — Defense-in-depth against missing `storeId` filters.
7. **Add pool metrics and slow query logging to `createDb`** — Observability is required for production debugging.
8. **Move ClickHouse DDL into a managed registry** — Prevent schema drift between environments.
9. **Add `phoneHash` to `customers`** — PII consistency with existing `emailHash`.
10. **Add transactional outbox to `InterventionWriter`** — Eliminate ghost interventions.

### COULD (Defer until scale demands)

11. **Read replica routing** — Premature until read QPS exceeds single-instance capacity.
12. **Separate `customers` database** — Premature until customer cardinality exceeds 50M.
13. **`customers` table partitioning by `storeId`** — Premature until single-store customer count exceeds 10M.
14. **Budget reconciliation worker** — Defer until Redis/PG divergence is observed in production.
15. **Field-level access control (PostHog's `field_access_control`)** — Defer until multi-role admin requirements emerge.

---

## 7. Evidence Index

| Finding | File:Function/Class | Severity |
| --- | --- | --- |
| No migrations generated | `packages/db/drizzle.config.ts:4` | Critical |
| Hardcoded password | `packages/db/drizzle.config.ts:8` | Low |
| No health check | `packages/db/src/client.ts:18` | Medium |
| No pool metrics | `packages/db/src/client.ts:18` | Medium |
| `processed_events` unbounded growth | `packages/db/src/schema/processed_events.ts:3` | High |
| `storeIds` array anti-pattern | `packages/db/src/schema/admin_users.ts:8` | Medium |
| PII plaintext (email, phone) | `packages/db/src/schema/customers.ts:23-24` | Medium |
| No tenant isolation enforcement | `packages/db/src/schema/*.ts` (all tenant tables) | High |
| CH schema not managed | `packages/db/src/schema/clickhouse-features-view.sql` | Medium |
| Ghost intervention risk | `apps/decision-engine/src/intervention/intervention.writer.ts:28-70` | High |
| Budget Redis/PG divergence | `apps/decision-engine/src/budget/budget.service.ts:65-80` | Medium |
| Team god object | `posthog/models/team/team.py:264` | High |
| PersonQuerySet disabled | `posthog/models/person/person.py:116-119` | High |
| Cross-DB FK integrity | `posthog/models/person/person.py:182` | Medium |
| 3 migration systems | `posthog/migrations/` + `posthog/async_migrations/` + `rust/persons_migrations` | Medium |

---

## 8. Classification of Flaws

| Flaw | Type | Notes |
| --- | --- | --- |
| No migrations | **Operational** | Drizzle supports it; it's just not done. |
| `storeIds` array | **Design** | Junction table is the correct pattern. |
| Ghost interventions | **Design** | Transactional outbox is the correct pattern. |
| No tenant isolation | **Design** | RLS or query middleware is the correct pattern. |
| `processed_events` unbounded | **Design** | Partitioning + TTL is the correct pattern. |
| No pool metrics | **Implementation** | `pg.Pool` exposes events; just not wired. |
| Hardcoded password | **Implementation** | Remove the fallback. |
| PostHog Team god object | **Design** | Extension models are the correct pattern (partially implemented). |
| PostHog PersonQuerySet disabled | **Implementation** | Uncomment and fix false positives. |
| PostHog cross-DB FKs | **Design** | Inherent to the separate-database architecture. |

---

---

## 9. Missing Schema: PostgreSQL Tables & Columns

This section cross-references the architecture docs, tracking model, service docs, and actual service code against the current `packages/db` schema to identify missing tables and columns.

### 9.1 Missing PostgreSQL Tables

#### `api_keys` — Critical

> **Source:** `docs/services/api-key-service.md:10-11` — "Keep the lookup path revocable so keys can be disabled without changing ingestion code."  
> **Current state:** `stores.apiKeyHash` is a single hash per store. No way to have multiple keys, rotate keys, or revoke individual keys.  
> **Severity:** High — **Impact:** Key rotation requires changing the store record. No audit trail for key creation/revocation. Cannot issue separate keys for browser tracker vs WooCommerce tracker.  
> **Recommended schema:**

```sql
CREATE TABLE api_keys (
  id          SERIAL PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT,                    -- 'browser-tracker', 'woocommerce', 'staging'
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);
```

#### `store_domains` — Medium

> **Source:** `docs/services/api-key-service.md:16` — Response includes `domain_whitelist: ["example.com"]`.  
> **Current state:** `stores.domain` is a single `TEXT` field.  
> **Severity:** Medium — **Impact:** Cannot support multiple allowed domains per store. API key service cannot return a whitelist.  
> **Recommended schema:**

```sql
CREATE TABLE store_domains (
  id       SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  domain   TEXT NOT NULL,
  UNIQUE(store_id, domain)
);
```

#### `intervention_events` — High

> **Source:** `docs/domains/tracking-model.md:150-156` — Tracker sends `$intervention_shown`, `$intervention_dismissed`, `$intervention_clicked`, `$intervention_accepted`, `$intervention_ignored`, `$intervention_suppressed`. Each carries `intervention_id`, `intervention_type`, `channel`, `trigger_reason`, `variant_id`, `experiment_id`, `confidence_score`, `dismissed_reason`, `suppressed_reason`.  
> **Current state:** `interventions` table only has `delivered` (boolean) and `converted` (boolean). The full interaction lifecycle is not captured.  
> **Severity:** High — **Impact:** Cannot measure intervention effectiveness (click-through rate, dismissal rate, acceptance rate). Cannot attribute conversions to specific interactions. The admin API has no data to serve analytics endpoints.  
> **Recommended schema:**

```sql
CREATE TABLE intervention_events (
  id              SERIAL PRIMARY KEY,
  intervention_id UUID NOT NULL REFERENCES interventions(intervention_id),
  store_id        INTEGER NOT NULL REFERENCES stores(id),
  event_type      TEXT NOT NULL,       -- 'shown', 'dismissed', 'clicked', 'accepted', 'ignored', 'suppressed'
  reason          TEXT,                -- dismissed_reason or suppressed_reason
  occurred_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**Alternative:** Add lifecycle columns directly to `interventions` (see §9.2 below). A separate table is preferred because it preserves the full event sequence and allows multiple events per intervention.

#### `notification_logs` — Medium

> **Source:** `docs/services/notification-service.md:11` — "Write delivery outcome events to Kafka." `docs/domains/analytics-and-ops.md:18-20` — "Update store usage counters for billing."  
> **Current state:** No table captures notification delivery records. `store_usage.notifications_sent` is an aggregate counter but has no detail rows.  
> **Severity:** Medium — **Impact:** Cannot audit individual notification deliveries. Cannot debug delivery failures. Billing disputes have no evidence trail.  
> **Recommended schema:**

```sql
CREATE TABLE notification_logs (
  id              SERIAL PRIMARY KEY,
  intervention_id UUID,
  store_id        INTEGER NOT NULL REFERENCES stores(id),
  distinct_id     TEXT,
  channel         TEXT NOT NULL,       -- 'email', 'sms', 'push'
  status          TEXT NOT NULL,       -- 'sent', 'failed', 'bounced'
  provider        TEXT,                -- 'sendgrid', 'twilio', 'firebase'
  provider_id     TEXT,                -- provider message ID for tracing
  error           TEXT,
  sent_at         TIMESTAMPTZ DEFAULT NOW()
);
```

**Note:** This could also live in ClickHouse only (for analytics) if compliance doesn't require PostgreSQL. But billing needs it in PostgreSQL or a queryable store.

### 9.2 Missing PostgreSQL Columns (Existing Tables)

#### `stores`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `is_active` | `boolean DEFAULT true` | PostHog `Organization.is_active` | Medium | Cannot temporarily disable a store without deleting it. |
| `is_pending_deletion` | `boolean DEFAULT false` | `docs/domains/security.md:82` — right-to-deletion | Medium | Need a flag to block UI access during async deletion. |
| `timezone` | `text DEFAULT 'UTC'` | Decision engine needs store timezone for daily budget reset | Low | Currently using UTC everywhere, but stores may want local-time budget windows. |
| `currency` | `text DEFAULT 'USD'` | `docs/domains/tracking-model.md:106` — cart events carry `currency` | Low | Store-level default currency for reporting. |

#### `customers`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `phone_hash` | `text` | Consistency with `email_hash` | Medium | Cannot deduplicate by phone without a hash. PII consistency. |
| `deleted_at` | `timestamp` | `docs/domains/security.md:82` — "delete customer record" | High | Right-to-deletion requires soft-delete tracking. Currently no way to mark a customer as deleted without removing the row (which breaks FK references from `interventions`). |
| `first_seen_at` | `timestamp` | Distinct from `created_at` (which is when the DB row was created) | Low | `created_at` may differ from first event timestamp if customer was created anonymously. |
| `total_sessions` | `integer DEFAULT 0` | Feature for decision engine | Low | Could be derived from ClickHouse, but having a denormalized counter avoids a CH query on every decision. |
| `total_interventions` | `integer DEFAULT 0` | Feature for decision engine | Low | Same rationale. |

#### `interventions`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `trigger_reason` | `text` | `docs/domains/tracking-model.md:151` — `$intervention_shown` carries `trigger_reason` | Medium | Cannot analyze why interventions were triggered (checkout_abandon vs exit_intent vs idle_timeout). |
| `variant_id` | `text` | `docs/domains/tracking-model.md:151` — `$intervention_shown` carries `variant_id` | Medium | Distinct from `variant` (which is the A/B test variant). `variant_id` is the intervention template variant. |
| `confidence_score` | `numeric` | `docs/domains/tracking-model.md:151` — `$intervention_shown` carries `confidence_score` | Low | Currently have `inference_confidence` — verify these are the same. If so, rename for consistency. |
| `shown_at` | `timestamp` | Tracker `$intervention_shown` event | High | `sent_at` is when the decision engine emitted; `shown_at` is when the user actually saw it. These can differ by seconds if WebSocket delivery is slow. |
| `clicked_at` | `timestamp` | Tracker `$intervention_clicked` event | High | Currently only `converted` boolean exists. No timestamp for when the click happened. |
| `dismissed_at` | `timestamp` | Tracker `$intervention_dismissed` event | Medium | Cannot measure time-to-dismiss. |
| `accepted_at` | `timestamp` | Tracker `$intervention_accepted` event | Medium | Cannot measure time-to-accept. |
| `attribution_window_hours` | `integer` | `docs/domains/revenue-attribution-ab-testing.md:18` — 24h attribution window | Low | Currently hardcoded. Should be configurable per intervention or per store policy. |
| `attributed_at` | `timestamp` | When attribution was computed | Medium | Cannot distinguish "converted=true but not yet attributed" from "attributed at time X". |

#### `discount_codes`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `discount_type` | `text` | `docs/services/decision-engine.md:12` — 'discount', 'free_shipping', 'urgency' | High | Currently `value` is a numeric percent. Cannot represent free shipping (no percent) or fixed amount. |
| `min_cart_value` | `numeric` | `docs/services/admin-api.md:37` — `GET /v1/validate-discount?code=...&cart_total=100` | Medium | Validation endpoint needs minimum cart value check. Currently no min stored. |
| `max_uses` | `integer DEFAULT 1` | Single-use vs multi-use codes | Medium | Currently no use limit. A code could be reused indefinitely until `used_at` is set. |
| `used_count` | `integer DEFAULT 0` | Track redemptions | Medium | `used_at` is a single timestamp — cannot track multiple redemptions. |

#### `admin_users`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `is_active` | `boolean DEFAULT true` | Security best practice | Medium | Cannot disable an admin without deleting. |
| `last_login_at` | `timestamp` | Security audit | Low | No login activity tracking. |
| `failed_login_attempts` | `integer DEFAULT 0` | Brute-force protection | Medium | No lockout mechanism. |
| `locked_until` | `timestamp` | Brute-force protection | Medium | No lockout mechanism. |

#### `store_usage`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `interventions_sent` | `bigint DEFAULT 0` | `docs/domains/analytics-and-ops.md:20` — billing | Medium | Currently only `notifications_sent`. Interventions sent via WebSocket are not counted. |
| `revenue_recovered` | `numeric DEFAULT 0` | Billing / dashboard | Medium | No daily revenue recovered counter for billing. |

#### `experiments`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `description` | `text` | Admin API display | Low | No description field for UI. |
| `metric` | `text` | `docs/services/admin-api.md:33` — experiment results | Medium | What metric is being measured? (recovery_rate, revenue, click_rate). Currently undefined. |
| `confidence_level` | `numeric DEFAULT 0.95` | `docs/services/admin-api.md:34` — "confidence intervals" | Low | No configurable confidence level. |

#### `audit_logs`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `user_agent` | `text` | Forensic analysis | Low | No UA tracking. |
| `success` | `boolean DEFAULT true` | Distinguish failed actions from successful | Low | Currently no success/failure flag. |
| `store_id` | `integer` | Tenant scoping for audit logs | Medium | Cannot filter audit logs by store. |

#### `processed_events`

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `store_id` | `integer` | Tenant scoping + partition pruning | High | Currently only `event_id` UUID PK. Cannot partition by store. Cannot enforce tenant isolation. |
| (partitioning) | — | Already noted in §4.3 | Critical | Needs date partitioning + 7-day TTL. |

### 9.3 Naming Inconsistencies

| Schema name | Tracker name | Source | Severity |
| --- | --- | --- | --- |
| `event_id` | `eid` | `docs/domains/tracking-model.md:211` — "Use `eid` as the dedupe key" | Low — document the mapping, don't rename the DB column. |
| `distinct_id` | `anon` / `uid` | `docs/domains/tracking-model.md:212` — "old `distinct_id` naming maps to `anon`" | Low — document the mapping. |
| `session_id` | `sid` | `docs/domains/tracking-model.md:212` | Low — document the mapping. |
| `inference_confidence` | `confidence_score` | `docs/domains/tracking-model.md:151` | Low — verify these are the same concept; rename if so. |

---

## 10. Missing Schema: ClickHouse Tables & Columns

### 10.1 Schema Drift: `events` Table

> **`docs/DB.md:201-218`** vs **`apps/analytics-consumer/src/types.ts:34-52`**  
> **Severity:** Critical — **Impact:** The analytics consumer writes columns (`event_id`, `customer_id`, `lifetime_value`, `email_consent`, `sms_consent`, `session_available`) that do not exist in the ClickHouse DDL. Inserts will either fail or silently drop data depending on ClickHouse settings.  
> **Recommendation:** Update the ClickHouse DDL to match `ClickHouseRow`. The DDL in `docs/DB.md` is stale.

**Columns in code but missing from DDL:**

| Column | Type (from code) | Needed for |
| --- | --- | --- |
| `event_id` | `String` (UUID) | Dedup, joining with `intervention_events` |
| `customer_id` | `UInt32` (nullable) | Joining CH events with PG customer records |
| `lifetime_value` | `Float64` | Feature computation, segmentation |
| `email_consent` | `UInt8` | Consent-aware analytics |
| `sms_consent` | `UInt8` | Consent-aware analytics |
| `session_available` | `UInt8` | Data quality filtering |

**Columns in DDL but not in code:**

| Column | Status |
| --- | --- |
| `customer_email` | Present in both — but `docs/domains/security.md:81` says "PII stays out of analytics stores." `customer_email` in ClickHouse violates this. **Severity:** High. **Recommendation:** Remove `customer_email` from the CH events table. Use `customer_id` as a join key to PostgreSQL for PII. |

### 10.2 Missing ClickHouse Tables

#### `intervention_events` — High

> **Source:** `docs/domains/tracking-model.md:150-156` — intervention interaction events.  
> **Current state:** No CH table for intervention interactions.  
> **Severity:** High — **Impact:** Cannot compute click-through rate, dismissal rate, or acceptance rate from analytics. The admin API `GET /admin/analytics/recovery` has no data source for funnel metrics.  
> **Recommended schema:**

```sql
CREATE TABLE intervention_events_local
(
    event_id        String,
    intervention_id String,
    store_id        UInt32,
    distinct_id     String,
    event_type      LowCardinality(String),  -- 'shown', 'dismissed', 'clicked', 'accepted', 'ignored', 'suppressed'
    reason          String,
    variant         String,
    experiment_id   String,
    timestamp       DateTime64(3, 'UTC'),
    properties      String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (store_id, intervention_id, timestamp)
TTL timestamp + INTERVAL 90 DAY;
```

#### `notification_logs` — Medium

> **Source:** `docs/services/notification-service.md:11` — delivery outcomes to Kafka `notification.log`.  
> **Current state:** No CH table.  
> **Severity:** Medium — **Impact:** Cannot analyze notification delivery rates, bounce rates, or channel effectiveness over time.  
> **Recommended schema:**

```sql
CREATE TABLE notification_logs_local
(
    event_id        String,
    intervention_id String,
    store_id        UInt32,
    distinct_id     String,
    channel         LowCardinality(String),  -- 'email', 'sms', 'push'
    status          LowCardinality(String),  -- 'sent', 'failed', 'bounced'
    provider        LowCardinality(String),
    error           String,
    timestamp       DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (store_id, timestamp)
TTL timestamp + INTERVAL 90 DAY;
```

#### `daily_intervention_stats` (materialized view) — High

> **Source:** `docs/services/admin-api.md:25-26` — `GET /admin/analytics/recovery` returns `abandonment_rate, recovery_rate, revenue_recovered`.  
> **Current state:** Only `daily_abandonment_stats` MV exists (abandonments, purchases, recovered_revenue). No view for intervention performance.  
> **Severity:** High — **Impact:** Admin API recovery analytics endpoint has no pre-aggregated data source. Queries against raw `events` will be slow.  
> **Recommended schema:**

```sql
CREATE MATERIALIZED VIEW daily_intervention_stats_local
ENGINE = SummingMergeTree()
ORDER BY (store_id, date)
AS SELECT
    toDate(timestamp) AS date,
    store_id,
    countIf(event_type = 'shown')      AS interventions_shown,
    countIf(event_type = 'clicked')    AS interventions_clicked,
    countIf(event_type = 'accepted')   AS interventions_accepted,
    countIf(event_type = 'dismissed')  AS interventions_dismissed
FROM intervention_events_local
GROUP BY date, store_id;
```

#### `experiment_results` (materialized view) — Medium

> **Source:** `docs/services/admin-api.md:33-34` — `GET /admin/experiments/{id}/results` returns "recovery rate per variant with confidence intervals".  
> **Current state:** No CH view for experiment results.  
> **Severity:** Medium — **Impact:** Experiment results query must scan raw events + intervention_events. No pre-aggregation.  
> **Recommended schema:**

```sql
CREATE MATERIALIZED VIEW experiment_results_local
ENGINE = AggregatingMergeTree()
ORDER BY (experiment_id, variant, date)
AS SELECT
    experiment_id,
    variant,
    toDate(timestamp) AS date,
    countState() AS exposures,
    countIfState(event_type = 'converted') AS conversions,
    sumState(revenue) AS revenue
FROM intervention_events_local
WHERE experiment_id != ''
GROUP BY experiment_id, variant, date;
```

### 10.3 Missing ClickHouse Columns (Existing `events` Table)

| Column | Type | Source | Severity | Justification |
| --- | --- | --- | --- | --- |
| `event_id` | `String` | `apps/analytics-consumer/src/types.ts:36` | Critical | Already written by code but missing from DDL. |
| `customer_id` | `Nullable(UInt32)` | `apps/analytics-consumer/src/types.ts:43` | Critical | Already written by code but missing from DDL. |
| `lifetime_value` | `Float64` | `apps/analytics-consumer/src/types.ts:44` | Critical | Already written by code but missing from DDL. |
| `email_consent` | `UInt8` | `apps/analytics-consumer/src/types.ts:45` | Critical | Already written by code but missing from DDL. |
| `sms_consent` | `UInt8` | `apps/analytics-consumer/src/types.ts:46` | Critical | Already written by code but missing from DDL. |
| `session_available` | `UInt8` | `apps/analytics-consumer/src/types.ts:49` | Critical | Already written by code but missing from DDL. |
| `window_id` | `String` | `docs/domains/tracking-model.md:44` — tab-scoped window ID | Low | Useful for cross-tab session analysis. |
| `pageview_id` | `String` | `docs/domains/tracking-model.md:45` | Low | Useful for page-level funnel analysis. |
| `device_type` | `LowCardinality(String)` | `docs/domains/tracking-model.md:82` — `props.device_type` | Medium | Cannot segment by device without parsing JSON. |
| `utm_source` | `String` | `docs/domains/tracking-model.md:82` — `utm_*` | Medium | Cannot attribute interventions to traffic source without JSON parsing. |
| `referrer` | `String` | `docs/domains/tracking-model.md:43` — `ref` | Low | Currently in `properties` JSON. Extract for faster filtering. |

### 10.4 PII in ClickHouse — Compliance Violation

> **`docs/DB.md:208`** — `customer_email String CODEC(ZSTD)` in the `events` table.  
> **`docs/domains/security.md:81`** — "Keep PII (email, phone) stored only in PostgreSQL, not in ClickHouse."  
> **`docs/domains/security.md:82`** — "anonymize ClickHouse events by setting `customer_email = NULL`"  
> **Severity:** High — **Impact:** The current schema violates the stated security policy. Email is PII and should not be in the analytics store. The right-to-deletion process requires nullifying `customer_email` in CH, which is expensive on MergeTree.  
> **Recommendation:** Remove `customer_email` from the CH `events` table. Replace with `customer_id` (non-PII integer) as the join key. If email-based analytics are needed, use a ClickHouse dictionary backed by PostgreSQL `customers` table with a restricted projection.

### 10.5 `mv_customer_features` Not in DDL

> **`packages/db/src/schema/clickhouse-features-view.sql`** — Defines `customer_features_agg`, `mv_customer_features_trigger`, and `mv_customer_features`.  
> **`docs/DB.md`** — Does not include this view.  
> **Severity:** Medium — **Impact:** The feature view used by the decision engine is not in the canonical DDL. New environments won't have it.  
> **Recommendation:** Add the `mv_customer_features` DDL to `docs/DB.md` and to the proposed `src/clickhouse/schema.ts` registry.

---

## 11. Summary of Schema Gaps

| Category | Critical | High | Medium | Low | Total |
| --- | --- | --- | --- | --- | --- |
| Missing PG tables | 0 | 2 | 2 | 0 | 4 |
| Missing PG columns | 1 | 4 | 12 | 8 | 25 |
| Missing CH tables | 0 | 2 | 2 | 0 | 4 |
| Missing CH columns | 6 | 1 | 2 | 3 | 12 |
| PII compliance | 0 | 1 | 0 | 0 | 1 |
| Naming inconsistencies | 0 | 0 | 0 | 4 | 4 |
| **Total** | **7** | **10** | **18** | **15** | **50** |

**Top 7 Critical items (must fix before any production deployment):**

1. ClickHouse DDL is stale — 6 columns written by code don't exist in the schema (`event_id`, `customer_id`, `lifetime_value`, `email_consent`, `sms_consent`, `session_available`)
2. `processed_events` has no `store_id` column — cannot partition or enforce tenant isolation
3. No `intervention_events` table in PostgreSQL — full intervention lifecycle is lost
4. No `intervention_events` table in ClickHouse — cannot compute funnel metrics
5. No `daily_intervention_stats` materialized view — admin API analytics endpoint has no data source
6. `customer_email` in ClickHouse violates PII policy
7. No `api_keys` table — key rotation and revocation not supported

---

**End of report.** No code was modified. This is a design review only.

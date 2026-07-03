Admin API (bff-api) — Final Service Report

Source of truth for the Admin API service. Incorporates all architectural decisions, security reviews, and optimisations from the design process.
1. Executive Summary

The Admin API is the central control plane for the AI Hyper‑Personalised Cart Recovery Suite. It provides merchant‑facing and internal admin functionality:

    Self‑registration for new stores (creates store, admin user, API key, and Kong consumer)

    Real‑time visibility into session risk scores and active users

    Manual intervention (send discounts or offers) with budget/cooldown enforcement

    Policy management (cooldowns, discount caps, daily budgets)

    A/B experiment management and analytics (recovery rates, revenue)

    Discount code validation and atomic redemption for merchant checkout

The service is built with strong security (JWT, Kong‑forwarded roles, store‑scope guard, JWT revocation, audit logging) and is designed to scale independently.
2. Architectural Overview
2.1 High‑Level Diagram

flowchart TD
    subgraph AdminAPI[Admin API Service]
        A[Controllers]
        B[Auth Module]
        C[Store Module]
        D[Policy Module]
        E[Experiment Module]
        F[Analytics Module]
        G[Risk Module]
        H[Intervention Module]
        I[KongClient Module]
        J[Audit Module]
    end

    subgraph External
        K[Kong Gateway]
        L[PostgreSQL]
        M[Redis]
        N[ClickHouse]
        O[Decision Engine]
        P[Kong Admin API]
    end

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    A --> G
    A --> H
    C --> I
    D --> L
    E --> L
    F --> N
    G --> M
    H --> O
    I --> P
    B --> L
    J --> L

    K -- JWT + headers --> A
    O -- internal proxies --> H

2.2 Service Responsibilities
Module	Responsibility
Auth	Login (JWT issue), registration (store + admin + API key + Kong consumer), JWT revocation via token version.
Store	CRUD for stores, rate‑limit config, API key regeneration (updates Kong).
Policy	Store‑level cooldown, max discount, daily budget, min cart value.
Experiment	A/B test creation, updates, result analysis (ClickHouse).
Analytics	Recovery rates, revenue, heatmaps from ClickHouse.
Risk	Read risk scores, list active sessions with scores (optimised pagination).
Intervention	Manual intervention (proxied to Decision Engine with lock semantics).
KongClient	Communicate with Kong Admin API for consumer/key creation/update.
Audit	Log all write operations (both success and failure) for compliance.
3. Authentication Model

    Human authentication is handled by the Admin API login endpoint.

    Kong validates the access token and forwards trusted headers such as X-User-ID, X-User-Roles, and X-Store-IDs.

    The service must reject any client‑supplied identity headers that bypass Kong.

3.1 Login

Endpoint: POST /v1/admin/login
Body: { email, password }
Response: { access_token, token_type: "Bearer", expires_in }

Flow:

    Validate email/password against admin_users (bcrypt).

    Issue JWT (RS256) with claims: { sub, email, roles, store_ids, token_version }.

    Kong validates the JWT on subsequent requests and forwards headers.

3.2 Registration (New Store + Admin + API Key)

Endpoint: POST /v1/admin/register
Body: { email, password, storeName, domain? }
Response: { storeId, apiKey, message } (API key returned only once)

Flow (revised for safety):

sequenceDiagram
    participant M as Merchant
    participant A as Admin API
    participant DB as PostgreSQL
    participant K as Kong Admin API
    participant Q as Background Queue

    M->>A: POST /v1/admin/register
    A->>DB: BEGIN transaction
    A->>DB: INSERT stores (status='pending'), admin_user
    A->>DB: Generate API key UUID, store hash
    A->>DB: COMMIT
    A->>K: POST /consumers (username) & /key-auth (key)
    alt success
        K-->>A: 201
        A->>DB: UPDATE stores SET status='active'
        A-->>M: 201 { storeId, apiKey }
    else failure
        K-->>A: error
        A->>DB: UPDATE stores SET status='failed'
        A->>Q: Enqueue retry job
        A-->>M: 202 Accepted (retry later)
    end

Key decisions:

    DB transaction does not hold locks across external HTTP calls.

    Retries are done offline via background job (idempotent).

    apiKey is returned only once; if Kong fails, the merchant must regenerate.

3.3 Kong‑Forwarded Headers
Header	Example	Origin
X-User-ID	123	Kong (from JWT)
X-User-Roles	["admin"]	Kong (from JWT)
X-Store-IDs	[1, 3, 5]	Kong (from JWT)

Critical: All endpoints that accept a store_id must validate it against X-Store-IDs via a global guard. This prevents IDOR.
3.4 JWT Revocation

Each admin_user has a token_version integer, incremented on role change or account disable. The JWT includes this version, and a middleware verifies it on privileged endpoints. This allows immediate revocation without waiting for token expiry.
3.5 Role‑Based Access Control (RBAC)
Role	Permissions
admin	Full CRUD on stores, policies, experiments, manual interventions, risk read.
viewer	Read‑only access to analytics, risk scores, experiments (no writes).
analyst	Read‑only + export reports.
super-admin	All stores; can manage other admin users (future).
4. Core Management Endpoints

All endpoints are protected by the store‑scope guard unless explicitly exempted. Role and tenant checks are enforced here as defense in depth, even if Kong already validated the token.
4.1 Stores
Method	Path	Description	Roles
GET	/admin/stores	List stores	super-admin
GET	/admin/stores/{id}	Get store	admin/viewer (guard)
PUT	/admin/stores/{id}/rate-limit	Update rate limit	admin (guard)
POST	/admin/stores/{id}/api-keys/regenerate	Regenerate API key (updates Kong)	admin (guard)
4.2 Policies
Method	Path	Description	Guard
GET	/admin/policies?store_id={id}	List policies	store‑scope
PUT	/admin/policies	Create/update rule	store‑scope
DELETE	/admin/policies/{id}	Delete rule	store‑scope

Policy rule types: cooldown_minutes, max_discount_percent, daily_budget_limit, min_cart_value.
4.3 Experiments (A/B Testing)
Method	Path	Description	Guard
GET	/admin/experiments?store_id={id}	List experiments	store‑scope
POST	/admin/experiments	Create	store‑scope
PUT	/admin/experiments/{id}	Update	store‑scope
DELETE	/admin/experiments/{id}	End	store‑scope
GET	/admin/experiments/{id}/results	Stats per variant (ClickHouse)	store‑scope
4.4 Discount Code Validation (Merchant‑Facing)

    GET /v1/validate-discount?code=...&cart_total=... – checks validity, returns discount amount.

    POST /v1/redeem-discount – atomic claim (UPDATE ... SET used_at = NOW() WHERE code = ? AND used_at IS NULL).

    Authenticated via Kong API key (store’s key, not admin JWT).

    Per‑IP rate limiting (e.g., 20/min) to prevent enumeration.

Example Response:
json

{ "valid": true, "discount_percent": 15, "new_total": 85 }

5. Analytics Endpoints

All queries are executed against ClickHouse aggregated tables (not PostgreSQL).
Method	Path	Description
GET	/admin/analytics/recovery?store_id=123&from=2025-06-01&to=2025-06-07	Abandonment & recovery rates
GET	/admin/analytics/revenue	Revenue by intervention type
GET	/admin/analytics/heatmap	Hourly abandonment patterns

All endpoints are protected by the store‑scope guard.
6. Risk & Intervention Admin Endpoints

These endpoints are exposed publicly through Kong (JWT‑validated). They require X-User-Roles to include admin.
6.1 Optimised Data Model for Pagination

    Risk score: Redis risk:{sessionId} (TTL 60s).

    Active sessions with risk scores: The Decision Engine maintains a per‑store sorted set active_risk:{storeId} with members = sessionId and score = risk score, updated on every risk computation.

    This enables efficient pagination and filtering by min_score using ZREVRANGEBYSCORE – O(log N) performance.

6.2 Data Routing
Operation	Data Source
Read risk scores	Redis risk:{sessionId} (TTL 60s)
Read active sessions	Redis active_risk:{storeId} sorted set
Recalculate risk	Proxied to Decision Engine POST /v1/internal/recalculate
Manual intervention	Proxied to Decision Engine POST /v1/internal/intervention/manual
6.3 Endpoints
Method	Path	Description	Guard
GET	/api/risk/{sessionId}	Get current risk score	store‑scope (validates session’s store)
GET	/api/risk/user/{userId}?store_id=123	List sessions for user	store‑scope
GET	/api/risk/active?store_id=123&limit=100&min_score=0.6&offset=0	Paginated active sessions with scores	store‑scope
POST	/api/risk/recalculate/{sessionId}	Force risk recalculation (Phase 1, no lock)	admin (store‑scope)
POST	/api/intervention/manual	Send manual intervention (Phase 2 with lock)	admin (store‑scope)
6.4 Manual Intervention Flow

sequenceDiagram
    participant A as Admin
    participant API as Admin API
    participant DE as Decision Engine
    participant Lock as Redis Lock

    A->>API: POST /api/intervention/manual
    API->>DE: POST /v1/internal/intervention/manual
    DE->>Lock: tryAcquireLock(sessionId)
    Lock-->>DE: acquired
    DE->>DE: Run Intervention Pipeline (budget, cooldown, discount, outbound)
    DE->>Lock: release
    DE-->>API: { interventionId, status, reason }
    API-->>A: 200/422

Key semantics:

    Bypasses risk threshold.

    Respects daily budget; fails with budget_exhausted if cap reached.

    Respects cooldown unless overrideCooldown: true (audit‑logged).

    Channel inferred from session availability: in_shop if active tab, off_shop if stale.

    Uses the same session lock (tryAcquireLock) as other entry points to prevent race conditions.

    Proxied to Decision Engine internal endpoint.

Request Body:
json

{
  "sessionId": "uuid",
  "type": "price_reduction" | "free_shipping" | "countdown" | "popup" | "urgency",
  "value": 15,          // discount % for price_reduction, 0 for others
  "overrideCooldown": false
}

Response:
json

{
  "interventionId": "uuid",
  "status": "sent" | "skipped" | "error",
  "reason": "cooldown_active" | "already_sent" | "budget_exhausted" | "lock_contention"
}

7. Internal Proxies to Decision Engine

The Admin API delegates write operations to the Decision Engine to avoid duplication and maintain single‑source‑of‑truth for business logic.
Admin Endpoint	Decision Engine Internal Endpoint	Lock Semantics
POST /api/risk/recalculate/{sessionId}	POST /v1/internal/recalculate	No exclusive lock (Phase 1 only)
POST /api/intervention/manual	POST /v1/internal/intervention/manual	Acquires exclusive session lock (Phase 2)

Both endpoints are authenticated via the shared X-Internal-Secret header.
8. Security Considerations
Concern	Mitigation
Registration transaction holding locks across HTTP calls	DB transaction committed before calling Kong; failures handled via background retry.
IDOR (store‑scope bypass)	Global guard validates store_id against X-Store-IDs on every endpoint.
JWT revocation	token_version included in JWT; checked on privileged endpoints.
Discount code enumeration	Per‑IP rate limiting on validation endpoint; atomic redemption.
Audit logging	All write operations (including failed attempts) are logged to audit_logs.
Secret rotation	RS256 JWT allows rotating Admin API’s private key without changing Kong’s public key.
9. Deployment & Health

    Replicas: 2–5, HPA on CPU.

    Health: /live (always 200), /ready (checks DB, Redis, ClickHouse connectivity).

    Readiness must pass before traffic is routed.

10. Configuration (Key Variables)
Variable	Description
PORT	HTTP port
DATABASE_URL	PostgreSQL connection
REDIS_URL	Redis connection
CLICKHOUSE_URL	ClickHouse HTTP endpoint
JWT_PRIVATE_KEY	RSA private key (RS256)
JWT_PUBLIC_KEY	RSA public key (for Kong)
DECISION_ENGINE_URL	Internal proxy target
INTERNAL_SECRET	Shared secret for Decision Engine
KONG_ADMIN_URL	Kong Admin API URL
11. Error Handling
Status	Meaning
200	Success
400	Bad request
401	Invalid/missing JWT
403	Insufficient permissions
404	Resource not found
409	Conflict (email, code)
422	Business rule violation
500	Internal error

All errors return a JSON body with statusCode, message, and error.
12. Decision Log
Decision	Rationale	Date
Use RS256 for JWT	Allows key rotation without touching Kong config.	2025-07-03
Registration: commit DB before Kong call	Avoids holding DB locks across external HTTP.	2025-07-03
Maintain active_risk:{storeId} sorted set	Enables efficient pagination of active sessions by risk score.	2025-07-03
Manual intervention uses same lock as other paths	Prevents race conditions (duplicate interventions).	2025-07-03
JWT token version for revocation	Enables immediate revocation without waiting for expiry.	2025-07-03
Discount redemption atomic via UPDATE ... WHERE used_at IS NULL	Prevents double‑use of single‑use codes.	2025-07-03
Audit logging includes failed attempts	Essential for abuse investigation.	2025-07-03
13. Future Extensions

    Billing & usage: Endpoints to retrieve store usage and invoices.

    Webhook management: Allow merchants to subscribe to intervention events.

    Multi‑store role granularity: Users with different roles per store.

    Consumer key rotation: Endpoint to rotate API keys and update Kong.

14. Appendix: API Summary
Method	Path	Description	Auth
POST	/v1/admin/login	Admin login	none
POST	/v1/admin/register	New store registration	none
POST	/v1/admin/api-keys/regenerate	Regenerate API key	JWT + admin
GET	/admin/stores	List stores	JWT + super-admin
GET	/admin/policies?store_id=id	List policies	JWT + guard
PUT	/admin/policies	Update policy	JWT + guard
GET	/admin/experiments?store_id=id	List experiments	JWT + guard
GET	/admin/analytics/recovery	Recovery metrics	JWT + guard
GET	/api/risk/{sessionId}	Get risk score	JWT + guard
GET	/api/risk/active	Active sessions paginated	JWT + guard
POST	/api/risk/recalculate/{sessionId}	Force risk recalc	JWT + admin
POST	/api/intervention/manual	Send manual intervention	JWT + admin
GET	/v1/validate-discount	Validate discount code	API key (Kong)
POST	/v1/redeem-discount	Atomic redemption	API key (Kong)


The Role of the Admin API (BFF)

The Admin API is a Backend-for-Frontend (BFF) layer. Its responsibilities are:

    Authentication (login, registration, JWT issuance)

    Orchestration (calling PostgreSQL, Redis, ClickHouse, Decision Engine, Kong Admin API)

    Transformation (shaping data for the React dashboard)

This is exactly the kind of service where Hono excels. It is a lightweight orchestrator, not a complex domain service.
What About tRPC?

tRPC is designed for full‑stack monolithic apps where the frontend and backend are tightly coupled (e.g., a single Next.js app). In your distributed microservices architecture, tRPC would create a tRPC island and add unnecessary complexity. Hono is the better fit.
Final Architecture: Admin API in Hono

flowchart TD
    subgraph AdminAPI[Admin API (Hono)]
        A[Routes]
        B[Auth Handlers]
        C[Store Handlers]
        D[Policy Handlers]
        E[Experiment Handlers]
        F[Analytics Handlers]
        G[Risk Handlers]
        H[Intervention Handlers]
        I[Kong Client]
    end

    subgraph External
        K[Kong Gateway]
        L[PostgreSQL]
        M[Redis]
        N[ClickHouse]
        O[Decision Engine]
        P[Kong Admin API]
    end

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    A --> G
    A --> H
    C --> I
    D --> L
    E --> L
    F --> N
    G --> M
    H --> O
    I --> P
    B --> L

    K -- JWT + headers --> A
    O -- internal proxies --> H

Implementation Plan for Hono Admin API
1. Service Location in Nx
text

apps/
└── admin-api/          # Hono service (no NestJS)
    ├── src/
    │   ├── index.ts    # Main app
    │   ├── routes/     # Route handlers
    │   │   ├── auth.ts
    │   │   ├── stores.ts
    │   │   ├── policies.ts
    │   │   ├── experiments.ts
    │   │   ├── analytics.ts
    │   │   ├── risk.ts
    │   │   └── intervention.ts
    │   ├── clients/    # External clients
    │   │   ├── postgres.ts
    │   │   ├── redis.ts
    │   │   ├── clickhouse.ts
    │   │   ├── decision-engine.ts
    │   │   └── kong.ts
    │   ├── middleware/ # Auth, logging, etc.
    │   └── types/      # Shared types
    ├── project.json    # Nx configuration
    ├── Dockerfile
    └── package.json

2. Example Route (Hono)
typescript

// apps/admin-api/src/routes/risk.ts
import { Hono } from 'hono'
import { Redis } from 'ioredis'
import { decisionEngineClient } from '../clients/decision-engine'

const app = new Hono()

app.get('/api/risk/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const redis = c.get('redis') as Redis
  
  // 1. Read from Redis
  const score = await redis.get(`risk:${sessionId}`)
  
  // 2. If not found, fetch from Decision Engine
  if (!score) {
    const response = await decisionEngineClient.recalculate(sessionId)
    return c.json({ sessionId, score: response.score })
  }
  
  return c.json({ sessionId, score: parseFloat(score) })
})

export default app

3. Middleware (Auth & Store Scope)
typescript

// apps/admin-api/src/middleware/auth.ts
export const authMiddleware = async (c: Context, next: Next) => {
  const userId = c.req.header('X-User-ID')
  const roles = c.req.header('X-User-Roles')
  const storeIds = c.req.header('X-Store-IDs')
  
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  
  c.set('user', { userId, roles: JSON.parse(roles || '[]'), storeIds: JSON.parse(storeIds || '[]') })
  await next()
}

4. Nx Configuration

apps/admin-api/project.json
json

{
  "name": "admin-api",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "main": "apps/admin-api/src/index.ts",
        "outputPath": "dist/apps/admin-api",
        "platform": "node",
        "format": ["esm"],
        "bundle": true,
        "external": ["hono"]
      }
    },
    "serve": {
      "executor": "@nx/js:node",
      "options": {
        "buildTarget": "admin-api:build",
        "watch": true
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "apps/admin-api/jest.config.ts"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "options": {
        "lintFilePatterns": ["apps/admin-api/**/*.ts"]
      }
    }
  }
}

5. Dockerfile
dockerfile

FROM oven/bun:1.0.25-slim

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production

COPY dist/apps/admin-api ./

EXPOSE 3008
CMD ["bun", "index.js"]

6. Kong Configuration

Update kong.yml to point to the Hono service:
yaml

services:
  - name: admin-api
    url: http://admin-api:3008
    routes:
      - name: admin-route
        paths:
          - /v1/admin
        strip_path: false
    plugins:
      - name: jwt
        config:
          secret_is_base64: false
          claims_to_verify: [exp]
          header_names:
            - X-User-ID
            - X-User-Roles
            - X-Store-IDs


This document is the source of truth for the Admin API service. All implementation must conform to these specifications. Changes require version increment and review.
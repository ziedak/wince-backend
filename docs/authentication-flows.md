# Authentication Flows

This document summarizes the authentication boundaries in the current codebase and how they relate to the API gateway, tracker traffic, admin access, and service-to-service calls.

``` Mermaid
flowchart LR
  A[Admin user] -->|email + password| B[Admin API]
  B -->|JWT issued| C[Kong validates JWT]
  U[Tracker browser / WooCommerce backend] -->|X-API-Key| K[Kong key-auth]
  K -->|X-Store-ID injected| I[Ingestion]
  D[Decision Engine] -->|X-Internal-Secret| G[Intervention Gateway]
  D -->|internal request| N[Notification Service]
```
## 1. Admin User Login

This is the human login flow for merchants and operators.

- Input: `email` + `password`
- Purpose: obtain an admin JWT for the Admin API
- Primary consumers: dashboard and admin tooling
- Edge validation: Kong validates the JWT on admin routes before forwarding requests upstream

Relevant files:

- [docs/services/admin-api.md](docs/services/admin-api.md)
- [kong.yml](kong.yml)

## 2. Tracker API Key Authentication

This is the shop-level authentication flow used by the browser tracker and the WooCommerce backend tracker.

- Input: shop API key
- Header: `X-API-Key`
- Purpose: identify the store that owns the request and allow tracker traffic into the system
- Edge validation: Kong key-auth validates the key before forwarding the request
- Trusted downstream context: Kong injects store context such as `X-Store-ID`

The ingestion service should trust the forwarded store context, not the raw client key.

Relevant files:

- [kong.yml](kong.yml)
- [apps/ingestion/src/handler.rs](apps/ingestion/src/handler.rs)
- [docs/services/ingestion-service.md](docs/services/ingestion-service.md)
- [docs/services/api-key-service.md](docs/services/api-key-service.md)

## 3. Internal Service-to-Service Communication

This covers calls between backend services.

- Current implementation: shared `INTERNAL_SECRET` for internal requests in some services
- Documented direction: mTLS for trusted service-to-service communication
- Example usage:
  - Decision Engine -> Intervention Gateway
  - Decision Engine -> Notification Service

Relevant files:

- [apps/decision-engine/src/config.ts](apps/decision-engine/src/config.ts)
- [apps/intervention-gateway/src/config.ts](apps/intervention-gateway/src/config.ts)
- [docs/domains/security.md](docs/domains/security.md)

## API Key Data

The repository uses API keys as store credentials, not user credentials.

### What the key represents

- A store-level credential for tracker traffic
- A handle that resolves to tenant context such as `store_id`
- A key that can be revoked or rotated without changing tracker code

### What is stored

- Kong consumer credentials for edge authentication
- PostgreSQL metadata for durable store-key records
- Redis cache entries for fast key lookup

Current schema and docs reference:

- [packages/db/src/schema/stores.ts](packages/db/src/schema/stores.ts)
- [packages/db/src/schema/api_keys.ts](packages/db/src/schema/api_keys.ts)
- [docs/domains/data-stores.md](docs/domains/data-stores.md)

## Current Implementation Note

The repository currently shows a documentation split:

- Some docs describe an API Key Service as the lookup layer.
- The gateway config shows Kong key-auth as the actual edge validator for tracker requests.

The practical flow in the current repo is:

1. Client sends `X-API-Key`.
2. Kong validates the key.
3. Kong forwards trusted store context to ingestion.
4. Ingestion uses that trusted store context for event processing.

## Summary

- Admin users authenticate with email/password and receive JWTs.
- Trackers authenticate with a store API key.
- Internal service calls should use internal trust boundaries, currently shared secrets in code and mTLS in the security docs.
- API keys identify the store, not the end user.
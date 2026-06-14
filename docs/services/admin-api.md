# Admin API

NestJS service for operational and merchant-facing admin functionality.

## Responsibilities

- Serve analytics, policy, experiment, and usage endpoints.
- Trust user identity and roles forwarded by Kong after JWT validation.
- Handle admin credential verification and JWT issuance for the login flow.

## Authentication model

- Human authentication is handled by the Admin API login endpoint.
- Kong validates the access token and forwards trusted headers such as `X-User-ID`, `X-User-Roles`, and `X-Store-IDs`.
- The service must reject any client-supplied identity headers that bypass Kong.

## Endpoints

```
POST /v1/admin/login
     body: { email, password }
     → { access_token, token_type: "Bearer", expires_in }

GET  /admin/analytics/recovery?store_id=123&from=2025-06-01&to=2025-06-07
     → { abandonment_rate, recovery_rate, revenue_recovered }

PUT  /admin/policies
     body: { store_id, rule_type, parameters }

GET  /admin/experiments?store_id=123
     → [ { id, name, variants, active } ]

GET  /admin/experiments/{id}/results
     → recovery rate per variant with confidence intervals

GET  /v1/validate-discount?code=CR-123-ABC123&cart_total=100
     → { valid: true, discount_percent: 15, new_total: 85 }
```

## Notes

- Role and tenant checks should be enforced here as defense in depth, even if Kong already validated the token.
- Experiment analysis queries ClickHouse, not PostgreSQL operational tables.

# API Key Service

A minimal internal service for tracker API-key lookup.

## Responsibilities

- Accept an API key and resolve it to `store_id`.
- Return small metadata needed by the ingestion path, such as rate limits and domain allowlists.
- Cache lookups in Redis for fast repeated access.
- Keep the lookup path revocable so keys can be disabled without changing ingestion code.
- Avoid storing richer auth state or user identity here; it is only a key-to-store resolver.

## Interface

- `GET /internal/api-key/lookup?key=...`
- Response: `{ "store_id": 123, "rate_limit": 1000, "domain_whitelist": ["example.com"] }`

## Notes

- This service exists to keep the ingestion flow simple and revocable.
- It should remain tiny and avoid becoming a second auth system.
- PostgreSQL should remain the backing source of truth for durable key metadata when cache entries expire.

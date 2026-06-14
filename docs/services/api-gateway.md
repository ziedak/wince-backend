# API Gateway

Kong is the only public entry point. It routes browser tracker SDK traffic and WooCommerce backend tracker traffic to the correct backend service and enforces edge controls.

## Responsibilities

- `POST /v1/track` goes to Ingestion Service for browser SDK events and backend tracker events.
- `POST /v1/admin/*` goes to Admin API.
- `GET /ws` goes to Intervention Gateway.
- Apply request authentication and rate limiting at the edge.
- Add request metadata such as `X-Request-ID`.
- Resolve tracker API keys at the edge and forward the resulting store context to ingestion.
- Validate admin JWTs at the edge before forwarding trusted identity headers.

## Plugins and auth

- `key-auth` for tracker ingestion.
- JWT validation for admin routes.
- Redis-backed rate limiting.
- Prometheus metrics and structured logging.
- mTLS for trusted upstream identity forwarding.

## Notes

- Kong should validate admin access tokens locally before forwarding them upstream.
- Any identity claims forwarded to upstream services must come from Kong over mTLS, not from clients.
- Edge auth should stay thin; business authorization belongs in the upstream service that owns the resource.

# Intervention Gateway

A uWebSockets-based gateway for real-time WebSocket delivery and push fan-out.

## Responsibilities

- Accept WebSocket connections from tracked browsers.
- Keep a local map of active sockets.
- Write active-session metadata to Redis with a short TTL.
- Serve internal push requests for a specific session.
- Use pod-local socket state for low-latency delivery and Redis only for cross-pod routing metadata.

## WebSocket contract

- Connect with `wss://gateway/ws?session_id=...&api_key=...`.
- Renew the Redis TTL on heartbeat traffic.
- Keep the session alive for roughly 60 seconds without a heartbeat before dropping it.

## Push API

- Internal endpoint: `POST /v1/push`
- Header: `X-Internal-Secret`
- Body: `{ session_id, intervention: { type, value, code }, ttl_ms: 5000 }`
- Look up `ws:active:{session_id}` in Redis.
  - If key exists and socket is local: send WebSocket message, wait for client ACK (2 s). Return `200` on ACK.
  - If key exists but socket is on another pod: forward to the pod IP in Redis. Return `404` if the forward fails.
  - If key is missing: return `404`.
- ACK loss should be treated as a delivery failure, not as successful intervention confirmation.

## Notes

- Heartbeats should renew the Redis TTL.
- Graceful shutdown should remove local active-session entries before exit.
- The gateway should remain thin; intervention selection belongs in the decision engine.

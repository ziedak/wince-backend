# Notification Service

Fallback delivery service for email, SMS, and optional push channels.

## Responsibilities

- Receive internal notification requests when WebSocket delivery fails.
- Check consent fields before sending any channel.
- Deliver through SendGrid, Twilio, or Firebase as configured.
- Retry temporary failures with exponential backoff.
- Write delivery outcome events to Kafka.
- Only execute after WebSocket delivery fails or a fallback channel is required by policy.

## API contract

- Internal endpoint: `POST /v1/notify`
- Requests should include `store_id`, `distinct_id`, the intervention payload, and the channel preference list.

## Channel policy

- Skip email if `email_consent` is false.
- Skip SMS if `sms_consent` is false.
- Use push only when the deployment enables it.

## Failure handling

- Retry up to three times with exponential backoff: 1 s, 2 s, 4 s.
- On final failure, write to `dead.letters`.

## Notes

- Keep consent handling explicit and auditable.
- Use the service only as a fallback, not as the primary intervention path.
- Delivery outcomes should be logged for compliance, analytics, and billing.

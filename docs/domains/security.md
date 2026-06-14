# Security

Cross-cutting identity, authorization, transport, and compliance rules.

## Authentication model

```mermaid
flowchart LR
	subgraph TrackerClients["Tracker clients"]
		B["Browser Tracker SDK"]
		W["WooCommerce Backend Tracker"]
	end

	subgraph HumanClients["Human clients"]
		U["Admin / operator user"]
	end

	subgraph Gateway["API Gateway - Kong"]
		K1["key-auth"]
		K2["JWT validation"]
	end

	subgraph Internal["Internal services"]
		A["API Key Service"]
		I["Ingestion Service"]
		S["Admin API"]
		X["Other internal services"]
	end

	B -- "X-API-Key" --> K1
	W -- "X-API-Key" --> K1
	K1 -- "resolve store_id / metadata" --> A
	A -- "key lookup" --> K1
	K1 -- "route to ingest" --> I

	U -- "POST /v1/admin/login" --> S
	S -- "JWT issued after credential check" --> U
	U -- "Bearer token" --> K2
	K2 -- "validate JWT" --> S
	K2 -- "route to admin" --> S

	I <-->|"mTLS"| X
	S <-->|"mTLS"| X
	A <-->|"mTLS"| X
```

- Tracker ingestion uses API keys at the edge.
- Human/admin access uses Kong-issued JWTs through Kong.
- Kong enforces edge auth and forwards trusted identity context to upstream services.
- Internal service-to-service communication uses mTLS.
- Browser tracker and WooCommerce backend tracker roles are described in [tracking-model.md](tracking-model.md).

## Decisions

- Use Kong as the identity enforcement point for tracker and admin traffic.
- Let the Admin API verify admin credentials and issue JWTs.
- Keep tracker ingestion on API keys only.
- Keep the API Key Service minimal and cache-backed.
- Avoid external identity providers in the baseline architecture.
- Use a separate tracking model document for browser and WooCommerce event-source trust boundaries.

## Transport security

- Internal services use mTLS.
- External and internal HTTP/gRPC should use TLS.
- Kafka uses TLS with SASL/SCRAM.

## Network security

- All services run in a private VPC. The API Gateway is the only public endpoint.
- Kubernetes network policies restrict ingress to the API Gateway only.

## Data encryption

- At rest: EBS, RDS, and S3 are encrypted with AES-256.
- In transit: TLS for all external and internal HTTP/gRPC; Kafka TLS with SASL/SCRAM.

## Compliance

- Respect `email_consent` and `sms_consent` flags before sending notifications.
- Keep PII (email, phone) stored only in PostgreSQL, not in ClickHouse.
- Support right-to-deletion: delete customer record and anonymize ClickHouse events by setting `customer_email = NULL`.

## Notes

- Admin services should not trust client headers directly.
- Identity should be resolved at the gateway, then re-checked in the service when tenant boundaries matter.

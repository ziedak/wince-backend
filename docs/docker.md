Reference Map: Ports & Credentials
| Service | Host Port | Internal Port | Default Credentials / Connection Info |
| -------- | -------- | -------- | -------- |
| Kafka (Host) | 9092 | — | Connect using localhost:9092 |
| Kafka (Docker) | — | 29092 | Inter-container communication broker URL: kafka:29092 |
| Zookeeper | 2181 | 2181 | Kafka coordination service |
| Kong Proxy | 8000 | 8000 | Public API gateway entrypoint |
| Kong Admin | 8001 | 8001 | Admin/debug API for local use |
| PostgreSQL | 5433 | 5432 | admin / password (DB: app_db) |
| PgBouncer | 6432 | 6432 | Proxy target points to postgres:5432 |
| Redis Stack | 6379 | 6379 | No password by default (includes RedisBloom) |
| ClickHouse HTTP | 8123 | 8123 | Default user: default (No password configured) |
| ClickHouse native | 9000 | 9000 | Default user: default (No password configured) |
| MinIO API | 9002 | 9000 | minioadmin / minioadminpassword (S3 Mock Endpoint) |
| MinIO Console | 9001 | 9001 | Web GUI interface access |

    A Quick Note on Redis: Using the redis/redis-stack-server image is much cleaner than pulling the legacy, unmaintained standalone redisbloom image. It ensures your client libraries can seamlessly issue commands like BF.ADD or BF.EXISTS right out of the box.

init-kafka is not a normal long-running service. It is a one-shot bootstrap container that waits for Kafka, creates the topics, and then exits successfully. The logs showed it eventually did its job: it created raw.events, enriched.events, intervention.log, notification.log, dead.letters, and audit.log. The part that looked broken was the early retry noise while Kafka was still coming up, which is expected with depends_on because it does not wait for broker readiness.

## How to connect

Use the host ports when connecting from your laptop, and the Docker service names when connecting from another container on the same Compose network.

### From the host

- Kafka: `localhost:9092`
- Zookeeper: `localhost:2181`
- Kong proxy: `http://localhost:8000`
- Kong admin: `http://localhost:8001`
- PostgreSQL: `localhost:5433` with `admin/password` on database `app_db`
- PgBouncer: `localhost:6432`
- Redis Stack: `localhost:6379`
- ClickHouse HTTP: `http://localhost:8123`
- ClickHouse native: `localhost:9000`
- MinIO API: `http://localhost:9002`
- MinIO Console: `http://localhost:9001`

### From another container

- Kafka broker: `kafka:29092`
- Zookeeper: `zookeeper:2181`
- Kong proxy: `kong:8000`
- Kong admin: `kong:8001`
- PostgreSQL: `postgres:5432`
- PgBouncer: `pgbouncer:6432`
- Redis Stack: `redis:6379`
- ClickHouse HTTP: `clickhouse:8123`
- ClickHouse native: `clickhouse:9000`
- MinIO API: `minio:9000`

### Common CLI examples

```bash
# PostgreSQL
psql "postgresql://admin:password@localhost:5433/app_db"

# Redis
redis-cli -h localhost -p 6379

# Kafka consumer/producer examples depend on your tooling, but the broker address is localhost:9092 from the host or kafka:29092 inside Compose.

# ClickHouse
clickhouse-client --host localhost --port 9000 --user default

# MinIO browser UI
open http://localhost:9001/
```

### Exec into a container

```bash
# PostgreSQL shell inside the container
docker compose exec postgres psql -U admin -d app_db

# Redis CLI inside the container
docker compose exec redis redis-cli

# ClickHouse client inside the container
docker compose exec clickhouse clickhouse-client

# Kafka broker logs / troubleshooting
docker compose logs -f kafka
```

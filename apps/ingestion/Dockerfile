# syntax=docker/dockerfile:1.7

FROM rust:1-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    libcurl4-openssl-dev \
    libssl-dev \
    libsasl2-dev \
    pkg-config \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY apps/ingestion/Cargo.toml apps/ingestion/Cargo.toml
COPY apps/ingestion/src apps/ingestion/src

RUN cargo build --release -p ingestion

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /workspace/dist/target/release/ingestion /usr/local/bin/ingestion

ENV RUST_LOG=info \
    PORT=3001 \
    KAFKA_HOSTS=kafka:29092 \
    KAFKA_TOPIC_RAW=raw.events \
    REDIS_URL=redis://redis:6379 \
    REDIS_BLOOM_KEY=idem:bloom

EXPOSE 3001

CMD ["ingestion"]
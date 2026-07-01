//! S3 fallback sink — buffers events in memory and flushes to S3 as NDJSON.
//!
//! Each flushed object is written to:
//!   `s3://<bucket>/<YYYY>/<MM>/<DD>/<uuid>.ndjson`
//!
//! Each line in the object is a JSON object with three fields:
//!   `{"topic":"...","key":"...","event":{...}}`
//!
//! Flush triggers (whichever comes first):
//!   * Buffer accumulates ≥ 4 MiB
//!   * 1 second has elapsed since last flush
//!
//! The background flush loop runs every 500 ms so the worst-case latency
//! before an event lands in S3 is ~1.5 s.
//!
//! When a `WalDb` is provided, each event is first written to the local SQLite
//! WAL. After a successful S3 `PutObject`, the corresponding WAL rows are
//! deleted. On startup, any rows still in the WAL (from a previous crash) are
//! replayed to S3 before the service accepts traffic.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Context;
use async_trait::async_trait;
use aws_sdk_s3::primitives::ByteStream;
use chrono::Utc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::errors::AppError;
use crate::sinks::wal::WalDb;
use crate::sinks::{Sink, SinkHeaders};

const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
const MAX_BUFFER_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

// ─── Internal buffer ─────────────────────────────────────────────────────────

struct EventBuffer {
    data: Vec<u8>,
    /// WAL row IDs whose payloads are accumlated in `data`.
    /// Empty when WAL is disabled.
    wal_ids: Vec<i64>,
    last_flush: Instant,
}

impl EventBuffer {
    fn new() -> Self {
        Self {
            data: Vec::new(),
            wal_ids: Vec::new(),
            last_flush: Instant::now(),
        }
    }

    #[allow(dead_code)]
    fn push(&mut self, topic: &str, key: &str, payload: &str) {
        self.push_with_wal(topic, key, payload, None);
    }

    fn push_with_wal(&mut self, topic: &str, key: &str, payload: &str, wal_id: Option<i64>) {
        // Escape `topic` and `key` to prevent JSON injection.
        // `payload` is already a serialized JSON object from the pipeline.
        let line = format!(
            "{{\"topic\":{},\"key\":{},\"event\":{}}}\n",
            serde_json::Value::String(topic.to_owned()),
            serde_json::Value::String(key.to_owned()),
            payload,
        );
        self.data.extend_from_slice(line.as_bytes());
        if let Some(id) = wal_id {
            self.wal_ids.push(id);
        }
    }

    fn should_flush(&self) -> bool {
        !self.data.is_empty()
            && (self.data.len() >= MAX_BUFFER_BYTES || self.last_flush.elapsed() >= FLUSH_INTERVAL)
    }

    /// Take the buffered data and associated WAL IDs, resetting the buffer.
    fn take(&mut self) -> (Vec<u8>, Vec<i64>) {
        self.last_flush = Instant::now();
        let data = std::mem::take(&mut self.data);
        let ids = std::mem::take(&mut self.wal_ids);
        (data, ids)
    }
}

// ─── S3Sink ──────────────────────────────────────────────────────────────────

pub struct S3Sink {
    client: Arc<aws_sdk_s3::Client>,
    bucket: String,
    buffer: Arc<Mutex<EventBuffer>>,
    /// Optional WAL for crash-safe durability. `None` → WAL disabled.
    wal: Option<Arc<WalDb>>,
}

impl S3Sink {
    #[allow(dead_code)]
    pub async fn new(
        bucket: String,
        endpoint_url: Option<String>,
        region: String,
    ) -> anyhow::Result<Self> {
        Self::new_with_wal(bucket, endpoint_url, region, None).await
    }

    /// Create an S3Sink with optional WAL durability.
    ///
    /// When `wal_path` is `Some`, a SQLite WAL database is opened at that
    /// path. Any entries left over from a previous crash are replayed to S3
    /// synchronously before this method returns.
    pub async fn new_with_wal(
        bucket: String,
        endpoint_url: Option<String>,
        region: String,
        wal_path: Option<String>,
    ) -> anyhow::Result<Self> {
        let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_config::Region::new(region))
            .load()
            .await;

        let mut s3_cfg = aws_sdk_s3::config::Builder::from(&sdk_config);
        if let Some(url) = endpoint_url {
            s3_cfg = s3_cfg.endpoint_url(url).force_path_style(true);
        }
        let client = Arc::new(aws_sdk_s3::Client::from_conf(s3_cfg.build()));

        // Open WAL if a path was supplied.
        let wal: Option<Arc<WalDb>> = match wal_path {
            Some(ref path) => match WalDb::open(path) {
                Ok(db) => {
                    info!(path, "S3 WAL opened");
                    Some(Arc::new(db))
                }
                Err(e) => {
                    error!(path, error = %e, "Failed to open S3 WAL — continuing without WAL");
                    None
                }
            },
            None => None,
        };

        let buffer = Arc::new(Mutex::new(EventBuffer::new()));

        // ── Startup WAL replay ────────────────────────────────────────────────
        // Before accepting traffic, flush any entries left over from a crash.
        if let Some(ref wal_db) = wal {
            match wal_db.drain() {
                Ok(entries) if !entries.is_empty() => {
                    let count = entries.len();
                    warn!(count, "Replaying WAL entries from previous crash into S3");
                    let mut replay_buf = EventBuffer::new();
                    for entry in &entries {
                        replay_buf.push_with_wal(
                            &entry.topic,
                            &entry.key,
                            &entry.payload,
                            Some(entry.id),
                        );
                    }
                    let (data, ids) = replay_buf.take();
                    match flush_to_s3(&client, &bucket, data, Some(wal_db), &ids).await {
                        Ok(()) => {
                            metrics::counter!("ingestion_wal_entries_replayed_total")
                                .increment(count as u64);
                            info!(count, "WAL replay complete");
                        }
                        Err(e) => {
                            error!(error = %e, "WAL replay S3 flush failed — entries remain in WAL");
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => warn!(error = %e, "WAL drain on startup failed"),
            }
        }

        // ── Background flush loop ─────────────────────────────────────────────
        {
            let client = client.clone();
            let bucket = bucket.clone();
            let buffer = buffer.clone();
            let wal_bg = wal.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(500));
                loop {
                    interval.tick().await;
                    let mut buf = buffer.lock().await;
                    if buf.should_flush() {
                        let (data, ids) = buf.take();
                        drop(buf);
                        if let Some(ref w) = wal_bg {
                            if let Ok(n) = w.pending_count() {
                                metrics::gauge!("ingestion_wal_pending_entries").set(n as f64);
                            }
                        }
                        if let Err(e) = flush_to_s3(&client, &bucket, data, wal_bg.as_ref(), &ids).await {
                            error!(error = %e, "S3 background flush failed");
                        }
                    }
                }
            });
        }

        info!(bucket = %bucket, wal = wal.is_some(), "S3 fallback sink initialized");
        Ok(Self {
            client,
            bucket,
            buffer,
            wal,
        })
    }
}

async fn flush_to_s3(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    data: Vec<u8>,
    wal: Option<&Arc<WalDb>>,
    wal_ids: &[i64],
) -> anyhow::Result<()> {
    let date = Utc::now().format("%Y/%m/%d");
    let key = format!("{date}/{}.ndjson", Uuid::new_v4());
    let byte_count = data.len();

    client
        .put_object()
        .bucket(bucket)
        .key(&key)
        .content_type("application/x-ndjson")
        .body(ByteStream::from(data))
        .send()
        .await
        .with_context(|| format!("s3 put_object bucket={bucket} key={key}"))?;

    info!(bucket, key = %key, bytes = byte_count, "Flushed events to S3");
    metrics::counter!("ingestion_s3_flush_total").increment(1);
    metrics::counter!("ingestion_s3_flush_bytes_total").increment(byte_count as u64);

    // Delete WAL rows now that data is durably in S3.
    if let Some(wal_db) = wal {
        if let Err(e) = wal_db.delete_batch(wal_ids) {
            warn!(error = %e, "WAL cleanup failed after S3 flush — rows will be replayed on next restart");
        }
    }

    Ok(())
}

#[async_trait]
impl Sink for S3Sink {
    /// `_headers` is intentionally ignored: the JSON payload already contains
    /// all routing metadata (store_id, source, etc.) and S3 has no native
    /// header mechanism. Headers are a Kafka-layer concern.
    async fn send(
        &self,
        topic: &str,
        key: &str,
        payload: &str,
        _headers: &SinkHeaders,
    ) -> Result<(), AppError> {
        // Write to WAL first (before in-memory buffer) for crash safety.
        let wal_id: Option<i64> = if let Some(ref wal_db) = self.wal {
            match wal_db.insert(topic, key, payload) {
                Ok(id) => Some(id),
                Err(e) => {
                    warn!(error = %e, "WAL insert failed — continuing without WAL for this event");
                    None
                }
            }
        } else {
            None
        };

        let mut buf = self.buffer.lock().await;
        buf.push_with_wal(topic, key, payload, wal_id);

        // If buffer is full, trigger an immediate flush in a background task
        // so the calling request is not blocked on the S3 round-trip.
        if buf.data.len() >= MAX_BUFFER_BYTES {
            let (data, ids) = buf.take();
            drop(buf);
            let client = self.client.clone();
            let bucket = self.bucket.clone();
            let wal_clone = self.wal.clone();
            tokio::spawn(async move {
                if let Err(e) = flush_to_s3(&client, &bucket, data, wal_clone.as_ref(), &ids).await {
                    warn!(error = %e, "S3 immediate flush failed, events lost from buffer");
                }
            });
        }
        Ok(())
    }
}

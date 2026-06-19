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
use crate::sinks::Sink;

const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
const MAX_BUFFER_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

// ─── Internal buffer ─────────────────────────────────────────────────────────

struct EventBuffer {
    data: Vec<u8>,
    last_flush: Instant,
}

impl EventBuffer {
    fn new() -> Self {
        Self {
            data: Vec::new(),
            last_flush: Instant::now(),
        }
    }

    fn push(&mut self, topic: &str, key: &str, payload: &str) {
        // Escape `topic` and `key` to prevent JSON injection.
        // `payload` is already a serialized JSON object from the pipeline.
        let line = format!(
            "{{\"topic\":{},\"key\":{},\"event\":{}}}\n",
            serde_json::Value::String(topic.to_owned()),
            serde_json::Value::String(key.to_owned()),
            payload,
        );
        self.data.extend_from_slice(line.as_bytes());
    }

    fn should_flush(&self) -> bool {
        !self.data.is_empty()
            && (self.data.len() >= MAX_BUFFER_BYTES || self.last_flush.elapsed() >= FLUSH_INTERVAL)
    }

    fn take(&mut self) -> Vec<u8> {
        self.last_flush = Instant::now();
        std::mem::take(&mut self.data)
    }
}

// ─── S3Sink ──────────────────────────────────────────────────────────────────

pub struct S3Sink {
    client: Arc<aws_sdk_s3::Client>,
    bucket: String,
    buffer: Arc<Mutex<EventBuffer>>,
}

impl S3Sink {
    pub async fn new(
        bucket: String,
        endpoint_url: Option<String>,
        region: String,
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
        let buffer = Arc::new(Mutex::new(EventBuffer::new()));

        // Background flush loop
        {
            let client = client.clone();
            let bucket = bucket.clone();
            let buffer = buffer.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(500));
                loop {
                    interval.tick().await;
                    let mut buf = buffer.lock().await;
                    if buf.should_flush() {
                        let data = buf.take();
                        drop(buf);
                        if let Err(e) = flush_to_s3(&client, &bucket, data).await {
                            error!(error = %e, "S3 background flush failed");
                        }
                    }
                }
            });
        }

        info!(bucket = %bucket, "S3 fallback sink initialized");
        Ok(Self {
            client,
            bucket,
            buffer,
        })
    }
}

async fn flush_to_s3(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    data: Vec<u8>,
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
    Ok(())
}

#[async_trait]
impl Sink for S3Sink {
    async fn send(&self, topic: &str, key: &str, payload: &str) -> Result<(), AppError> {
        let mut buf = self.buffer.lock().await;
        buf.push(topic, key, payload);

        // If buffer is full, trigger an immediate flush in a background task
        // so the calling request is not blocked on the S3 round-trip.
        if buf.data.len() >= MAX_BUFFER_BYTES {
            let data = buf.take();
            drop(buf);
            let client = self.client.clone();
            let bucket = self.bucket.clone();
            tokio::spawn(async move {
                if let Err(e) = flush_to_s3(&client, &bucket, data).await {
                    warn!(error = %e, "S3 immediate flush failed, events lost from buffer");
                }
            });
        }
        Ok(())
    }
}

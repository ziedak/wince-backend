//! Streaming request body reader with optional per-chunk timeout.
//!
//! Protects against slow-loris style attacks where a client connects,
//! sends partial data, then stalls indefinitely mid-upload.

use bytes::{BufMut, Bytes, BytesMut};
use futures::StreamExt;
use tracing::warn;

use crate::errors::AppError;

/// Read the full request body from an axum [`axum::body::Body`], enforcing:
/// - `size_limit`: reject bodies larger than this (before decompression).
/// - `chunk_timeout`: if `Some`, abort with 408 after no data for this duration.
pub async fn read_body(
    body: axum::body::Body,
    size_limit: usize,
    chunk_timeout: Option<std::time::Duration>,
) -> Result<Bytes, AppError> {
    let mut stream = body.into_data_stream();
    let mut buf = BytesMut::with_capacity(size_limit.min(256 * 1024));

    loop {
        let chunk_result = if let Some(timeout) = chunk_timeout {
            match tokio::time::timeout(timeout, stream.next()).await {
                Ok(result) => result,
                Err(_elapsed) => {
                    metrics::counter!("ingestion_body_read_timeout_total").increment(1);
                    warn!(
                        bytes_received = buf.len(),
                        timeout_ms = timeout.as_millis() as u64,
                        "Body read timeout: client stalled mid-upload"
                    );
                    return Err(AppError::RequestTimeout);
                }
            }
        } else {
            stream.next().await
        };

        match chunk_result {
            Some(Ok(chunk)) => {
                if buf.len() + chunk.len() > size_limit {
                    metrics::counter!("ingestion_body_too_large_total").increment(1);
                    return Err(AppError::EventTooBig(format!(
                        "Request body exceeds {size_limit} bytes"
                    )));
                }
                buf.put(chunk);
            }
            Some(Err(e)) => {
                return Err(AppError::BadRequest(format!("Error reading body: {e}")));
            }
            None => break,
        }
    }

    Ok(buf.freeze())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    #[tokio::test]
    async fn reads_small_body_no_timeout() {
        let payload = b"hello world";
        let result = read_body(Body::from(payload.as_slice()), 1024, None)
            .await
            .unwrap();
        assert_eq!(result.as_ref(), payload);
    }

    #[tokio::test]
    async fn rejects_body_exceeding_size_limit() {
        let payload = b"hello world";
        let err = read_body(Body::from(payload.as_slice()), 5, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::EventTooBig(_)));
    }

    #[tokio::test]
    async fn reads_empty_body() {
        let result = read_body(Body::empty(), 1024, None).await.unwrap();
        assert!(result.is_empty());
    }
}

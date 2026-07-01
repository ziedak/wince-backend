use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::sync::atomic::{AtomicI64, AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Shutdown state machine for graceful termination.
///
/// Transitions: Running → Prestop → Terminating → Completed
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ShutdownStatus {
    Running = 1,
    Prestop = 2,
    Terminating = 3,
    Completed = 4,
}

impl ShutdownStatus {
    fn as_u8(self) -> u8 {
        self as u8
    }
}

impl From<u8> for ShutdownStatus {
    fn from(v: u8) -> Self {
        match v {
            2 => Self::Prestop,
            3 => Self::Terminating,
            4 => Self::Completed,
            _ => Self::Running,
        }
    }
}

static SHUTDOWN_STATUS: AtomicU8 = AtomicU8::new(ShutdownStatus::Running as u8);
/// Unix-ms timestamp of the last rdkafka healthy-broker report.
/// 0 = never seen (Kafka not yet ready).
static KAFKA_LAST_HEALTHY_MS: AtomicI64 = AtomicI64::new(0);

pub fn set_shutdown_status(status: ShutdownStatus) {
    SHUTDOWN_STATUS.store(status.as_u8(), Ordering::Relaxed);
}

pub fn get_shutdown_status() -> ShutdownStatus {
    SHUTDOWN_STATUS.load(Ordering::Relaxed).into()
}

/// Returns `true` when rdkafka has reported at least one broker UP within
/// the last `threshold_ms` milliseconds.
///
/// A zero timestamp means the stats callback has never fired — the service
/// is still starting up and should not be considered healthy.
pub fn is_kafka_healthy(threshold_ms: i64) -> bool {
    let last = KAFKA_LAST_HEALTHY_MS.load(Ordering::Relaxed);
    if last == 0 {
        return false;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    (now - last) < threshold_ms
}

/// Zero-cost handle passed to rdkafka's ClientContext.
/// Writes into the global `KAFKA_LAST_HEALTHY_MS` atomic.
#[derive(Clone, Default)]
pub struct HealthHandle;

impl HealthHandle {
    pub fn new() -> Self {
        HealthHandle
    }

    /// Called by rdkafka's stats callback when at least one broker is UP.
    pub fn report_kafka_healthy(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        KAFKA_LAST_HEALTHY_MS.store(now, Ordering::Relaxed);
    }

    /// Delegates to the module-level `is_kafka_healthy` check.
    pub fn is_kafka_healthy(&self, threshold_ms: i64) -> bool {
        is_kafka_healthy(threshold_ms)
    }
}

/// GET /live — always 200; the process is alive.
pub async fn liveness_handler() -> &'static str {
    "ok"
}

/// GET /ready — 200 only when Kafka is connected and not shutting down.
/// Uses a 15 s staleness window: Kafka must have reported healthy within
/// the last 15 s (= 3× the default rdkafka statistics.interval.ms of 5 s).
pub async fn readiness_handler() -> Response {
    if get_shutdown_status() != ShutdownStatus::Running {
        return (StatusCode::SERVICE_UNAVAILABLE, "shutting down").into_response();
    }
    if !is_kafka_healthy(15_000) {
        return (StatusCode::SERVICE_UNAVAILABLE, "kafka not ready").into_response();
    }
    (StatusCode::OK, "ready").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn never_seen_is_not_healthy() {
        // Explicitly reset for test isolation.
        KAFKA_LAST_HEALTHY_MS.store(0, Ordering::Relaxed);
        assert!(!is_kafka_healthy(15_000));
    }

    #[test]
    fn fresh_stamp_is_healthy() {
        let h = HealthHandle::new();
        h.report_kafka_healthy();
        assert!(is_kafka_healthy(15_000));
        assert!(h.is_kafka_healthy(15_000));
    }

    #[test]
    fn stale_stamp_is_not_healthy() {
        // Backdating by writing a timestamp 20 s in the past.
        let past = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
            - 20_000;
        KAFKA_LAST_HEALTHY_MS.store(past, Ordering::Relaxed);
        assert!(!is_kafka_healthy(15_000));
    }
}

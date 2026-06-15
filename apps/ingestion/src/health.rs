use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

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
/// Set by rdkafka's stats callback when at least one broker is UP.
static KAFKA_HEALTHY: AtomicBool = AtomicBool::new(false);

pub fn set_shutdown_status(status: ShutdownStatus) {
    SHUTDOWN_STATUS.store(status.as_u8(), Ordering::Relaxed);
}

pub fn get_shutdown_status() -> ShutdownStatus {
    SHUTDOWN_STATUS.load(Ordering::Relaxed).into()
}

/// Zero-cost handle passed to rdkafka's ClientContext.
/// Writes into the global `KAFKA_HEALTHY` atomic.
#[derive(Clone, Default)]
pub struct HealthHandle;

impl HealthHandle {
    pub fn new() -> Self {
        HealthHandle
    }

    /// Called by rdkafka's stats callback when at least one broker is UP.
    pub fn report_kafka_healthy(&self) {
        KAFKA_HEALTHY.store(true, Ordering::Relaxed);
    }
}

/// GET /live — always 200; the process is alive.
pub async fn liveness_handler() -> StatusCode {
    StatusCode::OK
}

/// GET /ready — 200 only when Kafka is connected and not shutting down.
/// Reads global atomics directly — no State extractor needed.
pub async fn readiness_handler() -> Response {
    if get_shutdown_status() != ShutdownStatus::Running {
        return (StatusCode::SERVICE_UNAVAILABLE, "shutting down").into_response();
    }
    if !KAFKA_HEALTHY.load(Ordering::Relaxed) {
        return (StatusCode::SERVICE_UNAVAILABLE, "kafka not ready").into_response();
    }
    StatusCode::OK.into_response()
}

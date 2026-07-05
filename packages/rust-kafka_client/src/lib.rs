//! Production-ready Kafka client wrappers built on `rdkafka`.
//!
//! The crate keeps the runtime surface small and opinionated:
//! - tuned producer and consumer defaults for low tail latency
//! - eager startup health checks
//! - raw and JSON send paths
//! - batch sending with bounded concurrent delivery waits
//! - thin access to the underlying `rdkafka` clients for advanced use

use std::time::Duration;

use futures_util::future::try_join_all;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::error::KafkaError;
use rdkafka::message::BorrowedMessage;
use rdkafka::producer::{FutureProducer, FutureRecord, Producer};
use rdkafka::util::Timeout;
use serde::Serialize;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, KafkaClientError>;

/// Common transport settings shared by producer and consumer clients.
#[derive(Clone, Debug)]
pub struct KafkaTransportConfig {
	pub brokers: Vec<String>,
	pub client_id: String,
	pub connection_timeout: Duration,
	pub request_timeout: Duration,
}

impl KafkaTransportConfig {
	pub fn new<I, S>(brokers: I, client_id: impl Into<String>) -> Self
	where
		I: IntoIterator<Item = S>,
		S: Into<String>,
	{
		Self {
			brokers: brokers.into_iter().map(Into::into).collect(),
			client_id: client_id.into(),
			connection_timeout: Duration::from_secs(3),
			request_timeout: Duration::from_secs(30),
		}
	}

	fn validate(&self) -> Result<()> {
		if self.brokers.is_empty() {
			return Err(KafkaClientError::InvalidConfig(
				"brokers must not be empty".to_string(),
			));
		}

		if self.brokers.iter().any(|broker| broker.trim().is_empty()) {
			return Err(KafkaClientError::InvalidConfig(
				"brokers must not contain empty values".to_string(),
			));
		}

		if self.client_id.trim().is_empty() {
			return Err(KafkaClientError::InvalidConfig(
				"client_id must not be empty".to_string(),
			));
		}

		Ok(())
	}
}

/// Low-latency producer defaults tuned for idempotent delivery.
#[derive(Clone, Debug)]
pub struct KafkaProducerConfig {
	pub transport: KafkaTransportConfig,
	pub delivery_timeout: Duration,
	pub linger: Duration,
	pub compression_type: String,
	pub enable_idempotence: bool,
	pub acks: String,
	pub retries: i32,
	pub max_in_flight_requests_per_connection: i32,
	pub batch_num_messages: i32,
	pub queue_buffering_max_messages: i32,
	pub queue_buffering_max_kbytes: i32,
}

impl KafkaProducerConfig {
	pub fn new<I, S>(brokers: I, client_id: impl Into<String>) -> Self
	where
		I: IntoIterator<Item = S>,
		S: Into<String>,
	{
		Self {
			transport: KafkaTransportConfig::new(brokers, client_id),
			delivery_timeout: Duration::from_secs(30),
			linger: Duration::from_millis(1),
			compression_type: "snappy".to_string(),
			enable_idempotence: true,
			acks: "all".to_string(),
			retries: i32::MAX,
			max_in_flight_requests_per_connection: 5,
			batch_num_messages: 10_000,
			queue_buffering_max_messages: 100_000,
			queue_buffering_max_kbytes: 102_400,
		}
	}

	fn validate(&self) -> Result<()> {
		self.transport.validate()
	}
}

/// Consumer defaults geared for long-running workers and predictable rebalances.
#[derive(Clone, Debug)]
pub struct KafkaConsumerConfig {
	pub transport: KafkaTransportConfig,
	pub group_id: String,
	pub session_timeout: Duration,
	pub heartbeat_interval: Duration,
	pub auto_offset_reset: String,
	pub enable_auto_commit: bool,
	pub enable_partition_eof: bool,
	pub fetch_wait_max: Duration,
	pub fetch_min_bytes: i32,
	pub queued_min_messages: i32,
	pub max_poll_interval: Duration,
	pub partition_assignment_strategy: String,
	pub allow_auto_create_topics: bool,
	pub isolation_level: Option<String>,
}

impl KafkaConsumerConfig {
	pub fn new<I, S>(brokers: I, client_id: impl Into<String>, group_id: impl Into<String>) -> Self
	where
		I: IntoIterator<Item = S>,
		S: Into<String>,
	{
		Self {
			transport: KafkaTransportConfig::new(brokers, client_id),
			group_id: group_id.into(),
			session_timeout: Duration::from_secs(30),
			heartbeat_interval: Duration::from_secs(3),
			auto_offset_reset: "earliest".to_string(),
			enable_auto_commit: false,
			enable_partition_eof: false,
			fetch_wait_max: Duration::from_millis(5),
			fetch_min_bytes: 1,
			queued_min_messages: 1,
			max_poll_interval: Duration::from_secs(300),
			partition_assignment_strategy: "cooperative-sticky".to_string(),
			allow_auto_create_topics: false,
			isolation_level: None,
		}
	}

	fn validate(&self) -> Result<()> {
		self.transport.validate()?;

		if self.group_id.trim().is_empty() {
			return Err(KafkaClientError::InvalidConfig(
				"group_id must not be empty".to_string(),
			));
		}

		if self.heartbeat_interval >= self.session_timeout {
			return Err(KafkaClientError::InvalidConfig(
				"heartbeat_interval must be smaller than session_timeout".to_string(),
			));
		}

		Ok(())
	}
}

/// Raw record used for high-throughput batch sends.
#[derive(Clone, Copy, Debug)]
pub struct KafkaRawRecord<'a> {
	pub topic: &'a str,
	pub key: Option<&'a str>,
	pub payload: &'a [u8],
}

impl<'a> KafkaRawRecord<'a> {
	pub fn new(topic: &'a str, key: Option<&'a str>, payload: &'a [u8]) -> Self {
		Self { topic, key, payload }
	}
}

/// Error type for client creation, serialization, and broker operations.
#[derive(Debug, Error)]
pub enum KafkaClientError {
	#[error("kafka error: {0}")]
	Kafka(#[from] KafkaError),
	#[error("serialization error: {0}")]
	Serialization(#[from] serde_json::Error),
	#[error("invalid kafka configuration: {0}")]
	InvalidConfig(String),
}

#[derive(Clone)]
pub struct KafkaProducer {
	producer: FutureProducer,
	config: KafkaProducerConfig,
	ready: bool,
}

impl KafkaProducer {
	pub fn new(config: KafkaProducerConfig) -> Result<Self> {
		config.validate()?;
		let producer = build_producer(&config)?;
		producer
			.client()
			.fetch_metadata(None, Timeout::After(config.transport.connection_timeout))?;

		Ok(Self {
			producer,
			config,
			ready: true,
		})
	}

	pub fn inner(&self) -> &FutureProducer {
		&self.producer
	}

	pub fn is_ready(&self) -> bool {
		self.ready
	}

	pub fn health_check(&self) -> Result<()> {
		self.producer
			.client()
			.fetch_metadata(None, Timeout::After(self.config.transport.connection_timeout))?;
		Ok(())
	}

	pub async fn send_raw(
		&self,
		topic: &str,
		key: Option<&str>,
		payload: &[u8],
	) -> Result<()> {
		let mut record = FutureRecord::to(topic).payload(payload);
		if let Some(key) = key {
			record = record.key(key);
		}

		self.producer
			.send(record, Timeout::After(self.config.delivery_timeout))
			.await
			.map_err(|(error, _)| KafkaClientError::Kafka(error))?;

		Ok(())
	}

	pub async fn send_json<T: Serialize>(
		&self,
		topic: &str,
		key: Option<&str>,
		value: &T,
	) -> Result<()> {
		let payload = serde_json::to_vec(value)?;
		self.send_raw(topic, key, &payload).await
	}

	pub async fn send_batch_raw<'a, I>(&self, records: I) -> Result<()>
	where
		I: IntoIterator<Item = KafkaRawRecord<'a>>,
	{
		let deliveries = records.into_iter().map(|record| async move {
			self.send_raw(record.topic, record.key, record.payload).await
		});

		try_join_all(deliveries).await?;
		Ok(())
	}

	pub fn flush(&self) -> Result<()> {
		self.producer
			.flush(Timeout::After(self.config.delivery_timeout))?;
		Ok(())
	}

	pub fn shutdown(self) -> Result<()> {
		self.producer
			.flush(Timeout::After(self.config.delivery_timeout))?;
		Ok(())
	}
}

pub struct KafkaConsumer {
	consumer: StreamConsumer,
	config: KafkaConsumerConfig,
	ready: bool,
}

impl KafkaConsumer {
	pub fn new(config: KafkaConsumerConfig) -> Result<Self> {
		config.validate()?;
		let consumer = build_consumer(&config)?;
		consumer
			.client()
			.fetch_metadata(None, Timeout::After(config.transport.connection_timeout))?;

		Ok(Self {
			consumer,
			config,
			ready: true,
		})
	}

	pub fn inner(&self) -> &StreamConsumer {
		&self.consumer
	}

	pub fn is_ready(&self) -> bool {
		self.ready
	}

	pub fn health_check(&self) -> Result<()> {
		self.consumer
			.client()
			.fetch_metadata(None, Timeout::After(self.config.transport.connection_timeout))?;
		Ok(())
	}

	pub fn subscribe(&self, topics: &[&str]) -> Result<()> {
		self.consumer.subscribe(topics)?;
		Ok(())
	}

	pub async fn recv(&self) -> Result<BorrowedMessage<'_>> {
		self.consumer.recv().await.map_err(KafkaClientError::from)
	}

	pub fn commit_message(
		&self,
		message: &BorrowedMessage<'_>,
		mode: CommitMode,
	) -> Result<()> {
		self.consumer.commit_message(message, mode)?;
		Ok(())
	}

	pub fn shutdown(self) {
		self.consumer.unsubscribe();
	}
}

pub fn create_producer_client(config: KafkaProducerConfig) -> Result<KafkaProducer> {
	KafkaProducer::new(config)
}

pub fn create_consumer_client(config: KafkaConsumerConfig) -> Result<KafkaConsumer> {
	KafkaConsumer::new(config)
}

fn build_producer(config: &KafkaProducerConfig) -> Result<FutureProducer> {
	let mut client_config = base_client_config(&config.transport);

	client_config.set("enable.idempotence", config.enable_idempotence.to_string());
	client_config.set("acks", &config.acks);
	client_config.set("compression.type", &config.compression_type);
	client_config.set("linger.ms", config.linger.as_millis().to_string());
	client_config.set("message.timeout.ms", config.delivery_timeout.as_millis().to_string());
	client_config.set("retries", config.retries.to_string());
	client_config.set(
		"max.in.flight.requests.per.connection",
		config.max_in_flight_requests_per_connection.to_string(),
	);
	client_config.set("batch.num.messages", config.batch_num_messages.to_string());
	client_config.set(
		"queue.buffering.max.messages",
		config.queue_buffering_max_messages.to_string(),
	);
	client_config.set(
		"queue.buffering.max.kbytes",
		config.queue_buffering_max_kbytes.to_string(),
	);

	client_config.create().map_err(KafkaClientError::from)
}

fn build_consumer(config: &KafkaConsumerConfig) -> Result<StreamConsumer> {
	let mut client_config = base_client_config(&config.transport);

	client_config.set("group.id", &config.group_id);
	client_config.set("session.timeout.ms", config.session_timeout.as_millis().to_string());
	client_config.set(
		"heartbeat.interval.ms",
		config.heartbeat_interval.as_millis().to_string(),
	);
	client_config.set("enable.auto.commit", config.enable_auto_commit.to_string());
	client_config.set("auto.offset.reset", &config.auto_offset_reset);
	client_config.set(
		"enable.partition.eof",
		config.enable_partition_eof.to_string(),
	);
	client_config.set("fetch.wait.max.ms", config.fetch_wait_max.as_millis().to_string());
	client_config.set("fetch.min.bytes", config.fetch_min_bytes.to_string());
	client_config.set("queued.min.messages", config.queued_min_messages.to_string());
	client_config.set(
		"max.poll.interval.ms",
		config.max_poll_interval.as_millis().to_string(),
	);
	client_config.set(
		"partition.assignment.strategy",
		&config.partition_assignment_strategy,
	);
	client_config.set(
		"allow.auto.create.topics",
		config.allow_auto_create_topics.to_string(),
	);

	if let Some(isolation_level) = &config.isolation_level {
		client_config.set("isolation.level", isolation_level);
	}

	client_config.create().map_err(KafkaClientError::from)
}

fn base_client_config(config: &KafkaTransportConfig) -> ClientConfig {
	let mut client_config = ClientConfig::new();
	client_config.set("bootstrap.servers", config.brokers.join(","));
	client_config.set("client.id", &config.client_id);
	client_config.set(
		"request.timeout.ms",
		config.request_timeout.as_millis().to_string(),
	);
	client_config.set(
		"socket.connection.setup.timeout.ms",
		config.connection_timeout.as_millis().to_string(),
	);
	client_config.set("socket.keepalive.enable", "true");
	client_config
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn producer_defaults_are_low_latency_tuned() {
		let config = KafkaProducerConfig::new(["localhost:9092"], "producer-test");

		assert!(config.enable_idempotence);
		assert_eq!(config.compression_type, "snappy");
		assert_eq!(config.linger, Duration::from_millis(1));
		assert_eq!(config.max_in_flight_requests_per_connection, 5);
	}

	#[test]
	fn consumer_defaults_are_worker_friendly() {
		let config = KafkaConsumerConfig::new(["localhost:9092"], "consumer-test", "group-a");

		assert!(!config.enable_auto_commit);
		assert_eq!(config.auto_offset_reset, "earliest");
		assert_eq!(config.partition_assignment_strategy, "cooperative-sticky");
		assert_eq!(config.heartbeat_interval, Duration::from_secs(3));
	}

	#[test]
	fn raw_record_constructor_preserves_fields() {
		let payload = b"hello";
		let record = KafkaRawRecord::new("topic-a", Some("key-a"), payload);

		assert_eq!(record.topic, "topic-a");
		assert_eq!(record.key, Some("key-a"));
		assert_eq!(record.payload, payload);
	}

	#[test]
	fn consumer_validation_rejects_invalid_heartbeat() {
		let mut config = KafkaConsumerConfig::new(["localhost:9092"], "consumer-test", "group-a");
		config.heartbeat_interval = config.session_timeout;

		let result = config.validate();
		assert!(matches!(result, Err(KafkaClientError::InvalidConfig(_))));
	}
}

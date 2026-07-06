//! Production-ready Redis client wrappers built on `redis`.
//!
//! The crate keeps the hot path small and practical:
//! - eager connect and health validation
//! - reconnecting async connection manager
//! - safe helpers with input validation and resilient defaults
//! - JSON, hash, key, Bloom filter, and pub/sub helpers

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use redis::aio::{ConnectionManager, PubSub};
use redis::{AsyncCommands, Client, Msg, RedisError, RedisResult};
use serde::de::DeserializeOwned;
use serde::Serialize;
use thiserror::Error;
use tracing::{debug, warn};

pub type Result<T> = std::result::Result<T, RedisClientError>;

const MAX_KEY_LENGTH: usize = 512;
const MAX_VALUE_LENGTH: usize = 1024 * 1024;
const MAX_CHANNEL_LENGTH: usize = 256;
const MAX_PATTERN_LENGTH: usize = 256;
const MAX_SAFE_SET_TTL_SECONDS: u64 = 365 * 24 * 60 * 60;
const MAX_SAFE_DEL_KEYS: usize = 1_000;
const MAX_SAFE_MGET_KEYS: usize = 1_000;
const MAX_SAFE_EXISTS_KEYS: usize = 100;

#[derive(Clone, Debug)]
pub struct RedisClientConfig {
	pub url: String,
	pub response_timeout: Duration,
	pub connection_timeout: Duration,
	pub reconnect_exponent_base: u64,
	pub reconnect_factor_ms: u64,
	pub reconnect_attempts: usize,
	pub validate_on_startup: bool,
}

impl RedisClientConfig {
	pub fn new(url: impl Into<String>) -> Self {
		Self {
			url: url.into(),
			response_timeout: Duration::from_secs(5),
			connection_timeout: Duration::from_secs(3),
			reconnect_exponent_base: 2,
			reconnect_factor_ms: 100,
			reconnect_attempts: 3,
			validate_on_startup: true,
		}
	}

	fn validate(&self) -> Result<()> {
		if self.url.trim().is_empty() {
			return Err(RedisClientError::InvalidConfig(
				"url must not be empty".to_string(),
			));
		}

		if self.reconnect_exponent_base < 2 {
			return Err(RedisClientError::InvalidConfig(
				"reconnect_exponent_base must be at least 2".to_string(),
			));
		}

		if self.reconnect_attempts == 0 {
			return Err(RedisClientError::InvalidConfig(
				"reconnect_attempts must be greater than 0".to_string(),
			));
		}

		Ok(())
	}
}

#[derive(Clone, Debug)]
pub struct RedisStats {
	pub is_connected: bool,
	pub retry_count: usize,
	pub connection_status: String,
}

#[derive(Clone, Debug)]
pub struct RedisHealthCheck {
	pub status: String,
	pub latency: Option<Duration>,
	pub connection_state: String,
	pub retry_count: usize,
}

#[derive(Clone)]
pub struct RedisClient {
	config: RedisClientConfig,
	client: Client,
	connection: Arc<Mutex<ConnectionManager>>,
	is_connected: Arc<AtomicBool>,
	retry_count: Arc<AtomicUsize>,
}

#[derive(Debug, Error)]
pub enum RedisClientError {
	#[error("redis error: {0}")]
	Redis(#[from] RedisError),
	#[error("serialization error: {0}")]
	Serialization(#[from] serde_json::Error),
	#[error("invalid redis configuration: {0}")]
	InvalidConfig(String),
	#[error("invalid redis state: {0}")]
	State(String),
}

impl RedisClient {
	pub async fn new(config: RedisClientConfig) -> Result<Self> {
		config.validate()?;

		let client = Client::open(config.url.as_str())?;
		let connection = build_connection_manager(&client, &config).await?;

		let instance = Self {
			config,
			client,
			connection: Arc::new(Mutex::new(connection)),
			is_connected: Arc::new(AtomicBool::new(true)),
			retry_count: Arc::new(AtomicUsize::new(0)),
		};

		if instance.config.validate_on_startup {
			let _ = instance.ping().await?;
		}

		Ok(instance)
	}

	pub async fn from_url(url: impl Into<String>) -> Result<Self> {
		Self::new(RedisClientConfig::new(url)).await
	}

	pub fn create(url: impl Into<String>) -> Result<Self> {
		// Convenience constructor for sync call sites that can tolerate
		// the runtime being driven by the caller.
		let rt = tokio::runtime::Runtime::new().map_err(|err| {
			RedisClientError::State(format!("failed to create tokio runtime: {err}"))
		})?;

		rt.block_on(Self::from_url(url))
	}

	pub fn client(&self) -> &Client {
		&self.client
	}

	pub fn stats(&self) -> RedisStats {
		RedisStats {
			is_connected: self.is_connected.load(Ordering::Relaxed),
			retry_count: self.retry_count.load(Ordering::Relaxed),
			connection_status: if self.is_connected.load(Ordering::Relaxed) {
				"connected".to_string()
			} else {
				"disconnected".to_string()
			},
		}
	}

	pub async fn ping(&self) -> Result<bool> {
		let mut connection = self.connection_handle()?;
		let pong: String = redis::cmd("PING").query_async(&mut connection).await?;
		let healthy = pong.eq_ignore_ascii_case("PONG");
		self.is_connected.store(healthy, Ordering::Relaxed);
		Ok(healthy)
	}

	pub async fn is_healthy(&self) -> bool {
		self.ping().await.unwrap_or(false)
	}

	pub async fn health_check(&self) -> RedisHealthCheck {
		let started = Instant::now();
		match self.ping().await {
			Ok(true) => RedisHealthCheck {
				status: "healthy".to_string(),
				latency: Some(started.elapsed()),
				connection_state: self.stats().connection_status,
				retry_count: self.retry_count.load(Ordering::Relaxed),
			},
			Ok(false) | Err(_) => {
				self.mark_disconnected();
				RedisHealthCheck {
					status: "unhealthy".to_string(),
					latency: None,
					connection_state: self.stats().connection_status,
					retry_count: self.retry_count.load(Ordering::Relaxed),
				}
			}
		}
	}

	pub async fn force_reconnect(&self) -> Result<()> {
		let mut guard = self
			.connection
			.lock()
			.map_err(|_| RedisClientError::State("connection lock poisoned".to_string()))?;

		let next_connection = build_connection_manager(&self.client, &self.config).await?;
		*guard = next_connection;
		self.retry_count.fetch_add(1, Ordering::Relaxed);
		self.is_connected.store(true, Ordering::Relaxed);
		Ok(())
	}

	pub async fn safe_get(&self, key: &str) -> Result<Option<String>> {
		if !is_valid_key(key) {
			warn!(key = %key, "invalid key provided to safe_get");
			return Ok(None);
		}

		let mut connection = self.connection_handle()?;
		match connection.get(key).await {
			Ok(value) => Ok(value),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, key = %key, "safe_get failed");
				Ok(None)
			}
		}
	}

	pub async fn safe_set(&self, key: &str, value: &str, ttl_seconds: Option<u64>) -> Result<bool> {
		if !is_valid_key(key) {
			warn!(key = %key, "invalid key provided to safe_set");
			return Ok(false);
		}

		if !is_valid_value(value) {
			warn!(key = %key, value_len = value.len(), "invalid value provided to safe_set");
			return Ok(false);
		}

		if let Some(ttl) = ttl_seconds {
			if ttl > MAX_SAFE_SET_TTL_SECONDS {
				warn!(ttl_seconds = ttl, "invalid ttl provided to safe_set");
				return Ok(false);
			}
		}

		let mut connection = self.connection_handle()?;
		let result = match ttl_seconds {
			Some(ttl) => connection.set_ex(key, value, ttl).await,
			None => connection.set(key, value).await,
		};

		match result {
			Ok(()) => Ok(true),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, key = %key, "safe_set failed");
				Ok(false)
			}
		}
	}

	pub async fn safe_set_ex(&self, key: &str, ttl_seconds: u64, value: &str) -> Result<bool> {
		self.safe_set(key, value, Some(ttl_seconds)).await
	}

	pub async fn safe_mget(&self, keys: &[&str]) -> Result<Vec<Option<String>>> {
		if keys.is_empty() {
			return Ok(Vec::new());
		}

		if keys.len() > MAX_SAFE_MGET_KEYS || keys.iter().any(|key| !is_valid_key(key)) {
			warn!(key_count = keys.len(), "invalid keys provided to safe_mget");
			return Ok(vec![None; keys.len()]);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<Vec<Option<String>>> = redis::cmd("MGET").arg(keys).query_async(&mut connection).await;
		match result {
			Ok(values) => Ok(values),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, "safe_mget failed");
				Ok(vec![None; keys.len()])
			}
		}
	}

	pub async fn safe_del(&self, keys: &[&str]) -> Result<u64> {
		if keys.is_empty() {
			return Ok(0);
		}

		if keys.len() > MAX_SAFE_DEL_KEYS || keys.iter().any(|key| !is_valid_key(key)) {
			warn!(key_count = keys.len(), "invalid keys provided to safe_del");
			return Ok(0);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<u64> = redis::cmd("DEL").arg(keys).query_async(&mut connection).await;
		match result {
			Ok(deleted) => Ok(deleted),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, "safe_del failed");
				Ok(0)
			}
		}
	}

	pub async fn safe_exists(&self, keys: &[&str]) -> Result<u64> {
		if keys.is_empty() {
			return Ok(0);
		}

		if keys.len() > MAX_SAFE_EXISTS_KEYS || keys.iter().any(|key| !is_valid_key(key)) {
			warn!(key_count = keys.len(), "invalid keys provided to safe_exists");
			return Ok(0);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<u64> = redis::cmd("EXISTS").arg(keys).query_async(&mut connection).await;
		match result {
			Ok(count) => Ok(count),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, "safe_exists failed");
				Ok(0)
			}
		}
	}

	pub async fn safe_keys(&self, pattern: &str) -> Result<Vec<String>> {
		if !is_valid_pattern(pattern) {
			warn!(pattern = %pattern, "invalid pattern provided to safe_keys");
			return Ok(Vec::new());
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<Vec<String>> = redis::cmd("KEYS").arg(pattern).query_async(&mut connection).await;
		match result {
			Ok(keys) => Ok(keys),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, pattern = %pattern, "safe_keys failed");
				Ok(Vec::new())
			}
		}
	}

	pub async fn safe_publish(&self, channel: &str, message: &str) -> Result<u64> {
		if !is_valid_channel(channel) || !is_valid_message(message) {
			warn!(channel = %channel, "invalid input provided to safe_publish");
			return Ok(0);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<u64> = redis::cmd("PUBLISH")
			.arg(channel)
			.arg(message)
			.query_async(&mut connection)
			.await;

		match result {
			Ok(count) => Ok(count),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, channel = %channel, "safe_publish failed");
				Ok(0)
			}
		}
	}

	pub async fn expire(&self, key: &str, ttl_seconds: u64) -> Result<bool> {
		if !is_valid_key(key) {
			warn!(key = %key, "invalid key provided to expire");
			return Ok(false);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<i64> = redis::cmd("EXPIRE")
			.arg(key)
			.arg(ttl_seconds)
			.query_async(&mut connection)
			.await;

		match result {
			Ok(value) => Ok(value > 0),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, key = %key, "expire failed");
				Ok(false)
			}
		}
	}

	pub async fn get_json<T>(&self, key: &str) -> Result<Option<T>>
	where
		T: DeserializeOwned,
	{
		let raw = self.safe_get(key).await?;
		match raw {
			Some(value) => match serde_json::from_str(&value) {
				Ok(parsed) => Ok(Some(parsed)),
				Err(err) => {
					warn!(error = %err, key = %key, "get_json failed to parse value");
					Ok(None)
				}
			},
			None => Ok(None),
		}
	}

	pub async fn set_json<T>(&self, key: &str, value: &T, ttl_seconds: Option<u64>) -> Result<bool>
	where
		T: Serialize,
	{
		let payload = serde_json::to_string(value)?;
		self.safe_set(key, &payload, ttl_seconds).await
	}

	pub async fn bf_exists(&self, filter_key: &str, item: &str) -> Result<bool> {
		if !is_valid_key(filter_key) || !is_valid_key(item) {
			warn!(filter_key = %filter_key, "invalid input provided to bf_exists");
			return Ok(false);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<i64> = redis::cmd("BF.EXISTS")
			.arg(filter_key)
			.arg(item)
			.query_async(&mut connection)
			.await;

		match result {
			Ok(value) => Ok(value == 1),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, filter_key = %filter_key, "bf_exists failed");
				Ok(false)
			}
		}
	}

	pub async fn bf_add(&self, filter_key: &str, item: &str) -> Result<bool> {
		if !is_valid_key(filter_key) || !is_valid_key(item) {
			warn!(filter_key = %filter_key, "invalid input provided to bf_add");
			return Ok(false);
		}

		let mut connection = self.connection_handle()?;
		let result: RedisResult<i64> = redis::cmd("BF.ADD")
			.arg(filter_key)
			.arg(item)
			.query_async(&mut connection)
			.await;

		match result {
			Ok(value) => Ok(value == 1),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, filter_key = %filter_key, "bf_add failed");
				Ok(false)
			}
		}
	}

	pub async fn hset(&self, key: &str, fields: &HashMap<String, String>) -> Result<bool> {
		if !is_valid_key(key) {
			warn!(key = %key, "invalid key provided to hset");
			return Ok(false);
		}

		if fields.is_empty() {
			return Ok(true);
		}

		let items: Vec<(String, String)> = fields.iter().map(|(field, value)| (field.clone(), value.clone())).collect();
		let mut connection = self.connection_handle()?;
		match connection.hset_multiple::<_, _, _, ()>(key, &items).await {
			Ok(_) => Ok(true),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, key = %key, "hset failed");
				Ok(false)
			}
		}
	}

	pub async fn hgetall(&self, key: &str) -> Result<HashMap<String, String>> {
		if !is_valid_key(key) {
			warn!(key = %key, "invalid key provided to hgetall");
			return Ok(HashMap::new());
		}

		let mut connection = self.connection_handle()?;
		match connection.hgetall(key).await {
			Ok(result) => Ok(result),
			Err(err) => {
				self.mark_disconnected();
				warn!(error = %err, key = %key, "hgetall failed");
				Ok(HashMap::new())
			}
		}
	}

	pub async fn create_subscriber(&self) -> Result<RedisSubscriber> {
		let pubsub = self.client.get_async_pubsub().await?;
		Ok(RedisSubscriber { pubsub })
	}

	pub async fn shutdown(&self) -> Result<()> {
		self.mark_disconnected();
		Ok(())
	}

	/// Execute a Lua script atomically via EVALSHA (falls back to EVAL on NOSCRIPT).
	/// `keys` maps to Lua KEYS[1..n] and `args` maps to ARGV[1..m].
	pub async fn invoke_script(
		&self,
		script: &redis::Script,
		keys: &[String],
		args: &[String],
	) -> Result<redis::Value> {
		let mut con = self.connection_handle()?;
		let mut inv = script.prepare_invoke();
		for k in keys {
			inv.key(k.as_str());
		}
		for a in args {
			inv.arg(a.as_str());
		}
		inv.invoke_async(&mut con).await.map_err(|e| {
			self.mark_disconnected();
			e.into()
		})
	}

	fn connection_handle(&self) -> Result<ConnectionManager> {
		self.connection
			.lock()
			.map_err(|_| RedisClientError::State("connection lock poisoned".to_string()))
			.map(|guard| guard.clone())
	}

	fn mark_disconnected(&self) {
		self.is_connected.store(false, Ordering::Relaxed);
	}
}

pub struct RedisSubscriber {
	pubsub: PubSub,
}

impl RedisSubscriber {
	pub async fn subscribe(&mut self, channel: &str) -> Result<()> {
		if !is_valid_channel(channel) {
			warn!(channel = %channel, "invalid channel provided to subscribe");
			return Ok(());
		}

		self.pubsub.subscribe(channel).await?;
		Ok(())
	}

	pub async fn unsubscribe(&mut self, channel: &str) -> Result<()> {
		if !is_valid_channel(channel) {
			warn!(channel = %channel, "invalid channel provided to unsubscribe");
			return Ok(());
		}

		self.pubsub.unsubscribe(channel).await?;
		Ok(())
	}

	pub fn messages(&mut self) -> impl futures_util::Stream<Item = Msg> + '_ {
		self.pubsub.on_message()
	}

	pub async fn next_message(&mut self) -> Option<Msg> {
		self.pubsub.on_message().next().await
	}
}

pub async fn bf_exists<C>(redis: &mut C, filter_key: &str, item: &str) -> Result<bool>
where
	C: AsyncCommands + Send,
{
	let result: RedisResult<i64> = redis::cmd("BF.EXISTS").arg(filter_key).arg(item).query_async(redis).await;
	result.map(|value| value == 1).map_err(Into::into)
}

pub async fn bf_add<C>(redis: &mut C, filter_key: &str, item: &str) -> Result<bool>
where
	C: AsyncCommands + Send,
{
	let result: RedisResult<i64> = redis::cmd("BF.ADD").arg(filter_key).arg(item).query_async(redis).await;
	result.map(|value| value == 1).map_err(Into::into)
}

pub async fn get_json<C, T>(redis: &mut C, key: &str) -> Result<Option<T>>
where
	C: AsyncCommands + Send,
	T: DeserializeOwned,
{
	let value: Option<String> = redis.get(key).await?;
	match value {
		Some(raw) => Ok(Some(serde_json::from_str(&raw)?)),
		None => Ok(None),
	}
}

pub async fn set_json<C, T>(redis: &mut C, key: &str, value: &T) -> Result<()>
where
	C: AsyncCommands + Send,
	T: Serialize,
{
	let payload = serde_json::to_string(value)?;
	redis.set::<_, _, ()>(key, payload).await?;
	Ok(())
}

pub async fn hset<C>(redis: &mut C, key: &str, fields: &HashMap<String, String>) -> Result<()>
where
	C: AsyncCommands + Send,
{
	let items: Vec<(String, String)> = fields.iter().map(|(field, value)| (field.clone(), value.clone())).collect();
	redis.hset_multiple::<_, _, _, ()>(key, &items).await?;
	Ok(())
}

pub async fn hgetall<C>(redis: &mut C, key: &str) -> Result<HashMap<String, String>>
where
	C: AsyncCommands + Send,
{
	Ok(redis.hgetall(key).await?)
}

pub fn is_valid_key(key: &str) -> bool {
	!key.is_empty() && key.len() <= MAX_KEY_LENGTH
}

pub fn is_valid_value(value: &str) -> bool {
	!value.is_empty() && value.len() <= MAX_VALUE_LENGTH
}

pub fn is_valid_channel(channel: &str) -> bool {
	!channel.is_empty() && channel.len() <= MAX_CHANNEL_LENGTH
}

pub fn is_valid_message(message: &str) -> bool {
	!message.is_empty() && message.len() <= MAX_VALUE_LENGTH
}

pub fn is_valid_pattern(pattern: &str) -> bool {
	if pattern.is_empty() || pattern.len() > MAX_PATTERN_LENGTH {
		return false;
	}

	if pattern == "*" || pattern == "*:*" || pattern.len() < 2 {
		return false;
	}

	true
}

async fn build_connection_manager(client: &Client, config: &RedisClientConfig) -> Result<ConnectionManager> {
	let manager = ConnectionManager::new_with_backoff_and_timeouts(
		client.clone(),
		config.reconnect_exponent_base,
		config.reconnect_factor_ms,
		config.reconnect_attempts,
		config.response_timeout,
		config.connection_timeout,
	)
	.await?;

	debug!(url = %config.url, "redis connection manager established");
	Ok(manager)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn config_defaults_are_safe() {
		let config = RedisClientConfig::new("redis://localhost:6379");

		assert_eq!(config.response_timeout, Duration::from_secs(5));
		assert_eq!(config.connection_timeout, Duration::from_secs(3));
		assert_eq!(config.reconnect_attempts, 3);
	}

	#[test]
	fn key_validation_matches_safe_limits() {
		assert!(is_valid_key("session:abc"));
		assert!(!is_valid_key(""));
		assert!(!is_valid_key(&"a".repeat(MAX_KEY_LENGTH + 1)));
	}

	#[test]
	fn pattern_validation_blocks_dangerous_globs() {
		assert!(is_valid_pattern("session:*"));
		assert!(!is_valid_pattern("*"));
		assert!(!is_valid_pattern("*:*"));
	}

	#[test]
	fn value_validation_enforces_size_limit() {
		assert!(is_valid_value("hello"));
		assert!(!is_valid_value(&"a".repeat(MAX_VALUE_LENGTH + 1)));
	}
}

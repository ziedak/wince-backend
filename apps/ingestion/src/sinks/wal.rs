//! SQLite write-ahead log for the S3 fallback sink.
//!
//! Events are persisted to the local WAL *before* they enter the in-memory
//! buffer. After a successful S3 `PutObject`, the corresponding WAL rows are
//! deleted. On restart, any rows still present in the WAL are drained back
//! into the S3 pipeline, ensuring no data loss on process crash.
//!
//! The WAL uses SQLite in WAL journal mode for crash safety. Synchronous mode
//! is set to NORMAL — this is safe because a crash that loses the WAL DB
//! journal file is exactly what we are protecting *against* at the S3 layer.

use anyhow::{anyhow, Result};
use std::sync::Mutex;

/// A single persisted entry in the write-ahead log.
#[derive(Debug)]
pub struct WalEntry {
    /// Row ID (auto-incremented primary key).
    pub id: i64,
    pub topic: String,
    pub key: String,
    pub payload: String,
}

/// Thread-safe SQLite write-ahead log.
///
/// All methods are synchronous and lock-free from the caller's perspective
/// (they take a `&self`). The internal `Mutex` is held only for the duration
/// of each SQLite call — never across an `.await` point.
pub struct WalDb {
    conn: Mutex<rusqlite::Connection>,
}

impl WalDb {
    /// Open (or create) the WAL database at `path` and ensure the schema exists.
    pub fn open(path: &str) -> Result<Self> {
        let conn = rusqlite::Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous  = NORMAL;
             CREATE TABLE IF NOT EXISTS wal (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 topic      TEXT    NOT NULL,
                 key        TEXT    NOT NULL,
                 payload    TEXT    NOT NULL,
                 created_at INTEGER NOT NULL
             );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Persist a single event to the WAL and return its row ID.
    pub fn insert(&self, topic: &str, key: &str, payload: &str) -> Result<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow!("WAL mutex poisoned: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO wal (topic, key, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![topic, key, payload, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Delete a single WAL entry after it has been durably flushed to S3.
    #[allow(dead_code)]
    pub fn delete(&self, id: i64) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow!("WAL mutex poisoned: {}", e))?;
        conn.execute("DELETE FROM wal WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Delete a batch of WAL entries in a single transaction after a
    /// successful S3 `PutObject` for the corresponding buffer flush.
    pub fn delete_batch(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut guard = self
            .conn
            .lock()
            .map_err(|e| anyhow!("WAL mutex poisoned: {}", e))?;
        let conn = &mut *guard;
        let tx = conn.transaction()?;
        for &id in ids {
            tx.execute("DELETE FROM wal WHERE id = ?1", [id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Return all rows ordered by insertion time for startup replay.
    pub fn drain(&self) -> Result<Vec<WalEntry>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow!("WAL mutex poisoned: {}", e))?;
        let mut stmt =
            conn.prepare("SELECT id, topic, key, payload FROM wal ORDER BY id ASC")?;
        let entries: rusqlite::Result<Vec<WalEntry>> = stmt
            .query_map([], |row| {
                Ok(WalEntry {
                    id: row.get(0)?,
                    topic: row.get(1)?,
                    key: row.get(2)?,
                    payload: row.get(3)?,
                })
            })?
            .collect();
        Ok(entries?)
    }

    /// Return the current number of pending rows (useful for metrics).
    pub fn pending_count(&self) -> Result<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow!("WAL mutex poisoned: {}", e))?;
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM wal", [], |r| r.get(0))?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> WalDb {
        WalDb::open(":memory:").expect("in-memory WAL")
    }

    #[test]
    fn insert_and_drain() {
        let wal = open_in_memory();
        let id = wal.insert("topic.events", "key-1", r#"{"eid":"abc"}"#).unwrap();
        assert!(id > 0);

        let entries = wal.drain().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, id);
        assert_eq!(entries[0].topic, "topic.events");
        assert_eq!(entries[0].key, "key-1");
    }

    #[test]
    fn delete_removes_row() {
        let wal = open_in_memory();
        let id = wal.insert("t", "k", "p").unwrap();
        wal.delete(id).unwrap();
        assert_eq!(wal.drain().unwrap().len(), 0);
    }

    #[test]
    fn delete_batch_removes_rows() {
        let wal = open_in_memory();
        let id1 = wal.insert("t", "k1", "p1").unwrap();
        let id2 = wal.insert("t", "k2", "p2").unwrap();
        let _id3 = wal.insert("t", "k3", "p3").unwrap();
        wal.delete_batch(&[id1, id2]).unwrap();
        let remaining = wal.drain().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].key, "k3");
    }

    #[test]
    fn pending_count_tracks_inserts_and_deletes() {
        let wal = open_in_memory();
        assert_eq!(wal.pending_count().unwrap(), 0);
        let id = wal.insert("t", "k", "p").unwrap();
        assert_eq!(wal.pending_count().unwrap(), 1);
        wal.delete(id).unwrap();
        assert_eq!(wal.pending_count().unwrap(), 0);
    }
}

use anyhow::{Context, Result};
use r2d2::{ManageConnection, Pool, PooledConnection};
use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OpenFlags;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

// Import the db_schema module
use super::db_schema;

const DEFAULT_POOL_SIZE: u32 = 4;

#[derive(Clone)]
pub struct Database {
    pool: Arc<Pool<SqliteConnectionManager>>,
}

#[derive(Clone)]
pub(crate) struct SqliteConnectionManager {
    config: SqliteConfig,
}

#[derive(Clone)]
pub(crate) enum SqliteConfig {
    File(PathBuf),
    #[cfg(test)]
    Memory(String),
}

impl SqliteConnectionManager {
    fn file(path: PathBuf) -> Self {
        Self {
            config: SqliteConfig::File(path),
        }
    }

    #[cfg(test)]
    fn memory() -> Self {
        use std::sync::atomic::{AtomicUsize, Ordering};

        static MEMORY_DB_ID: AtomicUsize = AtomicUsize::new(0);
        let id = MEMORY_DB_ID.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:schaltwerk_mem_{id}?mode=memory&cache=shared");
        Self {
            config: SqliteConfig::Memory(uri),
        }
    }

    fn configure(&self, conn: &Connection) -> rusqlite::Result<()> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        if matches!(self.config, SqliteConfig::File(_)) {
            if let Err(err) = conn.pragma_update(None, "journal_mode", "WAL") {
                log::warn!("Failed to enable WAL journal mode: {err}");
            }
        }

        conn.busy_timeout(Duration::from_millis(5_000))?;
        Ok(())
    }
}

impl ManageConnection for SqliteConnectionManager {
    type Connection = Connection;
    type Error = rusqlite::Error;

    fn connect(&self) -> Result<Self::Connection, Self::Error> {
        let conn = match &self.config {
            SqliteConfig::File(path) => Connection::open(path)?,
            #[cfg(test)]
            SqliteConfig::Memory(uri) => Connection::open_with_flags(
                uri,
                OpenFlags::SQLITE_OPEN_CREATE
                    | OpenFlags::SQLITE_OPEN_READ_WRITE
                    | OpenFlags::SQLITE_OPEN_URI
                    | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
            )?,
        };

        self.configure(&conn)?;
        Ok(conn)
    }

    fn is_valid(&self, conn: &mut Self::Connection) -> Result<(), Self::Error> {
        let _: i32 = conn.query_row("SELECT 1", [], |row| row.get(0))?;
        Ok(())
    }

    fn has_broken(&self, _conn: &mut Self::Connection) -> bool {
        false
    }
}

impl Database {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let path = db_path.unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap()
                .join("schaltwerk")
                .join("sessions.db")
        });

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let pool_size = std::env::var("SCHALTWERK_DB_POOL_SIZE")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|size| *size > 0)
            .unwrap_or(DEFAULT_POOL_SIZE);

        let manager = SqliteConnectionManager::file(path.clone());

        let pool = Pool::builder()
            .max_size(pool_size)
            .build(manager)
            .context("failed to build SQLite connection pool")?;

        let db = Self {
            pool: Arc::new(pool),
        };

        db.initialize_schema()?;

        Ok(db)
    }

    pub(crate) fn get_conn(&self) -> Result<PooledConnection<SqliteConnectionManager>> {
        self.pool
            .get()
            .context("failed to borrow SQLite connection from pool")
    }

    fn initialize_schema(&self) -> Result<()> {
        db_schema::initialize_schema(self)
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self> {
        let manager = SqliteConnectionManager::memory();

        let pool = Pool::builder()
            .max_size(DEFAULT_POOL_SIZE)
            .build(manager)
            .context("failed to build in-memory SQLite pool")?;

        let db = Self {
            pool: Arc::new(pool),
        };

        db.initialize_schema()?;

        Ok(db)
    }
}

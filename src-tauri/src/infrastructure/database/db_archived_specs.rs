use anyhow::Result;
use chrono::{TimeZone, Utc};
use rusqlite::params;
use std::path::{Path, PathBuf};

use crate::domains::sessions::entity::ArchivedSpec;
use crate::schaltwerk_core::database::Database;

pub trait ArchivedSpecMethods {
    fn insert_archived_spec(&self, spec: &ArchivedSpec) -> Result<()>;
    fn list_archived_specs(&self, repo_path: &Path) -> Result<Vec<ArchivedSpec>>;
    fn delete_archived_spec(&self, id: &str) -> Result<()>;
    fn get_archive_max_entries(&self) -> Result<i32>;
    fn set_archive_max_entries(&self, limit: i32) -> Result<()>;
    fn enforce_archive_limit(&self, repo_path: &Path) -> Result<()>;
}

impl ArchivedSpecMethods for Database {
    fn insert_archived_spec(&self, spec: &ArchivedSpec) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO archived_specs (id, session_name, repository_path, repository_name, content, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                spec.id,
                spec.session_name,
                spec.repository_path.to_string_lossy(),
                spec.repository_name,
                spec.content,
                spec.archived_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    fn list_archived_specs(&self, repo_path: &Path) -> Result<Vec<ArchivedSpec>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_name, repository_path, repository_name, content, archived_at \
             FROM archived_specs \
             WHERE repository_path = ?1 \
             ORDER BY archived_at DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], |row| {
            Ok(ArchivedSpec {
                id: row.get(0)?,
                session_name: row.get(1)?,
                repository_path: PathBuf::from(row.get::<_, String>(2)?),
                repository_name: row.get(3)?,
                content: row.get(4)?,
                archived_at: {
                    let ms: i64 = row.get(5)?;
                    Utc.timestamp_millis_opt(ms).unwrap()
                },
            })
        })?;
        let mut specs = Vec::new();
        for s in rows {
            specs.push(s?);
        }
        Ok(specs)
    }

    fn delete_archived_spec(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM archived_specs WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn get_archive_max_entries(&self) -> Result<i32> {
        let conn = self.conn.lock().unwrap();
        let result: rusqlite::Result<i32> = conn.query_row(
            "SELECT archive_max_entries FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        Ok(result.unwrap_or(50))
    }

    fn set_archive_max_entries(&self, limit: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE app_config SET archive_max_entries = ?1 WHERE id = 1",
            params![limit],
        )?;
        Ok(())
    }

    fn enforce_archive_limit(&self, repo_path: &Path) -> Result<()> {
        // IMPORTANT: Avoid nested locking of self.conn by performing all queries
        // using a single connection lock and not calling other methods that also lock.
        let conn = self.conn.lock().unwrap();

        // Read configured max entries (fallback to 50 if missing)
        let max_entries: i64 = conn
            .query_row(
                "SELECT archive_max_entries FROM app_config WHERE id = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(50);

        // Count current entries for this repository
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM archived_specs WHERE repository_path = ?1",
            params![repo_path.to_string_lossy()],
            |row| row.get(0),
        )?;

        if count > max_entries {
            // Delete oldest entries beyond the limit
            let to_delete = count - max_entries;
            conn.execute(
                "DELETE FROM archived_specs \
                 WHERE id IN (
                   SELECT id FROM archived_specs \
                   WHERE repository_path = ?1 \
                   ORDER BY archived_at ASC \
                   LIMIT ?2
                 )",
                params![repo_path.to_string_lossy(), to_delete],
            )?;
        }

        Ok(())
    }
}

use super::connection::Database;
use crate::domains::sessions::entity::Epic;
use anyhow::Result;
use chrono::Utc;
use rusqlite::{Row, params};
use std::path::Path;

pub trait EpicMethods {
    fn create_epic(&self, repo_path: &Path, epic: &Epic) -> Result<()>;
    fn list_epics(&self, repo_path: &Path) -> Result<Vec<Epic>>;
    fn get_epic_by_id(&self, repo_path: &Path, id: &str) -> Result<Epic>;
    fn get_epic_by_name(&self, repo_path: &Path, name: &str) -> Result<Epic>;
    fn update_epic(&self, repo_path: &Path, id: &str, name: &str, color: Option<&str>)
    -> Result<()>;
    fn clear_epic_assignments(&self, repo_path: &Path, id: &str) -> Result<()>;
    fn delete_epic(&self, repo_path: &Path, id: &str) -> Result<()>;
}

impl EpicMethods for Database {
    fn create_epic(&self, repo_path: &Path, epic: &Epic) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO epics (id, repository_path, name, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                epic.id,
                repo_path.to_string_lossy(),
                epic.name,
                epic.color,
                now,
                now,
            ],
        )?;
        Ok(())
    }

    fn list_epics(&self, repo_path: &Path) -> Result<Vec<Epic>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1
             ORDER BY name ASC, updated_at DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], row_to_epic)?;
        let mut epics = Vec::new();
        for row in rows {
            epics.push(row?);
        }
        Ok(epics)
    }

    fn get_epic_by_id(&self, repo_path: &Path, id: &str) -> Result<Epic> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1 AND id = ?2",
        )?;
        Ok(stmt.query_row(params![repo_path.to_string_lossy(), id], row_to_epic)?)
    }

    fn get_epic_by_name(&self, repo_path: &Path, name: &str) -> Result<Epic> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1 AND name = ?2",
        )?;
        Ok(stmt.query_row(params![repo_path.to_string_lossy(), name], row_to_epic)?)
    }

    fn update_epic(
        &self,
        repo_path: &Path,
        id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE epics
             SET name = ?1, color = ?2, updated_at = ?3
             WHERE repository_path = ?4 AND id = ?5",
            params![name, color, Utc::now().timestamp(), repo_path.to_string_lossy(), id],
        )?;
        Ok(())
    }

    fn clear_epic_assignments(&self, repo_path: &Path, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET epic_id = NULL, updated_at = ?1 WHERE repository_path = ?2 AND epic_id = ?3",
            params![Utc::now().timestamp(), repo_path.to_string_lossy(), id],
        )?;
        conn.execute(
            "UPDATE specs SET epic_id = NULL, updated_at = ?1 WHERE repository_path = ?2 AND epic_id = ?3",
            params![Utc::now().timestamp(), repo_path.to_string_lossy(), id],
        )?;
        Ok(())
    }

    fn delete_epic(&self, repo_path: &Path, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM epics WHERE repository_path = ?1 AND id = ?2",
            params![repo_path.to_string_lossy(), id],
        )?;
        Ok(())
    }
}

fn row_to_epic(row: &Row<'_>) -> rusqlite::Result<Epic> {
    Ok(Epic {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
    })
}

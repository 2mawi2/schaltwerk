use super::connection::Database;
use crate::domains::sessions::entity::Spec;
use anyhow::Result;
use chrono::{TimeZone, Utc};
use rusqlite::{Row, params};
use std::path::{Path, PathBuf};

pub trait SpecMethods {
    fn create_spec(&self, spec: &Spec) -> Result<()>;
    fn get_spec_by_name(&self, repo_path: &Path, name: &str) -> Result<Spec>;
    fn get_spec_by_id(&self, id: &str) -> Result<Spec>;
    fn list_specs(&self, repo_path: &Path) -> Result<Vec<Spec>>;
    fn update_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()>;
    fn update_spec_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()>;
    fn delete_spec(&self, id: &str) -> Result<()>;
}

impl SpecMethods for Database {
    fn create_spec(&self, spec: &Spec) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO specs (
                id, name, display_name,
                epic_id,
                repository_path, repository_name, content,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                spec.id,
                spec.name,
                spec.display_name,
                spec.epic_id,
                spec.repository_path.to_string_lossy(),
                spec.repository_name,
                spec.content,
                spec.created_at.timestamp(),
                spec.updated_at.timestamp(),
            ],
        )?;
        Ok(())
    }

    fn get_spec_by_name(&self, repo_path: &Path, name: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let repo_str = repo_path.to_string_lossy();
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id,
                    repository_path, repository_name, content,
                    created_at, updated_at
             FROM specs
             WHERE repository_path = ?1 AND name = ?2",
        )?;

        let spec = stmt.query_row(params![repo_str, name], row_to_spec)?;
        Ok(spec)
    }

    fn get_spec_by_id(&self, id: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id,
                    repository_path, repository_name, content,
                    created_at, updated_at
             FROM specs
             WHERE id = ?1",
        )?;
        let spec = stmt.query_row(params![id], row_to_spec)?;
        Ok(spec)
    }

    fn list_specs(&self, repo_path: &Path) -> Result<Vec<Spec>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id,
                    repository_path, repository_name, content,
                    created_at, updated_at
             FROM specs
             WHERE repository_path = ?1
             ORDER BY updated_at DESC, created_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], row_to_spec)?;
        let mut specs = Vec::new();
        for row in rows {
            specs.push(row?);
        }
        Ok(specs)
    }

    fn update_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET display_name = ?1, updated_at = ?2
             WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET epic_id = ?1, updated_at = ?2
             WHERE id = ?3",
            params![epic_id, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn delete_spec(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM specs WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn row_to_spec(row: &Row<'_>) -> rusqlite::Result<Spec> {
    Ok(Spec {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        epic_id: row.get(3)?,
        repository_path: PathBuf::from(row.get::<_, String>(4)?),
        repository_name: row.get(5)?,
        content: row.get(6)?,
        created_at: {
            let ts: i64 = row.get(7)?;
            Utc.timestamp_opt(ts, 0).unwrap()
        },
        updated_at: {
            let ts: i64 = row.get(8)?;
            Utc.timestamp_opt(ts, 0).unwrap()
        },
    })
}

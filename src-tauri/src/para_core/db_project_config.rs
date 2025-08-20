use rusqlite::params;
use std::path::Path;
use anyhow::Result;
use chrono::Utc;
use crate::para_core::database::Database;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSelection {
    pub kind: String,
    pub payload: Option<String>,
}

pub trait ProjectConfigMethods {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>>;
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()>;
    fn get_project_selection(&self, repo_path: &Path) -> Result<Option<ProjectSelection>>;
    fn set_project_selection(&self, repo_path: &Path, selection: &ProjectSelection) -> Result<()>;
}

impl ProjectConfigMethods for Database {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT setup_script FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );
        
        match result {
            Ok(script) => Ok(Some(script)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        conn.execute(
            "INSERT INTO project_config (repository_path, setup_script, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(repository_path) DO UPDATE SET 
                setup_script = excluded.setup_script,
                updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), setup_script, now, now],
        )?;
        
        Ok(())
    }
    
    fn get_project_selection(&self, repo_path: &Path) -> Result<Option<ProjectSelection>> {
        let conn = self.conn.lock().unwrap();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        let result: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
            "SELECT last_selection_kind, last_selection_payload FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        match result {
            Ok((Some(kind), payload)) => Ok(Some(ProjectSelection { kind, payload })),
            Ok((None, _)) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    fn set_project_selection(&self, repo_path: &Path, selection: &ProjectSelection) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();
        
        // Canonicalize the path for consistent storage/retrieval
        let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        
        conn.execute(
            "INSERT INTO project_config (repository_path, last_selection_kind, last_selection_payload, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(repository_path) DO UPDATE SET 
                last_selection_kind = excluded.last_selection_kind,
                last_selection_payload = excluded.last_selection_payload,
                updated_at = excluded.updated_at",
            params![
                canonical_path.to_string_lossy(), 
                selection.kind,
                selection.payload,
                now, 
                now
            ],
        )?;
        
        Ok(())
    }
}
pub mod database;
pub mod db_schema;
pub mod db_sessions;
pub mod db_git_stats;
pub mod db_app_config;
pub mod db_project_config;
pub mod git;
// pub mod mcp;  // Temporarily disabled - will be used for MCP server later
pub mod session;
pub mod activity;
pub mod types;
pub mod claude;
pub mod cursor;
pub mod opencode;
pub mod gemini;
pub mod codex;
pub mod naming;
#[cfg(test)]
mod tests;

pub use database::Database;
pub use session::SessionManager;
pub use types::{Session, SessionState, EnrichedSession};

use std::path::PathBuf;
use anyhow::Result;

pub struct SchaltwerkCore {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl SchaltwerkCore {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let repo_path = git::discover_repository()?;
        let db = Database::new(db_path)?;
        log::warn!("Using SchaltwerkCore::new() - should use new_with_repo_path() instead");
        
        Ok(Self {
            db,
            repo_path,
        })
    }
    
    pub fn new_with_repo_path(db_path: Option<PathBuf>, repo_path: PathBuf) -> Result<Self> {
        log::info!("Creating SchaltwerkCore with explicit repo path: {}", repo_path.display());
        let db = Database::new(db_path)?;
        
        Ok(Self {
            db,
            repo_path,
        })
    }
    
    pub fn session_manager(&self) -> SessionManager {
        SessionManager::new(self.db.clone(), self.repo_path.clone())
    }
    
    pub fn database(&self) -> &Database {
        &self.db
    }
}
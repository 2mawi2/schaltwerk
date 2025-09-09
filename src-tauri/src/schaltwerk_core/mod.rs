pub mod database;
pub mod db_schema;
pub mod db_git_stats;
pub mod db_app_config;
pub mod db_project_config;
pub mod db_archived_specs;
// pub mod mcp;  // Temporarily disabled - will be used for MCP server later
pub mod session_db;
pub mod session_cache;
pub mod session_utils;
pub mod types;
// Re-export agent modules from domains for backward compatibility
pub mod agents {
    pub use crate::domains::agents::*;
}

// Agent modules are now re-exported from domains/agents
#[cfg(test)]
mod tests;
#[cfg(test)]
mod session_sorting;

pub use database::Database;
pub use crate::domains::sessions::service::SessionManager;
pub use types::{SessionState, EnrichedSession};

use std::path::PathBuf;
use anyhow::Result;
use crate::domains::git;

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
    
    #[cfg(test)]
    pub fn new_in_memory_with_repo_path(repo_path: PathBuf) -> Result<Self> {
        let db = Database::new_in_memory()?;
        
        Ok(Self {
            db,
            repo_path,
        })
    }
}

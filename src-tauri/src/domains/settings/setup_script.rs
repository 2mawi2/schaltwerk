use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

use crate::infrastructure::database::{Database, ProjectConfigMethods};

/// Thin domain service that owns persistence for project setup scripts.
/// Keeps mcp_api free of database plumbing so the logic is reusable elsewhere.
pub struct SetupScriptService {
    db: Database,
    repo_path: PathBuf,
}

impl SetupScriptService {
    pub fn new(db: Database, repo_path: impl AsRef<Path>) -> Self {
        Self {
            db,
            repo_path: repo_path.as_ref().to_path_buf(),
        }
    }

    pub fn get(&self) -> Result<Option<String>> {
        self.db
            .get_project_setup_script(&self.repo_path)
            .map_err(|e| anyhow!("Failed to get project setup script: {e}"))
    }

    pub fn set(&self, setup_script: &str) -> Result<()> {
        self.db
            .set_project_setup_script(&self.repo_path, setup_script)
            .map_err(|e| anyhow!("Failed to set project setup script: {e}"))
    }
}

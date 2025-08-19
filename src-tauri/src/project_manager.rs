use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use anyhow::{Result, anyhow};
use log::{info, debug, warn};
use sha2::{Sha256, Digest};

use crate::terminal::TerminalManager;
use crate::para_core::SchaltwerkCore;

/// Represents a single project with its own terminals and sessions
pub struct Project {
    pub path: PathBuf,
    pub terminal_manager: Arc<TerminalManager>,
    pub para_core: Arc<Mutex<SchaltwerkCore>>,
}

impl Project {
    pub fn new(path: PathBuf) -> Result<Self> {
        info!("Creating new project for path: {}", path.display());
        
        // Each project gets its own terminal manager
        let terminal_manager = Arc::new(TerminalManager::new());
        
        // Get the global app data directory for project databases
        let db_path = Self::get_project_db_path(&path)?;
        
        // Create project data directory if it doesn't exist
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        info!("Using database at: {}", db_path.display());
        
        let para_core = Arc::new(Mutex::new(
            SchaltwerkCore::new_with_repo_path(Some(db_path), path.clone())?
        ));
        
        Ok(Self {
            path,
            terminal_manager,
            para_core,
        })
    }
    
    /// Get the database path for a project in the global app data directory
    fn get_project_db_path(project_path: &PathBuf) -> Result<PathBuf> {
        // Get the app data directory (same location as settings)
        let data_dir = dirs::data_dir()
            .ok_or_else(|| anyhow!("Failed to get app data directory"))?;
        
        // Create a unique folder name for this project using a hash
        // This ensures uniqueness even for projects with the same name in different locations
        let canonical_path = std::fs::canonicalize(project_path)?;
        let path_str = canonical_path.to_string_lossy();
        
        // Create a hash of the full path
        let mut hasher = Sha256::new();
        hasher.update(path_str.as_bytes());
        let hash_result = hasher.finalize();
        let hash_hex = format!("{hash_result:x}");
        
        // Take first 16 characters of hash for a shorter but still unique identifier
        let hash_short = &hash_hex[..16];
        
        // Get the project name for readability
        let project_name = canonical_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        
        // Create a folder name that combines project name and hash for both readability and uniqueness
        // Format: "projectname_hash"
        let folder_name = format!("{}_{}", 
            project_name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_"),
            hash_short
        );
        
        // Build the full path: ~/.local/share/schaltwerk/projects/{projectname_hash}/sessions.db
        let project_data_dir = data_dir
            .join("schaltwerk")
            .join("projects")
            .join(folder_name);
        
        Ok(project_data_dir.join("sessions.db"))
    }
}

/// Manages multiple projects and their resources
pub struct ProjectManager {
    projects: Arc<RwLock<HashMap<PathBuf, Arc<Project>>>>,
    current_project: Arc<RwLock<Option<PathBuf>>>,
}

impl Default for ProjectManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectManager {
    pub fn new() -> Self {
        Self {
            projects: Arc::new(RwLock::new(HashMap::new())),
            current_project: Arc::new(RwLock::new(None)),
        }
    }
    
    /// Initialize or switch to a project
    pub async fn switch_to_project(&self, path: PathBuf) -> Result<Arc<Project>> {
        log::info!("📁 ProjectManager::switch_to_project called with: {}", path.display());
        
        // Normalize the path
        let path = match std::fs::canonicalize(&path) {
            Ok(p) => {
                log::info!("  Canonicalized path: {}", p.display());
                p
            }
            Err(e) => {
                log::error!("  ❌ Failed to canonicalize path {}: {e}", path.display());
                return Err(e.into());
            }
        };
        
        info!("Switching to project: {}", path.display());
        
        // Check if project already exists
        let mut projects = self.projects.write().await;
        
        let project = if let Some(existing) = projects.get(&path) {
            info!("♻️ Using existing project instance for: {}", path.display());
            existing.clone()
        } else {
            info!("🆕 Creating new project instance for: {}", path.display());
            let new_project = match Project::new(path.clone()) {
                Ok(p) => Arc::new(p),
                Err(e) => {
                    log::error!("❌ Failed to create project: {e}");
                    return Err(e);
                }
            };
            projects.insert(path.clone(), new_project.clone());
            new_project
        };
        
        // Update current project
        *self.current_project.write().await = Some(path.clone());
        log::info!("✅ Current project set to: {}", path.display());
        
        Ok(project)
    }
    
    /// Get the current active project
    pub async fn current_project(&self) -> Result<Arc<Project>> {
        let current_path = self.current_project.read().await;
        
        if let Some(path) = current_path.as_ref() {
            log::debug!("Current project path is set to: {}", path.display());
            let projects = self.projects.read().await;
            if let Some(project) = projects.get(path) {
                log::debug!("Found project instance for: {}", path.display());
                return Ok(project.clone());
            } else {
                log::error!("❌ Current project path is set but no project instance found: {}", path.display());
            }
        } else {
            log::warn!("⚠️ No current project path set");
        }
        
        Err(anyhow!("No active project"))
    }
    
    /// Clean up all projects (called on app exit)
    pub async fn cleanup_all(&self) {
        info!("Cleaning up all projects");
        
        let projects = self.projects.read().await;
        for (path, project) in projects.iter() {
            debug!("Cleaning up project: {}", path.display());
            
            // Clean up all terminals for this project
            if let Err(e) = project.terminal_manager.cleanup_all().await {
                warn!("Failed to cleanup terminals for project {}: {}", path.display(), e);
            }
        }
    }
    
    /// Get terminal manager for current project
    pub async fn current_terminal_manager(&self) -> Result<Arc<TerminalManager>> {
        let project = self.current_project().await?;
        Ok(project.terminal_manager.clone())
    }
    
    /// Get SchaltwerkCore for current project
    pub async fn current_para_core(&self) -> Result<Arc<Mutex<SchaltwerkCore>>> {
        let project = self.current_project().await?;
        Ok(project.para_core.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_switch_to_project_sets_current_and_reuses_instance() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let p1 = mgr.switch_to_project(path.clone()).await.unwrap();
        // Switching again to the same canonicalized path should reuse the same Arc
        let p2 = mgr.switch_to_project(path.clone()).await.unwrap();

        assert!(Arc::ptr_eq(&p1, &p2));

        let current = mgr.current_project().await.unwrap();
        assert!(Arc::ptr_eq(&p1, &current));
    }

    #[tokio::test]
    async fn test_cleanup_all_when_no_terminals() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();

        let _ = mgr.switch_to_project(tmp1.path().to_path_buf()).await.unwrap();
        let _ = mgr.switch_to_project(tmp2.path().to_path_buf()).await.unwrap();

        // Should not error even if there are no active terminals
        mgr.cleanup_all().await;
    }

    #[test]
    fn test_get_project_db_path_is_unique_and_sanitized() {
        let base = TempDir::new().unwrap();
        let p1 = base.path().join("my project !@#");
        let p2 = base.path().join("my project !@#").join("nested").join("..").join("my project !@#");
        std::fs::create_dir_all(&p1).unwrap();
        std::fs::create_dir_all(&p2).unwrap();

        let db1 = Project::get_project_db_path(&p1).unwrap();
        let db2 = Project::get_project_db_path(&p2).unwrap();

        // Same leaf name but different canonical path => different db paths
        assert_ne!(db1, db2);

        // Folder name should contain sanitized project name and an underscore
        let folder1 = db1.parent().unwrap().file_name().unwrap().to_string_lossy().to_string();
        assert!(folder1.contains("my_project___"));
        assert!(folder1.contains("_"));
        // Should end with sessions.db
        assert_eq!(db1.file_name().unwrap(), "sessions.db");
    }
}
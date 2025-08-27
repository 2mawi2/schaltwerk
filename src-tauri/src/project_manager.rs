use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use anyhow::{Result, anyhow};
use log::{info, debug, warn};
use sha2::{Sha256, Digest};

use crate::terminal::TerminalManager;
use crate::schaltwerk_core::SchaltwerkCore;

/// Represents a single project with its own terminals and sessions
pub struct Project {
    pub path: PathBuf,
    pub terminal_manager: Arc<TerminalManager>,
    pub schaltwerk_core: Arc<Mutex<SchaltwerkCore>>,
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
        
        let schaltwerk_core = Arc::new(Mutex::new(
            SchaltwerkCore::new_with_repo_path(Some(db_path), path.clone())?
        ));
        
        Ok(Self {
            path,
            terminal_manager,
            schaltwerk_core,
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
    
    #[cfg(test)]
    pub fn new_in_memory(path: PathBuf) -> Result<Self> {
        // Each project gets its own terminal manager
        let terminal_manager = Arc::new(TerminalManager::new());
        
        // Use in-memory database for tests
        let schaltwerk_core = Arc::new(Mutex::new(
            SchaltwerkCore::new_in_memory_with_repo_path(path.clone())?
        ));
        
        Ok(Self {
            path,
            terminal_manager,
            schaltwerk_core,
        })
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
        
        // Ensure .schaltwerk is excluded from git
        if let Err(e) = Self::ensure_schaltwerk_excluded(&path) {
            log::warn!("Failed to ensure .schaltwerk exclusion: {e}");
        }

        // Update current project
        *self.current_project.write().await = Some(path.clone());
        log::info!("✅ Current project set to: {}", path.display());
        
        Ok(project)
    }
    
    /// Ensures .schaltwerk folder is excluded from git using .git/info/exclude
    fn ensure_schaltwerk_excluded(project_path: &Path) -> Result<()> {
        let git_dir = project_path.join(".git");
        if !git_dir.exists() {
            return Ok(()); // Not a git repository
        }
        
        let exclude_file = git_dir.join("info").join("exclude");
        
        // Ensure the info directory exists
        if let Some(parent) = exclude_file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        // Check if .schaltwerk is already excluded
        let exclude_content = if exclude_file.exists() {
            std::fs::read_to_string(&exclude_file)?
        } else {
            String::new()
        };
        
        // Add .schaltwerk exclusion if not already present
        if !exclude_content.lines().any(|line| {
            let trimmed = line.trim();
            trimmed == ".schaltwerk" || trimmed == ".schaltwerk/" || 
            trimmed == "/.schaltwerk" || trimmed == "/.schaltwerk/"
        }) {
            let mut new_content = exclude_content;
            if !new_content.is_empty() && !new_content.ends_with('\n') {
                new_content.push('\n');
            }
            new_content.push_str(".schaltwerk/\n");
            std::fs::write(&exclude_file, new_content)?;
            log::info!("✅ Added .schaltwerk/ to {}", exclude_file.display());
        }
        
        Ok(())
    }
    
    /// Get the current active project
    pub async fn current_project(&self) -> Result<Arc<Project>> {
        let current_path = self.current_project.read().await;
        
        if let Some(path) = current_path.as_ref() {
            let projects = self.projects.read().await;
            if let Some(project) = projects.get(path) {
                return Ok(project.clone());
            } else {
                log::error!("❌ Current project path is set but no project instance found: {}", path.display());
            }
        } else {
            log::warn!("⚠️ No current project path set");
        }
        
        Err(anyhow!("No active project"))
    }

    /// Get the current active project path, if any
    pub async fn current_project_path(&self) -> Option<PathBuf> {
        let current_path = self.current_project.read().await;
        current_path.clone()
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
    pub async fn current_schaltwerk_core(&self) -> Result<Arc<Mutex<SchaltwerkCore>>> {
        let project = self.current_project().await?;
        Ok(project.schaltwerk_core.clone())
    }

    /// Get SchaltwerkCore for a specific project path
    pub async fn get_schaltwerk_core_for_path(&self, path: &PathBuf) -> Result<Arc<Mutex<SchaltwerkCore>>> {
        // Canonicalize the input path for consistent comparison
        let canonical_path = match std::fs::canonicalize(path) {
            Ok(p) => p,
            Err(_) => path.clone(), // If canonicalization fails, use as-is
        };
        
        // First check if the path matches the current project
        if let Some(current_path) = self.current_project_path().await {
            let current_canonical = std::fs::canonicalize(&current_path).unwrap_or(current_path);
            if current_canonical == canonical_path {
                return self.current_schaltwerk_core().await;
            }
            // Check if the path is inside the current project (for worktree paths)
            if canonical_path.starts_with(&current_canonical) {
                return self.current_schaltwerk_core().await;
            }
        }
        
        // Check all loaded projects
        let projects = self.projects.read().await;
        for project in projects.values() {
            let project_canonical = std::fs::canonicalize(&project.path).unwrap_or(project.path.clone());
            if project_canonical == canonical_path {
                return Ok(project.schaltwerk_core.clone());
            }
            // Check if the path is inside this project (for worktree paths)
            if canonical_path.starts_with(&project_canonical) {
                return Ok(project.schaltwerk_core.clone());
            }
        }
        
        // If project not loaded, try to load it without switching current
        drop(projects);
        
        // Load the project but don't switch to it as current
        let project = Project::new(canonical_path.clone())?;
        let arc_project = Arc::new(project);
        
        // Store it in the projects map
        let mut projects_write = self.projects.write().await;
        projects_write.insert(canonical_path.clone(), arc_project.clone());
        drop(projects_write);
        
        Ok(arc_project.schaltwerk_core.clone())
    }
    
    #[cfg(test)]
    pub async fn switch_to_project_in_memory(&self, path: PathBuf) -> Result<Arc<Project>> {
        // Normalize the path
        let path = match std::fs::canonicalize(&path) {
            Ok(p) => p,
            Err(e) => return Err(e.into()),
        };
        
        // Check if project already exists
        let mut projects = self.projects.write().await;
        
        let project = if let Some(existing) = projects.get(&path) {
            existing.clone()
        } else {
            let new_project = Arc::new(Project::new_in_memory(path.clone())?);
            projects.insert(path.clone(), new_project.clone());
            new_project
        };
        
        // Update current project
        *self.current_project.write().await = Some(path.clone());
        
        Ok(project)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;

    // Test Project creation and initialization
    #[tokio::test]
    async fn test_project_creation_valid_path() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let project = Project::new_in_memory(path.clone()).unwrap();

        assert_eq!(project.path, path);
        assert!(project.terminal_manager.get_all_terminal_activity().await.is_empty());
        assert!(project.schaltwerk_core.try_lock().is_ok()); // Should be accessible
    }

    #[tokio::test]
    async fn test_project_creation_with_real_db() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        // This will create actual database files
        let project = Project::new(path.clone()).unwrap();

        assert_eq!(project.path, path);

        // Check that database directory was created
        let db_path = Project::get_project_db_path(&path).unwrap();
        assert!(db_path.parent().unwrap().exists());
        assert!(db_path.exists());
    }

    #[test]
    fn test_project_creation_invalid_path() {
        let invalid_path = PathBuf::from("/nonexistent/path/that/does/not/exist");

        // Should fail because path doesn't exist and we can't canonicalize it
        let result = Project::new(invalid_path);
        assert!(result.is_err());
    }

    // Test database path generation
    #[test]
    fn test_get_project_db_path_unique_and_sanitized() {
        let base = TempDir::new().unwrap();
        let p1 = base.path().join("my project !@#");
        let p2 = base.path().join("my project !@#").join("nested").join("..").join("my project !@#");
        fs::create_dir_all(&p1).unwrap();
        fs::create_dir_all(&p2).unwrap();

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

    #[test]
    fn test_get_project_db_path_canonicalization() {
        let base = TempDir::new().unwrap();
        let real_path = base.path().join("test_project");
        fs::create_dir_all(&real_path).unwrap();

        // Create a symlink
        let link_path = base.path().join("link_to_project");
        std::os::unix::fs::symlink(&real_path, &link_path).unwrap();

        let db_real = Project::get_project_db_path(&real_path).unwrap();
        let db_link = Project::get_project_db_path(&link_path).unwrap();

        // Both should resolve to the same canonical path and thus same DB path
        assert_eq!(db_real, db_link);
    }

    #[test]
    fn test_get_project_db_path_relative_paths() {
        let base = TempDir::new().unwrap();
        let abs_path = base.path().join("test_project");
        fs::create_dir_all(&abs_path).unwrap();

        // Test with relative path
        let cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(&base).unwrap();

        let rel_path = PathBuf::from("test_project");
        let db_rel = Project::get_project_db_path(&rel_path).unwrap();

        let db_abs = Project::get_project_db_path(&abs_path).unwrap();

        // Should be the same after canonicalization
        assert_eq!(db_rel, db_abs);

        // Restore original cwd
        std::env::set_current_dir(cwd).unwrap();
    }

    // Test project switching
    #[tokio::test]
    async fn test_switch_to_project_sets_current_and_reuses_instance() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let p1 = mgr.switch_to_project_in_memory(path.clone()).await.unwrap();
        // Switching again to the same canonicalized path should reuse the same Arc
        let p2 = mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        assert!(Arc::ptr_eq(&p1, &p2));

        let current = mgr.current_project().await.unwrap();
        assert!(Arc::ptr_eq(&p1, &current));
    }

    #[tokio::test]
    async fn test_switch_to_project_invalid_path() {
        let mgr = ProjectManager::new();
        let invalid_path = PathBuf::from("/nonexistent/path");

        let result = mgr.switch_to_project(invalid_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_switch_to_project_creates_project() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let project = mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        // Verify project was created and stored
        let canonical_path = std::fs::canonicalize(&path).unwrap_or(path.clone());
        let projects = mgr.projects.read().await;
        assert!(projects.contains_key(&canonical_path));
        assert!(Arc::ptr_eq(&project, &projects[&canonical_path]));
    }

    // Test state management
    #[tokio::test]
    async fn test_current_project_none_when_not_set() {
        let mgr = ProjectManager::new();

        let result = mgr.current_project().await;
        assert!(result.is_err());
        match result {
            Err(e) => {
                let err_string = format!("{}", e);
                assert!(err_string.contains("No active project"));
            }
            Ok(_) => panic!("Expected error but got success"),
        }
    }

    #[tokio::test]
    async fn test_current_project_path_none_when_not_set() {
        let mgr = ProjectManager::new();

        let path = mgr.current_project_path().await;
        assert!(path.is_none());
    }

    #[tokio::test]
    async fn test_current_project_after_switching() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        let current_path = mgr.current_project_path().await.unwrap();
        let canonical_path = std::fs::canonicalize(&path).unwrap_or(path.clone());
        assert_eq!(current_path, canonical_path);

        let current_project = mgr.current_project().await.unwrap();
        assert_eq!(current_project.path, canonical_path);
    }

    // Test multiple projects
    #[tokio::test]
    async fn test_multiple_projects_simultaneously() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();
        let path1 = tmp1.path().to_path_buf();
        let path2 = tmp2.path().to_path_buf();

        let project1 = mgr.switch_to_project_in_memory(path1.clone()).await.unwrap();
        let project2 = mgr.switch_to_project_in_memory(path2.clone()).await.unwrap();

        // Should be different projects
        assert!(!Arc::ptr_eq(&project1, &project2));
        assert_ne!(project1.path, project2.path);

        // Both should be in the projects map
        let canonical_path1 = std::fs::canonicalize(&path1).unwrap_or(path1.clone());
        let canonical_path2 = std::fs::canonicalize(&path2).unwrap_or(path2.clone());
        let projects = mgr.projects.read().await;
        assert!(projects.contains_key(&canonical_path1));
        assert!(projects.contains_key(&canonical_path2));
        assert_eq!(projects.len(), 2);
    }

    // Test path validation
    #[tokio::test]
    async fn test_switch_to_project_with_symlink() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let real_path = tmp.path().join("real_project");
        fs::create_dir_all(&real_path).unwrap();

        // Create symlink
        let link_path = tmp.path().join("link_project");
        std::os::unix::fs::symlink(&real_path, &link_path).unwrap();

        let project1 = mgr.switch_to_project_in_memory(real_path.clone()).await.unwrap();
        let project2 = mgr.switch_to_project_in_memory(link_path.clone()).await.unwrap();

        // Should reuse the same project due to canonicalization
        assert!(Arc::ptr_eq(&project1, &project2));
    }

    #[tokio::test]
    async fn test_switch_to_project_relative_path() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let abs_path = tmp.path().join("test_project");
        fs::create_dir_all(&abs_path).unwrap();

        // Change to temp directory and use relative path
        let cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(&tmp).unwrap();

        let rel_path = PathBuf::from("test_project");
        let project = mgr.switch_to_project_in_memory(rel_path).await.unwrap();

        // Should have canonicalized to absolute path
        let canonical_abs_path = std::fs::canonicalize(&abs_path).unwrap_or(abs_path);
        assert_eq!(project.path, canonical_abs_path);

        // Restore original cwd
        std::env::set_current_dir(cwd).unwrap();
    }

    // Test config persistence
    #[tokio::test]
    async fn test_project_database_directory_creation() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        // Create project with real database
        let _project = Project::new(path.clone()).unwrap();

        let db_path = Project::get_project_db_path(&path).unwrap();

        // Database directory should exist
        assert!(db_path.parent().unwrap().exists());
        // Database file should exist
        assert!(db_path.exists());
        // Database file should not be empty (SQLite header)
        let metadata = fs::metadata(&db_path).unwrap();
        assert!(metadata.len() > 0);
    }

    #[tokio::test]
    async fn test_project_database_path_structure() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let db_path = Project::get_project_db_path(&path).unwrap();

        // Should be in app data directory
        let app_data = dirs::data_dir().unwrap();
        assert!(db_path.starts_with(app_data));

        // Should contain schaltwerk/projects in path
        let path_str = db_path.to_string_lossy();
        assert!(path_str.contains("schaltwerk"));
        assert!(path_str.contains("projects"));

        // Should end with sessions.db
        assert!(path_str.ends_with("sessions.db"));
    }

    // Test error scenarios
    #[tokio::test]
    async fn test_project_creation_permission_denied() {
        // Create a directory and remove write permissions
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("no_write_project");
        fs::create_dir_all(&project_path).unwrap();

        // Remove write permissions from parent directory
        let mut perms = fs::metadata(&tmp).unwrap().permissions();
        perms.set_mode(0o444); // Read only
        fs::set_permissions(&tmp, perms).unwrap();

        // This should fail when trying to create database directory
        let result = Project::new(project_path);
        assert!(result.is_err());

        // Restore permissions for cleanup
        let mut perms = fs::metadata(&tmp).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp, perms).unwrap();
    }

    #[tokio::test]
    async fn test_switch_to_project_after_project_removal() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        // Create project
        mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        // Remove project from map (simulate cleanup) using canonicalized path
        let canonical_path = std::fs::canonicalize(&path).unwrap_or(path.clone());
        {
            let mut projects = mgr.projects.write().await;
            projects.remove(&canonical_path);
        }

        // Current project path is still set but project is gone
        let current_path = mgr.current_project_path().await.unwrap();
        assert_eq!(current_path, canonical_path);

        // current_project() should fail
        let result = mgr.current_project().await;
        assert!(result.is_err());
        // Check that it's the expected error by trying to match the error string
        match result {
            Err(e) => {
                let err_string = format!("{}", e);
                assert!(err_string.contains("No active project"));
            }
            Ok(_) => panic!("Expected error but got success"),
        }
    }

    // Test concurrent access
    #[tokio::test]
    async fn test_concurrent_project_switching() {
        let mgr = Arc::new(ProjectManager::new());
        let tmp = TempDir::new().unwrap();
        let base_path = tmp.path().to_path_buf();

        let mut handles = vec![];

        // Spawn multiple tasks trying to switch to projects concurrently
        for i in 0..5 {
            let mgr_clone = mgr.clone();
            let path = base_path.join(format!("project_{}", i));

            let handle = tokio::spawn(async move {
                fs::create_dir_all(&path).unwrap();
                mgr_clone.switch_to_project_in_memory(path).await
            });

            handles.push(handle);
        }

        // Wait for all to complete
        for handle in handles {
            let result = handle.await.unwrap();
            assert!(result.is_ok());
        }

        // Should have 5 projects
        let projects = mgr.projects.read().await;
        assert_eq!(projects.len(), 5);
    }

    #[tokio::test]
    async fn test_concurrent_current_project_access() {
        let mgr = Arc::new(ProjectManager::new());
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        mgr.switch_to_project_in_memory(path).await.unwrap();

        let mut handles = vec![];

        // Spawn multiple tasks accessing current project
        for _ in 0..10 {
            let mgr_clone = mgr.clone();
            let handle = tokio::spawn(async move {
                mgr_clone.current_project().await
            });
            handles.push(handle);
        }

        // All should succeed
        for handle in handles {
            let result = handle.await.unwrap();
            assert!(result.is_ok());
        }
    }

    // Test cleanup functionality
    #[tokio::test]
    async fn test_cleanup_all_when_no_terminals() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();

        let _ = mgr.switch_to_project_in_memory(tmp1.path().to_path_buf()).await.unwrap();
        let _ = mgr.switch_to_project_in_memory(tmp2.path().to_path_buf()).await.unwrap();

        // Should not error even if there are no active terminals
        mgr.cleanup_all().await;

        // Projects should still exist (cleanup doesn't remove them)
        let projects = mgr.projects.read().await;
        assert_eq!(projects.len(), 2);
    }

    #[tokio::test]
    async fn test_cleanup_all_with_terminals() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        let project = mgr.switch_to_project_in_memory(path).await.unwrap();

        // Create a terminal
        let terminal_id = "test-terminal";
        project.terminal_manager.create_terminal(terminal_id.to_string(), "/tmp".to_string()).await.unwrap();

        // Verify terminal exists
        let active_terminals = project.terminal_manager.get_all_terminal_activity().await;
        assert!(active_terminals.iter().any(|(id, _, _)| id == terminal_id));

        // Cleanup should work
        mgr.cleanup_all().await;

        // Terminal should be cleaned up
        let active_terminals = project.terminal_manager.get_all_terminal_activity().await;
        assert!(!active_terminals.iter().any(|(id, _, _)| id == terminal_id));
    }

    // Test git exclusion
    #[test]
    fn test_ensure_schaltwerk_excluded_creates_exclude_file() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("git_project");
        fs::create_dir_all(&project_path).unwrap();

        // Initialize git repo
        std::process::Command::new("git")
            .args(&["init"])
            .current_dir(&project_path)
            .output()
            .unwrap();

        // Ensure exclusion
        ProjectManager::ensure_schaltwerk_excluded(&project_path).unwrap();

        let exclude_file = project_path.join(".git").join("info").join("exclude");
        assert!(exclude_file.exists());

        let content = fs::read_to_string(&exclude_file).unwrap();
        assert!(content.contains(".schaltwerk/"));
    }

    #[test]
    fn test_ensure_schaltwerk_excluded_preserves_existing() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("git_project");
        fs::create_dir_all(&project_path).unwrap();

        // Initialize git repo
        std::process::Command::new("git")
            .args(&["init"])
            .current_dir(&project_path)
            .output()
            .unwrap();

        // Create exclude file with existing content
        let exclude_file = project_path.join(".git").join("info").join("exclude");
        fs::create_dir_all(exclude_file.parent().unwrap()).unwrap();
        fs::write(&exclude_file, "existing/pattern\n").unwrap();

        // Ensure exclusion
        ProjectManager::ensure_schaltwerk_excluded(&project_path).unwrap();

        let content = fs::read_to_string(&exclude_file).unwrap();
        assert!(content.contains("existing/pattern"));
        assert!(content.contains(".schaltwerk/"));
    }

    #[test]
    fn test_ensure_schaltwerk_excluded_non_git_directory() {
        let tmp = TempDir::new().unwrap();
        let project_path = tmp.path().join("non_git_project");
        fs::create_dir_all(&project_path).unwrap();

        // Should not error for non-git directories
        let result = ProjectManager::ensure_schaltwerk_excluded(&project_path);
        assert!(result.is_ok());
    }

    // Test SchaltwerkCore integration
    #[tokio::test]
    async fn test_current_terminal_manager() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        mgr.switch_to_project_in_memory(path).await.unwrap();

        let terminal_manager = mgr.current_terminal_manager().await.unwrap();
        // Should be able to create a terminal
        terminal_manager.create_terminal("test".to_string(), "/tmp".to_string()).await.unwrap();
    }

    #[tokio::test]
    async fn test_current_schaltwerk_core() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        let core = mgr.current_schaltwerk_core().await.unwrap();
        let canonical_path = std::fs::canonicalize(&path).unwrap_or(path);
        assert_eq!(core.lock().await.repo_path, canonical_path);
    }

    #[tokio::test]
    async fn test_get_schaltwerk_core_for_path_current_project() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();

        mgr.switch_to_project_in_memory(path.clone()).await.unwrap();

        let core = mgr.get_schaltwerk_core_for_path(&path).await.unwrap();
        let canonical_path = std::fs::canonicalize(&path).unwrap_or(path);
        assert_eq!(core.lock().await.repo_path, canonical_path);
    }

    #[tokio::test]
    async fn test_switching_between_multiple_projects() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();
        let tmp3 = TempDir::new().unwrap();
        let path1 = tmp1.path().to_path_buf();
        let path2 = tmp2.path().to_path_buf();
        let path3 = tmp3.path().to_path_buf();

        // Create all projects
        let p1 = mgr.switch_to_project_in_memory(path1.clone()).await.unwrap();
        let _p2 = mgr.switch_to_project_in_memory(path2.clone()).await.unwrap();
        let p3 = mgr.switch_to_project_in_memory(path3.clone()).await.unwrap();

        // Switch back to p1
        let current = mgr.switch_to_project_in_memory(path1.clone()).await.unwrap();
        assert!(Arc::ptr_eq(&p1, &current));

        let current_project = mgr.current_project().await.unwrap();
        assert!(Arc::ptr_eq(&p1, &current_project));

        // Switch to p3
        let current = mgr.switch_to_project_in_memory(path3.clone()).await.unwrap();
        assert!(Arc::ptr_eq(&p3, &current));

        let current_project = mgr.current_project().await.unwrap();
        assert!(Arc::ptr_eq(&p3, &current_project));
    }

    #[tokio::test]
    async fn test_get_schaltwerk_core_for_path_worktree() {
        let mgr = ProjectManager::new();
        let tmp = TempDir::new().unwrap();
        let main_path = tmp.path().join("main");
        let worktree_path = tmp.path().join("worktree");

        fs::create_dir_all(&main_path).unwrap();
        fs::create_dir_all(&worktree_path).unwrap();

        mgr.switch_to_project_in_memory(main_path.clone()).await.unwrap();

        // Worktree path is separate from main, so it should create its own project
        let core = mgr.get_schaltwerk_core_for_path(&worktree_path).await.unwrap();
        let canonical_worktree_path = std::fs::canonicalize(&worktree_path).unwrap_or(worktree_path);
        assert_eq!(core.lock().await.repo_path, canonical_worktree_path);
    }

    // Test project manager creation
    #[test]
    fn test_project_manager_new() {
        let mgr = ProjectManager::new();

        // Should start with no projects
        assert!(mgr.projects.try_read().is_ok());
        assert!(mgr.current_project.try_read().is_ok());
    }

    #[test]
    fn test_project_manager_default() {
        let mgr = ProjectManager::default();

        // Should be same as new()
        assert!(mgr.projects.try_read().is_ok());
        assert!(mgr.current_project.try_read().is_ok());
    }
}
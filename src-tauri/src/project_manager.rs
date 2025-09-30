use anyhow::{anyhow, Result};
use futures::future::join_all;
use log::{debug, info, warn};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use schaltwerk::domains::sessions::entity::{SessionState, SessionStatus};
use schaltwerk::domains::terminal::TerminalManager;
use schaltwerk::schaltwerk_core::SchaltwerkCore;

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

        let schaltwerk_core = Arc::new(Mutex::new(SchaltwerkCore::new_with_repo_path(
            Some(db_path),
            path.clone(),
        )?));

        Ok(Self {
            path,
            terminal_manager,
            schaltwerk_core,
        })
    }

    async fn cleanup_sessions(&self) -> Result<(), String> {
        info!(
            "Cleaning up sessions for project: {}",
            self.path.display()
        );

        let manager = {
            let core = self.schaltwerk_core.lock().await;
            core.session_manager()
        };

        let sessions = manager
            .list_sessions()
            .map_err(|e| format!("Failed to list sessions for {}: {e}", self.path.display()))?;

        let active_sessions: Vec<String> = sessions
            .into_iter()
            .filter(|session| {
                session.status == SessionStatus::Active
                    && session.session_state != SessionState::Spec
            })
            .map(|session| session.name)
            .collect();

        if active_sessions.is_empty() {
            debug!(
                "No active non-spec sessions to cancel for {}",
                self.path.display()
            );
            return Ok(());
        }

        let cancel_results = join_all(active_sessions.iter().map(|name| async {
            let result = manager.fast_cancel_session(name).await;
            (name.clone(), result)
        }))
        .await;

        let mut errors = Vec::new();
        for (name, result) in cancel_results {
            match result {
                Ok(()) => info!("Cancelled session {name} during cleanup"),
                Err(err) => {
                    warn!("Failed to cancel session {name} during cleanup: {err}");
                    errors.push(format!("{name}: {err}"));
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join(", "))
        }
    }

    async fn cleanup_resources(&self) -> Result<(), String> {
        let (terminal_result, session_result) =
            tokio::join!(self.terminal_manager.cleanup_all(), self.cleanup_sessions());

        let mut errors = Vec::new();

        if let Err(err) = terminal_result {
            errors.push(format!("terminal cleanup failed: {err}"));
        }

        if let Err(err) = session_result {
            errors.push(format!("session cleanup failed: {err}"));
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    /// Get the database path for a project in the global app data directory
    fn get_project_db_path(project_path: &PathBuf) -> Result<PathBuf> {
        // Get the app data directory (same location as settings)
        let data_dir =
            dirs::data_dir().ok_or_else(|| anyhow!("Failed to get app data directory"))?;

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
        let folder_name = format!(
            "{}_{}",
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

        // For tests, create a temporary database file that will be cleaned up
        let temp_dir = std::env::temp_dir();
        let temp_db_path = temp_dir.join(format!("test-{}.db", uuid::Uuid::new_v4()));

        let schaltwerk_core = Arc::new(Mutex::new(SchaltwerkCore::new_with_repo_path(
            Some(temp_db_path),
            path.clone(),
        )?));

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
        log::info!(
            "📁 ProjectManager::switch_to_project called with: {}",
            path.display()
        );

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
            trimmed == ".schaltwerk"
                || trimmed == ".schaltwerk/"
                || trimmed == "/.schaltwerk"
                || trimmed == "/.schaltwerk/"
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
                log::error!(
                    "❌ Current project path is set but no project instance found: {}",
                    path.display()
                );
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
        let projects: Vec<(PathBuf, Arc<Project>)> = {
            let projects_guard = self.projects.read().await;
            projects_guard
                .iter()
                .map(|(path, project)| (path.clone(), project.clone()))
                .collect()
        };

        join_all(projects.into_iter().map(|(path, project)| async move {
            debug!("Cleaning up project: {}", path.display());
            if let Err(err) = project.cleanup_resources().await {
                warn!(
                    "Failed to cleanup resources for project {}: {}",
                    path.display(),
                    err
                );
            }
        }))
        .await;
    }

    /// Clean up terminals for a specific project path only
    pub async fn cleanup_project_terminals(&self, path: &PathBuf) -> Result<(), String> {
        // Canonicalize for consistent lookup
        let canonical = std::fs::canonicalize(path).unwrap_or(path.clone());
        let projects = self.projects.read().await;

        // Find exact project match
        if let Some(project) = projects.get(&canonical) {
            if let Err(e) = project.terminal_manager.cleanup_all().await {
                log::warn!(
                    "Failed to cleanup terminals for project {}: {}",
                    canonical.display(),
                    e
                );
                return Err(e);
            }
            return Ok(());
        }

        // Try non-canonical match as fallback
        if let Some(project) = projects.get(path) {
            if let Err(e) = project.terminal_manager.cleanup_all().await {
                log::warn!(
                    "Failed to cleanup terminals for project {}: {}",
                    path.display(),
                    e
                );
                return Err(e);
            }
            return Ok(());
        }

        log::warn!(
            "Requested cleanup for project that is not loaded: {}",
            path.display()
        );
        Ok(())
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
    pub async fn get_schaltwerk_core_for_path(
        &self,
        path: &PathBuf,
    ) -> Result<Arc<Mutex<SchaltwerkCore>>> {
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
            let project_canonical =
                std::fs::canonicalize(&project.path).unwrap_or(project.path.clone());
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
    use schaltwerk::domains::sessions::entity::SessionStatus;
    use std::path::Path;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_git_repo(path: &Path) {
        assert!(StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
        assert!(StdCommand::new("git")
            .args(["config", "user.name", "Schaltwerk Test"])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
        assert!(StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
        std::fs::write(path.join("README.md"), "root\n").unwrap();
        assert!(StdCommand::new("git")
            .args(["add", "."])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
        assert!(StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(path)
            .status()
            .unwrap()
            .success());
    }

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
    async fn test_cleanup_all_when_no_terminals() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();

        let _ = mgr
            .switch_to_project_in_memory(tmp1.path().to_path_buf())
            .await
            .unwrap();
        let _ = mgr
            .switch_to_project_in_memory(tmp2.path().to_path_buf())
            .await
            .unwrap();

        // Should not error even if there are no active terminals
        mgr.cleanup_all().await;
    }

    #[test]
    fn test_get_project_db_path_is_unique_and_sanitized() {
        let base = TempDir::new().unwrap();
        let p1 = base.path().join("my project !@#");
        let p2 = base
            .path()
            .join("my project !@#")
            .join("nested")
            .join("..")
            .join("my project !@#");
        std::fs::create_dir_all(&p1).unwrap();
        std::fs::create_dir_all(&p2).unwrap();

        let db1 = Project::get_project_db_path(&p1).unwrap();
        let db2 = Project::get_project_db_path(&p2).unwrap();

        // Same leaf name but different canonical path => different db paths
        assert_ne!(db1, db2);

        // Folder name should contain sanitized project name and an underscore
        let folder1 = db1
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(folder1.contains("my_project___"));
        assert!(folder1.contains("_"));
        // Should end with sessions.db
        assert_eq!(db1.file_name().unwrap(), "sessions.db");
    }

    #[tokio::test]
    async fn test_cleanup_specific_project_does_not_affect_others() {
        let mgr = ProjectManager::new();
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();

        // Load two projects and make second current
        let p1 = mgr
            .switch_to_project_in_memory(tmp1.path().to_path_buf())
            .await
            .unwrap();
        let p2 = mgr
            .switch_to_project_in_memory(tmp2.path().to_path_buf())
            .await
            .unwrap();

        // Create one terminal in each project
        let id1 = "test-p1-term".to_string();
        let id2 = "test-p2-term".to_string();
        p1.terminal_manager
            .create_terminal(id1.clone(), "/tmp".into())
            .await
            .unwrap();
        p2.terminal_manager
            .create_terminal(id2.clone(), "/tmp".into())
            .await
            .unwrap();

        assert!(p1.terminal_manager.terminal_exists(&id1).await.unwrap());
        assert!(p2.terminal_manager.terminal_exists(&id2).await.unwrap());

        // Ensure current project is p2; now cleanup p1 specifically
        mgr.cleanup_project_terminals(&p1.path).await.unwrap();

        // p1 terminal should be gone; p2 terminal should remain
        assert!(!p1.terminal_manager.terminal_exists(&id1).await.unwrap());
        assert!(p2.terminal_manager.terminal_exists(&id2).await.unwrap());

        // Cleanup p2 to avoid leaks for the test
        let _ = p2.terminal_manager.cleanup_all().await;
    }

    #[tokio::test]
    async fn test_cleanup_all_cancels_active_sessions() {
        let mgr = ProjectManager::new();
        let temp_repo = TempDir::new().unwrap();
        init_git_repo(temp_repo.path());

        let project = mgr
            .switch_to_project_in_memory(temp_repo.path().to_path_buf())
            .await
            .unwrap();

        let term_id = "cleanup-term".to_string();
        project
            .terminal_manager
            .create_terminal(term_id.clone(), temp_repo.path().to_string_lossy().to_string())
            .await
            .unwrap();

        {
            let core = project.schaltwerk_core.lock().await;
            let manager = core.session_manager();
            manager
                .create_session_with_auto_flag(
                    "cleanup-session",
                    Some("prompt"),
                    None,
                    false,
                    None,
                    None,
                )
                .unwrap();
        }

        {
            let core = project.schaltwerk_core.lock().await;
            let manager = core.session_manager();
            let session = manager.get_session("cleanup-session").unwrap();
            assert_eq!(session.status, SessionStatus::Active);
        }

        mgr.cleanup_all().await;

        assert!(!project
            .terminal_manager
            .terminal_exists(&term_id)
            .await
            .unwrap());

        {
            let core = project.schaltwerk_core.lock().await;
            let manager = core.session_manager();
            let session = manager.get_session("cleanup-session").unwrap();
            assert_eq!(session.status, SessionStatus::Cancelled);
        }
    }
}

use crate::domains::git::service as git;
use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
use crate::domains::sessions::process_cleanup::terminate_processes_with_cwd;
use crate::domains::sessions::repository::SessionDbManager;
use anyhow::{Context, Result, anyhow};
use log::{info, warn};
use std::path::Path;

pub struct CancellationCoordinator<'a> {
    repo_path: &'a Path,
    db_manager: &'a SessionDbManager,
}

#[derive(Debug, Clone)]
#[derive(Default)]
pub struct CancellationConfig {
    pub force: bool,
    pub skip_process_cleanup: bool,
    pub skip_branch_deletion: bool,
}

#[derive(Debug, Clone)]
pub struct CancellationResult {
    pub terminated_processes: Vec<i32>,
    pub worktree_removed: bool,
    pub branch_deleted: bool,
    pub errors: Vec<String>,
}

impl<'a> CancellationCoordinator<'a> {
    pub fn new(repo_path: &'a Path, db_manager: &'a SessionDbManager) -> Self {
        Self {
            repo_path,
            db_manager,
        }
    }

    pub fn cancel_session(
        &self,
        session: &Session,
        config: CancellationConfig,
    ) -> Result<CancellationResult> {
        info!("Canceling session '{}' (sync)", session.name);

        if session.session_state == SessionState::Spec {
            return Err(anyhow!(
                "Cannot cancel spec session '{}'. Use archive or delete spec operations instead.",
                session.name
            ));
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        self.check_uncommitted_changes(session);

        if !config.skip_process_cleanup {
            result.terminated_processes = self.terminate_session_processes_sync(session, &mut result.errors);
        }

        result.worktree_removed = self.remove_session_worktree(session, &mut result.errors);

        if !config.skip_branch_deletion {
            result.branch_deleted = self.delete_session_branch(session, &mut result.errors);
        }

        self.finalize_cancellation(&session.id, &mut result.errors)?;

        if !result.errors.is_empty() {
            warn!(
                "Cancel {}: Completed with {} error(s)",
                session.name,
                result.errors.len()
            );
        } else {
            info!("Cancel {}: Successfully completed", session.name);
        }

        Ok(result)
    }

    pub async fn cancel_session_async(
        &self,
        session: &Session,
        config: CancellationConfig,
    ) -> Result<CancellationResult> {
        info!("Canceling session '{}' (async)", session.name);

        if session.session_state == SessionState::Spec {
            return Err(anyhow!(
                "Cannot cancel spec session '{}'. Use archive or delete spec operations instead.",
                session.name
            ));
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        self.check_uncommitted_changes(session);

        if !config.skip_process_cleanup {
            result.terminated_processes = self.terminate_session_processes_async(session, &mut result.errors).await;
        }

        match Self::remove_worktree_async(
            self.repo_path,
            &session.worktree_path,
            &session.name,
        )
        .await
        {
            Ok(()) => result.worktree_removed = true,
            Err(e) => result
                .errors
                .push(format!("Worktree removal failed: {e}")),
        }

        if !config.skip_branch_deletion {
            // The branch remains "checked out" while the worktree exists, so delete it only after pruning succeeds.
            match Self::delete_branch_async(self.repo_path, &session.branch, &session.name).await {
                Ok(()) => result.branch_deleted = true,
                Err(e) => result.errors.push(format!("Branch deletion failed: {e}")),
            }
        }

        self.finalize_cancellation(&session.id, &mut result.errors)?;

        if !result.errors.is_empty() {
            warn!(
                "Fast cancel {}: Completed with {} error(s)",
                session.name,
                result.errors.len()
            );
        } else {
            info!("Fast cancel {}: Successfully completed", session.name);
        }

        Ok(result)
    }

    fn check_uncommitted_changes(&self, session: &Session) {
        if !session.worktree_path.exists() {
            return;
        }

        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false);
        if has_uncommitted {
            warn!(
                "Canceling session '{}' with uncommitted changes",
                session.name
            );
        }
    }

    fn terminate_session_processes_sync(&self, session: &Session, errors: &mut Vec<String>) -> Vec<i32> {
        if !session.worktree_path.exists() {
            return Vec::new();
        }

        match tauri::async_runtime::block_on(terminate_processes_with_cwd(&session.worktree_path)) {
            Ok(pids) => {
                if !pids.is_empty() {
                    info!(
                        "Cancel {}: terminated {} lingering process(es): {:?}",
                        session.name,
                        pids.len(),
                        pids
                    );
                }
                pids
            }
            Err(e) => {
                let msg = format!("Failed to terminate lingering processes: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                Vec::new()
            }
        }
    }

    async fn terminate_session_processes_async(&self, session: &Session, errors: &mut Vec<String>) -> Vec<i32> {
        if !session.worktree_path.exists() {
            return Vec::new();
        }

        match terminate_processes_with_cwd(&session.worktree_path).await {
            Ok(pids) => {
                if !pids.is_empty() {
                    info!(
                        "Fast cancel {}: terminated {} lingering process(es): {:?}",
                        session.name,
                        pids.len(),
                        pids
                    );
                }
                pids
            }
            Err(e) => {
                let msg = format!("Failed to terminate lingering processes: {e}");
                warn!("Fast cancel {}: {}", session.name, msg);
                errors.push(msg);
                Vec::new()
            }
        }
    }

    fn remove_session_worktree(&self, session: &Session, errors: &mut Vec<String>) -> bool {
        if !session.worktree_path.exists() {
            warn!(
                "Worktree path missing, skipping removal: {}",
                session.worktree_path.display()
            );
            return false;
        }

        match git::remove_worktree(self.repo_path, &session.worktree_path) {
            Ok(()) => {
                info!("Cancel {}: Removed worktree", session.name);
                true
            }
            Err(e) => {
                let msg = format!("Failed to remove worktree: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                false
            }
        }
    }

    fn delete_session_branch(&self, session: &Session, errors: &mut Vec<String>) -> bool {
        let branch_exists = match git::branch_exists(self.repo_path, &session.branch) {
            Ok(exists) => exists,
            Err(e) => {
                let msg = format!("Failed to check if branch exists: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                return false;
            }
        };

        if !branch_exists {
            info!("Cancel {}: Branch doesn't exist, skipping deletion", session.name);
            return false;
        }

        match git::delete_branch(self.repo_path, &session.branch) {
            Ok(()) => {
                info!("Deleted branch '{}'", session.branch);
                true
            }
            Err(e) => {
                let msg = format!("Failed to delete branch '{}': {}", session.branch, e);
                warn!("{msg}");
                errors.push(msg);
                false
            }
        }
    }

    fn finalize_cancellation(&self, session_id: &str, errors: &mut Vec<String>) -> Result<()> {
        self.db_manager
            .update_session_status(session_id, SessionStatus::Cancelled)
            .with_context(|| format!("Failed to update session status for '{session_id}'"))?;

        if let Err(e) = self
            .db_manager
            .set_session_resume_allowed(session_id, false)
        {
            let msg = format!("Failed to gate resume: {e}");
            warn!("{msg}");
            errors.push(msg);
        }

        Ok(())
    }

    async fn remove_worktree_async(
        repo_path: &Path,
        worktree_path: &Path,
        session_name: &str,
    ) -> Result<()> {
        use git2::{Repository, WorktreePruneOptions};

        if !worktree_path.exists() {
            warn!(
                "Fast cancel {}: Worktree path missing, skipping removal: {}",
                session_name,
                worktree_path.display()
            );
            return Ok(());
        }

        let repo_path = repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            let repo = Repository::open(&repo_path)?;
            let worktrees = repo.worktrees()?;

            for wt_name in worktrees.iter().flatten() {
                if let Ok(wt) = repo.find_worktree(wt_name)
                    && wt.path() == worktree_path
                {
                    wt.prune(Some(&mut WorktreePruneOptions::new())).ok();
                    break;
                }
            }

            if worktree_path.exists() {
                std::fs::remove_dir_all(&worktree_path)?;
            }

            info!("Fast cancel {session_name}: Removed worktree");
            Ok::<(), anyhow::Error>(())
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }

    async fn delete_branch_async(
        repo_path: &Path,
        branch: &str,
        session_name: &str,
    ) -> Result<()> {
        use git2::{BranchType, Repository};

        let branch_exists = git::branch_exists(repo_path, branch)?;
        if !branch_exists {
            info!("Fast cancel {session_name}: Branch doesn't exist, skipping deletion");
            return Ok(());
        }

        let repo_path = repo_path.to_path_buf();
        let branch = branch.to_string();

        tokio::task::spawn_blocking(move || {
            let repo = Repository::open(&repo_path)?;
            let mut br = repo.find_branch(&branch, BranchType::Local)
                .with_context(|| format!("Failed to find branch '{branch}' for deletion"))?;
            br.delete()?;
            info!("Deleted branch '{branch}'");
            Ok::<(), anyhow::Error>(())
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use crate::infrastructure::database::Database;
    use chrono::Utc;
    use serial_test::serial;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn setup_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();

        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        (temp_dir, repo_path)
    }

    fn create_test_session(repo_path: &Path, worktree_path: PathBuf) -> Session {
        Session {
            id: Uuid::new_v4().to_string(),
            name: "test-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: repo_path.to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/test-session".to_string(),
            parent_branch: "master".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: Some("claude".to_string()),
            original_skip_permissions: Some(false),
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
        }
    }

    #[test]
    #[serial]
    fn test_cancel_spec_session_returns_error() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);

        let mut session = create_test_session(&repo_path, repo_path.join(".schaltwerk/worktrees/test"));
        session.session_state = SessionState::Spec;

        let result = coordinator.cancel_session(&session, CancellationConfig::default());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Cannot cancel spec session"));
    }

    #[test]
    #[serial]
    fn test_cancel_session_with_missing_worktree() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let session = create_test_session(&repo_path, repo_path.join(".schaltwerk/worktrees/nonexistent"));
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let result = coordinator.cancel_session(&session, CancellationConfig::default()).unwrap();

        assert!(!result.worktree_removed);
        assert_eq!(result.terminated_processes.len(), 0);
    }

    #[test]
    #[serial]
    fn test_cancel_session_skip_branch_deletion() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".schaltwerk/worktrees/test");
        git::create_worktree_from_base(&repo_path, "schaltwerk/test-session", &worktree_path, "master").unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let config = CancellationConfig {
            skip_branch_deletion: true,
            ..Default::default()
        };

        let result = coordinator.cancel_session(&session, config).unwrap();
        assert!(!result.branch_deleted);
        assert!(git::branch_exists(&repo_path, "schaltwerk/test-session").unwrap());
    }

    #[test]
    #[serial]
    fn test_finalize_cancellation_updates_status() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let session = create_test_session(&repo_path, repo_path.join(".schaltwerk/worktrees/test"));
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let mut errors = Vec::new();
        coordinator.finalize_cancellation(&session.id, &mut errors).unwrap();

        let updated = db_manager.get_session_by_id(&session.id).unwrap();
        assert_eq!(updated.status, SessionStatus::Cancelled);
        assert!(!updated.resume_allowed);
    }

    #[tokio::test]
    #[serial]
    async fn test_async_cancel_session() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".schaltwerk/worktrees/test");
        git::create_worktree_from_base(&repo_path, "schaltwerk/test-session", &worktree_path, "master").unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let result = coordinator.cancel_session_async(&session, CancellationConfig::default()).await.unwrap();

        assert!(result.worktree_removed);
        assert!(result.branch_deleted);
        assert!(!worktree_path.exists());
    }
}

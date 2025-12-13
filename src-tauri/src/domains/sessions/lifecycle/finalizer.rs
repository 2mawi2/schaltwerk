use crate::domains::git::service as git;
use crate::domains::sessions::cache::SessionCacheManager;
use crate::domains::sessions::entity::{GitStats, Session, SessionState};
use crate::domains::sessions::repository::SessionDbManager;
use anyhow::{Context, Result};
use chrono::Utc;
use log::{info, warn};
use std::path::Path;

const GIT_STATS_STALE_THRESHOLD_SECS: i64 = 60;

pub struct SessionFinalizer<'a> {
    db_manager: &'a SessionDbManager,
    cache_manager: &'a SessionCacheManager,
}

pub struct FinalizationConfig {
    pub session: Session,
    pub compute_git_stats: bool,
    pub update_activity: bool,
}

pub struct FinalizationResult {
    pub session: Session,
    pub git_stats: Option<GitStats>,
}

impl<'a> SessionFinalizer<'a> {
    pub fn new(db_manager: &'a SessionDbManager, cache_manager: &'a SessionCacheManager) -> Self {
        Self {
            db_manager,
            cache_manager,
        }
    }

    pub fn finalize_creation(&self, config: FinalizationConfig) -> Result<FinalizationResult> {
        info!("Finalizing session creation for '{}'", config.session.name);

        self.persist_session(&config.session)
            .with_context(|| format!("Failed to persist session '{}'", config.session.name))?;

        let git_stats = if config.compute_git_stats {
            self.compute_and_save_git_stats(&config.session, &config.session.parent_branch)
                .unwrap_or_else(|e| {
                    warn!(
                        "Failed to compute git stats for '{}': {}",
                        config.session.name, e
                    );
                    None
                })
        } else {
            None
        };

        if config.update_activity
            && let Err(e) = self.update_activity(&config.session.id)
        {
            warn!(
                "Failed to update activity for '{}': {}",
                config.session.name, e
            );
        }

        info!("Successfully finalized session '{}'", config.session.name);

        Ok(FinalizationResult {
            session: config.session,
            git_stats,
        })
    }

    pub fn finalize_state_transition(
        &self,
        session_id: &str,
        new_state: SessionState,
    ) -> Result<()> {
        let state_str = format!("{:?}", &new_state);
        info!("Finalizing state transition for session '{session_id}' to {state_str}");

        self.db_manager
            .update_session_state(session_id, new_state)
            .with_context(|| {
                format!("Failed to update session state for '{session_id}' to {state_str}")
            })?;

        self.update_activity(session_id).ok();

        Ok(())
    }

    pub fn compute_and_save_git_stats(
        &self,
        session: &Session,
        parent_branch: &str,
    ) -> Result<Option<GitStats>> {
        if session.session_state == SessionState::Spec {
            return Ok(None);
        }

        if !session.worktree_path.exists() {
            warn!(
                "Worktree path does not exist for session '{}', skipping git stats",
                session.name
            );
            return Ok(None);
        }

        let cached_stats = self.db_manager.get_git_stats(&session.id).ok().flatten();

        let stats = self.get_or_compute_git_stats(
            &session.id,
            &session.worktree_path,
            parent_branch,
            cached_stats.as_ref(),
        )?;

        if let Some(ref s) = stats {
            self.db_manager
                .save_git_stats(s)
                .with_context(|| format!("Failed to save git stats for '{}'", session.name))?;
        }

        Ok(stats)
    }

    pub fn update_activity(&self, session_id: &str) -> Result<()> {
        let now = Utc::now();
        self.db_manager
            .set_session_activity(session_id, now)
            .with_context(|| format!("Failed to update activity for session '{session_id}'"))
    }

    pub fn unreserve_session_name(&self, name: &str) {
        info!("Unreserving session name '{name}'");
        self.cache_manager.unreserve_name(name);
    }

    fn persist_session(&self, session: &Session) -> Result<()> {
        self.db_manager.create_session(session)?;
        Ok(())
    }

    fn get_or_compute_git_stats(
        &self,
        session_id: &str,
        worktree_path: &Path,
        parent_branch: &str,
        cached_stats: Option<&GitStats>,
    ) -> Result<Option<GitStats>> {
        match cached_stats {
            Some(existing) => {
                let is_stale = Utc::now().timestamp() - existing.calculated_at.timestamp()
                    > GIT_STATS_STALE_THRESHOLD_SECS;
                if is_stale {
                    let updated =
                        self.compute_fresh_git_stats(session_id, worktree_path, parent_branch)?;
                    Ok(Some(updated.unwrap_or_else(|| existing.clone())))
                } else {
                    Ok(Some(existing.clone()))
                }
            }
            None => self.compute_fresh_git_stats(session_id, worktree_path, parent_branch),
        }
    }

    fn compute_fresh_git_stats(
        &self,
        session_id: &str,
        worktree_path: &Path,
        parent_branch: &str,
    ) -> Result<Option<GitStats>> {
        let mut stats =
            git::calculate_git_stats_fast(worktree_path, parent_branch).with_context(|| {
                format!(
                    "Failed to calculate git stats for worktree at {}",
                    worktree_path.display()
                )
            })?;

        stats.session_id = session_id.to_string();
        Ok(Some(stats))
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
    use tempfile::TempDir;
    use uuid::Uuid;

    fn setup_test_db() -> (TempDir, Database) {
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        (temp_dir, db)
    }

    fn create_test_session(worktree_path: PathBuf) -> Session {
        Session {
            id: Uuid::new_v4().to_string(),
            name: "test-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/test-session".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
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
            pr_number: None,
            pr_url: None,
        }
    }

    #[test]
    #[serial]
    fn test_persist_session_creates_record() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let session = create_test_session(PathBuf::from("/tmp/worktree"));
        let result = finalizer.persist_session(&session);
        assert!(result.is_ok());

        let retrieved = db_manager.get_session_by_id(&session.id).unwrap();
        assert_eq!(retrieved.name, "test-session");
    }

    #[test]
    #[serial]
    fn test_finalize_creation_with_no_stats() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let session = create_test_session(PathBuf::from("/tmp/worktree"));
        let config = FinalizationConfig {
            session: session.clone(),
            compute_git_stats: false,
            update_activity: false,
        };

        let result = finalizer.finalize_creation(config).unwrap();
        assert_eq!(result.session.name, "test-session");
        assert!(result.git_stats.is_none());
    }

    #[test]
    #[serial]
    fn test_finalize_state_transition() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let session = create_test_session(PathBuf::from("/tmp/worktree"));
        finalizer.persist_session(&session).unwrap();

        let result = finalizer.finalize_state_transition(&session.id, SessionState::Reviewed);
        assert!(result.is_ok());

        let updated = db_manager.get_session_by_id(&session.id).unwrap();
        assert_eq!(updated.session_state, SessionState::Reviewed);
    }

    #[test]
    #[serial]
    fn test_update_activity() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let session = create_test_session(PathBuf::from("/tmp/worktree"));
        finalizer.persist_session(&session).unwrap();

        let result = finalizer.update_activity(&session.id);
        assert!(result.is_ok());

        let updated = db_manager.get_session_by_id(&session.id).unwrap();
        assert!(updated.last_activity.is_some());
    }

    #[test]
    #[serial]
    fn test_compute_git_stats_for_spec_returns_none() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let mut session = create_test_session(PathBuf::from("/tmp/worktree"));
        session.session_state = SessionState::Spec;

        let result = finalizer
            .compute_and_save_git_stats(&session, "main")
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    #[serial]
    fn test_compute_git_stats_for_nonexistent_worktree() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        let session = create_test_session(PathBuf::from("/nonexistent/worktree"));

        let result = finalizer
            .compute_and_save_git_stats(&session, "main")
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    #[serial]
    fn test_unreserve_session_name() {
        let (temp_dir, db) = setup_test_db();
        let repo_path = temp_dir.path().to_path_buf();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path);
        let finalizer = SessionFinalizer::new(&db_manager, &cache_manager);

        cache_manager.reserve_name("test-session");
        assert!(cache_manager.is_reserved("test-session"));

        finalizer.unreserve_session_name("test-session");
        assert!(!cache_manager.is_reserved("test-session"));
    }
}

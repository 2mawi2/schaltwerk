use crate::infrastructure::events::{SchaltEvent, emit_event};
use crate::shared::merge_snapshot_gateway::MergeSnapshotGateway;
use crate::{
    domains::git::db_git_stats::GitStatsMethods, domains::git::service as git,
    domains::sessions::db_sessions::SessionMethods, infrastructure::database::Database,
};
use anyhow::Result;
#[cfg(test)]
use chrono::DateTime;
#[cfg(test)]
use chrono::Utc;
use git2::Repository;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::time::{Duration, interval};

pub trait EventEmitter: Send + Sync {
    fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()>;
}

impl EventEmitter for AppHandle {
    fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()> {
        emit_event(self, SchaltEvent::SessionGitStats, &payload)
            .map_err(|e| anyhow::anyhow!("Failed to emit git stats: {e}"))
    }
}

pub struct ActivityTracker<E: EventEmitter> {
    db: Arc<Database>,
    emitter: E,
}

impl<E: EventEmitter> ActivityTracker<E> {
    pub fn new(db: Arc<Database>, emitter: E) -> Self {
        Self { db, emitter }
    }

    pub async fn start_polling(self) {
        let mut interval = interval(Duration::from_secs(60));

        loop {
            interval.tick().await;

            if let Err(e) = self.update_all_activities().await {
                log::error!("Failed to update activities: {e}");
            }
        }
    }

    async fn update_all_activities(&self) -> Result<()> {
        let active_sessions = self.db.list_all_active_sessions()?;

        for session in active_sessions {
            self.refresh_stats_and_activity_for_session(&session)?;
        }

        Ok(())
    }

    fn refresh_stats_and_activity_for_session(
        &self,
        session: &crate::domains::sessions::entity::Session,
    ) -> Result<()> {
        // Prefer diff-aware last change time via git stats; fall back to filesystem walk only if unavailable

        if session.worktree_path.exists() {
            match git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch) {
                Ok(mut stats) => {
                    stats.session_id = session.id.clone();

                    // Update DB stats periodically as before
                    if self.db.should_update_stats(&session.id)? {
                        let has_conflicts = match git::has_conflicts(&session.worktree_path) {
                            Ok(value) => value,
                            Err(err) => {
                                log::warn!(
                                    "Failed to detect conflicts for {}: {err}",
                                    session.name
                                );
                                false
                            }
                        };

                        let merge_snapshot = Repository::open(&session.repository_path)
                            .ok()
                            .and_then(|repo| {
                                let session_oid = MergeSnapshotGateway::resolve_branch_oid(
                                    &repo,
                                    &session.branch,
                                )
                                .ok()?;
                                let parent_oid = MergeSnapshotGateway::resolve_branch_oid(
                                    &repo,
                                    &session.parent_branch,
                                )
                                .ok()?;
                                MergeSnapshotGateway::compute(
                                    &repo,
                                    session_oid,
                                    parent_oid,
                                    &session.branch,
                                    &session.parent_branch,
                                )
                                .map_err(|err| {
                                    log::warn!(
                                        "Merge assessment failed for session '{}': {}",
                                        session.name,
                                        err
                                    );
                                })
                                .ok()
                            })
                            .unwrap_or_default();

                        if let Err(e) = self.db.save_git_stats(&stats) {
                            log::warn!("Failed to save git stats for {}: {}", session.name, e);
                        } else {
                            // Emit git stats update event
                            let payload = SessionGitStatsUpdated {
                                session_id: session.id.clone(),
                                session_name: session.name.clone(),
                                files_changed: stats.files_changed,
                                lines_added: stats.lines_added,
                                lines_removed: stats.lines_removed,
                                has_uncommitted: stats.has_uncommitted,
                                has_conflicts,
                                top_uncommitted_paths: None,
                                merge_has_conflicts: merge_snapshot.merge_has_conflicts,
                                merge_conflicting_paths: merge_snapshot.merge_conflicting_paths,
                                merge_is_up_to_date: merge_snapshot.merge_is_up_to_date,
                            };
                            let _ = self.emitter.emit_session_git_stats(payload);
                        }
                    }

                }
                Err(e) => {
                    log::warn!(
                        "Failed to compute fast git stats for {}: {}",
                        session.name,
                        e
                    );
                }
            }
        }

        // No filesystem walk fallback: if diff timestamp was not derived, we still rely on existing stats data

        Ok(())
    }

}

// Removed unused legacy API `start_activity_tracking` to simplify code.

#[derive(Serialize, Clone, Debug)]
pub struct SessionGitStatsUpdated {
    pub session_id: String,
    pub session_name: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_uncommitted: bool,
    pub has_conflicts: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_uncommitted_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_has_conflicts: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_conflicting_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_is_up_to_date: Option<bool>,
}

pub fn start_activity_tracking_with_app(db: Arc<Database>, app: AppHandle) {
    let tracker = ActivityTracker::new(db, app);
    tokio::spawn(async move {
        tracker.start_polling().await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domains::git::service::{create_worktree_from_base, get_current_branch},
        domains::sessions::db_sessions::SessionMethods,
        domains::sessions::entity::{Session, SessionState, SessionStatus},
        infrastructure::database::Database,
    };
    use chrono::Utc;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    #[derive(Clone)]
    struct MockEmitter {
        git_stats_events: Arc<Mutex<Vec<SessionGitStatsUpdated>>>,
    }

    impl MockEmitter {
        fn new() -> Self {
            Self {
                git_stats_events: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn get_git_stats_events(&self) -> Vec<SessionGitStatsUpdated> {
            self.git_stats_events.lock().unwrap().clone()
        }
    }

    impl EventEmitter for MockEmitter {
        fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()> {
            self.git_stats_events.lock().unwrap().push(payload);
            Ok(())
        }
    }
    #[test]
    fn test_event_emitter_trait_methods() {
        let mock_emitter = MockEmitter::new();

        let stats_payload = SessionGitStatsUpdated {
            session_id: "session1".to_string(),
            session_name: "feature".to_string(),
            files_changed: 5,
            lines_added: 100,
            lines_removed: 20,
            has_uncommitted: true,
            has_conflicts: false,
            top_uncommitted_paths: None,
            merge_has_conflicts: None,
            merge_conflicting_paths: None,
            merge_is_up_to_date: None,
        };

        mock_emitter
            .emit_session_git_stats(stats_payload.clone())
            .unwrap();

        let git_events = mock_emitter.get_git_stats_events();

        assert_eq!(git_events.len(), 1);
        assert_eq!(git_events[0].files_changed, 5);
    }

    #[test]
    fn test_git_stats_payload_structure() {
        let payload = SessionGitStatsUpdated {
            session_id: "session-456".to_string(),
            session_name: "bug-fix".to_string(),
            files_changed: 3,
            lines_added: 45,
            lines_removed: 12,
            has_uncommitted: false,
            has_conflicts: false,
            top_uncommitted_paths: None,
            merge_has_conflicts: Some(false),
            merge_conflicting_paths: None,
            merge_is_up_to_date: Some(true),
        };

        assert_eq!(payload.session_id, "session-456");
        assert_eq!(payload.session_name, "bug-fix");
        assert_eq!(payload.files_changed, 3);
        assert_eq!(payload.lines_added, 45);
        assert_eq!(payload.lines_removed, 12);
        assert!(!payload.has_uncommitted);
    }

    #[test]
    fn test_refresh_uses_git_diff_for_untracked_and_staged_changes() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path().to_path_buf();

        // init repo
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        // create worktree
        let worktree_path = repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join("test-session");
        let parent_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(
            &repo_path,
            "schaltwerk/test-session",
            &worktree_path,
            &parent_branch,
        )
        .unwrap();

        // DB and session
        let db_path = temp.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db.clone(), mock_emitter.clone());

        let session = Session {
            id: "s-1".into(),
            name: "test-session".into(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".into(),
            branch: "schaltwerk/test-session".into(),
            parent_branch: parent_branch.clone(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
        };
        db.create_session(&session).unwrap();

        // Create untracked file (should be detected)
        std::fs::write(worktree_path.join("untracked.txt"), "hi").unwrap();
        // Create staged change
        std::fs::write(worktree_path.join("staged.txt"), "stage me").unwrap();
        std::process::Command::new("git")
            .args(["add", "staged.txt"])
            .current_dir(&worktree_path)
            .output()
            .unwrap();

        tracker
            .refresh_stats_and_activity_for_session(&session)
            .unwrap();

        // Verify git stats events emitted
        let events = mock_emitter.get_git_stats_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_name, session.name);
    }

    #[test]
    fn test_refresh_falls_back_to_filesystem_when_git_fails() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db.clone(), mock_emitter.clone());

        // Non-repo directory with a file
        let dir = temp.path().join("nonrepo");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("file.txt"), "x").unwrap();

        let session = Session {
            id: "s-2".into(),
            name: "fallback".into(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: temp.path().to_path_buf(),
            repository_name: "repo".into(),
            branch: "schaltwerk/fallback".into(),
            parent_branch: "main".into(),
            worktree_path: dir.clone(),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
        };
        db.create_session(&session).unwrap();

        tracker
            .refresh_stats_and_activity_for_session(&session)
            .unwrap();
        // We removed filesystem fallback: should not emit anything when git stats are unavailable
        let events = mock_emitter.get_git_stats_events();
        assert_eq!(events.len(), 0);
    }
}

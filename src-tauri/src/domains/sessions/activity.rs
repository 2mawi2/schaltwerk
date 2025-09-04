#[cfg(test)]
use std::path::Path;
use std::sync::Arc;
#[cfg(test)]
use std::time::UNIX_EPOCH;
use tokio::time::{interval, Duration};
#[cfg(test)]
use walkdir::WalkDir;
use chrono::{Utc, TimeZone};
#[cfg(test)]
use chrono::DateTime;
use anyhow::Result;
use crate::{
    schaltwerk_core::database::Database,
    domains::sessions::db_sessions::SessionMethods,
    domains::git::db_git_stats::GitStatsMethods,
    domains::git::service as git,
};
use tauri::AppHandle;
use serde::Serialize;
use crate::infrastructure::events::{emit_event, SchaltEvent};

pub trait EventEmitter: Send + Sync {
    fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()>;
    fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()>;
}

impl EventEmitter for AppHandle {
    fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()> {
        emit_event(self, SchaltEvent::SessionActivity, &payload)
            .map_err(|e| anyhow::anyhow!("Failed to emit session activity: {e}"))
    }
    
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
    
    fn refresh_stats_and_activity_for_session(&self, session: &crate::schaltwerk_core::types::Session) -> Result<bool> {
        // Prefer diff-aware last change time via git stats; fall back to filesystem walk only if unavailable
        let mut emitted_activity = false;
        
        if session.worktree_path.exists() {
            match git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch) {
                Ok(mut stats) => {
                    stats.session_id = session.id.clone();

                    // Update DB stats periodically as before
                    if self.db.should_update_stats(&session.id)? {
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
                            };
                            let _ = self.emitter.emit_session_git_stats(payload);
                        }
                    }

                    if let Some(mut ts) = stats.last_diff_change_ts {
                        // Clamp future timestamps to now to avoid monotonic lock-in from clock skew
                        let now = Utc::now().timestamp();
                        if ts > now + 120 { ts = now; }
                        // Persist as last_activity if monotonically newer
                        if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
                            // Use strict set to ensure UI reflects the new diff-aware time (even if earlier/later)
                            self.db.set_session_activity(&session.id, dt)?;
                            let session_info = self.db.get_session_by_id(&session.id)?;
                            let payload = SessionActivityUpdated {
                                session_id: session.id.clone(),
                                session_name: session.name.clone(),
                                last_activity_ts: dt.timestamp(),
                                current_task: session_info.initial_prompt.clone(),
                                todo_percentage: None, // Not available in Session
                                is_blocked: None, // Not available in Session
                            };
                            let _ = self.emitter.emit_session_activity(payload);
                            emitted_activity = true;
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to compute fast git stats for {}: {}", session.name, e);
                }
            }
        }

        // No filesystem walk fallback: if diff timestamp was not derived, do not emit or set last_activity

        Ok(emitted_activity)
    }
    
    #[cfg(test)]
    fn get_last_modification(&self, path: &Path) -> Result<Option<DateTime<Utc>>> {
        if !path.exists() {
            return Ok(None);
        }
        
        let mut latest = 0i64;
        
        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.path().components().any(|c| c.as_os_str() == ".git") {
                continue;
            }
            
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    let timestamp = modified
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_secs() as i64;
                    
                    if timestamp > latest {
                        latest = timestamp;
                    }
                }
            }
        }
        
        if latest > 0 {
            Ok(Utc.timestamp_opt(latest, 0).single())
        } else {
            Ok(None)
        }
    }
}

// Removed unused legacy API `start_activity_tracking` to simplify code.

#[derive(Serialize, Clone, Debug)]
pub struct SessionActivityUpdated {
    pub session_id: String,
    pub session_name: String,
    pub last_activity_ts: i64,
    pub current_task: Option<String>,
    pub todo_percentage: Option<f64>,
    pub is_blocked: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SessionGitStatsUpdated {
    pub session_id: String,
    pub session_name: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_uncommitted: bool,
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
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;
    use crate::{
        schaltwerk_core::database::Database,
        domains::sessions::db_sessions::SessionMethods,
        schaltwerk_core::types::{Session, SessionStatus, SessionState},
        domains::git::service::{create_worktree_from_base, get_current_branch},
    };
    use chrono::Utc;
    
    #[derive(Clone)]
    struct MockEmitter {
        activity_events: Arc<Mutex<Vec<SessionActivityUpdated>>>,
        git_stats_events: Arc<Mutex<Vec<SessionGitStatsUpdated>>>,
    }
    
    impl MockEmitter {
        fn new() -> Self {
            Self {
                activity_events: Arc::new(Mutex::new(Vec::new())),
                git_stats_events: Arc::new(Mutex::new(Vec::new())),
            }
        }
        
        fn get_activity_events(&self) -> Vec<SessionActivityUpdated> {
            self.activity_events.lock().unwrap().clone()
        }
        
        fn get_git_stats_events(&self) -> Vec<SessionGitStatsUpdated> {
            self.git_stats_events.lock().unwrap().clone()
        }
    }
    
    impl EventEmitter for MockEmitter {
        fn emit_session_activity(&self, payload: SessionActivityUpdated) -> Result<()> {
            self.activity_events.lock().unwrap().push(payload);
            Ok(())
        }
        
        fn emit_session_git_stats(&self, payload: SessionGitStatsUpdated) -> Result<()> {
            self.git_stats_events.lock().unwrap().push(payload);
            Ok(())
        }
    }
    
    
    #[test]
    fn test_payload_mapping_for_session_activity() {
        let payload = SessionActivityUpdated {
            session_id: "test-session-123".to_string(),
            session_name: "my-feature-branch".to_string(),
            last_activity_ts: 1704067200,
            current_task: Some("implement feature".to_string()),
            todo_percentage: Some(50.0),
            is_blocked: Some(true),
        };
        
        assert_eq!(payload.session_id, "test-session-123");
        assert_eq!(payload.session_name, "my-feature-branch");
        assert_eq!(payload.last_activity_ts, 1704067200);
        assert_eq!(payload.current_task, Some("implement feature".to_string()));
        assert_eq!(payload.todo_percentage, Some(50.0));
        assert_eq!(payload.is_blocked, Some(true));
    }
    
    #[test]
    fn test_event_emitter_trait_methods() {
        let mock_emitter = MockEmitter::new();
        
        let activity_payload = SessionActivityUpdated {
            session_id: "session1".to_string(),
            session_name: "feature".to_string(),
            last_activity_ts: 1704067200,
            current_task: None,
            todo_percentage: None,
            is_blocked: None,
        };
        
        let stats_payload = SessionGitStatsUpdated {
            session_id: "session1".to_string(),
            session_name: "feature".to_string(),
            files_changed: 5,
            lines_added: 100,
            lines_removed: 20,
            has_uncommitted: true,
        };
        
        mock_emitter.emit_session_activity(activity_payload.clone()).unwrap();
        mock_emitter.emit_session_git_stats(stats_payload.clone()).unwrap();
        
        let activity_events = mock_emitter.get_activity_events();
        let git_events = mock_emitter.get_git_stats_events();
        
        assert_eq!(activity_events.len(), 1);
        assert_eq!(git_events.len(), 1);
        
        assert_eq!(activity_events[0].session_id, "session1");
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
        };
        
        assert_eq!(payload.session_id, "session-456");
        assert_eq!(payload.session_name, "bug-fix");
        assert_eq!(payload.files_changed, 3);
        assert_eq!(payload.lines_added, 45);
        assert_eq!(payload.lines_removed, 12);
        assert!(!payload.has_uncommitted);
    }
    
    #[test]
    fn test_get_last_modification_nonexistent_path() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db, mock_emitter);
        
        let nonexistent_path = temp_dir.path().join("nonexistent");
        let result = tracker.get_last_modification(&nonexistent_path).unwrap();
        assert!(result.is_none());
    }
    
    #[test]
    fn test_get_last_modification_with_git_directory() {
        let temp_dir = TempDir::new().unwrap();
        let git_dir = temp_dir.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("config"), "git config").unwrap();
        std::fs::write(temp_dir.path().join("regular.txt"), "content").unwrap();
        
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(Some(db_path)).unwrap());
        let mock_emitter = MockEmitter::new();
        let tracker = ActivityTracker::new(db, mock_emitter);
        
        let result = tracker.get_last_modification(temp_dir.path()).unwrap();
        assert!(result.is_some());
    }

        #[test]
        fn test_refresh_uses_git_diff_for_untracked_and_staged_changes() {
            let temp = TempDir::new().unwrap();
            let repo_path = temp.path().to_path_buf();

            // init repo
            std::process::Command::new("git").args(["init"]).current_dir(&repo_path).output().unwrap();
            std::process::Command::new("git").args(["config","user.email","test@example.com"]).current_dir(&repo_path).output().unwrap();
            std::process::Command::new("git").args(["config","user.name","Test User"]).current_dir(&repo_path).output().unwrap();
            std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
            std::process::Command::new("git").args(["add","."]).current_dir(&repo_path).output().unwrap();
            std::process::Command::new("git").args(["commit","-m","init"]).current_dir(&repo_path).output().unwrap();

            // create worktree
            let worktree_path = repo_path.join(".schaltwerk").join("worktrees").join("test-session");
            let parent_branch = get_current_branch(&repo_path).unwrap();
            create_worktree_from_base(&repo_path, "schaltwerk/test-session", &worktree_path, &parent_branch).unwrap();

            // DB and session
            let db_path = temp.path().join("test.db");
            let db = Arc::new(Database::new(Some(db_path)).unwrap());
            let mock_emitter = MockEmitter::new();
            let tracker = ActivityTracker::new(db.clone(), mock_emitter.clone());

            let session = Session {
                id: "s-1".into(),
                name: "test-session".into(),
                display_name: None,
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
            };
            db.create_session(&session).unwrap();

            // Create untracked file (should be detected)
            std::fs::write(worktree_path.join("untracked.txt"), "hi").unwrap();
            // Create staged change
            std::fs::write(worktree_path.join("staged.txt"), "stage me").unwrap();
            std::process::Command::new("git").args(["add","staged.txt"]).current_dir(&worktree_path).output().unwrap();

            let emitted = tracker.refresh_stats_and_activity_for_session(&session).unwrap();
            assert!(emitted, "Should emit activity for changed files");

            // Verify DB updated
            let updated = db.get_session_by_id(&session.id).unwrap();
            assert!(updated.last_activity.is_some());

            // Verify events emitted
            let events = mock_emitter.get_activity_events();
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
            };
            db.create_session(&session).unwrap();

            let emitted = tracker.refresh_stats_and_activity_for_session(&session).unwrap();
            // We removed filesystem fallback: should not emit anything when git stats are unavailable
            assert!(!emitted, "Should not emit when git stats unavailable");
            let updated = db.get_session_by_id(&session.id).unwrap();
            assert!(updated.last_activity.is_none());
            let events = mock_emitter.get_activity_events();
            assert_eq!(events.len(), 0);
        }
}

use std::path::Path;

use anyhow::Result;

use crate::domains::sessions::db_sessions::SessionMethods;
use crate::infrastructure::database::db_project_config::ProjectConfigMethods;
use crate::schaltwerk_core::database::Database;

/// Helper that exposes session metadata operations without importing the sessions domain directly.
pub struct SessionMetadataGateway<'a> {
    database: &'a Database,
}

impl<'a> SessionMetadataGateway<'a> {
    pub fn new(database: &'a Database) -> Self {
        Self { database }
    }

    pub fn update_session_display_name(&self, session_id: &str, display_name: &str) -> Result<()> {
        self.database
            .update_session_display_name(session_id, display_name)
    }

    pub fn update_session_branch(&self, session_id: &str, new_branch: &str) -> Result<()> {
        self.database.update_session_branch(session_id, new_branch)
    }

    pub fn update_parent_branch(&self, session_id: &str, new_parent_branch: &str) -> Result<()> {
        self.database
            .update_session_parent_branch(session_id, new_parent_branch)
    }

    pub fn update_session_resume_flag(&self, session_id: &str, allowed: bool) -> Result<()> {
        self.database
            .set_session_resume_allowed(session_id, allowed)
    }

    pub fn get_project_branch_prefix(&self, repo_path: &Path) -> Result<String> {
        self.database.get_project_branch_prefix(repo_path)
    }
}

pub use crate::domains::sessions::activity::SessionGitStatsUpdated;
pub use crate::domains::sessions::entity::{ChangedFile, EnrichedSession};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use chrono::Utc;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn sample_session(repo: &Path) -> Session {
        Session {
            id: Uuid::new_v4().to_string(),
            name: "test-session".into(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: repo.to_path_buf(),
            repository_name: "test-repo".into(),
            branch: "schaltwerk/test-session".into(),
            parent_branch: "main".into(),
            worktree_path: repo.join("worktrees").join("test-session"),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("do something".into()),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
        }
    }

    #[test]
    fn gateway_updates_session_metadata() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("sessions.db");
        let database = Database::new(Some(db_path)).unwrap();
        let session = sample_session(temp.path());
        database.create_session(&session).unwrap();

        let gateway = SessionMetadataGateway::new(&database);

        gateway
            .update_session_display_name(&session.id, "friendly-name")
            .unwrap();
        gateway
            .update_session_branch(&session.id, "schaltwerk/friendly-name")
            .unwrap();
        gateway
            .update_parent_branch(&session.id, "develop")
            .unwrap();

        let display_name = database
            .get_session_by_id(&session.id)
            .unwrap()
            .display_name;
        assert_eq!(display_name.as_deref(), Some("friendly-name"));
    }
}

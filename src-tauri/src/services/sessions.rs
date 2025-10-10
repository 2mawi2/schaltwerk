use crate::domains::sessions::entity::EnrichedSession;
use crate::project_manager::ProjectManager;
use crate::schaltwerk_core::SchaltwerkCore;
use async_trait::async_trait;
use std::sync::Arc;

#[async_trait]
pub trait SessionsBackend: Send + Sync {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String>;
}

#[async_trait]
pub trait SessionsService: Send + Sync {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String>;
}

pub struct SessionsServiceImpl<B: SessionsBackend> {
    backend: B,
}

impl<B: SessionsBackend> SessionsServiceImpl<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        log::debug!("Listing enriched sessions via SessionsService");
        let sessions = self
            .backend
            .list_enriched_sessions()
            .await
            .map_err(|err| format!("Failed to list sessions: {err}"))?;

        log::debug!("Found {} sessions", sessions.len());
        Ok(sessions)
    }
}

#[async_trait]
impl<B> SessionsService for SessionsServiceImpl<B>
where
    B: SessionsBackend + Sync,
{
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        SessionsServiceImpl::list_enriched_sessions(self).await
    }
}

pub struct ProjectSessionsBackend {
    project_manager: Arc<ProjectManager>,
}

impl ProjectSessionsBackend {
    pub fn new(project_manager: Arc<ProjectManager>) -> Self {
        Self { project_manager }
    }

    async fn get_core(&self) -> Result<Arc<tokio::sync::RwLock<SchaltwerkCore>>, String> {
        self.project_manager
            .current_schaltwerk_core()
            .await
            .map_err(|e| {
                log::error!("Failed to get Schaltwerk core: {e}");
                format!("Failed to get Schaltwerk core: {e}")
            })
    }
}

#[async_trait]
impl SessionsBackend for ProjectSessionsBackend {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        let core = self.get_core().await?;
        let core = core.read().await;
        let manager = core.session_manager();
        manager
            .list_enriched_sessions()
            .map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    struct SuccessBackend {
        sessions: Vec<EnrichedSession>,
    }

    #[async_trait]
    impl SessionsBackend for SuccessBackend {
        async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
            Ok(self.sessions.clone())
        }
    }

    struct ErrorBackend;

    #[async_trait]
    impl SessionsBackend for ErrorBackend {
        async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
            Err("backend failure".to_string())
        }
    }

    fn sample_session(name: &str) -> EnrichedSession {
        use crate::domains::sessions::entity::{
            SessionInfo, SessionState, SessionStatusType, SessionType,
        };

        EnrichedSession {
            info: SessionInfo {
                session_id: name.to_string(),
                display_name: None,
                version_group_id: None,
                version_number: None,
                branch: format!("{name}-branch"),
                worktree_path: "/tmp".to_string(),
                base_branch: "main".to_string(),
                status: SessionStatusType::Active,
                created_at: Some(chrono::Utc::now()),
                last_modified: None,
                has_uncommitted_changes: Some(false),
                has_conflicts: Some(false),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type: None,
                current_task: None,
                diff_stats: None,
                ready_to_merge: false,
                spec_content: None,
                worktree_size_bytes: None,
                session_state: SessionState::Running,
            },
            status: None,
            terminals: vec![],
        }
    }

    #[tokio::test]
    async fn delegates_to_backend() {
        let backend = SuccessBackend {
            sessions: vec![sample_session("one"), sample_session("two")],
        };
        let service = SessionsServiceImpl::new(backend);

        let result = service.list_enriched_sessions().await;
        assert!(
            result.is_ok(),
            "expected successful session listing, got {result:?}"
        );
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].info.session_id, "one");
        assert_eq!(sessions[1].info.session_id, "two");
    }

    #[tokio::test]
    async fn augments_error_with_context() {
        let backend = ErrorBackend;
        let service = SessionsServiceImpl::new(backend);

        let result = service.list_enriched_sessions().await;
        assert!(
            result.is_err(),
            "expected error when backend fails, got {result:?}"
        );
        let message = result.unwrap_err();
        assert!(
            message.contains("backend failure"),
            "error should include backend message: {message}"
        );
        assert!(
            message.contains("list sessions"),
            "error should include context about listing sessions: {message}"
        );
    }
}

use std::sync::Arc;

use tauri::AppHandle;

use crate::domains::terminal::TerminalManager;

/// Shared handle type used when callers need direct access to the manager.
pub type TerminalHandle = Arc<TerminalManager>;

/// Shared gateway that exposes terminal lifecycle operations without requiring
/// consumers to depend on the terminal domain directly.
#[derive(Clone, Default)]
pub struct ProjectTerminalGateway {
    manager: Arc<TerminalManager>,
}

impl ProjectTerminalGateway {
    /// Create a new gateway with a fresh terminal manager instance.
    pub fn new() -> Self {
        Self {
            manager: Arc::new(TerminalManager::new()),
        }
    }

    /// Create a gateway from an existing terminal manager instance.
    pub fn from_manager(manager: Arc<TerminalManager>) -> Self {
        Self { manager }
    }

    /// Return a handle to the underlying terminal manager for callers that need
    /// advanced capabilities (typically outside the domains layer).
    pub fn handle(&self) -> TerminalHandle {
        Arc::clone(&self.manager)
    }

    /// Attach an app handle so lifecycle events can be emitted.
    pub async fn set_app_handle(&self, handle: AppHandle) {
        self.manager.set_app_handle(handle).await;
    }

    /// Register terminal IDs to a project/session pairing.
    pub async fn attach_terminals_to_session(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        terminal_ids: &[String],
    ) {
        self.manager
            .attach_terminals_to_session(project_id, session_id, terminal_ids)
            .await;
    }

    /// Suspend all terminals associated with a session.
    pub async fn suspend_session(
        &self,
        project_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        self.manager
            .suspend_session_terminals(project_id, session_id)
            .await
    }

    /// Resume all terminals associated with a session.
    pub async fn resume_session(
        &self,
        project_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        self.manager
            .resume_session_terminals(project_id, session_id)
            .await
    }

    /// Close all known terminals and clean up any orphaned processes.
    pub async fn cleanup_all(&self) -> Result<(), String> {
        self.manager.cleanup_all().await
    }

    /// Force kill all terminal processes regardless of state.
    pub async fn force_kill_all(&self) -> Result<(), String> {
        self.manager.force_kill_all().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn gateway_can_cleanup_without_terminals() {
        let gateway = ProjectTerminalGateway::new();
        // Should be a no-op but still succeed.
        gateway.cleanup_all().await.unwrap();
    }

    #[tokio::test]
    async fn gateway_force_kill_succeeds_when_idle() {
        let gateway = ProjectTerminalGateway::new();
        gateway.force_kill_all().await.unwrap();
    }
}

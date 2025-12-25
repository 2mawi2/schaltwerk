use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchaltEvent {
    SessionsRefreshed,
    SessionAdded,
    SessionRemoved,
    ArchiveUpdated,
    SessionCancelling,
    CancelError,
    TerminalCreated,

    SessionActivity,
    SessionGitStats,
    TerminalAttention,
    TerminalClosed,
    TerminalForceScroll,
    TerminalAgentStarted,
    AgentCrashed,
    GlobalKeepAwakeStateChanged,
    ProjectReady,
    OpenDirectory,
    OpenHome,
    FileChanges,
    FollowUpMessage,
    Selection,
    GitOperationStarted,
    GitOperationCompleted,
    GitOperationFailed,
    ProjectFilesUpdated,
    GitHubStatusChanged,
    DevBackendError,
    SetupScriptRequested,
    OrchestratorLaunchFailed,
    DiffBaseBranchChanged,
    ProjectValidationError,
    OpenPrModal,
    SelectAllRequested,
}

impl SchaltEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchaltEvent::SessionsRefreshed => "schaltwerk:sessions-refreshed",
            SchaltEvent::SessionAdded => "schaltwerk:session-added",
            SchaltEvent::SessionRemoved => "schaltwerk:session-removed",
            SchaltEvent::ArchiveUpdated => "schaltwerk:archive-updated",
            SchaltEvent::SessionCancelling => "schaltwerk:session-cancelling",
            SchaltEvent::CancelError => "schaltwerk:cancel-error",
            SchaltEvent::TerminalCreated => "schaltwerk:terminal-created",

            SchaltEvent::SessionActivity => "schaltwerk:session-activity",
            SchaltEvent::SessionGitStats => "schaltwerk:session-git-stats",
            SchaltEvent::TerminalAttention => "schaltwerk:terminal-attention",
            SchaltEvent::TerminalClosed => "schaltwerk:terminal-closed",
            SchaltEvent::TerminalForceScroll => "schaltwerk:terminal-force-scroll",
            SchaltEvent::TerminalAgentStarted => "schaltwerk:terminal-agent-started",
            SchaltEvent::AgentCrashed => "schaltwerk:agent-crashed",
            SchaltEvent::GlobalKeepAwakeStateChanged => {
                "schaltwerk:global-keep-awake-state-changed"
            }
            SchaltEvent::ProjectReady => "schaltwerk:project-ready",
            SchaltEvent::OpenDirectory => "schaltwerk:open-directory",
            SchaltEvent::OpenHome => "schaltwerk:open-home",
            SchaltEvent::FileChanges => "schaltwerk:file-changes",
            SchaltEvent::FollowUpMessage => "schaltwerk:follow-up-message",
            SchaltEvent::Selection => "schaltwerk:selection",
            SchaltEvent::GitOperationStarted => "schaltwerk:git-operation-started",
            SchaltEvent::GitOperationCompleted => "schaltwerk:git-operation-completed",
            SchaltEvent::GitOperationFailed => "schaltwerk:git-operation-failed",
            SchaltEvent::ProjectFilesUpdated => "schaltwerk:project-files-updated",
            SchaltEvent::GitHubStatusChanged => "schaltwerk:github-status-changed",
            SchaltEvent::DevBackendError => "schaltwerk:dev-backend-error",
            SchaltEvent::SetupScriptRequested => "schaltwerk:setup-script-request",
            SchaltEvent::OrchestratorLaunchFailed => "schaltwerk:orchestrator-launch-failed",
            SchaltEvent::DiffBaseBranchChanged => "schaltwerk:diff-base-branch-changed",
            SchaltEvent::ProjectValidationError => "schaltwerk:project-validation-error",
            SchaltEvent::OpenPrModal => "schaltwerk:open-pr-modal",
            SchaltEvent::SelectAllRequested => "schaltwerk:select-all-requested",
        }
    }
}

pub fn emit_event<R: tauri::Runtime, T: Serialize + Clone>(
    app: &tauri::AppHandle<R>,
    event: SchaltEvent,
    payload: &T,
) -> Result<(), tauri::Error> {
    app.emit(event.as_str(), payload)
}

#[cfg(test)]
mod tests {
    use super::SchaltEvent;

    #[test]
    fn test_event_names_for_new_variants() {
        assert_eq!(
            SchaltEvent::TerminalCreated.as_str(),
            "schaltwerk:terminal-created"
        );
        assert_eq!(
            SchaltEvent::TerminalAgentStarted.as_str(),
            "schaltwerk:terminal-agent-started"
        );
        assert_eq!(
            SchaltEvent::GitOperationStarted.as_str(),
            "schaltwerk:git-operation-started"
        );
        assert_eq!(
            SchaltEvent::GitOperationCompleted.as_str(),
            "schaltwerk:git-operation-completed"
        );
        assert_eq!(
            SchaltEvent::GitOperationFailed.as_str(),
            "schaltwerk:git-operation-failed"
        );
        assert_eq!(
            SchaltEvent::ProjectFilesUpdated.as_str(),
            "schaltwerk:project-files-updated"
        );
        assert_eq!(
            SchaltEvent::GitHubStatusChanged.as_str(),
            "schaltwerk:github-status-changed"
        );
        assert_eq!(
            SchaltEvent::DevBackendError.as_str(),
            "schaltwerk:dev-backend-error"
        );
        assert_eq!(
            SchaltEvent::SetupScriptRequested.as_str(),
            "schaltwerk:setup-script-request"
        );
        assert_eq!(
            SchaltEvent::OrchestratorLaunchFailed.as_str(),
            "schaltwerk:orchestrator-launch-failed"
        );
        assert_eq!(
            SchaltEvent::GlobalKeepAwakeStateChanged.as_str(),
            "schaltwerk:global-keep-awake-state-changed"
        );
        assert_eq!(
            SchaltEvent::SelectAllRequested.as_str(),
            "schaltwerk:select-all-requested"
        );
    }
}

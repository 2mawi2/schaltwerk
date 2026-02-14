use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchaltEvent {
    SessionsRefreshed,
    SessionAdded,
    SessionRemoved,
    SessionCancelling,
    CancelError,
    SessionActivity,
    SessionGitStats,
    TerminalAttention,
    TerminalClosed,
    TerminalForceScroll,
    TerminalOutputChanged,
    PtyData,
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
    AppUpdateResult,
    DevBackendError,
    SetupScriptRequested,
    CloneProgress,
    OrchestratorLaunchFailed,
    ProjectValidationError,
    OpenPrModal,
    OpenMergeModal,
    SelectAllRequested,
}

impl SchaltEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchaltEvent::SessionsRefreshed => "schaltwerk:sessions-refreshed",
            SchaltEvent::SessionAdded => "schaltwerk:session-added",
            SchaltEvent::SessionRemoved => "schaltwerk:session-removed",
            SchaltEvent::SessionCancelling => "schaltwerk:session-cancelling",
            SchaltEvent::CancelError => "schaltwerk:cancel-error",
            SchaltEvent::SessionActivity => "schaltwerk:session-activity",
            SchaltEvent::SessionGitStats => "schaltwerk:session-git-stats",
            SchaltEvent::TerminalAttention => "schaltwerk:terminal-attention",
            SchaltEvent::TerminalClosed => "schaltwerk:terminal-closed",
            SchaltEvent::TerminalForceScroll => "schaltwerk:terminal-force-scroll",
            SchaltEvent::TerminalOutputChanged => "schaltwerk:terminal-output-changed",
            SchaltEvent::PtyData => "schaltwerk:pty-data",
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
            SchaltEvent::AppUpdateResult => "schaltwerk:app-update-result",
            SchaltEvent::DevBackendError => "schaltwerk:dev-backend-error",
            SchaltEvent::SetupScriptRequested => "schaltwerk:setup-script-request",
            SchaltEvent::CloneProgress => "schaltwerk:clone-progress",
            SchaltEvent::OrchestratorLaunchFailed => "schaltwerk:orchestrator-launch-failed",
            SchaltEvent::ProjectValidationError => "schaltwerk:project-validation-error",
            SchaltEvent::OpenPrModal => "schaltwerk:open-pr-modal",
            SchaltEvent::OpenMergeModal => "schaltwerk:open-merge-modal",
            SchaltEvent::SelectAllRequested => "schaltwerk:select-all-requested",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloneProgressKind {
    Info,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgressPayload {
    pub request_id: String,
    pub message: String,
    pub remote: String,
    pub kind: CloneProgressKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectValidationErrorPayload {
    pub path: String,
    pub error: String,
}

pub fn emit_event<T: Serialize + Clone>(
    app: &tauri::AppHandle,
    event: SchaltEvent,
    payload: &T,
) -> Result<(), tauri::Error> {
    app.emit(event.as_str(), payload)
}

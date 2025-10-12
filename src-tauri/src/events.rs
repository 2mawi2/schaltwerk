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
    TerminalResumed,
    TerminalForceScroll,
    TerminalOutputChanged,
    PtyData,
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
            SchaltEvent::TerminalResumed => "schaltwerk:terminal-resumed",
            SchaltEvent::TerminalForceScroll => "schaltwerk:terminal-force-scroll",
            SchaltEvent::TerminalOutputChanged => "schaltwerk:terminal-output-changed",
            SchaltEvent::PtyData => "schaltwerk:pty-data",
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
        }
    }
}

pub fn emit_event<T: Serialize + Clone>(
    app: &tauri::AppHandle,
    event: SchaltEvent,
    payload: &T,
) -> Result<(), tauri::Error> {
    app.emit(event.as_str(), payload)
}

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SchaltEvent {
    SessionsRefreshed,
    SessionAdded,
    SessionRemoved,
    SessionCancelling,
    CancelError,
    ClaudeStarted,

    SessionActivity,
    SessionGitStats,
    TerminalClosed,
    TerminalResumed,
    TerminalForceScroll,
    TerminalOutputChanged,
    ProjectReady,
    OpenDirectory,
    OpenHome,
    FileChanges,
    FollowUpMessage,
    Selection,
    ProjectFilesUpdated,
}

impl SchaltEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchaltEvent::SessionsRefreshed => "schaltwerk:sessions-refreshed",
            SchaltEvent::SessionAdded => "schaltwerk:session-added",
            SchaltEvent::SessionRemoved => "schaltwerk:session-removed",
            SchaltEvent::SessionCancelling => "schaltwerk:session-cancelling",
            SchaltEvent::CancelError => "schaltwerk:cancel-error",
            SchaltEvent::ClaudeStarted => "schaltwerk:claude-started",

            SchaltEvent::SessionActivity => "schaltwerk:session-activity",
            SchaltEvent::SessionGitStats => "schaltwerk:session-git-stats",
            SchaltEvent::TerminalClosed => "schaltwerk:terminal-closed",
            SchaltEvent::TerminalResumed => "schaltwerk:terminal-resumed",
            SchaltEvent::TerminalForceScroll => "schaltwerk:terminal-force-scroll",
            SchaltEvent::TerminalOutputChanged => "schaltwerk:terminal-output-changed",
            SchaltEvent::ProjectReady => "schaltwerk:project-ready",
            SchaltEvent::OpenDirectory => "schaltwerk:open-directory",
            SchaltEvent::OpenHome => "schaltwerk:open-home",
            SchaltEvent::FileChanges => "schaltwerk:file-changes",
            SchaltEvent::FollowUpMessage => "schaltwerk:follow-up-message",
            SchaltEvent::Selection => "schaltwerk:selection",
            SchaltEvent::ProjectFilesUpdated => "schaltwerk:project-files-updated",
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

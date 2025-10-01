use crate::commands::sessions_refresh::request_sessions_refresh;
pub use crate::commands::sessions_refresh::SessionsRefreshReason;
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use tauri::AppHandle;

#[derive(serde::Serialize, Clone)]
pub struct SessionRemovedPayload {
    pub session_name: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SessionCancellingPayload {
    pub session_name: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SelectionPayload {
    pub kind: &'static str,
    pub payload: String,
    pub session_state: &'static str,
}

#[derive(serde::Serialize, Clone)]
pub struct GitOperationPayload {
    pub session_name: String,
    pub session_branch: String,
    pub parent_branch: String,
    pub mode: String,
    pub operation: &'static str,
    pub commit: Option<String>,
    pub status: &'static str,
}

#[derive(serde::Serialize, Clone)]
pub struct GitOperationFailedPayload {
    #[serde(flatten)]
    pub base: GitOperationPayload,
    pub error: String,
}

pub fn emit_session_removed(app: &AppHandle, name: &str) {
    let _ = emit_event(
        app,
        SchaltEvent::SessionRemoved,
        &SessionRemovedPayload {
            session_name: name.to_string(),
        },
    );
}

pub fn emit_session_cancelling(app: &AppHandle, name: &str) {
    let _ = emit_event(
        app,
        SchaltEvent::SessionCancelling,
        &SessionCancellingPayload {
            session_name: name.to_string(),
        },
    );
}

pub fn emit_selection_running(app: &AppHandle, name: &str) {
    let _ = emit_event(
        app,
        SchaltEvent::Selection,
        &SelectionPayload {
            kind: "session",
            payload: name.to_string(),
            session_state: "running",
        },
    );
}

pub fn emit_archive_updated(app: &AppHandle, repo: &str, count: usize) {
    let _ = emit_event(
        app,
        SchaltEvent::ArchiveUpdated,
        &serde_json::json!({
            "repo": repo, "count": count
        }),
    );
}

pub fn request_sessions_refreshed(app: &AppHandle, reason: SessionsRefreshReason) {
    request_sessions_refresh(app, reason);
}

pub fn emit_git_operation_started(
    app: &AppHandle,
    session_name: &str,
    session_branch: &str,
    parent_branch: &str,
    mode: &str,
) {
    let payload = GitOperationPayload {
        session_name: session_name.to_string(),
        session_branch: session_branch.to_string(),
        parent_branch: parent_branch.to_string(),
        mode: mode.to_string(),
        operation: "merge",
        commit: None,
        status: "started",
    };
    let _ = emit_event(app, SchaltEvent::GitOperationStarted, &payload);
}

pub fn emit_git_operation_completed(
    app: &AppHandle,
    session_name: &str,
    session_branch: &str,
    parent_branch: &str,
    mode: &str,
    commit: &str,
) {
    let payload = GitOperationPayload {
        session_name: session_name.to_string(),
        session_branch: session_branch.to_string(),
        parent_branch: parent_branch.to_string(),
        mode: mode.to_string(),
        operation: "merge",
        commit: Some(commit.to_string()),
        status: "success",
    };
    let _ = emit_event(app, SchaltEvent::GitOperationCompleted, &payload);
}

pub fn emit_git_operation_failed(
    app: &AppHandle,
    session_name: &str,
    session_branch: &str,
    parent_branch: &str,
    mode: &str,
    status: &'static str,
    error: &str,
) {
    let payload = GitOperationFailedPayload {
        base: GitOperationPayload {
            session_name: session_name.to_string(),
            session_branch: session_branch.to_string(),
            parent_branch: parent_branch.to_string(),
            mode: mode.to_string(),
            operation: "merge",
            commit: None,
            status,
        },
        error: error.to_string(),
    };
    let _ = emit_event(app, SchaltEvent::GitOperationFailed, &payload);
}

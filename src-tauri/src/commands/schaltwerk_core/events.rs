use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::domains::sessions::entity::EnrichedSession;
use tauri::AppHandle;

#[derive(serde::Serialize, Clone)]
pub struct SessionRemovedPayload { pub session_name: String }

#[derive(serde::Serialize, Clone)]
pub struct SessionCancellingPayload { pub session_name: String }

#[derive(serde::Serialize, Clone)]
pub struct SelectionPayload { pub kind: &'static str, pub payload: String, pub session_state: &'static str }

pub fn emit_session_removed(app: &AppHandle, name: &str) {
    let _ = emit_event(app, SchaltEvent::SessionRemoved, &SessionRemovedPayload {
        session_name: name.to_string(),
    });
}

pub fn emit_session_cancelling(app: &AppHandle, name: &str) {
    let _ = emit_event(app, SchaltEvent::SessionCancelling, &SessionCancellingPayload {
        session_name: name.to_string(),
    });
}

pub fn emit_selection_running(app: &AppHandle, name: &str) {
    let _ = emit_event(app, SchaltEvent::Selection, &SelectionPayload {
        kind: "session",
        payload: name.to_string(),
        session_state: "running",
    });
}

pub fn emit_archive_updated(app: &AppHandle, repo: &str, count: usize) {
    let _ = emit_event(app, SchaltEvent::ArchiveUpdated, &serde_json::json!({
        "repo": repo, "count": count
    }));
}

pub fn emit_sessions_refreshed(app: &AppHandle, sessions: &Vec<EnrichedSession>) {
    let _ = emit_event(app, SchaltEvent::SessionsRefreshed, sessions);
}

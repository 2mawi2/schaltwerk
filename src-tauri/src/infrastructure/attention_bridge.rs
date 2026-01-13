use crate::domains::attention::get_session_attention_state;
use log::{debug, warn};

/// Forward terminal attention events to the session attention state registry
/// for exposure via the MCP API.
pub fn update_session_attention_state(session_id: String, needs_attention: bool) {
    if let Some(registry) = get_session_attention_state() {
        debug!(
            "Updating attention state: session={session_id}, needs_attention={needs_attention}"
        );
        tauri::async_runtime::spawn(async move {
            let mut guard = registry.lock().await;
            guard.update(&session_id, needs_attention);
            debug!(
                "Attention state updated: session={session_id}, registry_size={}",
                guard.get_all().len()
            );
        });
    } else {
        warn!("SESSION_ATTENTION_STATE not initialized, cannot update attention for {session_id}");
    }
}

/// Clear attention state for a session when it is removed.
pub fn clear_session_attention_state(session_id: String) {
    if let Some(registry) = get_session_attention_state() {
        tauri::async_runtime::spawn(async move {
            let mut guard = registry.lock().await;
            guard.clear_session(&session_id);
        });
    }
}

use crate::domains::power::global_service::get_global_keep_awake_service;

/// Forward terminal attention events to the global keep-awake service without creating
/// domain-to-domain dependencies.
pub fn handle_terminal_attention(session_id: String, needs_attention: bool) {
    if let Some(service) = get_global_keep_awake_service() {
        tauri::async_runtime::spawn(async move {
            if let Err(err) = service
                .handle_session_activity(session_id, needs_attention)
                .await
            {
                log::debug!("Keep-awake service failed to handle session activity: {err}");
            }
        });
    }
}

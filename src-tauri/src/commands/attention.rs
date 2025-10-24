use crate::ATTENTION_REGISTRY;
use log::trace;
#[cfg(target_os = "macos")]
use tauri::Manager;
use schaltwerk::domains::attention::AttentionStateRegistry;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSnapshotResponse {
    pub total_count: usize,
    pub badge_label: Option<String>,
}

#[tauri::command]
pub async fn report_attention_snapshot(
    app: AppHandle,
    window_label: String,
    session_keys: Vec<String>,
) -> Result<AttentionSnapshotResponse, String> {
    let registry = ATTENTION_REGISTRY
        .get()
        .ok_or_else(|| "Attention registry not initialized".to_string())?;

    let normalized_label = {
        let trimmed = window_label.trim();
        if trimmed.is_empty() {
            "main".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let (total_count, badge_label) = {
        let mut guard = registry.lock().await;
        let total = guard.update_snapshot(normalized_label.clone(), session_keys);
        let badge = AttentionStateRegistry::badge_label(total);
        (total, badge)
    };

    #[cfg(target_os = "macos")]
    {
        let candidate = app
            .get_webview_window(&normalized_label)
            .or_else(|| app.get_webview_window("main"));
        if let Some(window) = candidate
            && let Err(err) = window.set_badge_label(badge_label.clone())
        {
            trace!("[attention] Failed to set badge label: {err}");
        }
    }

    Ok(AttentionSnapshotResponse {
        total_count,
        badge_label,
    })
}

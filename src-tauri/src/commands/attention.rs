use crate::ATTENTION_REGISTRY;
use schaltwerk::domains::attention::AttentionStateRegistry;
use serde::Serialize;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Manager;

const WINDOW_LABEL_FALLBACK: &str = "main";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSnapshotResponse {
    pub total_count: usize,
    pub badge_label: Option<String>,
}

#[tauri::command]
pub async fn report_attention_snapshot(
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))] app: AppHandle,
    window_label: String,
    session_keys: Vec<String>,
) -> Result<AttentionSnapshotResponse, String> {
    let registry = ATTENTION_REGISTRY
        .get()
        .ok_or_else(|| "Attention registry not initialized".to_string())?;

    let normalized_label = {
        let trimmed = window_label.trim();
        if trimmed.is_empty() {
            WINDOW_LABEL_FALLBACK.to_string()
        } else {
            trimmed.to_string()
        }
    };

    let (total_count, badge_count) = {
        let mut guard = registry.lock().await;
        let total = guard.update_snapshot(normalized_label.clone(), session_keys);
        let badge = AttentionStateRegistry::badge_count(total);
        (total, badge)
    };

    #[cfg(target_os = "macos")]
    {
        let candidate = app
            .get_webview_window(&normalized_label)
            .or_else(|| app.get_webview_window(WINDOW_LABEL_FALLBACK));
        if let Some(window) = candidate {
            let _ = window.set_badge_count(badge_count);
        }
    }

    Ok(AttentionSnapshotResponse {
        total_count,
        badge_label: badge_count.map(|count| {
            if count >= 99 {
                "99+".to_string()
            } else {
                count.to_string()
            }
        }),
    })
}

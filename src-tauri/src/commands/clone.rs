use crate::events::{CloneProgressKind, CloneProgressPayload, SchaltEvent, emit_event};
use crate::projects;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct CloneProjectResponse {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "defaultBranch")]
    pub default_branch: Option<String>,
    pub remote: String,
}

#[tauri::command]
pub async fn schaltwerk_core_clone_project(
    app: tauri::AppHandle,
    remote_url: String,
    parent_directory: String,
    folder_name: String,
    request_id: String,
) -> Result<CloneProjectResponse, String> {
    if remote_url.trim().is_empty() {
        return Err("Remote URL cannot be empty".to_string());
    }
    if folder_name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let parent_path = PathBuf::from(&parent_directory);
    let remote_meta = projects::sanitize_clone_remote(remote_url.trim());

    let emit_progress = |kind: CloneProgressKind, message: &str| {
        let payload = CloneProgressPayload {
            request_id: request_id.clone(),
            message: message.to_string(),
            remote: remote_meta.display.clone(),
            kind,
        };
        if let Err(err) = emit_event(&app, SchaltEvent::CloneProgress, &payload) {
            log::debug!("Failed to emit clone progress event: {err}");
        }
    };

    emit_progress(CloneProgressKind::Info, "Preparing clone…");

    let clone_result = projects::clone_remote_project(
        remote_url.trim(),
        &parent_path,
        folder_name.trim(),
        |line| emit_progress(CloneProgressKind::Info, line),
    )
    .map_err(|err| {
        emit_progress(CloneProgressKind::Error, &format!("{err}"));
        format!("Failed to clone repository: {err}")
    })?;

    emit_progress(CloneProgressKind::Success, "Clone completed");

    // Persist project history entry
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history
        .add_project(
            clone_result
                .project_path
                .to_str()
                .ok_or_else(|| "Invalid UTF-8 in project path".to_string())?,
        )
        .map_err(|e| format!("Failed to update project history: {e}"))?;

    Ok(CloneProjectResponse {
        project_path: clone_result.project_path.to_string_lossy().to_string(),
        default_branch: clone_result.default_branch,
        remote: clone_result.remote_display,
    })
}

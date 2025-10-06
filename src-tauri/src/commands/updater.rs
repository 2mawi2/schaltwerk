use crate::updater::{self, UpdateResultPayload};
use tauri::AppHandle;

#[tauri::command]
pub async fn check_for_updates_now(app: AppHandle) -> Result<UpdateResultPayload, String> {
    Ok(updater::run_manual_update(&app).await)
}

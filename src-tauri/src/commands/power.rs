use schaltwerk::services::power::{
    disable_global_keep_awake as disable_global_keep_awake_service,
    enable_global_keep_awake as enable_global_keep_awake_service,
    get_global_keep_awake_state as get_global_keep_awake_state_service,
};
use schaltwerk::services::GlobalState;

#[tauri::command]
pub async fn get_global_keep_awake_state() -> Result<GlobalState, String> {
    get_global_keep_awake_state_service().await
}

#[tauri::command]
pub async fn enable_global_keep_awake() -> Result<GlobalState, String> {
    enable_global_keep_awake_service().await
}

#[tauri::command]
pub async fn disable_global_keep_awake() -> Result<GlobalState, String> {
    disable_global_keep_awake_service().await
}

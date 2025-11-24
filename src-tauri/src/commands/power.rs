use schaltwerk::services::power::{
    disable_global_keep_awake as disable_global_keep_awake_service,
    enable_global_keep_awake as enable_global_keep_awake_service,
    get_global_keep_awake_state as get_global_keep_awake_state_service, get_power_service,
    get_power_settings as get_power_settings_service,
    set_power_settings as set_power_settings_service,
};
use schaltwerk::services::{GlobalState, PowerSettings};

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

#[tauri::command]
pub async fn get_power_settings() -> Result<PowerSettings, String> {
    get_power_settings_service().await
}

#[tauri::command]
pub async fn set_power_settings(settings: PowerSettings) -> Result<PowerSettings, String> {
    // Ensure the service is available before attempting to set settings to provide a clearer error
    let _ = get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    set_power_settings_service(settings).await
}

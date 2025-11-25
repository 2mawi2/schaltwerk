use std::collections::HashSet;
use std::sync::Arc;

use crate::domains::power::global_service::GlobalInhibitorService;
use crate::domains::power::global_service::get_global_keep_awake_service;
use crate::domains::power::types::GlobalState;

pub type DynPowerService = Arc<GlobalInhibitorService>;

pub fn get_power_service() -> Option<DynPowerService> {
    get_global_keep_awake_service()
}

pub async fn enable_global_keep_awake() -> Result<GlobalState, String> {
    let service =
        get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    service.enable_global().await.map_err(|e| e.to_string())
}

pub async fn disable_global_keep_awake() -> Result<GlobalState, String> {
    let service =
        get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    service.disable_global().await.map_err(|e| e.to_string())
}

pub async fn get_global_keep_awake_state() -> Result<GlobalState, String> {
    let service =
        get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    Ok(service.broadcast_state().await)
}

pub async fn handle_terminal_attention(
    session_id: String,
    is_idle: bool,
) -> Result<GlobalState, String> {
    let service =
        get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    service
        .handle_session_activity(session_id, is_idle)
        .await
        .map_err(|e| e.to_string())
}

pub async fn sync_running_sessions(
    project_path: String,
    running_sessions: HashSet<String>,
) -> Result<GlobalState, String> {
    let service =
        get_power_service().ok_or_else(|| "Keep-awake service not initialized".to_string())?;
    service
        .sync_running_sessions(project_path, running_sessions)
        .await
        .map_err(|e| e.to_string())
}

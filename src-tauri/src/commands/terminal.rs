use schaltwerk::services::terminals::{
    CreateRunTerminalRequest, CreateTerminalRequest, CreateTerminalWithSizeRequest,
};
use schaltwerk::services::ServiceHandles;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSessionTerminalsPayload {
    project_id: String,
    session_id: Option<String>,
    terminal_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTerminalActionPayload {
    project_id: String,
    session_id: Option<String>,
}

#[tauri::command]
pub async fn create_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
) -> Result<String, String> {
    services
        .terminals
        .create_terminal(CreateTerminalRequest {
            id,
            cwd,
            env: vec![],
        })
        .await
}

/// Create a terminal with an interactive shell for running commands.
/// This spawns an interactive shell that stays alive after commands complete,
/// allowing the UI to preserve output history and run additional commands.
#[tauri::command]
pub async fn create_run_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
    _command: String,
    env: Option<Vec<(String, String)>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    services
        .terminals
        .create_run_terminal(CreateRunTerminalRequest {
            id,
            cwd,
            env,
            cols,
            rows,
        })
        .await
}

#[tauri::command]
pub async fn create_terminal_with_size(
    services: State<'_, ServiceHandles>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    services
        .terminals
        .create_terminal_with_size(CreateTerminalWithSizeRequest {
            id,
            cwd,
            cols,
            rows,
        })
        .await
}

#[tauri::command]
pub async fn write_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    data: String,
) -> Result<(), String> {
    services
        .terminals
        .write_terminal(id, data.into_bytes())
        .await
}

#[tauri::command]
pub async fn paste_and_submit_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    data: String,
    use_bracketed_paste: Option<bool>,
) -> Result<(), String> {
    services
        .terminals
        .paste_and_submit_terminal(id, data.into_bytes(), use_bracketed_paste.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn resize_terminal(
    services: State<'_, ServiceHandles>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    services.terminals.resize_terminal(id, cols, rows).await
}

#[tauri::command]
pub async fn close_terminal(services: State<'_, ServiceHandles>, id: String) -> Result<(), String> {
    services.terminals.close_terminal(id).await
}

#[tauri::command]
pub async fn terminal_exists(
    services: State<'_, ServiceHandles>,
    id: String,
) -> Result<bool, String> {
    services.terminals.terminal_exists(id).await
}

#[tauri::command]
pub async fn terminals_exist_bulk(
    services: State<'_, ServiceHandles>,
    ids: Vec<String>,
) -> Result<Vec<(String, bool)>, String> {
    services.terminals.terminals_exist_bulk(ids).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBufferResponse {
    pub seq: u64,
    pub start_seq: u64,
    pub data: String,
}

#[tauri::command]
pub async fn get_terminal_buffer(
    services: State<'_, ServiceHandles>,
    id: String,
    from_seq: Option<u64>,
) -> Result<TerminalBufferResponse, String> {
    let snapshot = services.terminals.get_terminal_buffer(id, from_seq).await?;
    let data = String::from_utf8_lossy(&snapshot.data).to_string();
    Ok(TerminalBufferResponse {
        seq: snapshot.seq,
        start_seq: snapshot.start_seq,
        data,
    })
}

#[tauri::command]
pub async fn get_terminal_activity_status(
    services: State<'_, ServiceHandles>,
    id: String,
) -> Result<(bool, u64), String> {
    services.terminals.get_terminal_activity_status(id).await
}

#[tauri::command]
pub async fn get_all_terminal_activity(
    services: State<'_, ServiceHandles>,
) -> Result<Vec<(String, u64)>, String> {
    services.terminals.get_all_terminal_activity().await
}

#[tauri::command]
pub async fn register_session_terminals(
    services: State<'_, ServiceHandles>,
    payload: RegisterSessionTerminalsPayload,
) -> Result<(), String> {
    services
        .terminals
        .register_session_terminals(payload.project_id, payload.session_id, payload.terminal_ids)
        .await
}

#[tauri::command]
pub async fn suspend_session_terminals(
    services: State<'_, ServiceHandles>,
    payload: SessionTerminalActionPayload,
) -> Result<(), String> {
    services
        .terminals
        .suspend_session_terminals(payload.project_id, payload.session_id)
        .await
}

#[tauri::command]
pub async fn resume_session_terminals(
    services: State<'_, ServiceHandles>,
    payload: SessionTerminalActionPayload,
) -> Result<(), String> {
    services
        .terminals
        .resume_session_terminals(payload.project_id, payload.session_id)
        .await
}

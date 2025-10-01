use pty_host::{
    AckRequest, KillRequest, ResizeRequest, SpawnOptions, SpawnRequest, SpawnResponse,
    SubscribeRequest, SubscribeResponse, WriteRequest,
};
use serde::Deserialize;
use tauri::AppHandle;

use schaltwerk::infrastructure::pty::get_pty_host;

#[tauri::command]
pub async fn pty_spawn(app: AppHandle, options: SpawnOptions) -> Result<SpawnResponse, String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager.spawn(SpawnRequest { options }).await
}

#[tauri::command]
pub async fn pty_write(app: AppHandle, term_id: String, utf8: String) -> Result<(), String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager.write(WriteRequest { term_id, utf8 }).await
}

#[tauri::command]
pub async fn pty_resize(
    app: AppHandle,
    term_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager
        .resize(ResizeRequest {
            term_id,
            rows,
            cols,
        })
        .await
}

#[tauri::command]
pub async fn pty_kill(app: AppHandle, term_id: String) -> Result<(), String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager.kill(KillRequest { term_id }).await
}

#[tauri::command]
pub async fn pty_ack(
    app: AppHandle,
    term_id: String,
    seq: u64,
    bytes: usize,
) -> Result<(), String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager
        .ack(AckRequest {
            term_id,
            seq,
            bytes,
        })
        .await
}

#[derive(Debug, Deserialize)]
pub struct SubscribeParams {
    pub term_id: String,
    pub last_seen_seq: Option<u64>,
}

#[tauri::command]
pub async fn pty_subscribe(
    app: AppHandle,
    params: SubscribeParams,
) -> Result<SubscribeResponse, String> {
    let manager = get_pty_host();
    manager.set_app_handle(app);
    manager
        .subscribe(SubscribeRequest {
            term_id: params.term_id,
            last_seen_seq: params.last_seen_seq,
        })
        .await
}

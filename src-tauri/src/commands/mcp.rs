use schaltwerk::services::{mcp::get_mcp_server_process as service_mcp_process, ServiceHandles};
use std::sync::Arc;
use tauri::State;
use tokio::sync::{Mutex, OnceCell};

#[tauri::command]
pub async fn start_mcp_server(
    services: State<'_, ServiceHandles>,
    port: Option<u16>,
) -> Result<(), String> {
    services.mcp.start_server(port).await
}

pub fn get_mcp_server_process() -> &'static OnceCell<Arc<Mutex<Option<std::process::Child>>>> {
    service_mcp_process()
}

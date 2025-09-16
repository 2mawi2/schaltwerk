use std::process::Command;
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

static MCP_SERVER_PROCESS: OnceCell<Arc<Mutex<Option<std::process::Child>>>> =
    OnceCell::const_new();

#[tauri::command]
pub async fn start_mcp_server(_port: Option<u16>) -> Result<(), String> {
    let process_mutex = MCP_SERVER_PROCESS
        .get_or_init(|| async { Arc::new(Mutex::new(None)) })
        .await;

    let mut process_guard = process_mutex.lock().await;

    if let Some(ref mut process) = *process_guard {
        match process.try_wait() {
            Ok(Some(status)) => {
                log::info!("Previous MCP server process exited with status: {status:?}");
            }
            Ok(None) => {
                log::info!("MCP server is already running");
                return Ok(());
            }
            Err(e) => {
                log::warn!("Error checking MCP server status: {e}");
            }
        }
    }

    let mcp_server_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Failed to get project root".to_string())?
        .join("mcp-server")
        .join("build")
        .join("schaltwerk-mcp-server.js");

    log::info!("MCP server path: {}", mcp_server_path.display());

    if !mcp_server_path.exists() {
        let error = format!("MCP server not found at: {}", mcp_server_path.display());
        log::error!("{error}");
        return Err(error);
    }

    log::info!("Starting MCP server process with node...");

    let child = Command::new("node")
        .arg(&mcp_server_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            let error = format!("Failed to start MCP server: {e}");
            log::error!("{error}");
            error
        })?;

    log::info!(
        "MCP server process started successfully with PID: {:?}",
        child.id()
    );

    *process_guard = Some(child);

    Ok(())
}

pub fn get_mcp_server_process() -> &'static OnceCell<Arc<Mutex<Option<std::process::Child>>>> {
    &MCP_SERVER_PROCESS
}

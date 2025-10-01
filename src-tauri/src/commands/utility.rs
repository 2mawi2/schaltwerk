use crate::get_project_manager;
use std::path::Path;

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn get_current_directory() -> Result<String, String> {
    // First check if a specific start directory was set via environment variable
    // This is used by 'just run' to ensure the app always starts from HOME
    if let Ok(start_dir) = std::env::var("SCHALTWERK_START_DIR") {
        log::info!("Using SCHALTWERK_START_DIR: {start_dir}");
        return Ok(start_dir);
    }

    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        Ok(project.path.to_string_lossy().to_string())
    } else {
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;

        if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            current_dir
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| "Failed to get parent directory".to_string())
        } else {
            Ok(current_dir.to_string_lossy().to_string())
        }
    }
}

#[tauri::command]
pub async fn open_in_vscode(worktree_path: String) -> Result<(), String> {
    log::info!("Opening VSCode for worktree: {worktree_path}");

    let output = std::process::Command::new("code")
        .arg(&worktree_path)
        .output()
        .map_err(|e| {
            log::error!("Failed to execute VSCode command: {e}");
            format!("Failed to open VSCode: {e}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("VSCode command failed: {stderr}");
        return Err(format!("VSCode command failed: {stderr}"));
    }

    log::info!("Successfully opened VSCode for: {worktree_path}");
    Ok(())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn schaltwerk_core_log_frontend_message(level: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "error" => log::error!("{message}"),
        "warn" => log::warn!("{message}"),
        "info" => log::info!("{message}"),
        "debug" => log::debug!("{message}"),
        _ => log::info!("{message}"),
    }
    Ok(())
}

const ALLOWED_ENV_VARS: &[&str] = &["SCHALTWERK_TERMINAL_TRANSPORT"];

#[tauri::command]
pub fn get_environment_variable(name: String) -> Result<Option<String>, String> {
    if !ALLOWED_ENV_VARS.contains(&name.as_str()) {
        return Err(format!("Environment variable '{name}' is not accessible"));
    }

    Ok(std::env::var(&name).ok())
}

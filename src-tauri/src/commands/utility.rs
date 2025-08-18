use crate::get_project_manager;

#[tauri::command]
pub async fn get_current_directory() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        Ok(project.path.to_string_lossy().to_string())
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        
        if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            current_dir.parent()
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
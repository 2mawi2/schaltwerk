use crate::{get_project_manager, projects};
use schaltwerk::services::ServiceHandles;
use tauri::State;

#[tauri::command]
pub fn get_recent_projects() -> Result<Vec<projects::RecentProject>, String> {
    let history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    Ok(history.get_recent_projects())
}

#[tauri::command]
pub fn add_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history
        .add_project(&path)
        .map_err(|e| format!("Failed to add project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_recent_project_timestamp(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history
        .update_timestamp(&path)
        .map_err(|e| format!("Failed to update project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history
        .remove_project(&path)
        .map_err(|e| format!("Failed to remove project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn is_git_repository(path: String) -> Result<bool, String> {
    Ok(projects::is_git_repository(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn directory_exists(path: String) -> Result<bool, String> {
    Ok(projects::directory_exists(std::path::Path::new(&path)))
}

#[tauri::command]
pub fn create_new_project(name: String, parent_path: String) -> Result<String, String> {
    let project_path =
        projects::create_new_project(&name, &parent_path).map_err(|e| format!("{e}"))?;

    Ok(project_path
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string())
}

#[tauri::command]
pub async fn initialize_project(
    services: State<'_, ServiceHandles>,
    path: String,
) -> Result<(), String> {
    services.projects.initialize_project(path).await
}

#[tauri::command]
pub async fn get_active_project_path() -> Result<Option<String>, String> {
    let manager = get_project_manager().await;
    let current = manager.current_project_path().await;
    Ok(current.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn close_project(path: String) -> Result<(), String> {
    log::info!("🧹 Close project command called with path: {path}");

    let manager = get_project_manager().await;

    // CRITICAL: Do NOT cancel sessions on project close - sessions should persist
    // Sessions represent user work that should only be cancelled by explicit user action
    // See CLAUDE.md for session lifecycle rules

    // Close all terminals for the specified project (not the current one)
    if let Err(e) = manager
        .cleanup_project_terminals(&std::path::PathBuf::from(&path))
        .await
    {
        log::warn!("Failed to cleanup terminals for project {path}: {e}");
    }

    // Note: We do NOT clear the saved selection or cancel sessions
    // Sessions and selection should persist for when the project is reopened

    log::info!("✅ Project {path} closed and cleaned up");
    Ok(())
}

#[tauri::command]
pub async fn get_project_default_branch() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        schaltwerk::domains::git::get_default_branch(&project.path)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    } else {
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;
        schaltwerk::domains::git::get_default_branch(&current_dir)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    }
}

#[tauri::command]
pub async fn list_project_branches() -> Result<Vec<String>, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        schaltwerk::domains::git::list_branches(&project.path)
            .map_err(|e| format!("Failed to list branches: {e}"))
    } else {
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;
        schaltwerk::domains::git::list_branches(&current_dir)
            .map_err(|e| format!("Failed to list branches: {e}"))
    }
}

#[tauri::command]
pub async fn repository_is_empty() -> Result<bool, String> {
    let manager = get_project_manager().await;
    let repo_path = if let Ok(project) = manager.current_project().await {
        project.path.clone()
    } else {
        std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?
    };

    Ok(!schaltwerk::domains::git::repository_has_commits(&repo_path).unwrap_or(true))
}

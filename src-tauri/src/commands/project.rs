use crate::{get_project_manager, projects};
use std::path::PathBuf;

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
    history.add_project(&path)
        .map_err(|e| format!("Failed to add project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn update_recent_project_timestamp(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.update_timestamp(&path)
        .map_err(|e| format!("Failed to update project: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_recent_project(path: String) -> Result<(), String> {
    let mut history = projects::ProjectHistory::load()
        .map_err(|e| format!("Failed to load project history: {e}"))?;
    history.remove_project(&path)
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
    let project_path = projects::create_new_project(&name, &parent_path)
        .map_err(|e| format!("{e}"))?;
    
    Ok(project_path.to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string())
}

#[tauri::command]
pub async fn initialize_project(path: String) -> Result<(), String> {
    log::info!("🔧 Initialize project command called with path: {path}");
    
    let path = PathBuf::from(&path);
    
    // Log detailed path information
    if path.exists() {
        log::info!("  Path exists: {}", path.display());
        if path.is_dir() {
            log::info!("  Path is a directory");
        } else {
            log::warn!("  Path is not a directory!");
        }
        
        // Check if it's a git repository
        if path.join(".git").exists() {
            log::info!("  ✅ Git repository detected (.git folder exists)");
        } else {
            log::warn!("  ⚠️ No .git folder found - not a git repository");
        }
    } else {
        log::error!("  ❌ Path does not exist: {}", path.display());
    }
    
    let manager = get_project_manager().await;
    
    log::info!("Switching to project: {}", path.display());
    manager.switch_to_project(path)
        .await
        .map_err(|e| {
            log::error!("Failed to initialize project: {e}");
            format!("Failed to initialize project: {e}")
        })?;
    
    log::info!("✅ Project initialized successfully");
    Ok(())
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

    let path_buf = std::path::PathBuf::from(&path);
    let manager = get_project_manager().await;

    // Get the project instance to clean up its resources
    if let Ok(project) = manager.get_schaltwerk_core_for_path(&path_buf).await {
        // Cancel all sessions for this project
        let schaltwerk_core = project.lock().await;
        let session_manager = schaltwerk_core.session_manager();
        let sessions = session_manager.list_sessions()
            .map_err(|e| format!("Failed to list sessions: {e}"))?;

        for session in sessions {
            if let Err(e) = session_manager.cancel_session(&session.name) {
                log::warn!("Failed to cancel session {name} during project close: {e}", name = session.name);
            }
        }
        drop(schaltwerk_core);

        // Close all terminals for this project
        if let Ok(terminal_manager) = manager.current_terminal_manager().await {
            if let Err(e) = terminal_manager.cleanup_all().await {
                log::warn!("Failed to cleanup terminals for project {path}: {e}");
            }
        }

        // Clear the saved selection for this project since all sessions are cancelled
        let schaltwerk_core = project.lock().await;
        let db = schaltwerk_core.database();
        use crate::schaltwerk_core::db_project_config::ProjectConfigMethods;
        if let Err(e) = db.set_project_selection(&path_buf, &crate::schaltwerk_core::db_project_config::ProjectSelection {
            kind: "orchestrator".to_string(),
            payload: None,
        }) {
            log::warn!("Failed to clear saved selection for project {path}: {e}");
        }
    } else {
        log::warn!("Project {path} not found for cleanup");
    }

    log::info!("✅ Project {path} closed and cleaned up");
    Ok(())
}

#[tauri::command]
pub async fn get_project_default_branch() -> Result<String, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::schaltwerk_core::git::get_default_branch(&project.path)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::schaltwerk_core::git::get_default_branch(&current_dir)
            .map_err(|e| format!("Failed to get default branch: {e}"))
    }
}

#[tauri::command]
pub async fn list_project_branches() -> Result<Vec<String>, String> {
    let manager = get_project_manager().await;
    if let Ok(project) = manager.current_project().await {
        crate::schaltwerk_core::git::list_branches(&project.path)
            .map_err(|e| format!("Failed to list branches: {e}"))
    } else {
        let current_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?;
        crate::schaltwerk_core::git::list_branches(&current_dir)
            .map_err(|e| format!("Failed to list branches: {e}"))
    }
}

#[tauri::command]
pub async fn repository_is_empty() -> Result<bool, String> {
    let manager = get_project_manager().await;
    let repo_path = if let Ok(project) = manager.current_project().await {
        project.path.clone()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {e}"))?
    };
    
    Ok(!crate::schaltwerk_core::git::repository_has_commits(&repo_path).unwrap_or(true))
}
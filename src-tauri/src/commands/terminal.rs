use crate::{get_terminal_manager, PROJECT_MANAGER};
use schaltwerk::schaltwerk_core::db_project_config::ProjectConfigMethods;
use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
use serde::Deserialize;

#[tauri::command]
pub async fn create_terminal(app: tauri::AppHandle, id: String, cwd: String) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.set_app_handle(app.clone()).await;
    
    // Get project environment variables if we have a project
    let env_vars = if let Some(project_manager) = PROJECT_MANAGER.get() {
        if let Ok(project) = project_manager.current_project().await {
            let core = project.schaltwerk_core.lock().await;
            let db = core.database();
            db.get_project_environment_variables(&project.path)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<(String, String)>>()
        } else {
            vec![]
        }
    } else {
        vec![]
    };
    
    if !env_vars.is_empty() {
        log::info!("Adding {} project environment variables to terminal {}", env_vars.len(), id);
        manager.create_terminal_with_env(id.clone(), cwd, env_vars).await?;
    } else {
        manager.create_terminal(id.clone(), cwd).await?;
    }
    
    
    Ok(id)
}

/// Create a terminal with an interactive shell for running commands.
/// This spawns an interactive shell that stays alive after commands complete,
/// allowing the UI to preserve output history and run additional commands.
#[tauri::command]
pub async fn create_run_terminal(
    app: tauri::AppHandle,
    id: String,
    cwd: String,
    _command: String,
    env: Option<Vec<(String, String)>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.set_app_handle(app.clone()).await;

    // Merge project-level env with provided env (provided takes precedence)
    let mut env_vars: Vec<(String, String)> = if let Some(project_manager) = PROJECT_MANAGER.get() {
        if let Ok(project) = project_manager.current_project().await {
            let core = project.schaltwerk_core.lock().await;
            let db = core.database();
            db.get_project_environment_variables(&project.path)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<(String, String)>>()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    if let Some(mut provided) = env {
        // Remove duplicates from base by key, then extend with provided
        let provided_keys: std::collections::HashSet<String> = provided.iter().map(|(k, _)| k.clone()).collect();
        env_vars.retain(|(k, _)| !provided_keys.contains(k));
        env_vars.append(&mut provided);
    }

    // Spawn an interactive shell instead of bash -lc to keep terminal alive after command
    // This allows preserving output and running additional commands
    let bash = "/bin/bash".to_string();
    let args = vec!["-l".to_string()]; // Interactive login shell

    if let (Some(c), Some(r)) = (cols, rows) {
        manager
            .create_terminal_with_app_and_size(
                CreateTerminalWithAppAndSizeParams {
                    id: id.clone(),
                    cwd,
                    command: bash,
                    args,
                    env: env_vars,
                    cols: c,
                    rows: r,
                },
            )
            .await?;
    } else {
        manager
            .create_terminal_with_app(id.clone(), cwd, bash, args, env_vars)
            .await?;
    }

    Ok(id)
}

#[tauri::command]
pub async fn create_terminal_with_size(app: tauri::AppHandle, id: String, cwd: String, cols: u16, rows: u16) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.set_app_handle(app.clone()).await;
    
    // Get project environment variables if we have a project
    let env_vars = if let Some(project_manager) = PROJECT_MANAGER.get() {
        if let Ok(project) = project_manager.current_project().await {
            let core = project.schaltwerk_core.lock().await;
            let db = core.database();
            db.get_project_environment_variables(&project.path)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<(String, String)>>()
        } else {
            vec![]
        }
    } else {
        vec![]
    };
    
    log::info!("Creating terminal {id} with initial size {cols}x{rows}");
    
    if !env_vars.is_empty() {
        log::info!("Adding {} project environment variables to terminal {}", env_vars.len(), id);
        manager.create_terminal_with_size_and_env(id.clone(), cwd, cols, rows, env_vars).await?;
    } else {
        manager.create_terminal_with_size(id.clone(), cwd, cols, rows).await?;
    }
    
    
    Ok(id)
}

#[tauri::command]
pub async fn write_terminal(id: String, data: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.write_terminal(id, data.into_bytes()).await
}

#[tauri::command]
pub async fn paste_and_submit_terminal(id: String, data: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.paste_and_submit_terminal(id, data.into_bytes()).await
}

#[tauri::command]
pub async fn resize_terminal(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.resize_terminal(id, cols, rows).await
}

#[tauri::command]
pub async fn close_terminal(id: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.close_terminal(id).await
}

#[tauri::command]
pub async fn terminal_exists(id: String) -> Result<bool, String> {
    let manager = get_terminal_manager().await?;
    manager.terminal_exists(&id).await
}

#[tauri::command]
pub async fn terminals_exist_bulk(ids: Vec<String>) -> Result<Vec<(String, bool)>, String> {
    let manager = get_terminal_manager().await?;
    
    // Check all terminals in parallel using join_all
    let futures: Vec<_> = ids.into_iter().map(|id| {
        let manager = manager.clone();
        async move {
            let exists = manager.terminal_exists(&id).await.unwrap_or(false);
            (id, exists)
        }
    }).collect();
    
    let results = ::futures::future::join_all(futures).await;
    Ok(results)
}

#[tauri::command]
pub async fn get_terminal_buffer(id: String) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.get_terminal_buffer(id).await
}

#[tauri::command]
pub async fn get_terminal_activity_status(id: String) -> Result<(bool, u64), String> {
    let manager = get_terminal_manager().await?;
    manager.get_terminal_activity_status(id).await
}

#[tauri::command]
pub async fn get_all_terminal_activity() -> Result<Vec<(String, bool, u64)>, String> {
    let manager = get_terminal_manager().await?;
    Ok(manager.get_all_terminal_activity().await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRegistration {
    pub project_id: String,
    pub session_id: Option<String>,
    pub terminal_ids: Vec<String>,
}

#[tauri::command]
pub async fn register_session_terminals(payload: TerminalSessionRegistration) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    for id in &payload.terminal_ids {
        manager
            .register_terminal(&payload.project_id, payload.session_id.as_deref(), id)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn suspend_session_terminals(project_id: String, session_id: Option<String>) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager
        .suspend_session_terminals(&project_id, session_id.as_deref())
        .await
}

#[tauri::command]
pub async fn resume_session_terminals(project_id: String, session_id: Option<String>) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager
        .resume_session_terminals(&project_id, session_id.as_deref())
        .await
}

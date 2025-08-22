use crate::{get_terminal_manager, get_message_queue, PROJECT_MANAGER};
use tauri::Emitter;
use crate::para_core::db_project_config::ProjectConfigMethods;

#[tauri::command]
pub async fn create_terminal(app: tauri::AppHandle, id: String, cwd: String) -> Result<String, String> {
    let manager = get_terminal_manager().await?;
    manager.set_app_handle(app.clone()).await;
    
    // Get project environment variables if we have a project
    let env_vars = if let Some(project_manager) = PROJECT_MANAGER.get() {
        if let Ok(project) = project_manager.current_project().await {
            let core = project.para_core.lock().await;
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
    
    let queue = get_message_queue().await;
    let mut queue_lock = queue.lock().await;
    if let Some(messages) = queue_lock.remove(&id) {
        log::info!("Delivering {} queued messages to terminal {}", messages.len(), id);
        drop(queue_lock);
        
        for queued_msg in messages {
            let message = &queued_msg.message;
            let formatted_message = match queued_msg.message_type.as_str() {
                "system" => format!("\n📢 System: {message}\n"),
                _ => format!("\n💬 Follow-up: {message}\n"),
            };
            
            if let Err(e) = manager.write_terminal(id.clone(), formatted_message.as_bytes().to_vec()).await {
                log::warn!("Failed to deliver queued message to terminal {id}: {e}");
            } else {
                log::info!("Successfully delivered queued message to terminal {id}");
            }
            
            #[derive(serde::Serialize, Clone)]
            struct FollowUpMessagePayload {
                session_name: String,
                message: String,
                message_type: String,
                timestamp: u64,
                terminal_id: String,
            }
            
            let session_name = if id.starts_with("session-") {
                id.split('-').nth(1).unwrap_or("unknown").to_string()
            } else {
                "orchestrator".to_string()
            };
            
            let message_payload = FollowUpMessagePayload {
                session_name,
                message: queued_msg.message,
                message_type: queued_msg.message_type,
                timestamp: queued_msg.timestamp,
                terminal_id: id.clone(),
            };
            
            if let Err(e) = app.emit("schaltwerk:follow-up-message", &message_payload) {
                log::error!("Failed to emit queued follow-up-message event: {e}");
            }
        }
    }
    
    Ok(id)
}

#[tauri::command]
pub async fn write_terminal(id: String, data: String) -> Result<(), String> {
    let manager = get_terminal_manager().await?;
    manager.write_terminal(id, data.into_bytes()).await
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
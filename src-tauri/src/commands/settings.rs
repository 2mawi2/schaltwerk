use std::collections::HashMap;
use crate::{SETTINGS_MANAGER, get_para_core, PROJECT_MANAGER};
use crate::settings::TerminalUIPreferences;
use crate::para_core::db_app_config::AppConfigMethods;
use crate::para_core::db_project_config::ProjectConfigMethods;

#[tauri::command]
pub async fn get_agent_env_vars(agent_type: String) -> Result<HashMap<String, String>, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let manager = settings_manager.lock().await;
    Ok(manager.get_agent_env_vars(&agent_type))
}

#[tauri::command]
pub async fn set_agent_env_vars(agent_type: String, env_vars: HashMap<String, String>) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let mut manager = settings_manager.lock().await;
    manager.set_agent_env_vars(&agent_type, env_vars)
}

#[tauri::command]
pub async fn get_agent_cli_args(agent_type: String) -> Result<String, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let manager = settings_manager.lock().await;
    Ok(manager.get_agent_cli_args(&agent_type))
}

#[tauri::command]
pub async fn set_agent_cli_args(agent_type: String, cli_args: String) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let mut manager = settings_manager.lock().await;
    manager.set_agent_cli_args(&agent_type, cli_args)
}

#[tauri::command]
pub async fn get_terminal_ui_preferences() -> Result<TerminalUIPreferences, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let manager = settings_manager.lock().await;
    Ok(manager.get_terminal_ui_preferences())
}

#[tauri::command]
pub async fn set_terminal_collapsed(is_collapsed: bool) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let mut manager = settings_manager.lock().await;
    manager.set_terminal_collapsed(is_collapsed)
}

#[tauri::command]
pub async fn set_terminal_divider_position(position: f64) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    
    let mut manager = settings_manager.lock().await;
    manager.set_terminal_divider_position(position)
}

#[tauri::command]
pub async fn get_project_default_base_branch() -> Result<Option<String>, String> {
    let para_core = get_para_core().await?;
    let core = para_core.lock().await;
    core.db.get_default_base_branch()
        .map_err(|e| format!("Failed to get default base branch: {e}"))
}

#[tauri::command]
pub async fn set_project_default_base_branch(branch: Option<String>) -> Result<(), String> {
    let para_core = get_para_core().await?;
    let core = para_core.lock().await;
    core.db.set_default_base_branch(branch.as_deref())
        .map_err(|e| format!("Failed to set default base branch: {e}"))
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub setup_script: String,
}

#[tauri::command]
pub async fn get_project_settings() -> Result<ProjectSettings, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;
    
    let core = project.para_core.lock().await;
    let db = core.database();
    
    let setup_script = db.get_project_setup_script(&project.path)
        .map_err(|e| format!("Failed to get project setup script: {e}"))?
        .unwrap_or_default();
    
    Ok(ProjectSettings { setup_script })
}

#[tauri::command]
pub async fn set_project_settings(settings: ProjectSettings) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;
    
    let core = project.para_core.lock().await;
    let db = core.database();
    
    db.set_project_setup_script(&project.path, &settings.setup_script)
        .map_err(|e| format!("Failed to set project setup script: {e}"))?;
    
    Ok(())
}

#[cfg(test)]
mod project_settings_tests {
    use super::*;
    
    #[test]
    fn test_project_settings_serialization() {
        let settings = ProjectSettings {
            setup_script: "#!/bin/bash\necho test".to_string(),
        };
        
        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains("setupScript"), "Should use camelCase field name");
        assert!(!json.contains("setup_script"), "Should not use snake_case field name");
        
        let json_input = r#"{"setupScript":"echo hello"}"#;
        let deserialized: ProjectSettings = serde_json::from_str(json_input).unwrap();
        assert_eq!(deserialized.setup_script, "echo hello");
    }
}
use std::collections::HashMap;

use crate::{get_schaltwerk_core, PROJECT_MANAGER, SETTINGS_MANAGER};
use schaltwerk::domains::settings::{
    DiffViewPreferences, SessionPreferences, TerminalSettings, TerminalUIPreferences,
};
use schaltwerk::schaltwerk_core::db_app_config::AppConfigMethods;
use schaltwerk::schaltwerk_core::db_project_config::{
    default_action_buttons, HeaderActionConfig, ProjectConfigMethods, ProjectMergePreferences,
    ProjectSelection, ProjectSessionsSettings, RunScript,
};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFont {
    pub family: String,
    pub monospace: bool,
}

fn normalize_and_sort_fonts(mut entries: Vec<InstalledFont>) -> Vec<InstalledFont> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, (String, bool)> = BTreeMap::new();
    for e in entries.drain(..) {
        let family = e.family.trim().to_string();
        if family.is_empty() {
            continue;
        }
        let key = family.to_lowercase();
        let mono = e.monospace;
        map.entry(key)
            .and_modify(|(_, m)| *m = *m || mono)
            .or_insert((family, mono));
    }
    let mut list: Vec<InstalledFont> = map
        .into_iter()
        .map(|(_, (family, monospace))| InstalledFont { family, monospace })
        .collect();
    list.sort_by(|a, b| {
        let ord = b.monospace.cmp(&a.monospace);
        if ord == std::cmp::Ordering::Equal {
            a.family.to_lowercase().cmp(&b.family.to_lowercase())
        } else {
            ord
        }
    });
    list
}

#[tauri::command]
pub async fn list_installed_fonts() -> Result<Vec<InstalledFont>, String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut entries: Vec<InstalledFont> = Vec::new();
    for info in db.faces() {
        for fam in &info.families {
            let name = match fam.0.as_str() {
                s if !s.is_empty() => s.to_string(),
                _ => continue,
            };
            let inferred = name.to_lowercase().contains("mono")
                || name.to_lowercase().contains("code")
                || name.to_lowercase().contains("console")
                || name.to_lowercase().contains("monospace");
            entries.push(InstalledFont {
                family: name,
                monospace: inferred,
            });
        }
    }
    Ok(normalize_and_sort_fonts(entries))
}

#[tauri::command]
pub async fn get_agent_env_vars(agent_type: String) -> Result<HashMap<String, String>, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_agent_env_vars(&agent_type))
}

#[tauri::command]
pub async fn set_agent_env_vars(
    agent_type: String,
    env_vars: HashMap<String, String>,
) -> Result<(), String> {
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
    log::info!("Setting CLI args for agent '{agent_type}': '{cli_args}'");

    let settings_manager = SETTINGS_MANAGER.get().ok_or_else(|| {
        let error = "Settings manager not initialized".to_string();
        log::error!("Failed to set CLI args: {error}");
        error
    })?;

    let mut manager = settings_manager.lock().await;
    match manager.set_agent_cli_args(&agent_type, cli_args.clone()) {
        Ok(()) => {
            log::info!("Successfully saved CLI args for agent '{agent_type}': '{cli_args}'");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to save CLI args for agent '{agent_type}': {e}");
            Err(e)
        }
    }
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
    let schaltwerk_core = get_schaltwerk_core().await?;
    let core = schaltwerk_core.lock().await;
    core.db
        .get_default_base_branch()
        .map_err(|e| format!("Failed to get default base branch: {e}"))
}

#[tauri::command]
pub async fn set_project_default_base_branch(branch: Option<String>) -> Result<(), String> {
    let schaltwerk_core = get_schaltwerk_core().await?;
    let core = schaltwerk_core.lock().await;
    core.db
        .set_default_base_branch(branch.as_deref())
        .map_err(|e| format!("Failed to set default base branch: {e}"))
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub setup_script: String,
    pub branch_prefix: String,
}

#[tauri::command]
pub async fn get_project_settings() -> Result<ProjectSettings, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    let setup_script = db
        .get_project_setup_script(&project.path)
        .map_err(|e| format!("Failed to get project setup script: {e}"))?
        .unwrap_or_default();

    let branch_prefix = db
        .get_project_branch_prefix(&project.path)
        .map_err(|e| format!("Failed to get project branch prefix: {e}"))?;

    Ok(ProjectSettings {
        setup_script,
        branch_prefix,
    })
}

#[tauri::command]
pub async fn set_project_settings(settings: ProjectSettings) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.set_project_setup_script(&project.path, &settings.setup_script)
        .map_err(|e| format!("Failed to set project setup script: {e}"))?;
    db.set_project_branch_prefix(&project.path, &settings.branch_prefix)
        .map_err(|e| format!("Failed to set project branch prefix: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn get_project_selection() -> Result<Option<ProjectSelection>, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.get_project_selection(&project.path)
        .map_err(|e| format!("Failed to get project selection: {e}"))
}

#[tauri::command]
pub async fn set_project_selection(kind: String, payload: Option<String>) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    let selection = ProjectSelection { kind, payload };
    db.set_project_selection(&project.path, &selection)
        .map_err(|e| format!("Failed to set project selection: {e}"))
}

#[tauri::command]
pub async fn get_project_sessions_settings() -> Result<ProjectSessionsSettings, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.get_project_sessions_settings(&project.path)
        .map_err(|e| format!("Failed to get project sessions settings: {e}"))
}

#[tauri::command]
pub async fn set_project_sessions_settings(
    settings: ProjectSessionsSettings,
) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.set_project_sessions_settings(&project.path, &settings)
        .map_err(|e| format!("Failed to set project sessions settings: {e}"))
}

#[tauri::command]
pub async fn get_project_environment_variables() -> Result<HashMap<String, String>, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.get_project_environment_variables(&project.path)
        .map_err(|e| format!("Failed to get project environment variables: {e}"))
}

#[tauri::command]
pub async fn set_project_environment_variables(
    env_vars: HashMap<String, String>,
) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.set_project_environment_variables(&project.path, &env_vars)
        .map_err(|e| format!("Failed to set project environment variables: {e}"))
}

#[tauri::command]
pub async fn get_project_merge_preferences() -> Result<ProjectMergePreferences, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.get_project_merge_preferences(&project.path)
        .map_err(|e| format!("Failed to get project merge preferences: {e}"))
}

#[tauri::command]
pub async fn set_project_merge_preferences(
    preferences: ProjectMergePreferences,
) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.set_project_merge_preferences(&project.path, &preferences)
        .map_err(|e| format!("Failed to set project merge preferences: {e}"))
}

#[tauri::command]
pub async fn get_terminal_settings() -> Result<TerminalSettings, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_terminal_settings())
}

#[tauri::command]
pub async fn set_terminal_settings(terminal: TerminalSettings) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let mut manager = settings_manager.lock().await;
    // Persist first
    manager.set_terminal_settings(terminal.clone()).map(|_| {
        // Propagate new shell to terminal domain for immediate effect
        let shell = terminal
            .shell
            .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()));
        schaltwerk::domains::terminal::put_terminal_shell_override(shell, terminal.shell_args);
    })
}

#[tauri::command]
pub async fn get_diff_view_preferences() -> Result<DiffViewPreferences, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_diff_view_preferences())
}

#[tauri::command]
pub async fn set_diff_view_preferences(preferences: DiffViewPreferences) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let mut manager = settings_manager.lock().await;
    manager.set_diff_view_preferences(preferences)
}

#[tauri::command]
pub async fn get_session_preferences() -> Result<SessionPreferences, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_session_preferences())
}

#[tauri::command]
pub async fn set_session_preferences(preferences: SessionPreferences) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let mut manager = settings_manager.lock().await;
    manager.set_session_preferences(preferences)
}

#[tauri::command]
pub async fn get_auto_commit_on_review() -> Result<bool, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_auto_commit_on_review())
}

#[tauri::command]
pub async fn set_auto_commit_on_review(auto_commit: bool) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let mut manager = settings_manager.lock().await;
    manager.set_auto_commit_on_review(auto_commit)
}

#[tauri::command]
pub async fn get_keyboard_shortcuts() -> Result<HashMap<String, Vec<String>>, String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let manager = settings_manager.lock().await;
    Ok(manager.get_keyboard_shortcuts())
}

#[tauri::command]
pub async fn set_keyboard_shortcuts(shortcuts: HashMap<String, Vec<String>>) -> Result<(), String> {
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;

    let mut manager = settings_manager.lock().await;
    manager.set_keyboard_shortcuts(shortcuts)
}

#[tauri::command]
pub async fn get_project_action_buttons() -> Result<Vec<HeaderActionConfig>, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    let res = db
        .get_project_action_buttons(&project.path)
        .map_err(|e| format!("Failed to get project action buttons: {e}"));
    if let Ok(ref actions) = res {
        log::info!(
            "Loaded {} action buttons for project {}: {:?}",
            actions.len(),
            project.path.display(),
            actions
        );
    }
    res
}

#[tauri::command]
pub async fn set_project_action_buttons(actions: Vec<HeaderActionConfig>) -> Result<(), String> {
    // Limit to maximum 6 action buttons
    if actions.len() > 6 {
        return Err("Maximum of 6 action buttons allowed".to_string());
    }

    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    log::info!(
        "Saving {} action buttons for project {}: {:?}",
        actions.len(),
        project.path.display(),
        actions
    );

    db.set_project_action_buttons(&project.path, &actions)
        .map_err(|e| format!("Failed to set project action buttons: {e}"))
}

#[tauri::command]
pub async fn reset_project_action_buttons_to_defaults() -> Result<Vec<HeaderActionConfig>, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    let defaults = default_action_buttons();

    db.set_project_action_buttons(&project.path, &defaults)
        .map_err(|e| format!("Failed to set project action buttons: {e}"))?;

    log::info!(
        "Reset project {} action buttons to defaults",
        project.path.display()
    );

    Ok(defaults)
}

#[tauri::command]
pub async fn get_tutorial_completed() -> Result<bool, String> {
    let schaltwerk_core = get_schaltwerk_core().await?;
    let core = schaltwerk_core.lock().await;
    core.db
        .get_tutorial_completed()
        .map_err(|e| format!("Failed to get tutorial completion status: {e}"))
}

#[tauri::command]
pub async fn set_tutorial_completed(completed: bool) -> Result<(), String> {
    let schaltwerk_core = get_schaltwerk_core().await?;
    let core = schaltwerk_core.lock().await;
    core.db
        .set_tutorial_completed(completed)
        .map_err(|e| format!("Failed to set tutorial completion status: {e}"))
}

#[tauri::command]
pub async fn get_project_run_script() -> Result<Option<RunScript>, String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.get_project_run_script(&project.path)
        .map_err(|e| format!("Failed to get project run script: {e}"))
}

#[tauri::command]
pub async fn set_project_run_script(run_script: RunScript) -> Result<(), String> {
    let project = PROJECT_MANAGER
        .get()
        .ok_or_else(|| "Project manager not initialized".to_string())?
        .current_project()
        .await
        .map_err(|e| format!("Failed to get current project: {e}"))?;

    let core = project.schaltwerk_core.lock().await;
    let db = core.database();

    db.set_project_run_script(&project.path, &run_script)
        .map_err(|e| format!("Failed to set project run script: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_project_settings_serialization() {
        let settings = ProjectSettings {
            setup_script: "#!/bin/bash\necho test".to_string(),
            branch_prefix: "team".to_string(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        assert!(
            json.contains("setupScript"),
            "Should use camelCase field name"
        );
        assert!(json.contains("branchPrefix"));
        assert!(
            !json.contains("setup_script"),
            "Should not use snake_case field name"
        );

        let json_input = r#"{"setupScript":"echo hello","branchPrefix":"feature"}"#;
        let deserialized: ProjectSettings = serde_json::from_str(json_input).unwrap();
        assert_eq!(deserialized.setup_script, "echo hello");
        assert_eq!(deserialized.branch_prefix, "feature");
    }

    #[test]
    fn test_header_action_config_serialization() {
        let config = HeaderActionConfig {
            id: "test-id".to_string(),
            label: "Test Label".to_string(),
            prompt: "Test prompt".to_string(),
            color: Some("#ff0000".to_string()),
        };

        let json = serde_json::to_string(&config).unwrap();
        // Fields are not being renamed to camelCase in this context
        assert!(json.contains("\"id\""));
        assert!(json.contains("test-id"));
        assert!(json.contains("Test Label"));
        assert!(json.contains("Test prompt"));
        assert!(json.contains("#ff0000"));

        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, config);
    }

    #[test]
    fn test_header_action_config_serialization_without_color() {
        let config = HeaderActionConfig {
            id: "test-id".to_string(),
            label: "Test Label".to_string(),
            prompt: "Test prompt".to_string(),
            color: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        // Fields are not being renamed to camelCase in this context
        assert!(json.contains("\"id\""));
        assert!(json.contains("test-id"));
        assert!(json.contains("Test Label"));
        assert!(json.contains("Test prompt"));
        assert!(!json.contains("color")); // Should be skipped when None

        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, config);
    }

    #[tokio::test]
    async fn test_settings_manager_not_initialized() {
        let result = get_agent_env_vars("claude".to_string()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_project_manager_not_initialized() {
        let result = get_project_settings().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Project manager not initialized")
                || error_msg.contains("Failed to get current project"),
            "Unexpected error message: {}",
            error_msg
        );
    }

    #[tokio::test]
    async fn test_set_project_action_buttons_too_many() {
        let actions = vec![
            HeaderActionConfig {
                id: "1".to_string(),
                label: "Test 1".to_string(),
                prompt: "test 1".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "2".to_string(),
                label: "Test 2".to_string(),
                prompt: "test 2".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "3".to_string(),
                label: "Test 3".to_string(),
                prompt: "test 3".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "4".to_string(),
                label: "Test 4".to_string(),
                prompt: "test 4".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "5".to_string(),
                label: "Test 5".to_string(),
                prompt: "test 5".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "6".to_string(),
                label: "Test 6".to_string(),
                prompt: "test 6".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "7".to_string(),
                label: "Test 7".to_string(),
                prompt: "test 7".to_string(),
                color: None,
            },
        ];

        let result = set_project_action_buttons(actions).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Maximum of 6 action buttons allowed"));
    }

    #[tokio::test]
    async fn test_set_project_action_buttons_valid_count() {
        let actions = vec![
            HeaderActionConfig {
                id: "1".to_string(),
                label: "Test 1".to_string(),
                prompt: "test 1".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "2".to_string(),
                label: "Test 2".to_string(),
                prompt: "test 2".to_string(),
                color: None,
            },
        ];

        // This will fail because we don't have a real project set up, but it should pass the validation
        let result = set_project_action_buttons(actions).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_action_buttons_empty() {
        let actions = Vec::new();

        // This will fail because we don't have a real project, but we can test the function exists
        let result = set_project_action_buttons(actions).await;
        assert!(result.is_err()); // Expected due to no project setup
    }

    #[tokio::test]
    async fn test_set_project_action_buttons_maximum() {
        let actions = vec![
            HeaderActionConfig {
                id: "1".to_string(),
                label: "Test 1".to_string(),
                prompt: "test 1".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "2".to_string(),
                label: "Test 2".to_string(),
                prompt: "test 2".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "3".to_string(),
                label: "Test 3".to_string(),
                prompt: "test 3".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "4".to_string(),
                label: "Test 4".to_string(),
                prompt: "test 4".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "5".to_string(),
                label: "Test 5".to_string(),
                prompt: "test 5".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "6".to_string(),
                label: "Test 6".to_string(),
                prompt: "test 6".to_string(),
                color: None,
            },
        ];

        // This should pass validation and only fail due to no project
        let result = set_project_action_buttons(actions).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_agent_env_vars_uninitialized_manager() {
        let result = get_agent_env_vars("claude".to_string()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_agent_env_vars_uninitialized_manager() {
        let env_vars = HashMap::new();
        let result = set_agent_env_vars("claude".to_string(), env_vars).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_get_agent_cli_args_uninitialized_manager() {
        let result = get_agent_cli_args("claude".to_string()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_agent_cli_args_uninitialized_manager() {
        let result = set_agent_cli_args("claude".to_string(), "--test".to_string()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_get_terminal_ui_preferences_uninitialized_manager() {
        let result = get_terminal_ui_preferences().await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_terminal_collapsed_uninitialized_manager() {
        let result = set_terminal_collapsed(true).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_terminal_divider_position_uninitialized_manager() {
        let result = set_terminal_divider_position(0.5).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_get_terminal_settings_uninitialized_manager() {
        let result = get_terminal_settings().await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_terminal_settings_uninitialized_manager() {
        let settings = crate::settings::TerminalSettings::default();
        let result = set_terminal_settings(settings).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_get_diff_view_preferences_uninitialized_manager() {
        let result = get_diff_view_preferences().await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_set_diff_view_preferences_uninitialized_manager() {
        let preferences = crate::settings::DiffViewPreferences::default();
        let result = set_diff_view_preferences(preferences).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Settings manager not initialized"));
    }

    #[tokio::test]
    async fn test_get_project_default_base_branch_uninitialized_core() {
        let result = get_project_default_base_branch().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get para core"));
    }

    #[tokio::test]
    async fn test_set_project_default_base_branch_uninitialized_core() {
        let result = set_project_default_base_branch(Some("main".to_string())).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get para core"));
    }

    #[tokio::test]
    async fn test_get_project_settings_uninitialized_manager() {
        let result = get_project_settings().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        println!(
            "Actual error message for get_project_settings: {}",
            error_msg
        );
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_settings_uninitialized_manager() {
        let settings = ProjectSettings {
            setup_script: "#!/bin/bash\necho test".to_string(),
            branch_prefix: "team".to_string(),
        };
        let result = set_project_settings(settings).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_project_merge_preferences_uninitialized_manager() {
        let result = get_project_merge_preferences().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_merge_preferences_uninitialized_manager() {
        let preferences = ProjectMergePreferences {
            auto_cancel_after_merge: true,
        };
        let result = set_project_merge_preferences(preferences).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_project_selection_uninitialized_manager() {
        let result = get_project_selection().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_project_environment_variables_uninitialized_manager() {
        let result = get_project_environment_variables().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        println!(
            "Actual error message for get_project_environment_variables: {}",
            error_msg
        );
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_project_sessions_settings_uninitialized_manager() {
        let result = get_project_sessions_settings().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_sessions_settings_uninitialized_manager() {
        let settings = schaltwerk::schaltwerk_core::db_project_config::ProjectSessionsSettings {
            filter_mode: "all".to_string(),
            sort_mode: "name".to_string(),
        };
        let result = set_project_sessions_settings(settings).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_environment_variables_uninitialized_manager() {
        let env_vars = HashMap::new();
        let result = set_project_environment_variables(env_vars).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_project_action_buttons_uninitialized_manager() {
        let result = get_project_action_buttons().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_set_project_action_buttons_uninitialized_manager() {
        let actions = vec![HeaderActionConfig {
            id: "test".to_string(),
            label: "Test".to_string(),
            prompt: "test prompt".to_string(),
            color: None,
        }];
        let result = set_project_action_buttons(actions).await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_reset_project_action_buttons_to_defaults_uninitialized_manager() {
        let result = reset_project_action_buttons_to_defaults().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(
            error_msg.contains("Failed to get current project")
                || error_msg.contains("Project manager not initialized")
        );
    }

    #[tokio::test]
    async fn test_get_tutorial_completed_uninitialized_core() {
        let result = get_tutorial_completed().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get para core"));
    }

    #[tokio::test]
    async fn test_set_tutorial_completed_uninitialized_core() {
        let result = set_tutorial_completed(true).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to get para core"));
    }

    #[test]
    fn test_project_settings_struct_creation() {
        let setup_script = "#!/bin/bash\necho 'Hello World'";
        let settings = ProjectSettings {
            setup_script: setup_script.to_string(),
            branch_prefix: "team".to_string(),
        };

        assert_eq!(settings.setup_script, setup_script);
        assert_eq!(settings.branch_prefix, "team");
    }

    #[test]
    fn test_header_action_config_struct_creation() {
        let config = HeaderActionConfig {
            id: "merge-pr".to_string(),
            label: "Merge PR".to_string(),
            prompt: "Create a PR and merge it".to_string(),
            color: Some("#00ff00".to_string()),
        };

        assert_eq!(config.id, "merge-pr");
        assert_eq!(config.label, "Merge PR");
        assert_eq!(config.prompt, "Create a PR and merge it");
        assert_eq!(config.color, Some("#00ff00".to_string()));
    }

    #[test]
    fn test_header_action_config_struct_creation_no_color() {
        let config = HeaderActionConfig {
            id: "test-action".to_string(),
            label: "Test Action".to_string(),
            prompt: "This is a test".to_string(),
            color: None,
        };

        assert_eq!(config.id, "test-action");
        assert_eq!(config.label, "Test Action");
        assert_eq!(config.prompt, "This is a test");
        assert_eq!(config.color, None);
    }

    #[test]
    fn test_project_settings_json_roundtrip() {
        let original = ProjectSettings {
            setup_script: "#!/bin/bash\necho 'test script'\nexport PATH=/usr/local/bin:$PATH"
                .to_string(),
            branch_prefix: "team".to_string(),
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: ProjectSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_header_action_config_json_roundtrip() {
        let original = HeaderActionConfig {
            id: "complex-action".to_string(),
            label: "Complex Action".to_string(),
            prompt:
                "This is a complex action with multiple lines\nand special characters: @#$%^&*()"
                    .to_string(),
            color: Some("#123456".to_string()),
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_header_action_config_json_roundtrip_no_color() {
        let original = HeaderActionConfig {
            id: "simple-action".to_string(),
            label: "Simple Action".to_string(),
            prompt: "Simple action without color".to_string(),
            color: None,
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_multiple_header_action_configs() {
        let configs = vec![
            HeaderActionConfig {
                id: "action-1".to_string(),
                label: "Action 1".to_string(),
                prompt: "First action".to_string(),
                color: Some("#ff0000".to_string()),
            },
            HeaderActionConfig {
                id: "action-2".to_string(),
                label: "Action 2".to_string(),
                prompt: "Second action".to_string(),
                color: None,
            },
            HeaderActionConfig {
                id: "action-3".to_string(),
                label: "Action 3".to_string(),
                prompt: "Third action".to_string(),
                color: Some("#0000ff".to_string()),
            },
        ];

        let json = serde_json::to_string(&configs).unwrap();
        let deserialized: Vec<HeaderActionConfig> = serde_json::from_str(&json).unwrap();

        assert_eq!(configs, deserialized);
    }

    #[test]
    fn test_project_settings_with_special_characters() {
        let settings = ProjectSettings {
            setup_script: "#!/bin/bash\necho 'special chars: @#$%^&*()'\nexport PATH=/usr/local/bin:$PATH\ncd /some/path".to_string(),
            branch_prefix: "team".to_string(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: ProjectSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings, deserialized);
    }

    #[test]
    fn test_header_action_config_with_special_characters() {
        let config = HeaderActionConfig {
            id: "special-action".to_string(),
            label: "Special Action @#$%".to_string(),
            prompt: "Action with special chars: @#$%^&*()\nMultiple lines\nWith quotes: \"hello\" and 'world'".to_string(),
            color: Some("#abcdef".to_string()),
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_empty_project_settings() {
        let settings = ProjectSettings {
            setup_script: String::new(),
            branch_prefix: "schaltwerk".to_string(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: ProjectSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings, deserialized);
        assert!(deserialized.setup_script.is_empty());
    }

    #[test]
    fn test_empty_header_action_config() {
        let config = HeaderActionConfig {
            id: String::new(),
            label: String::new(),
            prompt: String::new(),
            color: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: HeaderActionConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config, deserialized);
        assert!(deserialized.id.is_empty());
        assert!(deserialized.label.is_empty());
        assert!(deserialized.prompt.is_empty());
        assert!(deserialized.color.is_none());
    }

    #[test]
    fn test_normalize_and_sort_fonts() {
        let input = vec![
            InstalledFont {
                family: "Fira Code".into(),
                monospace: true,
            },
            InstalledFont {
                family: "Fira Code".into(),
                monospace: false,
            },
            InstalledFont {
                family: "Arial".into(),
                monospace: false,
            },
            InstalledFont {
                family: "  ".into(),
                monospace: true,
            },
            InstalledFont {
                family: "JetBrains Mono".into(),
                monospace: true,
            },
            InstalledFont {
                family: "arial".into(),
                monospace: false,
            },
        ];
        let out = normalize_and_sort_fonts(input);
        assert!(out.len() >= 3);
        assert_eq!(out[0].monospace, true);
        assert!(out.iter().any(|f| f.family == "Fira Code" && f.monospace));
        assert!(out.iter().any(|f| f.family == "Arial"));
        let mut seen = std::collections::HashSet::new();
        for f in &out {
            assert!(seen.insert(f.family.to_lowercase()));
        }
    }
}

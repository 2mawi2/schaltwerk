use std::process::Command;
use crate::schaltwerk_core::db_app_config::AppConfigMethods;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}


fn detect_available_apps() -> Vec<OpenApp> {
    // Show all common macOS apps and let error handling deal with missing ones
    // This avoids sandbox permission issues with app detection
    vec![
        OpenApp { id: "finder".into(), name: "Finder".into(), kind: "system".into() },
        OpenApp { id: "cursor".into(), name: "Cursor".into(), kind: "editor".into() },
        OpenApp { id: "vscode".into(), name: "VS Code".into(), kind: "editor".into() },
        OpenApp { id: "warp".into(), name: "Warp".into(), kind: "terminal".into() },
        OpenApp { id: "terminal".into(), name: "Terminal".into(), kind: "terminal".into() },
    ]
}

fn open_path_in(app_id: &str, path: &str) -> Result<(), String> {
    let result = match app_id {
        "finder" => {
            Command::new("open").arg(path).status()
        }
        "cursor" => {
            // Try CLI first, fall back to open -a
            if which::which("cursor").is_ok() {
                Command::new("cursor").arg(path).status()
            } else {
                Command::new("open").args(["-a", "Cursor", path]).status()
            }
        }
        "vscode" => {
            // Try CLI first, fall back to open -a
            if which::which("code").is_ok() {
                Command::new("code").arg(path).status()
            } else {
                Command::new("open").args(["-a", "Visual Studio Code", path]).status()
            }
        }
        "warp" => {
            // Try CLI first, fall back to open -a
            if which::which("warp").is_ok() {
                Command::new("warp").arg("--cwd").arg(path).status()
            } else {
                Command::new("open").args(["-a", "Warp", path]).status()
            }
        }
        "terminal" => {
            Command::new("open").args(["-a", "Terminal", path]).status()
        }
        other => return Err(format!("Unsupported app id: {other}")),
    };

    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(_status) => {
            // Non-zero exit code likely means app not found
            let app_name = match app_id {
                "cursor" => "Cursor",
                "vscode" => "VS Code",
                "warp" => "Warp",
                "terminal" => "Terminal",
                _ => app_id,
            };
            Err(format!("{app_name} is not installed. Please install it from the official website or choose a different application."))
        }
        Err(e) => {
            // Command execution failed
            let app_name = match app_id {
                "cursor" => "Cursor",
                "vscode" => "VS Code",
                "warp" => "Warp",
                "terminal" => "Terminal",
                "finder" => "Finder",
                _ => app_id,
            };
            Err(format!("Failed to open in {app_name}: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_available_apps_includes_expected_apps() {
        let apps = detect_available_apps();
        // We should always have all apps available on macOS
        assert!(apps.iter().any(|a| a.id == "finder"));
        assert!(apps.iter().any(|a| a.id == "terminal"));
        assert_eq!(apps.len(), 5); // Should have all 5 apps
    }
}

#[tauri::command]
pub async fn list_available_open_apps() -> Result<Vec<OpenApp>, String> {
    Ok(detect_available_apps())
}

#[tauri::command]
pub async fn get_default_open_app() -> Result<String, String> {
    let core = crate::schaltwerk_core::SchaltwerkCore::new(None)
        .map_err(|e| format!("Failed to init core: {e}"))?;
    Ok(core.db.get_default_open_app().unwrap_or_else(|_| "finder".to_string()))
}

#[tauri::command]
pub async fn set_default_open_app(app_id: String) -> Result<(), String> {
    let core = crate::schaltwerk_core::SchaltwerkCore::new(None)
        .map_err(|e| format!("Failed to init core: {e}"))?;
    core.db.set_default_open_app(&app_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_app(app_id: String, worktree_path: String) -> Result<(), String> {
    // Run in a blocking task to avoid UI freezing
    tokio::task::spawn_blocking(move || {
        open_path_in(&app_id, &worktree_path)
    })
    .await
    .map_err(|e| format!("Failed to spawn task: {e}"))?
}

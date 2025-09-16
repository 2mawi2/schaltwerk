use crate::schaltwerk_core::db_app_config::AppConfigMethods;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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
        OpenApp {
            id: "finder".into(),
            name: "Finder".into(),
            kind: "system".into(),
        },
        OpenApp {
            id: "cursor".into(),
            name: "Cursor".into(),
            kind: "editor".into(),
        },
        OpenApp {
            id: "vscode".into(),
            name: "VS Code".into(),
            kind: "editor".into(),
        },
        OpenApp {
            id: "intellij".into(),
            name: "IntelliJ IDEA".into(),
            kind: "editor".into(),
        },
        OpenApp {
            id: "warp".into(),
            name: "Warp".into(),
            kind: "terminal".into(),
        },
        OpenApp {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: "terminal".into(),
        },
    ]
}

fn open_path_in(app_id: &str, path: &str) -> Result<(), String> {
    let result = match app_id {
        "finder" => Command::new("open").arg(path).status(),
        "cursor" => {
            // Try CLI first, fall back to open -a
            if which::which("cursor").is_ok() {
                Command::new("cursor").arg(path).status()
            } else {
                Command::new("open").args(["-a", "Cursor", path]).status()
            }
        }
        "intellij" => return open_path_in_intellij(path),
        "vscode" => {
            // Try CLI first, fall back to open -a
            if which::which("code").is_ok() {
                Command::new("code").arg(path).status()
            } else {
                Command::new("open")
                    .args(["-a", "Visual Studio Code", path])
                    .status()
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
        "terminal" => Command::new("open").args(["-a", "Terminal", path]).status(),
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

fn open_path_in_intellij(path: &str) -> Result<(), String> {
    if which::which("idea").is_ok() {
        match Command::new("idea").arg(path).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to open in IntelliJ IDEA: {e}"));
            }
        }
    }

    if which::which("idea64").is_ok() {
        match Command::new("idea64").arg(path).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to open in IntelliJ IDEA: {e}"));
            }
        }
    }

    if let Some(bundle) = find_existing_intellij_bundle() {
        match Command::new("open")
            .arg("-a")
            .arg(&bundle)
            .arg(path)
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!(
                    "Failed to open in IntelliJ IDEA at {}: {e}",
                    bundle.display()
                ));
            }
        }
    }

    for fallback_name in [
        "IntelliJ IDEA",
        "IntelliJ IDEA CE",
        "IntelliJ IDEA Ultimate",
    ] {
        match Command::new("open")
            .args(["-a", fallback_name, path])
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to open in {fallback_name}: {e}"));
            }
        }
    }

    Err("IntelliJ IDEA is not installed. Please install it from JetBrains Toolbox or jetbrains.com and try again.".into())
}

fn find_existing_intellij_bundle() -> Option<PathBuf> {
    intellij_app_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

fn intellij_app_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    push_bundle_variants(&mut candidates, PathBuf::from("/Applications"));

    if let Some(home) = dirs::home_dir() {
        push_bundle_variants(&mut candidates, home.join("Applications"));
        push_bundle_variants(&mut candidates, home.join("Applications/JetBrains Toolbox"));

        let toolbox_root = home.join("Library/Application Support/JetBrains/Toolbox/apps");
        for channel in ["IDEA-U", "IDEA-C"] {
            let channel_dir = toolbox_root.join(channel);
            push_bundle_variants(&mut candidates, channel_dir.clone());
            collect_intellij_apps_in_dir(&channel_dir, &mut candidates, 0);
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

fn push_bundle_variants(candidates: &mut Vec<PathBuf>, base_dir: PathBuf) {
    if base_dir.as_os_str().is_empty() {
        return;
    }
    for name in [
        "IntelliJ IDEA.app",
        "IntelliJ IDEA CE.app",
        "IntelliJ IDEA Ultimate.app",
    ] {
        candidates.push(base_dir.join(name));
    }
}

fn collect_intellij_apps_in_dir(dir: &Path, candidates: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 {
        return;
    }

    if !dir.exists() {
        return;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if looks_like_intellij_app(&path) {
                    candidates.push(path);
                } else {
                    collect_intellij_apps_in_dir(&path, candidates, depth + 1);
                }
            }
        }
    }
}

fn looks_like_intellij_app(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("app"))
        != Some(true)
    {
        return false;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().contains("intellij idea"))
        .unwrap_or(false)
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
        assert!(apps.iter().any(|a| a.id == "intellij"));
        assert_eq!(apps.len(), 6); // Should have all 6 apps
    }

    #[test]
    fn test_intellij_app_candidates_cover_common_locations() {
        let candidates = intellij_app_candidates();

        // Standard Applications folder
        assert!(candidates.iter().any(|p| p
            .to_string_lossy()
            .contains("/Applications/IntelliJ IDEA.app")));

        // Community Edition
        assert!(candidates.iter().any(|p| p
            .to_string_lossy()
            .contains("/Applications/IntelliJ IDEA CE.app")));

        // JetBrains Toolbox Ultimate
        assert!(candidates.iter().any(|p| p
            .to_string_lossy()
            .contains("Library/Application Support/JetBrains/Toolbox/apps/IDEA-U")));

        // JetBrains Toolbox applications directory
        assert!(candidates.iter().any(|p| p
            .to_string_lossy()
            .contains("Applications/JetBrains Toolbox/IntelliJ IDEA")));

        // JetBrains Toolbox Community
        assert!(candidates.iter().any(|p| p
            .to_string_lossy()
            .contains("Library/Application Support/JetBrains/Toolbox/apps/IDEA-C")));
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
    Ok(core
        .db
        .get_default_open_app()
        .unwrap_or_else(|_| "finder".to_string()))
}

#[tauri::command]
pub async fn set_default_open_app(app_id: String) -> Result<(), String> {
    let core = crate::schaltwerk_core::SchaltwerkCore::new(None)
        .map_err(|e| format!("Failed to init core: {e}"))?;
    core.db
        .set_default_open_app(&app_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_app(app_id: String, worktree_path: String) -> Result<(), String> {
    // Run in a blocking task to avoid UI freezing
    tokio::task::spawn_blocking(move || open_path_in(&app_id, &worktree_path))
        .await
        .map_err(|e| format!("Failed to spawn task: {e}"))?
}

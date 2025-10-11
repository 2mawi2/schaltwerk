use crate::schaltwerk_core::db_app_config::AppConfigMethods;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const OPEN_BIN: &str = "/usr/bin/open";

#[cfg(target_os = "linux")]
const XDG_OPEN_BIN: &str = "xdg-open";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}

#[cfg(target_os = "linux")]
fn detect_linux_file_managers() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    for (binary, name) in [
        ("nautilus", "Files (Nautilus)"),
        ("dolphin", "Dolphin"),
        ("thunar", "Thunar"),
        ("pcmanfm", "PCManFM"),
        ("nemo", "Nemo"),
    ] {
        if which::which(binary).is_ok() {
            apps.push(OpenApp {
                id: binary.into(),
                name: name.into(),
                kind: "system".into(),
            });
        }
    }

    apps
}

#[cfg(target_os = "linux")]
fn detect_linux_terminals() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    for (binary, name) in [
        ("alacritty", "Alacritty"),
        ("ghostty", "Ghostty"),
        ("gnome-terminal", "GNOME Terminal"),
        ("kgx", "Console"),
        ("kitty", "Kitty"),
        ("konsole", "Konsole"),
        ("ptyxis", "Ptyxis"),
        ("tilix", "Tilix"),
        ("wezterm", "Wezterm"),
        ("xfce4-terminal", "Xfce Terminal"),
        ("zellij", "Zellij"),
    ] {
        if which::which(binary).is_ok() {
            apps.push(OpenApp {
                id: binary.into(),
                name: name.into(),
                kind: "terminal".into(),
            });
        }
    }

    apps
}

#[cfg(target_os = "linux")]
fn open_with_linux(app_id: &str, path: &str) -> Result<(), String> {
    let result = match app_id {
        "nautilus" | "dolphin" | "thunar" | "pcmanfm" | "nemo" => {
            Command::new(app_id).arg(path).status()
        }
        "ptyxis" => Command::new("ptyxis")
            .arg("--working-directory")
            .arg(path)
            .status(),
        "gnome-terminal" => Command::new("gnome-terminal")
            .arg("--working-directory")
            .arg(path)
            .status(),
        "xfce4-terminal" => Command::new("xfce4-terminal")
            .arg("--working-directory")
            .arg(path)
            .status(),
        "konsole" => Command::new("konsole").arg("--workdir").arg(path).status(),
        "alacritty" => Command::new("alacritty")
            .arg("--working-directory")
            .arg(path)
            .status(),
        "kitty" => Command::new("kitty").arg("--directory").arg(path).status(),
        "tilix" => Command::new("tilix")
            .arg("--working-directory")
            .arg(path)
            .status(),
        "wezterm" => Command::new("wezterm")
            .arg("start")
            .arg("--cwd")
            .arg(path)
            .status(),
        "zellij" => Command::new("zellij")
            .arg("launch")
            .arg("--cwd")
            .arg(path)
            .status(),
        "kgx" => Command::new("kgx")
            .arg("--working-directory")
            .arg(path)
            .status(),
        _ => Command::new(XDG_OPEN_BIN).arg(path).status(),
    };

    result
        .map_err(|e| format!("Failed to open with {app_id}: {e}"))?
        .success()
        .then_some(())
        .ok_or_else(|| format!("{app_id} is not installed or failed to open"))
}

#[cfg(target_os = "linux")]
fn detect_linux_editors() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    for (binary, name, id) in [
        ("cursor", "Cursor", "cursor"),
        ("code", "VS Code", "vscode"),
        ("idea", "IntelliJ IDEA", "intellij"),
    ] {
        if which::which(binary).is_ok() {
            apps.push(OpenApp {
                id: id.into(),
                name: name.into(),
                kind: "editor".into(),
            });
        }
    }

    apps
}

fn detect_available_apps() -> Vec<OpenApp> {
#[cfg(target_os = "linux")]
{
    let mut apps = Vec::new();
    apps.extend(detect_linux_file_managers());
    apps.extend(detect_linux_terminals());
    apps.extend(detect_linux_editors());

    apps
}

    #[cfg(target_os = "macos")]
    {
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
                id: "ghostty".into(),
                name: "Ghostty".into(),
                kind: "terminal".into(),
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
}

fn open_path_in(app_id: &str, path: &str) -> Result<(), String> {
    let working_dir = resolve_working_directory(path)?;

    #[cfg(target_os = "linux")]
    {
        let linux_apps = [
            "nautilus",
            "dolphin",
            "thunar",
            "pcmanfm",
            "nemo",
            "alacritty",
            "ghostty",
            "gnome-terminal",
            "kgx",
            "konsole",
            "kitty",
            "ptyxis",
            "tilix",
            "wezterm",
            "xfce4-terminal",
            "zellij",
        ];
        if linux_apps.contains(&app_id) {
            return open_with_linux(app_id, working_dir.as_str());
        }
    }

    if app_id == "ghostty" {
        return open_path_in_ghostty(working_dir.as_str());
    }

    let result = match app_id {
        #[cfg(target_os = "macos")]
        "finder" => Command::new(OPEN_BIN).arg(working_dir.as_str()).status(),
        "cursor" => {
            // Try CLI first, fall back to open -a
            if which::which("cursor").is_ok() {
                Command::new("cursor").arg(working_dir.as_str()).status()
            } else {
                Command::new(OPEN_BIN)
                    .args(["-a", "Cursor", working_dir.as_str()])
                    .status()
            }
        }
        "intellij" => return open_path_in_intellij(working_dir.as_str()),
        "vscode" => {
            // Try CLI first, fall back to open -a
            if which::which("code").is_ok() {
                Command::new("code").arg(working_dir.as_str()).status()
            } else {
                Command::new(OPEN_BIN)
                    .args(["-a", "Visual Studio Code", working_dir.as_str()])
                    .status()
            }
        }
        "warp" => {
            // Try CLI first, fall back to open -a
            if which::which("warp").is_ok() {
                Command::new("warp")
                    .arg("--cwd")
                    .arg(working_dir.as_str())
                    .status()
            } else {
                Command::new(OPEN_BIN)
                    .args(["-a", "Warp", working_dir.as_str()])
                    .status()
            }
        }
        "terminal" => Command::new(OPEN_BIN)
            .args(["-a", "Terminal", working_dir.as_str()])
            .status(),
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
                "ghostty" => "Ghostty",
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
                "ghostty" => "Ghostty",
                _ => app_id,
            };
            Err(format!("Failed to open in {app_name}: {e}"))
        }
    }
}

fn resolve_working_directory(path: &str) -> Result<String, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return candidate
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Working directory path contains invalid UTF-8".to_string());
    }

    let cwd = env::current_dir()
        .map_err(|e| format!("Failed to resolve current working directory: {e}"))?;
    let joined = cwd.join(candidate);
    joined
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Working directory path contains invalid UTF-8".to_string())
}

fn open_path_in_ghostty(working_dir: &str) -> Result<(), String> {
    let working_dir_flag = format!("--working-directory={working_dir}");

    #[cfg(target_os = "macos")]
    {
        let open_status = Command::new(OPEN_BIN)
            .args(["-na", "Ghostty", "--args", working_dir_flag.as_str()])
            .status();
        match open_status {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {
                // Fall through to CLI fallback below.
            }
            Err(e) => {
                // If the macOS bundle fails entirely, provide context but still fall back to CLI.
                log::warn!("failed to launch Ghostty via open: {e}");
            }
        }
    }

    if which::which("ghostty").is_ok() {
        let cli_status = Command::new("ghostty")
            .arg(working_dir_flag.as_str())
            .status();
        match cli_status {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {
                let shim_status = Command::new("ghostty")
                    .args(["+open", working_dir_flag.as_str()])
                    .status();
                match shim_status {
                    Ok(status) if status.success() => return Ok(()),
                    Ok(_) => {}
                    Err(e) => {
                        return Err(format!("Failed to launch Ghostty via CLI shim: {e}"));
                    }
                }
            }
            Err(e) => {
                return Err(format!("Failed to execute ghostty CLI: {e}"));
            }
        }
        return Err("Ghostty CLI is installed but refused the launch command. Ensure the Ghostty CLI supports --working-directory or use the app bundle launch setting.".into());
    }

    Err("Ghostty is not installed. Please install Ghostty or choose a different terminal.".into())
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
        match Command::new(OPEN_BIN)
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
        match Command::new(OPEN_BIN)
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

        #[cfg(target_os = "macos")]
        {
            // Should have finder + at least one editor + at least one terminal
            assert!(apps.iter().any(|a| a.id == "finder"));
            assert!(apps.iter().any(|a| a.kind == "editor"));
            assert!(apps.iter().any(|a| a.kind == "terminal"));
        }

        #[cfg(target_os = "linux")]
        {
            // Should have at least one file manager + one editor + one terminal
            assert!(apps.iter().any(|a| a.kind == "system"));
            assert!(apps.iter().any(|a| a.kind == "editor"));
            assert!(apps.iter().any(|a| a.kind == "terminal"));
        }
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

    #[test]
    fn test_open_bin_is_absolute() {
        assert_eq!(OPEN_BIN, "/usr/bin/open");
    }

    #[test]
    fn test_default_open_app_roundtrip_in_db() {
        let db = crate::schaltwerk_core::Database::new_in_memory()
            .expect("failed to create in-memory db");

        let default = get_default_open_app_from_db(&db).expect("failed to read default open app");
        assert_eq!(default, "finder");

        set_default_open_app_in_db(&db, "vscode").expect("failed to persist default open app");

        let updated =
            get_default_open_app_from_db(&db).expect("failed to read updated default open app");
        assert_eq!(updated, "vscode");
    }
}

#[tauri::command]
pub async fn list_available_open_apps() -> Result<Vec<OpenApp>, String> {
    Ok(detect_available_apps())
}

pub fn get_default_open_app_from_db(
    db: &crate::schaltwerk_core::Database,
) -> anyhow::Result<String> {
    db.get_default_open_app()
}

pub fn set_default_open_app_in_db(
    db: &crate::schaltwerk_core::Database,
    app_id: &str,
) -> anyhow::Result<()> {
    db.set_default_open_app(app_id)
}

#[tauri::command]
pub async fn open_in_app(app_id: String, worktree_path: String) -> Result<(), String> {
    // Run in a blocking task to avoid UI freezing
    tokio::task::spawn_blocking(move || open_path_in(&app_id, &worktree_path))
        .await
        .map_err(|e| format!("Failed to spawn task: {e}"))?
}

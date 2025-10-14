use crate::schaltwerk_core::db_app_config::AppConfigMethods;
use std::env;
use std::path::Path;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use tempfile;

    fn env_lock() -> &'static Mutex<()> {
        static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
        ENV_MUTEX.get_or_init(|| Mutex::new(()))
    }

    // Helper to create mock executables
    fn create_mock_bin(dir: &std::path::Path, name: &str) -> std::io::Result<std::path::PathBuf> {
        use std::fs;
        let bin_path = dir.join(name);
        fs::write(&bin_path, "#!/bin/sh\necho mock")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&bin_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&bin_path, perms)?;
        }

        Ok(bin_path)
    }

    #[test]
    fn test_detect_apps_with_mocks() {
        let _guard = env_lock().lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();

        // Create mock executables for each category
        create_mock_bin(temp_dir.path(), "nautilus").unwrap(); // File manager
        create_mock_bin(temp_dir.path(), "kgx").unwrap(); // Terminal
        create_mock_bin(temp_dir.path(), "code").unwrap(); // Editor
        create_mock_bin(temp_dir.path(), "zed").unwrap(); // Editor

        // Temporarily modify PATH
        let original_path = env::var_os("PATH");
        let mut paths = vec![temp_dir.path().to_path_buf()];
        if let Some(ref orig) = original_path {
            paths.extend(env::split_paths(orig));
        }
        let joined = env::join_paths(paths).expect("failed to join PATH entries");
        env::set_var("PATH", &joined);

        // Detect apps
        let apps = detect_available_apps();

        // Restore PATH
        if let Some(orig) = original_path {
            env::set_var("PATH", orig);
        } else {
            env::remove_var("PATH");
        }

        // Verify detection
        #[cfg(target_os = "linux")]
        {
            let has_nautilus = apps
                .iter()
                .any(|a| a.id == "nautilus" && a.kind == "system");
            let has_kgx = apps.iter().any(|a| a.id == "kgx" && a.kind == "terminal");
            let has_vscode = apps.iter().any(|a| a.id == "code" && a.kind == "editor");
            let has_zed = apps.iter().any(|a| a.id == "zed" && a.kind == "editor");

            assert!(has_nautilus, "Should detect mock nautilus file manager");
            assert!(has_kgx, "Should detect mock kgx terminal");
            assert!(has_vscode, "Should detect mock VS Code editor");
            assert!(has_zed, "Should detect mock Zed editor");
        }

        #[cfg(target_os = "macos")]
        {
            // On macOS, we should always detect Finder
            let has_finder = apps.iter().any(|a| a.id == "finder");
            assert!(has_finder, "Should have Finder on macOS");

            // Mock editor should be detected
            let has_vscode = apps.iter().any(|a| a.id == "code" && a.kind == "editor");
            let has_zed = apps.iter().any(|a| a.id == "zed" && a.kind == "editor");
            assert!(has_vscode, "Should detect mock VS Code editor");
            assert!(has_zed, "Should detect mock Zed editor");
        }
    }

    #[test]
    fn test_app_kinds_are_valid() {
        let apps = detect_available_apps();
        for app in apps {
            assert!(
                app.kind == "system" || app.kind == "terminal" || app.kind == "editor",
                "Invalid app kind: {}",
                app.kind
            );
        }
    }

    #[test]
    fn test_platform_specific_defaults() {
        // Test that default app makes sense for platform
        let db = crate::schaltwerk_core::Database::new_in_memory().unwrap();
        let default = get_default_open_app_from_db(&db).unwrap();

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");
    }

    #[test]
    fn test_default_open_app_roundtrip_in_db() {
        let db = crate::schaltwerk_core::Database::new_in_memory()
            .expect("failed to create in-memory db");

        let default = get_default_open_app_from_db(&db).expect("failed to read default open app");

        #[cfg(target_os = "macos")]
        assert_eq!(default, "finder");

        #[cfg(target_os = "linux")]
        assert_eq!(default, "nautilus");

        set_default_open_app_in_db(&db, "vscode").expect("failed to persist default open app");

        let updated =
            get_default_open_app_from_db(&db).expect("failed to read updated default open app");
        assert_eq!(updated, "vscode");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_open_path_in_zed_prefers_cli() {
        use std::fs;

        let _guard = env_lock().lock().unwrap();

        let cli_dir = tempfile::tempdir().expect("cannot create temp cli dir");
        let log_file = cli_dir.path().join("zed-cli-log");
        let script_path = cli_dir.path().join("zed");
        fs::write(
            &script_path,
            "#!/bin/sh\nprintf '%s' \"$@\" > \"$SCHALTWERK_ZED_LOG\"\n",
        )
        .expect("failed to write mock zed cli");

        // Ensure the log file exists so the redirect target is valid on first write.
        fs::File::create(&log_file).expect("failed to create zed cli log file");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script_path, perms).unwrap();
        }

        let original_path = env::var_os("PATH");
        let mut path_entries = vec![cli_dir.path().to_path_buf()];
        if let Some(ref orig) = original_path {
            path_entries.extend(env::split_paths(orig));
        }
        let joined = env::join_paths(path_entries).expect("failed to join PATH entries");
        env::set_var("PATH", joined);
        env::set_var("SCHALTWERK_ZED_LOG", log_file.to_str().unwrap());

        let workdir = tempfile::tempdir().expect("cannot create workdir");
        super::open_path_in("zed", workdir.path().to_str().unwrap())
            .expect("zed CLI launch should succeed");

        let recorded = fs::read_to_string(&log_file).expect("log file must exist");
        assert!(recorded.contains(workdir.path().to_str().unwrap()));

        env::remove_var("SCHALTWERK_ZED_LOG");
        if let Some(orig) = original_path {
            env::set_var("PATH", orig);
        } else {
            env::remove_var("PATH");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_open_path_in_zed_falls_back_to_open() {
        use std::fs;

        let _guard = env_lock().lock().unwrap();

        let home_dir = tempfile::tempdir().expect("cannot create temp home");
        let cli_dir = tempfile::tempdir().expect("cannot create temp cli dir");
        let open_log = cli_dir.path().join("open-log");
        let open_script = cli_dir.path().join("fake-open");

        fs::write(
            &open_script,
            "#!/bin/sh\nprintf '%s' \"$@\" > \"$SCHALTWERK_ZED_OPEN_LOG\"\n",
        )
        .expect("failed to write mock open script");

        // Create the file upfront so the redirection target exists immediately.
        fs::File::create(&open_log).expect("failed to create open log file");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&open_script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&open_script, perms).unwrap();
        }

        // Ensure bundle detection finds ~/Applications/Zed.app
        let applications_dir = home_dir.path().join("Applications");
        fs::create_dir_all(applications_dir.join("Zed.app"))
            .expect("failed to create fake Zed.app bundle");

        let working_dir = tempfile::tempdir().expect("cannot create workdir");

        let original_home = env::var("HOME").unwrap_or_default();
        let original_path = env::var_os("PATH");
        let original_open = env::var("SCHALTWERK_TEST_OPEN_BIN").ok();
        let original_open_log = env::var("SCHALTWERK_ZED_OPEN_LOG").ok();

        env::set_var("HOME", home_dir.path());
        let mut path_entries = vec![cli_dir.path().to_path_buf()];
        if let Some(ref orig) = original_path {
            path_entries.extend(env::split_paths(orig));
        }
        let joined = env::join_paths(path_entries).expect("failed to join PATH entries");
        env::set_var("PATH", &joined);
        env::set_var("SCHALTWERK_TEST_OPEN_BIN", open_script.to_str().unwrap());
        env::set_var("SCHALTWERK_ZED_OPEN_LOG", open_log.to_str().unwrap());

        super::open_path_in("zed", working_dir.path().to_str().unwrap())
            .expect("open fallback should succeed");

        let recorded = fs::read_to_string(&open_log).expect("open log should exist");
        assert!(
            recorded.contains(working_dir.path().to_str().unwrap()),
            "open command args: {recorded}"
        );
        assert!(recorded.contains("Zed"));

        // Restore environment
        if original_home.is_empty() {
            env::remove_var("HOME");
        } else {
            env::set_var("HOME", original_home);
        }
        if let Some(orig) = original_path {
            env::set_var("PATH", orig);
        } else {
            env::remove_var("PATH");
        }
        if let Some(open_bin) = original_open {
            env::set_var("SCHALTWERK_TEST_OPEN_BIN", open_bin);
        } else {
            env::remove_var("SCHALTWERK_TEST_OPEN_BIN");
        }
        if let Some(open_log_env) = original_open_log {
            env::set_var("SCHALTWERK_ZED_OPEN_LOG", open_log_env);
        } else {
            env::remove_var("SCHALTWERK_ZED_OPEN_LOG");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_open_with_linux_zed_cli_available() {
        use std::fs;

        let _guard = env_lock().lock().unwrap();

        let cli_dir = tempfile::tempdir().expect("cannot create temp cli dir");
        let log_file = cli_dir.path().join("zed-cli-log");
        let script_path = cli_dir.path().join("zed");
        fs::write(
            &script_path,
            "#!/bin/sh\nprintf '%s' \"$@\" > \"$SCHALTWERK_ZED_LOG\"\n",
        )
        .expect("failed to write mock zed cli");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script_path, perms).unwrap();
        }

        let original_path = env::var_os("PATH");
        let mut path_entries = vec![cli_dir.path().to_path_buf()];
        if let Some(ref orig) = original_path {
            path_entries.extend(env::split_paths(orig));
        }
        let joined = env::join_paths(path_entries).expect("failed to join PATH entries");
        env::set_var("PATH", joined);
        env::set_var("SCHALTWERK_ZED_LOG", log_file.to_str().unwrap());

        let result = super::open_with_linux("zed", "/tmp");
        assert!(result.is_ok());

        let recorded = fs::read_to_string(&log_file).expect("log file must exist");
        assert!(recorded.contains("/tmp"));

        env::remove_var("SCHALTWERK_ZED_LOG");
        if let Some(orig) = original_path {
            env::set_var("PATH", orig);
        } else {
            env::remove_var("PATH");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_open_with_linux_zed_missing() {
        let _guard = env_lock().lock().unwrap();

        let original_path = env::var_os("PATH");
        env::set_var("PATH", ".");

        let result = super::open_with_linux("zed", "/tmp");
        assert!(result
            .err()
            .expect("Expected error when zed is missing")
            .contains("Zed is not installed"));

        if let Some(orig) = original_path {
            env::set_var("PATH", orig);
        } else {
            env::remove_var("PATH");
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenApp {
    pub id: String,   // e.g., "finder", "cursor", "vscode", "ghostty", "warp", "terminal"
    pub name: String, // Display name
    pub kind: String, // "editor" | "terminal" | "system"
}

fn detect_available_apps() -> Vec<OpenApp> {
    let mut apps = Vec::new();

    #[cfg(target_os = "macos")]
    {
        apps.push(OpenApp {
            id: "finder".into(),
            name: "Finder".into(),
            kind: "system".into(),
        });
        apps.extend(detect_macos_terminals());
    }

    #[cfg(target_os = "linux")]
    {
        apps.extend(detect_linux_file_managers());
        apps.extend(detect_linux_terminals());
    }

    // Cross-platform editors
    apps.extend(detect_editors());

    apps
}

#[cfg(target_os = "linux")]
fn detect_linux_file_managers() -> Vec<OpenApp> {
    let candidates = [
        ("dolphin", "Dolphin"),
        ("nautilus", "Nautilus"),
        ("nemo", "Nemo"),
        ("pcmanfm", "PCManFM"),
        ("thunar", "Thunar"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| which::which(id).is_ok())
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "system".to_string(),
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn detect_linux_terminals() -> Vec<OpenApp> {
    let candidates = [
        ("alacritty", "Alacritty"),
        ("ghostty", "Ghostty"),
        ("gnome-terminal", "GNOME Terminal"),
        ("kgx", "Console"),
        ("kitty", "Kitty"),
        ("konsole", "Konsole"),
        ("ptyxis", "Ptyxis"),
        ("tilix", "Tilix"),
        ("tmux", "Tmux"),
        ("warp", "Warp"),
        ("wezterm", "WezTerm"),
        ("xfce4-terminal", "Xfce Terminal"),
        ("zellij", "Zellij"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| which::which(id).is_ok())
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "terminal".to_string(),
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn detect_macos_terminals() -> Vec<OpenApp> {
    vec![
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

fn detect_editors() -> Vec<OpenApp> {
    let candidates = [
        ("cursor", "Cursor"),
        ("code", "VS Code"),
        ("idea", "IntelliJ IDEA"),
        ("zed", "Zed"),
    ];

    candidates
        .iter()
        .filter(|(id, _)| {
            which::which(id).is_ok() || {
                #[cfg(target_os = "macos")]
                {
                    // Check for .app bundles on macOS
                    match *id {
                        "cursor" => std::path::Path::new("/Applications/Cursor.app").exists(),
                        "code" => {
                            std::path::Path::new("/Applications/Visual Studio Code.app").exists()
                        }
                        "idea" => find_existing_intellij_bundle().is_some(),
                        "zed" => find_existing_macos_zed_bundle().is_some(),
                        _ => false,
                    }
                }
                #[cfg(not(target_os = "macos"))]
                false
            }
        })
        .map(|(id, name)| OpenApp {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: "editor".to_string(),
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn open_with_linux(app_id: &str, path: &str) -> Result<(), String> {
    use std::process::Command;

    match app_id {
        // File managers - use xdg-open or direct command
        "dolphin" | "nautilus" | "nemo" | "pcmanfm" | "thunar" => {
            match Command::new(app_id).arg(path).status() {
                Ok(s) if s.success() => Ok(()),
                Ok(s) => Err(format!("{app_id} exited with status: {s}")),
                Err(e) => Err(format!("Failed to open in {app_id}: {e}")),
            }
        }

        // Terminals - each has different working directory args
        "alacritty" => match Command::new("alacritty")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("alacritty exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in alacritty: {e}")),
        },
        "gnome-terminal" => match Command::new("gnome-terminal")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("gnome-terminal exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in gnome-terminal: {e}")),
        },
        "konsole" => match Command::new("konsole").arg("--workdir").arg(path).status() {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("konsole exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in konsole: {e}")),
        },
        "kitty" => match Command::new("kitty").arg("--directory").arg(path).status() {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("kitty exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in kitty: {e}")),
        },
        "kgx" => match Command::new("kgx")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("kgx exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in kgx: {e}")),
        },
        "ptyxis" => match Command::new("ptyxis")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("ptyxis exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in ptyxis: {e}")),
        },
        "tilix" => match Command::new("tilix")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("tilix exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in tilix: {e}")),
        },
        "xfce4-terminal" => match Command::new("xfce4-terminal")
            .arg("--working-directory")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("xfce4-terminal exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in xfce4-terminal: {e}")),
        },
        "wezterm" => match Command::new("wezterm")
            .arg("start")
            .arg("--cwd")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("wezterm exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in wezterm: {e}")),
        },
        "ghostty" => match Command::new("ghostty")
            .arg(format!("--working-directory={path}"))
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("ghostty exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in ghostty: {e}")),
        },
        "warp" => match Command::new("warp").arg("--cwd").arg(path).status() {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("warp exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in warp: {e}")),
        },
        "tmux" => match Command::new("tmux")
            .arg("new-session")
            .arg("-c")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("tmux exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in tmux: {e}")),
        },
        "zellij" => match Command::new("zellij")
            .arg("--layout")
            .arg("default")
            .arg("--cwd")
            .arg(path)
            .status()
        {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(format!("zellij exited with status: {s}")),
            Err(e) => Err(format!("Failed to open in zellij: {e}")),
        },
        "zed" => {
            if which::which("zed").is_ok() {
                match Command::new("zed").arg(path).status() {
                    Ok(status) if status.success() => Ok(()),
                    Ok(status) => {
                        log::warn!("zed CLI exited with status code {status}");
                        Err(format!("Zed exited with status: {status}"))
                    }
                    Err(err) => {
                        log::warn!("failed to launch zed CLI: {err}");
                        Err(format!("Failed to open in Zed: {err}"))
                    }
                }
            } else {
                Err("Zed is not installed or not in PATH".to_string())
            }
        }

        // Editors - try CLI first
        "cursor" => {
            if which::which("cursor").is_ok() {
                match Command::new("cursor").arg(path).status() {
                    Ok(s) if s.success() => Ok(()),
                    Ok(s) => Err(format!("Cursor exited with status: {s}")),
                    Err(e) => Err(format!("Failed to open in Cursor: {e}")),
                }
            } else {
                Err("Cursor is not installed or not in PATH".to_string())
            }
        }
        "code" => {
            if which::which("code").is_ok() {
                match Command::new("code").arg(path).status() {
                    Ok(s) if s.success() => Ok(()),
                    Ok(s) => Err(format!("VS Code exited with status: {s}")),
                    Err(e) => Err(format!("Failed to open in VS Code: {e}")),
                }
            } else {
                Err("VS Code is not installed or not in PATH".to_string())
            }
        }
        "idea" => {
            let mut result = Err("IntelliJ IDEA is not installed or not in PATH".to_string());
            for cmd in ["idea", "idea64", "idea.sh"] {
                if which::which(cmd).is_ok() {
                    result = match Command::new(cmd).arg(path).status() {
                        Ok(s) if s.success() => Ok(()),
                        Ok(s) => Err(format!("IntelliJ IDEA exited with status: {s}")),
                        Err(e) => Err(format!("Failed to launch IntelliJ IDEA: {e}")),
                    };
                    break;
                }
            }
            result
        }

        other => Err(format!("Unsupported app id: {other}")),
    }
}

fn open_path_in(app_id: &str, path: &str) -> Result<(), String> {
    let working_dir = resolve_working_directory(path)?;

    #[cfg(target_os = "macos")]
    {
        // Existing macOS implementation
        if app_id == "ghostty" {
            return open_path_in_ghostty(working_dir.as_str());
        }

        let result = match app_id {
            "finder" => std::process::Command::new("/usr/bin/open")
                .arg(working_dir.as_str())
                .status(),
            "cursor" => {
                // Try CLI first, fall back to open -a
                if which::which("cursor").is_ok() {
                    std::process::Command::new("cursor")
                        .arg(working_dir.as_str())
                        .status()
                } else {
                    std::process::Command::new("/usr/bin/open")
                        .args(["-a", "Cursor", working_dir.as_str()])
                        .status()
                }
            }
            // Support both legacy "intellij"/"vscode" ids and new "idea"/"code" ids
            "intellij" | "idea" => return open_path_in_intellij(working_dir.as_str()),
            "vscode" | "code" => {
                // Try CLI first, fall back to open -a
                if which::which("code").is_ok() {
                    std::process::Command::new("code")
                        .arg(working_dir.as_str())
                        .status()
                } else {
                    std::process::Command::new("/usr/bin/open")
                        .args(["-a", "Visual Studio Code", working_dir.as_str()])
                        .status()
                }
            }
            "zed" => return open_path_in_zed(working_dir.as_str()),
            "warp" => {
                // Try CLI first, fall back to open -a
                if which::which("warp").is_ok() {
                    std::process::Command::new("warp")
                        .arg("--cwd")
                        .arg(working_dir.as_str())
                        .status()
                } else {
                    std::process::Command::new("/usr/bin/open")
                        .args(["-a", "Warp", working_dir.as_str()])
                        .status()
                }
            }
            "terminal" => std::process::Command::new("/usr/bin/open")
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
                    "vscode" | "code" => "VS Code",
                    "warp" => "Warp",
                    "terminal" => "Terminal",
                    "ghostty" => "Ghostty",
                    "intellij" | "idea" => "IntelliJ IDEA",
                    "zed" => "Zed",
                    _ => app_id,
                };
                Err(format!("{app_name} is not installed. Please install it from the official website or choose a different application."))
            }
            Err(e) => {
                // Command execution failed
                let app_name = match app_id {
                    "cursor" => "Cursor",
                    "vscode" | "code" => "VS Code",
                    "warp" => "Warp",
                    "terminal" => "Terminal",
                    "finder" => "Finder",
                    "ghostty" => "Ghostty",
                    "intellij" | "idea" => "IntelliJ IDEA",
                    "zed" => "Zed",
                    _ => app_id,
                };
                Err(format!("Failed to open in {app_name}: {e}"))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        open_with_linux(app_id, working_dir.as_str())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
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

#[cfg(target_os = "macos")]
fn open_path_in_ghostty(working_dir: &str) -> Result<(), String> {
    let working_dir_flag = format!("--working-directory={working_dir}");

    #[cfg(target_os = "macos")]
    {
        let open_status = std::process::Command::new("/usr/bin/open")
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
        let cli_status = std::process::Command::new("ghostty")
            .arg(working_dir_flag.as_str())
            .status();
        match cli_status {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {
                let shim_status = std::process::Command::new("ghostty")
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

#[cfg(target_os = "macos")]
fn open_path_in_intellij(path: &str) -> Result<(), String> {
    if which::which("idea").is_ok() {
        match std::process::Command::new("idea").arg(path).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to open in IntelliJ IDEA: {e}"));
            }
        }
    }

    if which::which("idea64").is_ok() {
        match std::process::Command::new("idea64").arg(path).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to open in IntelliJ IDEA: {e}"));
            }
        }
    }

    if let Some(bundle) = find_existing_intellij_bundle() {
        match std::process::Command::new("/usr/bin/open")
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
        match std::process::Command::new("/usr/bin/open")
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

#[cfg(target_os = "macos")]
fn open_path_in_zed(path: &str) -> Result<(), String> {
    use std::process::Command;

    if which::which("zed").is_ok() {
        match Command::new("zed").arg(path).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                log::warn!("zed CLI exited with status code {status}");
            }
            Err(err) => {
                log::warn!("failed to launch zed CLI: {err}");
            }
        }
    }

    let open_bin = macos_open_binary();

    if let Some(bundle) = find_existing_macos_zed_bundle() {
        match std::process::Command::new(&open_bin)
            .arg("-a")
            .arg(bundle.as_os_str())
            .arg(path)
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                log::warn!("open -a {bundle:?} exited with status code {status}");
            }
            Err(err) => {
                log::warn!("failed to invoke open for {bundle:?}: {err}");
            }
        }
    }

    // Fallback to using application name if the bundle path did not resolve.
    match std::process::Command::new(&open_bin)
        .args(["-a", "Zed", path])
        .status()
    {
        Ok(status) if status.success() => return Ok(()),
        Ok(status) => {
            log::warn!("open -a Zed exited with status code {status}");
        }
        Err(err) => {
            log::warn!("failed to invoke open -a Zed: {err}");
        }
    }

    Err("Zed is not installed or not in PATH. Install Zed and try again.".into())
}

#[cfg(target_os = "macos")]
fn find_existing_macos_zed_bundle() -> Option<std::path::PathBuf> {
    macos_zed_bundle_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(target_os = "macos")]
fn macos_zed_bundle_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = vec![std::path::PathBuf::from("/Applications/Zed.app")];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/Zed.app"));
    }

    candidates
        .into_iter()
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .collect()
}

#[cfg(target_os = "macos")]
fn macos_open_binary() -> std::path::PathBuf {
    #[cfg(test)]
    if let Ok(custom) = std::env::var("SCHALTWERK_TEST_OPEN_BIN") {
        return std::path::PathBuf::from(custom);
    }

    std::path::PathBuf::from("/usr/bin/open")
}

#[cfg(target_os = "macos")]
fn find_existing_intellij_bundle() -> Option<std::path::PathBuf> {
    intellij_app_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
}

#[cfg(target_os = "macos")]
fn intellij_app_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    push_bundle_variants(&mut candidates, std::path::PathBuf::from("/Applications"));

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

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|p| !p.as_os_str().is_empty())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

#[cfg(target_os = "macos")]
fn push_bundle_variants(candidates: &mut Vec<std::path::PathBuf>, base_dir: std::path::PathBuf) {
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

#[cfg(target_os = "macos")]
fn collect_intellij_apps_in_dir(
    dir: &Path,
    candidates: &mut Vec<std::path::PathBuf>,
    depth: usize,
) {
    if depth > 4 {
        return;
    }

    if !dir.exists() {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
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

#[cfg(target_os = "macos")]
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

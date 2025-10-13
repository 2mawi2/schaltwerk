use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const APP_IDENTIFIER: &str = "com.mariuswichtner.schaltwerk";
const APP_DISPLAY_NAME: &str = "Schaltwerk";

#[derive(Serialize)]
pub struct PermissionDiagnostics {
    pub bundle_identifier: String,
    pub executable_path: String,
    pub install_kind: String,
    pub app_display_name: String,
}

#[tauri::command]
pub async fn check_folder_access(path: String) -> Result<bool, String> {
    let path = Path::new(&path);

    match fs::read_dir(path) {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                log::info!("Permission denied for folder: {}", path.display());
                Ok(false)
            } else if e.kind() == std::io::ErrorKind::NotFound {
                log::info!("Folder not found: {}", path.display());
                Err(format!("Folder not found: {}", path.display()))
            } else {
                log::error!("Error accessing folder {}: {}", path.display(), e);
                Err(format!("Error accessing folder: {e}"))
            }
        }
    }
}

#[tauri::command]
pub async fn trigger_folder_permission_request(path: String) -> Result<(), String> {
    let path = Path::new(&path);

    log::info!(
        "Attempting to trigger permission request for: {}",
        path.display()
    );

    match fs::read_dir(path) {
        Ok(mut entries) => {
            if let Some(Ok(_)) = entries.next() {
                log::info!("Successfully accessed folder: {}", path.display());
                Ok(())
            } else {
                log::info!("Folder is empty but accessible: {}", path.display());
                Ok(())
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                log::info!(
                    "Permission dialog should have been triggered for: {}",
                    path.display()
                );
                Err("Permission required - please grant access when prompted".to_string())
            } else {
                log::error!("Error accessing folder {}: {}", path.display(), e);
                Err(format!("Error accessing folder: {e}"))
            }
        }
    }
}

#[tauri::command]
pub async fn ensure_folder_permission(path: String) -> Result<(), String> {
    trigger_folder_permission_request(path).await
}

#[cfg(target_os = "macos")]
fn detect_install_kind(executable: &Path) -> &'static str {
    let path_str = executable.to_string_lossy();

    if path_str.contains(".app/Contents/MacOS/") {
        "app-bundle"
    } else if path_str.contains("/Cellar/") || path_str.contains("/Homebrew/Cellar/") {
        "homebrew"
    } else if path_str.contains("/target/debug/") || path_str.contains("/target/release/") {
        "justfile"
    } else if executable
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("schaltwerk"))
        .unwrap_or(false)
    {
        "standalone"
    } else {
        "other"
    }
}

#[tauri::command]
pub async fn get_permission_diagnostics() -> Result<PermissionDiagnostics, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Permission diagnostics are only required on macOS.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Failed to determine executable path: {e}"))?;
        let canonical = exe
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(&exe));

        let install_kind = detect_install_kind(&canonical).to_string();

        Ok(PermissionDiagnostics {
            bundle_identifier: APP_IDENTIFIER.to_string(),
            executable_path: canonical.to_string_lossy().to_string(),
            install_kind,
            app_display_name: APP_DISPLAY_NAME.to_string(),
        })
    }
}

#[tauri::command]
pub async fn open_documents_privacy_settings() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Opening System Settings is only supported on macOS.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let targets = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
            "x-apple.systempreferences:com.apple.preference.security?Privacy",
        ];

        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            for target in targets {
                log::info!("Opening System Settings with target: {target}");
                let output = Command::new("open")
                    .arg(target)
                    .output()
                    .map_err(|e| format!("Failed to run 'open' for {target}: {e}"))?;

                if output.status.success() {
                    return Ok(());
                }

                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!(
                    "open command for {target} exited with status {}: {}",
                    output.status,
                    stderr
                );
            }

            Err("Failed to open System Settings for Files and Folders.".to_string())
        })
        .await
        .map_err(|e| format!("Failed to launch System Settings task: {e}"))??;

        Ok(())
    }
}

#[tauri::command]
pub async fn reset_folder_permissions() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Permission reset is only supported on macOS.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let identifier = APP_IDENTIFIER.to_string();

        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let services = [
                "SystemPolicyDocumentsFolder",
                "SystemPolicyDesktopFolder",
                "SystemPolicyDownloadsFolder",
            ];

            for service in services {
                log::info!(
                    "Resetting TCC permission for {service} with bundle {identifier}"
                );
                let output = Command::new("tccutil")
                    .arg("reset")
                    .arg(service)
                    .arg(&identifier)
                    .output()
                    .map_err(|e| format!("Failed to run tccutil reset {service}: {e}"))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!(
                        "tccutil reset {service} failed with status {}: {}",
                        output.status, stderr
                    ));
                }
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("Failed to reset permissions: {e}"))??;

        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_app_bundle_install_kind() {
        let path =
            PathBuf::from("/Applications/Schaltwerk.app/Contents/MacOS/schaltwerk");
        assert_eq!(detect_install_kind(&path), "app-bundle");
    }

    #[test]
    fn detects_homebrew_install_kind() {
        let path = PathBuf::from("/opt/homebrew/Cellar/schaltwerk/1.0.0/bin/schaltwerk");
        assert_eq!(detect_install_kind(&path), "homebrew");
    }

    #[test]
    fn detects_dev_install_kind() {
        let path = PathBuf::from(
            "/Users/example/Documents/git/schaltwerk/src-tauri/target/debug/schaltwerk",
        );
        assert_eq!(detect_install_kind(&path), "justfile");
    }

    #[test]
    fn detects_standalone_install_kind() {
        let path = PathBuf::from("/tmp/custom/schaltwerk");
        assert_eq!(detect_install_kind(&path), "standalone");
    }
}

use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedBinary {
    pub path: String,
    pub version: Option<String>,
    pub installation_method: InstallationMethod,
    pub is_recommended: bool,
    pub is_symlink: bool,
    pub symlink_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum InstallationMethod {
    Homebrew = 0,
    Npm = 1,
    Pip = 2,
    Manual = 3,
    System = 4,
}

pub fn check_binary(
    path: &Path,
    installation_method: InstallationMethod,
) -> Option<DetectedBinary> {
    if !path.exists() {
        return None;
    }

    let symlink_metadata = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return None,
    };

    let is_symlink = symlink_metadata.file_type().is_symlink();

    let metadata = if is_symlink {
        match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return None,
        }
    } else {
        symlink_metadata
    };

    if !metadata.is_file() {
        return None;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }

    let symlink_target = if is_symlink {
        fs::read_link(path)
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };

    if is_symlink && symlink_target.is_none() {
        debug!("Skipping broken symlink: {}", path.display());
        return None;
    }

    let version = detect_version(path);

    info!(
        "Found {} binary at: {} ({})",
        path.file_name()?.to_string_lossy(),
        path.display(),
        if is_symlink { "symlink" } else { "binary" }
    );

    Some(DetectedBinary {
        path: path.to_string_lossy().to_string(),
        version,
        installation_method,
        is_recommended: false,
        is_symlink,
        symlink_target,
    })
}

fn detect_version(path: &Path) -> Option<String> {
    let version_flags = vec!["--version", "-v", "version"];

    for flag in version_flags {
        if let Ok(output) = Command::new(path).arg(flag).output() {
            if output.status.success() {
                let version_output = String::from_utf8_lossy(&output.stdout);
                if !version_output.trim().is_empty() {
                    let version = version_output.lines().next().unwrap_or("").trim();
                    if !version.is_empty() {
                        debug!("Detected version for {}: {}", path.display(), version);
                        return Some(version.to_string());
                    }
                }
            }
        }
    }

    debug!("Could not detect version for: {}", path.display());
    None
}

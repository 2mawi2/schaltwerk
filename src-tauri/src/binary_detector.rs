use log::{debug, info};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub use crate::utils::binary_utils::{check_binary, DetectedBinary, InstallationMethod};

impl InstallationMethod {
    fn priority(&self) -> u8 {
        match self {
            InstallationMethod::Homebrew => 0,
            InstallationMethod::Npm => 1,
            InstallationMethod::Pip => 2,
            InstallationMethod::Manual => 3,
            InstallationMethod::System => 4,
        }
    }
}

pub struct BinaryDetector;

impl BinaryDetector {
    pub fn detect_agent_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        debug!("Starting binary detection for agent: {agent_name}");

        binaries.extend(Self::detect_homebrew_binaries(agent_name));
        binaries.extend(Self::detect_npm_binaries(agent_name));
        binaries.extend(Self::detect_pip_binaries(agent_name));
        binaries.extend(Self::detect_manual_binaries(agent_name));
        binaries.extend(Self::detect_path_binaries(agent_name));

        Self::deduplicate_and_rank(binaries)
    }

    fn detect_homebrew_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        let homebrew_paths = vec![
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/homebrew/Cellar",
        ];

        for base_path in homebrew_paths {
            let path = Path::new(base_path);
            if !path.exists() {
                debug!("Homebrew path does not exist: {base_path}");
                continue;
            }

            if base_path.contains("Cellar") {
                debug!("Scanning Homebrew Cellar for {agent_name} at {base_path}");
                binaries.extend(Self::scan_homebrew_cellar(agent_name, path));
            } else {
                let binary_path = path.join(agent_name);
                debug!("Checking for {agent_name} at {}", binary_path.display());
                if let Some(detected) = check_binary(&binary_path, InstallationMethod::Homebrew) {
                    info!("Found Homebrew binary: {} at {}", agent_name, detected.path);
                    binaries.push(detected);
                }
            }
        }

        debug!(
            "Found {} Homebrew binaries for {agent_name}",
            binaries.len()
        );
        binaries
    }

    fn scan_homebrew_cellar(agent_name: &str, cellar_path: &Path) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        // First check node/*/bin for npm packages installed in Homebrew's node
        let node_path = cellar_path.join("node");
        if node_path.exists() {
            debug!("Checking node path in Cellar: {}", node_path.display());
            if let Ok(version_entries) = fs::read_dir(&node_path) {
                for version_entry in version_entries.flatten() {
                    let version_path = version_entry.path();
                    let bin_path = version_path.join("bin").join(agent_name);

                    debug!("Checking node bin path: {}", bin_path.display());
                    if let Some(detected) = check_binary(&bin_path, InstallationMethod::Homebrew) {
                        info!("Found in Cellar/node: {} at {}", agent_name, detected.path);
                        binaries.push(detected);
                    }
                }
            }
        }

        // Then check other packages in Cellar
        if let Ok(entries) = fs::read_dir(cellar_path) {
            for entry in entries.flatten() {
                let package_path = entry.path();
                if !package_path.is_dir() {
                    continue;
                }

                // Skip node directory as we already checked it
                if package_path.file_name() == Some(std::ffi::OsStr::new("node")) {
                    continue;
                }

                if let Ok(version_entries) = fs::read_dir(&package_path) {
                    for version_entry in version_entries.flatten() {
                        let version_path = version_entry.path();
                        let bin_path = version_path.join("bin").join(agent_name);

                        if let Some(detected) =
                            check_binary(&bin_path, InstallationMethod::Homebrew)
                        {
                            info!("Found in Cellar: {} at {}", agent_name, detected.path);
                            binaries.push(detected);
                        }
                    }
                }
            }
        }

        binaries
    }

    fn detect_npm_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        let npm_paths = vec![
            Self::get_npm_global_path(),
            Some(PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".npm-global/bin")),
            Some(PathBuf::from("/usr/local/lib/node_modules/.bin")),
            Some(PathBuf::from("/opt/homebrew/lib/node_modules/.bin")),
        ];

        for npm_path_opt in npm_paths.into_iter().flatten() {
            let binary_path = npm_path_opt.join(agent_name);
            if let Some(detected) = check_binary(&binary_path, InstallationMethod::Npm) {
                binaries.push(detected);
            }
        }

        binaries
    }

    fn get_npm_global_path() -> Option<PathBuf> {
        let output = Command::new("npm").args(["root", "-g"]).output().ok()?;

        if output.status.success() {
            let root_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Some(PathBuf::from(root_path).join(".bin"))
        } else {
            None
        }
    }

    fn detect_pip_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        let home = std::env::var("HOME").unwrap_or_default();
        let pip_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/Library/Python/3.11/bin", home),
            format!("{}/Library/Python/3.10/bin", home),
            format!("{}/Library/Python/3.9/bin", home),
            format!("{}/.pyenv/shims", home),
        ];

        for pip_path in pip_paths {
            let binary_path = PathBuf::from(&pip_path).join(agent_name);
            debug!("Checking for {agent_name} at {}", binary_path.display());
            if let Some(detected) = check_binary(&binary_path, InstallationMethod::Pip) {
                info!("Found Pip binary: {} at {}", agent_name, detected.path);
                binaries.push(detected);
            }
        }

        debug!("Found {} Pip binaries for {agent_name}", binaries.len());
        binaries
    }

    fn detect_manual_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        let home_bin = format!("{}/bin", std::env::var("HOME").unwrap_or_default());
        let manual_paths = vec!["/usr/local/bin", "/usr/bin", "/bin", &home_bin];

        for manual_path in manual_paths {
            let binary_path = PathBuf::from(manual_path).join(agent_name);
            if let Some(detected) = check_binary(&binary_path, InstallationMethod::Manual) {
                binaries.push(detected);
            }
        }

        binaries
    }

    fn detect_path_binaries(agent_name: &str) -> Vec<DetectedBinary> {
        let mut binaries = Vec::new();

        if let Ok(path_var) = std::env::var("PATH") {
            debug!("Searching PATH for {agent_name}: {path_var}");
            for path_dir in path_var.split(':') {
                let binary_path = PathBuf::from(path_dir).join(agent_name);
                if let Some(detected) = check_binary(&binary_path, InstallationMethod::System) {
                    info!(
                        "Found System PATH binary: {} at {}",
                        agent_name, detected.path
                    );
                    binaries.push(detected);
                }
            }
        } else {
            debug!("PATH environment variable not found");
        }

        debug!("Found {} PATH binaries for {agent_name}", binaries.len());
        binaries
    }

    fn deduplicate_and_rank(mut binaries: Vec<DetectedBinary>) -> Vec<DetectedBinary> {
        binaries.sort_by(|a, b| {
            a.installation_method
                .priority()
                .cmp(&b.installation_method.priority())
                .then_with(|| a.path.cmp(&b.path))
        });

        binaries.dedup_by(|a, b| a.path == b.path);

        if !binaries.is_empty() {
            binaries[0].is_recommended = true;
        }

        info!("Final detected binaries count: {}", binaries.len());
        if let Some(recommended) = binaries.iter().find(|b| b.is_recommended) {
            info!(
                "Recommended binary: {} ({})",
                recommended.path,
                format!("{:?}", recommended.installation_method).to_lowercase()
            );
        }

        binaries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn create_test_binary(dir: &Path, name: &str, executable: bool) -> PathBuf {
        let binary_path = dir.join(name);
        fs::write(&binary_path, "#!/bin/bash\necho 'test version 1.0.0'\n").unwrap();

        if executable {
            let mut perms = fs::metadata(&binary_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&binary_path, perms).unwrap();
        }

        binary_path
    }

    #[test]
    fn test_binary_detection_executable() {
        let temp_dir = TempDir::new().unwrap();
        let binary_path = create_test_binary(temp_dir.path(), "test-agent", true);

        let detected = check_binary(&binary_path, InstallationMethod::Manual);
        assert!(detected.is_some());

        let binary = detected.unwrap();
        assert_eq!(binary.path, binary_path.to_string_lossy());
        assert!(!binary.is_symlink);
        assert_eq!(binary.installation_method, InstallationMethod::Manual);
    }

    #[test]
    fn test_binary_detection_non_executable() {
        let temp_dir = TempDir::new().unwrap();
        let binary_path = create_test_binary(temp_dir.path(), "test-agent", false);

        let detected = check_binary(&binary_path, InstallationMethod::Manual);
        assert!(detected.is_none());
    }

    #[test]
    fn test_binary_detection_symlink() {
        let temp_dir = TempDir::new().unwrap();
        let target_path = create_test_binary(temp_dir.path(), "target-binary", true);
        let symlink_path = temp_dir.path().join("symlink-binary");

        std::os::unix::fs::symlink(&target_path, &symlink_path).unwrap();

        let detected = check_binary(&symlink_path, InstallationMethod::Manual);
        assert!(detected.is_some());

        let binary = detected.unwrap();
        assert!(binary.is_symlink);
        assert_eq!(
            binary.symlink_target,
            Some(target_path.to_string_lossy().to_string())
        );
    }

    #[test]
    fn test_installation_method_priority() {
        assert!(InstallationMethod::Homebrew.priority() < InstallationMethod::Npm.priority());
        assert!(InstallationMethod::Npm.priority() < InstallationMethod::Pip.priority());
        assert!(InstallationMethod::Pip.priority() < InstallationMethod::Manual.priority());
        assert!(InstallationMethod::Manual.priority() < InstallationMethod::System.priority());
    }

    #[test]
    fn test_deduplication_and_ranking() {
        let binaries = vec![
            DetectedBinary {
                path: "/opt/homebrew/bin/agent".to_string(),
                version: Some("1.0.0".to_string()),
                installation_method: InstallationMethod::Homebrew,
                is_recommended: false,
                is_symlink: false,
                symlink_target: None,
            },
            DetectedBinary {
                path: "/usr/local/bin/agent".to_string(),
                version: Some("0.9.0".to_string()),
                installation_method: InstallationMethod::Npm,
                is_recommended: false,
                is_symlink: false,
                symlink_target: None,
            },
            DetectedBinary {
                path: "/opt/homebrew/bin/agent".to_string(),
                version: Some("1.0.0".to_string()),
                installation_method: InstallationMethod::Homebrew,
                is_recommended: false,
                is_symlink: false,
                symlink_target: None,
            },
        ];

        let result = BinaryDetector::deduplicate_and_rank(binaries);

        assert_eq!(result.len(), 2);
        assert!(result[0].is_recommended);
        assert_eq!(result[0].installation_method, InstallationMethod::Homebrew);
        assert!(!result[1].is_recommended);
    }
}

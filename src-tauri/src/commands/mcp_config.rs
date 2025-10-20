use serde::{Deserialize, Serialize};
use serde_json;
use std::path::PathBuf;
use std::process::Command;

const MCP_SERVER_PATH: &str = "mcp-server/build/schaltwerk-mcp-server.js";

// Client-specific configuration logic (Claude, Codex)
mod client {
    use super::*;
    use schaltwerk::binary_detector::BinaryDetector;
    use schaltwerk::domains::settings::AgentBinaryConfig;
    use schaltwerk::utils::binary_utils::DetectedBinary;
    use std::collections::HashSet;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use which::which;

    #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
    pub enum McpClient {
        #[serde(rename = "claude")]
        Claude,
        #[serde(rename = "codex")]
        Codex,
        #[serde(rename = "opencode")]
        OpenCode,
    }

    impl McpClient {
        pub fn as_str(&self) -> &'static str {
            match self {
                Self::Claude => "claude",
                Self::Codex => "codex",
                Self::OpenCode => "opencode",
            }
        }
    }

    fn select_cli_path(
        config: Option<AgentBinaryConfig>,
        detected: &[DetectedBinary],
    ) -> Option<PathBuf> {
        let mut candidates = Vec::new();

        if let Some(mut cfg) = config {
            if let Some(custom) = cfg.custom_path.take() {
                candidates.push(PathBuf::from(custom));
            }

            if let Some(recommended) = cfg
                .detected_binaries
                .iter()
                .find(|binary| binary.is_recommended)
                .map(|binary| binary.path.clone())
            {
                candidates.push(PathBuf::from(recommended));
            }

            for binary in cfg.detected_binaries.into_iter() {
                candidates.push(PathBuf::from(binary.path));
            }
        }

        for binary in detected {
            candidates.push(PathBuf::from(&binary.path));
        }

        let mut seen = HashSet::new();
        candidates.retain(|path| seen.insert(path.clone()));

        candidates.into_iter().find(|path| is_executable(path))
    }

    fn is_executable(path: &Path) -> bool {
        if !path.exists() {
            return false;
        }

        let Ok(metadata) = fs::metadata(path) else {
            return false;
        };

        if !metadata.is_file() {
            return false;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode() & 0o111 != 0
        }

        #[cfg(not(unix))]
        {
            true
        }
    }

    async fn load_agent_binary_config(client: McpClient) -> Option<AgentBinaryConfig> {
        if let Some(manager) = crate::SETTINGS_MANAGER.get() {
            let guard = manager.lock().await;
            guard.get_agent_binary_config(client.as_str())
        } else {
            None
        }
    }

    fn resolve_cli_path_from_sources(
        client: McpClient,
        config: Option<AgentBinaryConfig>,
    ) -> Option<PathBuf> {
        let detected = BinaryDetector::detect_agent_binaries(client.as_str());

        if let Some(path) = select_cli_path(config, &detected) {
            return Some(path);
        }

        which(client.as_str()).ok()
    }

    pub async fn resolve_cli_path(client: McpClient) -> Option<PathBuf> {
        let config = load_agent_binary_config(client).await;
        resolve_cli_path_from_sources(client, config)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use schaltwerk::domains::settings::AgentBinaryConfig;
        use schaltwerk::utils::binary_utils::{DetectedBinary, InstallationMethod};
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        fn make_executable(temp_dir: &TempDir, name: &str) -> PathBuf {
            let path = temp_dir.path().join(name);
            fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
            let mut perms = fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).unwrap();
            path
        }

        fn detected(path: &PathBuf) -> DetectedBinary {
            DetectedBinary {
                path: path.to_string_lossy().to_string(),
                version: None,
                installation_method: InstallationMethod::Homebrew,
                is_recommended: true,
                is_symlink: false,
                symlink_target: None,
            }
        }

        #[test]
        fn select_cli_path_prefers_custom_path() {
            let temp_dir = TempDir::new().unwrap();
            let custom = make_executable(&temp_dir, "claude");

            let config = AgentBinaryConfig {
                agent_name: "claude".into(),
                custom_path: Some(custom.to_string_lossy().to_string()),
                auto_detect: false,
                detected_binaries: vec![],
            };

            let result = select_cli_path(Some(config), &[]).expect("cli path");
            assert_eq!(result, custom);
        }

        #[test]
        fn select_cli_path_prefers_recommended_detected() {
            let temp_dir = TempDir::new().unwrap();
            let detected_path = make_executable(&temp_dir, "claude");

            let config = AgentBinaryConfig {
                agent_name: "claude".into(),
                custom_path: None,
                auto_detect: true,
                detected_binaries: vec![detected(&detected_path)],
            };

            let result = select_cli_path(Some(config), &[]).expect("cli path");
            assert_eq!(result, detected_path);
        }

        #[test]
        fn select_cli_path_uses_detected_when_no_config() {
            let temp_dir = TempDir::new().unwrap();
            let detected_path = make_executable(&temp_dir, "claude");

            let detection = vec![detected(&detected_path)];

            let result = select_cli_path(None, &detection).expect("cli path");
            assert_eq!(result, detected_path);
        }

        #[tokio::test]
        async fn check_cli_availability_runs_without_blocking() {
            // Should never panic even when executed inside an async runtime.
            let _ = super::check_cli_availability(super::McpClient::Claude).await;
        }
    }

    pub async fn check_cli_availability(client: McpClient) -> bool {
        resolve_cli_path(client).await.is_some()
    }

    pub async fn configure_mcp(
        client: McpClient,
        project_path: &str,
        mcp_server_path: &str,
    ) -> Result<String, String> {
        match client {
            McpClient::Claude => {
                let cli_path = resolve_cli_path(McpClient::Claude)
                    .await
                    .ok_or_else(|| {
                        "Claude CLI not found. Install the claude command or set a custom path in Settings → Agent Configuration.".to_string()
                    })?;
                configure_mcp_claude(&cli_path, project_path, mcp_server_path)
            }
            McpClient::Codex => configure_mcp_codex(mcp_server_path),
            McpClient::OpenCode => configure_mcp_opencode(project_path, mcp_server_path),
        }
    }

    fn configure_mcp_claude(
        cli_path: &Path,
        project_path: &str,
        mcp_server_path: &str,
    ) -> Result<String, String> {
        log::info!("Configuring Claude MCP using CLI at {}", cli_path.display());

        let output = Command::new(cli_path)
            .args([
                "mcp",
                "add",
                "--transport",
                "stdio",
                "--scope",
                "project",
                "schaltwerk",
                "node",
                mcp_server_path,
            ])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run claude CLI at {}: {e}", cli_path.display()))?;

        if !output.status.success() {
            let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
            stderr = strip_ansi(&stderr);
            log::error!("claude CLI failed: {stderr}");
            return Err(format!("claude CLI failed: {stderr}"));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::info!("MCP configured successfully: {stdout}");
        Ok("MCP server configured successfully for this project".to_string())
    }

    fn configure_mcp_codex(mcp_server_path: &str) -> Result<String, String> {
        let (config_path, created_dir) = codex_config_path()?;
        if created_dir {
            if let Some(parent) = config_path.parent() {
                log::info!("Created Codex config directory at {}", parent.display());
            }
        }
        let mut content = if config_path.exists() {
            fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read Codex config: {e}"))?
        } else {
            String::from("# Generated by Schaltwerk\n\n")
        };
        let section_header = "[mcp_servers.schaltwerk]\n";
        if let Some(start) = content.find(section_header) {
            let mut end = content.len();
            for (i, _) in content[start + section_header.len()..].match_indices('\n') {
                let pos = start + section_header.len() + i + 1;
                if content[pos..].starts_with('[') {
                    end = pos;
                    break;
                }
            }
            content.replace_range(start..end, "");
        }
        let snippet = format!(
            "[mcp_servers.schaltwerk]\ncommand = \"node\"\nargs = [\"{}\"]\n\n",
            mcp_server_path.replace('"', "\\\"")
        );
        content.push_str(&snippet);
        if let Some(dir) = config_path.parent() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create Codex config dir: {e}"))?;
        }
        let mut f = fs::File::create(&config_path)
            .map_err(|e| format!("Failed to write Codex config: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write Codex config: {e}"))?;
        log::info!("Wrote Codex MCP config at {}", config_path.display());
        Ok("Codex MCP configured in ~/.codex/config.toml".to_string())
    }

    pub async fn remove_mcp(client: McpClient, project_path: &str) -> Result<String, String> {
        match client {
            McpClient::Claude => {
                let cli_path = resolve_cli_path(McpClient::Claude)
                    .await
                    .ok_or_else(|| {
                        "Claude CLI not found. Install the claude command or set a custom path in Settings → Agent Configuration.".to_string()
                    })?;
                remove_mcp_claude(&cli_path, project_path)
            }
            McpClient::Codex => remove_mcp_codex(),
            McpClient::OpenCode => remove_mcp_opencode(project_path),
        }
    }

    fn remove_mcp_claude(cli_path: &Path, project_path: &str) -> Result<String, String> {
        let output = Command::new(cli_path)
            .args(["mcp", "remove", "schaltwerk"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run claude CLI at {}: {e}", cli_path.display()))?;
        if !output.status.success() {
            let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
            stderr = strip_ansi(&stderr);
            log::error!("Failed to remove MCP: {stderr}");
            return Err(format!("Failed to remove MCP: {stderr}"));
        }
        log::info!("MCP configuration removed successfully");
        Ok("MCP server removed from project".to_string())
    }

    fn remove_mcp_codex() -> Result<String, String> {
        let (config_path, _created) = codex_config_path()?;
        if !config_path.exists() {
            return Ok("Codex config not found".to_string());
        }
        let mut content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read Codex config: {e}"))?;
        let section_header = "[mcp_servers.schaltwerk]\n";
        if let Some(start) = content.find(section_header) {
            let mut end = content.len();
            for (i, _) in content[start + section_header.len()..].match_indices('\n') {
                let pos = start + section_header.len() + i + 1;
                if content[pos..].starts_with('[') {
                    end = pos;
                    break;
                }
            }
            content.replace_range(start..end, "");
            fs::write(&config_path, content)
                .map_err(|e| format!("Failed to update Codex config: {e}"))?;
            Ok("Removed schaltwerk MCP from Codex config".to_string())
        } else {
            Ok("schaltwerk MCP not present in Codex config".to_string())
        }
    }

    pub fn generate_setup_command(client: McpClient, mcp_server_path: &str) -> String {
        match client {
            McpClient::Claude => format!("{} mcp add --transport stdio --scope project schaltwerk node \"{mcp_server_path}\"", client.as_str()),
            McpClient::Codex => format!(
                "Add to ~/.codex/config.toml:\n[mcp_servers.schaltwerk]\ncommand = \"node\"\nargs = [\"{}\"]",
                mcp_server_path.replace('"', "\\\"")
            ),
            McpClient::OpenCode => format!(
                "Add to opencode.json:\n{{\n  \"mcp\": {{\n    \"schaltwerk\": {{\n      \"type\": \"local\",\n      \"command\": [\"node\", \"{}\"],\n      \"enabled\": true\n    }}\n  }}\n}}",
                mcp_server_path.replace('"', "\\\"")
            ),
        }
    }

    fn strip_ansi(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let bytes = input.as_bytes();
        let mut i = 0usize;
        while i < bytes.len() {
            let ch = bytes[i];
            if ch == 0x1B {
                // ESC
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'm' {
                        break;
                    }
                    i += 1;
                }
            } else {
                out.push(ch as char);
            }
            i += 1;
        }
        out
    }

    pub fn codex_config_path() -> Result<(PathBuf, bool), String> {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        let base = std::env::var("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".codex"));
        let path = base.join("config.toml");
        Ok((path, !base.exists()))
    }

    pub fn opencode_config_path(project_path: &str) -> Result<(PathBuf, bool), String> {
        // Check for project-specific config first
        let project_config = PathBuf::from(project_path).join("opencode.json");
        if project_config.exists() {
            return Ok((project_config, false));
        }

        // Fall back to global config
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        let global_config = home.join(".opencode").join("config.json");
        let exists = global_config.exists();
        Ok((global_config, !exists))
    }

    pub fn configure_mcp_opencode(
        project_path: &str,
        mcp_server_path: &str,
    ) -> Result<String, String> {
        let (config_path, created_dir) = opencode_config_path(project_path)?;

        if created_dir {
            if let Some(parent) = config_path.parent() {
                log::info!("Created OpenCode config directory at {}", parent.display());
            }
        }

        // Read existing config or create new one
        let config_content = if config_path.exists() {
            std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read OpenCode config: {e}"))?
        } else {
            String::from("{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}")
        };

        // Parse JSON to check if MCP section exists
        let mut config: serde_json::Value = serde_json::from_str(&config_content)
            .map_err(|e| format!("Failed to parse OpenCode config JSON: {e}"))?;

        // Ensure MCP section exists
        if config.get("mcp").is_none() {
            config["mcp"] = serde_json::json!({});
        }

        // Add or update Schaltwerk MCP server
        let mcp_section = config.get_mut("mcp").unwrap();
        let schaltwerk_config = serde_json::json!({
            "type": "local",
            "command": ["node", mcp_server_path],
            "enabled": true
        });
        mcp_section["schaltwerk"] = schaltwerk_config;

        // Write updated config
        if let Some(dir) = config_path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create OpenCode config dir: {e}"))?;
        }

        let updated_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize OpenCode config: {e}"))?;

        std::fs::write(&config_path, updated_content)
            .map_err(|e| format!("Failed to write OpenCode config: {e}"))?;

        log::info!("Wrote OpenCode MCP config at {}", config_path.display());
        Ok("OpenCode MCP configured successfully".to_string())
    }

    pub fn remove_mcp_opencode(project_path: &str) -> Result<String, String> {
        let (config_path, _) = opencode_config_path(project_path)?;

        if !config_path.exists() {
            return Ok("OpenCode config not found".to_string());
        }

        let config_content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read OpenCode config: {e}"))?;

        let mut config: serde_json::Value = serde_json::from_str(&config_content)
            .map_err(|e| format!("Failed to parse OpenCode config JSON: {e}"))?;

        // Remove Schaltwerk from MCP section
        if let Some(mcp_section) = config.get_mut("mcp") {
            if let Some(mcp_obj) = mcp_section.as_object_mut() {
                mcp_obj.remove("schaltwerk");

                // If MCP section is empty, remove it entirely
                if mcp_obj.is_empty() {
                    config.as_object_mut().unwrap().remove("mcp");
                }
            }
        }

        let updated_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize OpenCode config: {e}"))?;

        std::fs::write(&config_path, updated_content)
            .map_err(|e| format!("Failed to update OpenCode config: {e}"))?;

        Ok("Removed schaltwerk MCP from OpenCode config".to_string())
    }
}

fn detect_mcp_server_location(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    let exe_path_str = exe_path.to_string_lossy();
    let is_app_bundle = exe_path_str.contains(".app/Contents/MacOS/");

    if is_app_bundle {
        get_app_bundle_mcp_path(exe_path)
    } else if cfg!(debug_assertions) {
        get_development_mcp_path()
    } else {
        get_release_mcp_path(exe_path)
    }
}

fn get_app_bundle_mcp_path(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    log::debug!("Running from app bundle: {}", exe_path.display());
    let mcp_embedded = if cfg!(target_os = "macos") {
        exe_path
            .parent()
            .unwrap() // MacOS
            .parent()
            .unwrap() // Contents
            .join("Resources")
            .join(MCP_SERVER_PATH)
    } else {
        // For other platforms, adjust path as needed
        exe_path.parent().unwrap().join(MCP_SERVER_PATH)
    };

    if !mcp_embedded.exists() {
        log::error!("MCP server not found in app bundle at: {mcp_embedded:?}");
        return Err("MCP server not found in app bundle".to_string());
    }

    log::debug!("Using embedded MCP server at: {mcp_embedded:?}");
    Ok((mcp_embedded, true))
}

fn get_development_mcp_path() -> Result<(PathBuf, bool), String> {
    log::debug!("Running in development mode");
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = PathBuf::from(manifest_dir).parent().unwrap().to_path_buf();
    let mcp_dev_path = project_root.join(MCP_SERVER_PATH);

    if mcp_dev_path.exists() {
        log::debug!("Using development MCP server at: {mcp_dev_path:?}");
        Ok((mcp_dev_path, false))
    } else {
        log::warn!("MCP server not built in development mode");
        Err(
            "MCP server not built. Run 'cd mcp-server && bun run build' (or 'npm run build')"
                .to_string(),
        )
    }
}

fn get_release_mcp_path(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    log::debug!(
        "Running in release mode outside app bundle: {}",
        exe_path.display()
    );
    let mcp_embedded = exe_path.parent().unwrap().join(MCP_SERVER_PATH);

    if !mcp_embedded.exists() {
        log::error!("MCP server not found at: {mcp_embedded:?}");
        return Err("MCP server not found in release build".to_string());
    }

    log::debug!("Using release MCP server at: {mcp_embedded:?}");
    Ok((mcp_embedded, true))
}

fn parse_client_or_default(client: Option<String>) -> client::McpClient {
    match client.as_deref() {
        Some("codex") => client::McpClient::Codex,
        Some("opencode") => client::McpClient::OpenCode,
        _ => client::McpClient::Claude,
    }
}

fn check_opencode_config_status(project_path: &str) -> bool {
    if let Ok((config_path, _)) = client::opencode_config_path(project_path) {
        if config_path.exists() {
            std::fs::read_to_string(config_path)
                .map(|content| {
                    // Parse JSON and check if schaltwerk MCP server is configured
                    serde_json::from_str::<serde_json::Value>(&content)
                        .map(|config| {
                            config
                                .get("mcp")
                                .and_then(|mcp| mcp.get("schaltwerk"))
                                .is_some()
                        })
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        } else {
            false
        }
    } else {
        false
    }
}

fn check_mcp_configuration_status(project_path: &str, client: client::McpClient) -> bool {
    match client {
        client::McpClient::Claude => {
            let mcp_config_path = PathBuf::from(project_path).join(".mcp.json");
            if mcp_config_path.exists() {
                std::fs::read_to_string(&mcp_config_path)
                    .map(|content| content.contains("\"schaltwerk\""))
                    .unwrap_or(false)
            } else {
                false
            }
        }
        client::McpClient::Codex => {
            if let Ok((config_path, _)) = client::codex_config_path() {
                if config_path.exists() {
                    std::fs::read_to_string(config_path)
                        .map(|c| c.contains("[mcp_servers.schaltwerk]"))
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            }
        }
        client::McpClient::OpenCode => check_opencode_config_status(project_path),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MCPStatus {
    pub mcp_server_path: String,
    pub is_embedded: bool,
    pub cli_available: bool,
    pub client: String,
    pub is_configured: bool,
    pub setup_command: String,
    pub project_path: String,
}

#[tauri::command]
pub async fn get_mcp_status(
    project_path: String,
    client: Option<String>,
) -> Result<MCPStatus, String> {
    log::debug!("Getting MCP status for project: {project_path}");

    // Detect MCP server location based on build type
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;

    let (mcp_path, is_embedded) = detect_mcp_server_location(&exe_path)?;

    // Parse client and check if CLI is available
    let client = parse_client_or_default(client);
    let cli_available = client::check_cli_availability(client).await;
    log::debug!("{} CLI available: {}", client.as_str(), cli_available);

    // Check if MCP is already configured (per-client logic)
    let is_configured = check_mcp_configuration_status(&project_path, client);
    log::debug!("MCP configured for project: {is_configured}");

    // Generate setup command
    let setup_command = client::generate_setup_command(client, &mcp_path.to_string_lossy());

    Ok(MCPStatus {
        mcp_server_path: mcp_path.to_string_lossy().to_string(),
        is_embedded,
        cli_available,
        client: client.as_str().to_string(),
        is_configured,
        setup_command,
        project_path,
    })
}

#[tauri::command]
pub async fn configure_mcp_for_project(
    project_path: String,
    client: Option<String>,
) -> Result<String, String> {
    log::info!("Configuring MCP for project: {project_path}");

    let status = get_mcp_status(project_path.clone(), client.clone()).await?;
    let client = parse_client_or_default(client);

    if !status.cli_available {
        let name = client.as_str();
        log::warn!("{name} CLI not available");
        return Err(format!("CLI not found. Please install {name} first."));
    }

    // Execute client MCP configuration
    client::configure_mcp(client, &project_path, &status.mcp_server_path).await
}

#[tauri::command]
pub async fn remove_mcp_for_project(
    project_path: String,
    client: Option<String>,
) -> Result<String, String> {
    log::info!("Removing MCP configuration for project: {project_path}");

    let client = parse_client_or_default(client);
    client::remove_mcp(client, &project_path).await
}

#[tauri::command]
pub async fn ensure_mcp_gitignored(project_path: String) -> Result<String, String> {
    log::info!("Ensuring .mcp.json is in gitignore for project: {project_path}");

    let gitignore_path = PathBuf::from(&project_path).join(".gitignore");
    let mcp_entry = ".mcp.json";

    // Read existing gitignore if it exists
    let mut gitignore_content = if gitignore_path.exists() {
        std::fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {e}"))?
    } else {
        String::new()
    };

    // Check if .mcp.json is already ignored
    if gitignore_content
        .lines()
        .any(|line| line.trim() == mcp_entry)
    {
        log::debug!(".mcp.json already in gitignore");
        return Ok("Already ignored".to_string());
    }

    // Add .mcp.json to gitignore
    if !gitignore_content.is_empty() && !gitignore_content.ends_with('\n') {
        gitignore_content.push('\n');
    }
    gitignore_content.push_str(mcp_entry);
    gitignore_content.push('\n');

    // Write updated gitignore
    std::fs::write(&gitignore_path, gitignore_content)
        .map_err(|e| format!("Failed to write .gitignore: {e}"))?;

    log::info!("Added .mcp.json to gitignore");
    Ok("Added to gitignore".to_string())
}

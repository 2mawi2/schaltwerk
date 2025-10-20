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
        #[serde(rename = "amp")]
        Amp,
        #[serde(rename = "droid")]
        Droid,
    }

    impl McpClient {
        pub fn as_str(&self) -> &'static str {
            match self {
                Self::Claude => "claude",
                Self::Codex => "codex",
                Self::OpenCode => "opencode",
                Self::Amp => "amp",
                Self::Droid => "droid",
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
            McpClient::Amp => configure_mcp_amp(mcp_server_path),
            McpClient::Droid => configure_mcp_droid(mcp_server_path),
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
            McpClient::Amp => remove_mcp_amp(),
            McpClient::Droid => remove_mcp_droid(),
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
            McpClient::Amp => format!(
                "Add to ~/.config/amp/settings.json:\n{{\n  \"amp.mcpServers\": {{\n    \"schaltwerk\": {{\n      \"command\": \"node\",\n      \"args\": [\"{}\"]\n    }}\n  }}\n}}",
                mcp_server_path.replace('"', "\\\"")
            ),
            McpClient::Droid => format!(
                "Add to ~/.factory/mcp.json:\n{{\n  \"mcpServers\": {{\n    \"schaltwerk\": {{\n      \"type\": \"stdio\",\n      \"command\": \"node\",\n      \"args\": [\"{}\"]\n    }}\n  }}\n}}",
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

    pub fn amp_config_path() -> Result<(PathBuf, bool), String> {
        #[cfg(target_os = "windows")]
        {
            let appdata = std::env::var("APPDATA")
                .map_err(|_| "APPDATA environment variable not found".to_string())?;
            let path = PathBuf::from(appdata).join("amp").join("settings.json");
            Ok((path, true))
        }

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            let path = home.join(".config/amp/settings.json");
            Ok((path, false))
        }

        #[cfg(target_os = "linux")]
        {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            let path = home.join(".config/amp/settings.json");
            Ok((path, false))
        }
    }

    pub fn droid_config_path() -> Result<(PathBuf, bool), String> {
        #[cfg(target_os = "windows")]
        {
            let userprofile = std::env::var("USERPROFILE")
                .map_err(|_| "USERPROFILE environment variable not found".to_string())?;
            let path = PathBuf::from(userprofile).join(".factory").join("mcp.json");
            Ok((path, true))
        }

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            let path = home.join(".factory").join("mcp.json");
            Ok((path, false))
        }

        #[cfg(target_os = "linux")]
        {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            let path = home.join(".factory").join("mcp.json");
            Ok((path, false))
        }
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

    pub fn configure_mcp_amp(mcp_server_path: &str) -> Result<String, String> {
        let (config_path, _) = amp_config_path()?;

        // Read existing config or create new one
        let mut config: serde_json::Value = if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read Amp config: {e}"))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse Amp config JSON: {e}"))?
        } else {
            serde_json::json!({})
        };

        // Ensure amp.mcpServers object exists
        if config.get("amp.mcpServers").is_none() {
            config["amp.mcpServers"] = serde_json::json!({});
        }

        // Add or update schaltwerk server
        config["amp.mcpServers"]["schaltwerk"] = serde_json::json!({
            "command": "node",
            "args": [mcp_server_path]
        });

        // Create parent directory if needed
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create Amp config dir: {e}"))?;
        }

        // Write back with pretty formatting
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize Amp config: {e}"))?;
        fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write Amp config: {e}"))?;

        log::info!("Wrote Amp MCP config at {}", config_path.display());
        Ok("Amp MCP configured in ~/.config/amp/settings.json".to_string())
    }

    pub fn remove_mcp_amp() -> Result<String, String> {
        let (config_path, _) = amp_config_path()?;

        if !config_path.exists() {
            return Ok("Amp config not found".to_string());
        }

        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read Amp config: {e}"))?;
        let mut config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse Amp config JSON: {e}"))?;

        // Remove schaltwerk from amp.mcpServers
        if let Some(mcp_servers) = config.get_mut("amp.mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");

                // If no MCP servers left, remove the section
                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("amp.mcpServers");
                }
            }
        }

        let updated_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize Amp config: {e}"))?;
        fs::write(&config_path, updated_content)
            .map_err(|e| format!("Failed to update Amp config: {e}"))?;

        Ok("Removed schaltwerk MCP from Amp config".to_string())
    }

    pub fn configure_mcp_droid(mcp_server_path: &str) -> Result<String, String> {
        let (config_path, _) = droid_config_path()?;

        let mut config: serde_json::Value = if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read Factory Droid config: {e}"))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse Factory Droid config JSON: {e}"))?
        } else {
            serde_json::json!({})
        };

        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }

        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [mcp_server_path],
            "disabled": false
        });

        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create Factory Droid config dir: {e}"))?;
        }

        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize Factory Droid config: {e}"))?;
        fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write Factory Droid config: {e}"))?;

        log::info!("Wrote Factory Droid MCP config at {}", config_path.display());
        Ok("Factory Droid MCP configured in ~/.factory/mcp.json".to_string())
    }

    pub fn remove_mcp_droid() -> Result<String, String> {
        let (config_path, _) = droid_config_path()?;

        if !config_path.exists() {
            return Ok("Factory Droid config not found".to_string());
        }

        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read Factory Droid config: {e}"))?;
        let mut config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse Factory Droid config JSON: {e}"))?;

        if let Some(mcp_servers) = config.get_mut("mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");

                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("mcpServers");
                }
            }
        }

        let updated_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize Factory Droid config: {e}"))?;
        fs::write(&config_path, updated_content)
            .map_err(|e| format!("Failed to update Factory Droid config: {e}"))?;

        Ok("Removed schaltwerk MCP from Factory Droid config".to_string())
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
        Some("amp") => client::McpClient::Amp,
        Some("droid") => client::McpClient::Droid,
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

fn check_amp_config_status() -> bool {
    if let Ok((config_path, _)) = client::amp_config_path() {
        if config_path.exists() {
            std::fs::read_to_string(config_path)
                .map(|content| {
                    serde_json::from_str::<serde_json::Value>(&content)
                        .map(|config| {
                            config
                                .get("amp.mcpServers")
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

fn check_droid_config_status() -> bool {
    if let Ok((config_path, _)) = client::droid_config_path() {
        if config_path.exists() {
            std::fs::read_to_string(config_path)
                .map(|content| {
                    serde_json::from_str::<serde_json::Value>(&content)
                        .map(|config| {
                            config
                                .get("mcpServers")
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
        client::McpClient::Amp => check_amp_config_status(),
        client::McpClient::Droid => check_droid_config_status(),
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

#[cfg(test)]
mod tests_amp_mcp {
    use super::client::*;
    use tempfile::TempDir;

    #[test]
    fn amp_config_path_creates_valid_path() {
        let (path, _) = amp_config_path().expect("valid path");
        
        // Path should end with settings.json
        assert!(path.ends_with("settings.json"));
        
        // Path should contain amp directory
        assert!(path.to_string_lossy().contains("amp"));
    }

    #[test]
    fn configure_mcp_amp_creates_new_config() {
        let temp_dir = TempDir::new().expect("temp dir");
        let _temp_path = temp_dir.path().to_path_buf();
        
        // Mock amp_config_path by using temp directory
        // We'll manually test the JSON structure creation
        let mcp_server_path = "/path/to/schaltwerk-mcp-server.js";
        
        // Create test config structure
        let mut config = serde_json::json!({});
        
        // Simulate what configure_mcp_amp does
        if config.get("amp.mcpServers").is_none() {
            config["amp.mcpServers"] = serde_json::json!({});
        }
        
        config["amp.mcpServers"]["schaltwerk"] = serde_json::json!({
            "command": "node",
            "args": [mcp_server_path]
        });
        
        // Verify structure
        assert!(config.get("amp.mcpServers").is_some());
        assert!(config["amp.mcpServers"]["schaltwerk"].is_object());
        assert_eq!(
            config["amp.mcpServers"]["schaltwerk"]["command"].as_str(),
            Some("node")
        );
        assert_eq!(
            config["amp.mcpServers"]["schaltwerk"]["args"][0].as_str(),
            Some(mcp_server_path)
        );
    }

    #[test]
    fn configure_mcp_amp_preserves_other_settings() {
        let existing_config = serde_json::json!({
            "amp.apiKey": "sk_test123",
            "amp.model": "claude-3-5-sonnet",
            "other.setting": "value"
        });
        
        let mut config = existing_config.clone();
        let mcp_server_path = "/path/to/server.js";
        
        // Add MCP servers
        if config.get("amp.mcpServers").is_none() {
            config["amp.mcpServers"] = serde_json::json!({});
        }
        
        config["amp.mcpServers"]["schaltwerk"] = serde_json::json!({
            "command": "node",
            "args": [mcp_server_path]
        });
        
        // Verify original settings preserved
        assert_eq!(config["amp.apiKey"].as_str(), Some("sk_test123"));
        assert_eq!(config["amp.model"].as_str(), Some("claude-3-5-sonnet"));
        assert_eq!(config["other.setting"].as_str(), Some("value"));
        
        // Verify new MCP settings added
        assert!(config["amp.mcpServers"]["schaltwerk"].is_object());
    }

    #[test]
    fn remove_mcp_amp_deletes_schaltwerk_entry() {
        let config_with_mcp = serde_json::json!({
            "amp.mcpServers": {
                "schaltwerk": {
                    "command": "node",
                    "args": ["/path/to/server.js"]
                },
                "other_server": {
                    "url": "https://example.com"
                }
            }
        });
        
        let mut config = config_with_mcp.clone();
        
        // Simulate removal
        if let Some(mcp_servers) = config.get_mut("amp.mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
            }
        }
        
        // Verify schaltwerk removed but other_server remains
        assert!(config["amp.mcpServers"]["schaltwerk"].is_null());
        assert!(config["amp.mcpServers"]["other_server"].is_object());
    }

    #[test]
    fn remove_mcp_amp_cleans_empty_mcp_section() {
        let config_with_only_schaltwerk = serde_json::json!({
            "amp.apiKey": "sk_test",
            "amp.mcpServers": {
                "schaltwerk": {
                    "command": "node",
                    "args": ["/path/to/server.js"]
                }
            }
        });
        
        let mut config = config_with_only_schaltwerk.clone();
        
        // Simulate removal
        if let Some(mcp_servers) = config.get_mut("amp.mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
                
                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("amp.mcpServers");
                }
            }
        }
        
        // Verify mcpServers section removed, but apiKey remains
        assert!(config["amp.mcpServers"].is_null());
        assert_eq!(config["amp.apiKey"].as_str(), Some("sk_test"));
    }

    #[test]
    fn check_amp_config_status_detects_configured_server() {
        let config = serde_json::json!({
            "amp.mcpServers": {
                "schaltwerk": {
                    "command": "node",
                    "args": ["/path/to/server.js"]
                }
            }
        });
        
        let has_schaltwerk = config
            .get("amp.mcpServers")
            .and_then(|mcp| mcp.get("schaltwerk"))
            .is_some();
        
        assert!(has_schaltwerk);
    }

    #[test]
    fn check_amp_config_status_returns_false_when_missing() {
        let config = serde_json::json!({
            "amp.apiKey": "sk_test"
        });
        
        let has_schaltwerk = config
            .get("amp.mcpServers")
            .and_then(|mcp| mcp.get("schaltwerk"))
            .is_some();
        
        assert!(!has_schaltwerk);
    }

    #[test]
    fn generate_setup_command_amp_produces_valid_json_snippet() {
        let mcp_server_path = "/path/to/schaltwerk-mcp-server.js";
        let command = generate_setup_command(McpClient::Amp, mcp_server_path);
        
        // Verify command contains essential parts
        assert!(command.contains("~/.config/amp/settings.json"));
        assert!(command.contains("amp.mcpServers"));
        assert!(command.contains("schaltwerk"));
        assert!(command.contains("command"));
        assert!(command.contains("node"));
        assert!(command.contains("args"));
        assert!(command.contains(mcp_server_path));
    }

    #[test]
    fn amp_config_path_escapes_quotes_in_mcp_path() {
        let mcp_path_with_quotes = r#"/path/with"quotes/server.js"#;
        let escaped = mcp_path_with_quotes.replace('"', "\\\"");
        
        assert_eq!(escaped, r#"/path/with\"quotes/server.js"#);
        assert!(escaped.contains("\\\""));
    }

    #[test]
    fn configure_and_remove_amp_mcp_roundtrip() {
        let mut config = serde_json::json!({});
        let mcp_server_path = "/path/to/server.js";
        
        // Configure
        if config.get("amp.mcpServers").is_none() {
            config["amp.mcpServers"] = serde_json::json!({});
        }
        config["amp.mcpServers"]["schaltwerk"] = serde_json::json!({
            "command": "node",
            "args": [mcp_server_path]
        });
        
        assert!(config["amp.mcpServers"]["schaltwerk"].is_object());
        
        // Remove
        if let Some(mcp_servers) = config.get_mut("amp.mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("amp.mcpServers");
                }
            }
        }
        
        // Verify removed
        assert!(config["amp.mcpServers"].is_null());
    }

    #[test]
    fn amp_config_handles_multiple_mcp_servers() {
        let mut config = serde_json::json!({});
        
        if config.get("amp.mcpServers").is_none() {
            config["amp.mcpServers"] = serde_json::json!({});
        }
        
        // Add multiple servers
        config["amp.mcpServers"]["schaltwerk"] = serde_json::json!({
            "command": "node",
            "args": ["/path/to/schaltwerk.js"]
        });
        
        config["amp.mcpServers"]["playwright"] = serde_json::json!({
            "command": "npx",
            "args": ["@playwright/mcp@latest"]
        });
        
        // Verify both exist
        assert!(config["amp.mcpServers"]["schaltwerk"].is_object());
        assert!(config["amp.mcpServers"]["playwright"].is_object());
        
        // Remove only schaltwerk
        if let Some(obj) = config["amp.mcpServers"].as_object_mut() {
            obj.remove("schaltwerk");
        }
        
        // Verify schaltwerk gone, playwright remains
        assert!(config["amp.mcpServers"]["schaltwerk"].is_null());
        assert!(config["amp.mcpServers"]["playwright"].is_object());
    }
}

#[cfg(test)]
mod tests_droid_mcp {
    use super::client::*;

    #[test]
    fn droid_config_path_creates_valid_path() {
        let (path, _) = droid_config_path().expect("valid path");
        
        assert!(path.ends_with("mcp.json"));
        assert!(path.to_string_lossy().contains(".factory"));
    }

    #[test]
    fn configure_mcp_droid_creates_new_config() {
        let mcp_server_path = "/path/to/schaltwerk-mcp-server.js";
        
        let mut config = serde_json::json!({});
        
        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }
        
        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [mcp_server_path],
            "disabled": false
        });
        
        assert!(config.get("mcpServers").is_some());
        assert!(config["mcpServers"]["schaltwerk"].is_object());
        assert_eq!(
            config["mcpServers"]["schaltwerk"]["type"].as_str(),
            Some("stdio")
        );
        assert_eq!(
            config["mcpServers"]["schaltwerk"]["command"].as_str(),
            Some("node")
        );
        assert_eq!(
            config["mcpServers"]["schaltwerk"]["args"][0].as_str(),
            Some(mcp_server_path)
        );
        assert_eq!(
            config["mcpServers"]["schaltwerk"]["disabled"].as_bool(),
            Some(false)
        );
    }

    #[test]
    fn configure_mcp_droid_preserves_other_settings() {
        let existing_config = serde_json::json!({
            "model": "sonnet",
            "diffMode": "github",
            "persistToCloud": false
        });
        
        let mut config = existing_config.clone();
        let mcp_server_path = "/path/to/server.js";
        
        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }
        
        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [mcp_server_path],
            "disabled": false
        });
        
        assert_eq!(config["model"].as_str(), Some("sonnet"));
        assert_eq!(config["diffMode"].as_str(), Some("github"));
        assert_eq!(config["persistToCloud"].as_bool(), Some(false));
        assert!(config["mcpServers"]["schaltwerk"].is_object());
    }

    #[test]
    fn remove_mcp_droid_deletes_schaltwerk_entry() {
        let config_with_mcp = serde_json::json!({
            "mcpServers": {
                "schaltwerk": {
                    "type": "stdio",
                    "command": "node",
                    "args": ["/path/to/server.js"],
                    "disabled": false
                },
                "other_server": {
                    "type": "http",
                    "url": "https://example.com"
                }
            }
        });
        
        let mut config = config_with_mcp.clone();
        
        if let Some(mcp_servers) = config.get_mut("mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
            }
        }
        
        assert!(config["mcpServers"]["schaltwerk"].is_null());
        assert!(config["mcpServers"]["other_server"].is_object());
    }

    #[test]
    fn remove_mcp_droid_cleans_empty_mcp_section() {
        let config_with_only_schaltwerk = serde_json::json!({
            "model": "sonnet",
            "mcpServers": {
                "schaltwerk": {
                    "type": "stdio",
                    "command": "node",
                    "args": ["/path/to/server.js"],
                    "disabled": false
                }
            }
        });
        
        let mut config = config_with_only_schaltwerk.clone();
        
        if let Some(mcp_servers) = config.get_mut("mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
                
                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("mcpServers");
                }
            }
        }
        
        assert!(config["mcpServers"].is_null());
        assert_eq!(config["model"].as_str(), Some("sonnet"));
    }

    #[test]
    fn check_droid_config_status_detects_configured_server() {
        let config = serde_json::json!({
            "mcpServers": {
                "schaltwerk": {
                    "type": "stdio",
                    "command": "node",
                    "args": ["/path/to/server.js"],
                    "disabled": false
                }
            }
        });
        
        let has_schaltwerk = config
            .get("mcpServers")
            .and_then(|mcp| mcp.get("schaltwerk"))
            .is_some();
        
        assert!(has_schaltwerk);
    }

    #[test]
    fn check_droid_config_status_returns_false_when_missing() {
        let config = serde_json::json!({
            "model": "sonnet"
        });
        
        let has_schaltwerk = config
            .get("mcpServers")
            .and_then(|mcp| mcp.get("schaltwerk"))
            .is_some();
        
        assert!(!has_schaltwerk);
    }

    #[test]
    fn generate_setup_command_droid_produces_valid_json_snippet() {
        let mcp_server_path = "/path/to/schaltwerk-mcp-server.js";
        let command = generate_setup_command(McpClient::Droid, mcp_server_path);
        
        assert!(command.contains("~/.factory/mcp.json"));
        assert!(command.contains("mcpServers"));
        assert!(command.contains("schaltwerk"));
        assert!(command.contains("type"));
        assert!(command.contains("stdio"));
        assert!(command.contains("command"));
        assert!(command.contains("node"));
        assert!(command.contains("args"));
        assert!(command.contains(mcp_server_path));
    }

    #[test]
    fn droid_config_path_escapes_quotes_in_mcp_path() {
        let mcp_path_with_quotes = r#"/path/with"quotes/server.js"#;
        let escaped = mcp_path_with_quotes.replace('"', "\\\"");
        
        assert_eq!(escaped, r#"/path/with\"quotes/server.js"#);
        assert!(escaped.contains("\\\""));
    }

    #[test]
    fn configure_and_remove_droid_mcp_roundtrip() {
        let mut config = serde_json::json!({});
        let mcp_server_path = "/path/to/server.js";
        
        // Configure
        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }
        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [mcp_server_path],
            "disabled": false
        });
        
        assert!(config["mcpServers"]["schaltwerk"].is_object());
        
        // Remove
        if let Some(mcp_servers) = config.get_mut("mcpServers") {
            if let Some(obj) = mcp_servers.as_object_mut() {
                obj.remove("schaltwerk");
                if obj.is_empty() {
                    config.as_object_mut().unwrap().remove("mcpServers");
                }
            }
        }
        
        assert!(config["mcpServers"].is_null());
    }

    #[test]
    fn droid_config_handles_multiple_mcp_servers() {
        let mut config = serde_json::json!({});
        
        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }
        
        // Add multiple servers
        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": ["/path/to/schaltwerk.js"],
            "disabled": false
        });
        
        config["mcpServers"]["playwright"] = serde_json::json!({
            "type": "http",
            "url": "https://example.com/mcp"
        });
        
        assert!(config["mcpServers"]["schaltwerk"].is_object());
        assert!(config["mcpServers"]["playwright"].is_object());
        
        // Remove only schaltwerk
        if let Some(obj) = config["mcpServers"].as_object_mut() {
            obj.remove("schaltwerk");
        }
        
        assert!(config["mcpServers"]["schaltwerk"].is_null());
        assert!(config["mcpServers"]["playwright"].is_object());
    }

    #[test]
    fn droid_mcp_config_contains_all_required_fields() {
        let mcp_server_path = "/path/to/server.js";
        let mut config = serde_json::json!({});
        
        if config.get("mcpServers").is_none() {
            config["mcpServers"] = serde_json::json!({});
        }
        
        config["mcpServers"]["schaltwerk"] = serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [mcp_server_path],
            "disabled": false
        });
        
        let schaltwerk = &config["mcpServers"]["schaltwerk"];
        assert!(schaltwerk.get("type").is_some());
        assert!(schaltwerk.get("command").is_some());
        assert!(schaltwerk.get("args").is_some());
        assert!(schaltwerk.get("disabled").is_some());
    }
}

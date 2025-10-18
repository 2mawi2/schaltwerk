use super::format_binary_invocation;
use crate::domains::settings::types::McpServerConfig;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct AmpConfig {
    pub binary_path: Option<String>,
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

// Simple function to return binary name for external callers
pub fn resolve_amp_binary() -> String {
    "amp".to_string()
}

pub fn find_amp_session(_path: &Path) -> Option<String> {
    // Amp doesn't support session resumption in the same way as other agents
    // It uses threads which are managed differently
    None
}

pub fn build_amp_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    _initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&AmpConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "amp"
            }
        } else {
            "amp"
        }
    } else {
        "amp"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());

    let mut cmd = format!("cd {cwd_quoted}");

    // Add MCP server setup commands if configured
    if let Some(cfg) = config {
        for (server_name, server_config) in &cfg.mcp_servers {
            cmd.push_str(" && ");
            cmd.push_str(&binary_invocation);
            cmd.push_str(" mcp add ");
            cmd.push_str(server_name);

            match server_config {
                crate::domains::settings::types::McpServerConfig::Local { command, args, env } => {
                    cmd.push_str(" -- ");
                    cmd.push_str(&format_binary_invocation(command));
                    for arg in args {
                        cmd.push(' ');
                        cmd.push_str(&format_binary_invocation(arg));
                    }
                    // Note: env vars for local MCP servers would need to be set in the environment
                    // For now, we'll skip env vars as they're complex to handle in a single command
                    let _ = env; // TODO: handle env vars for local MCP servers
                }
                crate::domains::settings::types::McpServerConfig::Remote { url, headers } => {
                    cmd.push(' ');
                    cmd.push_str(url);
                    for (header_name, header_value) in headers {
                        cmd.push_str(" --header \"");
                        cmd.push_str(header_name);
                        cmd.push('=');
                        cmd.push_str(header_value);
                        cmd.push('"');
                    }
                }
            }
        }
    }

    cmd.push_str(" && ");

    // Amp supports stdin input, so we can pipe the prompt if provided
    if let Some(prompt) = _initial_prompt {
        if !prompt.trim().is_empty() {
            let escaped = super::escape_prompt_for_shell(prompt);
            cmd.push_str("echo \"");
            cmd.push_str(&escaped);
            cmd.push_str("\" | ");
        }
    }

    cmd.push_str(&binary_invocation);

    if skip_permissions {
        cmd.push_str(" --dangerously-allow-all");
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && echo \"implement feature X\" | amp --dangerously-allow-all"
        );
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd \"/path/with spaces\" && amp");
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
            Some(&config),
        );
        // Amp doesn't support session resumption like other agents
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[test]
    fn test_prompt_with_quotes() {
    let config = AmpConfig {
    binary_path: Some("amp".to_string()),
        mcp_servers: HashMap::new(),
        };
    let cmd = build_amp_command_with_config(
    Path::new("/path/to/worktree"),
    None,
    Some(r#"implement "feature" with quotes"#),
    false,
    Some(&config),
    );
    assert!(cmd.contains("implement"));
    assert!(cmd.contains("feature"));
    assert!(cmd.contains("quotes"));
    assert!(cmd.contains("echo"));
    assert!(cmd.contains("| amp"));
    }
}

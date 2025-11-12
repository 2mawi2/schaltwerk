use super::format_binary_invocation;
use std::path::Path;

const DEFAULT_DENIED_TOOLS: &[&str] = &["shell(rm)", "shell(git push)"];

#[derive(Debug, Clone, Default)]
pub struct CopilotConfig {
    pub binary_path: Option<String>,
}

pub fn build_copilot_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    skip_permissions: bool,
    config: Option<&CopilotConfig>,
) -> String {
    let binary = config
        .and_then(|cfg| cfg.binary_path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or("copilot");

    let binary_invocation = format_binary_invocation(binary);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());

    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --allow-all-tools");
        for deny in DEFAULT_DENIED_TOOLS {
            let escaped = format!("\"{deny}\"");
            cmd.push_str(" --deny-tool ");
            cmd.push_str(&escaped);
        }
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_command_with_permissions() {
        let config = CopilotConfig {
            binary_path: Some("copilot".to_string()),
        };
        let cmd = build_copilot_command_with_config(
            Path::new("/tmp/worktree"),
            None,
            true,
            Some(&config),
        );

        assert!(cmd.starts_with("cd /tmp/worktree && copilot"));
        assert!(cmd.contains("--allow-all-tools"));
        assert!(cmd.contains("--deny-tool \"shell(rm)\""));
        assert!(cmd.contains("--deny-tool \"shell(git push)\""));
    }

    #[test]
    fn test_build_command_without_prompt() {
        let cmd = build_copilot_command_with_config(
            Path::new("/tmp/worktree"),
            Some("session-1"),
            false,
            None,
        );

        assert_eq!(cmd, "cd /tmp/worktree && copilot");
    }
}

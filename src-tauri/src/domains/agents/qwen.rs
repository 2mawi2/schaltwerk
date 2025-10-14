use super::format_binary_invocation;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct QwenConfig {
    pub binary_path: Option<String>,
}

// Simple function to return binary name for external callers
pub fn resolve_qwen_binary() -> String {
    "qwen".to_string()
}

pub fn find_qwen_session(path: &Path) -> Option<String> {
    let session_file = path.join(".qwen-session");

    if session_file.exists() {
        fs::read_to_string(&session_file).ok().and_then(|content| {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
    } else {
        None
    }
}

pub fn build_qwen_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    _initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&QwenConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "qwen"
            }
        } else {
            "qwen"
        }
    } else {
        "qwen"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --yolo");
    }

    // Prefer using real CLI interactive prompt flag when available.
    // Fallback: launch TUI and inject prompt via terminal manager.
    if let Some(prompt) = _initial_prompt {
        if !prompt.trim().is_empty() {
            let escaped = super::escape_prompt_for_shell(prompt);
            cmd.push_str(&format!(r#" --prompt-interactive "{escaped}""#));
        }
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let cmd = build_qwen_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && qwen --yolo --prompt-interactive "implement feature X""#
        );
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let cmd = build_qwen_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let cmd = build_qwen_command_with_config(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
            Some(&config),
        );
        // Qwen doesn't support resume, so we just start interactive mode
        assert_eq!(cmd, "cd /path/to/worktree && qwen");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let cmd = build_qwen_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && qwen");
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let cmd = build_qwen_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && qwen --prompt-interactive "implement \"feature\" with quotes""#
        );
    }

    #[test]
    fn test_prompt_with_trailing_backslash_round_trips() {
        use crate::domains::agents::command_parser::parse_agent_command;

        let config = QwenConfig {
            binary_path: Some("qwen".to_string()),
        };
        let prompt = "Inspect path: C:\\\\Users\\\\qwen\\\\Workspace\\\\";
        let cmd = build_qwen_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(prompt),
            false,
            Some(&config),
        );

        let (_, _, args) =
            parse_agent_command(&cmd).expect("qwen prompt ending with backslash should parse");
        assert_eq!(args.last().unwrap(), prompt);
    }
}

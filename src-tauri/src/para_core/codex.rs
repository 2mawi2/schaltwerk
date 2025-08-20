use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: Option<String>,
}


pub fn find_codex_session(_path: &Path) -> Option<String> {
    None
}

pub fn build_codex_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    _initial_prompt: Option<&str>,
    sandbox_mode: &str,
    config: Option<&CodexConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "codex"
            }
        } else {
            "codex"
        }
    } else {
        "codex"
    };
    // Build command with sandbox mode
    format!("cd {} && {} --sandbox {}", worktree_path.display(), binary_name, sandbox_mode)
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write");
    }

    #[test]
    fn test_new_session_no_prompt() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            "read-only",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox read-only");
    }

    #[test]
    fn test_reopening_session_ignores_prompt() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            Some("existing-session"),
            Some("this prompt should be ignored"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write");
    }

    #[test]
    fn test_danger_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("fix bugs"),
            "danger-full-access",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox danger-full-access");
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write");
    }

    #[test]
    fn test_with_binary_path() {
        let config = CodexConfig {
            binary_path: Some("/usr/local/bin/codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("test prompt"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && /usr/local/bin/codex --sandbox workspace-write");
    }
    

    #[test]
    fn test_find_session_always_returns_none() {
        let result = find_codex_session(Path::new("/any/path"));
        assert_eq!(result, None);
    }
}
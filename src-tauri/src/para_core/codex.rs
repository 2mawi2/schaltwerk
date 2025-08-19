use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: Option<String>,
}

#[cfg(test)]
fn resolve_codex_binary_with_config(config: Option<&CodexConfig>) -> String {
    let command = "codex";
    
    // Check config first (useful for tests)
    if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                log::info!("Using codex from config: {trimmed}");
                return trimmed.to_string();
            }
        }
    }
    
    // Continue with normal resolution
    resolve_codex_binary_impl(command)
}

#[cfg(test)]
fn resolve_codex_binary_impl(command: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        let user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
            format!("{}/.codex/bin", home),
        ];
        
        for path in user_paths {
            let candidate = format!("{}/{}", path, command);
            if std::path::Path::new(&candidate).exists() {
                log::info!("Found codex at {}", candidate);
                return candidate;
            }
        }
    }
    
    let common_paths = vec![
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
    ];
    
    for path in common_paths {
        let candidate = format!("{}/{}", path, command);
        if std::path::Path::new(&candidate).exists() {
            log::info!("Found codex at {}", candidate);
            return candidate;
        }
    }
    
    if let Ok(output) = std::process::Command::new("which")
        .arg(command)
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    log::info!("Found codex via which: {path}");
                    return path.to_string();
                }
            }
        }
    }
    
    log::warn!("Could not resolve path for 'codex', using as-is. This may fail in installed apps.");
    command.to_string()
}

pub fn find_codex_session(_path: &Path) -> Option<String> {
    None
}

pub fn build_codex_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
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
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);
    
    cmd.push_str(&format!(" --sandbox {sandbox_mode}"));
    
    // Only pass the prompt if this is a new session (no session_id)
    // If we have a session_id, we're reopening an existing session, so don't re-prompt
    if session_id.is_none() {
        if let Some(prompt) = initial_prompt {
            let escaped = prompt.replace('"', r#"\""#);
            cmd.push_str(&format!(r#" "{escaped}""#));
        }
    }
    
    cmd
}

pub fn build_codex_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    sandbox_mode: &str,
) -> String {
    build_codex_command_with_config(worktree_path, session_id, initial_prompt, sandbox_mode, None)
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
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement feature X""#);
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
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox danger-full-access "fix bugs""#);
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
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement \"feature\" with quotes""#);
    }

    #[test]
    fn test_find_session_always_returns_none() {
        let result = find_codex_session(Path::new("/any/path"));
        assert_eq!(result, None);
    }
}
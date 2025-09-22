use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct GeminiConfig {
    pub binary_path: Option<String>,
}

// Simple function to return binary name for external callers
pub fn resolve_gemini_binary() -> String {
    "gemini".to_string()
}

pub fn find_gemini_session(path: &Path) -> Option<String> {
    let session_file = path.join(".gemini-session");

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

pub fn build_gemini_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    _initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&GeminiConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "gemini"
            }
        } else {
            "gemini"
        }
    } else {
        "gemini"
    };
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);

    if skip_permissions {
        cmd.push_str(" --yolo");
    }

    // Prefer using real CLI interactive prompt flag when available.
    // Fallback: launch TUI and inject prompt via terminal manager.
    if let Some(prompt) = _initial_prompt {
        if !prompt.trim().is_empty() {
            let escaped = prompt.replace('"', r#"\""#);
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
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && gemini --yolo --prompt-interactive "implement feature X""#
        );
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
            Some(&config),
        );
        // Gemini doesn't support resume, so we just start interactive mode
        assert_eq!(cmd, "cd /path/to/worktree && gemini");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && gemini");
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && gemini --prompt-interactive "implement \"feature\" with quotes""#
        );
    }
}

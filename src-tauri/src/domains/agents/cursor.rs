use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct CursorConfig {
    pub binary_path: Option<String>,
}

pub fn find_cursor_session(path: &Path) -> Option<String> {
    let session_file = path.join(".cursor-session");

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

pub fn build_cursor_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    force_flag: bool,
    config: Option<&CursorConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "cursor-agent"
            }
        } else {
            "cursor-agent"
        }
    } else {
        "cursor-agent"
    };
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);

    if let Some(id) = session_id {
        cmd.push_str(&format!(r#" --resume "{id}""#));
    } else {
        if force_flag {
            cmd.push_str(" -f");
        }

        if let Some(prompt) = initial_prompt {
            let escaped = prompt.replace('"', r#"\""#);
            cmd.push_str(&format!(r#" "{escaped}""#));
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
        let config = CursorConfig {
            binary_path: Some("cursor-agent".to_string()),
        };
        let cmd = build_cursor_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && cursor-agent -f "implement feature X""#
        );
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = CursorConfig {
            binary_path: Some("cursor-agent".to_string()),
        };
        let cmd = build_cursor_command_with_config(
            Path::new("/path/to/worktree"),
            Some("eed07399-7097-4087-b7dc-bb3a26ca2948"),
            None,
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && cursor-agent --resume "eed07399-7097-4087-b7dc-bb3a26ca2948""#
        );
    }

    #[test]
    fn test_new_session_no_prompt_no_force() {
        let config = CursorConfig {
            binary_path: Some("cursor-agent".to_string()),
        };
        let cmd = build_cursor_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && cursor-agent");
    }

    #[test]
    fn test_resume_with_force() {
        let config = CursorConfig {
            binary_path: Some("cursor-agent".to_string()),
        };
        let cmd = build_cursor_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("ignored prompt"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && cursor-agent --resume "session-123""#
        );
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = CursorConfig {
            binary_path: Some("cursor-agent".to_string()),
        };
        let cmd = build_cursor_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && cursor-agent "implement \"feature\" with quotes""#
        );
    }
}

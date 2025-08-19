use std::path::Path;

pub fn find_codex_session(_path: &Path) -> Option<String> {
    None
}

pub fn build_codex_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    sandbox_mode: &str,
) -> String {
    let mut cmd = format!("cd {} && codex", worktree_path.display());
    
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_codex_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            "workspace-write",
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement feature X""#);
    }

    #[test]
    fn test_new_session_no_prompt() {
        let cmd = build_codex_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            "read-only",
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox read-only");
    }

    #[test]
    fn test_reopening_session_ignores_prompt() {
        let cmd = build_codex_command(
            Path::new("/path/to/worktree"),
            Some("existing-session"),
            Some("this prompt should be ignored"),
            "workspace-write",
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write");
    }

    #[test]
    fn test_danger_mode() {
        let cmd = build_codex_command(
            Path::new("/path/to/worktree"),
            None,
            Some("fix bugs"),
            "danger-full-access",
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox danger-full-access "fix bugs""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_codex_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            "workspace-write",
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement \"feature\" with quotes""#);
    }

    #[test]
    fn test_find_session_always_returns_none() {
        let result = find_codex_session(Path::new("/any/path"));
        assert_eq!(result, None);
    }
}
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct OpenCodeConfig {
    pub binary_path: Option<String>,
}

pub struct OpenCodeSessionInfo {
    pub id: String,
    pub has_history: bool,
}

pub fn find_opencode_session(path: &Path) -> Option<OpenCodeSessionInfo> {
    // Find OpenCode session by looking in the OpenCode data directory
    // OpenCode stores sessions in ~/.local/share/opencode/project/{sanitized_path}/storage/session/info/

    let home = std::env::var("HOME").ok()?;
    let opencode_dir = PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("opencode");
    let projects_dir = opencode_dir.join("project");

    // Sanitize the path similar to how OpenCode does it
    let sanitized = sanitize_path_for_opencode(path);
    let project_dir = projects_dir.join(&sanitized);

    log::debug!("Looking for OpenCode session at: {}", project_dir.display());

    if !project_dir.exists() {
        log::debug!(
            "Project directory does not exist: {}",
            project_dir.display()
        );
        return None;
    }

    // Look for session info files in storage/session/info/
    let session_info_dir = project_dir.join("storage").join("session").join("info");
    log::debug!(
        "Looking for session info at: {}",
        session_info_dir.display()
    );

    if !session_info_dir.exists() {
        log::debug!(
            "Session info directory does not exist: {}",
            session_info_dir.display()
        );
        return None;
    }

    // Find all session files and get the most recent one
    let mut sessions: Vec<_> = fs::read_dir(&session_info_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();

    log::debug!("Found {} session files", sessions.len());

    if sessions.is_empty() {
        log::debug!("No session files found");
        return None;
    }

    // Sort by modification time to get the most recent session
    sessions.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });

    // Get the session ID from the most recent file
    let latest_session = sessions.last()?;
    let session_id = latest_session
        .path()
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())?;

    log::debug!("Found session ID: {session_id}");

    // Check if the session has actual message history
    let message_dir = project_dir
        .join("storage")
        .join("session")
        .join("message")
        .join(&session_id);
    let has_history = if message_dir.exists() {
        // Count the number of message files
        // OpenCode creates 2 initial messages for every new session:
        // 1. An empty user message (no content, just metadata)
        // 2. An assistant response
        // Sessions with only these 2 messages have no real user interaction
        let message_count = fs::read_dir(&message_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "json")
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);

        log::debug!("Session {session_id} has {message_count} messages");

        // Consider it has history only if there are more than 2 messages
        // 2 messages = just the auto-created initial messages, no real history
        // >2 messages = user has actually interacted with the session
        message_count > 2
    } else {
        log::debug!("No message directory found for session {session_id}");
        false
    };

    Some(OpenCodeSessionInfo {
        id: session_id,
        has_history,
    })
}

fn escape_for_shell(s: &str) -> String {
    // Escape special characters that could break shell command parsing
    // We need to handle:
    // 1. Double quotes -> \"
    // 2. Backslashes -> \\
    // 3. Newlines -> \n
    // 4. Dollar signs -> \$
    // 5. Backticks -> \`

    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '"' => result.push_str(r#"\""#),
            '\\' => result.push_str(r"\\"),
            '\n' => result.push_str(r"\n"),
            '\r' => result.push_str(r"\r"),
            '\t' => result.push_str(r"\t"),
            '$' => result.push_str(r"\$"),
            '`' => result.push_str(r"\`"),
            _ => result.push(ch),
        }
    }
    result
}

fn sanitize_path_for_opencode(path: &Path) -> String {
    // Based on analysis of actual OpenCode directory names:
    // Looking at actual directories like:
    // Users-marius-wichtner-Documents-git-tubetalk--schaltwerk-worktrees-keen_brahmagupta
    //
    // The pattern is:
    // 1. Remove leading slash
    // 2. Replace / with - (single dash) normally
    // 3. When a component starts with . (hidden dir), use -- before it (without the dot)
    //    e.g., tubetalk/.schaltwerk becomes tubetalk--schaltwerk
    // 4. Regular dots in filenames become single dash
    //    e.g., marius.wichtner becomes marius-wichtner

    let path_str = path.to_string_lossy();
    let without_leading_slash = path_str.trim_start_matches('/');

    // Process components and build result
    let mut result = String::new();
    let components: Vec<&str> = without_leading_slash.split('/').collect();

    for (i, component) in components.iter().enumerate() {
        if i > 0 {
            // Add separator before this component
            if component.starts_with('.') {
                // Hidden directory gets double dash separator
                result.push_str("--");
            } else {
                // Normal separator
                result.push('-');
            }
        }

        // Add the component itself (with dots replaced, and leading dot removed if hidden)
        if let Some(stripped) = component.strip_prefix('.') {
            // Hidden directory: remove the dot
            result.push_str(&stripped.replace('.', "-"));
        } else {
            // Regular component: replace dots with dash
            result.push_str(&component.replace('.', "-"));
        }
    }

    result
}

pub fn build_opencode_command_with_config(
    worktree_path: &Path,
    session_info: Option<&OpenCodeSessionInfo>,
    initial_prompt: Option<&str>,
    _skip_permissions: bool,
    config: Option<&OpenCodeConfig>,
    attached_images: &[String],
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "opencode"
            }
        } else {
            "opencode"
        }
    } else {
        "opencode"
    };
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);

    // Add attached images if any
    if !attached_images.is_empty() {
        log::debug!("📎 OpenCode command builder: Adding {} attached images", attached_images.len());
        for image_path in attached_images {
            cmd.push_str(&format!(" --image \"{image_path}\""));
        }
    }

    match session_info {
        Some(info) if info.has_history => {
            // Session exists with real conversation history - always resume it
            // Use --session to resume the specific session
            log::debug!("Continuing specific session {} with history", info.id);
            cmd.push_str(&format!(r#" --session "{}""#, info.id));
        }
        Some(info) => {
            // Session exists but has no real history (only auto-created messages)
            // This is essentially a fresh session that OpenCode created but user hasn't used
            log::debug!(
                "Session {} exists but has no real user interaction",
                info.id
            );
            if let Some(prompt) = initial_prompt {
                // Start fresh with the prompt - don't resume the empty session
                // This avoids showing the auto-created assistant greeting
                let escaped = escape_for_shell(prompt);
                cmd.push_str(&format!(r#" --prompt "{escaped}""#));
            } else {
                // No prompt provided - start a new session instead of resuming
                // the empty one. This prevents all empty sessions from showing
                // the same auto-generated greeting when restarted.
                log::debug!(
                    "Starting fresh session instead of resuming empty session {}",
                    info.id
                );
                // OpenCode will start a new session by default
            }
        }
        None => {
            // No session exists - start a new one
            if let Some(prompt) = initial_prompt {
                log::debug!("Starting new session with prompt");
                let escaped = escape_for_shell(prompt);
                cmd.push_str(&format!(r#" --prompt "{escaped}""#));
            } else {
                log::debug!("Starting new session without prompt");
                // OpenCode will start a new session by default
            }
        }
    }

    cmd
}

fn resolve_opencode_binary_with_config(config: Option<&OpenCodeConfig>) -> String {
    let command = "opencode";

    // Check config first (useful for tests)
    if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                log::info!("Using opencode from config: {trimmed}");
                return trimmed.to_string();
            }
        }
    }

    // Continue with normal resolution
    resolve_opencode_binary_impl(command)
}

/// Resolve the OpenCode binary path in a user-agnostic way.
/// Order:
/// 1. User-specific directories (~/.local/bin, ~/.cargo/bin, ~/bin, ~/.opencode/bin/opencode)
/// 2. Common system directories (/usr/local/bin, /opt/homebrew/bin, /usr/bin, /bin)
/// 3. Use `which` command to find it in PATH
/// 4. Fallback to `opencode` (expecting it on PATH)
pub fn resolve_opencode_binary() -> String {
    resolve_opencode_binary_with_config(None)
}

fn resolve_opencode_binary_impl(command: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        let user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
            format!("{}/.opencode/bin", home),
        ];

        for path in user_paths {
            let full_path = PathBuf::from(&path).join(command);
            if full_path.exists() {
                log::info!("Found opencode at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    let common_paths = vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    for path in common_paths {
        let full_path = PathBuf::from(path).join(command);
        if full_path.exists() {
            log::info!("Found opencode at {}", full_path.display());
            return full_path.to_string_lossy().to_string();
        }
    }

    if let Ok(output) = std::process::Command::new("which").arg(command).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    log::info!("Found opencode via which: {path}");
                    return path.to_string();
                }
            }
        }
    }

    log::warn!(
        "Could not resolve path for 'opencode', using as-is. This may fail in installed apps."
    );
    command.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_sanitize_path_for_opencode() {
        // Test that the function produces consistent, reasonable results
        let path = Path::new("/Users/john.doe/my-project");
        let sanitized = sanitize_path_for_opencode(path);
        assert_eq!(sanitized, "Users-john-doe-my-project");

        // Test path with multiple slashes and dots
        let path = Path::new("/Users/john.doe/Documents/git/project.name");
        let sanitized = sanitize_path_for_opencode(path);
        assert!(!sanitized.is_empty());
        assert_eq!(sanitized, "Users-john-doe-Documents-git-project-name");

        // Test path without leading slash
        let path = Path::new("Users/john.doe/my-project");
        let sanitized = sanitize_path_for_opencode(path);
        assert!(!sanitized.is_empty());

        // Test path with dashes (should be preserved)
        let path = Path::new("/Users/john-doe/my-project");
        let sanitized = sanitize_path_for_opencode(path);
        assert!(!sanitized.is_empty());
        assert!(sanitized.contains("john-doe"));

        // Test path with underscores (should be preserved)
        let path = Path::new("/Users/john_doe/my_project");
        let sanitized = sanitize_path_for_opencode(path);
        assert!(!sanitized.is_empty());
        assert!(sanitized.contains("john_doe"));

        // Test the actual tubetalk worktree path pattern
        // The key is that it should produce a path that can be found in the filesystem
        let path = Path::new(
            "/Users/marius.wichtner/Documents/git/tubetalk/.schaltwerk/worktrees/bold_dijkstra",
        );
        let sanitized = sanitize_path_for_opencode(path);
        assert_eq!(
            sanitized,
            "Users-marius-wichtner-Documents-git-tubetalk--schaltwerk-worktrees-bold_dijkstra"
        );
    }

    #[test]
    #[serial_test::serial]
    fn test_find_opencode_session_no_home() {
        // Test when HOME environment variable is not set
        let original_home = std::env::var("HOME").ok();
        std::env::remove_var("HOME");

        let path = Path::new("/some/path");
        let result = find_opencode_session(path);
        assert!(result.is_none());

        // Restore HOME if it was set
        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        }
    }

    #[test]
    fn test_find_opencode_session_integration() {
        // This test checks if the function can find real session files
        // Only run if HOME is set and the test path exists
        if let Ok(home) = std::env::var("HOME") {
            let test_path = Path::new(
                "/Users/marius.wichtner/Documents/git/tubetalk/.schaltwerk/worktrees/bold_dijkstra",
            );

            // Test the actual sanitized path that OpenCode uses
            let expected_sanitized_path = sanitize_path_for_opencode(test_path);
            let expected_project_dir = PathBuf::from(&home)
                .join(".local")
                .join("share")
                .join("opencode")
                .join("project")
                .join(&expected_sanitized_path);

            // Test if we can find the session with the correct path
            if expected_project_dir.exists() {
                // Temporarily override the sanitize function for this test
                // to use the known correct path
                let home_clone = home.clone();
                let find_result = find_opencode_session_with_override(
                    test_path,
                    &home_clone,
                    &expected_sanitized_path,
                );
                // Should find at least one session
                assert!(find_result.is_some());
                // Session ID should start with "ses_"
                if let Some(session_info) = find_result {
                    assert!(session_info.id.starts_with("ses_"));
                }
            }
        }
    }

    // Helper function for testing with overridden path
    fn find_opencode_session_with_override(
        _path: &Path,
        home: &str,
        sanitized_override: &str,
    ) -> Option<OpenCodeSessionInfo> {
        let opencode_dir = PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("opencode");
        let projects_dir = opencode_dir.join("project");
        let project_dir = projects_dir.join(sanitized_override);

        if !project_dir.exists() {
            return None;
        }

        // Look for session info files in storage/session/info/
        let session_info_dir = project_dir.join("storage").join("session").join("info");
        if !session_info_dir.exists() {
            return None;
        }

        // Find all session files and get the most recent one
        let mut sessions: Vec<_> = fs::read_dir(&session_info_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "json")
                    .unwrap_or(false)
            })
            .collect();

        if sessions.is_empty() {
            return None;
        }

        // Sort by modification time to get the most recent session
        sessions.sort_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .ok()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });

        // Get the session ID from the most recent file
        let session_id = sessions
            .last()?
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())?;

        // Check for message history - same logic as main function
        let message_dir = project_dir
            .join("storage")
            .join("session")
            .join("message")
            .join(&session_id);
        let has_history = if message_dir.exists() {
            let message_count = fs::read_dir(&message_dir)
                .ok()
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .filter(|e| {
                            e.path()
                                .extension()
                                .map(|ext| ext == "json")
                                .unwrap_or(false)
                        })
                        .count()
                })
                .unwrap_or(0);
            // Only consider it has history if more than 2 messages (beyond auto-created ones)
            message_count > 2
        } else {
            false
        };

        Some(OpenCodeSessionInfo {
            id: session_id,
            has_history,
        })
    }

    #[test]
    fn test_new_session_with_prompt() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
            &[],
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && opencode --prompt "implement feature X""#
        );
    }

    #[test]
    fn test_continue_with_session_id() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let session_info = OpenCodeSessionInfo {
            id: "ses_743dfa323ffe5EQMH4dv6COsh1".to_string(),
            has_history: true,
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            Some(&session_info),
            None,
            false,
            Some(&config),
            &[],
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && opencode --session "ses_743dfa323ffe5EQMH4dv6COsh1""#
        );
    }

    #[test]
    fn test_new_session_no_prompt() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
            &[],
        );
        assert_eq!(cmd, "cd /path/to/worktree && opencode");
    }

    #[test]
    fn test_session_without_history() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };

        // Test session with no history and no prompt - should start fresh
        let session_info = OpenCodeSessionInfo {
            id: "ses_new_session".to_string(),
            has_history: false,
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            Some(&session_info),
            None,
            false,
            Some(&config),
            &[],
        );
        assert_eq!(cmd, "cd /path/to/worktree && opencode");

        // Test session with no history but with a prompt - should start fresh
        let cmd_with_prompt = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            Some(&session_info),
            Some("implement feature Y"),
            false,
            Some(&config),
            &[],
        );
        assert_eq!(
            cmd_with_prompt,
            r#"cd /path/to/worktree && opencode --prompt "implement feature Y""#
        );
    }

    #[test]
    fn test_continue_session_with_new_prompt() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let session_info = OpenCodeSessionInfo {
            id: "ses_743dfa323ffe5EQMH4dv6COsh1".to_string(),
            has_history: true,
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            Some(&session_info),
            Some("new agent"),
            true,
            Some(&config),
            &[],
        );
        // When session has history, we use --session to continue the specific session
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && opencode --session "ses_743dfa323ffe5EQMH4dv6COsh1""#
        );
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
            &[],
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && opencode --prompt "implement \"feature\" with quotes""#
        );
    }

    #[test]
    fn test_escape_for_shell() {
        // Test escaping of various special characters
        assert_eq!(escape_for_shell("simple text"), "simple text");
        assert_eq!(
            escape_for_shell(r#"text with "quotes""#),
            r#"text with \"quotes\""#
        );
        assert_eq!(
            escape_for_shell("text with\nnewline"),
            r"text with\nnewline"
        );
        assert_eq!(escape_for_shell("text with\ttab"), r"text with\ttab");
        assert_eq!(
            escape_for_shell("text with $variable"),
            r"text with \$variable"
        );
        assert_eq!(
            escape_for_shell("text with `backticks`"),
            r"text with \`backticks\`"
        );
        assert_eq!(
            escape_for_shell(r"text with \ backslash"),
            r"text with \\ backslash"
        );

        // Test complex case with multiple special characters
        let complex = r#"Line 1 with "quotes"
Line 2 with $var and `cmd`
Line 3 with \ backslash"#;
        let escaped = escape_for_shell(complex);
        assert!(!escaped.contains('\n')); // Actual newlines should be escaped
        assert!(escaped.contains(r"\n")); // Should contain escaped newlines
        assert!(escaped.contains(r#"\""#)); // Should contain escaped quotes
        assert!(escaped.contains(r"\$")); // Should contain escaped dollar signs
        assert!(escaped.contains(r"\`")); // Should contain escaped backticks
    }

    #[test]
    fn test_multiline_prompt_with_special_chars() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };

        // Test with a complex multiline prompt that includes quotes, backslashes, and newlines
        let prompt = r#"# Run Mode Feature Specification

## Overview
Run Mode is a terminal interface feature that provides a dedicated "Run" tab.

### Requirements
- **Script Structure**: Run scripts contain:
  - `command`: The shell command to execute (e.g., "npm run dev")
  - `workingDirectory`: Optional relative path"#;

        let cmd = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(prompt),
            false,
            Some(&config),
            &[],
        );

        // The command should properly escape all special characters
        // Newlines should be escaped, quotes should be escaped, etc.
        assert!(cmd.starts_with("cd /path/to/worktree && opencode --prompt "));

        // Print the command for debugging
        println!("Generated command: {}", cmd);

        // Check that the prompt is properly quoted and doesn't break the shell command
        assert!(!cmd.contains('\n')); // Newlines should be escaped

        // The command should have exactly 2 unescaped quotes (around the prompt)
        // Count unescaped quotes - should be exactly 2 (opening and closing)
        let mut unescaped_quotes = 0;
        let mut chars = cmd.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\\' {
                // Skip the next character as it's escaped
                chars.next();
            } else if ch == '"' {
                unescaped_quotes += 1;
            }
        }
        assert_eq!(
            unescaped_quotes, 2,
            "Should have exactly 2 unescaped quotes (opening and closing)"
        );
    }
}

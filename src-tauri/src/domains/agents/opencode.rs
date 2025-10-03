use super::format_binary_invocation;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, Default)]
pub struct OpenCodeConfig {
    pub binary_path: Option<String>,
}

pub struct OpenCodeSessionInfo {
    pub id: String,
    pub has_history: bool,
}

#[derive(Debug, Deserialize)]
struct StoredProjectRecord {
    id: String,
    #[serde(default)]
    worktree: String,
}

#[derive(Debug, Default, Deserialize)]
struct StoredSessionTime {
    #[serde(default)]
    updated: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StoredSessionRecord {
    id: String,
    directory: String,
    #[serde(default)]
    time: StoredSessionTime,
}

pub fn find_opencode_session(path: &Path) -> Option<OpenCodeSessionInfo> {
    // Find OpenCode session by looking in the OpenCode data directory
    // OpenCode stores sessions in ~/.local/share/opencode/project/{sanitized_path}/storage/session/info/

    let home = std::env::var("HOME").ok()?;
    let opencode_dir = PathBuf::from(&home)
        .join(".local")
        .join("share")
        .join("opencode");
    let projects_dir = opencode_dir.join("project");

    // Sanitize the path similar to how OpenCode does it
    let sanitized = sanitize_path_for_opencode(path);
    let project_dir = projects_dir.join(&sanitized);

    log::debug!("Looking for OpenCode session at: {}", project_dir.display());

    if !project_dir.exists() {
        log::info!(
            "OpenCode resume skipped: sanitized project directory missing (sanitized='{sanitized}', path='{path}')",
            path = project_dir.display()
        );
        // Fall back to scanning new hashed storage layout
        return find_session_in_hashed_storage(path, &home);
    }

    // Look for session info files in storage/session/info/
    let session_info_dir = project_dir.join("storage").join("session").join("info");
    log::debug!(
        "Looking for session info at: {}",
        session_info_dir.display()
    );

    if !session_info_dir.exists() {
        log::info!(
            "OpenCode resume skipped: session info directory missing (path='{path}')",
            path = session_info_dir.display()
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
        log::info!(
            "OpenCode resume skipped: no session info json files found at '{path}'",
            path = session_info_dir.display()
        );
        return find_session_in_hashed_storage(path, &home);
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
        let has_history = message_count > 2;
        if !has_history {
            log::info!(
                "OpenCode resume gated: session '{session_id}' only has {message_count} message file(s) (need >2 for history)"
            );
        }
        has_history
    } else {
        log::info!(
            "OpenCode resume skipped: message directory missing for session '{session_id}' (path='{path}')",
            path = message_dir.display()
        );
        false
    };

    if has_history {
        log::info!(
            "OpenCode resume candidate found: session '{session_id}' with persistent history at '{path}'",
            path = message_dir.display()
        );
    }

    Some(OpenCodeSessionInfo {
        id: session_id,
        has_history,
    })
}

fn find_session_in_hashed_storage(path: &Path, home: &str) -> Option<OpenCodeSessionInfo> {
    let repo_root = extract_repo_root(path).unwrap_or_else(|| path.to_path_buf());
    let repo_root_str = repo_root.to_string_lossy().to_string();

    let hashed_storage_dir = PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage");

    let project_records_dir = hashed_storage_dir.join("project");
    if !project_records_dir.exists() {
        log::info!(
            "OpenCode resume skipped: hashed project records directory missing (path='{path}')",
            path = project_records_dir.display()
        );
        return None;
    }

    let mut matched_project_id: Option<String> = None;
    if let Ok(entries) = fs::read_dir(&project_records_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if let Ok(contents) = fs::read_to_string(&path) {
                match serde_json::from_str::<StoredProjectRecord>(&contents) {
                    Ok(record) => {
                        if record.worktree == repo_root_str {
                            let matched_id = record.id;
                            log::info!(
                                "OpenCode resume: matched hashed project id '{matched_id}' for root '{repo_root_str}'"
                            );
                            matched_project_id = Some(matched_id);
                            break;
                        }
                    }
                    Err(_) => {
                        log::debug!(
                            "OpenCode resume: unable to parse project record at '{}'",
                            path.display()
                        );
                    }
                }
            }
        }
    }

    let project_id = match matched_project_id {
        Some(id) => id,
        None => {
            log::info!(
                "OpenCode resume skipped: no hashed project record matched repo root '{repo_root_str}'"
            );
            return None;
        }
    };

    let session_dir = hashed_storage_dir.join("session").join(&project_id);
    if !session_dir.exists() {
        log::info!(
            "OpenCode resume skipped: hashed session directory missing for project '{project_id}'"
        );
        return None;
    }

    let mut sessions: Vec<StoredSessionRecord> = Vec::new();
    if let Ok(entries) = fs::read_dir(&session_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if let Ok(contents) = fs::read_to_string(&path) {
                match serde_json::from_str::<StoredSessionRecord>(&contents) {
                    Ok(record) => sessions.push(record),
                    Err(_) => {
                        log::debug!(
                            "OpenCode resume: unable to parse session record at '{}'",
                            path.display()
                        );
                    }
                }
            }
        }
    }

    let worktree_str = path.to_string_lossy().to_string();
    // Filter for sessions whose directory matches the exact worktree path
    sessions.retain(|record| record.directory == worktree_str);

    if sessions.is_empty() {
        log::info!(
            "OpenCode resume skipped: no hashed session records found for worktree '{worktree}'",
            worktree = path.display()
        );
        return None;
    }

    sessions.sort_by_key(|record| record.time.updated.unwrap_or_default());
    sessions.reverse();

    for record in &sessions {
        let message_dir = hashed_storage_dir.join("message").join(&record.id);
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

        if message_count > 2 {
            log::info!(
                "OpenCode resume candidate found (hashed): session '{session_id}' with {message_count} messages",
                session_id = record.id
            );
            return Some(OpenCodeSessionInfo {
                id: record.id.clone(),
                has_history: true,
            });
        }

        log::info!(
            "OpenCode resume gated (hashed): session '{session_id}' only has {message_count} message file(s)",
            session_id = record.id
        );
    }

    // Fallback to most recent session even without history
    let latest = sessions.first()?;
    Some(OpenCodeSessionInfo {
        id: latest.id.clone(),
        has_history: false,
    })
}

fn extract_repo_root(path: &Path) -> Option<PathBuf> {
    let mut current = path;
    while let Some(parent) = current.parent() {
        if parent
            .file_name()
            .map(|name| name == "worktrees")
            .unwrap_or(false)
        {
            if let Some(grand) = parent.parent() {
                if grand
                    .file_name()
                    .map(|name| name == ".schaltwerk")
                    .unwrap_or(false)
                {
                    return grand.parent().map(|p| p.to_path_buf());
                }
            }
        }
        current = parent;
    }
    None
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
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

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
    fn test_command_with_spaces_in_cwd() {
        let config = OpenCodeConfig {
            binary_path: Some("opencode".to_string()),
        };
        let cmd = build_opencode_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
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
    #[serial_test::serial]
    fn test_find_opencode_session_hashed_storage_with_history() {
        let temp_home = tempfile::tempdir().unwrap();
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp_home.path());

        let repo_root = temp_home.path().join("repo");
        let worktree_path = repo_root
            .join(".schaltwerk")
            .join("worktrees")
            .join("session_alpha");
        fs::create_dir_all(&worktree_path).unwrap();

        let storage_base = temp_home
            .path()
            .join(".local")
            .join("share")
            .join("opencode")
            .join("storage");
        fs::create_dir_all(storage_base.join("project")).unwrap();
        fs::create_dir_all(storage_base.join("session")).unwrap();
        fs::create_dir_all(storage_base.join("message")).unwrap();

        let project_id = "proj_hash";
        let project_record = serde_json::json!({
            "id": project_id,
            "worktree": repo_root.display().to_string()
        });
        fs::write(
            storage_base
                .join("project")
                .join(format!("{project_id}.json")),
            project_record.to_string(),
        )
        .unwrap();

        let session_dir = storage_base.join("session").join(project_id);
        fs::create_dir_all(&session_dir).unwrap();
        let session_id = "ses_history";
        let session_record = serde_json::json!({
            "id": session_id,
            "directory": worktree_path.display().to_string(),
            "time": { "updated": 123 },
        });
        fs::write(
            session_dir.join(format!("{session_id}.json")),
            session_record.to_string(),
        )
        .unwrap();

        let message_dir = storage_base.join("message").join(session_id);
        fs::create_dir_all(&message_dir).unwrap();
        for idx in 0..3 {
            fs::write(message_dir.join(format!("msg_{idx}.json")), "{}").unwrap();
        }

        let result = find_opencode_session(&worktree_path).expect("expected session info");
        assert_eq!(result.id, session_id);
        assert!(result.has_history);

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_find_opencode_session_hashed_storage_without_history() {
        let temp_home = tempfile::tempdir().unwrap();
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp_home.path());

        let repo_root = temp_home.path().join("repo_two");
        let worktree_path = repo_root
            .join(".schaltwerk")
            .join("worktrees")
            .join("session_beta");
        fs::create_dir_all(&worktree_path).unwrap();

        let storage_base = temp_home
            .path()
            .join(".local")
            .join("share")
            .join("opencode")
            .join("storage");
        fs::create_dir_all(storage_base.join("project")).unwrap();
        fs::create_dir_all(storage_base.join("session")).unwrap();
        fs::create_dir_all(storage_base.join("message")).unwrap();

        let project_id = "proj_hash_beta";
        let project_record = serde_json::json!({
            "id": project_id,
            "worktree": repo_root.display().to_string()
        });
        fs::write(
            storage_base
                .join("project")
                .join(format!("{project_id}.json")),
            project_record.to_string(),
        )
        .unwrap();

        let session_dir = storage_base.join("session").join(project_id);
        fs::create_dir_all(&session_dir).unwrap();
        let session_id = "ses_no_history";
        let session_record = serde_json::json!({
            "id": session_id,
            "directory": worktree_path.display().to_string(),
            "time": { "updated": 456 },
        });
        fs::write(
            session_dir.join(format!("{session_id}.json")),
            session_record.to_string(),
        )
        .unwrap();

        let message_dir = storage_base.join("message").join(session_id);
        fs::create_dir_all(&message_dir).unwrap();
        for idx in 0..2 {
            fs::write(message_dir.join(format!("msg_{idx}.json")), "{}").unwrap();
        }

        let result = find_opencode_session(&worktree_path).expect("expected session info");
        assert_eq!(result.id, session_id);
        assert!(!result.has_history);

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
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
        );
        assert_eq!(cmd, "cd /path/to/worktree && opencode");

        // Test session with no history but with a prompt - should start fresh
        let cmd_with_prompt = build_opencode_command_with_config(
            Path::new("/path/to/worktree"),
            Some(&session_info),
            Some("implement feature Y"),
            false,
            Some(&config),
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

use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::io::{BufRead, BufReader};

const CLAUDE_SESSION_SCAN_LIMIT: usize = 64;

#[derive(Debug, Clone, Default)]
pub struct ClaudeConfig {
    pub binary_path: Option<String>,
}

/// Fast-path session detection: scans for Claude JSONL transcripts in the project directory
/// Returns the most recently modified session ID so callers can resume deterministically
/// Falls back to `None` when no usable conversation files are present
pub fn find_resumable_claude_session_fast(path: &Path) -> Option<String> {
    // Prefer explicit HOME (tests set this), then dirs::home_dir()
    let home = std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(dirs::home_dir)?;
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");

    let sanitized = sanitize_path_for_claude(path);
    let project_dir = projects_dir.join(&sanitized);

    // Also compute alternative based on canonical path (handles symlink differences)
    let alt_sanitized = path
        .canonicalize()
        .ok()
        .map(|c| sanitize_path_for_claude(&c));
    let alt_project_dir = alt_sanitized.as_ref().map(|s| projects_dir.join(s));

    log::info!(
        "Claude session detection (fast-path): Looking for sessions in primary dir: {}",
        project_dir.display()
    );

    // Try primary dir first, then alternate if different
    let mut visited = HashSet::new();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if visited.insert(project_dir.clone()) {
        candidates.push(project_dir.clone());
    }
    if let Some(a) = alt_project_dir {
        if visited.insert(a.clone()) {
            log::info!(
                "Claude session detection (fast-path): Adding canonical candidate dir: {}",
                a.display()
            );
            candidates.push(a);
        }
    }

    let mut newest: Option<(SystemTime, String, PathBuf)> = None;

    for candidate in candidates {
        match fs::read_dir(&candidate) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if !entry_path
                        .extension()
                        .map(|ext| ext == "jsonl")
                        .unwrap_or(false)
                    {
                        continue;
                    }

                    let metadata = match entry.metadata() {
                        Ok(meta) => meta,
                        Err(err) => {
                            log::debug!(
                                "Claude session detection (fast-path): Failed to read metadata for {}: {err}",
                                entry_path.display()
                            );
                            continue;
                        }
                    };

                    if metadata.len() == 0 {
                        log::debug!(
                            "Claude session detection (fast-path): Skipping zero-length session file {}",
                            entry_path.display()
                        );
                        continue;
                    }

                    let modified = metadata
                        .modified()
                        .or_else(|_| metadata.created())
                        .unwrap_or(SystemTime::UNIX_EPOCH);

                    let session_id = match entry_path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .map(|s| s.to_string())
                    {
                        Some(id) if !id.is_empty() => id,
                        _ => {
                            log::debug!(
                                "Claude session detection (fast-path): Could not derive session id from file {}",
                                entry_path.display()
                            );
                            continue;
                        }
                    };

                    if !session_file_contains_session_metadata(&entry_path, &session_id) {
                        log::debug!(
                            "Claude session detection (fast-path): Skipping session file without session metadata {}",
                            entry_path.display()
                        );
                        continue;
                    }

                    // Prefer the most recently modified file, fall back to lexicographic order for stability
                    let is_newer = match &newest {
                        Some((existing_time, existing_id, _)) => {
                            modified > *existing_time
                                || (modified == *existing_time
                                    && session_id.as_str() > existing_id.as_str())
                        }
                        None => true,
                    };

                    if is_newer {
                        log::debug!(
                            "Claude session detection (fast-path): Candidate session '{}' from {} (mtime={:?})",
                            session_id,
                            entry_path.display(),
                            modified
                        );
                        newest = Some((modified, session_id, entry_path.clone()));
                    }
                }
            }
            Err(err) => {
                log::debug!(
                    "Claude session detection (fast-path): Failed to read candidate dir {}: {err}",
                    candidate.display()
                );
            }
        }
    }

    if let Some((modified, session_id, origin_path)) = newest {
        log::info!(
            "Claude session detection (fast-path): Selected session '{}' from {} (mtime={:?})",
            session_id,
            origin_path.display(),
            modified
        );
        Some(session_id)
    } else {
        log::info!(
            "Claude session detection (fast-path): No session files found for path: {}",
            path.display()
        );
        None
    }
}

fn sanitize_path_for_claude(path: &Path) -> String {
    path.to_string_lossy().replace(['/', '.', '_'], "-")
}

fn session_file_contains_session_metadata(path: &Path, expected_session_id: &str) -> bool {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(err) => {
            log::debug!(
                "Claude session detection: Failed to open session file {}: {err}",
                path.display()
            );
            return false;
        }
    };

    let reader = BufReader::new(file);
    for (index, line_result) in reader.lines().enumerate() {
        if index >= CLAUDE_SESSION_SCAN_LIMIT {
            break;
        }

        let line = match line_result {
            Ok(line) => line,
            Err(err) => {
                log::debug!(
                    "Claude session detection: Failed to read line {index} from {}: {err}",
                    path.display()
                );
                break;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => {
                if matches!(value.get("sessionId").and_then(|v| v.as_str()), Some(id) if id == expected_session_id) {
                    return true;
                }
            }
            Err(err) => {
                log::debug!(
                    "Claude session detection: Failed to parse JSON from {}: {err}",
                    path.display()
                );
            }
        }
    }

    false
}

pub fn build_claude_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&ClaudeConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "claude"
            }
        } else {
            "claude"
        }
    } else {
        "claude"
    };
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);

    if skip_permissions {
        cmd.push_str(" --dangerously-skip-permissions");
    }

    // Use specific session resumption, continue most recent, or start fresh
    if let Some(session) = session_id {
        if session == "__continue__" {
            // Special value to indicate using --continue flag for most recent conversation
            log::info!(
                "Claude command builder: Using --continue flag to resume most recent session"
            );
            cmd.push_str(" --continue");
        } else {
            // Resume specific session with conversation history
            log::info!(
                "Claude command builder: Resuming specific session '{session}' using -r flag"
            );
            cmd.push_str(&format!(" -r {session}"));
        }
    } else if let Some(prompt) = initial_prompt {
        // Start fresh with initial prompt
        log::info!(
            "Claude command builder: Starting fresh session with initial prompt: '{prompt}'"
        );
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    } else {
        // Start fresh without prompt
        log::info!(
            "Claude command builder: Starting fresh session without prompt or session resumption"
        );
        // Claude will start a new session by default with no additional flags
    }

    log::info!("Claude command builder: Final command: '{cmd}'");
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};
    use std::fs::{self, File};
    use std::io::Write as _;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && claude --dangerously-skip-permissions "implement feature X""#
        );
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session123"),
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude -r session123"#);
    }

    #[test]
    fn test_sanitize_path_for_claude() {
        let path = Path::new("/Users/john.doe/my-project");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(sanitized, "-Users-john-doe-my-project");
    }

    #[test]
    fn test_sanitize_path_for_claude_schaltwerk_worktree_schaltwerk() {
        // Realistic path from our setup
        let path = Path::new(
            "/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla",
        );
        let sanitized = sanitize_path_for_claude(path);
        // Expectations based on observed ~/.claude/projects entries:
        // - leading dash for absolute path
        // - components separated by single '-'
        // - hidden ".schaltwerk" becomes "--schaltwerk" due to '/' -> '-' and '.' -> '-'
        assert_eq!(
            sanitized,
            "-Users-marius-wichtner-Documents-git-schaltwerk--schaltwerk-worktrees-eager-tesla"
        );
    }

    #[test]
    #[serial_test::serial]
    fn test_find_resumable_claude_session_fast_with_temp_home() {
        // Prepare a temporary HOME with a Claude projects directory
        let tempdir = tempfile::tempdir().expect("tempdir");
        let home_path = tempdir.path();
        // Save and override HOME
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_path);

        let worktree = Path::new(
            "/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla",
        );
        let sanitized = sanitize_path_for_claude(worktree);

        let projects_root = home_path.join(".claude").join("projects");
        let projects = projects_root.join(&sanitized);
        fs::create_dir_all(&projects).expect("create projects dir");

        // Create a couple of jsonl files; newest (by mtime) should be chosen
        let older = projects.join("ses_old.jsonl");
        let newer = projects.join("ses_new.jsonl");

        // Create session files for testing
        let mut f_old = File::create(&older).unwrap();
        f_old
            .write_all(
                b"{\"sessionId\":\"ses_old\",\"cwd\":\"/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla\"}",
            )
            .unwrap();
        let mut f_new = File::create(&newer).unwrap();
        f_new
            .write_all(
                b"{\"sessionId\":\"ses_new\",\"cwd\":\"/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla\"}",
            )
            .unwrap();

        // Ensure deterministic modification ordering (newer file has later mtime)
        let older_time = FileTime::from_unix_time(100, 0);
        let newer_time = FileTime::from_unix_time(200, 0);
        set_file_mtime(&older, older_time).unwrap();
        set_file_mtime(&newer, newer_time).unwrap();

        // Sanity: directory exists and visible to reader
        assert!(projects.exists(), "projects dir should exist");
        let jsonl_count = fs::read_dir(&projects)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "jsonl")
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(
            jsonl_count, 2,
            "should see 2 jsonl files in the project dir"
        );

        // Test the fast-path function - it should return the newest session id
        let found = find_resumable_claude_session_fast(worktree);
        assert_eq!(found.as_deref(), Some("ses_new"));

        // Restore HOME
        if let Some(h) = prev_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_find_resumable_claude_session_ignores_summary_only_files() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let home_path = tempdir.path();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_path);

        let worktree = Path::new(
            "/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/focused_mccarthy",
        );
        let sanitized = sanitize_path_for_claude(worktree);

        let projects_root = home_path.join(".claude").join("projects");
        let projects = projects_root.join(&sanitized);
        fs::create_dir_all(&projects).expect("create projects dir");

        let summary_file = projects.join("summary-only.jsonl");
        let mut summary = File::create(&summary_file).unwrap();
        summary
            .write_all(b"{\"type\":\"summary\",\"summary\":\"Latest summary\"}")
            .unwrap();

        let valid_file = projects.join("valid-session.jsonl");
        let mut valid = File::create(&valid_file).unwrap();
        valid
            .write_all(
                b"{\"sessionId\":\"valid-session\",\"cwd\":\"/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/focused_mccarthy\"}",
            )
            .unwrap();

        // Make the summary file appear newer than the valid conversation
        let older_time = FileTime::from_unix_time(100, 0);
        let newer_time = FileTime::from_unix_time(200, 0);
        set_file_mtime(&valid_file, older_time).unwrap();
        set_file_mtime(&summary_file, newer_time).unwrap();

        let found = find_resumable_claude_session_fast(worktree);
        assert_eq!(found.as_deref(), Some("valid-session"));

        if let Some(h) = prev_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_find_resumable_claude_session_returns_none_for_summary_only_dir() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let home_path = tempdir.path();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_path);

        let worktree = Path::new(
            "/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/fleet_torvalds",
        );
        let sanitized = sanitize_path_for_claude(worktree);

        let projects_root = home_path.join(".claude").join("projects");
        let projects = projects_root.join(&sanitized);
        fs::create_dir_all(&projects).expect("create projects dir");

        let summary_file = projects.join("summary-only.jsonl");
        let mut summary = File::create(&summary_file).unwrap();
        summary
            .write_all(b"{\"type\":\"summary\",\"summary\":\"Latest summary\"}")
            .unwrap();

        set_file_mtime(&summary_file, FileTime::from_unix_time(300, 0)).unwrap();

        let found = find_resumable_claude_session_fast(worktree);
        assert_eq!(found, None);

        if let Some(h) = prev_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && claude");
    }

    #[test]
    fn test_resume_with_permissions() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session123"),
            None,
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && claude --dangerously-skip-permissions -r session123"#
        );
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && claude "implement \"feature\" with quotes""#
        );
    }

    #[test]
    fn test_sanitize_schaltwerk_main_repo_path() {
        // Matches observed ~/.claude/projects folder: -Users-marius-wichtner-Documents-git-schaltwerk
        let path = Path::new("/Users/marius.wichtner/Documents/git/schaltwerk");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(sanitized, "-Users-marius-wichtner-Documents-git-schaltwerk");
    }

    #[test]
    fn test_sanitize_schaltwerk_worktree_path() {
        // Matches observed ~/.claude/projects folder for this worktree:
        // -Users-marius-wichtner-Documents-git-schaltwerk--schaltwerk-worktrees-auto-submit-functionality
        let path = Path::new("/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/auto-submit-functionality");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(
            sanitized,
            "-Users-marius-wichtner-Documents-git-schaltwerk--schaltwerk-worktrees-auto-submit-functionality"
        );
    }

    #[test]
    fn test_build_claude_command_with_continue_special_session_id() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__continue__"),
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && claude --continue");
    }

    #[test]
    fn test_build_claude_command_with_continue_and_permissions() {
        let config = ClaudeConfig {
            binary_path: Some("claude".to_string()),
        };
        let cmd = build_claude_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__continue__"),
            None,
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && claude --dangerously-skip-permissions --continue"
        );
    }
}

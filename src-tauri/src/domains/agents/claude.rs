use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Default)]
pub struct ClaudeConfig {
    pub binary_path: Option<String>,
}





/// Fast-path session detection: Only checks if ANY session files exist in the project directory
/// Returns a special marker "__continue__" if sessions exist, which tells Claude to use --continue flag
/// This avoids expensive file reading and parsing operations
pub fn find_resumable_claude_session_fast(path: &Path) -> Option<String> {
    // Prefer explicit HOME (tests set this), then dirs::home_dir()
    let home = std::env::var("HOME").ok().map(PathBuf::from)
        .or_else(dirs::home_dir)?;
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");

    let sanitized = sanitize_path_for_claude(path);
    let project_dir = projects_dir.join(&sanitized);

    // Also compute alternative based on canonical path (handles symlink differences)
    let alt_sanitized = path.canonicalize()
        .ok()
        .map(|c| sanitize_path_for_claude(&c));
    let alt_project_dir = alt_sanitized.as_ref().map(|s| projects_dir.join(s));

    log::info!("Claude session detection (fast-path): Looking for any sessions in project dir: {}", 
              project_dir.display());
    
    // Try primary dir first, then alternate if different
    let mut candidates: Vec<PathBuf> = vec![project_dir.clone()];
    if let Some(a) = alt_project_dir {
        if a != project_dir {
            candidates.push(a);
        }
    }

    // Fast check: Just see if ANY .jsonl files exist
    for candidate in candidates.iter() {
        match fs::read_dir(candidate) {
            Ok(entries) => {
                // Return special marker as soon as we find ANY session file
                for entry in entries.flatten() {
                    if entry.path().extension().map(|ext| ext == "jsonl").unwrap_or(false) {
                        log::info!("Claude session detection (fast-path): Found session files in {}, returning __continue__ marker", 
                                 candidate.display());
                        return Some("__continue__".to_string());
                    }
                }
            }
            Err(_) => continue,
        }
    }

    log::info!("Claude session detection (fast-path): No session files found for path: {}", path.display());
    None
}


fn sanitize_path_for_claude(path: &Path) -> String {
    path.to_string_lossy()
        .replace(['/', '.', '_'], "-")
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
            log::info!("Claude command builder: Using --continue flag to resume most recent session");
            cmd.push_str(" --continue");
        } else {
            // Resume specific session with conversation history
            log::info!("Claude command builder: Resuming specific session '{session}' using -r flag");
            cmd.push_str(&format!(" -r {session}"));
        }
    } else if let Some(prompt) = initial_prompt {
        // Start fresh with initial prompt
        log::info!("Claude command builder: Starting fresh session with initial prompt: '{prompt}'");
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    } else {
        // Start fresh without prompt
        log::info!("Claude command builder: Starting fresh session without prompt or session resumption");
        // Claude will start a new session by default with no additional flags
    }

    log::info!("Claude command builder: Final command: '{cmd}'");
    cmd
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::io::Write as _;
    use std::fs::{self, File};

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
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions "implement feature X""#);
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
        let path = Path::new("/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla");
        let sanitized = sanitize_path_for_claude(path);
        // Expectations based on observed ~/.claude/projects entries:
        // - leading dash for absolute path
        // - components separated by single '-'
        // - hidden ".schaltwerk" becomes "--schaltwerk" due to '/' -> '-' and '.' -> '-'
        assert_eq!(sanitized, "-Users-marius-wichtner-Documents-git-schaltwerk--schaltwerk-worktrees-eager-tesla");
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

        let worktree = Path::new("/Users/marius.wichtner/Documents/git/schaltwerk/.schaltwerk/worktrees/eager_tesla");
        let sanitized = sanitize_path_for_claude(worktree);

        let projects_root = home_path.join(".claude").join("projects");
        let projects = projects_root.join(&sanitized);
        fs::create_dir_all(&projects).expect("create projects dir");

        // Create a couple of jsonl files; newest (by mtime) should be chosen
        let older = projects.join("ses_old.jsonl");
        let newer = projects.join("ses_new.jsonl");

        // Create session files for testing
        let mut f_old = File::create(&older).unwrap();
        f_old.write_all(b"test content").unwrap();
        let mut f_new = File::create(&newer).unwrap();
        f_new.write_all(b"test content").unwrap();

        // Sanity: directory exists and visible to reader
        assert!(projects.exists(), "projects dir should exist");
        let jsonl_count = fs::read_dir(&projects)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
            .count();
        assert_eq!(jsonl_count, 2, "should see 2 jsonl files in the project dir");

        // Test the fast-path function - it should return "__continue__" when sessions exist
        let found = find_resumable_claude_session_fast(worktree);
        assert_eq!(found, Some("__continue__".to_string()), "should find sessions and return __continue__ marker");

        // Restore HOME
        if let Some(h) = prev_home { std::env::set_var("HOME", h); } else { std::env::remove_var("HOME"); }
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
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions -r session123"#);
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
        assert_eq!(cmd, r#"cd /path/to/worktree && claude "implement \"feature\" with quotes""#);
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
        assert_eq!(cmd, "cd /path/to/worktree && claude --dangerously-skip-permissions --continue");
    }
}

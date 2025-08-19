use std::path::{Path, PathBuf};
use std::fs;

pub fn find_claude_session(path: &Path) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let claude_dir = PathBuf::from(home).join(".claude");
    let projects_dir = claude_dir.join("projects");
    
    let sanitized = sanitize_path_for_claude(path);
    let project_dir = projects_dir.join(&sanitized);
    
    if !project_dir.exists() {
        return None;
    }
    
    let mut sessions: Vec<_> = fs::read_dir(&project_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
        .collect();
    
    sessions.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    
    sessions.last()?
        .path()
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn sanitize_path_for_claude(path: &Path) -> String {
    path.to_string_lossy()
        .replace(['/', '.'], "-")
}

pub fn build_claude_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
) -> String {
    let mut cmd = format!("cd {} && claude", worktree_path.display());
    
    if skip_permissions {
        cmd.push_str(" --dangerously-skip-permissions");
    }
    
    if let Some(id) = session_id {
        cmd.push_str(&format!(r#" -r "{id}""#));
    } else if let Some(prompt) = initial_prompt {
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    }
    
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::io::Write as _;
    use std::fs::{self, File};
    use std::time::{SystemTime, Duration};

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions "implement feature X""#);
    }

    #[test]
    fn test_resume_with_session_id() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude -r "12345678-1234-1234-1234-123456789012""#);
    }

    #[test]
    fn test_sanitize_path_for_claude() {
        let path = Path::new("/Users/john.doe/my-project");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(sanitized, "-Users-john-doe-my-project");
    }

    #[test]
    fn test_sanitize_path_for_claude_schaltwerk_worktree_para_ui() {
        // Realistic path from our setup
        let path = Path::new("/Users/marius.wichtner/Documents/git/para-ui/.schaltwerk/worktrees/eager_tesla");
        let sanitized = sanitize_path_for_claude(path);
        // Expectations based on observed ~/.claude/projects entries:
        // - leading dash for absolute path
        // - components separated by single '-'
        // - hidden ".schaltwerk" becomes "--schaltwerk" due to '/' -> '-' and '.' -> '-'
        assert_eq!(sanitized, "-Users-marius-wichtner-Documents-git-para-ui--schaltwerk-worktrees-eager_tesla");
    }

    #[test]
    #[serial_test::serial]
    fn test_find_claude_session_with_temp_home_and_project_files() {
        // Prepare a temporary HOME with a Claude projects directory
        let tempdir = tempfile::tempdir().expect("tempdir");
        let home_path = tempdir.path();
        // Save and override HOME
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_path);

        let worktree = Path::new("/Users/marius.wichtner/Documents/git/para-ui/.schaltwerk/worktrees/eager_tesla");
        let sanitized = sanitize_path_for_claude(worktree);

        let projects_root = home_path.join(".claude").join("projects");
        let projects = projects_root.join(&sanitized);
        fs::create_dir_all(&projects).expect("create projects dir");

        // Create a couple of jsonl files; newest (by mtime) should be chosen
        let older = projects.join("ses_old.jsonl");
        let newer = projects.join("ses_new.jsonl");

        // Ensure files exceed the 1000-byte threshold used by find_claude_session()
        let mut f_old = File::create(&older).unwrap();
        f_old.write_all(&vec![b'x'; 1200]).unwrap();
        let mut f_new = File::create(&newer).unwrap();
        f_new.write_all(&vec![b'y'; 1500]).unwrap();

        // Adjust mtimes to ensure ordering (older, then newer)
        #[cfg(unix)]
        {
            // Touch: set older mtime to now - 2s, newer to now - 1s
            let now = SystemTime::now();
            filetime::set_file_mtime(&older, filetime::FileTime::from_system_time(now - Duration::from_secs(2))).unwrap();
            filetime::set_file_mtime(&newer, filetime::FileTime::from_system_time(now - Duration::from_secs(1))).unwrap();
        }

        // Sanity: directory exists and visible to reader
        assert!(projects.exists(), "projects dir should exist");
        let jsonl_count = fs::read_dir(&projects)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
            .count();
        assert_eq!(jsonl_count, 2, "should see 2 jsonl files in the project dir");

        let found = find_claude_session(worktree).expect("session id should be found");
        assert_eq!(found, "ses_new");

        // Restore HOME
        if let Some(h) = prev_home { std::env::set_var("HOME", h); } else { std::env::remove_var("HOME"); }
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && claude");
    }

    #[test]
    fn test_resume_with_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("ignored prompt"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions -r "session-123""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude "implement \"feature\" with quotes""#);
    }
}
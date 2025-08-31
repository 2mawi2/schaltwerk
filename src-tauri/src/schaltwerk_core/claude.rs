use std::path::{Path, PathBuf};
use std::fs;
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;

#[derive(Debug, Clone, Default)]
pub struct ClaudeConfig {
    pub binary_path: Option<String>,
}



#[allow(dead_code)]
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

fn log_path_diagnostics(label: &str, p: &Path) {
    #[cfg(unix)]
    {
        let os = p.as_os_str();
        log::info!("[diag] {}: display='{}', bytes={:?}", label, p.display(), os.as_bytes());
    }
    #[cfg(not(unix))]
    {
        log::info!("[diag] {}: display='{}'", label, p.display());
    }
    
    match fs::symlink_metadata(p) {
        Ok(m) => {
            let ft = m.file_type();
            log::info!("[diag] {}: symlink_meta ok: is_dir={}, is_file={}, is_symlink={}", 
                      label, ft.is_dir(), ft.is_file(), ft.is_symlink());
        }
        Err(e) => {
            log::info!("[diag] {}: symlink_metadata error: kind={:?}, msg={}", 
                      label, e.kind(), e);
        }
    }
    
    match fs::metadata(p) {
        Ok(m) => {
            let ft = m.file_type();
            log::info!("[diag] {}: metadata ok: is_dir={}, is_file={}", 
                      label, ft.is_dir(), ft.is_file());
        }
        Err(e) => {
            log::info!("[diag] {}: metadata error: kind={:?}, msg={}", 
                      label, e.kind(), e);
        }
    }
    
    match p.canonicalize() {
        Ok(cp) => log::info!("[diag] {}: canonicalize -> '{}'", label, cp.display()),
        Err(e) => log::info!("[diag] {}: canonicalize error: kind={:?}, msg={}", 
                            label, e.kind(), e),
    }
}

pub fn find_resumable_claude_session(path: &Path) -> Option<String> {
    // Prefer dirs::home_dir() and fall back to HOME env var
    let home = dirs::home_dir()
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))?;
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");

    let sanitized = sanitize_path_for_claude(path);
    let project_dir = projects_dir.join(&sanitized);

    // Also compute alternative based on canonical path (handles symlink differences)
    let alt_sanitized = path.canonicalize()
        .ok()
        .map(|c| sanitize_path_for_claude(&c));
    let alt_project_dir = alt_sanitized.as_ref().map(|s| projects_dir.join(s));

    log::info!("Claude session detection: Looking for sessions in project dir: {}", 
              project_dir.display());
    log::info!("Claude session detection: Input path: {}", path.display());
    log::info!("Claude session detection: Sanitized to: {sanitized}");
    
    // Log detailed diagnostics
    log_path_diagnostics("HOME", &home);
    log_path_diagnostics("claude_dir", &claude_dir);
    log_path_diagnostics("projects_dir", &projects_dir);
    log_path_diagnostics("project_dir", &project_dir);
    
    if let Some(ref alt) = alt_project_dir {
        if let Some(ref alt_san) = alt_sanitized {
            log::info!("Claude session detection: Alternate sanitized: {alt_san}");
        }
        log::info!("Claude session detection: Alternate project dir (from canonical path): {}", 
                  alt.display());
        log_path_diagnostics("alt_project_dir", alt);
    }

    // Try primary dir first, then alternate if different
    let mut candidates: Vec<PathBuf> = vec![project_dir.clone()];
    if let Some(a) = alt_project_dir.clone() {
        if a != project_dir {
            candidates.push(a);
        }
    }

    // Try each candidate directory
    for candidate in candidates.iter() {
        log::info!("Claude session detection: Trying candidate dir: {}", candidate.display());
        
        match fs::read_dir(candidate) {
            Ok(entries) => {
                let mut session_files: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
                    .collect();
                    
                if session_files.is_empty() {
                    log::info!("Claude session detection: No .jsonl session files found in {}", 
                             candidate.display());
                    continue;
                }
                
                log::info!("Claude session detection: Found {} session files in {}", 
                         session_files.len(), candidate.display());
                
                // Sort by modification time, newest first
                session_files.sort_by_key(|e| {
                    e.metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                });
                session_files.reverse();
                
                // Check each session file for actual conversation content
                for session_file in session_files {
                    let session_filename = session_file.file_name().to_string_lossy().to_string();
                    log::debug!("Claude session detection: Checking session file: {session_filename}");
                    
                    if let Ok(content) = fs::read_to_string(session_file.path()) {
                        let lines: Vec<&str> = content.lines().collect();
                        log::debug!("Claude session detection: File {session_filename} has {} lines", 
                                  lines.len());
                        
                        let has_conversation = if lines.len() > 1 {
                            log::debug!("Claude session detection: File {session_filename} has multiple lines, treating as conversation");
                            true
                        } else if let Some(line) = lines.first() {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                                if let Some(msg_type) = json.get("type").and_then(|t| t.as_str()) {
                                    let is_conversation = matches!(msg_type, "user" | "assistant" | "tool_use" | "tool_result");
                                    log::debug!("Claude session detection: File {session_filename} has message type '{msg_type}', is_conversation: {is_conversation}");
                                    is_conversation
                                } else {
                                    log::debug!("Claude session detection: File {session_filename} has JSON but no 'type' field");
                                    false
                                }
                            } else {
                                log::debug!("Claude session detection: File {session_filename} does not contain valid JSON");
                                false
                            }
                        } else {
                            log::debug!("Claude session detection: File {session_filename} is empty");
                            false
                        };
                        
                        if has_conversation {
                            if let Some(session_id) = session_file
                                .path()
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string())
                            {
                                log::info!("Claude session detection: Found resumable session '{}' in {}", 
                                         session_id, candidate.display());
                                return Some(session_id);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::info!("Claude session detection: read_dir failed for {}: kind={:?}, msg={}", 
                         candidate.display(), e.kind(), e);
            }
        }
    }

    // Fallback: scan projects_dir and look for directory names that match either sanitized form
    log::info!("Claude session detection: Fallback - scanning projects_dir for matching directories");
    
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        let names: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let ft = e.file_type().ok()?;
                if ft.is_dir() {
                    e.file_name().into_string().ok()
                } else {
                    None
                }
            })
            .collect();
            
        log::info!("Claude session detection: Found {} directories in projects_dir", names.len());
        if names.len() <= 20 {
            // Only log if reasonable number
            log::info!("Claude session detection: Directory names: {names:?}");
        }
        
        let wanted = std::iter::once(sanitized.clone())
            .chain(alt_sanitized.clone())
            .collect::<Vec<_>>();
            
        for w in wanted {
            if names.iter().any(|n| n == &w) {
                let dir = projects_dir.join(&w);
                log::info!("Claude session detection: Found matching directory '{}' by parent scan", 
                         dir.display());
                
                // Try reading it now
                if let Ok(entries) = fs::read_dir(&dir) {
                    let mut session_files: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
                        .collect();
                        
                    session_files.sort_by_key(|e| {
                        e.metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    });
                    session_files.reverse();
                    
                    if let Some(sf) = session_files.first() {
                        if let Some(session_id) = sf.path()
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string())
                        {
                            log::info!("Claude session detection: Found resumable session '{session_id}' via fallback scan");
                            return Some(session_id);
                        }
                    }
                }
            }
        }
    } else {
        log::info!("Claude session detection: Cannot read projects_dir '{}'", projects_dir.display());
    }

    log::info!("No resumable Claude session found for path: {}", path.display());
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
    use std::time::{SystemTime, Duration};

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
    fn test_find_claude_session_with_temp_home_and_project_files() {
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
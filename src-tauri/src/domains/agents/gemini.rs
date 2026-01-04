use super::format_binary_invocation;
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const GEMINI_SESSION_SCAN_LIMIT: usize = 64;

#[derive(Debug, Clone, Default)]
pub struct GeminiConfig {
    pub binary_path: Option<String>,
}

// Simple function to return binary name for external callers
pub fn resolve_gemini_binary() -> String {
    "gemini".to_string()
}

/// Fast-path session detection: scans for Gemini session files in the project directory
/// Returns the most recently modified session ID so callers can resume deterministically
/// Falls back to `None` when no usable session files are present
pub fn find_resumable_gemini_session_fast(path: &Path) -> Option<String> {
    let home = gemini_home_directory()?;
    let gemini_dir = home.join(".gemini");
    let tmp_dir = gemini_dir.join("tmp");

    let project_hash = compute_gemini_project_hash(path);
    let chats_dir = tmp_dir.join(&project_hash).join("chats");

    log::info!(
        "Gemini session detection (fast-path): Looking for sessions in: {}",
        chats_dir.display()
    );

    let mut visited = HashSet::new();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if visited.insert(chats_dir.clone()) {
        candidates.push(chats_dir.clone());
    }

    let mut newest: Option<(SystemTime, String, PathBuf)> = None;

    for candidate in candidates {
        match fs::read_dir(&candidate) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if !entry_path
                        .extension()
                        .map(|ext| ext == "json")
                        .unwrap_or(false)
                    {
                        continue;
                    }

                    let metadata = match entry.metadata() {
                        Ok(meta) => meta,
                        Err(err) => {
                            log::debug!(
                                "Gemini session detection (fast-path): Failed to read metadata for {}: {err}",
                                entry_path.display()
                            );
                            continue;
                        }
                    };

                    if metadata.len() == 0 {
                        log::debug!(
                            "Gemini session detection (fast-path): Skipping zero-length session file {}",
                            entry_path.display()
                        );
                        continue;
                    }

                    let modified = metadata
                        .modified()
                        .or_else(|_| metadata.created())
                        .unwrap_or(SystemTime::UNIX_EPOCH);

                    let session_id = match extract_session_id_from_file(&entry_path, GEMINI_SESSION_SCAN_LIMIT) {
                        Some(id) if !id.is_empty() => id,
                        _ => {
                            log::debug!(
                                "Gemini session detection (fast-path): Could not extract session id from file {}",
                                entry_path.display()
                            );
                            continue;
                        }
                    };

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
                            "Gemini session detection (fast-path): Candidate session '{}' from {} (mtime={:?})",
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
                    "Gemini session detection (fast-path): Failed to read candidate dir {}: {err}",
                    candidate.display()
                );
            }
        }
    }

    if let Some((modified, session_id, origin_path)) = newest {
        log::info!(
            "Gemini session detection (fast-path): Selected session '{}' from {} (mtime={:?})",
            session_id,
            origin_path.display(),
            modified
        );
        Some(session_id)
    } else {
        log::info!(
            "Gemini session detection (fast-path): No session files found for path: {}",
            path.display()
        );
        None
    }
}

fn compute_gemini_project_hash(path: &Path) -> String {
    use sha2::{Sha256, Digest};
    let path_str = path.to_string_lossy().to_string();
    let mut hasher = Sha256::new();
    hasher.update(path_str.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn extract_session_id_from_file(path: &Path, limit: usize) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).ok()?;

    // Take only the first `limit` lines to avoid reading huge files
    let limited_contents = contents
        .lines()
        .take(limit)
        .collect::<Vec<_>>()
        .join("\n");

    let json: Value = serde_json::from_str(&limited_contents).ok()?;
    json.get("sessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn gemini_home_directory() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("SCHALTWERK_GEMINI_HOME_OVERRIDE") {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    #[cfg(unix)]
    {
        std::env::var("HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
    }

    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
    }

    #[cfg(not(any(unix, windows)))]
    {
        dirs::home_dir()
    }
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
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&GeminiConfig>,
) -> String {
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
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --yolo");
    }

    // Resume session takes priority over initial prompt
    if let Some(session) = session_id {
        cmd.push_str(&format!(" --resume {session}"));
    } else if let Some(prompt) = initial_prompt
        && !prompt.trim().is_empty()
    {
        let escaped = super::escape_prompt_for_shell(prompt);
        cmd.push_str(&format!(r#" --prompt-interactive "{escaped}""#));
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
    fn test_command_with_spaces_in_cwd() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
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
        assert_eq!(cmd, "cd /path/to/worktree && gemini --resume 12345678-1234-1234-1234-123456789012");
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

    #[test]
    fn test_prompt_with_trailing_backslash_round_trips() {
        use crate::domains::agents::command_parser::parse_agent_command;

        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let prompt = "Inspect path: C:\\Users\\gemini\\Workspace\\";
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(prompt),
            false,
            Some(&config),
        );

        let (_, _, args) =
            parse_agent_command(&cmd).expect("gemini prompt ending with backslash should parse");
        assert_eq!(args.last().unwrap(), prompt);
    }

    #[test]
    fn test_resume_takes_priority_over_prompt() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("implement feature"),
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && gemini --resume session-123");
    }

    #[test]
    fn test_resume_with_yolo_flag() {
        let config = GeminiConfig {
            binary_path: Some("gemini".to_string()),
        };
        let cmd = build_gemini_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session-uuid"),
            None,
            true,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && gemini --yolo --resume session-uuid");
    }

    #[test]
    fn test_compute_gemini_project_hash_consistency() {
        let path = Path::new("/test/path");
        let hash1 = compute_gemini_project_hash(path);
        let hash2 = compute_gemini_project_hash(path);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA256 hex is 64 chars
    }

    #[test]
    fn test_compute_gemini_project_hash_different_paths() {
        let path1 = Path::new("/test/path1");
        let path2 = Path::new("/test/path2");
        let hash1 = compute_gemini_project_hash(path1);
        let hash2 = compute_gemini_project_hash(path2);
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_extract_session_id_from_valid_json() {
        use std::fs;
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("test_session_valid.json");
        let json_content = r#"{"sessionId":"abc123","projectHash":"def456","messages":[]}"#;

        let mut file = fs::File::create(&temp_file).expect("create temp file");
        file.write_all(json_content.as_bytes()).expect("write to temp file");

        let session_id = extract_session_id_from_file(&temp_file, 100);
        assert_eq!(session_id, Some("abc123".to_string()));

        let _ = fs::remove_file(&temp_file);
    }

    #[test]
    fn test_extract_session_id_from_invalid_json() {
        use std::fs;
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("test_session_invalid.json");
        let json_content = "not valid json";

        let mut file = fs::File::create(&temp_file).expect("create temp file");
        file.write_all(json_content.as_bytes()).expect("write to temp file");

        let session_id = extract_session_id_from_file(&temp_file, 100);
        assert_eq!(session_id, None);

        let _ = fs::remove_file(&temp_file);
    }

    #[test]
    fn test_extract_session_id_missing_field() {
        use std::fs;
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("test_session_missing.json");
        let json_content = r#"{"projectHash":"def456","messages":[]}"#;

        let mut file = fs::File::create(&temp_file).expect("create temp file");
        file.write_all(json_content.as_bytes()).expect("write to temp file");

        let session_id = extract_session_id_from_file(&temp_file, 100);
        assert_eq!(session_id, None);

        let _ = fs::remove_file(&temp_file);
    }
}

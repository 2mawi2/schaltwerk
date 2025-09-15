use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: Option<String>,
}

pub fn find_codex_session_fast(path: &Path) -> Option<String> {
    log::debug!("🔍 Codex session detection starting for path: {}", path.display());
    
    // Prefer runtime HOME to support tests that set it mid-process; fall back to OS home.
    let home = std::env::var("HOME").ok().map(PathBuf::from)
        .or_else(dirs::home_dir);
    
    if home.is_none() {
        log::warn!("❌ Codex session detection: Could not determine home directory");
        return None;
    }
    
    let home = home.unwrap();
    let sessions_dir = home.join(".codex").join("sessions");
    let target_path = path.to_string_lossy().to_string();
    
    log::debug!("📁 Codex session detection: Sessions directory: {}", sessions_dir.display());
    log::debug!("🎯 Codex session detection: Target CWD: {target_path:?}");
    
    if !sessions_dir.exists() {
        log::debug!("📂 Codex session detection: Sessions directory does not exist, no sessions to resume");
        return None;
    }
    
    // Determine whether the newest global session belongs to this worktree.
    // If yes, we can safely use --continue. If not, but there is at least one match
    // for this worktree, fall back to the interactive picker via --resume.
    match (find_newest_session_for_cwd(&sessions_dir, &target_path), find_newest_session(&sessions_dir)) {
        (Ok(newest_match), Ok(global_newest)) => {
            match (newest_match.as_ref(), global_newest.as_ref()) {
                (None, _) => {
                    log::debug!("❌ Codex session detection: No sessions found matching CWD: {target_path:?}");
                }
                (Some(nm), Some(gn)) if nm == gn => {
                    log::debug!("✅ Safe to --continue: newest global session matches this worktree");
                    return Some("__continue__".to_string());
                }
                (Some(_nm), _) => {
                    log::debug!("⚠️ Not safe to --continue: global newest belongs to a different context; using picker");
                    return Some("__resume__".to_string());
                }
            }
        }
        (Err(e), _) => {
            log::error!("💥 Codex session detection: Error scanning sessions directory for matches: {e}");
        }
        (_, Err(e)) => {
            log::error!("💥 Codex session detection: Error determining newest global session: {e}");
        }
    }
    
    log::debug!("🚫 Codex session detection: No resumable sessions found for path: {}", path.display());
    None
}

// Efficiently finds the newest matching session for a given CWD by scanning
// date-partitioned subdirectories from newest to oldest and exiting on first match.
fn find_newest_session_for_cwd(sessions_dir: &Path, target_cwd: &str) -> Result<Option<PathBuf>, std::io::Error> {
    if !sessions_dir.exists() { return Ok(None); }

    // Helper to read and sort directory entries by name descending (YYYY/MM/DD)
    fn sort_by_name_desc(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
        let mut items: Vec<PathBuf> = fs::read_dir(dir)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
        items.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        Ok(items)
    }

    // Iterate years → months → days (names are ISO-like so lexical desc works)
    for year in sort_by_name_desc(sessions_dir)? {
        if !year.is_dir() { continue; }
        for month in sort_by_name_desc(&year)? {
            if !month.is_dir() { continue; }
            for day in sort_by_name_desc(&month)? {
                if !day.is_dir() { continue; }
                // Within a day, sort files by modified time desc for accuracy
                let mut files: Vec<PathBuf> = fs::read_dir(&day)?
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .filter(|p| p.extension().is_some_and(|ext| ext == "jsonl"))
                    .collect();
                files.sort_by_key(|p| p.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH));
                files.reverse();

                for file in files {
                    log::trace!("🔍 Fast scan check file: {}", file.display());
                    if session_matches_cwd(&file, target_cwd) {
                        log::debug!("✅ Newest matching session found: {}", file.display());
                        return Ok(Some(file));
                    }
                }
            }
        }
    }
    Ok(None)
}

pub fn find_codex_session(path: &Path) -> Option<String> {
    find_codex_session_fast(path)
}

/// Returns the newest matching Codex session JSONL path for this worktree, if any.
pub fn find_codex_resume_path(path: &Path) -> Option<PathBuf> {
    // Prefer runtime HOME to support tests that set it mid-process; fall back to OS home.
    let home = std::env::var("HOME").ok().map(PathBuf::from)
        .or_else(dirs::home_dir)?;
    let sessions_dir = home.join(".codex").join("sessions");
    if !sessions_dir.exists() { return None; }
    let target_path = path.to_string_lossy().to_string();
    if let Ok(mut entries) = find_sessions_by_cwd(&sessions_dir, &target_path) {
        if !entries.is_empty() {
            return entries.swap_remove(0).into();
        }
    }
    None
}

fn find_sessions_by_cwd(sessions_dir: &Path, target_cwd: &str) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut matching_sessions = Vec::new();
    let mut total_scanned = 0;
    
    fn scan_directory(dir: &Path, target: &str, matches: &mut Vec<PathBuf>, scanned_count: &mut i32) -> Result<(), std::io::Error> {
        log::trace!("📁 Scanning directory: {}", dir.display());
        
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                scan_directory(&path, target, matches, scanned_count)?;
            } else if path.extension().is_some_and(|ext| ext == "jsonl") {
                *scanned_count += 1;
                log::trace!("🔍 Checking session file: {}", path.display());
                
                if session_matches_cwd(&path, target) {
                    log::trace!("✅ Found matching session: {}", path.display());
                    matches.push(path);
                } else {
                    log::trace!("❌ Session does not match CWD: {}", path.display());
                }
            }
        }
        Ok(())
    }
    
    scan_directory(sessions_dir, target_cwd, &mut matching_sessions, &mut total_scanned)?;
    
    log::debug!("📊 Session scan complete: {} JSONL files scanned, {} matches found", total_scanned, matching_sessions.len());
    
    // Sort by modification time (newest first)
    matching_sessions.sort_by_key(|path| {
        path.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    matching_sessions.reverse();
    
    if !matching_sessions.is_empty() {
        log::trace!("📅 Sessions sorted by modification time (newest first):");
        for (i, session) in matching_sessions.iter().enumerate() {
            if let Ok(metadata) = session.metadata() {
                if let Ok(modified) = metadata.modified() {
                    log::trace!("  {}. {} (modified: {:?})", i + 1, session.display(), modified);
                }
            }
        }
    }
    
    Ok(matching_sessions)
}

fn find_newest_session(sessions_dir: &Path) -> Result<Option<PathBuf>, std::io::Error> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    fn scan(dir: &Path, newest: &mut Option<(std::time::SystemTime, PathBuf)>) -> Result<(), std::io::Error> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                scan(&path, newest)?;
            } else if path.extension().is_some_and(|ext| ext == "jsonl") {
                if let Ok(meta) = path.metadata() {
                    if let Ok(modified) = meta.modified() {
                        match newest {
                            Some((ts, _)) if &modified > ts => {
                                *newest = Some((modified, path.clone()));
                            }
                            None => {
                                *newest = Some((modified, path.clone()));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        Ok(())
    }
    if !sessions_dir.exists() { return Ok(None); }
    scan(sessions_dir, &mut newest)?;
    Ok(newest.map(|(_, p)| p))
}

fn session_matches_cwd(session_file: &Path, target_cwd: &str) -> bool {
    log::trace!("🔍 Checking session file for CWD match: {}", session_file.display());
    log::trace!("🎯 Looking for CWD: {target_cwd:?}");
    
    let content = match fs::read_to_string(session_file) {
        Ok(content) => content,
        Err(e) => {
            log::trace!("❌ Failed to read session file: {e}");
            return false;
        }
    };
    
    let lines: Vec<&str> = content.lines().collect();
    log::trace!("📄 Session file has {} lines to check", lines.len());
    
    for (line_num, line) in lines.iter().enumerate() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            log::trace!("📝 Parsing JSON on line {}: {:?}", line_num + 1, json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"));
            
            // Check session_meta.cwd field (top-level)
            if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                log::trace!("🔍 Found top-level CWD: {cwd:?}");
                if cwd == target_cwd {
                    log::trace!("✅ CWD match found in top-level field: {}", session_file.display());
                    return true;
                }
            }
            
            // Check session_meta payload
            if let Some(payload) = json.get("payload") {
                if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                    log::trace!("🔍 Found payload CWD: {cwd:?}");
                    if cwd == target_cwd {
                        log::trace!("✅ CWD match found in payload field: {}", session_file.display());
                        return true;
                    }
                }
                
                // Check environment_context in message content
                if let Some(content_array) = payload.get("content").and_then(|v| v.as_array()) {
                    log::trace!("📋 Checking {} content items for environment_context", content_array.len());
                    for (item_idx, content_item) in content_array.iter().enumerate() {
                        if let Some(text) = content_item.get("text").and_then(|v| v.as_str()) {
                            if text.contains("<environment_context>") {
                                log::trace!("🌍 Found environment_context in content item {item_idx}");
                                let cwd_pattern = format!("<cwd>{target_cwd}</cwd>");
                                if text.contains(&cwd_pattern) {
                                    log::trace!("✅ CWD match found in environment_context: {}", session_file.display());
                                    return true;
                                } else {
                                    log::trace!("❌ environment_context does not contain target CWD pattern");
                                }
                            }
                        }
                    }
                }
            }
        } else {
            log::trace!("⚠️ Line {} is not valid JSON, skipping", line_num + 1);
        }
    }
    
    log::trace!("❌ No CWD match found in session file");
    false
}


pub fn build_codex_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    sandbox_mode: &str,
    config: Option<&CodexConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "codex"
            }
        } else {
            "codex"
        }
    } else {
        "codex"
    };
    
    // Build command with proper argument order: codex [OPTIONS] [PROMPT]
    let mut cmd = format!("cd {} && {}", worktree_path.display(), binary_name);
    
    // Add sandbox mode first (this is an option)
    cmd.push_str(&format!(" --sandbox {sandbox_mode}"));
    
    // Handle session resumption
    log::debug!("🛠️ Codex command builder: Configuring session for worktree: {}", worktree_path.display());
    log::debug!("🛠️ Codex command builder: Binary: {binary_name:?}, Sandbox: {sandbox_mode:?}");
    
    if let Some(session) = session_id {
        // Special case: explicit resume path provided via sentinel "file://"
        if let Some(rest) = session.strip_prefix("file://") {
            let path_literal = rest.replace('"', r#"\""#);
            log::debug!("📄 Codex command builder: Resuming from explicit path via config override: {path_literal:?}");
            cmd.push_str(&format!(r#" -c experimental_resume="{path_literal}""#));
        } else if session == "__continue__" {
            // Special value to indicate using --continue flag for most recent conversation
            log::debug!("🔄 Codex command builder: Using --continue flag to resume most recent session");
            log::debug!("🔄 This will resume the newest session found for this project directory");
            cmd.push_str(" --continue");
        } else if session == "__resume__" {
            // Special value to open interactive resume picker
            log::debug!("🧭 Codex command builder: Opening interactive resume picker (--resume)");
            cmd.push_str(" --resume");
        }
    } else if let Some(prompt) = initial_prompt {
        // Start fresh with initial prompt
        log::debug!("✨ Codex command builder: Starting fresh session with initial prompt");
        log::debug!("✨ Prompt: {prompt:?}");
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    } else {
        // Start fresh without prompt
        log::debug!("🆕 Codex command builder: Starting fresh session without prompt or session resumption");
        log::debug!("🆕 Codex will start a new session by default with no additional flags");
    }
    
    log::debug!("🚀 Codex command builder: Final command: {cmd:?}");
    
    cmd
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::fs;
    use std::io::Write;
    use tempfile::{tempdir, NamedTempFile};

    #[test]
    fn test_new_session_with_prompt() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement feature X""#);
    }

    #[test]
    fn test_new_session_no_prompt() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            "read-only",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox read-only");
    }

    #[test]
    fn test_resume_picker_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__resume__"),
            Some("this prompt should be ignored"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write --resume");
    }
    
    #[test]
    fn test_continue_most_recent_session() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__continue__"),
            Some("this prompt should be ignored"),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox workspace-write --continue");
    }

    #[test]
    fn test_resume_by_explicit_path_with_override() {
        let config = CodexConfig { binary_path: Some("codex".to_string()) };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some("file:///Users/dev/.codex/sessions/2025/09/13/rollout-2025-09-13T10-22-40-uuid.jsonl"),
            None,
            "workspace-write",
            Some(&config),
        );
        assert!(cmd.contains("cd /repo/worktree-a && codex --sandbox workspace-write -c experimental_resume=\"/Users/dev/.codex/sessions/2025/09/13/rollout-2025-09-13T10-22-40-uuid.jsonl\""));
        assert!(!cmd.contains(" --resume "));
        assert!(!cmd.contains(" --continue"));
    }

    #[test]
    fn test_resume_by_explicit_path_with_danger_mode() {
        let config = CodexConfig { binary_path: Some("codex".to_string()) };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some("file:///Users/dev/.codex/sessions/2025/09/13/rollout-2025-09-13T10-22-40-uuid.jsonl"),
            None,
            "danger-full-access",
            Some(&config),
        );
        assert!(cmd.contains("cd /repo/worktree-a && codex --sandbox danger-full-access -c experimental_resume=\"/Users/dev/.codex/sessions/2025/09/13/rollout-2025-09-13T10-22-40-uuid.jsonl\""));
    }

    #[test]
    fn test_danger_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("fix bugs"),
            "danger-full-access",
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox danger-full-access "fix bugs""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            "workspace-write",
            Some(&config),
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && codex --sandbox workspace-write "implement \"feature\" with quotes""#);
    }

    #[test]
    fn test_session_matches_cwd_session_meta() {
        use tempfile::NamedTempFile;
        use std::io::Write;
        
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"id":"test-session","timestamp":"2025-09-13T01:00:00.000Z","cwd":"/path/to/project","originator":"codex_cli_rs","cli_version":"0.34.0"}}"#).unwrap();
        writeln!(temp_file, r#"{{"record_type":"state"}}"#).unwrap();
        
        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }
    
    #[test]
    fn test_session_matches_cwd_environment_context() {
        use tempfile::NamedTempFile;
        use std::io::Write;
        
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"<environment_context>\n  <cwd>/path/to/project</cwd>\n  <sandbox_mode>workspace-write</sandbox_mode>\n</environment_context>"}}]}}}}"#).unwrap();
        
        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }
    
    #[test]
    fn test_session_matches_cwd_payload_cwd() {
        use tempfile::NamedTempFile;
        use std::io::Write;
        
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"session_meta","payload":{{"id":"test-session","cwd":"/path/to/project","originator":"codex_cli_rs"}}}}"#).unwrap();
        
        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }
    
    #[test]
    fn test_continue_with_danger_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__continue__"),
            None,
            "danger-full-access",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox danger-full-access --continue");
    }
    
    #[test]
    fn test_resume_picker_with_danger_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            Some("__resume__"),
            None,
            "danger-full-access",
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && codex --sandbox danger-full-access --resume");
    }

    // Avoid touching HOME to keep tests isolated from others.
    // Test the inner scanning helper directly with a temp directory.

    fn write_jsonl_with_cwd(path: &Path, cwd: &str) {
        let mut f = fs::File::create(path).unwrap();
        writeln!(f, "{{\"timestamp\":\"2025-09-13T01:00:00.000Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"s\",\"cwd\":\"{}\"}}}}", cwd).unwrap();
    }

    fn write_jsonl_without_cwd(path: &Path) {
        let mut f = fs::File::create(path).unwrap();
        writeln!(f, "{{\"record_type\":\"state\"}}").unwrap();
    }

    #[test]
    fn test_find_codex_session_fast_continue_when_global_newest_matches() {
        let tmp = tempdir().unwrap();
        let sessions = tmp.path().join(".codex/sessions/2025/09/14");
        fs::create_dir_all(&sessions).unwrap();
        let cwd = "/repo/worktree-a";
        let newest = sessions.join("rollout-2025-09-14T10-00-00-uuid.jsonl");
        write_jsonl_with_cwd(&newest, cwd);
        std::thread::sleep(std::time::Duration::from_millis(10));

        let newest_match = find_newest_session_for_cwd(tmp.path().join(".codex/sessions").as_path(), cwd).unwrap();
        let global_newest = find_newest_session(tmp.path().join(".codex/sessions").as_path()).unwrap();
        assert!(newest_match.is_some() && global_newest.is_some());
        assert_eq!(newest_match, global_newest);
    }

    #[test]
    fn test_find_codex_session_fast_resume_when_old_match_exists() {
        let tmp = tempdir().unwrap();
        let day_old = tmp.path().join(".codex/sessions/2025/08/22");
        let day_new = tmp.path().join(".codex/sessions/2025/09/14");
        fs::create_dir_all(&day_old).unwrap();
        fs::create_dir_all(&day_new).unwrap();

        let cwd = "/repo/worktree-a";
        let old_match = day_old.join("rollout-2025-08-22T10-00-00-uuid.jsonl");
        write_jsonl_with_cwd(&old_match, cwd);
        // Create a newer non-matching session
        let new_other = day_new.join("rollout-2025-09-14T10-00-00-uuid.jsonl");
        write_jsonl_without_cwd(&new_other);

        let newest_match = find_newest_session_for_cwd(tmp.path().join(".codex/sessions").as_path(), cwd).unwrap();
        let global_newest = find_newest_session(tmp.path().join(".codex/sessions").as_path()).unwrap();
        assert!(newest_match.is_some());
        assert_ne!(newest_match, global_newest);
    }
}

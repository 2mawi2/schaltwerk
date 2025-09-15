use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: Option<String>,
}

pub fn find_codex_session_fast(path: &Path) -> Option<String> {
    log::debug!("🔍 Codex session detection starting for path: {}", path.display());
    
    // Prefer explicit HOME for testability, fall back to dirs::home_dir()
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
    // If yes, we can safely use --continue. If not, but there are sessions for
    // this worktree, fall back to the interactive picker via --resume.
    match (find_sessions_by_cwd(&sessions_dir, &target_path), find_newest_session(&sessions_dir)) {
        (Ok(matching), Ok(global_newest)) => {
            log::debug!("📄 Codex session detection: Found {} matching session file(s)", matching.len());
            if matching.is_empty() {
                log::debug!("❌ Codex session detection: No sessions found matching CWD: {target_path:?}");
            } else {
                let newest_match = matching.first().cloned();
                log::debug!("🆚 Comparing newest match vs global newest:");
                log::debug!("   newest_match: {:?}", newest_match.as_ref().map(|p| p.display().to_string()));
                log::debug!("   global_newest: {:?}", global_newest.as_ref().map(|p| p.display().to_string()));

                if let (Some(nm), Some(gn)) = (newest_match.as_ref(), global_newest.as_ref()) {
                    if nm == gn {
                        log::debug!("✅ Safe to --continue: newest global session matches this worktree");
                        return Some("__continue__".to_string());
                    } else {
                        log::debug!("⚠️ Not safe to --continue: global newest belongs to a different context; using picker");
                        return Some("__resume__".to_string());
                    }
                } else if newest_match.is_some() {
                    // If we have matches but couldn't determine global newest, be safe and show picker
                    log::debug!("⚠️ Matches found but global newest unknown; using picker");
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

pub fn find_codex_session(path: &Path) -> Option<String> {
    find_codex_session_fast(path)
}

/// Returns the newest matching Codex session JSONL path for this worktree, if any.
pub fn find_codex_resume_path(path: &Path) -> Option<PathBuf> {
    // Prefer explicit HOME for testability, fall back to dirs::home_dir()
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
        log::debug!("📁 Scanning directory: {}", dir.display());
        
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                scan_directory(&path, target, matches, scanned_count)?;
            } else if path.extension().is_some_and(|ext| ext == "jsonl") {
                *scanned_count += 1;
                log::debug!("🔍 Checking session file: {}", path.display());
                
                if session_matches_cwd(&path, target) {
                    log::debug!("✅ Found matching session: {}", path.display());
                    matches.push(path);
                } else {
                    log::debug!("❌ Session does not match CWD: {}", path.display());
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
        log::debug!("📅 Sessions sorted by modification time (newest first):");
        for (i, session) in matching_sessions.iter().enumerate() {
            if let Ok(metadata) = session.metadata() {
                if let Ok(modified) = metadata.modified() {
                    log::debug!("  {}. {} (modified: {:?})", i + 1, session.display(), modified);
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
    log::debug!("🔍 Checking session file for CWD match: {}", session_file.display());
    log::debug!("🎯 Looking for CWD: {target_cwd:?}");
    
    let content = match fs::read_to_string(session_file) {
        Ok(content) => content,
        Err(e) => {
            log::debug!("❌ Failed to read session file: {e}");
            return false;
        }
    };
    
    let lines: Vec<&str> = content.lines().collect();
    log::debug!("📄 Session file has {} lines to check", lines.len());
    
    for (line_num, line) in lines.iter().enumerate() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            log::debug!("📝 Parsing JSON on line {}: {:?}", line_num + 1, json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown"));
            
            // Check session_meta.cwd field (top-level)
            if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                log::debug!("🔍 Found top-level CWD: {cwd:?}");
                if cwd == target_cwd {
                    log::debug!("✅ CWD match found in top-level field: {}", session_file.display());
                    return true;
                }
            }
            
            // Check session_meta payload
            if let Some(payload) = json.get("payload") {
                if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                    log::debug!("🔍 Found payload CWD: {cwd:?}");
                    if cwd == target_cwd {
                        log::debug!("✅ CWD match found in payload field: {}", session_file.display());
                        return true;
                    }
                }
                
                // Check environment_context in message content
                if let Some(content_array) = payload.get("content").and_then(|v| v.as_array()) {
                    log::debug!("📋 Checking {} content items for environment_context", content_array.len());
                    for (item_idx, content_item) in content_array.iter().enumerate() {
                        if let Some(text) = content_item.get("text").and_then(|v| v.as_str()) {
                            if text.contains("<environment_context>") {
                                log::debug!("🌍 Found environment_context in content item {item_idx}");
                                let cwd_pattern = format!("<cwd>{target_cwd}</cwd>");
                                if text.contains(&cwd_pattern) {
                                    log::debug!("✅ CWD match found in environment_context: {}", session_file.display());
                                    return true;
                                } else {
                                    log::debug!("❌ environment_context does not contain target CWD pattern");
                                }
                            }
                        }
                    }
                }
            }
        } else {
            log::debug!("⚠️ Line {} is not valid JSON, skipping", line_num + 1);
        }
    }
    
    log::debug!("❌ No CWD match found in session file");
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
}

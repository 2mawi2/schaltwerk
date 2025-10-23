use super::format_binary_invocation;
use std::fs;
use std::path::Path;
use std::time::SystemTime;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Clone, Default)]
pub struct AmpConfig {
    pub binary_path: Option<String>,
}

// Simple function to return binary name for external callers
pub fn resolve_amp_binary() -> String {
    "amp".to_string()
}

/// Discovers Amp threads by scanning ~/.local/share/amp/threads/ for T-*.json files
/// Returns the most recently modified thread ID for resumption.
/// This is a fallback mechanism; the database-stored amp_thread_id should be preferred.
pub fn find_amp_session(_path: &Path) -> Option<String> {
    let home = dirs::home_dir()?;
    let threads_dir = home.join(".local/share/amp/threads");

    log::debug!(
        "Amp thread detection (fallback): Looking for threads in {}",
        threads_dir.display()
    );

    match fs::read_dir(&threads_dir) {
        Ok(entries) => {
            let mut newest: Option<(SystemTime, String)> = None;

            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !entry_path
                    .extension()
                    .map(|ext| ext == "json")
                    .unwrap_or(false)
                {
                    continue;
                }

                let file_name = entry_path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("");

                if !file_name.starts_with("T-") {
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(meta) => meta,
                    Err(err) => {
                        log::debug!(
                            "Amp thread detection (fallback): Failed to read metadata for {}: {err}",
                            entry_path.display()
                        );
                        continue;
                    }
                };

                let modified = metadata
                    .modified()
                    .or_else(|_| metadata.created())
                    .unwrap_or(SystemTime::UNIX_EPOCH);

                let is_newer = match &newest {
                    Some((existing_time, _)) => modified > *existing_time,
                    None => true,
                };

                if is_newer {
                    log::debug!(
                        "Amp thread detection (fallback): Candidate thread '{file_name}' (mtime={modified:?})"
                    );
                    newest = Some((modified, file_name.to_string()));
                }
            }

            if let Some((modified, thread_id)) = newest {
                log::info!(
                    "Amp thread detection (fallback): Selected thread '{thread_id}' (mtime={modified:?})"
                );
                Some(thread_id)
            } else {
                log::debug!(
                    "Amp thread detection (fallback): No thread files found in {}",
                    threads_dir.display()
                );
                None
            }
        }
        Err(err) => {
            log::debug!(
                "Amp thread detection (fallback): Failed to read threads directory {}: {err}",
                threads_dir.display()
            );
            None
        }
    }
}

/// Asynchronously watches for a new Amp thread to be created in ~/.local/share/amp/threads/
/// Returns the thread ID of the newly created thread, or None if timeout is reached
pub async fn watch_amp_thread_creation(timeout_secs: u64) -> Option<String> {
    let home = dirs::home_dir()?;
    let threads_dir = home.join(".local/share/amp/threads");

    if !threads_dir.exists() {
        log::warn!(
            "Amp threads directory does not exist: {}",
            threads_dir.display()
        );
        return None;
    }

    fn get_existing_threads(dir: &Path) -> Option<Vec<String>> {
        fs::read_dir(dir).ok().map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    if path.extension().map(|ext| ext == "json").unwrap_or(false) {
                        path.file_stem()
                            .and_then(|stem| stem.to_str())
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
    }

    let initial_threads = get_existing_threads(&threads_dir)?;
    log::debug!(
        "Amp thread watcher: Initial threads: {initial_threads:?}"
    );

    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if let Some(current_threads) = get_existing_threads(&threads_dir) {
            for thread_id in current_threads {
                if !initial_threads.contains(&thread_id) {
                    log::info!("Amp thread watcher: Detected new thread: {thread_id}");
                    return Some(thread_id);
                }
            }
        }

        if std::time::Instant::now() >= deadline {
            log::warn!(
                "Amp thread watcher: Timeout ({timeout_secs} secs) reached without detecting new thread"
            );
            return None;
        }

        sleep(Duration::from_millis(100)).await;
    }
}

pub fn build_amp_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&AmpConfig>,
) -> String {
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "amp"
            }
        } else {
            "amp"
        }
    } else {
        "amp"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());

    let mut cmd = format!("cd {cwd_quoted}");
    cmd.push_str(" && ");

    // Amp supports stdin input, so we can pipe the prompt if provided
    if let Some(prompt) = initial_prompt {
        if !prompt.trim().is_empty() {
            let escaped = super::escape_prompt_for_shell(prompt);
            cmd.push_str("echo \"");
            cmd.push_str(&escaped);
            cmd.push_str("\" | ");
        }
    }

    cmd.push_str(&binary_invocation);

    // Resume existing thread if session_id is provided
    if let Some(thread_id) = session_id {
        if !thread_id.is_empty() {
            cmd.push_str(" threads continue ");
            cmd.push_str(thread_id);
        }
    }

    if skip_permissions {
        cmd.push_str(" --dangerously-allow-all");
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && echo \"implement feature X\" | amp --dangerously-allow-all"
        );
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd \"/path/with spaces\" && amp");
    }

    #[test]
    fn test_resume_with_thread_id() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some("T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc"),
            None,
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && amp threads continue T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc"
        );
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[test]
    fn test_prompt_with_quotes() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
            Some(&config),
        );
        assert!(cmd.contains("implement"));
        assert!(cmd.contains("feature"));
        assert!(cmd.contains("quotes"));
        assert!(cmd.contains("echo"));
        assert!(cmd.contains("| amp"));
    }

    #[test]
    fn test_resume_with_thread_id_and_permissions() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some("T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc"),
            None,
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && amp threads continue T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc --dangerously-allow-all"
        );
    }

    #[test]
    fn test_resume_with_thread_id_and_prompt() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some("T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc"),
            Some("continue with feature X"),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && echo \"continue with feature X\" | amp threads continue T-7bb2c785-d6f5-44a1-80e0-28f11fd997bc"
        );
    }

    #[test]
    fn test_empty_thread_id_ignored() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some(""),
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[tokio::test]
    #[serial]
    async fn test_watch_amp_thread_creation_detects_new_thread() {
        use std::fs::File;
        use std::io::Write;
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let threads_dir = temp.path().join(".local/share/amp/threads");
        std::fs::create_dir_all(&threads_dir).unwrap();

        // Create initial thread file
        let initial_thread = threads_dir.join("T-initial-thread.json");
        let mut file = File::create(initial_thread).unwrap();
        file.write_all(b"{}").unwrap();

        // Spawn a task to create a new thread file after a short delay
        let threads_dir_clone = threads_dir.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(200)).await;
            let new_thread = threads_dir_clone.join("T-new-thread-id.json");
            let mut f = File::create(new_thread).unwrap();
            f.write_all(b"{}").unwrap();
        });

        // Set HOME to temp directory for this test
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp.path());

        let result = watch_amp_thread_creation(5).await;

        // Restore HOME
        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        assert_eq!(result, Some("T-new-thread-id".to_string()));
    }

    #[tokio::test]
    #[serial]
    async fn test_watch_amp_thread_creation_timeout() {
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let threads_dir = temp.path().join(".local/share/amp/threads");
        std::fs::create_dir_all(&threads_dir).unwrap();

        // Create initial thread file
        use std::fs::File;
        use std::io::Write;
        let initial_thread = threads_dir.join("T-initial-thread.json");
        let mut file = File::create(initial_thread).unwrap();
        file.write_all(b"{}").unwrap();

        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp.path());

        // Watch with short timeout, no new threads created
        let result = watch_amp_thread_creation(1).await;

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        assert_eq!(result, None);
    }

    #[tokio::test]
    #[serial]
    async fn test_watch_amp_thread_creation_empty_directory() {
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let threads_dir = temp.path().join(".local/share/amp/threads");
        std::fs::create_dir_all(&threads_dir).unwrap();

        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp.path());

        // Watch in empty directory - should timeout
        let result = watch_amp_thread_creation(1).await;

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        assert_eq!(result, None);
    }

    #[tokio::test]
    #[serial]
    async fn test_watch_amp_thread_creation_ignores_non_json() {
        use std::fs::File;
        use std::io::Write;
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let threads_dir = temp.path().join(".local/share/amp/threads");
        std::fs::create_dir_all(&threads_dir).unwrap();

        // Create initial thread file
        let initial_thread = threads_dir.join("T-initial-thread.json");
        let mut file = File::create(initial_thread).unwrap();
        file.write_all(b"{}").unwrap();

        // Spawn a task to create non-JSON files
        let threads_dir_clone = threads_dir.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(100)).await;
            let non_json = threads_dir_clone.join("T-not-json.txt");
            let mut f = File::create(non_json).unwrap();
            f.write_all(b"{}").unwrap();
        });

        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp.path());

        // Watch with short timeout - should timeout because no .json files added
        let result = watch_amp_thread_creation(1).await;

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        assert_eq!(result, None);
    }
}

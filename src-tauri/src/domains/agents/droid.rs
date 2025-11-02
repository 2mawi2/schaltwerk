use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};
use std::time::SystemTime;

#[cfg(target_family = "unix")]
use std::os::unix::fs::PermissionsExt;

const SHIM_RELATIVE_PATH: &str = ".schaltwerk/droid/shims";
const SHIM_BINARY_NAME: &str = "code";
const SHIM_CONTENT: &str = r#"#!/bin/bash
set -euo pipefail

# Pretend the Factory VS Code extension is already installed so the CLI
# doesn't attempt to spawn the real `code` binary. Returning success keeps
# the droid CLI happy without launching VS Code.
if [[ "${1:-}" == "--list-extensions" ]]; then
  echo "factory.factory-vscode-extension"
  exit 0
fi

if [[ "${1:-}" == "--install-extension" ]]; then
  exit 0
fi

exit 0
"#;

static DROID_CACHE: LazyLock<RwLock<SessionCache>> =
    LazyLock::new(|| RwLock::new(SessionCache::default()));

#[derive(Default)]
struct SessionCache {
    cwd_to_session: HashMap<String, (String, SystemTime)>,
    sessions_dir_mtime: Option<SystemTime>,
}

impl SessionCache {
    fn needs_refresh(&self) -> bool {
        let Some(home) = dirs::home_dir() else {
            return false;
        };
        let sessions_dir = home.join(".factory/sessions");

        if !sessions_dir.exists() {
            return false;
        }

        let Ok(meta) = fs::metadata(&sessions_dir) else {
            return false;
        };
        let Ok(dir_mtime) = meta.modified() else {
            return false;
        };

        Some(dir_mtime) != self.sessions_dir_mtime
    }

    fn refresh(&mut self) {
        let Some(home) = dirs::home_dir() else { return };
        let sessions_dir = home.join(".factory/sessions");

        if !sessions_dir.exists() {
            return;
        }

        if let Ok(meta) = fs::metadata(&sessions_dir) {
            self.sessions_dir_mtime = meta.modified().ok();
        }

        let mut candidates: HashMap<String, (String, SystemTime)> = HashMap::new();

        let Ok(entries) = fs::read_dir(&sessions_dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            let Some(session_id) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
            else {
                continue;
            };

            let Ok(meta) = entry.metadata() else { continue };
            let Ok(mtime) = meta.modified() else { continue };

            let Ok(contents) = fs::read_to_string(&path) else {
                continue;
            };
            let Some(second_line) = contents.lines().nth(1) else {
                continue;
            };

            if let Some(cwd) = extract_cwd(second_line) {
                candidates
                    .entry(cwd)
                    .and_modify(|(id, time)| {
                        if mtime > *time {
                            *id = session_id.clone();
                            *time = mtime;
                        }
                    })
                    .or_insert((session_id, mtime));
            }
        }

        self.cwd_to_session = candidates;

        log::debug!(
            "Droid session cache refreshed: {} CWDs indexed",
            self.cwd_to_session.len()
        );
    }
}

fn extract_cwd(line: &str) -> Option<String> {
    if let Some(start) = line.find("% pwd\\n") {
        let after = &line[start + 7..];
        if let Some(end) = after.find("\\n") {
            let path = after[..end].trim();
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }

    if let Some(start) = line.find("Current folder: ") {
        let after = &line[start + 16..];
        if let Some(end) = after.find("\\n").or_else(|| after.find('\n')) {
            return Some(after[..end].to_string());
        }
    }

    None
}

pub fn find_droid_session_for_worktree(worktree_path: &Path) -> Option<String> {
    let Ok(mut cache) = DROID_CACHE.write() else {
        return None;
    };

    if cache.needs_refresh() {
        cache.refresh();
    }

    let cwd = worktree_path.to_string_lossy().to_string();
    cache.cwd_to_session.get(&cwd).map(|(id, _)| {
        log::info!("Found Droid session '{id}' for worktree {cwd}");
        id.clone()
    })
}

fn shim_directory(worktree_path: &Path) -> PathBuf {
    worktree_path.join(SHIM_RELATIVE_PATH)
}

pub fn ensure_vscode_cli_shim(
    worktree_path: &Path,
    system_path: &str,
) -> io::Result<Option<String>> {
    let shim_dir = shim_directory(worktree_path);
    fs::create_dir_all(&shim_dir)?;

    let shim_path = shim_dir.join(SHIM_BINARY_NAME);
    write_if_different(&shim_path, SHIM_CONTENT)?;

    #[cfg(target_family = "unix")]
    {
        let metadata = fs::metadata(&shim_path)?;
        let mut permissions = metadata.permissions();
        // Make sure the shim is executable by default.
        if permissions.mode() & 0o755 != 0o755 {
            permissions.set_mode(0o755);
            fs::set_permissions(&shim_path, permissions)?;
        }
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = shim_path; // Nothing extra to do on non-Unix platforms.
    }

    let shim_dir_string = shim_dir.to_string_lossy().into_owned();
    let new_path = if system_path.is_empty() {
        shim_dir_string.clone()
    } else {
        let separator = if cfg!(windows) { ';' } else { ':' };
        format!("{shim_dir_string}{separator}{system_path}")
    };

    Ok(Some(new_path))
}

fn write_if_different(path: &Path, contents: &str) -> io::Result<()> {
    if path.exists()
        && let Ok(existing) = fs::read_to_string(path)
        && existing == contents
    {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = fs::File::create(path)?;
    file.write_all(contents.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::ffi::OsString;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_shim_and_returns_updated_path() {
        let temp = tempdir().unwrap();
        let worktree = temp.path();
        let original_path = "/bin";

        let result = ensure_vscode_cli_shim(worktree, original_path).unwrap();
        let new_path = result.expect("expected path override");

        let expected_prefix = shim_directory(worktree).to_string_lossy().into_owned();
        let separator = if cfg!(windows) { ';' } else { ':' };
        let expected = format!("{}{}{}", expected_prefix, separator, original_path);
        assert_eq!(new_path, expected);

        let shim_binary = shim_directory(worktree).join(SHIM_BINARY_NAME);
        assert!(shim_binary.exists(), "shim binary should exist");
    }

    #[test]
    fn extract_cwd_from_json_escaped_newline() {
        let line =
            r#"{"message":{"content":[{"text":"Current folder: /path/to/worktree\nNext line"}]}}"#;
        assert_eq!(extract_cwd(line), Some("/path/to/worktree".to_string()));
    }

    #[test]
    fn extract_cwd_from_actual_newline() {
        let line = "Current folder: /path/to/worktree\nNext line";
        assert_eq!(extract_cwd(line), Some("/path/to/worktree".to_string()));
    }

    #[test]
    fn extract_cwd_returns_none_when_marker_missing() {
        let line = r#"{"message":{"content":[{"text":"Some other content"}]}}"#;
        assert_eq!(extract_cwd(line), None);
    }

    #[test]
    fn extract_cwd_returns_none_when_no_newline() {
        let line = "Current folder: /path/to/worktree";
        assert_eq!(extract_cwd(line), None);
    }

    #[test]
    fn extract_cwd_from_pwd_command() {
        let line = r#"% pwd\n/Users/marius/Documents/git/project\n\n% ls"#;
        assert_eq!(
            extract_cwd(line),
            Some("/Users/marius/Documents/git/project".to_string())
        );
    }

    #[test]
    fn extract_cwd_handles_pwd_with_spaces() {
        let line = r#"% pwd\n/Users/marius/Documents/my project/worktree\n"#;
        assert_eq!(
            extract_cwd(line),
            Some("/Users/marius/Documents/my project/worktree".to_string())
        );
    }

    #[test]
    #[serial]
    fn finds_resumable_sessions_for_multiple_worktrees() {
        let temp = tempdir().unwrap();

        let home_dir = temp.path().join("home");
        fs::create_dir_all(&home_dir).unwrap();

        struct HomeGuard(Option<OsString>);

        impl Drop for HomeGuard {
            fn drop(&mut self) {
                unsafe {
                    if let Some(ref value) = self.0 {
                        std::env::set_var("HOME", value);
                    } else {
                        std::env::remove_var("HOME");
                    }
                }
            }
        }

        let original_home = std::env::var_os("HOME");
        let _guard = HomeGuard(original_home);
        unsafe {
            std::env::set_var("HOME", &home_dir);
        }

        let sessions_dir = home_dir.join(".factory/sessions");
        fs::create_dir_all(&sessions_dir).unwrap();

        let worktree_root = temp.path().join("worktrees");
        fs::create_dir_all(&worktree_root).unwrap();
        let worktree_a = worktree_root.join("alpha");
        let worktree_b = worktree_root.join("bravo");
        fs::create_dir_all(&worktree_a).unwrap();
        fs::create_dir_all(&worktree_b).unwrap();

        let session_a_path = sessions_dir.join("session-alpha.jsonl");
        let session_b_path = sessions_dir.join("session-bravo.jsonl");
        let contents_a = format!(
            "{{}}\nCurrent folder: {}\\nNext line\n",
            worktree_a.to_string_lossy()
        );
        let contents_b = format!(
            "{{}}\nCurrent folder: {}\\nNext line\n",
            worktree_b.to_string_lossy()
        );
        fs::write(&session_a_path, contents_a).unwrap();
        fs::write(&session_b_path, contents_b).unwrap();

        {
            let mut cache = DROID_CACHE.write().unwrap();
            *cache = SessionCache::default();
        }

        let found_a =
            find_droid_session_for_worktree(&worktree_a).expect("missing session for worktree A");
        let found_b =
            find_droid_session_for_worktree(&worktree_b).expect("missing session for worktree B");

        assert_eq!(found_a, "session-alpha");
        assert_eq!(found_b, "session-bravo");

        assert_eq!(
            find_droid_session_for_worktree(&worktree_a).as_deref(),
            Some("session-alpha")
        );
        assert_eq!(
            find_droid_session_for_worktree(&worktree_b).as_deref(),
            Some("session-bravo")
        );
    }
}

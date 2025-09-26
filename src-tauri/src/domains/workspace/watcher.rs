use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::domains::sessions::activity::SessionGitStatsUpdated;
use crate::infrastructure::events::{emit_event, SchaltEvent};
use log::{debug, error, info, warn};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

use crate::domains::git::service as git;
use crate::domains::sessions::entity::ChangedFile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub session_name: String,
    pub changed_files: Vec<ChangedFile>,
    pub change_summary: ChangeSummary,
    pub branch_info: BranchInfo,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSummary {
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_staged: bool,
    pub has_unstaged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub current_branch: String,
    pub base_branch: String,
    pub base_commit: String,
    pub head_commit: String,
}

pub struct FileWatcher {
    _session_name: String,
    _worktree_path: PathBuf,
    _debouncer: Debouncer<RecommendedWatcher>,
    _gitdir_index: Option<PathBuf>,
}

impl FileWatcher {
    pub fn new(
        session_name: String,
        worktree_path: PathBuf,
        base_branch: String,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        let (tx, mut rx) = mpsc::channel(100);

        let debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: DebounceEventResult| {
                if let Err(e) = tx.blocking_send(result) {
                    error!("Failed to send file watch event: {e}");
                }
            },
        )
        .map_err(|e| format!("Failed to create debouncer: {e}"))?;

        let session_name_clone = session_name.clone();
        let worktree_path_clone = worktree_path.clone();
        let base_branch_clone = base_branch.clone();
        let app_handle_clone = app_handle.clone();

        tokio::spawn(async move {
            while let Some(result) = rx.recv().await {
                match result {
                    Ok(events) => {
                        debug!(
                            "File watcher received {} events for session {}",
                            events.len(),
                            session_name_clone
                        );

                        if let Err(e) = Self::handle_file_changes(
                            &session_name_clone,
                            &worktree_path_clone,
                            &base_branch_clone,
                            &app_handle_clone,
                            events,
                        )
                        .await
                        {
                            warn!("Failed to handle file changes for session {session_name_clone}: {e}");
                        }
                    }
                    Err(e) => {
                        error!("File watcher error for session {session_name_clone}: {e:?}");
                    }
                }
            }
        });

        // Attempt to resolve the external gitdir index for this worktree
        let gitdir_index = Self::resolve_gitdir_index(&worktree_path);

        let mut watcher = Self {
            _session_name: session_name,
            _worktree_path: worktree_path.clone(),
            _debouncer: debouncer,
            _gitdir_index: gitdir_index,
        };

        watcher.start_watching()?;
        Ok(watcher)
    }

    fn start_watching(&mut self) -> Result<(), String> {
        let watcher = self._debouncer.watcher();

        watcher
            .watch(&self._worktree_path, RecursiveMode::Recursive)
            .map_err(|e| {
                format!(
                    "Failed to start watching {}: {e}",
                    self._worktree_path.display()
                )
            })?;

        // Also watch the worktree's gitdir/index to catch commit events (for linked worktrees)
        if let Some(ref idx) = self._gitdir_index {
            if let Some(parent) = idx.parent() {
                watcher
                    .watch(parent, RecursiveMode::NonRecursive)
                    .map_err(|e| {
                        format!(
                            "Failed to watch gitdir index parent {}: {e}",
                            parent.display()
                        )
                    })?;
                info!(
                    "Started watching gitdir index for session {} at {}",
                    self._session_name,
                    idx.display()
                );
            }
        }

        info!(
            "Started file watching for session {} at path {}",
            self._session_name,
            self._worktree_path.display()
        );
        Ok(())
    }

    fn resolve_gitdir_index(worktree_path: &Path) -> Option<PathBuf> {
        let dot_git = worktree_path.join(".git");
        if dot_git.is_file() {
            if let Ok(s) = std::fs::read_to_string(&dot_git) {
                if let Some(rest) = s.strip_prefix("gitdir: ") {
                    let gitdir = PathBuf::from(rest.trim());
                    return Some(gitdir.join("index"));
                }
            }
        } else if dot_git.is_dir() {
            return Some(dot_git.join("index"));
        }
        None
    }

    async fn handle_file_changes(
        session_name: &str,
        worktree_path: &Path,
        base_branch: &str,
        app_handle: &AppHandle,
        events: Vec<notify_debouncer_mini::DebouncedEvent>,
    ) -> Result<(), String> {
        let should_ignore_event = events
            .iter()
            .all(|event| Self::should_ignore_path(&event.path));

        if should_ignore_event {
            debug!("Ignoring file changes in system directories for session {session_name}");
            return Ok(());
        }

        // Identify commit signals so we can correlate immediate updates after commit
        let mut saw_index = false;
        let mut saw_head = false;
        let mut saw_refs = false;
        for ev in &events {
            if let Some(p) = ev.path.to_str() {
                // Standard repo layout
                if p.ends_with("/.git/index") {
                    saw_index = true;
                }
                if p.ends_with("/.git/HEAD") {
                    saw_head = true;
                }
                if p.contains("/.git/refs/heads/") {
                    saw_refs = true;
                }
                // Linked worktree gitdir lives under mainrepo/.git/worktrees/<name>/
                if p.contains("/.git/worktrees/") && p.ends_with("/index") {
                    saw_index = true;
                }
                if p.contains("/.git/worktrees/") && p.ends_with("/HEAD") {
                    saw_head = true;
                }
            }
        }
        debug!(
            "Processing file changes for session {}: {} events (commit_signals index:{} head:{} refs:{})",
            session_name, events.len(), saw_index, saw_head, saw_refs
        );

        let changed_files = git::get_changed_files(worktree_path, base_branch)
            .map_err(|e| format!("Failed to get changed files: {e}"))?;

        info!(
            "Session {} has {} changed files detected",
            session_name,
            changed_files.len()
        );

        let change_summary =
            Self::compute_change_summary(&changed_files, worktree_path, base_branch).await?;

        let branch_info = Self::get_branch_info(worktree_path, base_branch).await?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let file_change_event = FileChangeEvent {
            session_name: session_name.to_string(),
            changed_files,
            change_summary,
            branch_info,
            timestamp,
        };

        debug!(
            "Emitting file change event for session {} with {} files",
            session_name,
            file_change_event.changed_files.len()
        );

        emit_event(app_handle, SchaltEvent::FileChanges, &file_change_event)
            .map_err(|e| format!("Failed to emit file change event: {e}"))?;

        // Also emit fresh git stats immediately so the session list updates without waiting for polling
        match git::calculate_git_stats_fast(worktree_path, base_branch) {
            Ok(stats) => {
                // Collect a small sample of uncommitted paths to help frontend tooltips
                let sample = match crate::domains::git::operations::uncommitted_sample_paths(
                    worktree_path,
                    5,
                ) {
                    Ok(v) if !v.is_empty() => Some(v),
                    _ => None,
                };
                let payload = SessionGitStatsUpdated {
                    session_id: session_name.to_string(), // UI uses session_name; keep id same for payload
                    session_name: session_name.to_string(),
                    files_changed: stats.files_changed,
                    lines_added: stats.lines_added,
                    lines_removed: stats.lines_removed,
                    has_uncommitted: stats.has_uncommitted,
                    top_uncommitted_paths: sample,
                };
                let _ = emit_event(app_handle, SchaltEvent::SessionGitStats, &payload);
                debug!(
                    "Watcher emitted SessionGitStats for {}: files={} +{} -{} has_uncommitted={}",
                    session_name,
                    payload.files_changed,
                    payload.lines_added,
                    payload.lines_removed,
                    payload.has_uncommitted
                );
            }
            Err(e) => {
                log::debug!("Watcher git stats fast failed for {session_name}: {e}");
            }
        }

        Ok(())
    }

    fn should_ignore_path(path: &Path) -> bool {
        if let Some(path_str) = path.to_str() {
            // Treat critical .git files as signalers of commits/branch moves
            if path_str.contains("/.git/") {
                let is_index = path_str.ends_with("/.git/index")
                    || (path_str.contains("/.git/worktrees/") && path_str.ends_with("/index"));
                let is_head = path_str.ends_with("/.git/HEAD")
                    || (path_str.contains("/.git/worktrees/") && path_str.ends_with("/HEAD"));
                let is_ref_head = path_str.contains("/.git/refs/heads/")
                    || path_str.contains("/.git/worktrees/") && path_str.contains("/refs/heads/");
                if is_index || is_head || is_ref_head {
                    return false; // do not ignore -> we want immediate updates on commit
                }
                return true; // ignore other .git noise
            }
            path_str.contains("/node_modules/")
                || path_str.contains("/target/")
                || path_str.contains("/.DS_Store")
                || path_str.contains("/.*~")
                || path_str.ends_with(".tmp")
                || path_str.ends_with(".swp")
                || path_str.contains("/.vscode/")
        } else {
            false
        }
    }

    async fn compute_change_summary(
        changed_files: &[ChangedFile],
        worktree_path: &Path,
        _base_branch: &str,
    ) -> Result<ChangeSummary, String> {
        let files_changed = changed_files.len() as u32;

        // Use libgit2 to determine staged/unstaged and line stats
        // If not a git repo, return graceful defaults
        let repo = match git2::Repository::open(worktree_path) {
            Ok(r) => r,
            Err(_) => {
                return Ok(ChangeSummary {
                    files_changed,
                    lines_added: 0,
                    lines_removed: 0,
                    has_staged: false,
                    has_unstaged: false,
                });
            }
        };

        // Parse status to detect staged/unstaged
        let statuses = repo
            .statuses(None)
            .map_err(|e| format!("Failed to get repository status: {e}"))?;
        let mut has_staged = false;
        let mut has_unstaged = false;
        for entry in statuses.iter() {
            let st = entry.status();
            if st.is_index_new()
                || st.is_index_modified()
                || st.is_index_deleted()
                || st.is_index_renamed()
                || st.is_index_typechange()
            {
                has_staged = true;
            }
            if st.is_wt_new()
                || st.is_wt_modified()
                || st.is_wt_deleted()
                || st.is_wt_renamed()
                || st.is_wt_typechange()
            {
                has_unstaged = true;
            }
        }

        // Compute line stats similar to `git diff --numstat` for both staged and unstaged
        let mut lines_added: u32 = 0;
        let mut lines_removed: u32 = 0;

        // Staged: tree (HEAD or merge-base) to index
        if let Ok(idx) = repo.index() {
            if let Ok(head) = repo.head() {
                if let Some(head_oid) = head.target() {
                    if let Ok(head_commit) = repo.find_commit(head_oid) {
                        if let Ok(head_tree) = head_commit.tree() {
                            let mut opts = git2::DiffOptions::new();
                            if let Ok(diff_idx) = repo.diff_tree_to_index(
                                Some(&head_tree),
                                Some(&idx),
                                Some(&mut opts),
                            ) {
                                if let Ok(stats) = diff_idx.stats() {
                                    lines_added += stats.insertions() as u32;
                                    lines_removed += stats.deletions() as u32;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Unstaged: index to workdir
        if let Ok(idx) = repo.index() {
            let mut opts = git2::DiffOptions::new();
            opts.include_untracked(true).recurse_untracked_dirs(true);
            if let Ok(diff_wd) = repo.diff_index_to_workdir(Some(&idx), Some(&mut opts)) {
                if let Ok(stats) = diff_wd.stats() {
                    lines_added += stats.insertions() as u32;
                    lines_removed += stats.deletions() as u32;
                }
            }
        }

        Ok(ChangeSummary {
            files_changed,
            lines_added,
            lines_removed,
            has_staged,
            has_unstaged,
        })
    }

    async fn get_branch_info(
        worktree_path: &Path,
        base_branch: &str,
    ) -> Result<BranchInfo, String> {
        // Use libgit2 to get branch and commit info
        let (current_branch, base_commit, head_commit) = match git2::Repository::open(worktree_path)
        {
            Ok(repo) => {
                let mut cur = repo
                    .head()
                    .ok()
                    .and_then(|h| h.shorthand().map(|s| s.to_string()))
                    .unwrap_or_else(|| "HEAD".to_string());
                if cur.is_empty() {
                    cur = "HEAD".to_string();
                }
                let base = repo
                    .revparse_single(base_branch)
                    .ok()
                    .map(|o| o.id().to_string())
                    .map(|s| s.chars().take(7).collect())
                    .unwrap_or_else(|| "".to_string());
                let head = repo
                    .head()
                    .ok()
                    .and_then(|h| h.target())
                    .map(|oid| oid.to_string())
                    .map(|s| s.chars().take(7).collect())
                    .unwrap_or_else(|| "".to_string());
                (cur, base, head)
            }
            Err(_) => ("HEAD".to_string(), "".to_string(), "".to_string()),
        };

        Ok(BranchInfo {
            current_branch,
            base_branch: base_branch.to_string(),
            base_commit,
            head_commit,
        })
    }
}

pub struct FileWatcherManager {
    watchers: Arc<Mutex<HashMap<String, FileWatcher>>>,
    app_handle: AppHandle,
}

impl FileWatcherManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
        }
    }

    pub async fn start_watching_session(
        &self,
        session_name: String,
        worktree_path: PathBuf,
        base_branch: String,
    ) -> Result<(), String> {
        let mut watchers = self.watchers.lock().await;

        if watchers.contains_key(&session_name) {
            debug!("Already watching session {session_name}");
            return Ok(());
        }

        let watcher = FileWatcher::new(
            session_name.clone(),
            worktree_path,
            base_branch,
            self.app_handle.clone(),
        )?;

        watchers.insert(session_name.clone(), watcher);
        info!("Started file watching for session {session_name}");
        Ok(())
    }

    pub async fn stop_watching_session(&self, session_name: &str) -> Result<(), String> {
        let mut watchers = self.watchers.lock().await;

        if let Some(_watcher) = watchers.remove(session_name) {
            info!("Stopped file watching for session {session_name}");
        } else {
            debug!("Session {session_name} was not being watched");
        }

        Ok(())
    }

    pub async fn stop_all_watchers(&self) {
        let mut watchers = self.watchers.lock().await;
        let count = watchers.len();
        watchers.clear();
        info!("Stopped {count} file watchers");
    }

    pub async fn is_watching(&self, session_name: &str) -> bool {
        let watchers = self.watchers.lock().await;
        watchers.contains_key(session_name)
    }

    pub async fn get_active_watchers(&self) -> Vec<String> {
        let watchers = self.watchers.lock().await;
        watchers.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn create_test_git_repo(temp_dir: &TempDir) -> PathBuf {
        let repo_path = temp_dir.path().to_path_buf();

        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to init git repo");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to set git user.name");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to set git user.email");

        Command::new("git")
            .args(["config", "init.defaultBranch", "main"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to set default branch");

        fs::write(repo_path.join("initial.txt"), "initial content").unwrap();

        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to git add");

        let commit_output = Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit");

        if !commit_output.status.success() {
            panic!(
                "Failed to create initial commit: {}",
                String::from_utf8_lossy(&commit_output.stderr)
            );
        }

        let branch_check = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&repo_path)
            .output();

        if branch_check.is_ok() {
            let current_branch = String::from_utf8_lossy(&branch_check.unwrap().stdout)
                .trim()
                .to_string();
            if current_branch.is_empty() || current_branch != "main" {
                Command::new("git")
                    .args(["checkout", "-b", "main"])
                    .current_dir(&repo_path)
                    .output()
                    .unwrap_or_else(|_| {
                        Command::new("git")
                            .args(["branch", "-M", "main"])
                            .current_dir(&repo_path)
                            .output()
                            .expect("Failed to create/rename main branch")
                    });
            }
        }

        repo_path
    }

    #[test]
    fn test_should_ignore_path_comprehensive() {
        // Test all ignore patterns
        // Commit signal files should NOT be ignored (we want immediate updates)
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/.git/index"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/.git/HEAD"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.git/config"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/subdir/.git/hooks/pre-commit"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/node_modules/package.json"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/node_modules/subdir/file.js"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/node_modules/@scope/package/file.ts"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/target/debug/app"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/target/release/binary"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/target/wasm32-unknown-emscripten"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.DS_Store"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/subdir/.DS_Store"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.DS_Store.backup"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new("/path/file.tmp")));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/subdir/file.tmp"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/file.temporary.tmp"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new("/path/file.swp")));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.file.swp"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/file.txt.swp"
        )));

        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.vscode/settings.json"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.vscode/extensions.json"
        )));
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/.vscode/launch.json"
        )));

        // Test non-ignored paths
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/src/main.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/README.md"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/package.json"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/Cargo.toml"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/src/components/App.tsx"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/tests/test_file.rs"
        )));

        // Test edge cases
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/gitfile.txt"
        ))); // Contains "git" but not in .git/
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/node_modules_backup/file.js"
        ))); // Contains "node_modules" but not exact match
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/target_file.txt"
        ))); // Contains "target" but not in /target/

        // Test with None path (should not panic)
        assert!(!FileWatcher::should_ignore_path(Path::new("")));

        // Test unicode paths
        assert!(FileWatcher::should_ignore_path(Path::new(
            "/path/📁/.git/config"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/📁/main.rs"
        )));
    }

    #[test]
    fn test_file_change_event_serialization() {
        let event = FileChangeEvent {
            session_name: "test-session".to_string(),
            changed_files: vec![
                ChangedFile {
                    path: "src/main.rs".to_string(),
                    change_type: "modified".to_string(),
                },
                ChangedFile {
                    path: "Cargo.toml".to_string(),
                    change_type: "added".to_string(),
                },
            ],
            change_summary: ChangeSummary {
                files_changed: 2,
                lines_added: 15,
                lines_removed: 3,
                has_staged: true,
                has_unstaged: false,
            },
            branch_info: BranchInfo {
                current_branch: "feature-branch".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abc123def456".to_string(),
                head_commit: "def789ghi012".to_string(),
            },
            timestamp: 1234567890123,
        };

        let json = serde_json::to_string(&event);
        assert!(json.is_ok(), "Serialization should succeed");

        let parsed: Result<FileChangeEvent, _> = serde_json::from_str(&json.unwrap());
        assert!(parsed.is_ok(), "Deserialization should succeed");

        let deserialized = parsed.unwrap();
        assert_eq!(deserialized.session_name, "test-session");
        assert_eq!(deserialized.changed_files.len(), 2);
        assert_eq!(deserialized.change_summary.files_changed, 2);
        assert_eq!(deserialized.change_summary.lines_added, 15);
        assert_eq!(deserialized.change_summary.lines_removed, 3);
        assert!(deserialized.change_summary.has_staged);
        assert!(!deserialized.change_summary.has_unstaged);
        assert_eq!(deserialized.branch_info.current_branch, "feature-branch");
        assert_eq!(deserialized.branch_info.base_branch, "main");
        assert_eq!(deserialized.timestamp, 1234567890123);
    }

    #[test]
    fn test_change_summary_struct_creation() {
        let summary = ChangeSummary {
            files_changed: 5,
            lines_added: 100,
            lines_removed: 25,
            has_staged: true,
            has_unstaged: false,
        };

        assert_eq!(summary.files_changed, 5);
        assert_eq!(summary.lines_added, 100);
        assert_eq!(summary.lines_removed, 25);
        assert!(summary.has_staged);
        assert!(!summary.has_unstaged);
    }

    #[test]
    fn test_branch_info_struct_creation() {
        let branch_info = BranchInfo {
            current_branch: "feature-x".to_string(),
            base_branch: "main".to_string(),
            base_commit: "a1b2c3d4".to_string(),
            head_commit: "e5f6g7h8".to_string(),
        };

        assert_eq!(branch_info.current_branch, "feature-x");
        assert_eq!(branch_info.base_branch, "main");
        assert_eq!(branch_info.base_commit, "a1b2c3d4");
        assert_eq!(branch_info.head_commit, "e5f6g7h8");
    }

    #[tokio::test]
    async fn test_branch_info_extraction_success() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        let result = FileWatcher::get_branch_info(&repo_path, "main").await;
        assert!(
            result.is_ok(),
            "Should extract branch info successfully: {:?}",
            result.err()
        );

        let branch_info = result.unwrap();
        assert_eq!(branch_info.base_branch, "main");

        // Current branch should be either "main" or "HEAD" depending on git version
        assert!(
            branch_info.current_branch == "main"
                || branch_info.current_branch == "HEAD"
                || !branch_info.current_branch.is_empty()
        );

        assert!(
            !branch_info.base_commit.is_empty(),
            "Base commit should not be empty"
        );
        assert!(
            !branch_info.head_commit.is_empty(),
            "Head commit should not be empty"
        );

        // Base and head commits should be the same for a new repo
        assert_eq!(
            branch_info.base_commit, branch_info.head_commit,
            "In a new repo, base and head commits should be the same"
        );
    }

    #[tokio::test]
    async fn test_branch_info_extraction_with_feature_branch() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Create and switch to a feature branch
        Command::new("git")
            .args(["checkout", "-b", "feature-test"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to create feature branch");

        // Make a commit on the feature branch
        fs::write(repo_path.join("feature.txt"), "feature content").unwrap();
        Command::new("git")
            .args(["add", "feature.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage feature file");

        Command::new("git")
            .args(["commit", "-m", "Feature commit"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to commit feature");

        let result = FileWatcher::get_branch_info(&repo_path, "main").await;
        assert!(
            result.is_ok(),
            "Should extract branch info from feature branch"
        );

        let branch_info = result.unwrap();
        assert_eq!(branch_info.current_branch, "feature-test");
        assert_eq!(branch_info.base_branch, "main");
        assert!(!branch_info.base_commit.is_empty());
        assert!(!branch_info.head_commit.is_empty());

        // Base and head commits should be different now
        assert_ne!(
            branch_info.base_commit, branch_info.head_commit,
            "Base and head commits should differ when on feature branch with commits"
        );
    }

    #[tokio::test]
    async fn test_branch_info_extraction_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let non_repo_path = temp_dir.path().join("not-a-repo");

        fs::create_dir(&non_repo_path).unwrap();

        let result = FileWatcher::get_branch_info(&non_repo_path, "main").await;
        // The function might succeed even for non-git directories by using fallback values
        // What matters is that it doesn't panic and returns a valid result
        assert!(
            result.is_ok(),
            "Should handle non-git directory gracefully: {:?}",
            result.err()
        );
        let branch_info = result.unwrap();
        // In a non-git directory, it should use fallback values
        assert_eq!(branch_info.base_branch, "main");
        // Current branch might be "HEAD" as fallback
        assert!(branch_info.current_branch == "HEAD" || !branch_info.current_branch.is_empty());
    }

    #[tokio::test]
    async fn test_compute_change_summary_with_no_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        let changed_files: Vec<ChangedFile> = vec![];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "main").await;
        assert!(
            result.is_ok(),
            "Should compute summary with no changes: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 0);
        assert_eq!(summary.lines_added, 0);
        assert_eq!(summary.lines_removed, 0);
        assert!(!summary.has_staged);
        assert!(!summary.has_unstaged);
    }

    #[tokio::test]
    async fn test_compute_change_summary_with_staged_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Create a new file and stage it
        fs::write(
            repo_path.join("staged.txt"),
            "line 1\nline 2\nline 3\nline 4\nline 5",
        )
        .unwrap();

        Command::new("git")
            .args(["add", "staged.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage file");

        let changed_files = vec![ChangedFile {
            path: "staged.txt".to_string(),
            change_type: "added".to_string(),
        }];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should compute summary with staged changes: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 1);
        assert!(summary.has_staged);
        assert!(!summary.has_unstaged);
        assert!(
            summary.lines_added > 0,
            "Should have added lines, got: {}",
            summary.lines_added
        );
        assert_eq!(summary.lines_removed, 0);
    }

    #[tokio::test]
    async fn test_compute_change_summary_with_unstaged_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Modify existing file (creates unstaged changes)
        fs::write(
            repo_path.join("initial.txt"),
            "modified content\nline 2\nline 3",
        )
        .unwrap();

        let changed_files = vec![ChangedFile {
            path: "initial.txt".to_string(),
            change_type: "modified".to_string(),
        }];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should compute summary with unstaged changes: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 1);
        assert!(!summary.has_staged);
        assert!(summary.has_unstaged);
        // Lines added/removed depend on the actual diff
        // Note: These are unsigned integers so they're always >= 0
    }

    #[tokio::test]
    async fn test_compute_change_summary_with_mixed_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Create staged file
        fs::write(repo_path.join("staged.txt"), "staged content").unwrap();
        Command::new("git")
            .args(["add", "staged.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage file");

        // Create unstaged modification
        fs::write(repo_path.join("initial.txt"), "unstaged modification").unwrap();

        let changed_files = vec![
            ChangedFile {
                path: "staged.txt".to_string(),
                change_type: "added".to_string(),
            },
            ChangedFile {
                path: "initial.txt".to_string(),
                change_type: "modified".to_string(),
            },
        ];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should compute summary with mixed changes: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 2);
        assert!(summary.has_staged);
        assert!(summary.has_unstaged);
    }

    #[tokio::test]
    async fn test_compute_change_summary_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let non_repo_path = temp_dir.path().join("not-a-repo");
        fs::create_dir(&non_repo_path).unwrap();

        let changed_files = vec![ChangedFile {
            path: "test.txt".to_string(),
            change_type: "modified".to_string(),
        }];

        let result =
            FileWatcher::compute_change_summary(&changed_files, &non_repo_path, "main").await;
        // The function might succeed even for non-git directories, returning empty results
        // What matters is that it doesn't panic and returns a valid result
        assert!(
            result.is_ok(),
            "Should handle non-git directory gracefully: {:?}",
            result.err()
        );
        let summary = result.unwrap();
        // In a non-git directory, we should get 0 changes
        assert_eq!(summary.files_changed, 1); // Still counts the input files
        assert_eq!(summary.lines_added, 0);
        assert_eq!(summary.lines_removed, 0);
    }

    #[test]
    fn test_handle_file_changes_filters_ignored_paths() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Test the filtering logic separately with individual paths
        // .git/index should be allowed through (commit signal)
        assert!(!FileWatcher::should_ignore_path(
            &repo_path.join(".git/index")
        ));
        assert!(FileWatcher::should_ignore_path(
            &repo_path.join("node_modules/package.json")
        ));
        assert!(!FileWatcher::should_ignore_path(
            &repo_path.join("src/main.rs")
        ));
    }

    // Note: FileWatcherManager tests require a real Tauri AppHandle and are better
    // suited for integration tests rather than unit tests. The manager functionality
    // is tested indirectly through the FileWatcher tests.

    #[test]
    fn test_data_structure_sizes() {
        // Test that our data structures are reasonably sized
        let event = FileChangeEvent {
            session_name: "test".to_string(),
            changed_files: Vec::new(),
            change_summary: ChangeSummary {
                files_changed: 0,
                lines_added: 0,
                lines_removed: 0,
                has_staged: false,
                has_unstaged: false,
            },
            branch_info: BranchInfo {
                current_branch: "main".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abc123".to_string(),
                head_commit: "def456".to_string(),
            },
            timestamp: 1234567890,
        };

        // Serialize and check size is reasonable
        let json = serde_json::to_string(&event).unwrap();
        assert!(
            json.len() < 1000,
            "Serialized event should be reasonably small"
        );

        // Test with larger data
        let event_with_files = FileChangeEvent {
            session_name: "large-session".to_string(),
            changed_files: (0..100)
                .map(|i| ChangedFile {
                    path: format!("file{}.txt", i),
                    change_type: "modified".to_string(),
                })
                .collect(),
            change_summary: ChangeSummary {
                files_changed: 100,
                lines_added: 1000,
                lines_removed: 500,
                has_staged: true,
                has_unstaged: true,
            },
            branch_info: BranchInfo {
                current_branch: "feature-branch-with-long-name".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abcdef1234567890abcdef1234567890".to_string(),
                head_commit: "1234567890abcdef1234567890abcdef".to_string(),
            },
            timestamp: 1234567890123456789,
        };

        let json_large = serde_json::to_string(&event_with_files).unwrap();
        // Should handle larger data structures without issues
        assert!(
            json_large.len() > 1000,
            "Should handle larger data structures"
        );
    }

    #[test]
    fn test_edge_case_paths() {
        // Test various edge case paths
        assert!(!FileWatcher::should_ignore_path(Path::new("/")));
        assert!(!FileWatcher::should_ignore_path(Path::new("")));

        // Paths with special characters
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/with spaces/file.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/with-dashes/file.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/with_underscores/file.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/with.dots/file.rs"
        )));

        // Paths that contain ignore keywords but aren't exact matches
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/gitignore.txt"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/node_modules_old/file.js"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/target_folder/file.txt"
        )));

        // Very long paths
        let long_path = "/".repeat(200) + "/file.txt";
        assert!(!FileWatcher::should_ignore_path(Path::new(&long_path)));

        // Paths with unicode characters
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/🚀/file.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/тест/file.rs"
        )));
        assert!(!FileWatcher::should_ignore_path(Path::new(
            "/path/测试/file.rs"
        )));
    }

    #[tokio::test]
    async fn test_change_summary_with_deleted_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Delete a file
        fs::remove_file(repo_path.join("initial.txt")).unwrap();

        Command::new("git")
            .args(["add", "initial.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage deletion");

        let changed_files = vec![ChangedFile {
            path: "initial.txt".to_string(),
            change_type: "deleted".to_string(),
        }];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should handle deleted files: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 1);
        assert!(summary.has_staged);
        assert!(!summary.has_unstaged);
        // Lines removed should be at least 1 (the original content)
        assert!(summary.lines_removed >= 1);
    }

    #[tokio::test]
    async fn test_change_summary_with_renamed_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Rename a file using git mv
        Command::new("git")
            .args(["mv", "initial.txt", "renamed.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to rename file");

        let changed_files = vec![
            ChangedFile {
                path: "initial.txt".to_string(),
                change_type: "deleted".to_string(),
            },
            ChangedFile {
                path: "renamed.txt".to_string(),
                change_type: "added".to_string(),
            },
        ];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should handle renamed files: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 2); // Both delete and add are counted
        assert!(summary.has_staged);
        assert!(!summary.has_unstaged);
    }

    #[test]
    fn test_file_change_event_with_empty_files() {
        let event = FileChangeEvent {
            session_name: "test".to_string(),
            changed_files: vec![], // Empty file list
            change_summary: ChangeSummary {
                files_changed: 0,
                lines_added: 0,
                lines_removed: 0,
                has_staged: false,
                has_unstaged: false,
            },
            branch_info: BranchInfo {
                current_branch: "main".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abc123".to_string(),
                head_commit: "abc123".to_string(),
            },
            timestamp: 1234567890,
        };

        let json = serde_json::to_string(&event).unwrap();
        let parsed: FileChangeEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.changed_files.len(), 0);
        assert_eq!(parsed.change_summary.files_changed, 0);
    }

    #[test]
    fn test_file_change_event_with_many_files() {
        let changed_files: Vec<ChangedFile> = (0..1000)
            .map(|i| ChangedFile {
                path: format!("file{}.rs", i),
                change_type: if i % 2 == 0 {
                    "modified".to_string()
                } else {
                    "added".to_string()
                },
            })
            .collect();

        let event = FileChangeEvent {
            session_name: "large-session".to_string(),
            changed_files,
            change_summary: ChangeSummary {
                files_changed: 1000,
                lines_added: 50000,
                lines_removed: 25000,
                has_staged: true,
                has_unstaged: true,
            },
            branch_info: BranchInfo {
                current_branch: "main".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abc123".to_string(),
                head_commit: "def456".to_string(),
            },
            timestamp: 1234567890123,
        };

        let json = serde_json::to_string(&event).unwrap();
        let parsed: FileChangeEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.changed_files.len(), 1000);
        assert_eq!(parsed.change_summary.files_changed, 1000);

        // Verify file types are preserved
        let modified_count = parsed
            .changed_files
            .iter()
            .filter(|f| f.change_type == "modified")
            .count();
        let added_count = parsed
            .changed_files
            .iter()
            .filter(|f| f.change_type == "added")
            .count();
        assert_eq!(modified_count, 500);
        assert_eq!(added_count, 500);
    }

    #[tokio::test]
    async fn test_compute_change_summary_with_binary_files() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);

        // Create a binary file (simulate with non-UTF8 content)
        let binary_content = vec![0u8, 1, 2, 255, 254, 253];
        fs::write(repo_path.join("binary.bin"), binary_content).unwrap();

        Command::new("git")
            .args(["add", "binary.bin"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage binary file");

        let changed_files = vec![ChangedFile {
            path: "binary.bin".to_string(),
            change_type: "added".to_string(),
        }];

        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(
            result.is_ok(),
            "Should handle binary files: {:?}",
            result.err()
        );

        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 1);
        assert!(summary.has_staged);
        // Binary files typically show as "-" in git diff --numstat
        // So lines_added and lines_removed might be 0
    }

    #[test]
    fn test_timestamp_generation() {
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        std::thread::sleep(Duration::from_millis(10));

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        std::thread::sleep(Duration::from_millis(10));

        let after = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        assert!(
            timestamp >= before,
            "Timestamp should be after 'before' time"
        );
        assert!(
            timestamp <= after,
            "Timestamp should be before 'after' time"
        );
        assert!(
            timestamp > 1609459200000,
            "Timestamp should be reasonable (after 2021)"
        );
    }

    #[test]
    fn test_change_summary_default_values() {
        let summary = ChangeSummary {
            files_changed: 0,
            lines_added: 0,
            lines_removed: 0,
            has_staged: false,
            has_unstaged: false,
        };

        // Test that default values are correct
        assert_eq!(summary.files_changed, 0);
        assert_eq!(summary.lines_added, 0);
        assert_eq!(summary.lines_removed, 0);
        assert!(!summary.has_staged);
        assert!(!summary.has_unstaged);
    }

    #[test]
    fn test_branch_info_default_values() {
        let branch_info = BranchInfo {
            current_branch: "HEAD".to_string(),
            base_branch: "main".to_string(),
            base_commit: "0000000000000000000000000000000000000000".to_string(),
            head_commit: "0000000000000000000000000000000000000000".to_string(),
        };

        assert_eq!(branch_info.current_branch, "HEAD");
        assert_eq!(branch_info.base_branch, "main");
        assert!(branch_info.base_commit.len() == 40); // SHA-1 hash length
        assert!(branch_info.head_commit.len() == 40);
    }
}

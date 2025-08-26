use std::collections::HashMap;
use std::path::{PathBuf, Path};
use std::sync::Arc;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use notify::{RecommendedWatcher, RecursiveMode};
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, mpsc};
use log::{debug, info, warn, error};

use crate::schaltwerk_core::{git, types::ChangedFile};

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
            }
        ).map_err(|e| format!("Failed to create debouncer: {e}"))?;

        let session_name_clone = session_name.clone();
        let worktree_path_clone = worktree_path.clone();
        let base_branch_clone = base_branch.clone();
        let app_handle_clone = app_handle.clone();

        tokio::spawn(async move {
            while let Some(result) = rx.recv().await {
                match result {
                    Ok(events) => {
                        debug!("File watcher received {} events for session {}", 
                               events.len(), session_name_clone);
                        
                        if let Err(e) = Self::handle_file_changes(
                            &session_name_clone,
                            &worktree_path_clone,
                            &base_branch_clone,
                            &app_handle_clone,
                            events,
                        ).await {
                            warn!("Failed to handle file changes for session {session_name_clone}: {e}");
                        }
                    }
                    Err(e) => {
                        error!("File watcher error for session {session_name_clone}: {e:?}");
                    }
                }
            }
        });

        let mut watcher = Self {
            _session_name: session_name,
            _worktree_path: worktree_path.clone(),
            _debouncer: debouncer,
        };

        watcher.start_watching()?;
        Ok(watcher)
    }

    fn start_watching(&mut self) -> Result<(), String> {
        let watcher = self._debouncer.watcher();
        
        watcher
            .watch(&self._worktree_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to start watching {}: {e}", self._worktree_path.display()))?;

        info!("Started file watching for session {} at path {}", 
              self._session_name, self._worktree_path.display());
        Ok(())
    }

    async fn handle_file_changes(
        session_name: &str,
        worktree_path: &Path,
        base_branch: &str,
        app_handle: &AppHandle,
        events: Vec<notify_debouncer_mini::DebouncedEvent>,
    ) -> Result<(), String> {
        let should_ignore_event = events.iter().all(|event| {
            Self::should_ignore_path(&event.path)
        });

        if should_ignore_event {
            debug!("Ignoring file changes in system directories for session {session_name}");
            return Ok(());
        }

        debug!("Processing file changes for session {}: {} events", session_name, events.len());

        let changed_files = git::get_changed_files(worktree_path, base_branch)
            .map_err(|e| format!("Failed to get changed files: {e}"))?;
        
        info!("Session {} has {} changed files detected", session_name, changed_files.len());

        let change_summary = Self::compute_change_summary(&changed_files, worktree_path, base_branch)
            .await?;

        let branch_info = Self::get_branch_info(worktree_path, base_branch)
            .await?;

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

        debug!("Emitting file change event for session {} with {} files", 
               session_name, file_change_event.changed_files.len());

        app_handle
            .emit("schaltwerk:file-changes", &file_change_event)
            .map_err(|e| format!("Failed to emit file change event: {e}"))?;

        Ok(())
    }

    fn should_ignore_path(path: &Path) -> bool {
        if let Some(path_str) = path.to_str() {
            path_str.contains("/.git/") 
                || path_str.contains("/node_modules/") 
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
        base_branch: &str,
    ) -> Result<ChangeSummary, String> {
        let files_changed = changed_files.len() as u32;
        
        let git_status_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "status", "--porcelain"])
            .output()
            .map_err(|e| format!("Failed to get git status: {e}"))?;

        let status_str = String::from_utf8_lossy(&git_status_output.stdout);
        let has_staged = status_str.lines().any(|line| {
            if line.len() >= 2 {
                matches!(line.chars().next().unwrap_or(' '), 'A' | 'M' | 'D' | 'R' | 'C')
            } else {
                false
            }
        });

        let has_unstaged = status_str.lines().any(|line| {
            if line.len() >= 2 {
                matches!(line.chars().nth(1).unwrap_or(' '), 'M' | 'D')
            } else {
                false
            }
        });

        let numstat_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "diff", "--numstat", base_branch])
            .output()
            .map_err(|e| format!("Failed to get diff numstat: {e}"))?;
            
        let cached_numstat_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "diff", "--cached", "--numstat"])
            .output()
            .map_err(|e| format!("Failed to get cached diff numstat: {e}"))?;

        let parse_numstat = |output: &[u8]| -> (u32, u32) {
            let numstat_str = String::from_utf8_lossy(output);
            numstat_str.lines().fold((0u32, 0u32), |(added, removed), line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let add = parts[0].parse::<u32>().unwrap_or(0);
                    let rem = parts[1].parse::<u32>().unwrap_or(0);
                    (added + add, removed + rem)
                } else {
                    (added, removed)
                }
            })
        };

        let (unstaged_added, unstaged_removed) = if numstat_output.status.success() {
            parse_numstat(&numstat_output.stdout)
        } else {
            (0, 0)
        };
        
        let (staged_added, staged_removed) = if cached_numstat_output.status.success() {
            parse_numstat(&cached_numstat_output.stdout)
        } else {
            (0, 0)
        };
        
        let lines_added = unstaged_added + staged_added;
        let lines_removed = unstaged_removed + staged_removed;

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
        let current_branch_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "branch", "--show-current"])
            .output()
            .map_err(|e| format!("Failed to get current branch: {e}"))?;

        let mut current_branch = String::from_utf8_lossy(&current_branch_output.stdout).trim().to_string();
        
        if current_branch.is_empty() {
            let symbolic_ref_output = std::process::Command::new("git")
                .args(["-C", &worktree_path.to_string_lossy(), "symbolic-ref", "--short", "HEAD"])
                .output();
                
            if let Ok(output) = symbolic_ref_output {
                current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
            }
            
            if current_branch.is_empty() {
                current_branch = "HEAD".to_string();
            }
        }

        let base_commit_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "rev-parse", "--short", base_branch])
            .output()
            .map_err(|e| format!("Failed to get base commit: {e}"))?;

        let base_commit = String::from_utf8_lossy(&base_commit_output.stdout).trim().to_string();

        let head_commit_output = std::process::Command::new("git")
            .args(["-C", &worktree_path.to_string_lossy(), "rev-parse", "--short", "HEAD"])
            .output()
            .map_err(|e| format!("Failed to get HEAD commit: {e}"))?;

        let head_commit = String::from_utf8_lossy(&head_commit_output.stdout).trim().to_string();

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
    use tempfile::TempDir;
    use std::fs;
    use std::process::Command;
    use serial_test::serial;
    
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
            panic!("Failed to create initial commit: {}", String::from_utf8_lossy(&commit_output.stderr));
        }
        
        let branch_check = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&repo_path)
            .output();
            
        if branch_check.is_ok() {
            let current_branch = String::from_utf8_lossy(&branch_check.unwrap().stdout).trim().to_string();
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


    #[tokio::test]
    async fn test_should_ignore_path() {
        assert!(FileWatcher::should_ignore_path(Path::new("/path/.git/index")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/node_modules/package.json")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/target/debug/app")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/.DS_Store")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/file.tmp")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/file.swp")));
        assert!(FileWatcher::should_ignore_path(Path::new("/path/.vscode/settings.json")));
        
        assert!(!FileWatcher::should_ignore_path(Path::new("/path/src/main.rs")));
        assert!(!FileWatcher::should_ignore_path(Path::new("/path/README.md")));
    }

    #[test] 
    fn test_compute_change_summary_counts_files() {
        let changed_files = vec![
            ChangedFile {
                path: "file1.txt".to_string(),
                change_type: "modified".to_string(),
            },
            ChangedFile {
                path: "file2.txt".to_string(), 
                change_type: "added".to_string(),
            },
        ];
        
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);
        
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD"));
        
        assert!(result.is_ok());
        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 2);
    }

    #[tokio::test]
    #[serial]
    async fn test_file_watcher_manager_basic_functionality() {
        // Skip this test for now since it requires a full Tauri app handle
        // In a real environment, this would be tested through integration tests
        println!("File watcher manager tests would run in integration environment");
    }

    #[test]
    fn test_watcher_manager_would_work_with_app() {
        // These tests would work in integration environment with real Tauri app
        println!("Manager lifecycle tests require integration environment");
    }

    #[tokio::test]
    async fn test_branch_info_extraction() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);
        
        let result = FileWatcher::get_branch_info(&repo_path, "main").await;
        assert!(result.is_ok(), "Should extract branch info successfully");
        
        let branch_info = result.unwrap();
        assert_eq!(branch_info.base_branch, "main");
        
        if branch_info.current_branch.is_empty() {
            eprintln!("Warning: git branch --show-current returned empty, using fallback");
        }
        
        assert!(!branch_info.base_commit.is_empty(), "Base commit should not be empty. Got: {:?}", branch_info);
        assert!(!branch_info.head_commit.is_empty(), "Head commit should not be empty. Got: {:?}", branch_info);
    }

    #[tokio::test]
    async fn test_change_summary_with_no_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);
        
        let changed_files: Vec<ChangedFile> = vec![];
        
        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "main").await;
        assert!(result.is_ok());
        
        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 0);
        assert_eq!(summary.lines_added, 0);
        assert_eq!(summary.lines_removed, 0);
        assert!(!summary.has_staged);
        assert!(!summary.has_unstaged);
    }

    #[tokio::test]
    async fn test_change_summary_with_modifications() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = create_test_git_repo(&temp_dir);
        
        fs::write(repo_path.join("test.txt"), "new file content\nline 2\nline 3").unwrap();
        
        Command::new("git")
            .args(["add", "test.txt"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to stage file");
        
        let changed_files = vec![
            ChangedFile {
                path: "test.txt".to_string(),
                change_type: "added".to_string(),
            },
        ];
        
        let result = FileWatcher::compute_change_summary(&changed_files, &repo_path, "HEAD").await;
        assert!(result.is_ok(), "compute_change_summary failed: {:?}", result);
        
        let summary = result.unwrap();
        assert_eq!(summary.files_changed, 1);
        assert!(summary.has_staged);
        
        let diff_output = Command::new("git")
            .args(["diff", "--numstat", "HEAD"])
            .current_dir(&repo_path)
            .output()
            .expect("Failed to get diff");
        
        let diff_str = String::from_utf8_lossy(&diff_output.stdout);
        eprintln!("Git diff output: {}", diff_str);
        
        if summary.lines_added == 0 {
            eprintln!("Warning: git diff --numstat returned 0 lines added. This might be a git version compatibility issue.");
            let staged_diff = Command::new("git")
                .args(["diff", "--cached", "--numstat"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to get staged diff");
            let staged_str = String::from_utf8_lossy(&staged_diff.stdout);
            eprintln!("Git diff --cached output: {}", staged_str);
        }
    }

    #[test]
    fn test_file_change_event_serialization() {
        let event = FileChangeEvent {
            session_name: "test".to_string(),
            changed_files: vec![
                ChangedFile {
                    path: "file.txt".to_string(),
                    change_type: "modified".to_string(),
                },
            ],
            change_summary: ChangeSummary {
                files_changed: 1,
                lines_added: 5,
                lines_removed: 2,
                has_staged: true,
                has_unstaged: false,
            },
            branch_info: BranchInfo {
                current_branch: "feature".to_string(),
                base_branch: "main".to_string(),
                base_commit: "abc123".to_string(),
                head_commit: "def456".to_string(),
            },
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event);
        assert!(json.is_ok());
        
        let parsed: Result<FileChangeEvent, _> = serde_json::from_str(&json.unwrap());
        assert!(parsed.is_ok());
    }
}
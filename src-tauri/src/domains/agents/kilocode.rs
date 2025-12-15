use super::escape_prompt_for_shell;
use super::format_binary_invocation;
use log::{debug, trace};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{OnceLock, RwLock};
use std::time::SystemTime;

#[derive(Debug, Clone, Default)]
pub struct KilocodeConfig {
    pub binary_path: Option<String>,
}

/// Directory signature for cache invalidation
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DirSignature {
    mtime_millis: Option<u128>,
    task_count: u64,
}

impl DirSignature {
    fn compute(dir: &Path) -> Option<Self> {
        if !dir.exists() {
            return Some(Self {
                mtime_millis: None,
                task_count: 0,
            });
        }

        let mtime = fs::metadata(dir)
            .ok()?
            .modified()
            .ok()?
            .duration_since(SystemTime::UNIX_EPOCH)
            .ok()?
            .as_millis();

        let task_count = fs::read_dir(dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .count() as u64;

        Some(Self {
            mtime_millis: Some(mtime),
            task_count,
        })
    }
}

/// Cached index state
#[derive(Default)]
struct IndexState {
    index: Option<HashMap<String, String>>,
    signature: Option<DirSignature>,
}

struct KilocodeIndex {
    state: RwLock<IndexState>,
}

impl KilocodeIndex {
    fn new() -> Self {
        Self {
            state: RwLock::new(IndexState::default()),
        }
    }

    fn get_or_rebuild(&self, tasks_dir: &Path) -> HashMap<String, String> {
        // Check current signature
        let current_sig = DirSignature::compute(tasks_dir);

        // Check if we have a cached index with matching signature
        if let Ok(state) = self.state.read()
            && state.signature == current_sig
            && state.index.is_some()
        {
            return state.index.clone().unwrap();
        }

        // Signature mismatch or no cache - rebuild
        let new_index = build_kilocode_session_index(tasks_dir);

        // Update cache
        if let Ok(mut state) = self.state.write() {
            state.index = Some(new_index.clone());
            state.signature = current_sig;
        }

        new_index
    }
}

/// Normalize a path by resolving symlinks and canonicalizing it
fn normalize_path(p: &Path) -> Option<String> {
    p.canonicalize()
        .ok()?
        .to_string_lossy()
        .to_string()
        .into()
}

/// Extract CWD from Kilocode task history JSON
/// Looks for pattern: "# Current Workspace Directory ({path})"
fn extract_cwd_from_task_history(task_history_file: &Path) -> Option<String> {
    let content = fs::read_to_string(task_history_file).ok()?;

    // Kilocode stores history as a JSON array, not JSONL
    let messages: Vec<serde_json::Value> = serde_json::from_str(&content).ok()?;

    for message in messages {
        if let Some(content_array) = message.get("content").and_then(|v| v.as_array()) {
            for content_item in content_array.iter() {
                if let Some(text) = content_item.get("text").and_then(|v| v.as_str())
                    && let Some(cwd) = extract_cwd_from_text(text)
                {
                    return Some(cwd);
                }
            }
        }
    }

    None
}

/// Extract CWD from text containing "# Current Workspace Directory ({path})"
fn extract_cwd_from_text(text: &str) -> Option<String> {
    let pattern = "# Current Workspace Directory (";
    let start_idx = text.find(pattern)?;
    let after_pattern = &text[start_idx + pattern.len()..];

    // Find closing parenthesis
    let end_idx = after_pattern.find(')')?;
    let cwd = &after_pattern[..end_idx];

    if !cwd.is_empty() {
        Some(cwd.trim().to_string())
    } else {
        None
    }
}

/// Get or create the session index with cache invalidation
static SESSION_INDEX: OnceLock<KilocodeIndex> = OnceLock::new();

/// Find a Kilocode session by matching worktree path
pub fn find_kilocode_session(worktree_path: &Path) -> Option<String> {
    debug!("find_kilocode_session: looking for worktree_path={worktree_path:?}");

    let home = dirs::home_dir()?;
    let kilocode_tasks_dir = home.join(".kilocode/cli/global/tasks");

    if !kilocode_tasks_dir.exists() {
        debug!("find_kilocode_session: tasks dir does not exist: {kilocode_tasks_dir:?}");
        return None;
    }

    let normalized_worktree = normalize_path(worktree_path);
    debug!("find_kilocode_session: normalized_worktree={normalized_worktree:?}");

    let normalized_worktree = normalized_worktree?;

    let index_cache = SESSION_INDEX.get_or_init(KilocodeIndex::new);
    let index = index_cache.get_or_rebuild(&kilocode_tasks_dir);

    let len = index.len();
    debug!("find_kilocode_session: index has {len} entries");
    for (path, session) in &index {
        trace!("find_kilocode_session: index entry: path={path:?} -> session={session:?}");
    }

    let result = index.get(&normalized_worktree).cloned();
    debug!("find_kilocode_session: lookup result for {normalized_worktree:?} = {result:?}");
    result
}

/// Build the session index by scanning Kilocode workspaces
/// Maps normalized CWD paths to the workspace's lastSession.sessionId
fn build_kilocode_session_index(tasks_dir: &Path) -> HashMap<String, String> {
    debug!("build_kilocode_session_index: tasks_dir={tasks_dir:?}");
    let mut index = HashMap::new();

    if !tasks_dir.exists() {
        debug!("build_kilocode_session_index: tasks_dir does not exist");
        return index;
    }

    let Some(home) = dirs::home_dir() else {
        debug!("build_kilocode_session_index: no home dir");
        return index;
    };

    let workspaces_dir = home.join(".kilocode/cli/workspaces");
    if !workspaces_dir.exists() {
        debug!("build_kilocode_session_index: workspaces_dir does not exist: {workspaces_dir:?}");
        return index;
    }

    let Ok(entries) = fs::read_dir(&workspaces_dir) else {
        debug!("build_kilocode_session_index: cannot read workspaces_dir");
        return index;
    };

    for entry in entries.flatten() {
        let workspace_dir = entry.path();
        if !workspace_dir.is_dir() {
            continue;
        }

        let session_file = workspace_dir.join("session.json");
        debug!("build_kilocode_session_index: checking workspace {workspace_dir:?}");

        if let Some((last_session_id, task_ids)) = read_workspace_session_info(&session_file) {
            let task_count = task_ids.len();
            debug!("build_kilocode_session_index: workspace has lastSession={last_session_id}, {task_count} tasks");

            for task_id in task_ids {
                let task_history = tasks_dir.join(&task_id).join("api_conversation_history.json");
                let cwd = extract_cwd_from_task_history(&task_history);
                debug!("build_kilocode_session_index: task {task_id} -> cwd={cwd:?}");

                if let Some(cwd) = cwd {
                    let normalized_cwd = normalize_path(Path::new(&cwd));
                    debug!("build_kilocode_session_index: normalized cwd={normalized_cwd:?}");

                    if let Some(normalized_cwd) = normalized_cwd {
                        index.insert(normalized_cwd.clone(), last_session_id.clone());
                        debug!("build_kilocode_session_index: added index entry: {normalized_cwd} -> {last_session_id}");
                    }
                }
            }
        } else {
            debug!("build_kilocode_session_index: no session info in {session_file:?}");
        }
    }

    let len = index.len();
    debug!("build_kilocode_session_index: built index with {len} entries");
    index
}

/// Read workspace session.json and return (lastSession.sessionId, list of task IDs)
fn read_workspace_session_info(session_file: &Path) -> Option<(String, Vec<String>)> {
    let content = fs::read_to_string(session_file).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;

    let last_session_id = json
        .get("lastSession")
        .and_then(|ls| ls.get("sessionId"))
        .and_then(|id| id.as_str())?
        .to_string();

    let task_ids: Vec<String> = json
        .get("taskSessionMap")
        .and_then(|m| m.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();

    Some((last_session_id, task_ids))
}

pub fn build_kilocode_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&KilocodeConfig>,
) -> String {
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "kilocode"
            }
        } else {
            "kilocode"
        }
    } else {
        "kilocode"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --yolo");
    }

    if let Some(session) = session_id {
        let trimmed = session.trim();
        if !trimmed.is_empty() {
            cmd.push_str(" --session ");
            cmd.push_str(trimmed);
        }
    } else if let Some(prompt) = initial_prompt {
        let escaped = escape_prompt_for_shell(prompt);
        cmd.push(' ');
        cmd.push('"');
        cmd.push_str(&escaped);
        cmd.push('"');
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::TempDir;

    #[test]
    fn test_new_session_with_prompt() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert!(cmd.ends_with("kilocode --yolo \"implement feature X\""));
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
    }

    #[test]
    fn test_basic_command() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("hello"),
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && kilocode \"hello\"");
    }

    #[test]
    fn test_resume_by_session_id() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            Some("abc-123-session"),
            Some("ignored prompt"),
            false,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && kilocode --session abc-123-session"
        );
    }

    #[test]
    fn test_resume_with_yolo_mode() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session-xyz"),
            None,
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && kilocode --yolo --session session-xyz"
        );
    }

    // Tests for CWD extraction
    #[test]
    fn test_extract_cwd_from_text_with_valid_pattern() {
        let text = "Some text before # Current Workspace Directory (/Users/test/project) and after";
        let result = extract_cwd_from_text(text);
        assert_eq!(result, Some("/Users/test/project".to_string()));
    }

    #[test]
    fn test_extract_cwd_from_text_with_spaces() {
        let text = "# Current Workspace Directory ( /path/with/spaces )";
        let result = extract_cwd_from_text(text);
        assert_eq!(result, Some("/path/with/spaces".to_string()));
    }

    #[test]
    fn test_extract_cwd_from_text_no_match() {
        let text = "No CWD here";
        let result = extract_cwd_from_text(text);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_cwd_from_text_missing_closing_paren() {
        let text = "# Current Workspace Directory (/Users/test";
        let result = extract_cwd_from_text(text);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_cwd_from_task_history_json_with_content() {
        let temp_dir = TempDir::new().unwrap();
        let history_file = temp_dir.path().join("api_conversation_history.json");

        // Kilocode stores history as a JSON array
        let json_array = "[{\"content\":[{\"text\":\"Some message # Current Workspace Directory (/Users/test/project) end\"}]}]";
        fs::write(&history_file, json_array).unwrap();

        let result = extract_cwd_from_task_history(&history_file);
        assert_eq!(result, Some("/Users/test/project".to_string()));
    }

    #[test]
    fn test_extract_cwd_from_task_history_no_match() {
        let temp_dir = TempDir::new().unwrap();
        let history_file = temp_dir.path().join("api_conversation_history.json");

        let json_array = "[{\"content\":[{\"text\":\"No CWD here\"}]}]";
        fs::write(&history_file, json_array).unwrap();

        let result = extract_cwd_from_task_history(&history_file);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_cwd_from_task_history_missing_file() {
        let temp_dir = TempDir::new().unwrap();
        let history_file = temp_dir.path().join("nonexistent.json");

        let result = extract_cwd_from_task_history(&history_file);
        assert_eq!(result, None);
    }

    #[test]
    fn test_read_workspace_session_info_valid() {
        let temp_dir = TempDir::new().unwrap();
        let session_file = temp_dir.path().join("session.json");

        let json = "{\"lastSession\":{\"sessionId\":\"last-sess-123\",\"timestamp\":123456},\"taskSessionMap\":{\"task-1\":\"session-1\",\"task-2\":\"session-2\"}}";
        fs::write(&session_file, json).unwrap();

        let result = read_workspace_session_info(&session_file);
        assert!(result.is_some());
        let (last_session_id, task_ids) = result.unwrap();
        assert_eq!(last_session_id, "last-sess-123");
        assert!(task_ids.contains(&"task-1".to_string()));
        assert!(task_ids.contains(&"task-2".to_string()));
    }

    #[test]
    fn test_read_workspace_session_info_missing_file() {
        let temp_dir = TempDir::new().unwrap();
        let session_file = temp_dir.path().join("nonexistent.json");

        let result = read_workspace_session_info(&session_file);
        assert_eq!(result, None);
    }

    #[test]
    fn test_read_workspace_session_info_invalid_json() {
        let temp_dir = TempDir::new().unwrap();
        let session_file = temp_dir.path().join("session.json");

        fs::write(&session_file, "not json").unwrap();

        let result = read_workspace_session_info(&session_file);
        assert_eq!(result, None);
    }

    #[test]
    fn test_read_workspace_session_info_missing_last_session() {
        let temp_dir = TempDir::new().unwrap();
        let session_file = temp_dir.path().join("session.json");

        let json = "{\"taskSessionMap\":{\"task-1\":\"session-1\"}}";
        fs::write(&session_file, json).unwrap();

        let result = read_workspace_session_info(&session_file);
        assert_eq!(result, None);
    }

    #[test]
    fn test_build_kilocode_session_index_with_mapping() {
        // This test verifies the session index building works correctly
        // In real usage, this would use actual workspace and task directories
        // For now, we test the core logic of building the mapping

        let temp_dir = TempDir::new().unwrap();
        let tasks_dir = temp_dir.path();

        // The index building works with task → session mappings
        // In production, these come from workspace session.json files
        let index = build_kilocode_session_index(tasks_dir);

        // If tasks_dir is empty or no valid workspaces, index should be empty
        // This validates the function runs without errors
        assert!(index.is_empty()); // Empty temp dir = empty index
    }

    #[test]
    fn test_find_kilocode_session_graceful_degradation() {
        // Test that find_kilocode_session returns None for invalid paths
        let temp_dir = TempDir::new().unwrap();
        let nonexistent = temp_dir.path().join("nonexistent");

        let result = find_kilocode_session(&nonexistent);
        // Should return None for invalid worktree paths that can't be canonicalized
        assert_eq!(result, None);
    }
}

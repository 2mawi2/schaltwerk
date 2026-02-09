use super::escape_prompt_for_shell;
use super::format_binary_invocation;
use log::debug;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

#[cfg(not(test))]
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};

#[derive(Debug, Clone, Default)]
pub struct KilocodeConfig {
    pub binary_path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct DirSignature {
    root_millis: Option<u128>,
    dir_count: u64,
    latest_dir_millis: Option<u128>,
    latest_file_millis: Option<u128>,
    file_count: u64,
}

impl DirSignature {
    fn compute_tasks(tasks_dir: &Path) -> Option<Self> {
        if !tasks_dir.exists() {
            return Some(Self::default());
        }

        let root_millis = fs::metadata(tasks_dir)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|ts| ts.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis());

        let mut dir_count: u64 = 0;
        let mut latest_dir_millis: Option<u128> = None;
        let mut latest_file_millis: Option<u128> = None;
        let mut file_count: u64 = 0;

        let read_dir = fs::read_dir(tasks_dir).ok()?;
        for entry in read_dir.flatten() {
            let task_dir = entry.path();
            if !task_dir.is_dir() {
                continue;
            }
            dir_count += 1;

            if let Ok(meta) = entry.metadata()
                && let Ok(modified) = meta.modified()
                && let Ok(millis) = modified.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis())
                && latest_dir_millis
                    .map(|current| millis > current)
                    .unwrap_or(true)
            {
                latest_dir_millis = Some(millis);
            }

            let history_path = task_dir.join("api_conversation_history.json");
            if let Ok(meta) = fs::metadata(&history_path)
                && let Ok(modified) = meta.modified()
                && let Ok(millis) = modified.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis())
            {
                file_count += 1;
                if latest_file_millis
                    .map(|current| millis > current)
                    .unwrap_or(true)
                {
                    latest_file_millis = Some(millis);
                }
            }
        }

        Some(Self {
            root_millis,
            dir_count,
            latest_dir_millis,
            latest_file_millis,
            file_count,
        })
    }

    fn compute_workspaces(workspaces_dir: &Path) -> Option<Self> {
        if !workspaces_dir.exists() {
            return Some(Self::default());
        }

        let root_millis = fs::metadata(workspaces_dir)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|ts| ts.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis());

        let mut dir_count: u64 = 0;
        let mut latest_dir_millis: Option<u128> = None;
        let mut latest_file_millis: Option<u128> = None;
        let mut file_count: u64 = 0;

        let read_dir = fs::read_dir(workspaces_dir).ok()?;
        for entry in read_dir.flatten() {
            let workspace_dir = entry.path();
            if !workspace_dir.is_dir() {
                continue;
            }
            dir_count += 1;

            if let Ok(meta) = entry.metadata()
                && let Ok(modified) = meta.modified()
                && let Ok(millis) = modified.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis())
                && latest_dir_millis
                    .map(|current| millis > current)
                    .unwrap_or(true)
            {
                latest_dir_millis = Some(millis);
            }

            let session_path = workspace_dir.join("session.json");
            if let Ok(meta) = fs::metadata(&session_path)
                && let Ok(modified) = meta.modified()
                && let Ok(millis) = modified.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis())
            {
                file_count += 1;
                if latest_file_millis
                    .map(|current| millis > current)
                    .unwrap_or(true)
                {
                    latest_file_millis = Some(millis);
                }
            }
        }

        Some(Self {
            root_millis,
            dir_count,
            latest_dir_millis,
            latest_file_millis,
            file_count,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct IndexSignature {
    tasks: DirSignature,
    workspaces: DirSignature,
}

impl IndexSignature {
    fn compute(tasks_dir: &Path, workspaces_dir: &Path) -> Option<Self> {
        Some(Self {
            tasks: DirSignature::compute_tasks(tasks_dir)?,
            workspaces: DirSignature::compute_workspaces(workspaces_dir)?,
        })
    }
}

/// Cached index state
#[derive(Default)]
struct IndexState {
    index: Option<HashMap<String, String>>,
    signature: Option<IndexSignature>,
    task_cache: HashMap<PathBuf, CachedTaskEntry>,
    disk_cache_loaded: bool,
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

    fn get_or_rebuild(&self, tasks_dir: &Path, workspaces_dir: &Path) -> HashMap<String, String> {
        if *DISABLE_INDEXING {
            debug!(
                "KiloCode session indexing disabled via SCHALTWERK_DISABLE_KILOCODE_INDEX, skipping lookup"
            );
            self.clear();
            return HashMap::new();
        }

        let (current_sig, signature_valid) =
            if let Some(sig) = IndexSignature::compute(tasks_dir, workspaces_dir) {
                (Some(sig), true)
            } else {
                (None, false)
            };

        let needs_refresh = !signature_valid;

        if !needs_refresh
            && let Ok(state) = self.state.read()
            && state.signature == current_sig
            && state.index.is_some()
        {
            return state.index.clone().unwrap_or_default();
        }

        let mut state = self.state.write().unwrap();

        if !needs_refresh && state.signature == current_sig && state.index.is_some() {
            return state.index.clone().unwrap_or_default();
        }

        if !state.disk_cache_loaded {
            state.task_cache = load_disk_cache(tasks_dir);
            state.disk_cache_loaded = true;
        }

        let start = Instant::now();
        let (new_index, next_cache, stats) =
            build_kilocode_session_index(tasks_dir, workspaces_dir, &state.task_cache);
        let elapsed = start.elapsed();

        if stats.scanned_files > 0 {
            let level = if elapsed > Duration::from_millis(100) {
                log::Level::Info
            } else {
                log::Level::Debug
            };
            log::log!(
                level,
                "KiloCode session index refresh scanned {} tasks in {}ms (cache hits: {}, misses: {}, skipped: {})",
                stats.scanned_files,
                elapsed.as_millis(),
                stats.cached_hits,
                stats.cache_misses,
                stats.skipped_files
            );
            if stats.scanned_files > 5000 {
                log::warn!(
                    "KiloCode session index touched {} tasks; consider pruning old tasks if startup remains slow",
                    stats.scanned_files
                );
            }
        }

        let should_persist = stats.cache_misses > 0
            || stats.skipped_files > 0
            || next_cache.len() != state.task_cache.len();
        if should_persist {
            persist_disk_cache(tasks_dir, &next_cache);
        }

        state.index = Some(new_index.clone());
        if signature_valid {
            state.signature = current_sig;
        } else {
            state.signature = None;
        }
        state.task_cache = next_cache;

        new_index
    }

    fn clear(&self) {
        if let Ok(mut state) = self.state.write() {
            state.index = None;
            state.signature = None;
            state.task_cache.clear();
            state.disk_cache_loaded = false;
        }
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
    extract_cwd_from_task_history_fast(task_history_file).or_else(|| {
        // Fallback for unexpected history formats.
        let content = fs::read_to_string(task_history_file).ok()?;
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
    })
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

fn extract_cwd_from_task_history_fast(task_history_file: &Path) -> Option<String> {
    bump_task_history_reads();

    const PATTERN: &[u8] = b"# Current Workspace Directory (";
    const MAX_CAPTURE_BYTES: usize = 4096;

    let file = fs::File::open(task_history_file).ok()?;
    let mut reader = BufReader::new(file);

    let mut buf = [0u8; 8192];
    let mut matched: usize = 0;
    let mut capture: Vec<u8> = Vec::new();
    let mut capturing = false;

    loop {
        let n = reader.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }

        for &b in &buf[..n] {
            if capturing {
                if b == b')' {
                    let cwd = String::from_utf8_lossy(&capture).trim().to_string();
                    return if cwd.is_empty() { None } else { Some(cwd) };
                }

                if capture.len() >= MAX_CAPTURE_BYTES {
                    // Avoid unbounded growth if the file is corrupt/unexpected.
                    capture.clear();
                    capturing = false;
                    matched = 0;
                    continue;
                }

                capture.push(b);
                continue;
            }

            if b == PATTERN[matched] {
                matched += 1;
                if matched == PATTERN.len() {
                    capturing = true;
                    capture.clear();
                    matched = 0;
                }
                continue;
            }

            matched = if b == PATTERN[0] { 1 } else { 0 };
        }
    }

    None
}

/// Get or create the session index with cache invalidation
#[cfg(not(test))]
static SESSION_INDEX: OnceLock<KilocodeIndex> = OnceLock::new();

/// Find a Kilocode session by matching worktree path
fn find_kilocode_session_with_index(
    worktree_path: &Path,
    index_cache: &KilocodeIndex,
) -> Option<String> {
    debug!("find_kilocode_session: looking for worktree_path={worktree_path:?}");

    let home = dirs::home_dir()?;
    let kilocode_tasks_dir = home.join(".kilocode/cli/global/tasks");
    let kilocode_workspaces_dir = home.join(".kilocode/cli/workspaces");

    if !kilocode_tasks_dir.exists() {
        debug!("find_kilocode_session: tasks dir does not exist: {kilocode_tasks_dir:?}");
        return None;
    }

    if !kilocode_workspaces_dir.exists() {
        debug!(
            "find_kilocode_session: workspaces dir does not exist: {kilocode_workspaces_dir:?}"
        );
        return None;
    }

    let normalized_worktree = normalize_path(worktree_path);
    debug!("find_kilocode_session: normalized_worktree={normalized_worktree:?}");

    let normalized_worktree = normalized_worktree?;

    let index = index_cache.get_or_rebuild(&kilocode_tasks_dir, &kilocode_workspaces_dir);

    let result = index.get(&normalized_worktree).cloned();
    debug!("find_kilocode_session: lookup result for {normalized_worktree:?} = {result:?}");
    result
}

#[cfg(not(test))]
pub fn find_kilocode_session(worktree_path: &Path) -> Option<String> {
    let index_cache = SESSION_INDEX.get_or_init(KilocodeIndex::new);
    find_kilocode_session_with_index(worktree_path, index_cache)
}

#[cfg(test)]
pub fn find_kilocode_session(worktree_path: &Path) -> Option<String> {
    let index_cache = KilocodeIndex::new();
    find_kilocode_session_with_index(worktree_path, &index_cache)
}

#[derive(Clone, Default)]
struct CachedTaskEntry {
    modified_millis: Option<u128>,
    cwd: Option<String>,
}

#[derive(Default)]
struct CacheStats {
    cached_hits: usize,
    cache_misses: usize,
    skipped_files: usize,
    scanned_files: usize,
}

#[derive(Serialize, Deserialize)]
struct DiskTaskRecord {
    path: String,
    modified_millis: Option<u128>,
    cwd: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DiskCacheFile {
    version: u8,
    tasks: Vec<DiskTaskRecord>,
}

fn cache_file_path(tasks_dir: &Path) -> PathBuf {
    tasks_dir.join("_schaltwerk_kilocode_index_cache.json")
}

fn load_disk_cache(tasks_dir: &Path) -> HashMap<PathBuf, CachedTaskEntry> {
    let path = cache_file_path(tasks_dir);
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                debug!(
                    "KiloCode session index: Failed to open cache file {}: {err}",
                    path.display()
                );
            }
            return HashMap::new();
        }
    };

    let reader = BufReader::new(file);
    match serde_json::from_reader::<_, DiskCacheFile>(reader) {
        Ok(file) if file.version == 1 => {
            let mut map = HashMap::with_capacity(file.tasks.len());
            for entry in file.tasks {
                let path_buf = PathBuf::from(entry.path);
                if !path_buf.starts_with(tasks_dir) {
                    continue;
                }
                map.insert(
                    path_buf,
                    CachedTaskEntry {
                        modified_millis: entry.modified_millis,
                        cwd: entry.cwd,
                    },
                );
            }
            debug!(
                "KiloCode session index: Loaded {} cached task entries from {}",
                map.len(),
                path.display()
            );
            map
        }
        Ok(file) => {
            log::info!(
                "KiloCode session index: Ignoring cache {} with unsupported version {}",
                path.display(),
                file.version
            );
            HashMap::new()
        }
        Err(err) => {
            log::warn!(
                "KiloCode session index: Failed to deserialize cache {}: {err}",
                path.display()
            );
            HashMap::new()
        }
    }
}

fn persist_disk_cache(tasks_dir: &Path, cache: &HashMap<PathBuf, CachedTaskEntry>) {
    let path = cache_file_path(tasks_dir);
    let tmp_path = path.with_extension("tmp");

    if let Some(parent) = path.parent()
        && let Err(err) = fs::create_dir_all(parent)
    {
        log::warn!(
            "KiloCode session index: Failed to create cache directory {}: {err}",
            parent.display()
        );
        return;
    }

    let tasks: Vec<DiskTaskRecord> = cache
        .iter()
        .map(|(path_buf, entry)| DiskTaskRecord {
            path: path_buf.to_string_lossy().into_owned(),
            modified_millis: entry.modified_millis,
            cwd: entry.cwd.clone(),
        })
        .collect();

    let payload = DiskCacheFile {
        version: 1,
        tasks,
    };

    match fs::File::create(&tmp_path) {
        Ok(mut file) => {
            if let Err(err) = serde_json::to_writer(&mut file, &payload) {
                log::warn!(
                    "KiloCode session index: Failed to serialize cache {}: {err}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = file.flush() {
                log::warn!(
                    "KiloCode session index: Failed to flush cache {}: {err}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = fs::rename(&tmp_path, &path) {
                log::warn!(
                    "KiloCode session index: Failed to persist cache {}: {err}",
                    path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            debug!(
                "KiloCode session index: Persisted cache with {} task entries to {}",
                payload.tasks.len(),
                path.display()
            );
        }
        Err(err) => {
            log::warn!(
                "KiloCode session index: Failed to create cache file {}: {err}",
                tmp_path.display()
            );
        }
    }
}

/// Build the session index by scanning KiloCode workspaces + tasks.
/// Maps normalized CWD paths to the workspace's lastSession.sessionId.
fn build_kilocode_session_index(
    tasks_dir: &Path,
    workspaces_dir: &Path,
    previous_cache: &HashMap<PathBuf, CachedTaskEntry>,
) -> (HashMap<String, String>, HashMap<PathBuf, CachedTaskEntry>, CacheStats) {
    let mut index = HashMap::new();
    let mut next_cache: HashMap<PathBuf, CachedTaskEntry> = HashMap::new();
    let mut stats = CacheStats::default();

    if !tasks_dir.exists() || !workspaces_dir.exists() {
        return (index, next_cache, stats);
    }

    let Ok(entries) = fs::read_dir(workspaces_dir) else {
        return (index, next_cache, stats);
    };

    for entry in entries.flatten() {
        let workspace_dir = entry.path();
        if !workspace_dir.is_dir() {
            continue;
        }

        let session_file = workspace_dir.join("session.json");
        if let Some((last_session_id, task_ids)) = read_workspace_session_info(&session_file) {
            for task_id in task_ids {
                let task_history = tasks_dir.join(&task_id).join("api_conversation_history.json");
                stats.scanned_files += 1;

                let modified_millis = task_history
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|ts| ts.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|dur| dur.as_millis());

                let cached = previous_cache.get(&task_history);
                let cwd = if let Some(cached) = cached {
                    if cached.modified_millis == modified_millis {
                        stats.cached_hits += 1;
                        cached.cwd.clone()
                    } else {
                        stats.cache_misses += 1;
                        extract_cwd_from_task_history(&task_history)
                    }
                } else {
                    stats.cache_misses += 1;
                    extract_cwd_from_task_history(&task_history)
                };

                if cwd.is_none() {
                    stats.skipped_files += 1;
                }

                next_cache.insert(
                    task_history.clone(),
                    CachedTaskEntry {
                        modified_millis,
                        cwd: cwd.clone(),
                    },
                );

                if let Some(normalized) = cwd
                    .as_deref()
                    .and_then(|cwd| normalize_path(Path::new(cwd)))
                {
                    index.insert(normalized, last_session_id.clone());
                }
            }
        }
    }

    (index, next_cache, stats)
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

static DISABLE_INDEXING: LazyLock<bool> =
    LazyLock::new(|| match std::env::var("SCHALTWERK_DISABLE_KILOCODE_INDEX") {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                false
            } else {
                !matches!(normalized.as_str(), "0" | "false" | "no")
            }
        }
        Err(_) => false,
    });

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    static TASK_HISTORY_READS: Cell<usize> = Cell::new(0);
}

#[cfg(test)]
fn bump_task_history_reads() {
    TASK_HISTORY_READS.with(|reads| reads.set(reads.get() + 1));
}

#[cfg(test)]
fn reset_task_history_reads() {
    TASK_HISTORY_READS.with(|reads| reads.set(0));
}

#[cfg(test)]
fn task_history_reads() -> usize {
    TASK_HISTORY_READS.with(|reads| reads.get())
}

#[cfg(not(test))]
fn bump_task_history_reads() {}

pub fn build_kilocode_command_with_config(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
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
            Some(&config),
        );
        assert!(cmd.ends_with("kilocode \"implement feature X\""));
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
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && kilocode --session abc-123-session"
        );
    }

    #[test]
    fn test_resume_session() {
        let config = KilocodeConfig {
            binary_path: Some("kilocode".to_string()),
        };
        let cmd = build_kilocode_command_with_config(
            Path::new("/path/to/worktree"),
            Some("session-xyz"),
            None,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && kilocode --session session-xyz"
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
        let temp_dir = TempDir::new().unwrap();
        let tasks_dir = temp_dir.path().join("tasks");
        let workspaces_dir = temp_dir.path().join("workspaces");
        fs::create_dir_all(&tasks_dir).unwrap();
        fs::create_dir_all(&workspaces_dir).unwrap();

        let workspace_dir = workspaces_dir.join("ws-1");
        fs::create_dir_all(&workspace_dir).unwrap();
        fs::write(
            workspace_dir.join("session.json"),
            "{\"lastSession\":{\"sessionId\":\"last-sess-123\"},\"taskSessionMap\":{\"task-1\":\"session-1\"}}",
        )
        .unwrap();

        let task_dir = tasks_dir.join("task-1");
        fs::create_dir_all(&task_dir).unwrap();

        let project_dir = temp_dir.path().join("project");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            task_dir.join("api_conversation_history.json"),
            format!(
                "[{{\"content\":[{{\"text\":\"# Current Workspace Directory ({})\"}}]}}]",
                project_dir.display()
            ),
        )
        .unwrap();

        let (index, _cache, _stats) =
            build_kilocode_session_index(&tasks_dir, &workspaces_dir, &HashMap::new());
        assert_eq!(
            index.get(&normalize_path(&project_dir).unwrap()),
            Some(&"last-sess-123".to_string())
        );
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

    #[test]
    fn test_disk_cache_avoids_reparsing_unchanged_tasks() {
        let temp_dir = TempDir::new().unwrap();
        let tasks_dir = temp_dir.path().join("tasks");
        let workspaces_dir = temp_dir.path().join("workspaces");
        fs::create_dir_all(&tasks_dir).unwrap();
        fs::create_dir_all(&workspaces_dir).unwrap();

        let workspace_dir = workspaces_dir.join("ws-1");
        fs::create_dir_all(&workspace_dir).unwrap();
        fs::write(
            workspace_dir.join("session.json"),
            "{\"lastSession\":{\"sessionId\":\"last-sess-123\"},\"taskSessionMap\":{\"task-1\":\"session-1\"}}",
        )
        .unwrap();

        let worktree_dir = temp_dir.path().join("project");
        fs::create_dir_all(&worktree_dir).unwrap();

        let task_dir = tasks_dir.join("task-1");
        fs::create_dir_all(&task_dir).unwrap();
        fs::write(
            task_dir.join("api_conversation_history.json"),
            format!(
                "[{{\"content\":[{{\"text\":\"# Current Workspace Directory ({})\"}}]}}]",
                worktree_dir.display()
            ),
        )
        .unwrap();

        reset_task_history_reads();
        let indexer = KilocodeIndex::new();
        let index1 = indexer.get_or_rebuild(&tasks_dir, &workspaces_dir);
        assert_eq!(
            index1.get(&normalize_path(&worktree_dir).unwrap()),
            Some(&"last-sess-123".to_string())
        );
        assert_eq!(task_history_reads(), 1);

        // New indexer simulates a new process: should load persisted cache and skip parsing.
        reset_task_history_reads();
        let indexer2 = KilocodeIndex::new();
        let index2 = indexer2.get_or_rebuild(&tasks_dir, &workspaces_dir);
        assert_eq!(
            index2.get(&normalize_path(&worktree_dir).unwrap()),
            Some(&"last-sess-123".to_string())
        );
        assert_eq!(task_history_reads(), 0);
    }
}

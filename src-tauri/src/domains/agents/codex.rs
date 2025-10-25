use super::format_binary_invocation;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct DirSignature {
    root_millis: Option<u128>,
    latest_dir_millis: Option<u128>,
    latest_file_millis: Option<u128>,
    file_count: u64,
}

impl DirSignature {
    fn compute(sessions_dir: &Path) -> std::io::Result<Self> {
        if !sessions_dir.exists() {
            return Ok(Self::default());
        }

        let root_millis = fs::metadata(sessions_dir)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|ts| ts.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis());

        let mut latest_dir_millis: Option<u128> = None;
        let mut latest_file_millis: Option<u128> = None;
        let mut file_count: u64 = 0;

        let mut stack: Vec<(PathBuf, usize)> = vec![(sessions_dir.to_path_buf(), 0)];

        while let Some((dir, depth)) = stack.pop() {
            if depth > 3 {
                continue;
            }

            let read_dir = match fs::read_dir(&dir) {
                Ok(rd) => rd,
                Err(_) => continue,
            };

            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(meta) = entry.metadata()
                        && let Ok(modified) = meta.modified()
                        && let Ok(millis) = modified
                            .duration_since(std::time::SystemTime::UNIX_EPOCH)
                            .map(|dur| dur.as_millis())
                        && latest_dir_millis
                            .map(|current| millis > current)
                            .unwrap_or(true)
                    {
                        latest_dir_millis = Some(millis);
                    }
                    if depth < 3 {
                        stack.push((path, depth + 1));
                    }
                    continue;
                }

                if path.extension().is_none_or(|ext| ext != "jsonl") {
                    continue;
                }

                file_count += 1;
                if let Ok(meta) = entry.metadata()
                    && let Ok(modified) = meta.modified()
                    && let Ok(millis) = modified
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .map(|dur| dur.as_millis())
                    && latest_file_millis
                        .map(|current| millis > current)
                        .unwrap_or(true)
                {
                    latest_file_millis = Some(millis);
                }
            }
        }

        Ok(Self {
            root_millis,
            latest_dir_millis,
            latest_file_millis,
            file_count,
        })
    }
}

#[derive(Clone, Default)]
struct SessionFileInfo {
    path: PathBuf,
    modified_millis: Option<u128>,
}

#[derive(Clone, Default)]
struct Snapshot {
    per_cwd: HashMap<String, Vec<SessionFileInfo>>,
    global_newest: Option<PathBuf>,
    scanned_files: usize,
}

#[derive(Clone, Default)]
struct CachedFileEntry {
    modified_millis: Option<u128>,
    cwds: Vec<String>,
}

#[derive(Default)]
struct CacheStats {
    cached_hits: usize,
    cache_misses: usize,
    skipped_files: usize,
}

#[derive(Serialize, Deserialize)]
struct DiskCacheRecord {
    path: String,
    modified_millis: Option<u128>,
    cwds: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct DiskCacheFile {
    version: u8,
    entries: Vec<DiskCacheRecord>,
}

#[derive(Default)]
struct IndexState {
    snapshot: Option<Snapshot>,
    signature: Option<DirSignature>,
    cache: HashMap<PathBuf, CachedFileEntry>,
    disk_cache_loaded: bool,
}

struct CodexSessionIndex {
    state: RwLock<IndexState>,
}

struct MatchResult {
    resume_path: PathBuf,
    is_global_newest: bool,
}

impl CodexSessionIndex {
    fn new() -> Self {
        Self {
            state: RwLock::new(IndexState::default()),
        }
    }

    fn match_for_cwd(
        &self,
        sessions_dir: &Path,
        target_cwd: &str,
    ) -> Result<Option<MatchResult>, std::io::Error> {
        if *DISABLE_INDEXING {
            log::info!(
                "Codex session indexing disabled via SCHALTWERK_DISABLE_CODEX_INDEX, skipping lookup"
            );
            self.clear();
            return Ok(None);
        }

        if !sessions_dir.exists() {
            self.clear();
            return Ok(None);
        }

        let (signature, signature_valid) = match DirSignature::compute(sessions_dir) {
            Ok(sig) => (sig, true),
            Err(err) => {
                log::warn!(
                    "Codex session index: Failed to compute directory signature for {}: {err}",
                    sessions_dir.display()
                );
                (DirSignature::default(), false)
            }
        };

        let mut needs_refresh = !signature_valid;

        if let Ok(state) = self.state.read() {
            if state.signature.as_ref() != Some(&signature) {
                needs_refresh = true;
            } else if let Some(snapshot) = &state.snapshot {
                if let Some(entries) = snapshot.per_cwd.get(target_cwd) {
                    if let Some(info) = entries.first() {
                        let is_global_newest = snapshot
                            .global_newest
                            .as_ref()
                            .map(|p| p == &info.path)
                            .unwrap_or(false);
                        return Ok(Some(MatchResult {
                            resume_path: info.path.clone(),
                            is_global_newest,
                        }));
                    }
                } else {
                    return Ok(None);
                }
            } else {
                needs_refresh = true;
            }
        }

        if !needs_refresh {
            // Cache exists but did not contain the target CWD
            return Ok(None);
        }

        let mut state = self.state.write().unwrap();
        if state.signature.as_ref() != Some(&signature) || !signature_valid {
            if !state.disk_cache_loaded {
                state.cache = load_disk_cache(sessions_dir);
                state.disk_cache_loaded = true;
            }
            let start = Instant::now();
            let (snapshot, new_cache, reuse_stats) = build_snapshot(sessions_dir, &state.cache)?;
            let elapsed = start.elapsed();
            if snapshot.scanned_files > 0 {
                let level = if elapsed > Duration::from_millis(100) {
                    log::Level::Info
                } else {
                    log::Level::Debug
                };
                log::log!(
                    level,
                    "Codex session index refresh scanned {} files in {}ms (cache hits: {}, misses: {}, skipped: {})",
                    snapshot.scanned_files,
                    elapsed.as_millis(),
                    reuse_stats.cached_hits,
                    reuse_stats.cache_misses,
                    reuse_stats.skipped_files
                );
                if snapshot.scanned_files > 5000 {
                    log::warn!(
                        "Codex session index touched {} files; consider pruning old sessions or disabling indexing if startup remains slow",
                        snapshot.scanned_files
                    );
                }
            }
            state.snapshot = Some(snapshot);
            if signature_valid {
                state.signature = Some(signature);
            } else {
                state.signature = None;
            }
            let should_persist = reuse_stats.cache_misses > 0
                || reuse_stats.skipped_files > 0
                || new_cache.len() != state.cache.len();
            if should_persist {
                persist_disk_cache(sessions_dir, &new_cache);
            }
            state.cache = new_cache;
        }

        if let Some(snapshot) = &state.snapshot {
            if let Some(entries) = snapshot.per_cwd.get(target_cwd) {
                if let Some(info) = entries.first() {
                    let is_global_newest = snapshot
                        .global_newest
                        .as_ref()
                        .map(|p| p == &info.path)
                        .unwrap_or(false);
                    return Ok(Some(MatchResult {
                        resume_path: info.path.clone(),
                        is_global_newest,
                    }));
                }
            } else {
                return Ok(None);
            }
        }

        Ok(None)
    }

    fn clear(&self) {
        if let Ok(mut state) = self.state.write() {
            state.snapshot = None;
            state.signature = None;
            state.cache.clear();
            state.disk_cache_loaded = false;
        }
    }

    #[cfg(test)]
    fn reset_for_tests(&self) {
        self.clear();
    }
}

static CODEX_SESSION_INDEX: LazyLock<CodexSessionIndex> = LazyLock::new(CodexSessionIndex::new);

static DISABLE_INDEXING: LazyLock<bool> =
    LazyLock::new(|| match std::env::var("SCHALTWERK_DISABLE_CODEX_INDEX") {
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

fn cache_file_path(sessions_dir: &Path) -> PathBuf {
    sessions_dir.join("_schaltwerk_session_index_cache.json")
}

fn load_disk_cache(sessions_dir: &Path) -> HashMap<PathBuf, CachedFileEntry> {
    let path = cache_file_path(sessions_dir);
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                log::debug!(
                    "Codex session index: Failed to open cache file {}: {err}",
                    path.display()
                );
            }
            return HashMap::new();
        }
    };

    let reader = BufReader::new(file);
    match serde_json::from_reader::<_, DiskCacheFile>(reader) {
        Ok(file) if file.version == 1 => {
            let mut map = HashMap::with_capacity(file.entries.len());
            for entry in file.entries {
                let path_buf = PathBuf::from(entry.path);
                if !path_buf.starts_with(sessions_dir) {
                    continue;
                }
                map.insert(
                    path_buf,
                    CachedFileEntry {
                        modified_millis: entry.modified_millis,
                        cwds: entry.cwds,
                    },
                );
            }
            log::debug!(
                "Codex session index: Loaded {} cached entries from {}",
                map.len(),
                path.display()
            );
            map
        }
        Ok(file) => {
            log::info!(
                "Codex session index: Ignoring cache {} with unsupported version {}",
                path.display(),
                file.version
            );
            HashMap::new()
        }
        Err(err) => {
            log::warn!(
                "Codex session index: Failed to deserialize cache {}: {err}",
                path.display()
            );
            HashMap::new()
        }
    }
}

fn persist_disk_cache(sessions_dir: &Path, cache: &HashMap<PathBuf, CachedFileEntry>) {
    let path = cache_file_path(sessions_dir);
    let tmp_path = path.with_extension("tmp");

    if let Some(parent) = path.parent()
        && let Err(err) = fs::create_dir_all(parent)
    {
        log::warn!(
            "Codex session index: Failed to create cache directory {}: {err}",
            parent.display()
        );
        return;
    }

    let entries: Vec<DiskCacheRecord> = cache
        .iter()
        .map(|(path_buf, entry)| DiskCacheRecord {
            path: path_buf.to_string_lossy().into_owned(),
            modified_millis: entry.modified_millis,
            cwds: entry.cwds.clone(),
        })
        .collect();

    let payload = DiskCacheFile {
        version: 1,
        entries,
    };

    match fs::File::create(&tmp_path) {
        Ok(mut file) => {
            if let Err(err) = serde_json::to_writer(&mut file, &payload) {
                log::warn!(
                    "Codex session index: Failed to serialize cache {}: {err}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = file.flush() {
                log::warn!(
                    "Codex session index: Failed to flush cache {}: {err}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = fs::rename(&tmp_path, &path) {
                log::warn!(
                    "Codex session index: Failed to persist cache {}: {err}",
                    path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            log::debug!(
                "Codex session index: Persisted cache with {} entries to {}",
                payload.entries.len(),
                path.display()
            );
        }
        Err(err) => {
            log::warn!(
                "Codex session index: Failed to create cache file {}: {err}",
                tmp_path.display()
            );
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: Option<String>,
}

pub fn find_codex_session_fast(path: &Path) -> Option<String> {
    log::debug!(
        "🔍 Codex session detection starting for path: {}",
        path.display()
    );

    let home = std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(dirs::home_dir);

    let home = match home {
        Some(home) => home,
        None => {
            log::warn!("❌ Codex session detection: Could not determine home directory");
            return None;
        }
    };

    let sessions_dir = home.join(".codex").join("sessions");
    let target_path = path.to_string_lossy().to_string();

    log::debug!(
        "📁 Codex session detection: Sessions directory: {}",
        sessions_dir.display()
    );
    log::debug!("🎯 Codex session detection: Target CWD: {target_path:?}");

    match CODEX_SESSION_INDEX.match_for_cwd(&sessions_dir, &target_path) {
        Ok(Some(result)) => {
            if result.is_global_newest {
                log::debug!("✅ Safe to --continue: newest global session matches this worktree");
                Some("__continue__".to_string())
            } else {
                log::debug!("⚠️ Not safe to --continue: using resume picker sentinel");
                Some("__resume__".to_string())
            }
        }
        Ok(None) => {
            log::debug!(
                "🚫 Codex session detection: No resumable sessions found for path: {}",
                path.display()
            );
            None
        }
        Err(err) => {
            log::error!(
                "💥 Codex session detection: Error building cache, falling back to legacy scan: {err}"
            );
            legacy_match_for_cwd(&sessions_dir, &target_path).map(|legacy| {
                if legacy.is_global_newest {
                    "__continue__".to_string()
                } else {
                    "__resume__".to_string()
                }
            })
        }
    }
}

fn sort_by_name_desc(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut items: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    items.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    Ok(items)
}

fn sort_session_files_desc(dir: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();

    files.sort_by(|a, b| {
        let a_meta = a
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let b_meta = b
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match b_meta.cmp(&a_meta) {
            std::cmp::Ordering::Equal => b.file_name().cmp(&a.file_name()),
            other => other,
        }
    });

    Ok(files)
}

// Efficiently finds the newest matching session for a given CWD by scanning
// date-partitioned subdirectories from newest to oldest and exiting on first match.
fn find_newest_session_for_cwd(
    sessions_dir: &Path,
    target_cwd: &str,
) -> Result<Option<PathBuf>, std::io::Error> {
    if !sessions_dir.exists() {
        return Ok(None);
    }

    // Iterate years → months → days (names are ISO-like so lexical desc works)
    for year in sort_by_name_desc(sessions_dir)? {
        if !year.is_dir() {
            continue;
        }
        for month in sort_by_name_desc(&year)? {
            if !month.is_dir() {
                continue;
            }
            for day in sort_by_name_desc(&month)? {
                if !day.is_dir() {
                    continue;
                }
                for file in sort_session_files_desc(&day)? {
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
    let home = std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(dirs::home_dir)?;

    let sessions_dir = home.join(".codex").join("sessions");
    let target_path = path.to_string_lossy().to_string();

    match CODEX_SESSION_INDEX.match_for_cwd(&sessions_dir, &target_path) {
        Ok(Some(result)) => Some(result.resume_path),
        Ok(None) => None,
        Err(err) => {
            log::error!(
                "💥 Codex resume detection: Error building cache, falling back to legacy scan: {err}"
            );
            legacy_match_for_cwd(&sessions_dir, &target_path).map(|legacy| legacy.resume_path)
        }
    }
}

fn legacy_match_for_cwd(sessions_dir: &Path, target_cwd: &str) -> Option<MatchResult> {
    let newest_match = find_newest_session_for_cwd(sessions_dir, target_cwd)
        .ok()
        .flatten()?;
    let global_newest = find_newest_session(sessions_dir).ok().flatten();
    let is_global_newest = global_newest
        .as_ref()
        .map(|p| p == &newest_match)
        .unwrap_or(false);
    Some(MatchResult {
        resume_path: newest_match,
        is_global_newest,
    })
}

fn find_newest_session(sessions_dir: &Path) -> Result<Option<PathBuf>, std::io::Error> {
    if !sessions_dir.exists() {
        return Ok(None);
    }
    for year in sort_by_name_desc(sessions_dir)? {
        if !year.is_dir() {
            continue;
        }
        for month in sort_by_name_desc(&year)? {
            if !month.is_dir() {
                continue;
            }
            for day in sort_by_name_desc(&month)? {
                if !day.is_dir() {
                    continue;
                }
                if let Some(first) = sort_session_files_desc(&day)?.into_iter().next() {
                    return Ok(Some(first));
                }
            }
        }
    }
    Ok(None)
}

fn session_matches_cwd(session_file: &Path, target_cwd: &str) -> bool {
    extract_session_cwds(session_file)
        .into_iter()
        .any(|cwd| cwd == target_cwd)
}

fn extract_session_cwds(session_file: &Path) -> Vec<String> {
    log::trace!(
        "🔍 Collecting candidate CWDs from Codex session: {}",
        session_file.display()
    );

    let content = match fs::read_to_string(session_file) {
        Ok(content) => content,
        Err(e) => {
            log::trace!("❌ Failed to read session file: {e}");
            return Vec::new();
        }
    };

    let mut seen = HashSet::new();
    let mut results = Vec::new();

    for (line_num, line) in content.lines().enumerate() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            log::trace!(
                "📝 Parsing JSON on line {}: {:?}",
                line_num + 1,
                json.get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
            );

            if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                push_unique_cwd(cwd, &mut seen, &mut results);
            }

            if let Some(payload) = json.get("payload") {
                if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                    push_unique_cwd(cwd, &mut seen, &mut results);
                }

                if let Some(content_array) = payload.get("content").and_then(|v| v.as_array()) {
                    for content_item in content_array.iter() {
                        if let Some(text) = content_item.get("text").and_then(|v| v.as_str()) {
                            extract_cwds_from_text(text, &mut seen, &mut results);
                        }
                    }
                }
            }
        }
    }

    if results.is_empty() {
        log::trace!("❌ No CWD candidates found in session file");
    } else {
        log::trace!("✅ Found {} candidate CWDs", results.len());
    }

    results
}

fn push_unique_cwd(cwd: &str, seen: &mut HashSet<String>, output: &mut Vec<String>) {
    if seen.insert(cwd.to_string()) {
        output.push(cwd.to_string());
        log::trace!("🔍 Recorded candidate CWD: {cwd}");
    }
}

fn extract_cwds_from_text(text: &str, seen: &mut HashSet<String>, output: &mut Vec<String>) {
    let mut remaining = text;
    while let Some(start) = remaining.find("<cwd>") {
        let after_start = &remaining[start + 5..];
        if let Some(end) = after_start.find("</cwd>") {
            let value = &after_start[..end];
            push_unique_cwd(value.trim(), seen, output);
            remaining = &after_start[end + 6..];
        } else {
            break;
        }
    }
}

fn build_snapshot(
    sessions_dir: &Path,
    previous_cache: &HashMap<PathBuf, CachedFileEntry>,
) -> Result<(Snapshot, HashMap<PathBuf, CachedFileEntry>, CacheStats), std::io::Error> {
    if !sessions_dir.exists() {
        return Ok((Snapshot::default(), HashMap::new(), CacheStats::default()));
    }

    let mut per_cwd: HashMap<String, Vec<SessionFileInfo>> = HashMap::new();
    let mut global_newest: Option<(u128, PathBuf)> = None;
    let mut stack = vec![sessions_dir.to_path_buf()];
    let mut scanned_files = 0usize;
    let mut next_cache: HashMap<PathBuf, CachedFileEntry> = HashMap::new();
    let mut stats = CacheStats::default();

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            scanned_files += 1;
            let modified_millis = path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|ts| ts.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis());

            if let Some(millis) = modified_millis {
                match &global_newest {
                    Some((current, _)) if millis > *current => {
                        global_newest = Some((millis, path.clone()));
                    }
                    None => global_newest = Some((millis, path.clone())),
                    _ => {}
                }
            } else if global_newest.is_none() {
                global_newest = Some((0, path.clone()));
            }

            let cwds = if let Some(cached) = previous_cache.get(&path) {
                if cached.modified_millis == modified_millis {
                    stats.cached_hits += 1;
                    cached.cwds.clone()
                } else {
                    stats.cache_misses += 1;
                    extract_session_cwds(&path)
                }
            } else {
                stats.cache_misses += 1;
                extract_session_cwds(&path)
            };

            if cwds.is_empty() {
                stats.skipped_files += 1;
            }

            next_cache.insert(
                path.clone(),
                CachedFileEntry {
                    modified_millis,
                    cwds: cwds.clone(),
                },
            );

            for cwd in cwds {
                per_cwd.entry(cwd).or_default().push(SessionFileInfo {
                    path: path.clone(),
                    modified_millis,
                });
            }
        }
    }

    for entries in per_cwd.values_mut() {
        entries.sort_by(|a, b| match (b.modified_millis, a.modified_millis) {
            (Some(bm), Some(am)) => bm.cmp(&am),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.path.cmp(&a.path),
        });
    }

    Ok((
        Snapshot {
            per_cwd,
            global_newest: global_newest.map(|(_, path)| path),
            scanned_files,
        },
        next_cache,
        stats,
    ))
}

pub fn extract_session_id_from_path(session_file: &Path) -> Option<String> {
    log::trace!(
        "🔍 Extracting session id from Codex log: {}",
        session_file.display()
    );
    let content = fs::read_to_string(session_file).ok()?;
    for (line_num, line) in content.lines().enumerate() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(id) = json
                .get("payload")
                .and_then(|p| p.get("id"))
                .and_then(|v| v.as_str())
            {
                log::trace!(
                    "✅ Found session id in payload on line {}: {}",
                    line_num + 1,
                    id
                );
                return Some(id.to_string());
            }
            if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
                log::trace!(
                    "✅ Found top-level session id on line {}: {}",
                    line_num + 1,
                    id
                );
                return Some(id.to_string());
            }
        }
    }
    log::trace!(
        "❌ No session id found in Codex log: {}",
        session_file.display()
    );
    None
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
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    // Add sandbox mode first (this is an option)
    cmd.push_str(&format!(" --sandbox {sandbox_mode}"));

    // Handle session resumption
    log::debug!(
        "🛠️ Codex command builder: Configuring session for worktree: {}",
        worktree_path.display()
    );
    log::debug!("🛠️ Codex command builder: Binary: {binary_name:?}, Sandbox: {sandbox_mode:?}");

    if let Some(session) = session_id {
        let trimmed = session.trim();
        if trimmed == "__continue__" {
            log::debug!(
                "🔄 Codex command builder: Using 'resume --last' to continue most recent session"
            );
            cmd.push_str(" resume --last");
        } else if trimmed == "__resume__" {
            log::debug!("🧭 Codex command builder: Opening interactive resume picker via 'resume'");
            cmd.push_str(" resume");
        } else if let Some(rest) = trimmed.strip_prefix("file://") {
            let path = PathBuf::from(rest);
            if let Some(id) = extract_session_id_from_path(&path) {
                log::debug!(
                    "📄 Codex command builder: Converted legacy file URI to session id: {id}"
                );
                cmd.push_str(" resume ");
                cmd.push_str(&id);
            } else {
                log::warn!(
                    "⚠️ Codex command builder: Could not extract session id from legacy file URI: {trimmed}"
                );
                cmd.push_str(" resume");
            }
        } else if trimmed.is_empty() {
            log::warn!(
                "⚠️ Codex command builder: Provided empty session identifier; starting fresh"
            );
        } else {
            log::debug!("📄 Codex command builder: Resuming explicit session id: {trimmed}");
            cmd.push_str(" resume ");
            cmd.push_str(trimmed);
        }
    } else if let Some(prompt) = initial_prompt {
        // Start fresh with initial prompt
        log::debug!("✨ Codex command builder: Starting fresh session with initial prompt");
        log::debug!("✨ Prompt: {prompt:?}");
        let escaped = super::escape_prompt_for_shell(prompt);
        cmd.push_str(&format!(r#" "{escaped}""#));
    } else {
        // Start fresh without prompt
        log::debug!(
            "🆕 Codex command builder: Starting fresh session without prompt or session resumption"
        );
        log::debug!("🆕 Codex will start a new session by default with no additional flags");
    }

    log::debug!("🚀 Codex command builder: Final command: {cmd:?}");

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{FileTime, set_file_mtime};
    use std::env;
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use std::thread;
    use std::time::Duration;
    use tempfile::tempdir;

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
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && codex --sandbox workspace-write "implement feature X""#
        );
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            "workspace-write",
            Some(&config),
        );
        assert!(cmd.starts_with(r#"cd "/path/with spaces" && "#));
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
        assert_eq!(
            cmd,
            "cd /path/to/worktree && codex --sandbox workspace-write resume"
        );
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
        assert_eq!(
            cmd,
            "cd /path/to/worktree && codex --sandbox workspace-write resume --last"
        );
    }

    #[test]
    fn test_resume_by_session_id() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some("2a593eaf-00b5-476a-bb16-f49c5dfb60c4"),
            None,
            "workspace-write",
            Some(&config),
        );
        assert!(cmd.contains("cd /repo/worktree-a && codex --sandbox workspace-write resume 2a593eaf-00b5-476a-bb16-f49c5dfb60c4"));
    }

    #[test]
    fn test_resume_by_session_id_with_danger_mode() {
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some("2a593eaf-00b5-476a-bb16-f49c5dfb60c4"),
            None,
            "danger-full-access",
            Some(&config),
        );
        assert!(cmd.contains("cd /repo/worktree-a && codex --sandbox danger-full-access resume 2a593eaf-00b5-476a-bb16-f49c5dfb60c4"));
    }

    #[test]
    fn test_resume_from_legacy_file_uri() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"id":"legacy-session","timestamp":"2025-09-13T01:00:00.000Z","cwd":"/repo/worktree-a","originator":"codex_cli_rs"}}"#).unwrap();

        let legacy_uri = format!("file://{}", temp_file.path().display());
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some(&legacy_uri),
            None,
            "workspace-write",
            Some(&config),
        );

        assert!(cmd.contains(
            "cd /repo/worktree-a && codex --sandbox workspace-write resume legacy-session"
        ));
    }

    #[test]
    fn test_resume_from_legacy_file_uri_without_id() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(
            temp_file,
            r#"{{"timestamp":"2025-09-13T01:00:00.000Z","cwd":"/repo/worktree-a"}}"#
        )
        .unwrap();

        let legacy_uri = format!("file://{}", temp_file.path().display());
        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let cmd = build_codex_command_with_config(
            Path::new("/repo/worktree-a"),
            Some(&legacy_uri),
            None,
            "workspace-write",
            Some(&config),
        );

        assert!(cmd.contains("cd /repo/worktree-a && codex --sandbox workspace-write resume"));
        assert!(cmd.ends_with(" resume"));
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
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && codex --sandbox danger-full-access "fix bugs""#
        );
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
        assert_eq!(
            cmd,
            r#"cd /path/to/worktree && codex --sandbox workspace-write "implement \"feature\" with quotes""#
        );
    }

    #[test]
    fn test_prompt_with_trailing_backslash_round_trips() {
        use crate::domains::agents::command_parser::parse_agent_command;

        let config = CodexConfig {
            binary_path: Some("codex".to_string()),
        };
        let prompt = "Send Windows path: C:\\Users\\codex\\Sandbox\\";
        let cmd = build_codex_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some(prompt),
            "workspace-write",
            Some(&config),
        );

        let (_, _, args) =
            parse_agent_command(&cmd).expect("codex prompt ending with backslash must parse");
        assert_eq!(args.last().unwrap(), prompt);
    }

    #[test]
    fn test_session_matches_cwd_session_meta() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"id":"test-session","timestamp":"2025-09-13T01:00:00.000Z","cwd":"/path/to/project","originator":"codex_cli_rs","cli_version":"0.34.0"}}"#).unwrap();
        writeln!(temp_file, r#"{{"record_type":"state"}}"#).unwrap();

        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }

    #[test]
    fn test_session_matches_cwd_environment_context() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"<environment_context>\n  <cwd>/path/to/project</cwd>\n  <sandbox_mode>workspace-write</sandbox_mode>\n</environment_context>"}}]}}}}"#).unwrap();

        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }

    #[test]
    fn test_session_matches_cwd_payload_cwd() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"session_meta","payload":{{"id":"test-session","cwd":"/path/to/project","originator":"codex_cli_rs"}}}}"#).unwrap();

        assert!(session_matches_cwd(temp_file.path(), "/path/to/project"));
        assert!(!session_matches_cwd(temp_file.path(), "/different/path"));
    }

    #[test]
    fn test_extract_session_cwds_collects_candidates() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(
            temp_file,
            r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"session_meta","cwd":"/path/a","payload":{{"cwd":"/path/b"}}}}"#
        )
        .unwrap();
        writeln!(
            temp_file,
            r#"{{"timestamp":"2025-09-13T01:00:01.000Z","type":"response_item","payload":{{"type":"message","content":[{{"type":"input_text","text":"<environment_context><cwd>/path/c</cwd></environment_context>"}}]}}}}"#
        )
        .unwrap();

        let mut cwds = extract_session_cwds(temp_file.path());
        cwds.sort();
        assert_eq!(cwds, vec!["/path/a", "/path/b", "/path/c"]);
    }

    #[test]
    #[serial_test::serial]
    fn test_find_codex_session_fast_uses_cached_snapshot() {
        use crate::utils::env_adapter::EnvAdapter;
        let temp_home = tempdir().unwrap();
        let sessions_root = temp_home.path().join(".codex").join("sessions");
        let target_dir = sessions_root.join("2025").join("09").join("20");
        fs::create_dir_all(&target_dir).unwrap();

        let target_file = target_dir.join("session-a.jsonl");
        let mut handle = fs::File::create(&target_file).unwrap();
        writeln!(
            handle,
            r#"{{"timestamp":"2025-09-20T10:00:00.000Z","cwd":"/worktree/a"}}"#
        )
        .unwrap();
        drop(handle);

        thread::sleep(Duration::from_millis(5));

        let other_file = target_dir.join("session-b.jsonl");
        let mut handle = fs::File::create(&other_file).unwrap();
        writeln!(
            handle,
            r#"{{"timestamp":"2025-09-20T10:00:01.000Z","cwd":"/other/worktree"}}"#
        )
        .unwrap();
        drop(handle);

        let original_home = env::var("HOME").ok();
        EnvAdapter::set_var("HOME", &temp_home.path().to_string_lossy());
        CODEX_SESSION_INDEX.reset_for_tests();

        let resume_hint = find_codex_session_fast(Path::new("/worktree/a"));
        assert_eq!(resume_hint.as_deref(), Some("__resume__"));

        let resume_hint_cached = find_codex_session_fast(Path::new("/worktree/a"));
        assert_eq!(resume_hint_cached.as_deref(), Some("__resume__"));

        CODEX_SESSION_INDEX.reset_for_tests();
        if let Some(home) = original_home {
            EnvAdapter::set_var("HOME", &home);
        } else {
            EnvAdapter::remove_var("HOME");
        }
    }

    #[test]
    fn test_extract_session_id_from_valid_log() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"session_meta","payload":{{"id":"abc-123","cwd":"/path","originator":"codex_cli_rs"}}}}"#).unwrap();
        assert_eq!(
            extract_session_id_from_path(temp_file.path()),
            Some("abc-123".to_string())
        );
    }

    #[test]
    fn test_extract_session_id_from_invalid_log() {
        use std::io::Write;
        use tempfile::NamedTempFile;

        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(
            temp_file,
            r#"{{"timestamp":"2025-09-13T01:00:00.000Z","type":"response_item"}}"#
        )
        .unwrap();
        assert_eq!(extract_session_id_from_path(temp_file.path()), None);
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
        assert_eq!(
            cmd,
            "cd /path/to/worktree && codex --sandbox danger-full-access resume --last"
        );
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
        assert_eq!(
            cmd,
            "cd /path/to/worktree && codex --sandbox danger-full-access resume"
        );
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

        let newest_match =
            find_newest_session_for_cwd(tmp.path().join(".codex/sessions").as_path(), cwd).unwrap();
        let global_newest =
            find_newest_session(tmp.path().join(".codex/sessions").as_path()).unwrap();
        assert!(newest_match.is_some() && global_newest.is_some());
        assert_eq!(newest_match, global_newest);
    }

    #[test]
    fn test_find_codex_session_fast_resume_when_old_match_exists() {
        use filetime::{FileTime, set_file_mtime};

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

        // Ensure deterministic ordering even on filesystems with coarse mod-time resolution.
        set_file_mtime(&old_match, FileTime::from_unix_time(1, 0)).unwrap();
        set_file_mtime(&new_other, FileTime::from_unix_time(2, 0)).unwrap();

        let newest_match =
            find_newest_session_for_cwd(tmp.path().join(".codex/sessions").as_path(), cwd).unwrap();
        let global_newest =
            find_newest_session(tmp.path().join(".codex/sessions").as_path()).unwrap();
        assert!(newest_match.is_some());
        assert_ne!(newest_match, global_newest);
    }

    #[test]
    fn test_find_newest_session_prefers_newer_partition_on_mtime_tie() {
        let tmp = tempdir().unwrap();
        let sessions_root = tmp.path().join(".codex/sessions");
        let day_old = sessions_root.join("2025/08/22");
        let day_new = sessions_root.join("2025/09/14");
        fs::create_dir_all(&day_old).unwrap();
        fs::create_dir_all(&day_new).unwrap();

        let old_session = day_old.join("rollout-2025-08-22T10-00-00-uuid.jsonl");
        let new_session = day_new.join("rollout-2025-09-14T10-00-00-uuid.jsonl");
        write_jsonl_with_cwd(&old_session, "/repo/worktree-a");
        write_jsonl_without_cwd(&new_session);

        let tie_time = FileTime::from_unix_time(1_726_782_400, 0);
        set_file_mtime(&old_session, tie_time).unwrap();
        set_file_mtime(&new_session, tie_time).unwrap();

        let global_newest = find_newest_session(sessions_root.as_path()).unwrap();
        assert_eq!(global_newest, Some(new_session));
    }
}

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};

static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();
static RESERVED_NAMES: OnceLock<StdMutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

static REPO_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<StdMutex<()>>>>> = OnceLock::new();

#[derive(Clone, Copy)]
pub struct WorktreeSizeSnapshot {
    pub size_bytes: u64,
    pub calculated_at: Instant,
}

static WORKTREE_SIZE_CACHE: OnceLock<StdMutex<HashMap<PathBuf, WorktreeSizeSnapshot>>> =
    OnceLock::new();

type SpecContentMap = HashMap<String, (Option<String>, Option<String>)>;
static SPEC_CONTENT_CACHE: OnceLock<StdMutex<SpecContentMap>> = OnceLock::new();

#[derive(Clone)]
pub struct SessionCacheManager {
    repo_path: PathBuf,
}

impl SessionCacheManager {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path }
    }

    #[cfg(test)]
    pub fn mark_session_prompted(&self, worktree_path: &Path) {
        let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
        let mut prompted = set.lock().unwrap();
        prompted.insert(worktree_path.to_path_buf());
    }

    #[cfg(not(test))]
    pub fn mark_session_prompted(&self, worktree_path: &Path) {
        let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
        let mut prompted = set.lock().unwrap();
        prompted.insert(worktree_path.to_path_buf());
    }

    pub fn is_reserved(&self, name: &str) -> bool {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let map = map_mutex.lock().unwrap();
        if let Some(set) = map.get(&self.repo_path) {
            set.contains(name)
        } else {
            false
        }
    }

    pub fn reserve_name(&self, name: &str) {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        let set = map.entry(self.repo_path.clone()).or_default();
        set.insert(name.to_string());
    }

    pub fn unreserve_name(&self, name: &str) {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        if let Some(set) = map.get_mut(&self.repo_path) {
            set.remove(name);
        }
    }

    pub fn get_repo_lock(&self) -> Arc<StdMutex<()>> {
        let map_mutex = REPO_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        if let Some(lock) = map.get(&self.repo_path) {
            return lock.clone();
        }
        let lock = Arc::new(StdMutex::new(()));
        map.insert(self.repo_path.clone(), lock.clone());
        lock
    }

    #[cfg(test)]
    pub fn clear_all_caches() {
        if let Some(prompted) = PROMPTED_SESSIONS.get() {
            let mut prompted = prompted.lock().unwrap();
            prompted.clear();
        }

        if let Some(reserved) = RESERVED_NAMES.get() {
            let mut reserved = reserved.lock().unwrap();
            reserved.clear();
        }

        if let Some(repo_locks) = REPO_LOCKS.get() {
            let mut locks = repo_locks.lock().unwrap();
            locks.clear();
        }

        if let Some(spec_cache) = SPEC_CONTENT_CACHE.get() {
            let mut cache = spec_cache.lock().unwrap();
            cache.clear();
        }
    }
}

fn make_cache_key(repo_path: &Path, name: &str) -> String {
    format!("{}:{}", repo_path.display(), name)
}

pub fn get_cached_spec_content(
    repo_path: &Path,
    name: &str,
) -> Option<(Option<String>, Option<String>)> {
    let cache = SPEC_CONTENT_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    let cache = cache.lock().unwrap();
    let key = make_cache_key(repo_path, name);
    cache.get(&key).cloned()
}

pub fn cache_spec_content(repo_path: &Path, name: &str, content: (Option<String>, Option<String>)) {
    let cache = SPEC_CONTENT_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap();
    let key = make_cache_key(repo_path, name);
    cache.insert(key, content);
}

pub fn invalidate_spec_content(repo_path: &Path, name: &str) {
    let cache = SPEC_CONTENT_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap();
    let key = make_cache_key(repo_path, name);
    cache.remove(&key);
}

pub fn clear_session_prompted_non_test(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.remove(worktree_path);
}

pub fn get_cached_worktree_size(path: &Path, max_age: Duration) -> Option<WorktreeSizeSnapshot> {
    let cache = WORKTREE_SIZE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    let cache = cache.lock().ok()?;
    let snapshot = cache.get(path)?;

    if snapshot.calculated_at.elapsed() > max_age {
        return None;
    }

    Some(*snapshot)
}

pub fn cache_worktree_size(path: &Path, size_bytes: u64) {
    let cache = WORKTREE_SIZE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            path.to_path_buf(),
            WorktreeSizeSnapshot {
                size_bytes,
                calculated_at: Instant::now(),
            },
        );
    }
}

pub fn invalidate_worktree_size(path: &Path) {
    let cache = WORKTREE_SIZE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.remove(path);
    }
}

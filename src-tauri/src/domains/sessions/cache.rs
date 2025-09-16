use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();
static RESERVED_NAMES: OnceLock<StdMutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

static REPO_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<StdMutex<()>>>>> = OnceLock::new();

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
    }
}

pub fn clear_session_prompted_non_test(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.remove(worktree_path);
}

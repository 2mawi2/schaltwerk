use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, Mutex as StdMutex, Arc};
use std::time::{Duration, Instant};
use anyhow::Result;
use crate::para_core::git;

static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();
static RESERVED_NAMES: OnceLock<StdMutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

#[allow(dead_code)]
type BranchExistenceEntry = (Instant, bool);
#[allow(dead_code)]
type RepoBranchExistence = HashMap<String, BranchExistenceEntry>;
#[allow(dead_code)]
type BranchExistenceCache = HashMap<PathBuf, RepoBranchExistence>;
#[allow(dead_code)]
static BRANCH_CACHE: OnceLock<StdMutex<BranchExistenceCache>> = OnceLock::new();
#[allow(dead_code)]
const BRANCH_CACHE_TTL: Duration = Duration::from_secs(30);

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
    pub fn has_session_been_prompted(&self, worktree_path: &Path) -> bool {
        let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
        let prompted = set.lock().unwrap();
        prompted.contains(worktree_path)
    }

    #[cfg(not(test))]
    pub fn has_session_been_prompted(&self, worktree_path: &Path) -> bool {
        let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
        let prompted = set.lock().unwrap();
        prompted.contains(worktree_path)
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

    #[allow(dead_code)]
    pub fn clear_session_prompted(&self, worktree_path: &Path) {
        let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
        let mut prompted = set.lock().unwrap();
        prompted.remove(worktree_path);
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

    #[allow(dead_code)]
    pub fn branch_exists_fast(&self, short_branch: &str) -> Result<bool> {
        let cache_mutex = BRANCH_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut cache = cache_mutex.lock().unwrap();

        let now = Instant::now();
        let repo_cache = cache.entry(self.repo_path.clone()).or_default();

        if let Some((ts, exists)) = repo_cache.get(short_branch) {
            if now.duration_since(*ts) <= BRANCH_CACHE_TTL {
                return Ok(*exists);
            }
        }

        drop(cache);

        let exists = git::branch_exists(&self.repo_path, short_branch)?;

        let mut cache = cache_mutex.lock().unwrap();
        let repo_cache = cache.entry(self.repo_path.clone()).or_default();
        repo_cache.insert(short_branch.to_string(), (now, exists));

        Ok(exists)
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
    #[allow(dead_code)]
    pub fn clear_all_caches() {
        if let Some(prompted) = PROMPTED_SESSIONS.get() {
            let mut prompted = prompted.lock().unwrap();
            prompted.clear();
        }
        
        if let Some(reserved) = RESERVED_NAMES.get() {
            let mut reserved = reserved.lock().unwrap();
            reserved.clear();
        }
        
        if let Some(branch_cache) = BRANCH_CACHE.get() {
            let mut cache = branch_cache.lock().unwrap();
            cache.clear();
        }
        
        if let Some(repo_locks) = REPO_LOCKS.get() {
            let mut locks = repo_locks.lock().unwrap();
            locks.clear();
        }
    }
}

#[cfg(test)]
#[allow(dead_code)]
pub fn has_session_been_prompted(worktree_path: &Path) -> bool {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let prompted = set.lock().unwrap();
    prompted.contains(worktree_path)
}

#[cfg(test)]
#[allow(dead_code)]
pub fn mark_session_prompted(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.insert(worktree_path.to_path_buf());
}

#[cfg(test)]  
#[allow(dead_code)]
pub fn clear_session_prompted(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.remove(worktree_path);
}

pub fn clear_session_prompted_non_test(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.remove(worktree_path);
}
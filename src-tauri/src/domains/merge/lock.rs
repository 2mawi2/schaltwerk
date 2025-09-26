use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};

static MERGE_LOCKS: Lazy<DashMap<String, Arc<Mutex<()>>>> = Lazy::new(DashMap::new);

pub fn try_acquire(session_name: &str) -> Option<OwnedMutexGuard<()>> {
    let entry = MERGE_LOCKS
        .entry(session_name.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())));
    let lock = entry.value().clone();

    lock.try_lock_owned().ok()
}

#[cfg(test)]
pub fn active_lock_count() -> usize {
    MERGE_LOCKS.len()
}

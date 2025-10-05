use std::collections::HashMap;
use std::sync::Arc;

use schaltwerk::domains::sessions::entity::EnrichedSession;
use tokio::sync::RwLock;

use crate::get_project_manager;

#[derive(Clone, Debug, Default)]
struct SessionSnapshot {
    worktree_path: String,
    base_branch: String,
}

#[derive(Debug, Default)]
struct SessionLookupInner {
    sessions_by_repo: HashMap<String, HashMap<String, SessionSnapshot>>,
}

#[derive(Clone, Default)]
pub struct SessionLookupCache {
    inner: Arc<RwLock<SessionLookupInner>>,
}

impl SessionLookupCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn hydrate_repo(&self, repo_key: &str, sessions: &[EnrichedSession]) {
        let mut guard = self.inner.write().await;
        let repo_entry = guard
            .sessions_by_repo
            .entry(repo_key.to_string())
            .or_insert_with(HashMap::new);
        repo_entry.clear();
        for session in sessions {
            let info = &session.info;
            repo_entry.insert(
                info.session_id.clone(),
                SessionSnapshot {
                    worktree_path: info.worktree_path.clone(),
                    base_branch: info.base_branch.clone(),
                },
            );
        }
    }

    pub async fn upsert_repo_session(
        &self,
        repo_key: &str,
        session_id: &str,
        worktree_path: String,
        base_branch: String,
    ) {
        let mut guard = self.inner.write().await;
        let repo_entry = guard
            .sessions_by_repo
            .entry(repo_key.to_string())
            .or_insert_with(HashMap::new);
        repo_entry.insert(
            session_id.to_string(),
            SessionSnapshot {
                worktree_path,
                base_branch,
            },
        );
    }

    pub async fn evict_repo_session(&self, repo_key: &str, session_id: &str) {
        let mut guard = self.inner.write().await;
        if let Some(repo_map) = guard.sessions_by_repo.get_mut(repo_key) {
            repo_map.remove(session_id);
        }
    }

    pub async fn get(&self, repo_key: &str, session_id: &str) -> Option<(String, String)> {
        let guard = self.inner.read().await;
        guard
            .sessions_by_repo
            .get(repo_key)
            .and_then(|repo_map| repo_map.get(session_id))
            .map(|snap| (snap.worktree_path.clone(), snap.base_branch.clone()))
    }
}

pub fn global_session_lookup_cache() -> &'static SessionLookupCache {
    use std::sync::LazyLock;
    static CACHE: LazyLock<SessionLookupCache> = LazyLock::new(SessionLookupCache::new);
    &CACHE
}

pub async fn current_repo_cache_key() -> Result<String, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project for cache lookup: {e}"))?;
    Ok(project.path.to_string_lossy().to_string())
}

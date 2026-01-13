use once_cell::sync::OnceCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

// Global singleton for session attention state (idle vs active)
static SESSION_ATTENTION_STATE: OnceCell<Arc<Mutex<SessionAttentionState>>> = OnceCell::new();

pub fn set_session_attention_state(state: Arc<Mutex<SessionAttentionState>>) {
    let _ = SESSION_ATTENTION_STATE.set(state);
}

pub fn get_session_attention_state() -> Option<Arc<Mutex<SessionAttentionState>>> {
    SESSION_ATTENTION_STATE.get().cloned()
}

#[derive(Debug, Default)]
pub struct AttentionStateRegistry {
    windows: HashMap<String, HashSet<String>>,
}

impl AttentionStateRegistry {
    pub fn update_snapshot<I>(&mut self, window_label: String, session_ids: I) -> usize
    where
        I: IntoIterator<Item = String>,
    {
        let snapshot: HashSet<String> = session_ids.into_iter().collect();
        if snapshot.is_empty() {
            self.windows.remove(&window_label);
        } else {
            self.windows.insert(window_label, snapshot);
        }
        self.total_unique_sessions()
    }

    pub fn clear_window(&mut self, window_label: &str) -> usize {
        self.windows.remove(window_label);
        self.total_unique_sessions()
    }

    pub fn total_unique_sessions(&self) -> usize {
        let mut unique: HashSet<String> = HashSet::new();
        for sessions in self.windows.values() {
            for key in sessions {
                unique.insert(key.clone());
            }
        }
        unique.len()
    }

    pub fn badge_count(total: usize) -> Option<i64> {
        match total {
            0 => None,
            _ => Some(std::cmp::min(total, 99) as i64),
        }
    }
}

#[derive(Debug, Default)]
pub struct SessionAttentionState {
    states: HashMap<String, bool>,
}

impl SessionAttentionState {
    pub fn update(&mut self, session_id: &str, needs_attention: bool) {
        if needs_attention {
            self.states.insert(session_id.to_string(), true);
        } else {
            self.states.remove(session_id);
        }
    }

    pub fn get(&self, session_id: &str) -> Option<bool> {
        self.states.get(session_id).copied()
    }

    pub fn get_all(&self) -> &HashMap<String, bool> {
        &self.states
    }

    pub fn clear_session(&mut self, session_id: &str) {
        self.states.remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::AttentionStateRegistry;

    #[test]
    fn updates_snapshot_and_counts_unique_sessions() {
        let mut registry = AttentionStateRegistry::default();

        let total = registry.update_snapshot(
            "window-a".to_string(),
            vec!["session-1".to_string(), "session-2".to_string()],
        );
        assert_eq!(total, 2);

        let total = registry.update_snapshot(
            "window-b".to_string(),
            vec!["session-2".to_string(), "session-3".to_string()],
        );
        assert_eq!(total, 3);

        let total = registry.update_snapshot("window-a".to_string(), Vec::<String>::new());
        assert_eq!(total, 2);
    }

    #[test]
    fn computes_badge_label() {
        assert_eq!(AttentionStateRegistry::badge_count(0), None);
        assert_eq!(AttentionStateRegistry::badge_count(1), Some(1));
        assert_eq!(AttentionStateRegistry::badge_count(9), Some(9));
        assert_eq!(AttentionStateRegistry::badge_count(10), Some(10));
        assert_eq!(AttentionStateRegistry::badge_count(150), Some(99));
    }

    #[test]
    fn session_attention_state_tracks_idle_sessions() {
        use super::SessionAttentionState;

        let mut state = SessionAttentionState::default();

        assert_eq!(state.get("session-1"), None);

        state.update("session-1", true);
        assert_eq!(state.get("session-1"), Some(true));

        state.update("session-2", true);
        assert_eq!(state.get_all().len(), 2);

        state.update("session-1", false);
        assert_eq!(state.get("session-1"), None);
        assert_eq!(state.get_all().len(), 1);

        state.clear_session("session-2");
        assert_eq!(state.get_all().len(), 0);
    }
}

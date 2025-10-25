use std::collections::{HashMap, HashSet};

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
}

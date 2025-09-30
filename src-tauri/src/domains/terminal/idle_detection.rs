use std::time::Instant;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use super::visible::VisibleScreen;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleTransition {
    BecameIdle,
    BecameActive,
}

pub struct IdleDetector {
    threshold_ms: u64,
    window_lines: usize,
    last_bytes_at: Option<Instant>,
    last_visible_change_at: Option<Instant>,
    last_hash: u64,
    idle_reported: bool,
    dirty: bool,
    pending_bytes: Vec<u8>,
}

impl IdleDetector {
    pub fn new(threshold_ms: u64, window_lines: usize) -> Self {
        Self {
            threshold_ms,
            window_lines,
            last_bytes_at: None,
            last_visible_change_at: None,
            last_hash: 0,
            idle_reported: false,
            dirty: false,
            pending_bytes: Vec::with_capacity(65536),
        }
    }

    pub fn observe_bytes(&mut self, now: Instant, bytes: &[u8]) -> Option<IdleTransition> {
        self.last_bytes_at = Some(now);

        if self.pending_bytes.len() + bytes.len() > 262144 {
            self.pending_bytes.clear();
        }

        self.pending_bytes.extend_from_slice(bytes);
        self.dirty = true;

        None
    }

    pub fn tick(&mut self, now: Instant, screen: &mut VisibleScreen) -> Option<IdleTransition> {
        if self.dirty {
            if !self.pending_bytes.is_empty() {
                screen.feed_bytes(&self.pending_bytes);
                self.pending_bytes.clear();
            }
            self.dirty = false;
        }

        let current_hash = {
            let mut hasher = DefaultHasher::new();
            screen.hash_tail_lines(self.window_lines).hash(&mut hasher);
            hasher.finish()
        };

        if current_hash != self.last_hash {
            self.last_hash = current_hash;
            self.last_visible_change_at = Some(now);

            if self.idle_reported {
                self.idle_reported = false;
                return Some(IdleTransition::BecameActive);
            }
        }

        let bytes_elapsed = self.last_bytes_at
            .map(|t| now.duration_since(t).as_millis() as u64)
            .unwrap_or(u64::MAX);
        let visible_elapsed = self.last_visible_change_at
            .map(|t| now.duration_since(t).as_millis() as u64)
            .unwrap_or(u64::MAX);

        let is_idle = bytes_elapsed >= self.threshold_ms && visible_elapsed >= self.threshold_ms;

        if is_idle && !self.idle_reported {
            self.idle_reported = true;
            return Some(IdleTransition::BecameIdle);
        }

        None
    }

    pub fn needs_tick(&self) -> bool {
        self.dirty || !self.idle_reported
    }
}

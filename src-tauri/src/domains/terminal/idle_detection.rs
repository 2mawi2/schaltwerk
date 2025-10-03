use super::visible::VisibleScreen;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Instant;

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

    pub fn apply_pending_now(&mut self, now: Instant, screen: &mut VisibleScreen) {
        if self.pending_bytes.is_empty() && !self.dirty {
            return;
        }

        if !self.pending_bytes.is_empty() {
            screen.feed_bytes(&self.pending_bytes);
            self.pending_bytes.clear();
        }

        self.dirty = false;

        let mut hasher = DefaultHasher::new();
        screen.hash_tail_lines(self.window_lines).hash(&mut hasher);
        let current_hash = hasher.finish();
        if current_hash != self.last_hash {
            self.last_visible_change_at = Some(now);
        }
        self.last_hash = current_hash;

        self.idle_reported = false;
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

        let bytes_elapsed = self
            .last_bytes_at
            .map(|t| now.duration_since(t).as_millis() as u64)
            .unwrap_or(u64::MAX);
        let visible_elapsed = self
            .last_visible_change_at
            .map(|t| now.duration_since(t).as_millis() as u64)
            .unwrap_or(u64::MAX);

        if self.idle_reported && bytes_elapsed < self.threshold_ms {
            self.idle_reported = false;
            self.last_visible_change_at = Some(now);
            return Some(IdleTransition::BecameActive);
        }

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

#[cfg(test)]
mod tests {
    use super::{IdleDetector, IdleTransition};
    use crate::domains::terminal::visible::VisibleScreen;
    use std::time::{Duration, Instant};

    #[test]
    fn becomes_active_on_recent_bytes_even_without_tail_change() {
        let threshold = 100u64;
        let mut detector = IdleDetector::new(threshold, 1);
        let mut screen = VisibleScreen::new(5, 40);

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"line1\nline2\nline3\nline4\nline5");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 10);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let activity_time = idle_time + Duration::from_millis(threshold / 2);
        detector.observe_bytes(activity_time, b"\x1b[2;1Hstreaming");

        // `hash_tail_lines(1)` still returns "line5" because only row 2 changed, but
        // we expect a BecameActive transition due to recent byte activity.
        assert_eq!(
            detector.tick(activity_time, &mut screen),
            Some(IdleTransition::BecameActive)
        );
    }
}

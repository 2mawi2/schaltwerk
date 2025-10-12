use super::visible::{ScreenSnapshot, VisibleScreen};
use log::info;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleTransition {
    BecameIdle,
    BecameActive,
}

pub struct IdleDetector {
    terminal_id: String,
    threshold_ms: u64,
    last_bytes_at: Option<Instant>,
    last_visible_change_at: Option<Instant>,
    last_snapshot: Option<ScreenSnapshot>,
    idle_reported: bool,
    dirty: bool,
    pending_bytes: Vec<u8>,
}

impl IdleDetector {
    pub fn new(threshold_ms: u64, terminal_id: String) -> Self {
        Self {
            terminal_id,
            threshold_ms,
            last_bytes_at: None,
            last_visible_change_at: None,
            last_snapshot: None,
            idle_reported: false,
            dirty: false,
            pending_bytes: Vec::with_capacity(65536),
        }
    }

    pub fn observe_bytes(&mut self, now: Instant, bytes: &[u8]) {
        self.last_bytes_at = Some(now);

        if self.pending_bytes.len() + bytes.len() > 262144 {
            self.pending_bytes.clear();
        }

        self.pending_bytes.extend_from_slice(bytes);
        self.dirty = true;
    }

    pub fn tick(&mut self, now: Instant, screen: &mut VisibleScreen) -> Option<IdleTransition> {
        let had_pending = self.dirty;

        if self.dirty {
            if !self.pending_bytes.is_empty() {
                screen.feed_bytes(&self.pending_bytes);
                self.pending_bytes.clear();
            }
            self.dirty = false;
        }

        if had_pending {
            let current_snapshot = screen.take_snapshot();
            let content_changed = if let Some(ref last_snap) = self.last_snapshot {
                current_snapshot.full_hash != last_snap.full_hash
            } else {
                true
            };

            if content_changed {
                self.last_visible_change_at = Some(now);
                self.last_snapshot = Some(current_snapshot);

                if self.idle_reported {
                    info!(
                        "[{}] Terminal became active (screen content changed)",
                        self.terminal_id
                    );
                    self.idle_reported = false;
                    return Some(IdleTransition::BecameActive);
                }
            } else if self.last_snapshot.is_none() {
                self.last_snapshot = Some(current_snapshot);
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
            info!(
                "[{}] Terminal became active (received bytes within threshold: {}ms < {}ms)",
                self.terminal_id, bytes_elapsed, self.threshold_ms
            );
            self.idle_reported = false;
            self.last_visible_change_at = Some(now);
            return Some(IdleTransition::BecameActive);
        }

        let is_idle = bytes_elapsed >= self.threshold_ms && visible_elapsed >= self.threshold_ms;

        if is_idle && !self.idle_reported {
            info!(
                "[{}] Terminal became idle (bytes_elapsed={}ms, visible_elapsed={}ms, threshold={}ms)",
                self.terminal_id, bytes_elapsed, visible_elapsed, self.threshold_ms
            );
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
    fn detects_idle_after_threshold() {
        let threshold = 100u64;
        let mut detector = IdleDetector::new(threshold, "test-terminal".to_string());
        let mut screen = VisibleScreen::new(5, 40, "test-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"line1\nline2\nline3\nline4\nline5");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 10);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );
    }

    #[test]
    fn becomes_active_on_content_change() {
        let threshold = 100u64;
        let mut detector = IdleDetector::new(threshold, "test-terminal".to_string());
        let mut screen = VisibleScreen::new(5, 40, "test-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"initial content");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 10);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let activity_time = idle_time + Duration::from_millis(50);
        detector.observe_bytes(activity_time, b"\nmore content that changes screen");
        assert_eq!(
            detector.tick(activity_time, &mut screen),
            Some(IdleTransition::BecameActive)
        );
    }

    #[test]
    fn becomes_active_on_recent_bytes_within_threshold() {
        let threshold = 100u64;
        let mut detector = IdleDetector::new(threshold, "test-terminal".to_string());
        let mut screen = VisibleScreen::new(5, 40, "test-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"line1\nline2\nline3\nline4\nline5");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 10);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let activity_time = idle_time + Duration::from_millis(threshold / 2);
        detector.observe_bytes(activity_time, b"more bytes");

        assert_eq!(
            detector.tick(activity_time, &mut screen),
            Some(IdleTransition::BecameActive)
        );
    }

    #[test]
    fn claude_loading_scenario_with_spinner() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "claude-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "claude-terminal".to_string());

        let baseline = Instant::now();

        detector.observe_bytes(
            baseline,
            b"\x1b[?25lGallivanting\xe2\x80\xa6 (esc to interrupt)",
        );
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let t1 = baseline + Duration::from_millis(100);
        detector.observe_bytes(
            t1,
            b"\x1b[1G\x1b[KCollecting\xe2\x80\xa6 (esc to interrupt)",
        );
        assert_eq!(detector.tick(t1, &mut screen), None);

        let t2 = t1 + Duration::from_millis(100);
        detector.observe_bytes(t2, b"\x1b[1G\x1b[KPondering\xe2\x80\xa6 (esc to interrupt)");
        assert_eq!(detector.tick(t2, &mut screen), None);

        let idle_time = t2 + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Claude loading spinner should not prevent idle detection after threshold"
        );
    }

    #[test]
    fn factory_droid_progress_bar_scenario() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "droid-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "droid-terminal".to_string());

        let baseline = Instant::now();

        detector.observe_bytes(baseline, b" Working (3s \xe2\x80\xa2 esc to interrupt)");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let t1 = baseline + Duration::from_millis(200);
        detector.observe_bytes(
            t1,
            b"\x1b[1G\x1b[K\xe2\x97\xa6 Working (3s \xe2\x80\xa2 esc to interrupt)",
        );
        assert_eq!(detector.tick(t1, &mut screen), None);

        let t2 = t1 + Duration::from_millis(200);
        detector.observe_bytes(
            t2,
            b"\x1b[1G\x1b[K\xe2\x97\x86 Working (4s \xe2\x80\xa2 esc to interrupt)",
        );
        assert_eq!(detector.tick(t2, &mut screen), None);

        let t3 = t2 + Duration::from_millis(200);
        detector.observe_bytes(
            t3,
            b"\x1b[1G\x1b[K\xe2\x97\x8b Working (4s \xe2\x80\xa2 esc to interrupt)",
        );
        assert_eq!(detector.tick(t3, &mut screen), None);

        let idle_time = t3 + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Factory Droid progress updates should not prevent idle detection after threshold"
        );
    }

    #[test]
    fn opencode_percentage_progress_scenario() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "opencode-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "opencode-terminal".to_string());

        let baseline = Instant::now();

        detector.observe_bytes(
            baseline,
            b"> Implement {feature}\n\n  85% context left \xc2\xb7 ? for shortcuts",
        );
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let t1 = baseline + Duration::from_millis(500);
        detector.observe_bytes(t1, b"\x1b[2;1H  84% context left \xc2\xb7 ? for shortcuts");
        assert_eq!(detector.tick(t1, &mut screen), None);

        let t2 = t1 + Duration::from_millis(500);
        detector.observe_bytes(t2, b"\x1b[2;1H  83% context left \xc2\xb7 ? for shortcuts");
        assert_eq!(detector.tick(t2, &mut screen), None);

        let t3 = t2 + Duration::from_millis(500);
        detector.observe_bytes(t3, b"\x1b[2;1H  82% context left \xc2\xb7 ? for shortcuts");
        assert_eq!(detector.tick(t3, &mut screen), None);

        let idle_time = t3 + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "OpenCode percentage updates should not prevent idle detection after threshold"
        );
    }

    #[test]
    fn detects_real_work_vs_idle_animations() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "agent-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "agent-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"Analyzing codebase...\n");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let t1 = baseline + Duration::from_millis(100);
        detector.observe_bytes(t1, b"Found 15 files\n");
        assert_eq!(detector.tick(t1, &mut screen), None);

        let t2 = t1 + Duration::from_millis(100);
        detector.observe_bytes(t2, b"Processing file 1 of 15\n");
        assert_eq!(detector.tick(t2, &mut screen), None);

        let idle_time = t2 + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Should become idle after no real output"
        );

        let active_time = idle_time + Duration::from_millis(100);
        detector.observe_bytes(active_time, b"Processing file 2 of 15\n");
        assert_eq!(
            detector.tick(active_time, &mut screen),
            Some(IdleTransition::BecameActive),
            "Real work output should mark as active"
        );
    }

    #[test]
    fn cursor_movement_only_should_trigger_activity() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "cursor-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "cursor-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"line1\nline2\nline3");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let active_time = idle_time + Duration::from_millis(100);
        detector.observe_bytes(active_time, b"\x1b[1;1H");
        assert_eq!(
            detector.tick(active_time, &mut screen),
            Some(IdleTransition::BecameActive),
            "Cursor movement should be detected as screen change"
        );
    }

    #[test]
    fn rapid_same_line_updates_are_detected() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "rapid-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "rapid-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"Progress: 0%");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        for i in 1..=10 {
            let t = baseline + Duration::from_millis(i * 100);
            detector.observe_bytes(t, format!("\x1b[1G\x1b[KProgress: {}%", i * 10).as_bytes());
            assert_eq!(
                detector.tick(t, &mut screen),
                None,
                "Rapid updates should keep terminal active"
            );
        }

        let after_updates = baseline + Duration::from_millis(1100);
        assert_eq!(
            detector.tick(after_updates, &mut screen),
            None,
            "Should still be active shortly after updates"
        );

        let idle_time = after_updates + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Should become idle after threshold with no new updates"
        );
    }

    #[test]
    fn middle_screen_streaming_is_detected() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "stream-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "stream-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"Header\n\nContent area:\n\n\n\n\n\n\n\nFooter");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let t1 = idle_time + Duration::from_millis(100);
        detector.observe_bytes(t1, b"\x1b[5;1Hstreaming data line 1");
        assert_eq!(
            detector.tick(t1, &mut screen),
            Some(IdleTransition::BecameActive),
            "Streaming to middle of screen should be detected"
        );
    }

    #[test]
    fn no_visual_change_but_bytes_received() {
        let threshold = 1000u64;
        let mut detector = IdleDetector::new(threshold, "novisual-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "novisual-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"static content");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let idle_time = baseline + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle)
        );

        let t1 = idle_time + Duration::from_millis(50);
        detector.observe_bytes(t1, b"\x07");
        assert_eq!(
            detector.tick(t1, &mut screen),
            Some(IdleTransition::BecameActive),
            "Bytes within threshold should trigger active even without visual change"
        );
    }

    #[test]
    fn pending_bytes_buffer_overflow_protection() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "overflow-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "overflow-terminal".to_string());

        let baseline = Instant::now();
        let large_data = vec![b'X'; 300000];
        detector.observe_bytes(baseline, &large_data);

        let t1 = baseline + Duration::from_millis(10);
        assert_eq!(
            detector.tick(t1, &mut screen),
            None,
            "Should handle buffer overflow gracefully"
        );

        let idle_time = t1 + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Should still detect idle after buffer overflow"
        );
    }

    #[test]
    fn agent_working_silently_without_output() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "silent-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "silent-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"> Implement {feature}\n\n  85% context left");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let t1 = baseline + Duration::from_millis(1000);
        assert_eq!(
            detector.tick(t1, &mut screen),
            None,
            "Should still be active within threshold"
        );

        let idle_time = baseline + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(idle_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Agent working silently (reading files, analyzing) will be marked as idle - THIS IS THE LIMITATION"
        );
    }

    #[test]
    fn cannot_distinguish_silent_work_from_true_idle() {
        let threshold = 5000u64;
        let mut detector = IdleDetector::new(threshold, "ambiguous-terminal".to_string());
        let mut screen = VisibleScreen::new(24, 80, "ambiguous-terminal".to_string());

        let baseline = Instant::now();
        detector.observe_bytes(baseline, b"Analyzing codebase...");
        assert_eq!(detector.tick(baseline, &mut screen), None);

        let long_analysis_time = baseline + Duration::from_millis(threshold + 100);
        assert_eq!(
            detector.tick(long_analysis_time, &mut screen),
            Some(IdleTransition::BecameIdle),
            "Cannot distinguish between: 1) Agent analyzing files silently, 2) Agent waiting for user input, 3) Agent crashed/stuck"
        );
    }
}

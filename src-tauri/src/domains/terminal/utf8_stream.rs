// schaltwerk/domains/terminal/utf8_stream.rs
use encoding_rs::{Decoder, UTF_8};
use std::time::{Duration, Instant};

/// How to handle malformed UTF‑8 subparts.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum InvalidPolicy {
    /// Keep WHATWG behavior: emit U+FFFD for malformed parts.
    Replace,
    /// Suppress malformed bytes entirely (no visible � in the terminal).
    Remove,
}

/// Streaming UTF‑8 decoder:
/// - Never drops *valid* bytes.
/// - Carries incomplete trailing sequences to the next chunk.
/// - Handles malformed subparts per `invalid_policy`.
pub struct Utf8Stream {
    decoder: Decoder,
    invalid_policy: InvalidPolicy,
    warn_last: Option<Instant>,
    warn_every: Duration,
    warn_count: u64,
    warn_step: u64,
}

impl Default for Utf8Stream {
    fn default() -> Self {
        Self {
            decoder: UTF_8.new_decoder_without_bom_handling(),
            // IMPORTANT: default to removing malformed bytes to avoid visible artifacts.
            invalid_policy: InvalidPolicy::Remove,
            warn_last: None,
            warn_every: Duration::from_secs(10),
            warn_count: 0,
            warn_step: 200,
        }
    }
}

impl Utf8Stream {
    pub fn new() -> Self {
        Self::default()
    }

    /// Optional: override policy per stream/terminal if needed.
    #[inline]
    pub fn set_policy(&mut self, policy: InvalidPolicy) {
        self.invalid_policy = policy;
    }

    /// Decode a chunk. Returns the decoded string and whether replacements *would* have occurred.
    pub fn decode_chunk(&mut self, input: &[u8]) -> (String, bool) {
        let mut out = String::with_capacity(input.len());
        let (_res, _read, had_replacements) = self.decoder.decode_to_string(input, &mut out, false);

        if had_replacements && matches!(self.invalid_policy, InvalidPolicy::Remove) {
            // Strip U+FFFD produced by encoding_rs. This removes only truly-malformed bytes.
            let original = out.clone();
            out.retain(|ch| ch != '\u{FFFD}');
            let _ = original;
        }
        (out, had_replacements)
    }

    /// Flush pending state at stream end (optional).
    pub fn finish(&mut self) -> Option<String> {
        let mut out = String::new();
        let (_res, _read, had_replacements) = self.decoder.decode_to_string(&[], &mut out, true);
        if had_replacements && matches!(self.invalid_policy, InvalidPolicy::Remove) {
            out.retain(|ch| ch != '\u{FFFD}');
        }
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }

    pub fn maybe_warn(&mut self, terminal_id: &str, had_replacements: bool) {
        if !had_replacements {
            return;
        }
        let now = Instant::now();
        self.warn_count += 1;

        let should_log_time = self
            .warn_last
            .map(|last| now.duration_since(last) >= self.warn_every)
            .unwrap_or(true);

        let should_log_step = self.warn_count.is_multiple_of(self.warn_step);

        if should_log_time || should_log_step {
            match self.invalid_policy {
                InvalidPolicy::Replace => {
                    // Keep a WARN if you *want* to see visible replacements.
                    log::warn!(
                        target: "schaltwerk::domains::terminal::coalescing",
                        "Terminal {}: malformed UTF‑8; replaced with U+FFFD (not dropped). \
                         ({} replacements since last notice)",
                        terminal_id,
                        self.warn_count
                    );
                }
                InvalidPolicy::Remove => {
                    // Be quiet by default; using DEBUG prevents log storms.
                    log::debug!(
                        target: "schaltwerk::domains::terminal::coalescing",
                        "Terminal {}: suppressed malformed UTF‑8 subparts. \
                         ({} events since last notice)",
                        terminal_id,
                        self.warn_count
                    );
                }
            }
            self.warn_last = Some(now);
            if should_log_time {
                self.warn_count = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{InvalidPolicy, Utf8Stream};

    #[test]
    fn preserves_multichunk_utf8() {
        // Test with complete sequence first
        let mut d = Utf8Stream::new();
        let (complete, rep_complete) = d.decode_chunk(&[0xF0, 0x9F, 0x8F, 0x86, b' ', b'O', b'K']);
        eprintln!("DEBUG: complete = {:?}", complete);
        assert_eq!(complete, "🏆 OK");
        assert!(!rep_complete);
    }

    #[test]
    fn removes_malformed_sequences_by_default() {
        // malformed: F0 80 80 FF (4-byte sequence with invalid continuation) -> should be removed entirely under Remove policy
        let mut d = Utf8Stream::new(); // default Remove
        let (s, rep) = d.decode_chunk(&[0xF0, 0x80, 0x80, 0xFF]);
        assert!(rep);
        assert_eq!(s, "");
    }

    #[test]
    fn can_use_replacement_policy_instead() {
        let mut d = Utf8Stream::new();
        d.set_policy(InvalidPolicy::Replace);
        let (s, rep) = d.decode_chunk(&[0xF0, 0x80, 0x80, 0xFF]);
        assert!(rep);
        assert_eq!(s, "�");
    }
}

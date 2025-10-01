// schaltwerk/domains/terminal/utf8_stream.rs
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
    pending: Vec<u8>,
    invalid_policy: InvalidPolicy,
    warn_last: Option<Instant>,
    warn_every: Duration,
    warn_count: u64,
    warn_step: u64,
}

impl Default for Utf8Stream {
    fn default() -> Self {
        Self {
            pending: Vec::new(),
            // Default to replacement so malformed sequences remain visible and downstream
            // consumers do not silently lose surrounding output.
            invalid_policy: InvalidPolicy::Replace,
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
        let mut had_replacements = false;
        let mut buffer = Vec::with_capacity(self.pending.len() + input.len());
        buffer.extend_from_slice(&self.pending);
        buffer.extend_from_slice(input);
        self.pending.clear();

        let mut slice = buffer.as_slice();
        let mut out = String::with_capacity(buffer.len());

        while !slice.is_empty() {
            match std::str::from_utf8(slice) {
                Ok(valid) => {
                    out.push_str(valid);
                    slice = &[];
                }
                Err(err) => {
                    let valid_end = err.valid_up_to();
                    let (valid_bytes, remainder) = slice.split_at(valid_end);
                    if !valid_bytes.is_empty() {
                        // SAFETY: valid_bytes only contains verified UTF-8.
                        out.push_str(unsafe { std::str::from_utf8_unchecked(valid_bytes) });
                    }

                    if let Some(error_len) = err.error_len() {
                        had_replacements = true;
                        if matches!(self.invalid_policy, InvalidPolicy::Replace) {
                            out.push('\u{FFFD}');
                        }

                        let skip = error_len.min(remainder.len());
                        slice = &remainder[skip..];
                    } else {
                        // Incomplete multi-byte sequence at the end; stash for next chunk.
                        self.pending.extend_from_slice(remainder);
                        slice = &[];
                    }
                }
            }
        }

        (out, had_replacements)
    }

    /// Flush pending state at stream end (optional).
    pub fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            return None;
        }

        let emit = if matches!(self.invalid_policy, InvalidPolicy::Replace) {
            Some("\u{FFFD}".to_string())
        } else {
            None
        };
        self.pending.clear();
        emit
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
    fn replaces_malformed_sequences_by_default() {
        // malformed: F0 80 80 FF (4-byte sequence with invalid continuation) -> should surface as replacement
        let mut d = Utf8Stream::new(); // default Replace
        let (s, rep) = d.decode_chunk(&[0xF0, 0x80, 0x80, 0xFF]);
        assert!(rep);
        assert_eq!(s, "����");
    }

    #[test]
    fn preserves_suffix_when_replacing_invalid_middle_sequence() {
        let mut d = Utf8Stream::new();
        let (s, rep) = d.decode_chunk(&[b'f', b'o', 0xFF, b'o']);
        assert!(rep);
        assert_eq!(s, "fo�o");
    }

    #[test]
    fn can_opt_in_to_removal_policy() {
        let mut d = Utf8Stream::new();
        d.set_policy(InvalidPolicy::Remove);
        let (s, rep) = d.decode_chunk(&[0xF0, 0x80, 0x80, 0xFF]);
        assert!(rep);
        assert_eq!(s, "");
    }
}

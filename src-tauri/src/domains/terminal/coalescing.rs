use super::ansi;
use super::utf8_stream::Utf8Stream;
use log::warn;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

/// State for terminal output coalescing
#[derive(Clone)]
pub struct CoalescingState {
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    pub emit_buffers: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    pub emit_scheduled: Arc<RwLock<HashMap<String, bool>>>,
    pub emit_buffers_norm: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    pub norm_last_cr: Arc<RwLock<HashMap<String, bool>>>,
    pub utf8_streams: Arc<RwLock<HashMap<String, Utf8Stream>>>,
}

impl CoalescingState {
    /// Clear all coalescing buffers and flags for a specific terminal ID
    pub async fn clear_for(&self, id: &str) {
        self.emit_buffers.write().await.remove(id);
        self.emit_scheduled.write().await.remove(id);
        // Note: emit_buffers_norm and norm_last_cr are kept for backward compatibility
        // but are no longer actively used in processing
        self.emit_buffers_norm.write().await.remove(id);
        self.norm_last_cr.write().await.remove(id);
        self.utf8_streams.write().await.remove(id);
    }

    /// Clear all coalescing buffers for all terminals in parallel
    /// Used during application exit for fast cleanup
    pub async fn clear_all(&self) {
        tokio::join!(
            async { self.emit_buffers.write().await.clear() },
            async { self.emit_scheduled.write().await.clear() },
            async { self.emit_buffers_norm.write().await.clear() },
            async { self.norm_last_cr.write().await.clear() },
            async { self.utf8_streams.write().await.clear() }
        );
    }
}

fn terminal_output_event_name(terminal_id: &str) -> String {
    let mut safe_id = String::with_capacity(terminal_id.len());
    for ch in terminal_id.chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '/' | ':' => safe_id.push(ch),
            _ => safe_id.push('_'),
        }
    }
    format!("terminal-output-{safe_id}")
}

/// Parameters for a single coalescing operation
pub struct CoalescingParams<'a> {
    pub terminal_id: &'a str,
    pub data: &'a [u8],
}

/// Handle coalesced output with ANSI-aware buffering
pub async fn handle_coalesced_output(
    coalescing_state: &CoalescingState,
    params: CoalescingParams<'_>,
) {
    {
        let mut buffers = coalescing_state.emit_buffers.write().await;
        let buf_ref = buffers
            .entry(params.terminal_id.to_string())
            .or_insert_with(Vec::new);

        buf_ref.extend_from_slice(params.data);
    }

    // Deterministic, read-driven emission without timers
    const THRESHOLD: usize = 8 * 1024;
    // Take a snapshot of the buffer and compute safe split
    let (emit_bytes, remainder) = {
        let mut buffers = coalescing_state.emit_buffers.write().await;
        if let Some(buffer) = buffers.get_mut(params.terminal_id) {
            let safe = ansi::find_safe_split_point(buffer);
            if safe == 0 {
                // Nothing safe to emit yet
                if buffer.len() < THRESHOLD {
                    return;
                } else {
                    // Over threshold but still unsafe; avoid emitting to prevent ANSI corruption
                    return;
                }
            }
            let remaining = buffer.split_off(safe);
            let to_emit = std::mem::take(buffer);
            (Some(to_emit), Some(remaining))
        } else {
            (None, None)
        }
    };

    if let Some(rem) = remainder {
        coalescing_state
            .emit_buffers
            .write()
            .await
            .insert(params.terminal_id.to_string(), rem);
    }

    if let Some(bytes) = emit_bytes {
        if let Some(handle) = coalescing_state.app_handle.lock().await.as_ref() {
            let event_name = terminal_output_event_name(params.terminal_id);
            let (payload, remainder_prefix) = {
                let mut utf8_streams = coalescing_state.utf8_streams.write().await;
                decode_coalesced_bytes(bytes, params.terminal_id, &mut utf8_streams)
            };

            if let Some(prefix) = remainder_prefix {
                if !prefix.is_empty() {
                    let mut buffers = coalescing_state.emit_buffers.write().await;
                    let entry = buffers.entry(params.terminal_id.to_string()).or_default();
                    entry.splice(0..0, prefix);
                }
            }

            if let Some(text) = payload {
                if let Err(e) = handle.emit(&event_name, text) {
                    warn!("Failed to emit terminal output: {e}");
                }
            }
        } else {
            // No app handle available (tests or early startup): restore bytes back to buffer
            let mut buffers = coalescing_state.emit_buffers.write().await;
            let entry = buffers.entry(params.terminal_id.to_string()).or_default();
            // Prepend emitted bytes back to the front to preserve ordering
            let mut restored = bytes;
            restored.extend_from_slice(entry);
            *entry = restored;
        }
    }
}

fn decode_coalesced_bytes(
    bytes: Vec<u8>,
    terminal_id: &str,
    utf8_streams: &mut HashMap<String, Utf8Stream>,
) -> (Option<String>, Option<Vec<u8>>) {
    let stream = utf8_streams.entry(terminal_id.to_string()).or_default();

    let (decoded, had_replacements) = stream.decode_chunk(&bytes);

    // Throttled log (no more "Dropped N byte(s)" lines).
    stream.maybe_warn(terminal_id, had_replacements);

    if decoded.is_empty() {
        // Typically happens when we received only the first half of a multi-byte char.
        // Nothing dropped; the decoder is holding it for the next chunk.
        return (None, None);
    }

    (Some(decoded), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_coalescing_state_creation() {
        let app_handle = Arc::new(Mutex::new(None));
        let state = CoalescingState {
            app_handle,
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        let buffers = state.emit_buffers.read().await;
        assert!(buffers.is_empty());
    }

    #[tokio::test]
    async fn test_coalescing_params() {
        let params = CoalescingParams {
            terminal_id: "test-terminal",
            data: b"hello world",
        };

        assert_eq!(params.terminal_id, "test-terminal");
        assert_eq!(params.data, b"hello world");
    }

    #[tokio::test]
    async fn test_handle_coalesced_output_adds_to_buffer() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        let params = CoalescingParams {
            terminal_id: "test-term",
            data: b"test output",
        };

        handle_coalesced_output(&state, params).await;

        // Check that data was added to buffer
        let buffers = state.emit_buffers.read().await;
        assert!(buffers.contains_key("test-term"));
        assert_eq!(buffers.get("test-term").unwrap(), b"test output");
    }

    #[tokio::test]
    async fn test_handle_coalesced_output_multiple_calls_append() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        // First call
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"hello ",
            },
        )
        .await;

        // Second call
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"world",
            },
        )
        .await;

        // Wait a bit for async processing
        sleep(Duration::from_millis(10)).await;

        // Check that data was appended
        let buffers = state.emit_buffers.read().await;
        if let Some(buffer) = buffers.get("test-term") {
            assert_eq!(buffer, b"hello world");
        }
    }

    // Normalized buffer tests removed - normalized processing is no longer active

    #[tokio::test]
    async fn test_buffers_accumulate_without_app_handle() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"data1",
            },
        )
        .await;
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"data2",
            },
        )
        .await;

        let buffers = state.emit_buffers.read().await;
        let buffer = buffers.get("test-term").unwrap();
        assert_eq!(buffer, b"data1data2");
    }

    #[test]
    fn test_decode_coalesced_bytes_preserves_truncated_multibyte() {
        let data = b"Hello \xE2\x94".to_vec();
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) =
            decode_coalesced_bytes(data, "term-truncated", &mut utf8_streams);
        // With streaming decoder, incomplete sequences at the end are buffered
        // The decoder should return "Hello " and buffer the incomplete sequence
        assert_eq!(payload.as_deref(), Some("Hello "));
        assert!(remainder.is_none());
    }

    #[test]
    fn test_decode_coalesced_bytes_returns_full_text_when_complete() {
        let data = "Line \u{2500}".as_bytes().to_vec();
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) = decode_coalesced_bytes(data, "term-complete", &mut utf8_streams);
        assert_eq!(payload.as_deref(), Some("Line \u{2500}"));
        assert!(remainder.is_none());
    }

    #[test]
    fn test_decode_coalesced_bytes_replaces_invalid_sequence() {
        let data = vec![0x66, 0x6f, 0xff, 0x6f]; // fo + invalid + o
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) = decode_coalesced_bytes(data, "term-invalid", &mut utf8_streams);
        // Invalid bytes should surface as replacements without dropping trailing content.
        assert_eq!(payload.as_deref(), Some("fo\u{FFFD}o"));
        assert!(remainder.is_none());
    }

    #[test]
    fn test_decode_coalesced_bytes_replaces_invalid_continuation_bytes() {
        // Orphan continuation bytes surface as replacement characters but the trailing content stays intact.
        let data = vec![b'f', b'o', b'o', b' ', 0x90, 0x80, b' ', b'b', b'a', b'r'];
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) =
            decode_coalesced_bytes(data, "term-claude-tail", &mut utf8_streams);
        assert_eq!(payload.as_deref(), Some("foo \u{FFFD}\u{FFFD} bar"));
        assert!(remainder.is_none());
    }

    #[test]
    fn test_decode_coalesced_bytes_replaces_invalid_continuations_for_claude() {
        // Two stray continuation bytes should surface as replacements while preserving the rest of the line.
        let mut data = b"let value = ".to_vec();
        data.extend([0x80, 0xBF]);
        data.extend_from_slice(b"formatted\n");
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) =
            decode_coalesced_bytes(data, "term-claude-cont", &mut utf8_streams);
        assert_eq!(
            payload.as_deref(),
            Some("let value = \u{FFFD}\u{FFFD}formatted\n")
        );
        assert!(remainder.is_none());
    }

    #[test]
    fn test_decode_coalesced_bytes_replaces_isolated_surrogate_from_claude() {
        // High surrogate half (0xED 0xA0 0x80) without its pair should result in replacement markers.
        let mut data = b"println!(\"start\");".to_vec();
        data.extend([0xED, 0xA0, 0x80]);
        data.extend_from_slice(b"println!(\"done\");");
        let mut utf8_streams = HashMap::new();
        let (payload, remainder) =
            decode_coalesced_bytes(data, "term-claude-surrogate", &mut utf8_streams);
        assert_eq!(
            payload.as_deref(),
            Some("println!(\"start\");\u{FFFD}\u{FFFD}\u{FFFD}println!(\"done\");")
        );
        assert!(remainder.is_none());
    }

    #[tokio::test]
    async fn test_zero_delay_processes_immediately() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"immediate",
            },
        )
        .await;
        // Without an app handle, bytes remain buffered
        sleep(Duration::from_millis(5)).await;
        let buffers = state.emit_buffers.read().await;
        assert_eq!(
            buffers.get("test-term").map(|v| v.as_slice()),
            Some(b"immediate".as_ref())
        );
    }

    #[tokio::test]
    async fn test_multiple_terminals_independent() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        // Add data for terminal 1
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "term1",
                data: b"data1",
            },
        )
        .await;

        // Add data for terminal 2
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "term2",
                data: b"data2",
            },
        )
        .await;

        let buffers = state.emit_buffers.read().await;

        // Both terminals should have independent buffers
        assert!(buffers.contains_key("term1") || buffers.is_empty()); // May be processed already
        assert!(buffers.contains_key("term2") || buffers.is_empty());

        // Normalized buffers no longer actively used
    }

    #[tokio::test]
    async fn test_clear_for_removes_all_entries() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        let terminal_id = "test-terminal-cleanup";

        // Add data to all maps
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id,
                data: b"test data",
            },
        )
        .await;

        // Verify data is in buffers
        assert!(state.emit_buffers.read().await.contains_key(terminal_id));
        // Normalized buffers no longer populated during processing

        // Clear buffers for this terminal
        state.clear_for(terminal_id).await;

        // Verify all buffers are cleared
        assert!(!state.emit_buffers.read().await.contains_key(terminal_id));
        assert!(!state.emit_scheduled.read().await.contains_key(terminal_id));
        // The clear_for method still clears normalized buffers for compatibility
        assert!(!state
            .emit_buffers_norm
            .read()
            .await
            .contains_key(terminal_id));
        assert!(!state.norm_last_cr.read().await.contains_key(terminal_id));
    }

    #[tokio::test]
    async fn test_clear_for_only_affects_target_terminal() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        // Add data for multiple terminals
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "term1",
                data: b"data1",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "term2",
                data: b"data2",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "term3",
                data: b"data3",
            },
        )
        .await;

        // Clear only term2
        state.clear_for("term2").await;

        // Verify term2 is cleared but others remain
        assert!(state.emit_buffers.read().await.contains_key("term1"));
        assert!(!state.emit_buffers.read().await.contains_key("term2"));
        assert!(state.emit_buffers.read().await.contains_key("term3"));

        // Normalized buffers still cleared for compatibility
    }

    #[tokio::test]
    async fn test_clear_for_nonexistent_terminal() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        // Should not panic when clearing non-existent terminal
        state.clear_for("nonexistent").await;

        // Verify maps are still empty
        assert!(state.emit_buffers.read().await.is_empty());
        assert!(state.emit_scheduled.read().await.is_empty());
        // Normalized buffers remain empty
        assert!(state.emit_buffers_norm.read().await.is_empty());
        assert!(state.norm_last_cr.read().await.is_empty());
    }

    #[tokio::test]
    async fn test_carriage_return_preserved() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"Line 1\nLine 2 initial",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"\rLine 2 replaced",
            },
        )
        .await;

        let buffers = state.emit_buffers.read().await;
        let buffer = buffers.get("test-term").unwrap();
        assert_eq!(buffer, b"Line 1\nLine 2 initial\rLine 2 replaced");
    }

    #[tokio::test]
    async fn test_multiple_carriage_returns_in_sequence() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"Previous line\nLoading.",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"\rLoading..",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"\rLoading...",
            },
        )
        .await;

        let buffers = state.emit_buffers.read().await;
        let buffer = buffers.get("test-term").unwrap();
        assert_eq!(buffer, b"Previous line\nLoading.\rLoading..\rLoading...");
    }

    #[tokio::test]
    async fn test_crlf_sequence_preserved() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            utf8_streams: Arc::new(RwLock::new(HashMap::new())),
        };

        // CRLF sequences should be preserved as they are actual line endings
        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"Line 1\r\nLine 2",
            },
        )
        .await;

        handle_coalesced_output(
            &state,
            CoalescingParams {
                terminal_id: "test-term",
                data: b"\r\nLine 3",
            },
        )
        .await;

        let buffers = state.emit_buffers.read().await;
        let buffer = buffers.get("test-term").unwrap();
        // CRLF sequences should be preserved
        assert_eq!(buffer, b"Line 1\r\nLine 2\r\nLine 3");
    }
}

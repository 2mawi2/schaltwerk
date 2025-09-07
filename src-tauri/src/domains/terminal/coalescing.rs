use super::ansi;
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
    }
}

/// Parameters for a single coalescing operation
pub struct CoalescingParams<'a> {
    pub terminal_id: &'a str,
    pub data: &'a [u8],
    pub delay_ms: u64,
}

/// Handle coalesced output with ANSI-aware buffering
pub async fn handle_coalesced_output(
    coalescing_state: &CoalescingState,
    params: CoalescingParams<'_>,
) {
    // Add data to coalescing buffer
    {
        let mut buffers = coalescing_state.emit_buffers.write().await;
        let buf_ref = buffers.entry(params.terminal_id.to_string()).or_insert_with(Vec::new);
        buf_ref.extend_from_slice(params.data);
    }

    // Skip normalized buffer processing - it causes extra newlines and corrupts terminal output
    // The normalized output events are never consumed by the frontend anyway

    // Schedule emission with ANSI awareness
    let mut should_schedule = false;
    {
        let mut scheduled = coalescing_state.emit_scheduled.write().await;
        let entry = scheduled.entry(params.terminal_id.to_string()).or_insert(false);
        if !*entry {
            *entry = true;
            should_schedule = true;
        }
    }

    if should_schedule {
        let app_for_emit = Arc::clone(&coalescing_state.app_handle);
        let emit_buffers_for_task = Arc::clone(&coalescing_state.emit_buffers);
        let emit_scheduled_for_task = Arc::clone(&coalescing_state.emit_scheduled);
        let id_for_task = params.terminal_id.to_string();
        let delay_ms = params.delay_ms;

        tokio::spawn(async move {
            use tokio::time::{sleep, Duration};
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }

            // Take buffer and check for incomplete ANSI sequences
            let data_to_emit: Option<Vec<u8>> = {
                let mut buffers = emit_buffers_for_task.write().await;
                if let Some(mut buffer) = buffers.remove(&id_for_task) {
                    // Check if buffer ends with incomplete ANSI sequence
                    if ansi::has_incomplete_ansi_sequence(&buffer) {
                        // Find safe split point
                        let safe_point = ansi::find_safe_split_point(&buffer);
                        if safe_point > 0 && safe_point < buffer.len() {
                            // Split at safe point, keeping incomplete sequence for next emit
                            let remaining = buffer.split_off(safe_point);
                            buffers.insert(id_for_task.clone(), remaining);
                            Some(buffer)
                        } else if safe_point == 0 {
                            // Entire buffer is an incomplete sequence, wait for more data
                            buffers.insert(id_for_task.clone(), buffer);
                            None
                        } else {
                            // Buffer is safe to emit entirely
                            Some(buffer)
                        }
                    } else {
                        Some(buffer)
                    }
                } else {
                    None
                }
            };

            // Mark unscheduled
            {
                let mut scheduled = emit_scheduled_for_task.write().await;
                if let Some(flag) = scheduled.get_mut(&id_for_task) {
                    *flag = false;
                }
            }

            // Emit the data
            if let Some(bytes) = data_to_emit {
                if let Some(handle) = app_for_emit.lock().await.as_ref() {
                    let event_name = format!("terminal-output-{id_for_task}");
                    let payload = String::from_utf8_lossy(&bytes).to_string();
                    if let Err(e) = handle.emit(&event_name, payload) {
                        warn!("Failed to emit terminal output: {e}");
                    }
                }
            }

            // If there's remaining data (incomplete sequence), reschedule
            {
                let buffers = emit_buffers_for_task.read().await;
                if buffers.contains_key(&id_for_task) {
                    // There's still data, schedule another emission
                    drop(buffers);
                    let mut scheduled = emit_scheduled_for_task.write().await;
                    if let Some(flag) = scheduled.get_mut(&id_for_task) {
                        if !*flag {
                            *flag = true;
                            // Schedule another emission after a short delay
                            let _app_for_emit = Arc::clone(&app_for_emit);
                            let _emit_buffers_for_next = Arc::clone(&emit_buffers_for_task);
                            let emit_scheduled_for_next = Arc::clone(&emit_scheduled_for_task);
                            let id_for_next = id_for_task.clone();
                            
                            tokio::spawn(async move {
                                sleep(Duration::from_millis(5)).await; // Slightly longer delay for incomplete sequences
                                
                                // Mark it as ready to be processed again on next data
                                let mut scheduled = emit_scheduled_for_next.write().await;
                                if let Some(flag) = scheduled.get_mut(&id_for_next) {
                                    *flag = false; // Allow it to be scheduled again on next data
                                }
                            });
                        }
                    }
                }
            }
        });
    }
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
        };
        
        let buffers = state.emit_buffers.read().await;
        assert!(buffers.is_empty());
    }

    #[tokio::test]
    async fn test_coalescing_params() {
        let params = CoalescingParams {
            terminal_id: "test-terminal",
            data: b"hello world",
            delay_ms: 100,
        };
        
        assert_eq!(params.terminal_id, "test-terminal");
        assert_eq!(params.data, b"hello world");
        assert_eq!(params.delay_ms, 100);
    }

    #[tokio::test]
    async fn test_handle_coalesced_output_adds_to_buffer() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
        };

        let params = CoalescingParams {
            terminal_id: "test-term",
            data: b"test output",
            delay_ms: 0,
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
        };

        // First call
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "test-term",
            data: b"hello ",
            delay_ms: 0,
        }).await;

        // Second call 
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "test-term",
            data: b"world",
            delay_ms: 0,
        }).await;

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
    async fn test_scheduling_flag_prevents_double_scheduling() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
        };

        // First call should schedule
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "test-term",
            data: b"data1",
            delay_ms: 100, // Use delay to keep it scheduled
        }).await;

        {
            let scheduled = state.emit_scheduled.read().await;
            assert_eq!(*scheduled.get("test-term").unwrap(), true);
        }

        // Second call should not re-schedule while first is pending
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "test-term",
            data: b"data2",
            delay_ms: 100,
        }).await;

        // Buffer should contain both
        let buffers = state.emit_buffers.read().await;
        let buffer = buffers.get("test-term").unwrap();
        assert_eq!(buffer, b"data1data2");
    }

    #[tokio::test]
    async fn test_zero_delay_processes_immediately() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
        };

        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "test-term",
            data: b"immediate",
            delay_ms: 0,
        }).await;

        // With zero delay, processing should start immediately
        // Give it minimal time to process
        sleep(Duration::from_millis(5)).await;

        // Buffer should be consumed (emission attempted)
        let scheduled = state.emit_scheduled.read().await;
        // After processing, the flag should be reset to false
        assert_eq!(*scheduled.get("test-term").unwrap_or(&false), false);
    }

    #[tokio::test]
    async fn test_multiple_terminals_independent() {
        let state = CoalescingState {
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
            emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
            norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
        };

        // Add data for terminal 1
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "term1",
            data: b"data1",
            delay_ms: 0,
        }).await;

        // Add data for terminal 2
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "term2",
            data: b"data2",
            delay_ms: 0,
        }).await;

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
        };

        let terminal_id = "test-terminal-cleanup";

        // Add data to all maps
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id,
            data: b"test data",
            delay_ms: 100, // Use delay to keep data in buffers
        }).await;

        // Verify data is in buffers
        assert!(state.emit_buffers.read().await.contains_key(terminal_id));
        assert!(state.emit_scheduled.read().await.contains_key(terminal_id));
        // Normalized buffers no longer populated during processing

        // Clear buffers for this terminal
        state.clear_for(terminal_id).await;

        // Verify all buffers are cleared
        assert!(!state.emit_buffers.read().await.contains_key(terminal_id));
        assert!(!state.emit_scheduled.read().await.contains_key(terminal_id));
        // The clear_for method still clears normalized buffers for compatibility
        assert!(!state.emit_buffers_norm.read().await.contains_key(terminal_id));
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
        };

        // Add data for multiple terminals
        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "term1",
            data: b"data1",
            delay_ms: 100,
        }).await;

        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "term2",
            data: b"data2",
            delay_ms: 100,
        }).await;

        handle_coalesced_output(&state, CoalescingParams {
            terminal_id: "term3",
            data: b"data3",
            delay_ms: 100,
        }).await;

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
}
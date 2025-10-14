use super::coalescing::{handle_coalesced_output, CoalescingParams, CoalescingState};
use super::command_builder::build_command_spec;
use super::control_sequences::{sanitize_control_sequences, SanitizedOutput, SequenceResponse};
use super::idle_detection::{IdleDetector, IdleTransition};
use super::lifecycle::{self, LifecycleDeps};
use super::visible::VisibleScreen;
use super::{CreateParams, TerminalBackend, TerminalSnapshot};
use crate::infrastructure::events::{emit_event, SchaltEvent};
use crate::shared::terminal_id::is_session_top_terminal_id;
use log::{debug, error, info, warn};
use portable_pty::{Child, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::AppHandle;
use tokio::sync::{broadcast, Mutex, RwLock};

const DEFAULT_MAX_BUFFER_SIZE: usize = 2 * 1024 * 1024;
const AGENT_MAX_BUFFER_SIZE: usize = 64 * 1024 * 1024;
const IDLE_THRESHOLD_MS: u64 = 5000;
pub(super) struct TerminalState {
    pub(super) buffer: Vec<u8>,
    pub(super) seq: u64,
    pub(super) start_seq: u64,
    pub(super) last_output: SystemTime,
    pub(super) screen: VisibleScreen,
    pub(super) idle_detector: IdleDetector,
    pub(super) session_id: Option<String>,
}

impl TerminalState {
    fn cursor_position_response(&mut self, id: &str, count: usize) -> Option<Vec<u8>> {
        if count == 0 {
            return None;
        }

        let (row_zero, col_zero) = self.screen.cursor_position();
        let row = u32::from(row_zero.saturating_add(1));
        let col = u32::from(col_zero.saturating_add(1));

        let sequence = format!("\x1b[{row};{col}R");
        let mut response = Vec::with_capacity(sequence.len() * count);
        for _ in 0..count {
            response.extend_from_slice(sequence.as_bytes());
        }

        debug!("Responding to {count} cursor position query(ies) for {id} at row {row}, col {col}");

        Some(response)
    }
}

#[derive(Clone)]
struct InitialCommandState {
    command: String,
    ready_marker: Option<Vec<u8>>,
    buffer: Vec<u8>,
}

fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }

    if needle.len() > haystack.len() {
        return false;
    }

    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

async fn maybe_dispatch_initial_command(
    initial_commands: &Arc<Mutex<HashMap<String, InitialCommandState>>>,
    pty_writers: &Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    coalescing_state: &CoalescingState,
    terminal_id: &str,
    chunk: &[u8],
) {
    let mut command_to_send: Option<String> = None;

    {
        let mut commands_guard = initial_commands.lock().await;
        if let Some(state) = commands_guard.get_mut(terminal_id) {
            match &state.ready_marker {
                Some(marker) if !marker.is_empty() => {
                    state.buffer.extend_from_slice(chunk);
                    if contains_subsequence(&state.buffer, marker) {
                        command_to_send = Some(state.command.clone());
                        commands_guard.remove(terminal_id);
                    } else if state.buffer.len() > marker.len() {
                        let keep = marker.len();
                        let start = state.buffer.len() - keep;
                        state.buffer.drain(0..start);
                    }
                }
                _ => {
                    command_to_send = Some(state.command.clone());
                    commands_guard.remove(terminal_id);
                }
            }
        }
    }

    if let Some(command) = command_to_send {
        info!("Dispatching queued initial command for terminal {terminal_id}");

        let mut writers_guard = pty_writers.lock().await;
        if let Some(writer) = writers_guard.get_mut(terminal_id) {
            let mut payload = Vec::with_capacity(command.len() + 6);
            payload.extend_from_slice(b"\x1b[200~");
            payload.extend_from_slice(command.as_bytes());
            payload.extend_from_slice(b"\x1b[201~");
            payload.push(b'\r');

            if let Err(e) = writer.write_all(&payload) {
                warn!("Failed to write initial command for terminal {terminal_id}: {e}");
            } else if let Err(e) = writer.flush() {
                warn!("Failed to flush initial command for terminal {terminal_id}: {e}");
            }
        } else {
            warn!("No writer found to dispatch initial command for terminal {terminal_id}");
        }
        drop(writers_guard);

        let handle_guard = coalescing_state.app_handle.lock().await;
        if let Some(handle) = handle_guard.as_ref() {
            let event_payload = serde_json::json!({ "terminal_id": terminal_id });
            if let Err(e) = emit_event(handle, SchaltEvent::TerminalForceScroll, &event_payload) {
                warn!("Failed to emit terminal force scroll event for {terminal_id}: {e}");
            }
        }
    }
}

pub struct LocalPtyAdapter {
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    creating: Arc<Mutex<HashSet<String>>>,
    // PTY resource maps - moved from global statics to instance level
    pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    // Reader task handles, so we can abort residual readers on close to avoid mixed output
    reader_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    // Coalescing state for terminal output handling
    coalescing_state: CoalescingState,
    suspended: Arc<RwLock<HashSet<String>>>,
    pending_control_sequences: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    initial_commands: Arc<Mutex<HashMap<String, InitialCommandState>>>,
    // Event broadcasting for deterministic testing
    output_event_sender: Arc<broadcast::Sender<(String, u64)>>, // (terminal_id, new_seq)
}

struct ReaderState {
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    coalescing_state: CoalescingState,
    suspended: Arc<RwLock<HashSet<String>>>,
    pending_control_sequences: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    initial_commands: Arc<Mutex<HashMap<String, InitialCommandState>>>,
    output_event_sender: Arc<broadcast::Sender<(String, u64)>>,
}

impl Default for LocalPtyAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalPtyAdapter {
    fn lifecycle_deps(&self) -> LifecycleDeps {
        LifecycleDeps {
            terminals: Arc::clone(&self.terminals),
            app_handle: Arc::clone(&self.coalescing_state.app_handle),
            pty_children: Arc::clone(&self.pty_children),
            pty_masters: Arc::clone(&self.pty_masters),
            pty_writers: Arc::clone(&self.pty_writers),
        }
    }
    pub fn new() -> Self {
        let app_handle = Arc::new(Mutex::new(None));
        let (output_event_sender, _) = broadcast::channel(1000); // Buffer up to 1000 events
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            creating: Arc::new(Mutex::new(HashSet::new())),
            pty_children: Arc::new(Mutex::new(HashMap::new())),
            pty_masters: Arc::new(Mutex::new(HashMap::new())),
            pty_writers: Arc::new(Mutex::new(HashMap::new())),
            reader_handles: Arc::new(Mutex::new(HashMap::new())),
            coalescing_state: CoalescingState {
                app_handle,
                emit_buffers: Arc::new(RwLock::new(HashMap::new())),
                emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
                emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
                norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
                utf8_streams: Arc::new(RwLock::new(HashMap::new())),
            },
            suspended: Arc::new(RwLock::new(HashSet::new())),
            pending_control_sequences: Arc::new(Mutex::new(HashMap::new())),
            initial_commands: Arc::new(Mutex::new(HashMap::new())),
            output_event_sender: Arc::new(output_event_sender),
        }
    }

    pub async fn get_activity_status(&self, id: &str) -> Result<(bool, u64), String> {
        let terminals = self.terminals.read().await;
        if let Some(state) = terminals.get(id) {
            let elapsed = SystemTime::now()
                .duration_since(state.last_output)
                .map_err(|e| format!("Time error: {e}"))?
                .as_secs();
            Ok((false, elapsed))
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }

    pub async fn get_all_terminal_activity(&self) -> Vec<(String, u64)> {
        let terminals = self.terminals.read().await;
        let mut results = Vec::new();

        for (id, state) in terminals.iter() {
            if let Ok(duration) = SystemTime::now().duration_since(state.last_output) {
                let elapsed = duration.as_secs();
                results.push((id.clone(), elapsed));
            }
        }

        results
    }

    pub async fn wait_for_output_change(&self, id: &str, min_seq: u64) -> Result<u64, String> {
        let mut receiver = self.output_event_sender.subscribe();

        if let Some(state) = self.terminals.read().await.get(id) {
            if state.seq > min_seq {
                return Ok(state.seq);
            }
        } else {
            return Err(format!("Terminal {id} not found"));
        }

        let timeout_duration = Duration::from_secs(10);
        let timeout_result = tokio::time::timeout(timeout_duration, async {
            while let Ok((terminal_id, new_seq)) = receiver.recv().await {
                if terminal_id == id && new_seq > min_seq {
                    return Ok(new_seq);
                }
            }
            Err("Event channel closed".to_string())
        })
        .await;

        match timeout_result {
            Ok(result) => result,
            Err(_) => {
                if let Some(state) = self.terminals.read().await.get(id) {
                    if state.seq > min_seq {
                        Ok(state.seq)
                    } else {
                        Err(format!(
                            "Timeout waiting for output change on terminal {id}. Current seq: {}, waiting for: > {min_seq}",
                            state.seq
                        ))
                    }
                } else {
                    Err(format!("Terminal {id} not found after timeout"))
                }
            }
        }
    }

    pub async fn write_and_wait(&self, id: &str, data: &[u8]) -> Result<u64, String> {
        let initial_seq = {
            let terminals = self.terminals.read().await;
            if let Some(state) = terminals.get(id) {
                state.seq
            } else {
                return Err(format!("Terminal {id} not found"));
            }
        };

        self.write(id, data).await?;
        self.wait_for_output_change(id, initial_seq).await
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.coalescing_state.app_handle.lock().await = Some(handle.clone());
        self.spawn_idle_ticker(handle).await;
    }

    async fn spawn_idle_ticker(&self, handle: AppHandle) {
        let terminals = Arc::clone(&self.terminals);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            loop {
                interval.tick().await;
                let now = Instant::now();

                let transitions = {
                    let mut terminals = terminals.write().await;
                    let mut transitions = Vec::new();
                    for (id, state) in terminals.iter_mut() {
                        if state.session_id.is_none() {
                            continue;
                        }

                        if !state.idle_detector.needs_tick() {
                            continue;
                        }

                        if let Some(transition) = state.idle_detector.tick(now, &mut state.screen) {
                            if !is_session_top_terminal_id(id) {
                                continue;
                            }
                            let needs_attention = match transition {
                                IdleTransition::BecameIdle => true,
                                IdleTransition::BecameActive => false,
                            };
                            transitions.push((
                                state.session_id.clone().unwrap(),
                                id.clone(),
                                needs_attention,
                            ));
                        }
                    }
                    transitions
                };

                if !transitions.is_empty() {
                    for (session_id, terminal_id, needs_attention) in transitions {
                        info!(
                            "Emitting TerminalAttention event: session={session_id}, terminal={terminal_id}, attention={needs_attention}"
                        );
                        let payload = serde_json::json!({
                            "session_id": session_id,
                            "terminal_id": terminal_id,
                            "needs_attention": needs_attention
                        });
                        if let Err(e) =
                            emit_event(&handle, SchaltEvent::TerminalAttention, &payload)
                        {
                            error!("Failed to emit TerminalAttention event: {e}");
                        }
                    }
                }
            }
        });
    }

    fn start_reader(
        id: String,
        mut reader: Box<dyn Read + Send>,
        reader_state: ReaderState,
    ) -> tokio::task::JoinHandle<()> {
        tokio::task::spawn_blocking(move || {
            let runtime = tokio::runtime::Handle::current();
            let mut buf = [0u8; 8192];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        info!("Terminal {id} EOF");
                        // Clean up terminal maps and notify UI about closure
                        let id_clone_for_cleanup = id.clone();
                        let coalescing_state_clone = reader_state.coalescing_state.clone();
                        let deps = lifecycle::LifecycleDeps {
                            terminals: Arc::clone(&reader_state.terminals),
                            app_handle: Arc::clone(&reader_state.coalescing_state.app_handle),
                            pty_children: Arc::clone(&reader_state.pty_children),
                            pty_masters: Arc::clone(&reader_state.pty_masters),
                            pty_writers: Arc::clone(&reader_state.pty_writers),
                        };
                        runtime.block_on(async move {
                            if let Some(mut child) =
                                deps.pty_children.lock().await.remove(&id_clone_for_cleanup)
                            {
                                let _ = child.kill();
                            }
                            lifecycle::cleanup_dead_terminal(id_clone_for_cleanup.clone(), &deps)
                                .await;
                            coalescing_state_clone
                                .clear_for(&id_clone_for_cleanup)
                                .await;
                        });
                        break;
                    }
                    Ok(n) => {
                        let mut data = buf[..n].to_vec();
                        let mut pending_guard =
                            runtime.block_on(reader_state.pending_control_sequences.lock());

                        if let Some(mut pending) = pending_guard.remove(&id) {
                            pending.extend_from_slice(&data);
                            data = pending;
                        }

                        let mut writers = runtime.block_on(reader_state.pty_writers.lock());
                        let SanitizedOutput {
                            data: sanitized,
                            remainder,
                            cursor_queries,
                            responses,
                        } = sanitize_control_sequences(&data);

                        for response in responses {
                            match response {
                                SequenceResponse::Immediate(reply) => {
                                    if let Some(writer) = writers.get_mut(&id) {
                                        if let Err(e) = writer.write_all(&reply) {
                                            warn!(
                                                "Failed to write terminal response for {id}: {e}"
                                            );
                                        } else if let Err(e) = writer.flush() {
                                            warn!(
                                                "Failed to flush terminal response for {id}: {e}"
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        drop(writers);

                        if let Some(rest) = remainder {
                            pending_guard.insert(id.clone(), rest);
                        } else {
                            pending_guard.remove(&id);
                        }
                        drop(pending_guard);

                        if sanitized.is_empty() && cursor_queries == 0 {
                            continue;
                        }

                        let sanitized_len = sanitized.len();
                        let cursor_queries_count = cursor_queries;
                        let sanitized_data = sanitized;

                        let id_clone = id.clone();
                        let terminals_clone = Arc::clone(&reader_state.terminals);
                        let coalescing_state_output = reader_state.coalescing_state.clone();
                        let coalescing_state_ready = reader_state.coalescing_state.clone();
                        let initial_commands_clone = Arc::clone(&reader_state.initial_commands);
                        let pty_writers_clone_for_ready = Arc::clone(&reader_state.pty_writers);
                        let suspended_clone = Arc::clone(&reader_state.suspended);
                        let output_event_sender_clone =
                            Arc::clone(&reader_state.output_event_sender);

                        let cursor_response = runtime.block_on(async move {
                            let mut terminals = terminals_clone.write().await;
                            if let Some(state) = terminals.get_mut(&id_clone) {
                                if sanitized_len > 0 {
                                    state.buffer.extend_from_slice(&sanitized_data);

                                    let max_size = if lifecycle::is_agent_terminal(&id_clone) {
                                        AGENT_MAX_BUFFER_SIZE
                                    } else {
                                        DEFAULT_MAX_BUFFER_SIZE
                                    };

                                    state.seq = state.seq.saturating_add(sanitized_len as u64);
                                    state.last_output = SystemTime::now();

                                    let now = Instant::now();
                                    state.idle_detector.observe_bytes(now, &sanitized_data);

                                    if state.buffer.len() > max_size {
                                        let excess = state.buffer.len() - max_size;
                                        state.buffer.drain(0..excess);
                                        state.start_seq =
                                            state.start_seq.saturating_add(excess as u64);
                                    }

                                    let new_seq = state.seq;
                                    let response = state
                                        .cursor_position_response(&id_clone, cursor_queries_count);

                                    drop(terminals);

                                    let _ =
                                        output_event_sender_clone.send((id_clone.clone(), new_seq));

                                    if suspended_clone.read().await.contains(&id_clone) {
                                        return response;
                                    }

                                    handle_coalesced_output(
                                        &coalescing_state_output,
                                        CoalescingParams {
                                            terminal_id: &id_clone,
                                            data: &sanitized_data,
                                        },
                                    )
                                    .await;

                                    maybe_dispatch_initial_command(
                                        &initial_commands_clone,
                                        &pty_writers_clone_for_ready,
                                        &coalescing_state_ready,
                                        &id_clone,
                                        &sanitized_data,
                                    )
                                    .await;

                                    response
                                } else {
                                    let response = state
                                        .cursor_position_response(&id_clone, cursor_queries_count);
                                    drop(terminals);
                                    response
                                }
                            } else {
                                None
                            }
                        });

                        if let Some(response) = cursor_response {
                            if !response.is_empty() {
                                let mut writers = runtime.block_on(reader_state.pty_writers.lock());
                                if let Some(writer) = writers.get_mut(&id) {
                                    if let Err(e) = writer.write_all(&response) {
                                        warn!("Failed to write cursor response for {id}: {e}");
                                    } else if let Err(e) = writer.flush() {
                                        warn!("Failed to flush cursor response for {id}: {e}");
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            error!("Terminal {id} read error: {e}");
                            // On read error, clean up and notify
                            let id_clone_for_cleanup = id.clone();
                            let coalescing_state_clone = reader_state.coalescing_state.clone();
                            let deps = lifecycle::LifecycleDeps {
                                terminals: Arc::clone(&reader_state.terminals),
                                app_handle: Arc::clone(&reader_state.coalescing_state.app_handle),
                                pty_children: Arc::clone(&reader_state.pty_children),
                                pty_masters: Arc::clone(&reader_state.pty_masters),
                                pty_writers: Arc::clone(&reader_state.pty_writers),
                            };
                            runtime.block_on(async move {
                                if let Some(mut child) =
                                    deps.pty_children.lock().await.remove(&id_clone_for_cleanup)
                                {
                                    let _ = child.kill();
                                }
                                lifecycle::cleanup_dead_terminal(
                                    id_clone_for_cleanup.clone(),
                                    &deps,
                                )
                                .await;
                                coalescing_state_clone
                                    .clear_for(&id_clone_for_cleanup)
                                    .await;
                            });
                            break;
                        }
                    }
                }
            }
        })
    }

    async fn abort_reader(&self, id: &str) {
        if let Some(handle) = self.reader_handles.lock().await.remove(id) {
            handle.abort();
            let _ = tokio::time::timeout(Duration::from_millis(500), handle).await;
        }
    }

    async fn spawn_reader_for(&self, id: &str) -> Result<(), String> {
        self.abort_reader(id).await;

        let reader = {
            let masters = self.pty_masters.lock().await;
            let master = masters
                .get(id)
                .ok_or_else(|| format!("No PTY master available for terminal {id}"))?;
            master
                .try_clone_reader()
                .map_err(|e| format!("Failed to clone reader for terminal {id}: {e}"))?
        };

        let reader_handle = Self::start_reader(
            id.to_string(),
            reader,
            ReaderState {
                terminals: Arc::clone(&self.terminals),
                pty_children: Arc::clone(&self.pty_children),
                pty_masters: Arc::clone(&self.pty_masters),
                pty_writers: Arc::clone(&self.pty_writers),
                coalescing_state: self.coalescing_state.clone(),
                suspended: Arc::clone(&self.suspended),
                pending_control_sequences: Arc::clone(&self.pending_control_sequences),
                initial_commands: Arc::clone(&self.initial_commands),
                output_event_sender: Arc::clone(&self.output_event_sender),
            },
        );

        self.reader_handles
            .lock()
            .await
            .insert(id.to_string(), reader_handle);
        Ok(())
    }
}

#[async_trait::async_trait]
impl TerminalBackend for LocalPtyAdapter {
    async fn create(&self, params: CreateParams) -> Result<(), String> {
        // Use standard terminal defaults that will be immediately resized by frontend
        // These are just fallback values for compatibility
        self.create_with_size(params, 80, 24).await
    }

    async fn create_with_size(
        &self,
        params: CreateParams,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let id = params.id.clone();
        let start_time = Instant::now();

        // Check if already creating
        {
            let mut creating = self.creating.lock().await;
            if creating.contains(&id) {
                debug!("Terminal {id} already being created");
                return Ok(());
            }
            creating.insert(id.clone());
        }

        // Check if already exists
        if self.exists(&id).await? {
            self.creating.lock().await.remove(&id);
            debug!(
                "Terminal {id} already exists, skipping creation ({}ms)",
                start_time.elapsed().as_millis()
            );
            return Ok(());
        }

        info!(
            "Creating terminal: id={id}, cwd={}, size={}x{}",
            params.cwd, cols, rows
        );

        let pty_system = NativePtySystem::default();
        // Use the provided size for initial PTY creation
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let spec = build_command_spec(&params, cols, rows).await?;
        let mut cmd = spec.into_builder();

        // OPTIMIZATION 3: Skip working directory validation in release for faster startup
        // In debug/test mode, we still validate to catch issues early
        #[cfg(debug_assertions)]
        {
            // Validate working directory exists in debug/test builds
            if !std::path::Path::new(&params.cwd).exists() {
                return Err(format!("Working directory does not exist: {}", params.cwd));
            }
        }

        cmd.cwd(params.cwd.clone());

        info!("Spawning terminal {id} with cwd: {}", params.cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            error!("Failed to spawn command for terminal {id}: {e}");

            let error_message = format!("Failed to spawn command: {e}");
            let display_error = format!(
                "\r\n\x1b[1;31mError: Failed to start agent\x1b[0m\r\n\r\n{error_message}\r\n\r\nPlease check:\r\n\
                - The agent binary path is correct in Settings\r\n\
                - The binary exists and has execute permissions\r\n\
                - The binary is compatible with your system\r\n"
            );

            let session_id = session_id_from_terminal_id(&id);
            let error_bytes = display_error.as_bytes().to_vec();
            let error_len = error_bytes.len() as u64;
            let state = TerminalState {
                buffer: error_bytes.clone(),
                seq: error_len,
                start_seq: 0,
                last_output: SystemTime::now(),
                screen: VisibleScreen::new(rows, cols, id.clone()),
                idle_detector: IdleDetector::new(IDLE_THRESHOLD_MS, id.clone()),
                session_id,
            };

            let creating_clone = Arc::clone(&self.creating);
            let terminals_clone = Arc::clone(&self.terminals);
            let id_clone = id.clone();
            let cwd_clone = params.cwd.clone();
            let coalescing_state_clone = self.coalescing_state.clone();
            tokio::spawn(async move {
                terminals_clone.write().await.insert(id_clone.clone(), state);
                creating_clone.lock().await.remove(&id_clone);

                if let Some(handle) = coalescing_state_clone.app_handle.lock().await.as_ref() {
                    let payload = serde_json::json!({ "terminal_id": id_clone, "cwd": cwd_clone });
                    let _ = emit_event(handle, SchaltEvent::TerminalCreated, &payload);
                }
            });

            error_message
        })?;

        info!(
            "Successfully spawned shell process for terminal {id} (spawn took {}ms)",
            start_time.elapsed().as_millis()
        );

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {e}"))?;

        // Store the child and master in separate maps to avoid Sync issues
        self.pty_children.lock().await.insert(id.clone(), child);
        self.pty_masters
            .lock()
            .await
            .insert(id.clone(), pair.master);
        self.pty_writers.lock().await.insert(id.clone(), writer);

        lifecycle::start_process_monitor(id.clone(), self.lifecycle_deps()).await;

        let session_id = session_id_from_terminal_id(&id);
        if session_id.is_some() {
            debug!("Terminal {id} mapped to session {session_id:?}");
        }

        let state = TerminalState {
            buffer: Vec::new(),
            seq: 0,
            start_seq: 0,
            last_output: SystemTime::now(),
            screen: VisibleScreen::new(rows, cols, id.clone()),
            idle_detector: IdleDetector::new(IDLE_THRESHOLD_MS, id.clone()),
            session_id,
        };

        self.terminals.write().await.insert(id.clone(), state);

        // Start reader agent and record the handle so we can abort on close
        self.spawn_reader_for(&id).await?;

        self.creating.lock().await.remove(&id);

        let total_time = start_time.elapsed();
        if total_time.as_millis() > 100 {
            warn!(
                "Terminal {id} creation took {}ms (slow)",
                total_time.as_millis()
            );
        } else {
            info!(
                "Terminal created successfully: id={id} (total {}ms)",
                total_time.as_millis()
            );
        }
        Ok(())
    }

    async fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let start = Instant::now();

        if let Some(writer) = self.pty_writers.lock().await.get_mut(id) {
            writer
                .write_all(data)
                .map_err(|e| format!("Write failed: {e}"))?;

            // Always flush immediately to ensure input appears without delay
            // This is critical for responsive terminal behavior, especially for pasted text
            writer.flush().map_err(|e| format!("Flush failed: {e}"))?;

            let elapsed = start.elapsed();
            if elapsed.as_millis() > 20 {
                warn!("Terminal {id} slow write: {}ms", elapsed.as_millis());
            }

            Ok(())
        } else {
            warn!("Terminal {id} not found for write");
            Ok(())
        }
    }

    async fn write_immediate(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let start = Instant::now();

        if let Some(writer) = self.pty_writers.lock().await.get_mut(id) {
            writer
                .write_all(data)
                .map_err(|e| format!("Immediate write failed: {e}"))?;

            // Always flush immediately to ensure input appears without delay
            writer
                .flush()
                .map_err(|e| format!("Immediate flush failed: {e}"))?;

            let elapsed = start.elapsed();
            if elapsed.as_millis() > 10 {
                warn!(
                    "Terminal {id} slow immediate write: {}ms",
                    elapsed.as_millis()
                );
            }

            Ok(())
        } else {
            warn!("Terminal {id} not found for immediate write");
            Ok(())
        }
    }

    async fn queue_initial_command(
        &self,
        id: &str,
        command: String,
        ready_marker: Option<String>,
    ) -> Result<(), String> {
        let marker_bytes = ready_marker.and_then(|marker| {
            if marker.trim().is_empty() {
                None
            } else {
                Some(marker.into_bytes())
            }
        });

        let state = InitialCommandState {
            command,
            ready_marker: marker_bytes,
            buffer: Vec::new(),
        };

        self.initial_commands
            .lock()
            .await
            .insert(id.to_string(), state);

        Ok(())
    }

    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if let Some(master) = self.pty_masters.lock().await.get(id) {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Resize failed: {e}"))?;

            if let Some(state) = self.terminals.write().await.get_mut(id) {
                state.screen.resize(rows, cols);
            }

            debug!("Resized terminal {id}: {cols}x{rows}");
            Ok(())
        } else {
            warn!("Terminal {id} not found for resize");
            Ok(())
        }
    }

    async fn close(&self, id: &str) -> Result<(), String> {
        info!("Closing terminal: {id}");

        // Abort reader first to stop any further emission for this terminal id
        self.abort_reader(id).await;

        // Try to terminate the child process and wait deterministically without polling
        if let Some(mut child) = self.pty_children.lock().await.remove(id) {
            if let Err(e) = child.kill() {
                warn!("Failed to kill terminal process {id}: {e}");
            }
            // Use blocking wait inside a timeout without inner sleeps
            let wait_res = {
                use tokio::time::{timeout, Duration};
                timeout(
                    Duration::from_millis(500),
                    tokio::task::spawn_blocking(move || child.wait()),
                )
                .await
            };
            match wait_res {
                Ok(Ok(Ok(_status))) => {
                    debug!("Terminal {id} process exited within timeout");
                }
                Ok(Ok(Err(e))) => {
                    debug!("Terminal {id} wait returned error: {e}");
                }
                Ok(Err(join_err)) => {
                    debug!("Terminal {id} spawn_blocking join error: {join_err}");
                }
                Err(_) => {
                    debug!(
                        "Terminal {id} process didn't exit within timeout; proceeding with cleanup"
                    );
                }
            }
        }

        // Clean up all resources
        self.pty_masters.lock().await.remove(id);
        self.pty_writers.lock().await.remove(id);
        self.terminals.write().await.remove(id);
        self.suspended.write().await.remove(id);
        self.pending_control_sequences.lock().await.remove(id);
        self.initial_commands.lock().await.remove(id);

        // Clear coalescing buffers
        self.coalescing_state.clear_for(id).await;

        // Emit terminal closed event
        if let Some(handle) = self.coalescing_state.app_handle.lock().await.as_ref() {
            let _ = emit_event(
                handle,
                SchaltEvent::TerminalClosed,
                &serde_json::json!({"terminal_id": id}),
            );
        }

        info!("Terminal {id} closed");
        Ok(())
    }

    async fn exists(&self, id: &str) -> Result<bool, String> {
        Ok(self.terminals.read().await.contains_key(id))
    }

    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<TerminalSnapshot, String> {
        let terminals = self.terminals.read().await;
        if let Some(state) = terminals.get(id) {
            let start_seq = state.start_seq;
            let seq = state.seq;
            let from_requested = from_seq.unwrap_or(start_seq);
            let effective_from = if from_requested > seq {
                start_seq
            } else {
                from_requested.max(start_seq)
            };
            let offset = effective_from.saturating_sub(start_seq) as usize;
            let data = if offset >= state.buffer.len() {
                Vec::new()
            } else {
                state.buffer[offset..].to_vec()
            };
            Ok(TerminalSnapshot {
                seq,
                start_seq,
                data,
            })
        } else {
            Ok(TerminalSnapshot {
                seq: 0,
                start_seq: 0,
                data: Vec::new(),
            })
        }
    }

    async fn suspend(&self, id: &str) -> Result<(), String> {
        self.suspended.write().await.insert(id.to_string());
        self.coalescing_state.clear_for(id).await;
        self.pending_control_sequences.lock().await.remove(id);
        self.abort_reader(id).await;
        if let Some(handle) = self.coalescing_state.app_handle.lock().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id });
            emit_event(handle, SchaltEvent::TerminalSuspended, &payload)
                .map_err(|e| format!("Failed to emit terminal suspended event: {e}"))?;
        }
        Ok(())
    }

    async fn resume(&self, id: &str) -> Result<(), String> {
        self.pending_control_sequences.lock().await.remove(id);
        self.spawn_reader_for(id).await?;
        self.suspended.write().await.remove(id);
        if let Some(handle) = self.coalescing_state.app_handle.lock().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id });
            emit_event(handle, SchaltEvent::TerminalResumed, &payload)
                .map_err(|e| format!("Failed to emit terminal resumed event: {e}"))?;
        }
        Ok(())
    }

    async fn is_suspended(&self, id: &str) -> Result<bool, String> {
        Ok(self.suspended.read().await.contains(id))
    }

    async fn force_kill_all(&self) -> Result<(), String> {
        info!("Force killing all terminals for app exit");

        let mut children = self.pty_children.lock().await;
        for (_id, mut child) in children.drain() {
            let _ = child.kill();
        }
        drop(children);

        self.pty_masters.lock().await.clear();
        self.pty_writers.lock().await.clear();
        self.reader_handles.lock().await.clear();
        self.terminals.write().await.clear();
        self.suspended.write().await.clear();
        self.pending_control_sequences.lock().await.clear();
        self.initial_commands.lock().await.clear();
        self.coalescing_state.clear_all().await;

        info!("All terminals force killed");
        Ok(())
    }
}

fn session_id_from_terminal_id(id: &str) -> Option<String> {
    let mut rest = if let Some(suffix) = id.strip_prefix("session-") {
        suffix
    } else if let Some(suffix) = id.strip_prefix("orchestrator-") {
        suffix
    } else {
        return None;
    };

    // Remove numeric index at end like -0, -1 FIRST
    if let Some((prefix, maybe_index)) = rest.rsplit_once('-') {
        if maybe_index.chars().all(|c| c.is_ascii_digit()) {
            rest = prefix;
        }
    }

    // Remove terminal position suffix (-top or -bottom)
    for suffix in ["-top", "-bottom"] {
        if let Some(stripped) = rest.strip_suffix(suffix) {
            rest = stripped;
            break;
        }
    }

    // Remove hash suffix like ~d7ecb8
    if let Some(tilde_idx) = rest.find('~') {
        rest = &rest[..tilde_idx];
    }

    Some(rest.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::ApplicationSpec;
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::time::sleep;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn test_session_id_extraction() {
        assert_eq!(
            session_id_from_terminal_id("session-dreamy_kirch~d7ecb8-top"),
            Some("dreamy_kirch".to_string())
        );
        assert_eq!(
            session_id_from_terminal_id("session-quirky_black~3fbece-top"),
            Some("quirky_black".to_string())
        );
        assert_eq!(
            session_id_from_terminal_id("session-my-feature-bottom-0"),
            Some("my-feature".to_string())
        );
        assert_eq!(
            session_id_from_terminal_id("orchestrator-pharia-3250d1-top"),
            Some("pharia-3250d1".to_string())
        );
        assert_eq!(
            session_id_from_terminal_id("orchestrator-main-bottom"),
            Some("main".to_string())
        );
        assert_eq!(session_id_from_terminal_id("random-terminal-id"), None);
    }

    fn unique_id(prefix: &str) -> String {
        format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    }

    async fn safe_close(adapter: &LocalPtyAdapter, id: &str) {
        if let Err(e) = adapter.close(id).await {
            eprintln!("Warning: Failed to close terminal {}: {}", id, e);
        }
    }

    #[tokio::test]
    async fn test_create_exists_close() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("basic-lifecycle");

        assert!(!adapter.exists(&id).await.unwrap());

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        adapter.create(params).await.unwrap();

        assert!(adapter.exists(&id).await.unwrap());

        adapter.close(&id).await.unwrap();
        assert!(!adapter.exists(&id).await.unwrap());
    }

    #[tokio::test]
    async fn test_create_with_custom_size() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("custom-size");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create_with_size(params, 120, 40).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
        assert!(!adapter.exists(&id).await.unwrap());
    }

    #[tokio::test]
    async fn test_write_and_snapshot() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("write-snapshot");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();

        adapter
            .write_and_wait(&id, b"echo 'test output'\n")
            .await
            .expect("command should execute");

        let snapshot = adapter.snapshot(&id, None).await.unwrap();
        assert!(snapshot.seq > 0);
        assert!(!snapshot.data.is_empty());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_custom_app_environment_variables() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("custom-env");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: Some(ApplicationSpec {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), "echo test && sleep 1".to_string()],
                env: vec![
                    ("CUSTOM_VAR".to_string(), "custom_value".to_string()),
                    ("PATH".to_string(), "/custom/path:/usr/bin".to_string()),
                ],
                ready_timeout_ms: 1000,
            }),
        };

        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_double_create_same_id() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("double-create");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params.clone()).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_creating_flag_prevents_race_conditions() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let id = unique_id("race-condition");

        let adapter_clone1 = Arc::clone(&adapter);
        let id_clone1 = id.clone();
        let create_handle1 = tokio::spawn(async move {
            let params = CreateParams {
                id: id_clone1.clone(),
                cwd: "/tmp".to_string(),
                app: None,
            };
            adapter_clone1.create(params).await.unwrap();
        });

        let adapter_clone2 = Arc::clone(&adapter);
        let id_clone2 = id.clone();
        let create_handle2 = tokio::spawn(async move {
            let params = CreateParams {
                id: id_clone2.clone(),
                cwd: "/tmp".to_string(),
                app: None,
            };
            adapter_clone2.create(params).await.unwrap();
        });

        let _ = tokio::join!(create_handle1, create_handle2);

        assert!(adapter.exists(&id).await.unwrap());
        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_create_with_nonexistent_command() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("bad-command");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: Some(ApplicationSpec {
                command: "/nonexistent/command/that/does/not/exist".to_string(),
                args: vec![],
                env: vec![],
                ready_timeout_ms: 1000,
            }),
        };

        let result = adapter.create(params).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to spawn command"));
    }

    #[tokio::test]
    async fn test_terminal_creation_performance() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("perf-test");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        let start = std::time::Instant::now();
        adapter.create(params).await.unwrap();
        let creation_time = start.elapsed();

        assert!(creation_time.as_millis() < 1000);
        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_rapid_operations() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("rapid-ops");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        for i in 0..10 {
            adapter
                .write(&id, format!("echo 'test {}'\n", i).as_bytes())
                .await
                .unwrap();
            adapter.resize(&id, 80 + i, 24 + i % 5).await.unwrap();
            let _ = adapter.snapshot(&id, None).await.unwrap();
        }

        assert!(adapter.exists(&id).await.unwrap());
        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_full_terminal_workflow() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("full-workflow");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create_with_size(params, 100, 30).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        sleep(Duration::from_millis(200)).await;

        adapter.write(&id, b"pwd\n").await.unwrap();
        sleep(Duration::from_millis(100)).await;
        adapter.write(&id, b"ls -la\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let snapshot = adapter.snapshot(&id, None).await.unwrap();
        assert!(snapshot.seq > 0);
        assert!(!snapshot.data.is_empty());

        adapter.resize(&id, 120, 40).await.unwrap();
        adapter
            .write(&id, b"echo 'terminal test complete'\n")
            .await
            .unwrap();
        sleep(Duration::from_millis(100)).await;

        let (stuck, _) = adapter.get_activity_status(&id).await.unwrap();
        assert!(!stuck);

        adapter.close(&id).await.unwrap();
        assert!(!adapter.exists(&id).await.unwrap());
    }

    #[tokio::test]
    async fn test_memory_cleanup_after_close() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("memory-cleanup");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        adapter.write(&id, b"echo 'test output'\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let snapshot_before_close = adapter.snapshot(&id, None).await.unwrap();
        assert!(!snapshot_before_close.data.is_empty());

        adapter.close(&id).await.unwrap();
        assert!(!adapter.exists(&id).await.unwrap());

        assert!(!adapter.terminals.read().await.contains_key(&id));

        let snapshot_after_close = adapter.snapshot(&id, None).await.unwrap();
        assert_eq!(snapshot_after_close.seq, 0);
        assert!(snapshot_after_close.data.is_empty());
    }

    #[tokio::test]
    async fn test_coalescing_buffers_cleaned_on_close() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("coalescing-cleanup");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        adapter
            .write(&id, b"echo 'populate buffers'\n")
            .await
            .unwrap();
        sleep(Duration::from_millis(100)).await;

        adapter.close(&id).await.unwrap();

        assert!(!adapter
            .coalescing_state
            .emit_buffers
            .read()
            .await
            .contains_key(&id));
        assert!(!adapter
            .coalescing_state
            .emit_scheduled
            .read()
            .await
            .contains_key(&id));
        assert!(!adapter
            .coalescing_state
            .emit_buffers_norm
            .read()
            .await
            .contains_key(&id));
        assert!(!adapter
            .coalescing_state
            .norm_last_cr
            .read()
            .await
            .contains_key(&id));
    }

    #[tokio::test]
    async fn test_app_handle_setting() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let id = unique_id("app-handle-test");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }
}

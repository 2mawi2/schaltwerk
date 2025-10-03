use super::coalescing::{handle_coalesced_output, CoalescingParams, CoalescingState};
use super::idle_detection::{IdleDetector, IdleTransition};
use super::visible::VisibleScreen;
use super::{CreateParams, TerminalBackend, TerminalSnapshot};
use crate::infrastructure::events::{emit_event, SchaltEvent};
use log::{debug, error, info, warn};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::AppHandle;
use tokio::sync::{broadcast, Mutex, RwLock};

const DEFAULT_MAX_BUFFER_SIZE: usize = 2 * 1024 * 1024;
const AGENT_MAX_BUFFER_SIZE: usize = 64 * 1024 * 1024;
const IDLE_THRESHOLD_MS: u64 = 5000;
const IDLE_WINDOW_LINES: usize = 15;

struct TerminalState {
    buffer: Vec<u8>,
    seq: u64,
    start_seq: u64,
    last_output: SystemTime,
    screen: VisibleScreen,
    idle_detector: IdleDetector,
    session_id: Option<String>,
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
    output_event_sender: Arc<broadcast::Sender<(String, u64)>>,
}

impl Default for LocalPtyAdapter {
    fn default() -> Self {
        Self::new()
    }
}

enum ControlSequenceAction {
    Respond(&'static [u8]),
    Pass,
}

impl LocalPtyAdapter {
    fn analyze_control_sequence(
        prefix: Option<u8>,
        params: &[u8],
        terminator: u8,
    ) -> ControlSequenceAction {
        match terminator {
            b'n' => {
                if params == b"5" && prefix.is_none() {
                    ControlSequenceAction::Respond(b"\x1b[0n")
                } else {
                    ControlSequenceAction::Pass
                }
            }
            b'c' => match prefix {
                Some(b'>') => ControlSequenceAction::Respond(b"\x1b[>0;95;0c"),
                Some(b'?') => ControlSequenceAction::Respond(b"\x1b[?1;2c"),
                None => ControlSequenceAction::Respond(b"\x1b[?1;2c"),
                _ => ControlSequenceAction::Pass,
            },
            b'R' => ControlSequenceAction::Pass,
            _ => ControlSequenceAction::Pass,
        }
    }

    fn sanitize_control_sequences(
        id: &str,
        data: &[u8],
        writers: &mut HashMap<String, Box<dyn Write + Send>>,
    ) -> (Vec<u8>, Option<Vec<u8>>) {
        let mut result = Vec::with_capacity(data.len());
        let mut i = 0;
        while i < data.len() {
            if data[i] != 0x1b {
                result.push(data[i]);
                i += 1;
                continue;
            }

            if i + 1 >= data.len() {
                return (result, Some(data[i..].to_vec()));
            }

            let kind = data[i + 1];
            if kind != b'[' {
                // Not a CSI sequence we care about; keep ESC and advance
                result.push(data[i]);
                i += 1;
                continue;
            }

            let mut cursor = i + 2;
            let prefix = if cursor < data.len() && (data[cursor] == b'?' || data[cursor] == b'>') {
                let p = data[cursor];
                cursor += 1;
                Some(p)
            } else {
                None
            };

            let params_start = cursor;
            while cursor < data.len() && (data[cursor].is_ascii_digit() || data[cursor] == b';') {
                cursor += 1;
            }

            if cursor >= data.len() {
                return (result, Some(data[i..].to_vec()));
            }

            let terminator = data[cursor];
            let params = &data[params_start..cursor];

            let action = Self::analyze_control_sequence(prefix, params, terminator);

            match action {
                ControlSequenceAction::Respond(reply) => {
                    if let Some(writer) = writers.get_mut(id) {
                        let _ = writer.write_all(reply);
                        let _ = writer.flush();
                    }
                    debug!("Handled terminal query {:?} for {}", &data[i..=cursor], id);
                    i = cursor + 1;
                }
                ControlSequenceAction::Pass => {
                    result.extend_from_slice(&data[i..=cursor]);
                    i = cursor + 1;
                }
            }
        }

        (result, None)
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
            output_event_sender: Arc::new(output_event_sender),
        }
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
                        let payload = serde_json::json!({
                            "session_id": session_id,
                            "terminal_id": terminal_id,
                            "needs_attention": needs_attention
                        });
                        let _ = emit_event(&handle, SchaltEvent::TerminalAttention, &payload);
                    }
                }
            }
        });
    }

    fn resolve_command(command: &str) -> String {
        resolve_command(command)
    }

    async fn get_shell_command() -> CommandBuilder {
        let (shell, args) = get_shell_config().await;
        let mut cmd = CommandBuilder::new(shell.clone());
        for arg in args {
            cmd.arg(arg);
        }
        // Ensure `$SHELL` inside the session matches the launched shell
        cmd.env("SHELL", shell);
        cmd
    }

    fn clear_command_environment(cmd: &mut CommandBuilder) {
        // Don't clear environment - we need to preserve Claude auth and other important variables
        // Just ensure we don't have conflicting terminal settings
        #[allow(unused_must_use)]
        {
            // Only remove specific problematic variables if needed, don't clear everything
            cmd.env_remove("PROMPT_COMMAND"); // Can interfere with terminal
            cmd.env_remove("PS1"); // Let shell set its own prompt
        }
    }

    fn build_environment(cols: u16, rows: u16) -> Vec<(String, String)> {
        let mut envs = vec![
            ("TERM".to_string(), "xterm-256color".to_string()),
            ("LINES".to_string(), rows.to_string()),
            ("COLUMNS".to_string(), cols.to_string()),
        ];

        let path_value = if let Ok(home) = std::env::var("HOME") {
            envs.push(("HOME".to_string(), home.clone()));

            let mut path_components = vec![
                format!("{home}/.local/bin"),
                format!("{home}/.cargo/bin"),
                format!("{home}/.pyenv/shims"),
                format!("{home}/bin"),
                format!("{home}/.nvm/current/bin"),
                format!("{home}/.volta/bin"),
                format!("{home}/.fnm"),
                "/opt/homebrew/bin".to_string(),
                "/usr/local/bin".to_string(),
                "/usr/bin".to_string(),
                "/bin".to_string(),
                "/usr/sbin".to_string(),
                "/sbin".to_string(),
            ];

            if let Ok(existing_path) = std::env::var("PATH") {
                for component in existing_path.split(':') {
                    let component = component.trim();
                    if !component.is_empty() && !path_components.contains(&component.to_string()) {
                        path_components.push(component.to_string());
                    }
                }
            }

            path_components.join(":")
        } else {
            std::env::var("PATH").unwrap_or_else(|_| {
                "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
            })
        };

        envs.push(("PATH".to_string(), path_value));

        let lang_value = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
        envs.push(("LANG".to_string(), lang_value));

        if let Ok(lc_all) = std::env::var("LC_ALL") {
            envs.push(("LC_ALL".to_string(), lc_all));
        }

        envs.push(("CLICOLOR".to_string(), "1".to_string()));
        envs.push(("CLICOLOR_FORCE".to_string(), "1".to_string()));

        envs
    }

    fn setup_environment(cmd: &mut CommandBuilder, cols: u16, rows: u16) {
        for (key, value) in Self::build_environment(cols, rows) {
            cmd.env(key, value);
        }
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
                        let terminals_clone2 = Arc::clone(&reader_state.terminals);
                        let app_handle_clone2 =
                            Arc::clone(&reader_state.coalescing_state.app_handle);
                        let coalescing_state_clone = reader_state.coalescing_state.clone();
                        let pty_children_clone = Arc::clone(&reader_state.pty_children);
                        let pty_masters_clone = Arc::clone(&reader_state.pty_masters);
                        let pty_writers_clone = Arc::clone(&reader_state.pty_writers);
                        runtime.block_on(async move {
                            // Remove terminal state
                            terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                            // Remove PTY resources
                            if let Some(mut child) = pty_children_clone
                                .lock()
                                .await
                                .remove(&id_clone_for_cleanup)
                            {
                                let _ = child.kill();
                            }
                            pty_masters_clone.lock().await.remove(&id_clone_for_cleanup);
                            pty_writers_clone.lock().await.remove(&id_clone_for_cleanup);
                            // Clear coalescing buffers
                            coalescing_state_clone
                                .clear_for(&id_clone_for_cleanup)
                                .await;
                            // Emit terminal closed event
                            if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                let _ = emit_event(
                                    handle,
                                    SchaltEvent::TerminalClosed,
                                    &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
                                );
                            }
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
                        let (sanitized, remainder) =
                            Self::sanitize_control_sequences(&id, &data, &mut writers);
                        drop(writers);

                        if let Some(rest) = remainder {
                            pending_guard.insert(id.clone(), rest);
                        } else {
                            pending_guard.remove(&id);
                        }
                        drop(pending_guard);

                        if sanitized.is_empty() {
                            continue;
                        }

                        let sanitized_len = sanitized.len();

                        let id_clone = id.clone();
                        let terminals_clone = Arc::clone(&reader_state.terminals);
                        let coalescing_state_clone = reader_state.coalescing_state.clone();
                        let suspended_clone = Arc::clone(&reader_state.suspended);
                        let output_event_sender_clone =
                            Arc::clone(&reader_state.output_event_sender);

                        runtime.block_on(async move {
                            let mut terminals = terminals_clone.write().await;
                            if let Some(state) = terminals.get_mut(&id_clone) {
                                // Append to ring buffer
                                state.buffer.extend_from_slice(&sanitized);
                                // Select buffer limit based on terminal type
                                let max_size = if Self::is_agent_terminal(&id_clone) {
                                    AGENT_MAX_BUFFER_SIZE
                                } else {
                                    DEFAULT_MAX_BUFFER_SIZE
                                };

                                // Increment sequence and update last output time
                                state.seq = state.seq.saturating_add(sanitized_len as u64);
                                state.last_output = SystemTime::now();

                                // Observe bytes for idle detection
                                let now = Instant::now();
                                state.idle_detector.observe_bytes(now, &sanitized);

                                // Trim buffer if needed and update start_seq accordingly
                                if state.buffer.len() > max_size {
                                    let excess = state.buffer.len() - max_size;
                                    state.buffer.drain(0..excess);
                                    state.start_seq = state.start_seq.saturating_add(excess as u64);
                                }

                                let new_seq = state.seq;

                                // Handle output emission - different strategies for agent vs standard terminals
                                drop(terminals); // release lock before awaits below

                                // Emit deterministic event for test synchronization
                                let _ = output_event_sender_clone.send((id_clone.clone(), new_seq));

                                if suspended_clone.read().await.contains(&id_clone) {
                                    return;
                                }

                                // All terminals now use UTF-8 stream for consistent malformed byte handling
                                handle_coalesced_output(
                                    &coalescing_state_clone,
                                    CoalescingParams {
                                        terminal_id: &id_clone,
                                        data: &sanitized,
                                    },
                                )
                                .await;
                            }
                        });
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            error!("Terminal {id} read error: {e}");
                            // On read error, clean up and notify
                            let id_clone_for_cleanup = id.clone();
                            let terminals_clone2 = Arc::clone(&reader_state.terminals);
                            let app_handle_clone2 =
                                Arc::clone(&reader_state.coalescing_state.app_handle);
                            let coalescing_state_clone = reader_state.coalescing_state.clone();
                            let pty_children_clone = Arc::clone(&reader_state.pty_children);
                            let pty_masters_clone = Arc::clone(&reader_state.pty_masters);
                            let pty_writers_clone = Arc::clone(&reader_state.pty_writers);
                            runtime.block_on(async move {
                                terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                                if let Some(mut child) = pty_children_clone
                                    .lock()
                                    .await
                                    .remove(&id_clone_for_cleanup)
                                {
                                    let _ = child.kill();
                                }
                                pty_masters_clone.lock().await.remove(&id_clone_for_cleanup);
                                pty_writers_clone.lock().await.remove(&id_clone_for_cleanup);
                                // Clear coalescing buffers
                                coalescing_state_clone
                                    .clear_for(&id_clone_for_cleanup)
                                    .await;
                                if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                    let _ = emit_event(
                                        handle,
                                        SchaltEvent::TerminalClosed,
                                        &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
                                    );
                                }
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

        let mut cmd = if let Some(app) = params.app {
            let resolved_command = Self::resolve_command(&app.command);
            info!(
                "Resolved command '{}' to '{}'",
                app.command, resolved_command
            );

            // Log the exact command that will be executed
            // Show args with proper quoting so it's clear what's a single argument
            let args_str = app
                .args
                .iter()
                .map(|arg| {
                    if arg.contains(' ') {
                        format!("'{arg}'")
                    } else {
                        arg.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            info!("EXACT COMMAND EXECUTION: {resolved_command} {args_str}");
            info!(
                "Command args array (each element is a separate argument): {:?}",
                app.args
            );

            let mut cmd = CommandBuilder::new(resolved_command);
            Self::clear_command_environment(&mut cmd);
            for arg in app.args {
                cmd.arg(arg);
            }
            Self::setup_environment(&mut cmd, cols, rows);
            for (key, value) in app.env {
                cmd.env(key, value);
            }
            cmd
        } else {
            let mut cmd = Self::get_shell_command().await;
            Self::clear_command_environment(&mut cmd);
            Self::setup_environment(&mut cmd, cols, rows);
            cmd
        };

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
            format!("Failed to spawn command: {e}")
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

        // Start process monitoring AFTER PTY resources are stored
        Self::start_process_monitor(
            id.clone(),
            Arc::clone(&self.terminals),
            Arc::clone(&self.coalescing_state.app_handle),
            Arc::clone(&self.pty_children),
            Arc::clone(&self.pty_masters),
            Arc::clone(&self.pty_writers),
        )
        .await;

        let session_id = session_id_from_terminal_id(&id);

        let state = TerminalState {
            buffer: Vec::new(),
            seq: 0,
            start_seq: 0,
            last_output: SystemTime::now(),
            screen: VisibleScreen::new(rows, cols),
            idle_detector: IdleDetector::new(IDLE_THRESHOLD_MS, IDLE_WINDOW_LINES),
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
}

fn session_id_from_terminal_id(id: &str) -> Option<String> {
    let mut rest = if let Some(suffix) = id.strip_prefix("session-") {
        suffix
    } else if let Some(suffix) = id.strip_prefix("orchestrator-") {
        suffix
    } else {
        return None;
    };

    if let Some((prefix, maybe_index)) = rest.rsplit_once('-') {
        if maybe_index.chars().all(|c| c.is_ascii_digit()) {
            rest = prefix;
        }
    }

    for suffix in ["-top", "-bottom"] {
        if let Some(stripped) = rest.strip_suffix(suffix) {
            return Some(stripped.to_string());
        }
    }

    None
}

impl LocalPtyAdapter {
    /// Checks if a terminal ID corresponds to an agent terminal (top terminals for sessions)
    fn is_agent_terminal(terminal_id: &str) -> bool {
        terminal_id.contains("-top")
            && (terminal_id.contains("session-") || terminal_id.contains("orchestrator-"))
    }

    /// Determines the agent type from terminal ID
    fn get_agent_type_from_terminal(terminal_id: &str) -> Option<&'static str> {
        if terminal_id.contains("codex") {
            Some("codex")
        } else if terminal_id.contains("claude") {
            Some("claude")
        } else if terminal_id.contains("opencode") {
            Some("opencode")
        } else if terminal_id.contains("gemini") {
            Some("gemini")
        } else {
            None
        }
    }

    /// Logs detailed information about agent crashes
    async fn log_agent_crash_details(terminal_id: &str, exit_status: &portable_pty::ExitStatus) {
        let agent_type = Self::get_agent_type_from_terminal(terminal_id).unwrap_or("unknown");

        error!("=== AGENT CRASH REPORT ===");
        error!("Terminal ID: {terminal_id}");
        error!("Agent Type: {agent_type}");
        error!("Exit Status: {exit_status:?}");
        error!("Exit Code: {:?}", exit_status.exit_code());
        error!("Success: {}", exit_status.success());

        // Extract session name for context
        if let Some(session_name) = Self::extract_session_name(terminal_id) {
            error!("Session Name: {session_name}");
        }

        error!("=== END CRASH REPORT ===");
    }

    /// Extracts session name from terminal ID
    fn extract_session_name(terminal_id: &str) -> Option<String> {
        if terminal_id.starts_with("session-") && terminal_id.ends_with("-top") {
            let without_prefix = terminal_id.strip_prefix("session-")?;
            let without_suffix = without_prefix.strip_suffix("-top")?;
            Some(without_suffix.to_string())
        } else if terminal_id.starts_with("orchestrator-") && terminal_id.ends_with("-top") {
            let without_prefix = terminal_id.strip_prefix("orchestrator-")?;
            let without_suffix = without_prefix.strip_suffix("-top")?;
            Some(without_suffix.to_string())
        } else {
            None
        }
    }

    /// Checks agent health by monitoring activity patterns
    async fn check_agent_health(
        terminal_id: &str,
        terminals: &Arc<RwLock<HashMap<String, TerminalState>>>,
        last_activity_check: &mut std::time::Instant,
    ) {
        let now = std::time::Instant::now();
        let since_last_check = now.duration_since(*last_activity_check);

        // Check every 30 seconds for agent health
        if since_last_check < std::time::Duration::from_secs(30) {
            return;
        }

        *last_activity_check = now;

        let terminals_guard = terminals.read().await;
        if let Some(state) = terminals_guard.get(terminal_id) {
            if let Ok(elapsed) = std::time::SystemTime::now().duration_since(state.last_output) {
                let elapsed_secs = elapsed.as_secs();

                // Different thresholds for different agents
                let inactivity_threshold =
                    if Self::get_agent_type_from_terminal(terminal_id) == Some("codex") {
                        300 // 5 minutes for Codex - it might be thinking
                    } else {
                        600 // 10 minutes for other agents
                    };

                if elapsed_secs > inactivity_threshold {
                    warn!(
                        "AGENT HEALTH WARNING: Terminal {terminal_id} has been inactive for {elapsed_secs} seconds (threshold: {inactivity_threshold})"
                    );

                    // Log buffer state for debugging
                    debug!(
                        "Agent terminal {terminal_id} buffer size: {} bytes, seq: {}",
                        state.buffer.len(),
                        state.seq
                    );
                }
            }
        }
    }

    /// Handles agent crashes with detailed logging and recovery
    async fn handle_agent_crash(
        terminal_id: String,
        exit_status: portable_pty::ExitStatus,
        terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
        pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
        pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    ) {
        error!("HANDLING AGENT CRASH for terminal: {terminal_id}");

        // Extract crash context
        let agent_type = Self::get_agent_type_from_terminal(&terminal_id).unwrap_or("unknown");
        let session_name = Self::extract_session_name(&terminal_id);

        // Get terminal state before cleanup for forensics
        let (buffer_size, last_seq) = {
            let terminals_guard = terminals.read().await;
            if let Some(state) = terminals_guard.get(&terminal_id) {
                (state.buffer.len(), state.seq)
            } else {
                (0, 0)
            }
        };

        error!(
            "AGENT CRASH DETAILS: agent={}, session={:?}, exit_code={:?}, buffer_size={}, last_seq={}",
            agent_type,
            session_name,
            exit_status.exit_code(),
            buffer_size,
            last_seq
        );

        // Enhanced cleanup with crash reporting
        Self::cleanup_dead_terminal(
            terminal_id.clone(),
            terminals,
            app_handle.clone(),
            pty_children,
            pty_masters,
            pty_writers,
        )
        .await;

        // Emit crash event for frontend handling
        let handle_guard = app_handle.lock().await;
        if let Some(handle) = handle_guard.as_ref() {
            #[derive(serde::Serialize, Clone)]
            struct AgentCrashPayload {
                terminal_id: String,
                agent_type: String,
                session_name: Option<String>,
                exit_code: Option<i32>,
                buffer_size: usize,
                last_seq: u64,
            }

            let payload = AgentCrashPayload {
                terminal_id: terminal_id.clone(),
                agent_type: agent_type.to_string(),
                session_name,
                exit_code: Some(exit_status.exit_code() as i32),
                buffer_size,
                last_seq,
            };

            if let Err(e) = emit_event(handle, SchaltEvent::AgentCrashed, &payload) {
                warn!("Failed to emit agent-crashed event for {terminal_id}: {e}");
            } else {
                info!("Emitted agent-crashed event for terminal: {terminal_id}");
            }
        }

        info!("Agent crash handling completed for terminal: {terminal_id}");
    }

    pub async fn get_activity_status(&self, id: &str) -> Result<(bool, u64), String> {
        let terminals = self.terminals.read().await;
        if let Some(state) = terminals.get(id) {
            let elapsed = SystemTime::now()
                .duration_since(state.last_output)
                .map_err(|e| format!("Time error: {e}"))?
                .as_secs();
            // Always return false for stuck status
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

    async fn start_process_monitor(
        id: String,
        terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
        pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
        pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    ) {
        let monitor_id = id.clone();
        let is_agent_terminal = Self::is_agent_terminal(&monitor_id);

        if is_agent_terminal {
            info!("Starting enhanced monitoring for agent terminal: {monitor_id}");
        }

        // Use exponential backoff for better performance
        let mut check_interval = tokio::time::Duration::from_secs(1);
        let max_interval = tokio::time::Duration::from_secs(30);
        let mut last_activity_check = std::time::Instant::now();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(check_interval).await;

                // Check if child process is still alive - do this first to avoid races
                let should_cleanup = {
                    let child_guard = pty_children.lock().await;
                    match child_guard.get(&monitor_id) {
                        Some(_child) => {
                            // Process exists, continue monitoring
                            false
                        }
                        None => {
                            debug!(
                                "Terminal {monitor_id} child process not found, stopping monitor"
                            );
                            true // Process gone, stop monitoring
                        }
                    }
                };

                if should_cleanup {
                    break;
                }

                // Check if terminal state still exists
                if !terminals.read().await.contains_key(&monitor_id) {
                    debug!("Terminal {monitor_id} state removed, stopping process monitor");
                    break;
                }

                // Check if process has exited (separate scope to avoid deadlocks)
                let process_status = {
                    let mut child_guard = pty_children.lock().await;
                    if let Some(child) = child_guard.get_mut(&monitor_id) {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                if is_agent_terminal {
                                    if status.success() {
                                        info!("Agent terminal {monitor_id} exited normally with status: {status:?}");
                                    } else {
                                        error!("AGENT CRASH DETECTED: Terminal {monitor_id} exited with error status: {status:?}");
                                        Self::log_agent_crash_details(&monitor_id, &status).await;
                                    }
                                } else {
                                    info!("Terminal {monitor_id} process exited with status: {status:?}");
                                }
                                Some(status)
                            }
                            Ok(None) => {
                                // Process is still running, but check for agent-specific issues
                                if is_agent_terminal {
                                    Self::check_agent_health(
                                        &monitor_id,
                                        &terminals,
                                        &mut last_activity_check,
                                    )
                                    .await;
                                }
                                None
                            }
                            Err(e) => {
                                if is_agent_terminal {
                                    error!("AGENT MONITORING ERROR: Failed to check terminal {monitor_id} process status: {e}");
                                } else {
                                    warn!(
                                        "Failed to check terminal {monitor_id} process status: {e}"
                                    );
                                }
                                // Assume process is dead - create a dummy status
                                Some(portable_pty::ExitStatus::with_exit_code(1))
                            }
                        }
                    } else {
                        // Process disappeared
                        if is_agent_terminal {
                            error!("AGENT PROCESS DISAPPEARED: Terminal {monitor_id} process vanished during check");
                        } else {
                            debug!("Terminal {monitor_id} process disappeared during check");
                        }
                        break;
                    }
                };

                // Handle process exit outside of locks
                if let Some(status) = process_status {
                    if is_agent_terminal {
                        Self::handle_agent_crash(
                            monitor_id.clone(),
                            status,
                            Arc::clone(&terminals),
                            Arc::clone(&app_handle),
                            Arc::clone(&pty_children),
                            Arc::clone(&pty_masters),
                            Arc::clone(&pty_writers),
                        )
                        .await;
                    } else {
                        Self::cleanup_dead_terminal(
                            monitor_id.clone(),
                            Arc::clone(&terminals),
                            Arc::clone(&app_handle),
                            Arc::clone(&pty_children),
                            Arc::clone(&pty_masters),
                            Arc::clone(&pty_writers),
                        )
                        .await;
                    }
                    break;
                }

                // Increase interval for better performance (exponential backoff)
                check_interval = std::cmp::min(check_interval * 2, max_interval);
            }

            if is_agent_terminal {
                info!("Agent monitor for terminal {monitor_id} terminated");
            } else {
                debug!("Process monitor for terminal {monitor_id} terminated");
            }
        });
    }

    async fn cleanup_dead_terminal(
        id: String,
        terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
        pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
        pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    ) {
        info!("Cleaning up dead terminal: {id}");

        // Remove from all maps
        pty_children.lock().await.remove(&id);
        pty_masters.lock().await.remove(&id);
        pty_writers.lock().await.remove(&id);
        terminals.write().await.remove(&id);

        // Emit terminal closed event
        let handle_guard = app_handle.lock().await;
        match handle_guard.as_ref() {
            Some(handle) => {
                if let Err(e) = emit_event(
                    handle,
                    SchaltEvent::TerminalClosed,
                    &serde_json::json!({"terminal_id": id}),
                ) {
                    warn!("Failed to emit terminal-closed event for {id}: {e}");
                }
            }
            None => {
                debug!("Skipping terminal-closed event during app shutdown for terminal {id}");
            }
        }

        info!("Dead terminal {id} cleanup completed");
    }

    /// Wait for terminal output to change (deterministic alternative to sleep)
    /// Returns when the terminal's sequence number increases from the given threshold
    pub async fn wait_for_output_change(&self, id: &str, min_seq: u64) -> Result<u64, String> {
        let mut receiver = self.output_event_sender.subscribe();

        // First check if we already have enough output
        if let Some(state) = self.terminals.read().await.get(id) {
            if state.seq > min_seq {
                return Ok(state.seq);
            }
        } else {
            return Err(format!("Terminal {id} not found"));
        }

        // Wait for output change event with timeout to prevent infinite hang
        let timeout_duration = Duration::from_secs(10); // 10 second safety timeout
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
                // Fallback: check terminal state one more time
                if let Some(state) = self.terminals.read().await.get(id) {
                    if state.seq > min_seq {
                        Ok(state.seq)
                    } else {
                        Err(format!("Timeout waiting for output change on terminal {id}. Current seq: {}, waiting for: > {}", state.seq, min_seq))
                    }
                } else {
                    Err(format!("Terminal {id} not found after timeout"))
                }
            }
        }
    }

    /// Execute a command and wait for it to produce output (deterministic)
    pub async fn write_and_wait(&self, id: &str, data: &[u8]) -> Result<u64, String> {
        // Get current sequence before writing
        let initial_seq = {
            let terminals = self.terminals.read().await;
            if let Some(state) = terminals.get(id) {
                state.seq
            } else {
                return Err(format!("Terminal {id} not found"));
            }
        };

        // Write the command
        self.write(id, data).await?;

        // Wait for output to change
        self.wait_for_output_change(id, initial_seq).await
    }
}

async fn get_shell_config() -> (String, Vec<String>) {
    // Use shared effective shell resolution (respects settings when available)
    let (shell, args) = super::get_effective_shell();
    info!(
        "Using shell: {shell}{}",
        if args.is_empty() {
            " (no args)"
        } else {
            " (with args)"
        }
    );
    (shell, args)
}

fn resolve_command(command: &str) -> String {
    if command.contains('/') {
        return command.to_string();
    }

    let common_paths = vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    if let Ok(home) = std::env::var("HOME") {
        let mut user_paths = vec![
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/bin", home),
        ];
        user_paths.extend(common_paths.iter().map(|s| s.to_string()));

        for path in user_paths {
            let full_path = PathBuf::from(&path).join(command);
            if full_path.exists() {
                info!("Found {command} at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    } else {
        for path in common_paths {
            let full_path = PathBuf::from(path).join(command);
            if full_path.exists() {
                info!("Found {command} at {}", full_path.display());
                return full_path.to_string_lossy().to_string();
            }
        }
    }

    if let Ok(output) = std::process::Command::new("which").arg(command).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    info!("Found {command} via which: {path}");
                    return path.to_string();
                }
            }
        }
    }

    warn!("Could not resolve path for '{command}', using as-is");
    command.to_string()
}

#[cfg(test)]
mod tests {
    use super::super::ApplicationSpec;
    use super::*;
    use futures;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;
    use tokio::time::sleep;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn extracts_session_id_for_basic_top_terminal() {
        let id = "session-pr-68-top";
        assert_eq!(session_id_from_terminal_id(id), Some("pr-68".to_string()));
    }

    #[test]
    fn retains_embedded_top_segment_in_session_name() {
        let id = "session-feature-top-top";
        assert_eq!(
            session_id_from_terminal_id(id),
            Some("feature-top".to_string())
        );
    }

    #[test]
    fn supports_bottom_terminals_with_indices() {
        let id = "session-top-nav-bottom-0";
        assert_eq!(session_id_from_terminal_id(id), Some("top-nav".to_string()));
    }

    #[test]
    fn accepts_orchestrator_terminals() {
        let id = "orchestrator-main-top";
        assert_eq!(session_id_from_terminal_id(id), Some("main".to_string()));
    }

    struct RecordingWriter {
        records: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingWriter {
        fn new(records: Arc<Mutex<Vec<String>>>) -> Self {
            Self { records }
        }
    }

    impl std::io::Write for RecordingWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let mut guard = self.records.lock().unwrap();
            guard.push(String::from_utf8_lossy(buf).to_string());
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    // Helper function to wait for command output with simple polling fallback
    async fn execute_command_and_wait(
        adapter: &LocalPtyAdapter,
        id: &str,
        command: &[u8],
    ) -> Result<String, String> {
        // Get initial sequence
        let initial_seq = {
            let terminals = adapter.terminals.read().await;
            if let Some(state) = terminals.get(id) {
                state.seq
            } else {
                return Err(format!("Terminal {id} not found"));
            }
        };

        // Write command
        adapter.write(id, command).await?;

        // Simple polling with short intervals - more reliable than broadcast channels in test environment
        for _attempt in 0..50 {
            // 50 attempts * 100ms = 5 second max wait
            tokio::time::sleep(Duration::from_millis(100)).await;

            let terminals = adapter.terminals.read().await;
            if let Some(state) = terminals.get(id) {
                if state.seq > initial_seq {
                    drop(terminals);
                    let snapshot = adapter
                        .snapshot(id, None)
                        .await
                        .map_err(|e| format!("Failed to get snapshot: {e}"))?;
                    return Ok(String::from_utf8_lossy(&snapshot.data).to_string());
                }
            }
        }

        // If we get here, return whatever we have
        let snapshot = adapter
            .snapshot(id, None)
            .await
            .map_err(|e| format!("Failed to get snapshot: {e}"))?;
        Ok(String::from_utf8_lossy(&snapshot.data).to_string())
    }

    fn unique_id(prefix: &str) -> String {
        format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[derive(Clone, Default)]
    struct CapturingWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for CapturingWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let mut guard = self.0.lock().unwrap();
            guard.extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn sanitize_control_sequences_handles_cpr_queries() {
        let id = "sanitize-cpr".to_string();
        let writer = CapturingWriter::default();
        let capture = writer.0.clone();
        let mut writers: HashMap<String, Box<dyn Write + Send>> = HashMap::new();
        writers.insert(id.clone(), Box::new(writer));

        let (sanitized, remainder) =
            LocalPtyAdapter::sanitize_control_sequences(&id, b"pre\x1b[6npost", &mut writers);

        assert_eq!(sanitized, b"pre\x1b[6npost");
        assert!(remainder.is_none());

        let buf = capture.lock().unwrap().clone();
        assert!(buf.is_empty());
    }

    #[test]
    fn sanitize_control_sequences_handles_device_attributes_queries() {
        let id = "sanitize-da".to_string();
        let writer = CapturingWriter::default();
        let capture = writer.0.clone();
        let mut writers: HashMap<String, Box<dyn Write + Send>> = HashMap::new();
        writers.insert(id.clone(), Box::new(writer));

        let (sanitized, remainder) =
            LocalPtyAdapter::sanitize_control_sequences(&id, b"pre\x1b[?1;2cpost", &mut writers);

        assert_eq!(sanitized, b"prepost");
        assert!(remainder.is_none());

        let buf = capture.lock().unwrap().clone();
        assert_eq!(buf, b"\x1b[?1;2c".to_vec());
    }

    #[test]
    fn sanitize_control_sequences_returns_pending_for_partial_sequences() {
        let id = "sanitize-partial".to_string();
        let mut writers: HashMap<String, Box<dyn Write + Send>> = HashMap::new();

        let (sanitized, remainder) =
            LocalPtyAdapter::sanitize_control_sequences(&id, b"\x1b[", &mut writers);

        assert!(sanitized.is_empty());
        assert_eq!(remainder.unwrap(), b"\x1b[".to_vec());
    }

    async fn safe_close(adapter: &LocalPtyAdapter, id: &str) {
        if let Err(e) = adapter.close(id).await {
            eprintln!("Warning: Failed to close terminal {}: {}", id, e);
        }
    }

    // ============================================================================
    // BASIC TERMINAL LIFECYCLE TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_create_exists_close() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("basic-lifecycle");

        // Terminal should not exist initially
        assert!(!adapter.exists(&id).await.unwrap());

        // Create terminal
        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        adapter.create(params).await.unwrap();

        // Terminal should exist after creation
        assert!(adapter.exists(&id).await.unwrap());

        // Close terminal
        adapter.close(&id).await.unwrap();

        // Terminal should not exist after closing
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

        // Create with custom size
        adapter.create_with_size(params, 120, 40).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        // Verify we can resize it
        adapter.resize(&id, 100, 30).await.unwrap();

        safe_close(&adapter, &id).await;
        assert!(!adapter.exists(&id).await.unwrap());
    }

    #[tokio::test]
    async fn test_create_with_custom_app() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("custom-app");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: Some(ApplicationSpec {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), "echo test && sleep 1".to_string()],
                env: vec![("TEST_VAR".to_string(), "test_value".to_string())],
                ready_timeout_ms: 1000,
            }),
        };

        let result = adapter.create(params).await;
        match result {
            Ok(_) => {
                // Check existence immediately before the command has a chance to exit
                assert!(adapter.exists(&id).await.unwrap());
            }
            Err(e) => {
                panic!("Failed to create terminal with custom app: {}", e);
            }
        }

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // TERMINAL OUTPUT AND BUFFER MANAGEMENT TESTS
    // ============================================================================

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

        // Execute command and wait for output deterministically
        let output = execute_command_and_wait(&adapter, &id, b"echo 'test output'\n")
            .await
            .expect("Failed to execute test command");

        // Data should contain our command or output
        assert!(output.contains("echo") || output.contains("test") || !output.is_empty());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_snapshot_nonexistent_terminal() {
        let adapter = LocalPtyAdapter::new();
        let snapshot = adapter.snapshot("nonexistent", None).await.unwrap();
        assert_eq!(snapshot.seq, 0);
        assert!(snapshot.data.is_empty());
    }

    #[tokio::test]
    async fn test_snapshot_with_sequence() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("snapshot-seq");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();

        // Execute first command and get sequence
        let _output1 = execute_command_and_wait(&adapter, &id, b"echo 'first'\n")
            .await
            .expect("Failed to execute first command");

        let snapshot1 = adapter.snapshot(&id, None).await.unwrap();
        let seq1 = snapshot1.seq;

        // Execute second command and get sequence
        let _output2 = execute_command_and_wait(&adapter, &id, b"echo 'second'\n")
            .await
            .expect("Failed to execute second command");

        let snapshot2 = adapter.snapshot(&id, None).await.unwrap();
        let seq2 = snapshot2.seq;

        // Sequence should have increased
        assert!(seq2 > seq1);

        // Request incremental snapshot from previous sequence
        let delta = adapter.snapshot(&id, Some(seq1)).await.unwrap();
        let delta_str = String::from_utf8_lossy(&delta.data);
        assert!(delta_str.contains("second") || !delta.data.is_empty());

        // Requesting a cursor beyond the latest seq should resend from start_seq instead of empty
        let stale = adapter.snapshot(&id, Some(seq2 + 500)).await.unwrap();
        let stale_str = String::from_utf8_lossy(&stale.data);
        assert!(stale_str.contains("second") || !stale.data.is_empty());

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // RESIZE AND TERMINAL CONTROL TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_resize_operations() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("resize-test");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();

        // Test various resize operations
        adapter.resize(&id, 80, 24).await.unwrap();
        adapter.resize(&id, 120, 40).await.unwrap();
        adapter.resize(&id, 160, 50).await.unwrap();

        // Test edge case sizes
        adapter.resize(&id, 1, 1).await.unwrap();
        adapter.resize(&id, 1000, 1000).await.unwrap();

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_resize_nonexistent_terminal() {
        let adapter = LocalPtyAdapter::new();
        // Should not error when resizing non-existing terminal
        adapter.resize("nonexistent", 80, 24).await.unwrap();
    }

    // ============================================================================
    // WRITE OPERATION TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_write_nonexistent_terminal() {
        let adapter = LocalPtyAdapter::new();
        // Should not error when writing to non-existing terminal
        adapter.write("nonexistent", b"test data").await.unwrap();
    }

    #[tokio::test]
    async fn test_write_special_characters() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("special-chars");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        // Test various special characters and escape sequences
        let test_data = vec![
            b"\n".as_slice(),            // newline
            b"\r".as_slice(),            // carriage return
            b"\x1b[A".as_slice(),        // arrow key escape sequence
            b"\x1b[1;2H".as_slice(),     // cursor positioning
            b"\t".as_slice(),            // tab
            b"normal text\n".as_slice(), // normal text
        ];

        for data in test_data {
            adapter.write(&id, data).await.unwrap();
            sleep(Duration::from_millis(50)).await;
        }

        let snapshot = adapter.snapshot(&id, None).await.unwrap();
        assert!(!snapshot.data.is_empty());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_write_immediate_flush() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("flush-test");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        // Test data that should trigger immediate flush
        let flush_triggers = vec![
            b"echo test\n".as_slice(), // newline
            b"ls\r".as_slice(),        // carriage return
            b"\x1b[A".as_slice(),      // escape sequence
        ];

        for data in flush_triggers {
            adapter.write(&id, data).await.unwrap();
        }

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // CONCURRENT OPERATIONS TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_concurrent_terminal_creation() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let num_terminals = 5;
        let mut handles = vec![];

        for i in 0..num_terminals {
            let adapter_clone = Arc::clone(&adapter);
            let handle = tokio::spawn(async move {
                let id = unique_id(&format!("concurrent-{}", i));
                let params = CreateParams {
                    id: id.clone(),
                    cwd: "/tmp".to_string(),
                    app: None,
                };
                adapter_clone.create(params).await.unwrap();
                id
            });
            handles.push(handle);
        }

        let created_ids: Vec<String> = futures::future::join_all(handles)
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(created_ids.len(), num_terminals);

        for id in &created_ids {
            assert!(adapter.exists(id).await.unwrap());
        }

        // Cleanup
        for id in &created_ids {
            safe_close(&adapter, id).await;
        }
    }

    #[tokio::test]
    async fn test_concurrent_writes_same_terminal() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let id = unique_id("concurrent-writes");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        let records = Arc::new(Mutex::new(Vec::new()));
        {
            let mut writers = adapter.pty_writers.lock().await;
            writers.insert(
                id.clone(),
                Box::new(RecordingWriter::new(Arc::clone(&records))),
            );
        }

        let adapter_clone = Arc::clone(&adapter);
        let id_clone = id.clone();
        let write_handle = tokio::spawn(async move {
            for i in 0..6 {
                adapter_clone
                    .write(&id_clone, format!("input {i}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });

        let adapter_clone2 = Arc::clone(&adapter);
        let id_clone2 = id.clone();
        let write_handle2 = tokio::spawn(async move {
            for i in 6..12 {
                adapter_clone2
                    .write(&id_clone2, format!("data {i}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });

        let (res1, res2) = tokio::join!(write_handle, write_handle2);
        res1.unwrap();
        res2.unwrap();

        assert!(adapter.exists(&id).await.unwrap());
        let recorded = records.lock().unwrap();
        assert_eq!(recorded.len(), 12);

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_concurrent_reads_and_writes() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let id = unique_id("concurrent-rw");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        let adapter_clone = Arc::clone(&adapter);
        let id_clone = id.clone();
        let write_handle = tokio::spawn(async move {
            for i in 0..5 {
                adapter_clone
                    .write(&id_clone, format!("echo 'test {}'\n", i).as_bytes())
                    .await
                    .unwrap();
                sleep(Duration::from_millis(50)).await;
            }
        });

        let adapter_clone2 = Arc::clone(&adapter);
        let id_clone2 = id.clone();
        let read_handle = tokio::spawn(async move {
            for _ in 0..5 {
                let _ = adapter_clone2.snapshot(&id_clone2, None).await.unwrap();
                sleep(Duration::from_millis(30)).await;
            }
        });

        let _ = tokio::join!(write_handle, read_handle);

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // ACTIVITY MONITORING TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_activity_status_elapsed_tracking() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("activity-test");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create(params).await.unwrap();

        // Immediately after create, should not be stuck
        let (stuck, elapsed) = adapter.get_activity_status(&id).await.unwrap();
        assert!(!stuck);
        assert!(elapsed < 10); // Should be very recent

        // Manually simulate an old last_output to ensure elapsed time reflects inactivity
        {
            let mut terminals = adapter.terminals.write().await;
            if let Some(state) = terminals.get_mut(&id) {
                state.last_output = SystemTime::now() - Duration::from_secs(120);
            }
        }

        let (stuck2, elapsed2) = adapter.get_activity_status(&id).await.unwrap();
        // The adapter should always report not stuck
        assert!(!stuck2);
        assert!(elapsed2 >= 120);

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_activity_status_nonexistent() {
        let adapter = LocalPtyAdapter::new();
        let result = adapter.get_activity_status("nonexistent").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn test_get_all_terminal_activity() {
        let adapter = LocalPtyAdapter::new();
        let mut ids = vec![];

        // Create multiple terminals
        for i in 0..3 {
            let id = unique_id(&format!("activity-all-{}", i));
            let params = CreateParams {
                id: id.clone(),
                cwd: "/tmp".to_string(),
                app: None,
            };

            adapter.create(params).await.unwrap();
            ids.push(id);
        }

        let activities = adapter.get_all_terminal_activity().await;
        assert_eq!(activities.len(), 3);

        for (id, elapsed) in activities {
            assert!(ids.contains(&id));
            assert!(elapsed < 60); // Allow up to 60 seconds for test environment
        }

        // Cleanup
        for id in ids {
            safe_close(&adapter, &id).await;
        }
    }

    // ============================================================================
    // ENVIRONMENT AND SHELL CONFIGURATION TESTS
    // ============================================================================

    #[test]
    fn test_environment_variables_setup() {
        let envs = LocalPtyAdapter::build_environment(150, 50);
        let env_map: HashMap<_, _> = envs.into_iter().collect();

        assert_eq!(env_map.get("LINES"), Some(&"50".to_string()));
        assert_eq!(env_map.get("COLUMNS"), Some(&"150".to_string()));
        assert_eq!(env_map.get("TERM"), Some(&"xterm-256color".to_string()));

        let path_value = env_map.get("PATH").expect("PATH should be set");
        assert!(
            path_value.contains("/usr/bin"),
            "PATH should include /usr/bin: {path_value}"
        );

        assert_eq!(env_map.get("CLICOLOR"), Some(&"1".to_string()));
        assert_eq!(env_map.get("CLICOLOR_FORCE"), Some(&"1".to_string()));
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

        // Just verify that the terminal can be created with custom environment variables
        adapter.create(params).await.unwrap();
        // Check existence immediately before the command has a chance to exit
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // RESOURCE MANAGEMENT AND CLEANUP TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_double_create_same_id() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("double-create");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        // First create should succeed
        adapter.create(params.clone()).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        // Second create should succeed (idempotent)
        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_close_nonexistent_terminal() {
        let adapter = LocalPtyAdapter::new();
        // Should not error when closing non-existing terminal
        adapter.close("nonexistent").await.unwrap();
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

        // Only one terminal should exist
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;
    }

    // ============================================================================
    // ERROR HANDLING AND EDGE CASES TESTS
    // ============================================================================

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

        // Should fail with command not found
        let result = adapter.create(params).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to spawn command"));
    }

    #[tokio::test]
    async fn test_temporary_directory_creation() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().to_string_lossy().to_string();

        let adapter = LocalPtyAdapter::new();
        let id = unique_id("temp-dir");

        let params = CreateParams {
            id: id.clone(),
            cwd: temp_path,
            app: None,
        };

        adapter.create(params).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        safe_close(&adapter, &id).await;

        // Temp directory should be cleaned up automatically
        temp_dir.close().unwrap();
    }

    #[tokio::test]
    async fn test_command_resolution() {
        // Test the resolve_command function directly
        let resolved = resolve_command("bash");
        assert!(!resolved.is_empty());

        let resolved2 = resolve_command("/bin/bash");
        assert_eq!(resolved2, "/bin/bash");

        let resolved3 = resolve_command("nonexistent_command_xyz");
        assert_eq!(resolved3, "nonexistent_command_xyz"); // Should return as-is if not found
    }

    #[tokio::test]
    async fn test_shell_config_fallback() {
        // Test get_shell_config function - now returns no args for simplicity
        let (shell, args) = get_shell_config().await;
        assert!(!shell.is_empty());
        assert!(args.is_empty()); // No special args anymore to avoid shell issues
    }

    // ============================================================================
    // PERFORMANCE AND TIMING TESTS
    // ============================================================================

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

        // Terminal creation should be reasonably fast (< 1 second)
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

        // Perform rapid sequence of operations
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

    // ============================================================================
    // INTEGRATION AND SYSTEM TESTS
    // ============================================================================

    #[tokio::test]
    async fn test_full_terminal_workflow() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("full-workflow");

        // 1. Create terminal
        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create_with_size(params, 100, 30).await.unwrap();
        assert!(adapter.exists(&id).await.unwrap());

        // 2. Wait for initialization
        sleep(Duration::from_millis(200)).await;

        // 3. Send some commands
        adapter.write(&id, b"pwd\n").await.unwrap();
        sleep(Duration::from_millis(100)).await;

        adapter.write(&id, b"ls -la\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        // 4. Check output
        let snapshot = adapter.snapshot(&id, None).await.unwrap();
        assert!(snapshot.seq > 0);
        assert!(!snapshot.data.is_empty());

        // 5. Resize terminal
        adapter.resize(&id, 120, 40).await.unwrap();

        // 6. Send more commands
        adapter
            .write(&id, b"echo 'terminal test complete'\n")
            .await
            .unwrap();
        sleep(Duration::from_millis(100)).await;

        // 7. Check activity
        let (stuck, _) = adapter.get_activity_status(&id).await.unwrap();
        assert!(!stuck);

        // 8. Close terminal
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

        // Generate some output to fill buffers
        adapter.write(&id, b"echo 'test output'\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let snapshot_before_close = adapter.snapshot(&id, None).await.unwrap();
        assert!(!snapshot_before_close.data.is_empty());

        // Close terminal
        adapter.close(&id).await.unwrap();
        assert!(!adapter.exists(&id).await.unwrap());

        // Verify terminal state is cleaned up
        assert!(!adapter.terminals.read().await.contains_key(&id));

        // Verify snapshot returns empty after close
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

        // Generate output to populate coalescing buffers
        adapter
            .write(&id, b"echo 'populate buffers'\n")
            .await
            .unwrap();
        sleep(Duration::from_millis(100)).await;

        // Close terminal
        adapter.close(&id).await.unwrap();

        // Verify all coalescing buffers are cleaned
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

        // Test that we can create the adapter without an app handle
        // In a real application, the app handle would be set during initialization
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

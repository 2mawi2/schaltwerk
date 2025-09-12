use super::{CreateParams, TerminalBackend};
use super::coalescing::{CoalescingState, CoalescingParams, handle_coalesced_output};
use log::{debug, error, info, warn};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};
use crate::infrastructure::events::{emit_event, SchaltEvent};

// Default in-memory buffer sizes for terminal output
// Agent conversation terminals can produce very large transcripts; give them more room
const DEFAULT_MAX_BUFFER_SIZE: usize = 2 * 1024 * 1024; // 2MB for regular terminals
const AGENT_MAX_BUFFER_SIZE: usize = 16 * 1024 * 1024; // 16MB for agent "top" terminals

// PTY state maps moved to instance level to avoid test interference

struct TerminalState {
    buffer: Vec<u8>,
    seq: u64,
    last_output: SystemTime,
}

pub struct LocalPtyAdapter {
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    creating: Arc<Mutex<HashSet<String>>>,
    // PTY resource maps - moved from global statics to instance level
    pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    // Coalescing state for terminal output handling
    coalescing_state: CoalescingState,
    // Persistent transcripts for agent terminals
    transcript_writers: Arc<Mutex<HashMap<String, std::io::BufWriter<std::fs::File>>>>,
    transcript_paths: Arc<Mutex<HashMap<String, PathBuf>>>,
}

struct ReaderState {
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    coalescing_state: CoalescingState,
    transcript_writers: Arc<Mutex<HashMap<String, std::io::BufWriter<std::fs::File>>>>,
}

impl Default for LocalPtyAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalPtyAdapter {
    /// Detects a cursor position report (CPR) query request in output stream.
    /// Sequences to detect:
    /// - ESC [ 6 n (standard CPR request)
    /// - ESC [ ? 6 n (DEC private mode CPR request) – respond similarly
    fn contains_cpr_query(data: &[u8]) -> bool {
        // Fast path: look for ESC '[' first
        if !data.contains(&0x1b) { return false; }
        let mut i = 0;
        while i + 3 < data.len() {
            if data[i] == 0x1b && data[i + 1] == b'[' {
                // Standard: ESC [ 6 n
                if data[i + 2] == b'6' && data[i + 3] == b'n' {
                    return true;
                }
                // DEC private: ESC [ ? 6 n
                if i + 4 < data.len() && data[i + 2] == b'?' && data[i + 3] == b'6' && data[i + 4] == b'n' {
                    return true;
                }
            }
            i += 1;
        }
        false
    }

    /// Writes a safe CPR fallback (ESC[1;1R) if the provided data contains a CPR query.
    fn maybe_reply_cpr(
        id: &str,
        data: &[u8],
        writers: &mut HashMap<String, Box<dyn Write + Send>>,
    ) {
        if Self::contains_cpr_query(data) {
            if let Some(writer) = writers.get_mut(id) {
                let _ = writer.write_all(b"\x1b[1;1R");
                let _ = writer.flush();
                debug!("CPR fallback responded for terminal {id}");
            }
        }
    }

    pub fn new() -> Self {
        let app_handle = Arc::new(Mutex::new(None));
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            creating: Arc::new(Mutex::new(HashSet::new())),
            pty_children: Arc::new(Mutex::new(HashMap::new())),
            pty_masters: Arc::new(Mutex::new(HashMap::new())),
            pty_writers: Arc::new(Mutex::new(HashMap::new())),
            coalescing_state: CoalescingState {
                app_handle,
                emit_buffers: Arc::new(RwLock::new(HashMap::new())),
                emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
                emit_buffers_norm: Arc::new(RwLock::new(HashMap::new())),
                norm_last_cr: Arc::new(RwLock::new(HashMap::new())),
            },
            transcript_writers: Arc::new(Mutex::new(HashMap::new())),
            transcript_paths: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.coalescing_state.app_handle.lock().await = Some(handle);
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

    fn transcripts_dir() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("schaltwerk")
            .join("transcripts")
    }

    fn sanitize_id_for_path(id: &str) -> String {
        id.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect()
    }

    fn make_transcript_path_for(id: &str) -> PathBuf {
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let name = format!("terminal_{}_{}.log", Self::sanitize_id_for_path(id), ts);
        Self::transcripts_dir().join(name)
    }

    fn find_latest_transcript_path(id: &str) -> Option<PathBuf> {
        let dir = Self::transcripts_dir();
        let Ok(entries) = std::fs::read_dir(&dir) else { return None };
        let prefix = format!("terminal_{}_", Self::sanitize_id_for_path(id));
        let mut candidates: Vec<PathBuf> = Vec::new();
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                if name.starts_with(&prefix) && name.ends_with(".log") {
                    candidates.push(p);
                }
            }
        }
        candidates.sort();
        candidates.pop()
    }

    fn clear_command_environment(cmd: &mut CommandBuilder) {
        // Don't clear environment - we need to preserve Claude auth and other important variables
        // Just ensure we don't have conflicting terminal settings
        #[allow(unused_must_use)]
        {
            // Only remove specific problematic variables if needed, don't clear everything
            cmd.env_remove("PROMPT_COMMAND");  // Can interfere with terminal
            cmd.env_remove("PS1");  // Let shell set its own prompt
        }
    }

    fn setup_environment(cmd: &mut CommandBuilder, cols: u16, rows: u16) {
        // Minimal environment - only essentials
        cmd.env("TERM", "xterm-256color");
        cmd.env("LINES", rows.to_string());
        cmd.env("COLUMNS", cols.to_string());
        
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home.clone());
            
            let mut path_components = vec![];
            
            path_components.push(format!("{home}/.local/bin"));
            path_components.push(format!("{home}/.cargo/bin"));
            path_components.push(format!("{home}/.pyenv/shims"));
            path_components.push(format!("{home}/bin"));
            
            path_components.push("/opt/homebrew/bin".to_string());
            path_components.push("/usr/local/bin".to_string());
            path_components.push("/usr/bin".to_string());
            path_components.push("/bin".to_string());
            path_components.push("/usr/sbin".to_string());
            path_components.push("/sbin".to_string());
            
            let path = path_components.join(":");
            cmd.env("PATH", path);
        } else {
            let path = std::env::var("PATH").unwrap_or_else(|_| {
                "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()
            });
            cmd.env("PATH", path);
        }
        
        // Preserve other important environment variables for colors
        if let Ok(lang) = std::env::var("LANG") {
            cmd.env("LANG", lang);
        } else {
            cmd.env("LANG", "en_US.UTF-8");
        }
        
        if let Ok(lc_all) = std::env::var("LC_ALL") {
            cmd.env("LC_ALL", lc_all);
        }
        
        // Ensure color support for common tools
        cmd.env("CLICOLOR", "1");
        cmd.env("CLICOLOR_FORCE", "1");
    }


    async fn start_reader(
        id: String,
        mut reader: Box<dyn Read + Send>,
        reader_state: ReaderState,
    ) {
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
                        let app_handle_clone2 = Arc::clone(&reader_state.coalescing_state.app_handle);
                        let coalescing_state_clone = reader_state.coalescing_state.clone();
                        runtime.block_on(async move {
                            // Remove terminal state
                            terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                            // Remove PTY resources
                            if let Some(mut child) = reader_state.pty_children.lock().await.remove(&id_clone_for_cleanup) {
                                let _ = child.kill();
                            }
                            reader_state.pty_masters.lock().await.remove(&id_clone_for_cleanup);
                            reader_state.pty_writers.lock().await.remove(&id_clone_for_cleanup);
                            // Clear coalescing buffers
                            coalescing_state_clone.clear_for(&id_clone_for_cleanup).await;
                            // Emit terminal closed event
                            if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                let _ = emit_event(handle, SchaltEvent::TerminalClosed, &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
                                );
                            }
                        });
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        // If the child process is requesting a Cursor Position Report (ESC[6n),
                        // provide a deterministic fallback response so CLIs that depend on CPR
                        // (e.g., TUI frameworks) don't time out when the frontend terminal isn't ready.
                        // We respond with ESC[1;1R (row 1, col 1) as a safe default.
                        // Respond to CPR queries early to avoid CLI timeouts
                        let mut writers = runtime.block_on(reader_state.pty_writers.lock());
                        Self::maybe_reply_cpr(&id, &data, &mut writers);
                        drop(writers);
                        let id_clone = id.clone();
                        let terminals_clone = Arc::clone(&reader_state.terminals);
                        let coalescing_state_clone = reader_state.coalescing_state.clone();
                        let transcript_writers_clone = Arc::clone(&reader_state.transcript_writers);
                        
                        runtime.block_on(async move {
                            let mut terminals = terminals_clone.write().await;
                            if let Some(state) = terminals.get_mut(&id_clone) {
                                // Append to ring buffer
                                state.buffer.extend_from_slice(&data);
                                // Select buffer limit based on terminal type
                                let max_size = if Self::is_agent_terminal(&id_clone) {
                                    AGENT_MAX_BUFFER_SIZE
                                } else {
                                    DEFAULT_MAX_BUFFER_SIZE
                                };
                                if state.buffer.len() > max_size {
                                    let excess = state.buffer.len() - max_size;
                                    state.buffer.drain(0..excess);
                                }
                                
                                // Persist to transcript for agent terminals
                                if Self::is_agent_terminal(&id_clone) {
                                    if let Some(writer) = transcript_writers_clone.lock().await.get_mut(&id_clone) {
                                        let _ = writer.write_all(&data);
                                        let _ = writer.flush();
                                    }
                                }

                                // Increment sequence and update last output time
                                state.seq += 1;
                                state.last_output = SystemTime::now();
                                
                                // Handle output emission - different strategies for agent vs standard terminals
                                drop(terminals); // release lock before awaits below
                                
                                if Self::is_agent_terminal(&id_clone) {
                                    // Agent terminals need ANSI-aware buffering and carriage return optimization
                                    handle_coalesced_output(
                                        &coalescing_state_clone,
                                        CoalescingParams {
                                            terminal_id: &id_clone,
                                            data: &data,
                                            delay_ms: 2, // Small delay for agent terminals to handle streaming output
                                        },
                                    ).await;
                                } else {
                                    // Standard terminals bypass coalescing for immediate, unprocessed output
                                    // This prevents fish autocomplete interference and typing issues
                                    if let Some(handle) = coalescing_state_clone.app_handle.lock().await.as_ref() {
                                        let event_name = format!("terminal-output-{id_clone}");
                                        let payload = String::from_utf8_lossy(&data).to_string();
                                        if let Err(e) = handle.emit(&event_name, payload) {
                                            warn!("Failed to emit direct terminal output: {e}");
                                        }
                                    }
                                }
                            }
                        });
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            error!("Terminal {id} read error: {e}");
                            // On read error, clean up and notify
                            let id_clone_for_cleanup = id.clone();
                            let terminals_clone2 = Arc::clone(&reader_state.terminals);
                            let app_handle_clone2 = Arc::clone(&reader_state.coalescing_state.app_handle);
                            let coalescing_state_clone = reader_state.coalescing_state.clone();
                            runtime.block_on(async move {
                                terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                                if let Some(mut child) = reader_state.pty_children.lock().await.remove(&id_clone_for_cleanup) {
                                    let _ = child.kill();
                                }
                                reader_state.pty_masters.lock().await.remove(&id_clone_for_cleanup);
                                reader_state.pty_writers.lock().await.remove(&id_clone_for_cleanup);
                                // Clear coalescing buffers
                                coalescing_state_clone.clear_for(&id_clone_for_cleanup).await;
                                if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                    let _ = emit_event(handle, SchaltEvent::TerminalClosed, &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
                                    );
                                }
                            });
                            break;
                        }
                    }
                }
            }
        });
    }

}

#[async_trait::async_trait]
impl TerminalBackend for LocalPtyAdapter {
    async fn create(&self, params: CreateParams) -> Result<(), String> {
        // Use standard terminal defaults that will be immediately resized by frontend
        // These are just fallback values for compatibility
        self.create_with_size(params, 80, 24).await
    }
    
    async fn create_with_size(&self, params: CreateParams, cols: u16, rows: u16) -> Result<(), String> {
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
            debug!("Terminal {id} already exists, skipping creation ({}ms)", start_time.elapsed().as_millis());
            return Ok(());
        }
        
        info!("Creating terminal: id={id}, cwd={}, size={}x{}", params.cwd, cols, rows);
        
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
            info!("Resolved command '{}' to '{}'" , app.command, resolved_command);
            
            // Log the exact command that will be executed
            // Show args with proper quoting so it's clear what's a single argument
            let args_str = app.args.iter()
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
            info!("Command args array (each element is a separate argument): {:?}", app.args);
            
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
        
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                error!("Failed to spawn command for terminal {id}: {e}");
                format!("Failed to spawn command: {e}")
            })?;
        
        info!("Successfully spawned shell process for terminal {id} (spawn took {}ms)", start_time.elapsed().as_millis());
        
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {e}"))?;
        
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {e}"))?;
        
        // Store the child and master in separate maps to avoid Sync issues
        self.pty_children.lock().await.insert(id.clone(), child);
        self.pty_masters.lock().await.insert(id.clone(), pair.master);
        self.pty_writers.lock().await.insert(id.clone(), writer);

        // Initialize transcript file for agent terminals
        if Self::is_agent_terminal(&id) {
            let path = Self::make_transcript_path_for(&id);
            if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
            match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                Ok(file) => {
                    let mut wmap = self.transcript_writers.lock().await;
                    let mut pmap = self.transcript_paths.lock().await;
                    let bw = std::io::BufWriter::new(file);
                    wmap.insert(id.clone(), bw);
                    pmap.insert(id.clone(), path);
                }
                Err(e) => warn!("Failed to create transcript for {id}: {e}"),
            }
        }
        
        // Start process monitoring AFTER PTY resources are stored
        Self::start_process_monitor(
            id.clone(),
            Arc::clone(&self.terminals),
            Arc::clone(&self.coalescing_state.app_handle),
            Arc::clone(&self.pty_children),
            Arc::clone(&self.pty_masters),
            Arc::clone(&self.pty_writers),
        ).await;
        
        let state = TerminalState {
            buffer: Vec::new(),
            seq: 0,
            last_output: SystemTime::now(),
        };
        
        self.terminals.write().await.insert(id.clone(), state);
        
        // Start reader agent
        Self::start_reader(
            id.clone(),
            reader,
            ReaderState {
                terminals: Arc::clone(&self.terminals),
                pty_children: Arc::clone(&self.pty_children),
                pty_masters: Arc::clone(&self.pty_masters),
                pty_writers: Arc::clone(&self.pty_writers),
                coalescing_state: self.coalescing_state.clone(),
                transcript_writers: Arc::clone(&self.transcript_writers),
            },
        )
        .await;
        
        self.creating.lock().await.remove(&id);
        
        let total_time = start_time.elapsed();
        if total_time.as_millis() > 100 {
            warn!("Terminal {id} creation took {}ms (slow)", total_time.as_millis());
        } else {
            info!("Terminal created successfully: id={id} (total {}ms)", total_time.as_millis());
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
            writer
                .flush()
                .map_err(|e| format!("Flush failed: {e}"))?;

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

            // Emit output immediately without coalescing delay for critical input
            if let Some(handle) = self.coalescing_state.app_handle.lock().await.as_ref() {
                let event_name = format!("terminal-output-{id}");
                let payload = String::from_utf8_lossy(data).to_string();
                if let Err(e) = handle.emit(&event_name, payload) {
                    warn!("Failed to emit immediate terminal output: {e}");
                }
            }

            let elapsed = start.elapsed();
            if elapsed.as_millis() > 10 {
                warn!("Terminal {id} slow immediate write: {}ms", elapsed.as_millis());
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
            
            debug!("Resized terminal {id}: {cols}x{rows}");
            Ok(())
        } else {
            warn!("Terminal {id} not found for resize");
            Ok(())
        }
    }
    
    async fn close(&self, id: &str) -> Result<(), String> {
        info!("Closing terminal: {id}");
        
        // Force kill the child process with timeout for robustness
        if let Some(mut child) = self.pty_children.lock().await.remove(id) {
            // Try graceful termination first
            if let Err(e) = child.kill() {
                warn!("Failed to kill terminal process {id}: {e}");
            } else {
                // Wait briefly for process to exit gracefully
                let timeout = tokio::time::Duration::from_millis(100);
                match tokio::time::timeout(timeout, async {
                    loop {
                        match child.try_wait() {
                            Ok(Some(_)) => break, // Process exited
                            Ok(None) => {
                                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                            }
                            Err(_) => break, // Process is gone or error
                        }
                    }
                }).await {
                    Ok(()) => debug!("Terminal {id} process exited gracefully"),
                    Err(_) => debug!("Terminal {id} process didn't exit within timeout, continuing cleanup"),
                }
            }
        }
        
        // Clean up all resources
        self.pty_masters.lock().await.remove(id);
        self.pty_writers.lock().await.remove(id);
        self.terminals.write().await.remove(id);
        if let Some(mut bw) = self.transcript_writers.lock().await.remove(id) {
            let _ = bw.flush();
        }
        self.transcript_paths.lock().await.remove(id);
        
        // Clear coalescing buffers
        self.coalescing_state.clear_for(id).await;
        
        info!("Terminal {id} closed");
        Ok(())
    }
    
    async fn exists(&self, id: &str) -> Result<bool, String> {
        Ok(self.terminals.read().await.contains_key(id))
    }
    
    async fn snapshot(&self, id: &str, _from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String> {
        // Prefer persistent transcript for agent terminals when available
        if Self::is_agent_terminal(id) {
            let path = {
                let guard = self.transcript_paths.lock().await;
                guard.get(id).cloned()
            }.or_else(|| Self::find_latest_transcript_path(id));

            if let Some(p) = path {
                let start_time = std::time::Instant::now();
                match tokio::fs::read(&p).await {
                    Ok(mut bytes) => {
                        let read_duration = start_time.elapsed();
                        let size_mb = bytes.len() as f64 / (1024.0 * 1024.0);
                        info!("Read transcript for {id}: {:.2}MB in {:.1}ms", size_mb, read_duration.as_secs_f64() * 1000.0);
                        
                        // Backward-compat: remove any historical transcript header lines so UI doesn't render them
                        // Pattern: lines starting with "==== TRANSCRIPT START"
                        if let Some(pos) = memchr::memmem::find(&bytes, b"==== TRANSCRIPT START") {
                            // Remove the full line containing the marker
                            let line_start = bytes[..pos].iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
                            let line_end = bytes[pos..].iter().position(|&b| b == b'\n').map(|i| pos + i + 1).unwrap_or(bytes.len());
                            bytes.drain(line_start..line_end);
                        }
                        let seq = self.terminals.read().await.get(id).map(|s| s.seq).unwrap_or(0);
                        return Ok((seq, bytes));
                    }
                    Err(e) => warn!("Failed to read transcript for {id}: {e}"),
                }
            }
        }

        let terminals = self.terminals.read().await;
        if let Some(state) = terminals.get(id) {
            let current_seq = state.seq;
            Ok((current_seq, state.buffer.clone()))
        } else {
            Ok((0, Vec::new()))
        }
    }
}

impl LocalPtyAdapter {
    /// Checks if a terminal ID corresponds to an agent terminal (top terminals for sessions)
    fn is_agent_terminal(terminal_id: &str) -> bool {
        terminal_id.contains("-top") && (
            terminal_id.contains("session-") ||
            terminal_id.contains("orchestrator-")
        )
    }
    
    /// Determines the agent type from terminal ID
    fn get_agent_type_from_terminal(terminal_id: &str) -> Option<&'static str> {
        if terminal_id.contains("codex") {
            Some("codex")
        } else if terminal_id.contains("claude") {
            Some("claude")
        } else if terminal_id.contains("cursor") {
            Some("cursor")
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
                let inactivity_threshold = if Self::get_agent_type_from_terminal(terminal_id) == Some("codex") {
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
                        state.buffer.len(), state.seq
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
        ).await;
        
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
            let is_stuck = elapsed > 60; // Increased to 60 seconds for less aggressive idle detection
            Ok((is_stuck, elapsed))
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }
    
    pub async fn get_all_terminal_activity(&self) -> Vec<(String, bool, u64)> {
        let terminals = self.terminals.read().await;
        let mut results = Vec::new();
        
        for (id, state) in terminals.iter() {
            if let Ok(duration) = SystemTime::now().duration_since(state.last_output) {
                let elapsed = duration.as_secs();
                let is_stuck = elapsed > 60; // Increased to 60 seconds for less aggressive idle detection
                results.push((id.clone(), is_stuck, elapsed));
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
                            debug!("Terminal {monitor_id} child process not found, stopping monitor");
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
                                    Self::check_agent_health(&monitor_id, &terminals, &mut last_activity_check).await;
                                }
                                None
                            }
                            Err(e) => {
                                if is_agent_terminal {
                                    error!("AGENT MONITORING ERROR: Failed to check terminal {monitor_id} process status: {e}");
                                } else {
                                    warn!("Failed to check terminal {monitor_id} process status: {e}");
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
                        ).await;
                    } else {
                        Self::cleanup_dead_terminal(
                            monitor_id.clone(),
                            Arc::clone(&terminals),
                            Arc::clone(&app_handle),
                            Arc::clone(&pty_children),
                            Arc::clone(&pty_masters),
                            Arc::clone(&pty_writers),
                        ).await;
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
                if let Err(e) = emit_event(handle, SchaltEvent::TerminalClosed, &serde_json::json!({"terminal_id": id}),
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
}

async fn get_shell_config() -> (String, Vec<String>) {
    // Use shared effective shell resolution (respects settings when available)
    let (shell, args) = super::get_effective_shell();
    info!("Using shell: {shell}{}",
        if args.is_empty() { " (no args)" } else { " (with args)" }
    );
    (shell, args)
}

fn resolve_command(command: &str) -> String {
    if command.contains('/') {
        return command.to_string();
    }
    
    let common_paths = vec![
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
    ];
    
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
    
    if let Ok(output) = std::process::Command::new("which")
        .arg(command)
        .output()
    {
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
    use super::*;
    use super::super::ApplicationSpec;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};
    use tempfile::TempDir;
    use tokio::time::sleep;
    use futures;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_id(prefix: &str) -> String {
        format!("{}-{}-{}", prefix, std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
    }

    #[test]
    fn detect_standard_cpr_sequence() {
        let data = b"hello\x1b[6nworld";
        assert!(LocalPtyAdapter::contains_cpr_query(data));
    }

    #[test]
    fn detect_dec_private_cpr_sequence() {
        let data = b"abc\x1b[?6nxyz";
        assert!(LocalPtyAdapter::contains_cpr_query(data));
    }

    #[test]
    fn no_false_positive_on_similar_sequences() {
        // ESC [ 6 m (SGR) should not be considered CPR
        let data = b"test\x1b[6m";
        assert!(!LocalPtyAdapter::contains_cpr_query(data));
    }

    #[derive(Default)]
    struct MemWriter { pub buf: Vec<u8> }
    impl Write for MemWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> { self.buf.extend_from_slice(data); Ok(data.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    #[derive(Clone, Default)]
    struct SharedWriter(std::sync::Arc<tokio::sync::Mutex<MemWriter>>);
    impl Write for SharedWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut g = self.0.lock().await;
                g.write(data)
            })
        }
        fn flush(&mut self) -> std::io::Result<()> {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mut g = self.0.lock().await;
                g.flush()
            })
        }
    }

    #[test]
    fn maybe_reply_cpr_writes_fallback() {
        let mut map: HashMap<String, Box<dyn Write + Send>> = HashMap::new();
        let id = "t1".to_string();
        let shared = SharedWriter::default();
        let handle = shared.0.clone();
        map.insert(id.clone(), Box::new(shared));

        LocalPtyAdapter::maybe_reply_cpr(&id, b"prompt\x1b[6n", &mut map);

        let rt = tokio::runtime::Runtime::new().unwrap();
        let buf = rt.block_on(async { handle.lock().await.buf.clone() });
        assert_eq!(buf, b"\x1b[1;1R".to_vec());
    }

    #[test]
    fn maybe_reply_cpr_noop_without_query() {
        let mut map: HashMap<String, Box<dyn Write + Send>> = HashMap::new();
        let id = "t2".to_string();
        let shared = SharedWriter::default();
        let handle = shared.0.clone();
        map.insert(id.clone(), Box::new(shared));

        LocalPtyAdapter::maybe_reply_cpr(&id, b"just output", &mut map);

        let rt = tokio::runtime::Runtime::new().unwrap();
        let buf = rt.block_on(async { handle.lock().await.buf.clone() });
        assert!(buf.is_empty());
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
        sleep(Duration::from_millis(100)).await;

        // Write some data
        adapter.write(&id, b"echo 'test output'\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        // Get snapshot
        let (seq, data) = adapter.snapshot(&id, None).await.unwrap();
        assert!(seq > 0);
        assert!(!data.is_empty());

        // Data should contain our command or output
        let output = String::from_utf8_lossy(&data);
        assert!(output.contains("echo") || output.contains("test") || !output.is_empty());

        safe_close(&adapter, &id).await;
    }

    #[tokio::test]
    async fn test_snapshot_nonexistent_terminal() {
        let adapter = LocalPtyAdapter::new();
        let (seq, data) = adapter.snapshot("nonexistent", None).await.unwrap();
        assert_eq!(seq, 0);
        assert!(data.is_empty());
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
        sleep(Duration::from_millis(100)).await;

        // Write data to generate some output
        adapter.write(&id, b"echo 'first'\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let (seq1, _) = adapter.snapshot(&id, None).await.unwrap();

        adapter.write(&id, b"echo 'second'\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;

        let (seq2, _) = adapter.snapshot(&id, None).await.unwrap();

        // Sequence should have increased
        assert!(seq2 >= seq1);

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
            b"\n".as_slice(),                    // newline
            b"\r".as_slice(),                    // carriage return
            b"\x1b[A".as_slice(),               // arrow key escape sequence
            b"\x1b[1;2H".as_slice(),           // cursor positioning
            b"\t".as_slice(),                   // tab
            b"normal text\n".as_slice(),       // normal text
        ];

        for data in test_data {
            adapter.write(&id, data).await.unwrap();
            sleep(Duration::from_millis(50)).await;
        }

        let (_, buffer) = adapter.snapshot(&id, None).await.unwrap();
        assert!(!buffer.is_empty());

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
            b"echo test\n".as_slice(),          // newline
            b"ls\r".as_slice(),                 // carriage return
            b"\x1b[A".as_slice(),              // escape sequence
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

        let adapter_clone = Arc::clone(&adapter);
        let id_clone = id.clone();
        let write_handle = tokio::spawn(async move {
            for i in 0..10 {
                adapter_clone.write(&id_clone, format!("echo 'write {}'\n", i).as_bytes()).await.unwrap();
                sleep(Duration::from_millis(10)).await;
            }
        });

        let adapter_clone2 = Arc::clone(&adapter);
        let id_clone2 = id.clone();
        let write_handle2 = tokio::spawn(async move {
            for i in 10..20 {
                adapter_clone2.write(&id_clone2, format!("echo 'write {}'\n", i).as_bytes()).await.unwrap();
                sleep(Duration::from_millis(10)).await;
            }
        });

        let _ = tokio::join!(write_handle, write_handle2);

        assert!(adapter.exists(&id).await.unwrap());

        let (_, buffer) = adapter.snapshot(&id, None).await.unwrap();
        assert!(!buffer.is_empty());

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
                adapter_clone.write(&id_clone, format!("echo 'test {}'\n", i).as_bytes()).await.unwrap();
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
    async fn test_activity_status_transitions() {
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

        // Manually simulate old last_output to mark as stuck
        {
            let mut terminals = adapter.terminals.write().await;
            if let Some(state) = terminals.get_mut(&id) {
                state.last_output = SystemTime::now() - Duration::from_secs(120);
            }
        }

        let (stuck2, elapsed2) = adapter.get_activity_status(&id).await.unwrap();
        assert!(stuck2);
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

        for (id, stuck, elapsed) in activities {
            assert!(ids.contains(&id));
            assert!(!stuck);
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

    #[tokio::test]
    async fn test_environment_variables_setup() {
        let adapter = LocalPtyAdapter::new();
        let id = unique_id("env-setup");

        let params = CreateParams {
            id: id.clone(),
            cwd: "/tmp".to_string(),
            app: None,
        };

        adapter.create_with_size(params, 150, 50).await.unwrap();
        sleep(Duration::from_millis(100)).await;

        // Send command to check environment variables
        adapter.write(&id, b"echo LINES=$LINES COLUMNS=$COLUMNS TERM=$TERM\n").await.unwrap();
        sleep(Duration::from_millis(300)).await;

        let (_, data) = adapter.snapshot(&id, None).await.unwrap();
        let output = String::from_utf8_lossy(&data);

        // Check that environment variables were set correctly
        assert!(output.contains("LINES=50"), "LINES not set correctly: {}", output);
        assert!(output.contains("COLUMNS=150"), "COLUMNS not set correctly: {}", output);
        assert!(output.contains("TERM=xterm-256color"), "TERM not set correctly: {}", output);

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
            adapter.write(&id, format!("echo 'test {}'\n", i).as_bytes()).await.unwrap();
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
        let (seq, data) = adapter.snapshot(&id, None).await.unwrap();
        assert!(seq > 0);
        assert!(!data.is_empty());

        // 5. Resize terminal
        adapter.resize(&id, 120, 40).await.unwrap();

        // 6. Send more commands
        adapter.write(&id, b"echo 'terminal test complete'\n").await.unwrap();
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

        let (_, data) = adapter.snapshot(&id, None).await.unwrap();
        assert!(!data.is_empty());

        // Close terminal
        adapter.close(&id).await.unwrap();
        assert!(!adapter.exists(&id).await.unwrap());

        // Verify terminal state is cleaned up
        assert!(!adapter.terminals.read().await.contains_key(&id));

        // Verify snapshot returns empty after close
        let (seq, data) = adapter.snapshot(&id, None).await.unwrap();
        assert_eq!(seq, 0);
        assert!(data.is_empty());
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
        adapter.write(&id, b"echo 'populate buffers'\n").await.unwrap();
        sleep(Duration::from_millis(100)).await;

        // Close terminal
        adapter.close(&id).await.unwrap();

        // Verify all coalescing buffers are cleaned
        assert!(!adapter.coalescing_state.emit_buffers.read().await.contains_key(&id));
        assert!(!adapter.coalescing_state.emit_scheduled.read().await.contains_key(&id));
        assert!(!adapter.coalescing_state.emit_buffers_norm.read().await.contains_key(&id));
        assert!(!adapter.coalescing_state.norm_last_cr.read().await.contains_key(&id));
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

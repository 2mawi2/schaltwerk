use super::{CreateParams, TerminalBackend};
use crate::SETTINGS_MANAGER;
use log::{debug, error, info, warn};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

const MAX_BUFFER_SIZE: usize = 2 * 1024 * 1024;

// Global state maps to avoid Sync issues with trait objects
lazy_static::lazy_static! {
    static ref PTY_CHILDREN: Mutex<HashMap<String, Box<dyn Child + Send>>> = Mutex::new(HashMap::new());
    static ref PTY_MASTERS: Mutex<HashMap<String, Box<dyn MasterPty + Send>>> = Mutex::new(HashMap::new());
    static ref PTY_WRITERS: Mutex<HashMap<String, Box<dyn Write + Send>>> = Mutex::new(HashMap::new());
}

struct TerminalState {
    buffer: Vec<u8>,
    seq: u64,
    last_output: SystemTime,
}

pub struct LocalPtyAdapter {
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    creating: Arc<Mutex<HashSet<String>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    // Coalesced emitter buffers per terminal id
    emit_buffers: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    // Tracks whether a flush agent is scheduled per terminal id
    emit_scheduled: Arc<RwLock<HashMap<String, bool>>>,
}

impl LocalPtyAdapter {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            creating: Arc::new(Mutex::new(HashSet::new())),
            app_handle: Arc::new(Mutex::new(None)),
            emit_buffers: Arc::new(RwLock::new(HashMap::new())),
            emit_scheduled: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.lock().await = Some(handle);
    }

    fn resolve_command(command: &str) -> String {
        resolve_command(command)
    }
    
    async fn get_shell_command() -> CommandBuilder {
        let (shell, args) = get_shell_config().await;
        let mut cmd = CommandBuilder::new(shell);
        for arg in args {
            cmd.arg(arg);
        }
        cmd
    }

    fn setup_environment(cmd: &mut CommandBuilder, cols: u16, rows: u16) {
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        
        // Set initial terminal size for TUI applications
        // These will be updated by resize commands but help with initial rendering
        cmd.env("LINES", rows.to_string());
        cmd.env("COLUMNS", cols.to_string());
        
        // Ensure proper terminal behavior for TUI applications
        cmd.env("FORCE_COLOR", "1");
        cmd.env("TERM_PROGRAM", "schaltwerk");
        
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home.clone());
            
            let mut path_components = vec![];
            
            path_components.push(format!("{home}/.local/bin"));
            path_components.push(format!("{home}/.cargo/bin"));
            path_components.push(format!("{home}/bin"));
            
            path_components.push("/opt/homebrew/bin".to_string());
            path_components.push("/usr/local/bin".to_string());
            path_components.push("/usr/bin".to_string());
            path_components.push("/bin".to_string());
            path_components.push("/usr/sbin".to_string());
            path_components.push("/sbin".to_string());
            
            if let Ok(existing_path) = std::env::var("PATH") {
                path_components.push(existing_path);
            }
            
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
        terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
        app_handle: Arc<Mutex<Option<AppHandle>>>,
        emit_buffers: Arc<RwLock<HashMap<String, Vec<u8>>>>,
        emit_scheduled: Arc<RwLock<HashMap<String, bool>>>,
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
                        let terminals_clone2 = Arc::clone(&terminals);
                        let app_handle_clone2 = Arc::clone(&app_handle);
                        runtime.block_on(async move {
                            // Remove terminal state
                            terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                            // Remove PTY resources
                            if let Some(mut child) = PTY_CHILDREN.lock().await.remove(&id_clone_for_cleanup) {
                                let _ = child.kill();
                            }
                            PTY_MASTERS.lock().await.remove(&id_clone_for_cleanup);
                            PTY_WRITERS.lock().await.remove(&id_clone_for_cleanup);
                            // Emit terminal closed event
                            if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                let _ = handle.emit(
                                    "schaltwerk:terminal-closed",
                                    &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
                                );
                            }
                        });
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let id_clone = id.clone();
                        let terminals_clone = Arc::clone(&terminals);
                        let app_handle_clone = Arc::clone(&app_handle);
                        let emit_buffers_clone = Arc::clone(&emit_buffers);
                        let emit_scheduled_clone = Arc::clone(&emit_scheduled);
                        
                        runtime.block_on(async move {
                            let mut terminals = terminals_clone.write().await;
                            if let Some(state) = terminals.get_mut(&id_clone) {
                                // Append to ring buffer
                                state.buffer.extend_from_slice(&data);
                                if state.buffer.len() > MAX_BUFFER_SIZE {
                                    let excess = state.buffer.len() - MAX_BUFFER_SIZE;
                                    state.buffer.drain(0..excess);
                                }
                                
                                // Increment sequence and update last output time
                                state.seq += 1;
                                state.last_output = SystemTime::now();
                                
                                // Coalesce and schedule emit
                                drop(terminals); // release lock before awaits below
                                {
                                    let mut buffers = emit_buffers_clone.write().await;
                                    let buf_ref = buffers.entry(id_clone.clone()).or_insert_with(Vec::new);
                                    buf_ref.extend_from_slice(&data);
                                }
                                let mut should_schedule = false;
                                {
                                    let mut scheduled = emit_scheduled_clone.write().await;
                                    let entry = scheduled.entry(id_clone.clone()).or_insert(false);
                                    if !*entry {
                                        *entry = true;
                                        should_schedule = true;
                                    }
                                }
                                if should_schedule {
                                    let app_for_emit = Arc::clone(&app_handle_clone);
                                    let emit_buffers_for_task = Arc::clone(&emit_buffers_clone);
                                    let emit_scheduled_for_task = Arc::clone(&emit_scheduled_clone);
                                    let id_for_task = id_clone.clone();
                                    // Flush after ~16ms (one frame)
                                    tokio::spawn(async move {
                                        use tokio::time::{sleep, Duration};
                                        sleep(Duration::from_millis(16)).await;
                                        // Take buffer
                                        let data_to_emit: Option<Vec<u8>> = {
                                            let mut buffers = emit_buffers_for_task.write().await;
                                            buffers.remove(&id_for_task)
                                        };
                                        // Mark unscheduled
                                        {
                                            let mut scheduled = emit_scheduled_for_task.write().await;
                                            if let Some(flag) = scheduled.get_mut(&id_for_task) {
                                                *flag = false;
                                            }
                                        }
                                        if let Some(bytes) = data_to_emit {
                                            if let Some(handle) = app_for_emit.lock().await.as_ref() {
                                                let event_name = format!("terminal-output-{id_for_task}");
                                                let payload = String::from_utf8_lossy(&bytes).to_string();
                                                if let Err(e) = handle.emit(&event_name, payload) {
                                                    warn!("Failed to emit terminal output: {e}");
                                                }
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            error!("Terminal {id} read error: {e}");
                            // On read error, clean up and notify
                            let id_clone_for_cleanup = id.clone();
                            let terminals_clone2 = Arc::clone(&terminals);
                            let app_handle_clone2 = Arc::clone(&app_handle);
                            runtime.block_on(async move {
                                terminals_clone2.write().await.remove(&id_clone_for_cleanup);
                                if let Some(mut child) = PTY_CHILDREN.lock().await.remove(&id_clone_for_cleanup) {
                                    let _ = child.kill();
                                }
                                PTY_MASTERS.lock().await.remove(&id_clone_for_cleanup);
                                PTY_WRITERS.lock().await.remove(&id_clone_for_cleanup);
                                if let Some(handle) = app_handle_clone2.lock().await.as_ref() {
                                    let _ = handle.emit(
                                        "schaltwerk:terminal-closed",
                                        &serde_json::json!({"terminal_id": id_clone_for_cleanup}),
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
            for arg in app.args {
                cmd.arg(arg);
            }
            for (key, value) in app.env {
                cmd.env(key, value);
            }
            cmd
        } else {
            Self::get_shell_command().await
        };
        
        Self::setup_environment(&mut cmd, cols, rows);
        
        // Validate working directory exists before setting it
        if !std::path::Path::new(&params.cwd).exists() {
            error!("Working directory does not exist: {}", params.cwd);
            return Err(format!("Working directory does not exist: {}", params.cwd));
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
        PTY_CHILDREN.lock().await.insert(id.clone(), child);
        PTY_MASTERS.lock().await.insert(id.clone(), pair.master);
        PTY_WRITERS.lock().await.insert(id.clone(), writer);
        
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
            Arc::clone(&self.terminals),
            Arc::clone(&self.app_handle),
            Arc::clone(&self.emit_buffers),
            Arc::clone(&self.emit_scheduled),
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
        
        if let Some(writer) = PTY_WRITERS.lock().await.get_mut(id) {
            writer
                .write_all(data)
                .map_err(|e| format!("Write failed: {e}"))?;
            
            // Smart flushing: only flush on important characters that need immediate response
            // This reduces flush overhead for regular typing while maintaining responsiveness
            let needs_immediate_flush = data.contains(&b'\n') || // newline/enter
                                      data.contains(&b'\r') || // carriage return
                                      data.starts_with(b"\x1b"); // escape sequences (arrows, etc)
            
            if needs_immediate_flush {
                writer
                    .flush()
                    .map_err(|e| format!("Flush failed: {e}"))?;
            }
            
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
    
    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if let Some(master) = PTY_MASTERS.lock().await.get(id) {
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
        
        // Remove from all maps
        if let Some(mut child) = PTY_CHILDREN.lock().await.remove(id) {
            if let Err(e) = child.kill() {
                warn!("Failed to kill terminal process {id}: {e}");
            }
        }
        
        PTY_MASTERS.lock().await.remove(id);
        PTY_WRITERS.lock().await.remove(id);
        self.terminals.write().await.remove(id);
        
        info!("Terminal {id} closed");
        Ok(())
    }
    
    async fn exists(&self, id: &str) -> Result<bool, String> {
        Ok(self.terminals.read().await.contains_key(id))
    }
    
    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<(u64, Vec<u8>), String> {
        let terminals = self.terminals.read().await;
        
        if let Some(state) = terminals.get(id) {
            let current_seq = state.seq;
            
            if let Some(from) = from_seq {
                if from < current_seq {
                    // For simplicity, just return full buffer if seq is within range
                    // In a real implementation, you'd track byte positions per seq
                    Ok((current_seq, state.buffer.clone()))
                } else {
                    Ok((current_seq, state.buffer.clone()))
                }
            } else {
                Ok((current_seq, state.buffer.clone()))
            }
        } else {
            Ok((0, Vec::new()))
        }
    }
}

impl LocalPtyAdapter {
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
}

async fn get_shell_config() -> (String, Vec<String>) {
    // Try to get configured shell from settings
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let terminal_settings = manager.get_terminal_settings();
        
        if let Some(shell) = terminal_settings.shell {
            if !shell.is_empty() {
                let args = &terminal_settings.shell_args;
                info!("Using configured shell: {shell} with args: {args:?}");
                return (shell, terminal_settings.shell_args);
            }
        }
    }
    
    // Fall back to default shell detection
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });
    
    // Default args for interactive shell
    let args = vec!["-i".to_string()];
    
    info!("Using default shell: {shell} with args: {args:?}");
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
    use tokio::time::{sleep, Duration};
    use std::time::SystemTime;
    
    #[tokio::test]
    async fn test_create_exists() {
        let adapter = LocalPtyAdapter::new();
        let params = CreateParams {
            id: "test-terminal".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        
        assert!(!adapter.exists("test-terminal").await.unwrap());
        adapter.create(params).await.unwrap();
        assert!(adapter.exists("test-terminal").await.unwrap());
        adapter.close("test-terminal").await.unwrap();
        assert!(!adapter.exists("test-terminal").await.unwrap());
    }
    
    #[tokio::test]
    async fn test_snapshot_empty() {
        let adapter = LocalPtyAdapter::new();
        let (seq, data) = adapter.snapshot("nonexistent", None).await.unwrap();
        assert_eq!(seq, 0);
        assert!(data.is_empty());
    }
    
    #[tokio::test]
    async fn test_write_and_snapshot() {
        let adapter = LocalPtyAdapter::new();
        let params = CreateParams {
            id: "test-write".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        
        adapter.create(params).await.unwrap();
        sleep(Duration::from_millis(100)).await;
        
        adapter.write("test-write", b"echo test\n").await.unwrap();
        sleep(Duration::from_millis(200)).await;
        
        let (seq, data) = adapter.snapshot("test-write", None).await.unwrap();
        assert!(seq > 0);
        assert!(!data.is_empty());
        
        adapter.close("test-write").await.unwrap();
    }
    
    #[tokio::test]
    async fn test_resize() {
        let adapter = LocalPtyAdapter::new();
        let params = CreateParams {
            id: "test-resize".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        
        adapter.create(params).await.unwrap();
        adapter.resize("test-resize", 120, 40).await.unwrap();
        adapter.close("test-resize").await.unwrap();
    }
    
    #[tokio::test]
    async fn test_concurrent_create() {
        let adapter = Arc::new(LocalPtyAdapter::new());
        let mut handles = vec![];
        
        for _ in 0..3 {
            let adapter_clone = Arc::clone(&adapter);
            let handle = tokio::spawn(async move {
                let params = CreateParams {
                    id: "concurrent-test".to_string(),
                    cwd: "/tmp".to_string(),
                    app: None,
                };
                adapter_clone.create(params).await.unwrap();
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.await.unwrap();
        }
        
        assert!(adapter.exists("concurrent-test").await.unwrap());
        adapter.close("concurrent-test").await.unwrap();
    }

    #[tokio::test]
    async fn test_activity_status_transitions_and_get_all() {
        let adapter = LocalPtyAdapter::new();
        let id = "activity-test".to_string();
        let params = CreateParams { id: id.clone(), cwd: "/tmp".into(), app: None };
        adapter.create(params).await.unwrap();

        // Immediately after create, should not be stuck
        let (stuck, _elapsed) = adapter.get_activity_status(&id).await.unwrap();
        assert!(!stuck);

        // Manually simulate old last_output to mark as stuck
        {
            let mut terms = adapter.terminals.write().await;
            if let Some(state) = terms.get_mut(&id) {
                // Set last_output to 2 minutes in the past
                state.last_output = SystemTime::now() - std::time::Duration::from_secs(120);
            }
        }

        let (stuck2, elapsed2) = adapter.get_activity_status(&id).await.unwrap();
        assert!(stuck2);
        assert!(elapsed2 >= 60);

        // get_all_terminal_activity reflects the same
        let all = adapter.get_all_terminal_activity().await;
        let found = all.iter().find(|(tid, _, _)| tid == &id).cloned().unwrap();
        assert_eq!(found.0, id);
        assert!(found.1);

        adapter.close(&id).await.unwrap();
    }

    #[tokio::test]
    async fn test_resize_nonexistent_and_write_nonexistent_are_noop() {
        let adapter = LocalPtyAdapter::new();
        // Should not error when resizing non-existing
        adapter.resize("no-such", 80, 24).await.unwrap();
        // Should not error when writing non-existing
        adapter.write("no-such", b"data").await.unwrap();
    }

    #[tokio::test]
    async fn test_create_with_custom_size() {
        let adapter = LocalPtyAdapter::new();
        let params = CreateParams {
            id: "test-custom-size".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        
        // Create terminal with custom size
        adapter.create_with_size(params, 120, 40).await.unwrap();
        assert!(adapter.exists("test-custom-size").await.unwrap());
        
        // Verify we can resize it
        adapter.resize("test-custom-size", 100, 30).await.unwrap();
        
        // Clean up
        adapter.close("test-custom-size").await.unwrap();
        assert!(!adapter.exists("test-custom-size").await.unwrap());
    }

    #[tokio::test]
    async fn test_environment_variables_set_correctly() {
        let adapter = LocalPtyAdapter::new();
        
        let params = CreateParams {
            id: "test-env-vars".to_string(),
            cwd: "/tmp".to_string(),
            app: None,
        };
        
        // Create with specific size
        adapter.create_with_size(params, 150, 50).await.unwrap();
        sleep(Duration::from_millis(100)).await;
        
        // Send command to check environment variables
        adapter.write("test-env-vars", b"echo LINES=$LINES COLUMNS=$COLUMNS\n").await.unwrap();
        sleep(Duration::from_millis(500)).await;
        
        // Get the output
        let (_, data) = adapter.snapshot("test-env-vars", None).await.unwrap();
        let output = String::from_utf8_lossy(&data);
        
        // Check that environment variables were set
        // The output should contain the echoed values
        assert!(output.contains("LINES=50"), "LINES not set correctly: {}", output);
        assert!(output.contains("COLUMNS=150"), "COLUMNS not set correctly: {}", output);
        
        adapter.close("test-env-vars").await.unwrap();
    }
}
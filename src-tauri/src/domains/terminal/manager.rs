use super::{
    get_effective_shell, ApplicationSpec, CreateParams, LocalPtyAdapter, TerminalBackend,
    TerminalSnapshot,
};
use crate::infrastructure::events::{emit_event, SchaltEvent};
use log::{debug, error, info, warn};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

/// Parameters for creating a terminal with an application and specific size
pub struct CreateTerminalWithAppAndSizeParams {
    pub id: String,
    pub cwd: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SessionKey {
    project_id: String,
    session_id: Option<String>,
}

impl SessionKey {
    fn new(project_id: String, session_id: Option<String>) -> Self {
        Self {
            project_id,
            session_id,
        }
    }
}

#[derive(Clone, Debug)]
struct TerminalMetadata {
    session: SessionKey,
}

pub struct TerminalManager {
    backend: Arc<LocalPtyAdapter>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    metadata: Arc<RwLock<HashMap<String, TerminalMetadata>>>,
    session_index: Arc<RwLock<HashMap<SessionKey, HashSet<String>>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    fn build_session_key(project_id: &str, session_id: Option<&str>) -> SessionKey {
        SessionKey::new(project_id.to_string(), session_id.map(|s| s.to_string()))
    }

    pub fn new() -> Self {
        let backend = Arc::new(LocalPtyAdapter::new());
        Self {
            backend,
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            metadata: Arc::new(RwLock::new(HashMap::new())),
            session_index: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    async fn register_terminal_session(&self, id: &str, session: SessionKey) {
        let mut metadata = self.metadata.write().await;
        metadata.insert(
            id.to_string(),
            TerminalMetadata {
                session: session.clone(),
            },
        );

        let mut index = self.session_index.write().await;
        let entry = index.entry(session).or_insert_with(HashSet::new);
        entry.insert(id.to_string());
    }

    async fn unregister_terminal_session(&self, id: &str) {
        let mut metadata = self.metadata.write().await;
        if let Some(meta) = metadata.remove(id) {
            let mut index = self.session_index.write().await;
            if let Some(ids) = index.get_mut(&meta.session) {
                ids.remove(id);
                if ids.is_empty() {
                    index.remove(&meta.session);
                }
            }
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle.clone());
        self.backend.set_app_handle(handle).await;
    }

    pub async fn attach_terminals_to_session(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        terminal_ids: &[String],
    ) {
        let key = Self::build_session_key(project_id, session_id);
        for id in terminal_ids {
            self.register_terminal_session(id, key.clone()).await;
        }
    }

    pub async fn register_terminal(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        terminal_id: &str,
    ) {
        let key = Self::build_session_key(project_id, session_id);
        self.register_terminal_session(terminal_id, key).await;
    }

    pub async fn create_terminal(&self, id: String, cwd: String) -> Result<(), String> {
        let start = std::time::Instant::now();
        let result = self.create_terminal_with_env(id.clone(), cwd, vec![]).await;
        let elapsed = start.elapsed();

        if elapsed.as_millis() > 500 {
            log::warn!("Terminal {} slow create: {}ms", id, elapsed.as_millis());
        } else {
            log::debug!("Terminal {} created in: {}ms", id, elapsed.as_millis());
        }

        result
    }

    pub async fn create_terminal_with_env(
        &self,
        id: String,
        cwd: String,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        info!(
            "Creating terminal through manager: id={id}, cwd={cwd}, env_count={}",
            env.len()
        );

        let cwd_for_event = cwd.clone();
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd,
                app: None,
            }
        } else {
            // Create a shell with environment variables set (respect user-configured shell)
            let (shell, args) = get_effective_shell();
            // Ensure `$SHELL` inside spawned process matches the configured shell
            let mut env = env;
            env.push(("SHELL".to_string(), shell.clone()));
            CreateParams {
                id: id.clone(),
                cwd,
                app: Some(ApplicationSpec {
                    command: shell,
                    args,
                    env,
                    ready_timeout_ms: 5000,
                }),
            }
        };

        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_size(
        &self,
        id: String,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let start = std::time::Instant::now();
        let result = self
            .create_terminal_with_size_and_env(id.clone(), cwd, cols, rows, vec![])
            .await;
        let elapsed = start.elapsed();

        if elapsed.as_millis() > 500 {
            log::warn!(
                "Terminal {} slow create with size {}x{}: {}ms",
                id,
                cols,
                rows,
                elapsed.as_millis()
            );
        } else {
            log::debug!(
                "Terminal {} created with size {}x{} in: {}ms",
                id,
                cols,
                rows,
                elapsed.as_millis()
            );
        }

        result
    }

    pub async fn create_terminal_with_size_and_env(
        &self,
        id: String,
        cwd: String,
        cols: u16,
        rows: u16,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        info!("Creating terminal through manager with size: id={id}, cwd={cwd}, size={cols}x{rows}, env_count={}", env.len());

        let cwd_for_event = cwd.clone();
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd,
                app: None,
            }
        } else {
            // Create a shell with environment variables set (respect user-configured shell)
            let (shell, args) = get_effective_shell();
            // Ensure `$SHELL` inside spawned process matches the configured shell
            let mut env = env;
            env.push(("SHELL".to_string(), shell.clone()));
            CreateParams {
                id: id.clone(),
                cwd,
                app: Some(ApplicationSpec {
                    command: shell,
                    args,
                    env,
                    ready_timeout_ms: 5000,
                }),
            }
        };

        self.backend.create_with_size(params, cols, rows).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_app(
        &self,
        id: String,
        cwd: String,
        command: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        info!("Creating terminal with app through manager: id={id}, cwd={cwd}, command={command}");

        let app_spec = ApplicationSpec {
            command,
            args,
            env,
            ready_timeout_ms: 5000,
        };

        let cwd_for_event = cwd.clone();
        let params = CreateParams {
            id: id.clone(),
            cwd,
            app: Some(app_spec),
        };

        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_app_and_size(
        &self,
        params: CreateTerminalWithAppAndSizeParams,
    ) -> Result<(), String> {
        info!("Creating terminal with app and size through manager: id={}, cwd={}, command={}, size={}x{}", 
            params.id, params.cwd, params.command, params.cols, params.rows);

        let app_spec = ApplicationSpec {
            command: params.command,
            args: params.args,
            env: params.env,
            ready_timeout_ms: 30000,
        };

        let cwd_for_event = params.cwd.clone();
        let create_params = CreateParams {
            id: params.id.clone(),
            cwd: params.cwd,
            app: Some(app_spec),
        };

        self.backend
            .create_with_size(create_params, params.cols, params.rows)
            .await?;
        self.active_ids.write().await.insert(params.id.clone());

        // Start event bridge for this terminal
        let id_for_event = params.id.clone();
        self.start_event_bridge(id_for_event.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id_for_event, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write(&id, &data).await
    }

    pub async fn write_terminal_immediate(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write_immediate(&id, &data).await
    }

    pub async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        use_bracketed_paste: bool,
    ) -> Result<(), String> {
        let mut buf = Vec::with_capacity(data.len() + 20);

        if use_bracketed_paste {
            buf.extend_from_slice(b"\x1b[200~");
        }

        buf.extend_from_slice(&data);

        if use_bracketed_paste {
            buf.extend_from_slice(b"\x1b[201~");
        }

        buf.push(b'\r');

        self.backend.write_immediate(&id, &buf).await?;

        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let event_payload = serde_json::json!({ "terminal_id": id });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalForceScroll, &event_payload)
            {
                warn!("Failed to emit terminal force scroll event for {id}: {e}");
            }
        }

        Ok(())
    }

    pub async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        debug!("Resizing terminal {id}: {cols}x{rows}");
        self.backend.resize(&id, cols, rows).await
    }

    pub async fn close_terminal(&self, id: String) -> Result<(), String> {
        info!("Closing terminal through manager: {id}");
        self.active_ids.write().await.remove(&id);
        self.unregister_terminal_session(&id).await;
        self.backend.close(&id).await
    }

    pub async fn terminal_exists(&self, id: &str) -> Result<bool, String> {
        self.backend.exists(id).await
    }

    pub async fn queue_initial_command(
        &self,
        id: String,
        command: String,
        ready_marker: Option<String>,
    ) -> Result<(), String> {
        self.backend
            .queue_initial_command(&id, command, ready_marker)
            .await
    }

    pub async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String> {
        let start_time = std::time::Instant::now();
        let snapshot = self.backend.snapshot(&id, from_seq).await?;
        let snapshot_duration = start_time.elapsed();

        let data_len = snapshot.data.len();
        let size_mb = data_len as f64 / (1024.0 * 1024.0);
        info!(
            "get_terminal_buffer {}: {:.2}MB, snapshot: {:.1}ms, total: {:.1}ms",
            id,
            size_mb,
            snapshot_duration.as_secs_f64() * 1000.0,
            start_time.elapsed().as_secs_f64() * 1000.0
        );

        Ok(snapshot)
    }

    pub async fn close_all(&self) -> Result<(), String> {
        info!("Closing all terminals");
        let ids: Vec<String> = self.active_ids.read().await.iter().cloned().collect();

        for id in ids {
            if let Err(e) = self.close_terminal(id.clone()).await {
                error!("Failed to close terminal {id}: {e}");
            }
        }

        Ok(())
    }

    pub async fn cleanup_all(&self) -> Result<(), String> {
        info!("Starting comprehensive terminal cleanup");

        // First try to close all known terminals
        let close_result = self.close_all().await;

        // Force cleanup any orphaned processes that might have been missed
        self.cleanup_orphaned_processes().await;

        close_result
    }

    pub async fn force_kill_all(&self) -> Result<(), String> {
        info!("Force killing all terminals via manager");

        self.active_ids.write().await.clear();
        self.metadata.write().await.clear();
        self.session_index.write().await.clear();

        self.backend.force_kill_all().await
    }

    async fn cleanup_orphaned_processes(&self) {
        info!("Checking for orphaned terminal processes");

        // Get all terminal IDs that we know about
        let known_ids: std::collections::HashSet<String> = self.active_ids.read().await.clone();

        // Check backend for any additional orphaned terminals
        // Note: accessing concrete method since LocalPtyAdapter is the only implementation
        let backend_terminals = self.backend.get_all_terminal_activity().await;

        for (id, _elapsed) in backend_terminals {
            if !known_ids.contains(&id) {
                warn!("Found orphaned terminal: {id}, cleaning up");
                if let Err(e) = self.backend.close(&id).await {
                    error!("Failed to cleanup orphaned terminal {id}: {e}");
                }
            }
        }

        info!("Orphaned process cleanup completed");
    }

    async fn start_event_bridge(&self, id: String) {
        // Only start if we're using LocalPtyAdapter which already emits events
        // This is a placeholder for future remote adapters that might need explicit bridging
        debug!("Event bridge started for terminal {id}");
    }

    pub async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        self.backend.get_activity_status(&id).await
    }

    pub async fn get_all_terminal_activity(&self) -> Vec<(String, u64)> {
        self.backend.get_all_terminal_activity().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_close_all_kills_all_terminals() {
        let manager = TerminalManager::new();

        manager
            .create_terminal("test-mgr-1".to_string(), "/tmp".to_string())
            .await
            .unwrap();
        manager
            .create_terminal("test-mgr-2".to_string(), "/tmp".to_string())
            .await
            .unwrap();

        assert!(manager.terminal_exists("test-mgr-1").await.unwrap());
        assert!(manager.terminal_exists("test-mgr-2").await.unwrap());

        manager.close_all().await.unwrap();

        assert!(!manager.terminal_exists("test-mgr-1").await.unwrap());
        assert!(!manager.terminal_exists("test-mgr-2").await.unwrap());
    }

    #[tokio::test]
    async fn test_get_terminal_buffer_returns_output() {
        let manager = TerminalManager::new();
        manager
            .create_terminal("buf-term".to_string(), "/tmp".to_string())
            .await
            .unwrap();
        // Nudge some output
        manager
            .write_terminal("buf-term".into(), b"echo hi\n".to_vec())
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let snapshot = manager
            .get_terminal_buffer("buf-term".into(), None)
            .await
            .unwrap();
        assert!(!snapshot.data.is_empty());

        manager.close_terminal("buf-term".into()).await.unwrap();
    }
}

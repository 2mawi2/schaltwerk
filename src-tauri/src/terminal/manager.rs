use super::{ApplicationSpec, CreateParams, LocalPtyAdapter, TerminalBackend, get_shell_binary};
use log::{debug, error, info};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::RwLock;

pub struct TerminalManager {
    backend: Arc<LocalPtyAdapter>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        let backend = Arc::new(LocalPtyAdapter::new());
        Self {
            backend,
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }
    
    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle.clone());
        self.backend.set_app_handle(handle).await;
    }
    
    pub async fn create_terminal(&self, id: String, cwd: String) -> Result<(), String> {
        self.create_terminal_with_env(id, cwd, vec![]).await
    }
    
    pub async fn create_terminal_with_env(&self, id: String, cwd: String, env: Vec<(String, String)>) -> Result<(), String> {
        info!("Creating terminal through manager: id={id}, cwd={cwd}, env_count={}", env.len());
        
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd,
                app: None,
            }
        } else {
            // Create a shell with environment variables set
            let shell = get_shell_binary();
            CreateParams {
                id: id.clone(),
                cwd,
                app: Some(ApplicationSpec {
                    command: shell,
                    args: vec!["-i".to_string()],
                    env,
                    ready_timeout_ms: 5000,
                }),
            }
        };
        
        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());
        
        // Start event bridge for this terminal
        self.start_event_bridge(id).await;
        
        Ok(())
    }
    
    pub async fn create_terminal_with_size(&self, id: String, cwd: String, cols: u16, rows: u16) -> Result<(), String> {
        self.create_terminal_with_size_and_env(id, cwd, cols, rows, vec![]).await
    }
    
    pub async fn create_terminal_with_size_and_env(&self, id: String, cwd: String, cols: u16, rows: u16, env: Vec<(String, String)>) -> Result<(), String> {
        info!("Creating terminal through manager with size: id={id}, cwd={cwd}, size={cols}x{rows}, env_count={}", env.len());
        
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd,
                app: None,
            }
        } else {
            // Create a shell with environment variables set
            let shell = get_shell_binary();
            CreateParams {
                id: id.clone(),
                cwd,
                app: Some(ApplicationSpec {
                    command: shell,
                    args: vec!["-i".to_string()],
                    env,
                    ready_timeout_ms: 5000,
                }),
            }
        };
        
        self.backend.create_with_size(params, cols, rows).await?;
        self.active_ids.write().await.insert(id.clone());
        
        // Start event bridge for this terminal
        self.start_event_bridge(id).await;
        
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
        
        let params = CreateParams {
            id: id.clone(),
            cwd,
            app: Some(app_spec),
        };
        
        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());
        
        // Start event bridge for this terminal
        self.start_event_bridge(id).await;
        
        Ok(())
    }
    
    pub async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write(&id, &data).await
    }
    
    pub async fn paste_and_submit_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        // Send bracketed paste start sequence
        let paste_start = b"\x1b[200~";
        self.backend.write(&id, paste_start).await?;
        
        // Small delay to ensure paste start is processed
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        
        // Send the actual content
        self.backend.write(&id, &data).await?;
        
        // Small delay before paste end
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        
        // Send bracketed paste end sequence
        let paste_end = b"\x1b[201~";
        self.backend.write(&id, paste_end).await?;
        
        // Critical delay to ensure agent processes paste end before Enter
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        
        // Send Enter key (carriage return) as a separate, non-paste action
        let enter = b"\r";
        self.backend.write(&id, enter).await?;
        
        Ok(())
    }
    
    pub async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        debug!("Resizing terminal {id}: {cols}x{rows}");
        self.backend.resize(&id, cols, rows).await
    }
    
    pub async fn close_terminal(&self, id: String) -> Result<(), String> {
        info!("Closing terminal through manager: {id}");
        self.active_ids.write().await.remove(&id);
        self.backend.close(&id).await
    }
    
    pub async fn terminal_exists(&self, id: &str) -> Result<bool, String> {
        self.backend.exists(id).await
    }
    
    pub async fn get_terminal_buffer(&self, id: String) -> Result<String, String> {
        let (_, data) = self.backend.snapshot(&id, None).await?;
        Ok(String::from_utf8_lossy(&data).to_string())
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
        self.close_all().await
    }
    
    async fn start_event_bridge(&self, id: String) {
        // Only start if we're using LocalPtyAdapter which already emits events
        // This is a placeholder for future remote adapters that might need explicit bridging
        debug!("Event bridge started for terminal {id}");
    }
    
    pub async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        self.backend.get_activity_status(&id).await
    }
    
    pub async fn get_all_terminal_activity(&self) -> Vec<(String, bool, u64)> {
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

        assert!(manager
            .terminal_exists("test-mgr-1")
            .await
            .unwrap());
        assert!(manager
            .terminal_exists("test-mgr-2")
            .await
            .unwrap());

        manager.close_all().await.unwrap();

        assert!(!manager
            .terminal_exists("test-mgr-1")
            .await
            .unwrap());
        assert!(!manager
            .terminal_exists("test-mgr-2")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn test_get_terminal_buffer_returns_output() {
        let manager = TerminalManager::new();
        manager
            .create_terminal("buf-term".to_string(), "/tmp".to_string())
            .await
            .unwrap();
        // Nudge some output
        manager.write_terminal("buf-term".into(), b"echo hi\n".to_vec()).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let buf = manager.get_terminal_buffer("buf-term".into()).await.unwrap();
        assert!(!buf.is_empty());

        manager.close_terminal("buf-term".into()).await.unwrap();
    }
}
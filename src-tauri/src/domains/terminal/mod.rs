use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateParams {
    pub id: String,
    pub cwd: String,
    pub app: Option<ApplicationSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicationSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub ready_timeout_ms: u64,
}

#[derive(Debug, Clone)]
pub struct TerminalSnapshot {
    pub seq: u64,
    pub start_seq: u64,
    pub data: Vec<u8>,
}

#[async_trait::async_trait]
pub trait TerminalBackend: Send + Sync {
    async fn create(&self, params: CreateParams) -> Result<(), String>;
    async fn create_with_size(
        &self,
        params: CreateParams,
        cols: u16,
        rows: u16,
    ) -> Result<(), String>;
    async fn write(&self, id: &str, data: &[u8]) -> Result<(), String>;
    async fn write_immediate(&self, id: &str, data: &[u8]) -> Result<(), String>;
    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>;
    async fn close(&self, id: &str) -> Result<(), String>;
    async fn exists(&self, id: &str) -> Result<bool, String>;
    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<TerminalSnapshot, String>;
    async fn queue_initial_command(
        &self,
        _id: &str,
        _command: String,
        _ready_marker: Option<String>,
    ) -> Result<(), String> {
        Ok(())
    }
    async fn suspend(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }
    async fn resume(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }
    async fn is_suspended(&self, _id: &str) -> Result<bool, String> {
        Ok(false)
    }
    async fn force_kill_all(&self) -> Result<(), String> {
        Ok(())
    }
}

pub mod ansi;
pub mod coalescing;
pub mod command_builder;
pub mod control_sequences;
pub mod idle_detection;
pub mod lifecycle;
pub mod local;
pub mod manager;
pub mod shell_invocation;
pub mod utf8_stream;
pub mod visible;

#[cfg(test)]
pub mod manager_test;

pub use local::LocalPtyAdapter;
pub use manager::TerminalManager;
pub use shell_invocation::{
    build_login_shell_invocation, build_login_shell_invocation_with_shell, sh_quote_string,
    shell_invocation_to_posix, ShellInvocation,
};

use std::sync::RwLock;
static TERMINAL_SHELL_STATE: RwLock<Option<(String, Vec<String>)>> = RwLock::new(None);

pub fn put_terminal_shell_override(shell: String, args: Vec<String>) {
    if let Ok(mut guard) = TERMINAL_SHELL_STATE.write() {
        *guard = Some((shell, args));
    }
}

/// Determine the effective shell command and arguments, honoring user preferences set by the binary.
/// Falls back to the process `$SHELL` or a platform default when unset.
pub fn get_effective_shell() -> (String, Vec<String>) {
    // Use runtime override if present
    if let Ok(guard) = TERMINAL_SHELL_STATE.read() {
        if let Some((shell, args)) = guard.clone() {
            return (shell, args);
        }
    }

    let env_default = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    (env_default, Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_effective_shell_override() {
        // Ensure default returns something
        let (default_shell, default_args) = get_effective_shell();
        assert!(!default_shell.is_empty());
        assert!(default_args.is_empty());

        // Override and verify
        put_terminal_shell_override("/bin/zsh".to_string(), vec!["-l".to_string()]);
        let (shell, args) = get_effective_shell();
        assert_eq!(shell, "/bin/zsh");
        assert_eq!(args, vec!["-l".to_string()]);
    }
}

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
use std::{env, fs, path::Path, path::PathBuf};

const MACOS_FALLBACK_SHELLS: &[&str] = &[
    "/bin/zsh",
    "/usr/bin/zsh",
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/sh",
    "/usr/bin/sh",
];
static TERMINAL_SHELL_STATE: RwLock<Option<(String, Vec<String>)>> = RwLock::new(None);

fn fallback_shell_candidates() -> &'static [&'static str] {
    MACOS_FALLBACK_SHELLS
}

pub fn put_terminal_shell_override(shell: String, args: Vec<String>) {
    if let Ok(mut guard) = TERMINAL_SHELL_STATE.write() {
        *guard = Some((shell, args));
    }
}

/// Determine the effective shell command and arguments, honoring user preferences set by the binary.
/// Falls back to the process `$SHELL` or a platform default when unset.
pub fn get_effective_shell() -> (String, Vec<String>) {
    // Use runtime override if present and valid
    if let Ok(guard) = TERMINAL_SHELL_STATE.read() {
        if let Some((shell, args)) = guard.clone() {
            if let Some(resolved) = resolve_shell_candidate(&shell) {
                return (resolved, args);
            } else {
                log::warn!(
                    "Configured terminal shell {shell:?} is unavailable; falling back to defaults"
                );
            }
        }
    }

    if let Ok(env_shell) = env::var("SHELL") {
        if let Some(resolved) = resolve_shell_candidate(&env_shell) {
            return (resolved, Vec::new());
        } else {
            log::warn!(
                "Environment variable SHELL={env_shell:?} is unavailable; falling back to defaults"
            );
        }
    }

    for candidate in fallback_shell_candidates() {
        if let Some(resolved) = resolve_shell_candidate(candidate) {
            return (resolved, Vec::new());
        }
    }

    log::warn!("No configured shells available; falling back to bare 'sh'");
    ("sh".to_string(), Vec::new())
}

#[cfg(test)]
pub mod testing {
    use super::TERMINAL_SHELL_STATE;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static OVERRIDE_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    pub fn fallback_shell_candidates() -> &'static [&'static str] {
        super::fallback_shell_candidates()
    }

    pub fn capture_shell_override() -> Option<(String, Vec<String>)> {
        TERMINAL_SHELL_STATE
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    pub fn restore_shell_override(state: Option<(String, Vec<String>)>) {
        if let Ok(mut guard) = TERMINAL_SHELL_STATE.write() {
            *guard = state;
        }
    }

    pub fn reset_shell_override() {
        restore_shell_override(None);
    }

    pub fn override_lock() -> MutexGuard<'static, ()> {
        let mutex = OVERRIDE_MUTEX.get_or_init(|| Mutex::new(()));
        mutex.lock().expect("override mutex poisoned")
    }
}

fn resolve_shell_candidate(shell: &str) -> Option<String> {
    if shell.trim().is_empty() {
        return None;
    }

    let expanded = expand_home(shell);
    let candidate_path = Path::new(&expanded);

    if candidate_path.is_absolute() {
        return path_is_executable(candidate_path).then_some(expanded);
    }

    if let Some(resolved) = search_on_path(&expanded) {
        return Some(resolved);
    }

    // Last resort: interpret as relative path in current directory
    if path_is_executable(Path::new(shell)) {
        return Some(shell.to_string());
    }

    None
}

fn expand_home(shell: &str) -> String {
    if let Some(stripped) = shell.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home)
                .join(stripped)
                .to_string_lossy()
                .into_owned();
        }
    }

    shell.to_string()
}

fn search_on_path(shell: &str) -> Option<String> {
    if let Some(path_var) = env::var_os("PATH") {
        for entry in env::split_paths(&path_var) {
            let candidate = entry.join(shell);
            if path_is_executable(&candidate) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn path_is_executable(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::metadata(path)
            .map(|metadata| (metadata.permissions().mode() & 0o111) != 0)
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        true
    }
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

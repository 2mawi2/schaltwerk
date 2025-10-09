use super::local::TerminalState;
use crate::infrastructure::events::{emit_event, SchaltEvent};
use log::{debug, error, info, warn};
use portable_pty::{Child, ExitStatus, MasterPty};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tokio::sync::{Mutex, RwLock};

#[derive(Clone)]
pub(super) struct LifecycleDeps {
    pub(super) terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    pub(super) app_handle: Arc<Mutex<Option<AppHandle>>>,
    pub(super) pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    pub(super) pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pub(super) pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
}

pub(crate) fn is_agent_terminal(terminal_id: &str) -> bool {
    terminal_id.contains("-top")
        && (terminal_id.contains("session-") || terminal_id.contains("orchestrator-"))
}

pub(crate) fn get_agent_type_from_terminal(terminal_id: &str) -> Option<&'static str> {
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

/// Extracts the sanitized session name component from a session terminal identifier.
/// Returns `None` for non-session terminals.
pub(crate) fn extract_session_name(terminal_id: &str) -> Option<String> {
    if terminal_id.starts_with("session-") && terminal_id.ends_with("-top") {
        let without_prefix = terminal_id.strip_prefix("session-")?;
        let without_suffix = without_prefix.strip_suffix("-top")?;
        if let Some((name_part, hash_part)) = without_suffix.rsplit_once('~') {
            if hash_part.len() == 6 && hash_part.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(name_part.to_string());
            }
        }
        Some(without_suffix.to_string())
    } else if terminal_id.starts_with("orchestrator-") && terminal_id.ends_with("-top") {
        let without_prefix = terminal_id.strip_prefix("orchestrator-")?;
        let without_suffix = without_prefix.strip_suffix("-top")?;
        Some(without_suffix.to_string())
    } else {
        None
    }
}

async fn log_agent_crash_details(terminal_id: &str, exit_status: &ExitStatus) {
    let agent_type = get_agent_type_from_terminal(terminal_id).unwrap_or("unknown");

    error!("=== AGENT CRASH REPORT ===");
    error!("Terminal ID: {terminal_id}");
    error!("Agent Type: {agent_type}");
    error!("Exit Status: {exit_status:?}");
    error!("Exit Code: {:?}", exit_status.exit_code());
    error!("Success: {}", exit_status.success());

    if let Some(session_name) = extract_session_name(terminal_id) {
        error!("Session Name: {session_name}");
    }

    error!("=== END CRASH REPORT ===");
}

async fn check_agent_health(
    terminal_id: &str,
    terminals: &Arc<RwLock<HashMap<String, TerminalState>>>,
    last_activity_check: &mut Instant,
) {
    let now = Instant::now();
    let since_last_check = now.duration_since(*last_activity_check);

    if since_last_check < std::time::Duration::from_secs(30) {
        return;
    }

    *last_activity_check = now;

    let terminals_guard = terminals.read().await;
    if let Some(state) = terminals_guard.get(terminal_id) {
        if let Ok(elapsed) = std::time::SystemTime::now().duration_since(state.last_output) {
            let elapsed_secs = elapsed.as_secs();

            let inactivity_threshold = if get_agent_type_from_terminal(terminal_id) == Some("codex")
            {
                300
            } else {
                600
            };

            if elapsed_secs > inactivity_threshold {
                warn!(
                    "AGENT HEALTH WARNING: Terminal {terminal_id} has been inactive for {elapsed_secs} seconds (threshold: {inactivity_threshold})"
                );

                debug!(
                    "Agent terminal {terminal_id} buffer size: {} bytes, seq: {}",
                    state.buffer.len(),
                    state.seq
                );
            }
        }
    }
}

async fn handle_agent_crash(terminal_id: String, status: ExitStatus, deps: LifecycleDeps) {
    error!("HANDLING AGENT CRASH for terminal: {terminal_id}");

    let agent_type = get_agent_type_from_terminal(&terminal_id).unwrap_or("unknown");
    let session_name = extract_session_name(&terminal_id);

    let (buffer_size, last_seq) = {
        let terminals_guard = deps.terminals.read().await;
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
        status.exit_code(),
        buffer_size,
        last_seq
    );

    cleanup_dead_terminal(terminal_id.clone(), &deps).await;

    let handle_guard = deps.app_handle.lock().await;
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
            exit_code: Some(status.exit_code() as i32),
            buffer_size,
            last_seq,
        };

        if let Err(e) = emit_event(handle, SchaltEvent::AgentCrashed, &payload) {
            warn!("Failed to emit agent-crashed event for {terminal_id}: {e}");
        } else {
            info!("Emitted agent-crashed event for terminal: {terminal_id}");
        }
    }

    log_agent_crash_details(&terminal_id, &status).await;
}

pub(super) async fn cleanup_dead_terminal(id: String, deps: &LifecycleDeps) {
    info!("Cleaning up dead terminal: {id}");

    deps.pty_children.lock().await.remove(&id);
    deps.pty_masters.lock().await.remove(&id);
    deps.pty_writers.lock().await.remove(&id);
    deps.terminals.write().await.remove(&id);

    let handle_guard = deps.app_handle.lock().await;
    match handle_guard.as_ref() {
        Some(handle) => {
            if let Err(e) = emit_event(
                handle,
                SchaltEvent::TerminalClosed,
                &serde_json::json!({
                    "terminal_id": id
                }),
            ) {
                warn!("Failed to emit terminal-closed event: {e}");
            }
        }
        None => {
            debug!("Skipping terminal-closed event during app shutdown");
        }
    }

    info!("Dead terminal cleanup completed");
}

pub(super) async fn start_process_monitor(id: String, deps: LifecycleDeps) {
    let monitor_id = id.clone();
    let is_agent = is_agent_terminal(&monitor_id);

    if is_agent {
        info!("Starting enhanced monitoring for agent terminal: {monitor_id}");
    }

    let mut check_interval = tokio::time::Duration::from_secs(1);
    let max_interval = tokio::time::Duration::from_secs(30);
    let mut last_activity_check = Instant::now();

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(check_interval).await;

            let should_cleanup = {
                let child_guard = deps.pty_children.lock().await;
                child_guard.get(&monitor_id).is_none()
            };

            if should_cleanup {
                break;
            }

            if !deps.terminals.read().await.contains_key(&monitor_id) {
                debug!("Terminal {monitor_id} state removed, stopping process monitor");
                break;
            }

            let process_status = {
                let mut child_guard = deps.pty_children.lock().await;
                if let Some(child) = child_guard.get_mut(&monitor_id) {
                    match child.try_wait() {
                        Ok(Some(status)) => Some(status),
                        Ok(None) => {
                            if is_agent {
                                check_agent_health(
                                    &monitor_id,
                                    &deps.terminals,
                                    &mut last_activity_check,
                                )
                                .await;
                            }
                            None
                        }
                        Err(e) => {
                            if is_agent {
                                error!(
                                    "AGENT MONITOR ERROR: Failed to check process status for {monitor_id}: {e}"
                                );
                            } else {
                                debug!("Process monitor error for terminal {monitor_id}: {e}");
                            }
                            None
                        }
                    }
                } else {
                    None
                }
            };

            if let Some(status) = process_status {
                if is_agent {
                    if status.success() {
                        info!(
                            "Agent terminal {monitor_id} exited normally with status: {status:?}"
                        );
                    } else {
                        error!(
                            "AGENT CRASH DETECTED: Terminal {monitor_id} exited with error status: {status:?}"
                        );
                    }

                    handle_agent_crash(monitor_id.clone(), status, deps.clone()).await;
                } else {
                    info!("Terminal {monitor_id} process exited with status: {status:?}");
                    cleanup_dead_terminal(monitor_id.clone(), &deps).await;
                }
                break;
            }

            check_interval = std::cmp::min(check_interval * 2, max_interval);
        }

        if is_agent {
            info!("Agent monitor for terminal {monitor_id} terminated");
        } else {
            debug!("Process monitor for terminal {monitor_id} terminated");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::terminal_id::{terminal_id_for_session_bottom, terminal_id_for_session_top};

    #[test]
    fn detects_agent_terminals() {
        assert!(is_agent_terminal("session-main-top"));
        assert!(is_agent_terminal("orchestrator-core-top"));
        assert!(!is_agent_terminal("session-main-bottom"));
        assert!(!is_agent_terminal("random-terminal"));
    }

    #[test]
    fn infers_agent_type_from_terminal_id() {
        assert_eq!(
            get_agent_type_from_terminal("session-codex-top"),
            Some("codex")
        );
        assert_eq!(
            get_agent_type_from_terminal("session-claude-top"),
            Some("claude")
        );
        assert_eq!(
            get_agent_type_from_terminal("session-gemini-top"),
            Some("gemini")
        );
        assert_eq!(get_agent_type_from_terminal("session-unknown-top"), None);
    }

    #[test]
    fn extracts_session_name_from_terminal_id() {
        let session_top = terminal_id_for_session_top("alpha");
        assert_eq!(
            extract_session_name(&session_top),
            Some("alpha".to_string())
        );
        assert_eq!(
            extract_session_name("orchestrator-coordinator-top"),
            Some("coordinator".to_string())
        );
        let session_bottom = terminal_id_for_session_bottom("alpha");
        assert_eq!(extract_session_name(&session_bottom), None);
    }

    #[test]
    fn extracts_sanitized_name_component() {
        let session_top = terminal_id_for_session_top("alpha beta");
        assert_eq!(
            extract_session_name(&session_top),
            Some("alpha_beta".to_string())
        );
    }
}

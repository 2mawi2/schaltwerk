use super::{agent_ctx, terminals};
use crate::{get_terminal_manager, parse_agent_command};
use once_cell::sync::Lazy;
use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;

// Serialize launches per terminal to prevent interleaved close/create races that could
// momentarily run two different agents in the same PTY. This avoids the UI symptom of
// two AIs appearing in one terminal due to overlapping spawns.
static START_LOCKS: Lazy<AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

pub async fn launch_in_terminal(
    terminal_id: String,
    command_line: String,
    db: &schaltwerk::schaltwerk_core::Database,
    repo_path: &std::path::Path,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    // Acquire (or create) a lock specific to this terminal id and hold it for the
    // whole close→create sequence. This guarantees only one launch pipeline runs
    // at a time for a given terminal.
    let term_lock = {
        let mut map = START_LOCKS.lock().await;
        map.entry(terminal_id.clone())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    };
    let _guard = term_lock.lock().await;

    let (cwd, agent_name, agent_args) = parse_agent_command(&command_line)?;
    terminals::ensure_cwd_access(&cwd)?;

    let agent_kind = agent_ctx::infer_agent_kind(&agent_name);
    let (env_vars, cli_text) =
        agent_ctx::collect_agent_env_and_cli(&agent_kind, repo_path, db).await;
    let final_args = agent_ctx::build_final_args(&agent_kind, agent_args, &cli_text);

    let manager = get_terminal_manager().await?;
    if manager.terminal_exists(&terminal_id).await? {
        manager.close_terminal(terminal_id.clone()).await?;
    }

    if let (Some(c), Some(r)) = (cols, rows) {
        manager
            .create_terminal_with_app_and_size(CreateTerminalWithAppAndSizeParams {
                id: terminal_id.clone(),
                cwd: cwd.clone(),
                command: agent_name.clone(),
                args: final_args.clone(),
                env: env_vars.clone(),
                cols: c,
                rows: r,
            })
            .await?;
    } else {
        manager
            .create_terminal_with_app(
                terminal_id.clone(),
                cwd.clone(),
                agent_name.clone(),
                final_args.clone(),
                env_vars.clone(),
            )
            .await?;
    }

    Ok(command_line)
}

use super::{agent_ctx, terminals};
use crate::get_terminal_manager;
use schaltwerk::domains::agents::{parse_agent_command, AgentLaunchSpec};
use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex as AsyncMutex;

static START_LOCKS: LazyLock<AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>> =
    LazyLock::new(|| AsyncMutex::new(HashMap::new()));

pub async fn launch_in_terminal(
    terminal_id: String,
    launch_spec: AgentLaunchSpec,
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

    let command_line = launch_spec.format_for_shell();
    let (cwd, agent_name, agent_args) = parse_agent_command(&command_line)?;
    terminals::ensure_cwd_access(&cwd)?;

    let agent_kind = agent_ctx::infer_agent_kind(&agent_name);
    let (env_vars, cli_text) =
        agent_ctx::collect_agent_env_and_cli(&agent_kind, repo_path, db).await;
    let merged_env = merge_env_vars(env_vars, &launch_spec.env_vars);
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
                env: merged_env.clone(),
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
                merged_env.clone(),
            )
            .await?;
    }

    Ok(launch_spec.shell_command)
}

fn merge_env_vars(
    base: Vec<(String, String)>,
    extra: &HashMap<String, String>,
) -> Vec<(String, String)> {
    if extra.is_empty() {
        return base;
    }

    let mut merged: HashMap<String, String> = base.into_iter().collect();
    for (key, value) in extra {
        merged.insert(key.clone(), value.clone());
    }

    merged.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::merge_env_vars;
    use std::collections::HashMap;

    #[test]
    fn merge_env_vars_overrides_duplicates() {
        let base = vec![
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("API_KEY".to_string(), "123".to_string()),
        ];
        let mut extra = HashMap::new();
        extra.insert("PATH".to_string(), "/tmp/shim:/usr/bin".to_string());
        extra.insert("NEW_VAR".to_string(), "value".to_string());

        let merged = merge_env_vars(base, &extra);
        let map: HashMap<_, _> = merged.into_iter().collect();

        assert_eq!(map.get("PATH"), Some(&"/tmp/shim:/usr/bin".to_string()));
        assert_eq!(map.get("API_KEY"), Some(&"123".to_string()));
        assert_eq!(map.get("NEW_VAR"), Some(&"value".to_string()));
    }
}

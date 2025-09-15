use crate::{parse_agent_command, get_terminal_manager};
use super::{agent_ctx, terminals};
use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;

pub async fn launch_in_terminal(
    terminal_id: String,
    command_line: String,
    db: &schaltwerk::schaltwerk_core::Database,
    repo_path: &std::path::Path,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let (cwd, agent_name, agent_args) = parse_agent_command(&command_line)?;
    terminals::ensure_cwd_access(&cwd)?;

    let agent_kind = agent_ctx::infer_agent_kind(&agent_name);
    let (env_vars, cli_text) = agent_ctx::collect_agent_env_and_cli(&agent_kind, repo_path, db).await;
    let final_args = agent_ctx::build_final_args(&agent_kind, agent_args, &cli_text);

    let manager = get_terminal_manager().await?;
    if manager.terminal_exists(&terminal_id).await? {
        manager.close_terminal(terminal_id.clone()).await?;
    }

    if let (Some(c), Some(r)) = (cols, rows) {
        manager.create_terminal_with_app_and_size(
            CreateTerminalWithAppAndSizeParams {
                id: terminal_id.clone(),
                cwd: cwd.clone(),
                command: agent_name.clone(),
                args: final_args.clone(),
                env: env_vars.clone(),
                cols: c,
                rows: r,
            }
        ).await?;
    } else {
        manager.create_terminal_with_app(
            terminal_id.clone(),
            cwd.clone(),
            agent_name.clone(),
            final_args.clone(),
            env_vars.clone(),
        ).await?;
    }

    Ok(command_line)
}


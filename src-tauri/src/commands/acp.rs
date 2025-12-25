use crate::{SETTINGS_MANAGER, get_acp_manager, get_core_read};
use anyhow::{Result, anyhow};
use schaltwerk::infrastructure::database::{AppConfigMethods, ProjectConfigMethods};
use schaltwerk::services::AgentManifest;
use which::which;

fn resolve_claude_code_acp_command() -> Result<(String, Vec<String>)> {
    if let Ok(value) = std::env::var("SCHALTWERK_CLAUDE_ACP_BINARY") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let parts = shell_words::split(trimmed)
                .map_err(|e| anyhow!("Failed to parse SCHALTWERK_CLAUDE_ACP_BINARY: {e}"))?;
            let binary = parts
                .first()
                .ok_or_else(|| anyhow!("SCHALTWERK_CLAUDE_ACP_BINARY is empty"))?
                .to_string();
            let args = parts.into_iter().skip(1).collect::<Vec<_>>();
            if which(&binary).is_ok() {
                return Ok((binary, args));
            }
            return Err(anyhow!(
                "Claude Code ACP command not found: '{binary}'. Ensure it exists or update SCHALTWERK_CLAUDE_ACP_BINARY."
            ));
        }
    }

    // Prefer a manifest-provided binary if present (future-proofing).
    if let Some(def) = AgentManifest::get("claudecode")
        .filter(|def| which(&def.default_binary_path).is_ok())
    {
        return Ok((def.default_binary_path.clone(), Vec::new()));
    }

    for candidate in [
        // Official ACP adapter (recommended).
        "claude-code-acp",
        // Community bridge binary (Apple Silicon release name)
        "ccacp-arm64",
        // Common build output name
        "ccacp",
    ] {
        if which(candidate).is_ok() {
            return Ok((candidate.to_string(), Vec::new()));
        }
    }

    Err(anyhow!(
        "Claude Code ACP adapter not found. Install '@zed-industries/claude-code-acp' (so 'claude-code-acp' is on PATH), or set SCHALTWERK_CLAUDE_ACP_BINARY (it may include args, e.g. 'npx -y @zed-industries/claude-code-acp')."
    ))
}

#[tauri::command]
pub async fn schaltwerk_acp_start_session(
    app: tauri::AppHandle,
    session_name: String,
) -> Result<(), String> {
    let core = get_core_read().await?;
    let db = core.db.clone();
    let repo_path = core.repo_path.clone();
    let manager = core.session_manager();
    drop(core);

    let session = manager
        .get_session(&session_name)
        .map_err(|e| format!("Failed to get session: {e}"))?;

    let skip_permissions = session.original_skip_permissions.unwrap_or_else(|| {
        db.get_skip_permissions()
            .unwrap_or(false)
    });

    let (agent_binary, agent_args) = resolve_claude_code_acp_command()
        .map_err(|e| e.to_string())?;

    let initial_mode = skip_permissions.then(|| "bypassPermissions".to_string());

    let mut env_vars = Vec::new();
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        env_vars.extend(settings.get_agent_env_vars("claude").into_iter());
    }

    if let Ok(project_env) = db.get_project_environment_variables(repo_path.as_path()) {
        env_vars.extend(project_env.into_iter());
    }

    let acp = get_acp_manager().await?;
    acp.ensure_session_started(
        app,
        &session_name,
        session.worktree_path.clone(),
        (agent_binary, agent_args),
        env_vars,
        initial_mode,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn schaltwerk_acp_prompt(session_name: String, prompt: String) -> Result<(), String> {
    let acp = get_acp_manager().await?;
    acp.prompt(&session_name, prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn schaltwerk_acp_resolve_permission(
    session_name: String,
    request_id: schaltwerk::domains::acp::manager::JsonRpcId,
    option_id: String,
) -> Result<(), String> {
    let acp = get_acp_manager().await?;
    acp.resolve_permission(&session_name, request_id, option_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn schaltwerk_acp_stop_session(session_name: String) -> Result<(), String> {
    let acp = get_acp_manager().await?;
    acp.stop_session(&session_name)
        .await
        .map_err(|e| e.to_string())
}

use crate::{SETTINGS_MANAGER, get_acp_manager, get_core_read};
use anyhow::{Result, anyhow};
use schaltwerk::infrastructure::database::{AppConfigMethods, ProjectConfigMethods};
use schaltwerk::services::AgentManifest;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use schaltwerk::shared::session_metadata_gateway::SessionMetadataGateway;

fn build_lookup_path_prefix(cwd: &Path) -> String {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{home}/.local/bin"));
        candidates.push(format!("{home}/.cargo/bin"));
        candidates.push(format!("{home}/bin"));

        candidates.extend(schaltwerk::domains::terminal::nvm::nvm_bin_paths(
            &home,
            &cwd.to_string_lossy(),
        ));
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in candidates {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen.insert(trimmed.to_string()) {
            continue;
        }
        out.push(trimmed.to_string());
    }

    out.join(":")
}

async fn resolve_program_in_login_shell(program: &str, cwd: &Path) -> Option<String> {
    let lookup_path = build_lookup_path_prefix(cwd);
    let lookup = if lookup_path.is_empty() {
        format!(
            "command -v {}",
            schaltwerk::domains::terminal::sh_quote_string(program)
        )
    } else {
        format!(
            "PATH={}:\"$PATH\" command -v {}",
            schaltwerk::domains::terminal::sh_quote_string(&lookup_path),
            schaltwerk::domains::terminal::sh_quote_string(program)
        )
    };
    let invocation = schaltwerk::domains::terminal::build_login_shell_invocation(&lookup);
    let output = Command::new(&invocation.program)
        .args(&invocation.args)
        .current_dir(cwd)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved.is_empty() {
        None
    } else {
        Some(resolved)
    }
}

fn try_rewrite_npx_to_node_invocation(npx_path: &str, args: Vec<String>) -> Option<(String, Vec<String>)> {
    let npx_path = Path::new(npx_path);
    let bin_dir = npx_path.parent()?;
    let prefix = bin_dir.parent()?;
    let node_path = bin_dir.join("node");
    let npx_cli = prefix.join("lib").join("node_modules").join("npm").join("bin").join("npx-cli.js");

    if !node_path.is_file() || !npx_cli.is_file() {
        return None;
    }

    let mut out_args = Vec::with_capacity(args.len() + 1);
    out_args.push(npx_cli.to_string_lossy().into_owned());
    out_args.extend(args);

    Some((node_path.to_string_lossy().into_owned(), out_args))
}

fn npx_cli_for_node_path(node_path: &str) -> Option<PathBuf> {
    let node_path = Path::new(node_path);
    let bin_dir = node_path.parent()?;
    let prefix = bin_dir.parent()?;
    let npx_cli = prefix.join("lib").join("node_modules").join("npm").join("bin").join("npx-cli.js");
    if npx_cli.is_file() { Some(npx_cli) } else { None }
}

async fn resolve_node_candidates(cwd: &Path) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        for bin_dir in schaltwerk::domains::terminal::nvm::nvm_bin_paths(&home, &cwd.to_string_lossy()) {
            let node = Path::new(&bin_dir).join("node");
            if node.is_file() {
                candidates.push(node.to_string_lossy().into_owned());
            }
        }
    }

    if let Some(resolved) = resolve_program_in_login_shell("node", cwd).await {
        candidates.push(resolved);
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|entry| !entry.trim().is_empty())
        .filter(|entry| seen.insert(entry.clone()))
        .collect()
}

async fn build_node_npx_cli_invocation(
    cwd: &Path,
    npx_args: Vec<String>,
) -> Option<(String, Vec<String>)> {
    for resolved_node in resolve_node_candidates(cwd).await {
        let Some(npx_cli) = npx_cli_for_node_path(&resolved_node) else {
            continue;
        };

        let mut out_args = Vec::with_capacity(npx_args.len() + 1);
        out_args.push(npx_cli.to_string_lossy().into_owned());
        out_args.extend(npx_args.clone());

        return Some((resolved_node, out_args));
    }

    None
}

async fn resolve_claude_code_acp_command(cwd: &Path) -> Result<(String, Vec<String>)> {
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

            if let Some(resolved) = resolve_program_in_login_shell(&binary, cwd).await {
                let base = Path::new(&resolved)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                if base == "npx"
                    && let Some(rewritten) = try_rewrite_npx_to_node_invocation(&resolved, args.clone())
                {
                    return Ok(rewritten);
                }
                if base == "npx"
                    && let Some(fallback) = build_node_npx_cli_invocation(cwd, args.clone()).await
                {
                    return Ok(fallback);
                }
                return Ok((resolved, args));
            }

            return Err(anyhow!(
                "Claude Code ACP command not found: '{binary}'. Ensure it exists in your login shell PATH or update SCHALTWERK_CLAUDE_ACP_BINARY."
            ));
        }
    }

    // Prefer a manifest-provided binary if present (future-proofing).
    if let Some(def) = AgentManifest::get("claudecode")
        && !def.default_binary_path.trim().is_empty()
        && let Some(resolved) = resolve_program_in_login_shell(&def.default_binary_path, cwd).await
    {
        return Ok((resolved, Vec::new()));
    }

    for candidate in [
        // Official ACP adapter (recommended).
        "claude-code-acp",
        // Community bridge binary (Apple Silicon release name)
        "ccacp-arm64",
        // Common build output name
        "ccacp",
    ] {
        if let Some(resolved) = resolve_program_in_login_shell(candidate, cwd).await {
            return Ok((resolved, Vec::new()));
        }
    }

    // Fallback: run from npm without a global install (requires Node.js + npm/npx).
    // Prefer invoking the npm-bundled npx-cli.js via the matching node binary to avoid broken shebangs.
    if let Some((resolved_node, out_args)) = build_node_npx_cli_invocation(
        cwd,
        vec![
            "-y".to_string(),
            "@zed-industries/claude-code-acp".to_string(),
        ],
    )
    .await
    {
        return Ok((
            resolved_node,
            out_args,
        ));
    }

    if let Some(resolved_npx) = resolve_program_in_login_shell("npx", cwd).await {
        if let Some(rewritten) = try_rewrite_npx_to_node_invocation(
            &resolved_npx,
            vec![
                "-y".to_string(),
                "@zed-industries/claude-code-acp".to_string(),
            ],
        ) {
            return Ok(rewritten);
        }

        return Ok((
            resolved_npx,
            vec![
                "-y".to_string(),
                "@zed-industries/claude-code-acp".to_string(),
            ],
        ));
    }

    Err(anyhow!(
        "Claude Code ACP adapter not found. Either:\n- Install Node.js (to get 'npx'), or\n- Install '@zed-industries/claude-code-acp' (so 'claude-code-acp' is on PATH), or\n- Set SCHALTWERK_CLAUDE_ACP_BINARY (it may include args, e.g. 'npx -y @zed-industries/claude-code-acp')."
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

    let skip_permissions = session
        .original_skip_permissions
        .unwrap_or_else(|| db.get_skip_permissions().unwrap_or(false));

    let (agent_binary, agent_args) = resolve_claude_code_acp_command(session.worktree_path.as_path())
        .await
        .map_err(|e| e.to_string())?;

    let initial_mode = skip_permissions.then(|| "bypassPermissions".to_string());

    let resume_session_id = if session.resume_allowed {
        schaltwerk::domains::agents::claude::find_resumable_claude_session_fast(&session.worktree_path)
    } else {
        None
    };

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
        schaltwerk::domains::acp::manager::AcpSessionStartOptions {
            env_vars,
            initial_mode,
            resume_session_id,
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let metadata_gateway = SessionMetadataGateway::new(&db);
    if !session.resume_allowed
        && let Err(error) = metadata_gateway.update_session_resume_flag(&session.id, true)
    {
        log::warn!("[acp] Failed to flip resume_allowed for {session_name}: {error}");
    }

    Ok(())
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

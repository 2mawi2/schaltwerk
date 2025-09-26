use crate::{get_schaltwerk_core, get_terminal_manager, SETTINGS_MANAGER};
use schaltwerk::domains::agents::{naming, parse_agent_command};
use schaltwerk::domains::sessions::db_sessions::SessionMethods;
use schaltwerk::domains::sessions::entity::{
    EnrichedSession, FilterMode, Session, SessionState, SortMode,
};
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::schaltwerk_core::db_app_config::AppConfigMethods;
use schaltwerk::schaltwerk_core::db_project_config::{ProjectConfigMethods, DEFAULT_BRANCH_PREFIX};
mod agent_ctx;
mod agent_launcher;
mod events;
mod schaltwerk_core_cli;
mod terminals;

// Simple POSIX sh single-quote helper for safe argument joining in one-liners
fn sh_quote_string(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let mut out = String::from("'");
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

// Helper functions for session name parsing
fn is_version_suffix(s: &str) -> bool {
    s.starts_with('v') && s.len() > 1 && s[1..].chars().all(|c| c.is_numeric())
}

fn is_versioned_session_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split('_').collect();
    parts.len() == 3 && parts.last().is_some_and(|p| is_version_suffix(p))
}

fn matches_version_pattern(name: &str, base_name: &str) -> bool {
    if let Some(suffix) = name.strip_prefix(&format!("{base_name}_v")) {
        !suffix.is_empty() && suffix.chars().all(|c| c.is_numeric())
    } else {
        false
    }
}

fn get_agent_env_and_cli_args(agent_type: &str) -> (Vec<(String, String)>, String, Option<String>) {
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = futures::executor::block_on(settings_manager.lock());
        let env_vars = manager
            .get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        let binary_path = manager.get_effective_binary_path(agent_type).ok();
        (env_vars, cli_args, binary_path)
    } else {
        (vec![], String::new(), None)
    }
}

// CLI helpers live in schaltwerk_core_cli.rs and are consumed by agent_ctx

// CODEX FLAG NORMALIZATION - Why It's Needed:
//
// Codex has inconsistent CLI flag handling that differs from standard Unix conventions:
// 1. Users often type `-model` expecting it to work like `--model`, but Codex only accepts
//    the double-dash form for long flags (or the short form `-m`)
// 2. The `--profile` flag must appear BEFORE `--model` in the argument list for Codex to
//    properly apply profile settings that might override the model
// 3. This normalization ensures user intent is preserved regardless of how they type flags
//
// Examples of what this fixes:
// - User types: `-model gpt-4` → Normalized to: `--model gpt-4`
// - User types: `-profile work -model gpt-4` → Reordered so profile comes first
// - Short flags like `-m` and `-p` are preserved as-is (they work correctly)
//
// Without this normalization, Codex would silently ignore malformed flags, leading to
// unexpected behavior where the wrong model or profile is used.

// Turn accidental single-dash long options into proper double-dash for Codex
// Only affects known long flags: model, profile. Keeps true short flags intact.
// (no local wrappers needed)

#[tauri::command]
pub async fn schaltwerk_core_list_enriched_sessions() -> Result<Vec<EnrichedSession>, String> {
    log::debug!("Listing enriched sessions from schaltwerk_core");

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    match manager.list_enriched_sessions() {
        Ok(sessions) => {
            log::debug!("Found {} sessions", sessions.len());
            Ok(sessions)
        }
        Err(e) => {
            log::error!("Failed to list enriched sessions: {e}");
            Err(format!("Failed to get sessions: {e}"))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_archive_spec_session(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .archive_spec_session(&name)
        .map_err(|e| format!("Failed to archive spec: {e}"))?;

    // Emit events to refresh UI
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    events::emit_archive_updated(&app, &repo, count);
    // Also emit a SessionRemoved event so the frontend can compute the next selection consistently
    events::emit_session_removed(&app, &name);
    events::emit_sessions_refreshed(&app, &Vec::<EnrichedSession>::new());
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_archived_specs(
) -> Result<Vec<schaltwerk::domains::sessions::entity::ArchivedSpec>, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .list_archived_specs()
        .map_err(|e| format!("Failed to list archived specs: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_restore_archived_spec(
    app: tauri::AppHandle,
    id: String,
    new_name: Option<String>,
) -> Result<schaltwerk::domains::sessions::entity::Session, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    let session = manager
        .restore_archived_spec(&id, new_name.as_deref())
        .map_err(|e| format!("Failed to restore archived spec: {e}"))?;

    // Notify UI
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    events::emit_archive_updated(&app, &repo, count);
    events::emit_sessions_refreshed(&app, &Vec::<EnrichedSession>::new());
    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_delete_archived_spec(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .delete_archived_spec(&id)
        .map_err(|e| format!("Failed to delete archived spec: {e}"))?;
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    events::emit_archive_updated(&app, &repo, count);
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_archive_max_entries() -> Result<i32, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .get_archive_max_entries()
        .map_err(|e| format!("Failed to get archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_archive_max_entries(limit: i32) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .set_archive_max_entries(limit)
        .map_err(|e| format!("Failed to set archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_enriched_sessions_sorted(
    sort_mode: String,
    filter_mode: String,
) -> Result<Vec<EnrichedSession>, String> {
    log::debug!("Listing sorted enriched sessions: sort={sort_mode}, filter={filter_mode}");

    let sort_mode_str = sort_mode.clone();
    let filter_mode_str = filter_mode.clone();
    let sort_mode = sort_mode
        .parse::<SortMode>()
        .map_err(|e| format!("Invalid sort mode '{sort_mode_str}': {e}"))?;
    let filter_mode = filter_mode_str
        .parse::<FilterMode>()
        .map_err(|e| format!("Invalid filter mode '{filter_mode_str}': {e}"))?;

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    match manager.list_enriched_sessions_sorted(sort_mode, filter_mode) {
        Ok(sessions) => {
            log::debug!("Found {} sorted/filtered sessions", sessions.len());
            Ok(sessions)
        }
        Err(e) => {
            log::error!("Failed to list sorted enriched sessions: {e}");
            Err(format!("Failed to get sorted sessions: {e}"))
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionParams {
    name: String,
    prompt: Option<String>,
    base_branch: Option<String>,
    user_edited_name: Option<bool>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    agent_type: Option<String>,
    skip_permissions: Option<bool>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schaltwerk_core_create_session(
    app: tauri::AppHandle,
    name: String,
    prompt: Option<String>,
    base_branch: Option<String>,
    user_edited_name: Option<bool>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    agent_type: Option<String>,
    skip_permissions: Option<bool>,
) -> Result<Session, String> {
    // Wrap in params struct to avoid clippy warning about too many arguments
    let params = CreateSessionParams {
        name,
        prompt,
        base_branch,
        user_edited_name,
        version_group_id,
        version_number,
        agent_type,
        skip_permissions,
    };
    let was_user_edited = params.user_edited_name.unwrap_or(false);
    // Consider it auto-generated if:
    // 1. It looks like a Docker-style name (adjective_noun format) AND wasn't user edited
    // 2. OR it wasn't user edited at all (even custom names should be renamed if not edited)
    let was_auto_generated = !was_user_edited;

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    let creation_params = schaltwerk::domains::sessions::service::SessionCreationParams {
        name: &params.name,
        prompt: params.prompt.as_deref(),
        base_branch: params.base_branch.as_deref(),
        was_auto_generated,
        version_group_id: params.version_group_id.as_deref(),
        version_number: params.version_number,
        agent_type: params.agent_type.as_deref(),
        skip_permissions: params.skip_permissions,
    };
    let session = manager
        .create_session_with_agent(creation_params)
        .map_err(|e| format!("Failed to create session: {e}"))?;

    let session_name_clone = session.name.clone();
    let app_handle = app.clone();

    #[derive(serde::Serialize, Clone)]
    struct SessionAddedPayload {
        session_name: String,
        branch: String,
        worktree_path: String,
        parent_branch: String,
        created_at: String,
        last_modified: Option<String>,
    }
    let _ = emit_event(
        &app,
        SchaltEvent::SessionAdded,
        &SessionAddedPayload {
            session_name: session.name.clone(),
            branch: session.branch.clone(),
            worktree_path: session.worktree_path.to_string_lossy().to_string(),
            parent_branch: session.parent_branch.clone(),
            created_at: session.created_at.to_rfc3339(),
            last_modified: session.last_activity.map(|ts| ts.to_rfc3339()),
        },
    );

    drop(core_lock);

    // Only trigger auto-rename for non-versioned Docker-style names
    // Versioned names (ending with _v1, _v2, etc.) will be handled by group rename
    if was_auto_generated && !is_versioned_session_name(&params.name) {
        log::info!(
            "Session '{}' was auto-generated (non-versioned), spawning name generation agent",
            params.name
        );
        tokio::spawn(async move {
            let (session_info, db_clone) = {
                let core = match get_schaltwerk_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!(
                            "Cannot get schaltwerk_core for session '{session_name_clone}': {e}"
                        );
                        return;
                    }
                };
                let core = core.lock().await;
                let manager = core.session_manager();
                let session = match manager.get_session(&session_name_clone) {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!("Cannot load session '{session_name_clone}' for naming: {e}");
                        return;
                    }
                };
                log::info!(
                    "Session '{}' loaded: pending_name_generation={}, original_agent_type={:?}",
                    session_name_clone,
                    session.pending_name_generation,
                    session.original_agent_type
                );

                if !session.pending_name_generation {
                    log::info!("Session '{session_name_clone}' does not have pending_name_generation flag, skipping");
                    return;
                }
                let agent = session.original_agent_type.clone().unwrap_or_else(|| {
                    core.db
                        .get_agent_type()
                        .unwrap_or_else(|_| "claude".to_string())
                });

                log::info!(
                    "Using agent '{agent}' for name generation of session '{session_name_clone}'"
                );

                (
                    (
                        session.id.clone(),
                        session.worktree_path.clone(),
                        session.repository_path.clone(),
                        session.branch.clone(),
                        agent,
                        session.initial_prompt.clone(),
                    ),
                    core.db.clone(),
                )
            };

            let (session_id, worktree_path, repo_path, current_branch, agent, initial_prompt) =
                session_info;

            log::info!(
                "Starting name generation for session '{}' with prompt: {:?}",
                session_name_clone,
                initial_prompt.as_ref().map(|p| {
                    let max_len = 50;
                    if p.len() <= max_len {
                        p.as_str()
                    } else {
                        let mut end = max_len;
                        while !p.is_char_boundary(end) && end > 0 {
                            end -= 1;
                        }
                        &p[..end]
                    }
                })
            );

            // Build env vars and CLI args as used to start the session
            let (mut env_vars, cli_args, binary_path) =
                if let Some(settings_manager) = crate::SETTINGS_MANAGER.get() {
                    let manager = settings_manager.lock().await;
                    let env_vars = manager
                        .get_agent_env_vars(&agent)
                        .into_iter()
                        .collect::<Vec<(String, String)>>();
                    let cli_args = manager.get_agent_cli_args(&agent);
                    let binary_path = manager.get_effective_binary_path(&agent).ok();
                    (env_vars, cli_args, binary_path)
                } else {
                    (vec![], String::new(), None)
                };

            // Add project-specific environment variables
            if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
                for (key, value) in project_env_vars {
                    env_vars.push((key, value));
                }
            }

            let cli_args = if cli_args.is_empty() {
                None
            } else {
                Some(cli_args)
            };

            let ctx = schaltwerk::domains::agents::naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &current_branch,
                agent_type: &agent,
                initial_prompt: initial_prompt.as_deref(),
                cli_args,
                env_vars,
                binary_path,
            };
            match schaltwerk::domains::agents::naming::generate_display_name_and_rename_branch(ctx)
                .await
            {
                Ok(Some(display_name)) => {
                    log::info!("Successfully generated display name '{display_name}' for session '{session_name_clone}'");

                    let core = match get_schaltwerk_core().await {
                        Ok(c) => c,
                        Err(e) => {
                            log::warn!("Cannot get schaltwerk_core for sessions refresh: {e}");
                            return;
                        }
                    };
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    // Invalidate cache before emitting refreshed event
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        log::info!("Emitting sessions-refreshed event after name generation");
                        if let Err(e) =
                            emit_event(&app_handle, SchaltEvent::SessionsRefreshed, &sessions)
                        {
                            log::warn!("Could not emit sessions refreshed: {e}");
                        }
                    }
                }
                Ok(None) => {
                    log::warn!("Name generation returned None for session '{session_name_clone}'");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
                Err(e) => {
                    log::error!(
                        "Failed to generate display name for session '{session_name_clone}': {e}"
                    );
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
            }
        });
    } else {
        log::info!(
            "Session '{}' was_auto_generated={}, has_prompt={}, skipping name generation",
            params.name,
            was_auto_generated,
            params.prompt.is_some()
        );
    }

    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_rename_version_group(
    app: tauri::AppHandle,
    base_name: String,
    prompt: String,
    _base_branch: Option<String>,
    version_group_id: Option<String>,
) -> Result<(), String> {
    log::info!("=== RENAME VERSION GROUP CALLED ===");
    log::info!("Base name: '{base_name}'");

    // Get all sessions with this base name pattern
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    // Find all versions of this session
    let all_sessions = manager
        .list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))?;

    // Prefer grouping by version_group_id if provided
    let version_sessions: Vec<Session> = if let Some(group_id) = &version_group_id {
        let filtered: Vec<Session> = all_sessions
            .into_iter()
            .filter(|s| s.version_group_id.as_ref() == Some(group_id))
            .collect();
        if filtered.is_empty() {
            log::warn!("No sessions found for version_group_id '{group_id}', falling back to name-based matching");
            // fallback to name-based grouping
            Vec::new()
        } else {
            filtered
        }
    } else {
        Vec::new()
    };

    let version_sessions: Vec<Session> = if version_sessions.is_empty() {
        // Fallback to name-based matching for backward compatibility
        manager
            .list_sessions()
            .map_err(|e| format!("Failed to list sessions: {e}"))?
            .into_iter()
            .filter(|s| s.name == base_name || matches_version_pattern(&s.name, &base_name))
            .collect()
    } else {
        version_sessions
    };

    if version_sessions.is_empty() {
        log::warn!("No version sessions found for base name '{base_name}'");
        return Ok(());
    }

    log::info!(
        "Found {} version sessions for base name '{base_name}'",
        version_sessions.len()
    );

    // Get the first session's details for name generation
    let first_session = &version_sessions[0];
    let db = core_lock.db.clone();
    let worktree_path = first_session.worktree_path.clone();
    let repo_path = first_session.repository_path.clone();
    let agent_type = first_session
        .original_agent_type
        .clone()
        .unwrap_or_else(|| db.get_agent_type().unwrap_or_else(|_| "claude".to_string()));

    drop(core_lock);

    // Get environment variables for the agent
    let (mut env_vars, cli_args, binary_path) = get_agent_env_and_cli_args(&agent_type);

    // Add project-specific environment variables
    if let Ok(project_env_vars) = db.get_project_environment_variables(&repo_path) {
        for (key, value) in project_env_vars {
            env_vars.push((key, value));
        }
    }

    // Generate a display name once for the entire group
    let generated_name = match schaltwerk::domains::agents::naming::generate_display_name(
        &db,
        &first_session.id,
        &worktree_path,
        &agent_type,
        Some(&prompt),
        if cli_args.is_empty() {
            None
        } else {
            Some(cli_args.as_str())
        },
        &env_vars,
        binary_path.as_deref(),
    )
    .await
    {
        Ok(Some(name)) => name,
        Ok(None) => {
            log::warn!("Name generation returned None for version group '{base_name}'");
            return Ok(());
        }
        Err(e) => {
            log::error!("Failed to generate display name for version group '{base_name}': {e}");
            return Err(format!("Failed to generate name: {e}"));
        }
    };

    log::info!("Generated name '{generated_name}' for version group '{base_name}'");

    // Now rename all versions with the new base name
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;

    let branch_prefix = db
        .get_project_branch_prefix(&repo_path)
        .unwrap_or_else(|err| {
            log::warn!("Falling back to default branch prefix while renaming sessions: {err}");
            DEFAULT_BRANCH_PREFIX.to_string()
        });

    for session in version_sessions {
        // Extract version suffix
        let version_suffix = session.name.strip_prefix(&base_name).unwrap_or("");
        let new_session_name = format!("{generated_name}{version_suffix}");
        let new_branch_name = format!("{branch_prefix}/{new_session_name}");

        log::info!(
            "Renaming session '{}' to '{new_session_name}'",
            session.name
        );

        // Update display name in database
        if let Err(e) = db.update_session_display_name(&session.id, &new_session_name) {
            log::error!(
                "Failed to update display name for session '{}': {e}",
                session.name
            );
        }

        // Rename the git branch
        if session.branch != new_branch_name {
            match schaltwerk::domains::git::branches::rename_branch(
                &repo_path,
                &session.branch,
                &new_branch_name,
            ) {
                Ok(()) => {
                    log::info!(
                        "Renamed branch from '{}' to '{new_branch_name}'",
                        session.branch
                    );

                    // Update worktree to use new branch
                    if let Err(e) = schaltwerk::domains::git::worktrees::update_worktree_branch(
                        &session.worktree_path,
                        &new_branch_name,
                    ) {
                        log::error!("Failed to update worktree for new branch: {e}");
                    }

                    // Update branch name in database
                    if let Err(e) = db.update_session_branch(&session.id, &new_branch_name) {
                        log::error!("Failed to update branch name in database: {e}");
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Could not rename branch for session '{}': {e}",
                        session.name
                    );
                }
            }
        }

        // Clear pending name generation flag
        let _ = db.set_pending_name_generation(&session.id, false);
    }

    drop(core_lock);

    // Emit sessions refreshed event
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after version group rename");
        // Using centralized event helper
        events::emit_sessions_refreshed(&app, &sessions);
    }

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions() -> Result<Vec<Session>, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_session(name: String) -> Result<Session, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_session_agent_content(
    name: String,
) -> Result<(Option<String>, Option<String>), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .get_session_task_content(&name)
        .map_err(|e| format!("Failed to get session agent content: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_cancel_session(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    log::info!("Starting cancel session: {name}");

    // Determine session state first to handle Spec vs non-Spec behavior
    let (is_spec, repo_path_str, archive_count_after_opt) = {
        let core = get_schaltwerk_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();

        let session = manager.get_session(&name).map_err(|e| {
            log::error!("Cancel {name}: Session not found: {e}");
            format!("Session not found: {e}")
        })?;

        if session.session_state == schaltwerk::domains::sessions::entity::SessionState::Spec {
            // Archive spec sessions instead of deleting
            manager
                .archive_spec_session(&name)
                .map_err(|e| format!("Failed to archive spec: {e}"))?;
            let repo = core.repo_path.to_string_lossy().to_string();
            let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
            (true, repo, Some(count))
        } else {
            // For non-spec, archive prompt first, then continue with cancellation flow
            if let Err(e) = manager.archive_prompt_for_session(&name) {
                log::warn!("Cancel {name}: Failed to archive prompt before cancel: {e}");
            }
            (false, core.repo_path.to_string_lossy().to_string(), None)
        }
    };

    if is_spec {
        // Emit events for spec archive and UI refresh, close terminals if any, then return early
        events::emit_archive_updated(&app, &repo_path_str, archive_count_after_opt.unwrap_or(0));
        // Ensure frontend selection logic runs consistently by emitting SessionRemoved for specs too
        events::emit_session_removed(&app, &name);
        if let Ok(core) = get_schaltwerk_core().await {
            let core = core.lock().await;
            let manager = core.session_manager();
            if let Ok(sessions) = manager.list_enriched_sessions() {
                events::emit_sessions_refreshed(&app, &sessions);
            }
        }

        terminals::close_session_terminals_if_any(&name).await;
        return Ok(());
    }

    // Emit a "cancelling" event instead of "removed"
    events::emit_session_cancelling(&app, &name);

    let app_for_refresh = app.clone();
    let name_for_bg = name.clone();
    tokio::spawn(async move {
        log::debug!("Cancel {name_for_bg}: Starting background work");

        // Always close terminals BEFORE removing the worktree to avoid leaving
        // shells in deleted directories (which causes getcwd errors in tools like `just`).
        if let Ok(terminal_manager) = get_terminal_manager().await {
            let ids = vec![
                format!("session-{}-top", name_for_bg),
                format!("session-{}-bottom", name_for_bg),
            ];
            for id in ids {
                if let Err(e) = terminal_manager.close_terminal(id.clone()).await {
                    log::debug!("Terminal {id} cleanup (pre-cancel): {e}");
                }
            }
        }

        let cancel_result = if let Ok(core) = get_schaltwerk_core().await {
            let core = core.lock().await;
            let manager = core.session_manager();
            // Use fast async cancellation
            manager.fast_cancel_session(&name_for_bg).await
        } else {
            Err(anyhow::anyhow!("Could not get core"))
        };

        match cancel_result {
            Ok(()) => {
                log::info!("Cancel {name_for_bg}: Successfully completed in background");

                // Now emit the actual removal event after successful cancellation
                #[derive(serde::Serialize, Clone)]
                struct SessionRemovedPayload {
                    session_name: String,
                }
                let _ = emit_event(
                    &app_for_refresh,
                    SchaltEvent::SessionRemoved,
                    &SessionRemovedPayload {
                        session_name: name_for_bg.clone(),
                    },
                );

                if let Ok(core) = get_schaltwerk_core().await {
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        events::emit_sessions_refreshed(&app_for_refresh, &sessions);
                    }
                }
            }
            Err(e) => {
                log::error!("CRITICAL: Background cancel failed for {name_for_bg}: {e}");

                #[derive(serde::Serialize, Clone)]
                struct CancelErrorPayload {
                    session_name: String,
                    error: String,
                }
                let _ = emit_event(
                    &app_for_refresh,
                    SchaltEvent::CancelError,
                    &CancelErrorPayload {
                        session_name: name_for_bg.clone(),
                        error: e.to_string(),
                    },
                );

                if let Ok(core) = get_schaltwerk_core().await {
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        events::emit_sessions_refreshed(&app_for_refresh, &sessions);
                    }
                }
            }
        }

        // Terminals were already closed above; nothing more to do here.

        log::info!("Cancel {name_for_bg}: All background work completed");
    });

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_convert_session_to_draft(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    log::info!("Converting session to spec: {name}");

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    // Close associated terminals BEFORE removing the worktree to avoid leaving shells
    // pointing at a deleted directory (which triggers getcwd errors).
    terminals::close_session_terminals_if_any(&name).await;

    match manager.convert_session_to_draft(&name) {
        Ok(()) => {
            log::info!("Successfully converted session to spec: {name}");

            // Close associated terminals
            terminals::close_session_terminals_if_any(&name).await;

            // Clean up any orphaned worktrees after conversion
            // This handles cases where worktree removal failed during conversion
            // We do this synchronously but with error handling to ensure it doesn't fail the conversion
            if let Err(e) = manager.cleanup_orphaned_worktrees() {
                log::warn!("Worktree cleanup after conversion failed (non-fatal): {e}");
            } else {
                log::info!(
                    "Successfully cleaned up orphaned worktrees after converting session to spec"
                );
            }

            // Emit event to notify frontend of the change
            if let Ok(sessions) = manager.list_enriched_sessions() {
                log::info!("Emitting sessions-refreshed event after converting session to spec");
                events::emit_sessions_refreshed(&app, &sessions);
            }

            Ok(())
        }
        Err(e) => {
            log::error!("Failed to convert session '{name}' to spec: {e}");
            Err(format!("Failed to convert session '{name}' to spec: {e}"))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_update_git_stats(session_id: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .update_git_stats(&session_id)
        .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude(
    app: tauri::AppHandle,
    session_name: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    schaltwerk_core_start_claude_with_restart(app, session_name, false, cols, rows).await
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude_with_restart(
    app: tauri::AppHandle,
    session_name: String,
    force_restart: bool,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    log::info!("Starting Claude for session: {session_name}");

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    // Resolve binary paths at command level (with caching)
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();

        // Get resolved binary paths for all agents
        for agent in ["claude", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                }
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };

    let command = manager
        .start_claude_in_session_with_restart_and_binary(
            &session_name,
            force_restart,
            &binary_paths,
        )
        .map_err(|e| {
            log::error!("Failed to build Claude command for session {session_name}: {e}");
            format!("Failed to start Claude in session: {e}")
        })?;

    log::info!("Claude command for session {session_name}: {command}");

    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;

    // Check if we have permission to access the working directory
    log::info!("Checking permissions for working directory: {cwd}");
    terminals::ensure_cwd_access(&cwd)?;
    log::info!("Working directory access confirmed: {cwd}");

    // Sanitize session name to match frontend's terminal ID generation
    let terminal_id = terminals::terminal_id_for_session_top(&session_name);
    let terminal_manager = get_terminal_manager().await?;

    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }

    let agent_kind = agent_ctx::infer_agent_kind(&agent_name);
    let (env_vars, cli_args) =
        agent_ctx::collect_agent_env_and_cli(&agent_kind, &core.repo_path, &core.db).await;
    log::info!("Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'", env_vars.len());

    // If a project setup script exists, run it ONCE inside this terminal before exec'ing the agent.
    // This streams all setup output to the agent terminal and avoids blocking session creation.
    // We gate with a marker file in the worktree: .schaltwerk/setup.done
    let mut use_shell_chain = false;
    let mut shell_cmd: Option<String> = None;
    let marker_rel = ".schaltwerk/setup.done";
    if let Ok(Some(setup)) = core.db.get_project_setup_script(&core.repo_path) {
        if !setup.trim().is_empty() {
            // Persist setup script to a temp file for reliable execution
            let temp_dir = std::env::temp_dir();
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let script_path = temp_dir.join(format!("schalt_setup_{session_name}_{ts}.sh"));
            if let Err(e) = std::fs::write(&script_path, setup) {
                log::warn!("Failed to write setup script to temp file: {e}");
            } else {
                // Build: set -e; if [ ! -f marker ]; then sh '<tmp>'; rm -f '<tmp>'; mkdir -p .schaltwerk; touch marker; fi; exec <agent> <args...>
                let marker_q = sh_quote_string(marker_rel);
                let script_q = sh_quote_string(&script_path.display().to_string());
                let mut exec_cmd = String::new();
                exec_cmd.push_str(&sh_quote_string(&agent_name));
                for a in &agent_args {
                    exec_cmd.push(' ');
                    exec_cmd.push_str(&sh_quote_string(a));
                }
                let chained = format!(
                        "set -e; if [ ! -f {marker_q} ]; then sh {script_q}; rm -f {script_q}; mkdir -p .schaltwerk; : > {marker_q}; fi; exec {exec_cmd}"
                    );
                shell_cmd = Some(chained);
                use_shell_chain = true;
            }
        }
    }

    // Build final args using centralized logic (handles Codex ordering/normalization)
    let final_args = agent_ctx::build_final_args(&agent_kind, agent_args.clone(), &cli_args);

    // Codex prompt ordering is now handled in the CLI args section above

    // Log the exact command that will be executed
    let kind_str = match agent_kind {
        agent_ctx::AgentKind::Claude => "claude",
        agent_ctx::AgentKind::Codex => "codex",
        agent_ctx::AgentKind::OpenCode => "opencode",
        agent_ctx::AgentKind::Gemini => "gemini",
        agent_ctx::AgentKind::Fallback => "claude",
    };
    log::info!(
        "FINAL COMMAND CONSTRUCTION for {kind_str}: command='{agent_name}', args={final_args:?}"
    );

    // Create terminal with initial size if provided
    if use_shell_chain {
        let sh_cmd = "sh".to_string();
        let mut sh_args: Vec<String> = vec!["-lc".to_string(), shell_cmd.unwrap()];
        if let (Some(c), Some(r)) = (cols, rows) {
            use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
            terminal_manager
                .create_terminal_with_app_and_size(CreateTerminalWithAppAndSizeParams {
                    id: terminal_id.clone(),
                    cwd,
                    command: sh_cmd,
                    args: std::mem::take(&mut sh_args),
                    env: env_vars,
                    cols: c,
                    rows: r,
                })
                .await?;
        } else {
            terminal_manager
                .create_terminal_with_app(terminal_id.clone(), cwd, sh_cmd, sh_args, env_vars)
                .await?;
        }
    } else {
        match (cols, rows) {
            (Some(c), Some(r)) => {
                use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
                terminal_manager
                    .create_terminal_with_app_and_size(CreateTerminalWithAppAndSizeParams {
                        id: terminal_id.clone(),
                        cwd,
                        command: agent_name.clone(),
                        args: final_args,
                        env: env_vars.clone(),
                        cols: c,
                        rows: r,
                    })
                    .await?;
            }
            _ => {
                terminal_manager
                    .create_terminal_with_app(
                        terminal_id.clone(),
                        cwd,
                        agent_name.clone(),
                        final_args,
                        env_vars,
                    )
                    .await?;
            }
        }
    }

    // For OpenCode and other TUI applications, the frontend will handle
    // proper sizing based on the actual terminal container dimensions.
    // No hardcoded resize is needed anymore as we now support dynamic sizing.

    // For Gemini, we rely on the CLI's own interactive prompt flag.
    // Do not implement non-deterministic paste-based workarounds.

    log::info!("Successfully started Claude in terminal: {terminal_id}");

    // Emit event to mark terminal as started globally
    #[derive(serde::Serialize, Clone)]
    struct ClaudeStartedPayload {
        terminal_id: String,
        session_name: String,
    }

    let payload = ClaudeStartedPayload {
        terminal_id: terminal_id.clone(),
        session_name: session_name.clone(),
    };

    if let Err(e) = emit_event(&app, SchaltEvent::ClaudeStarted, &payload) {
        log::warn!("Failed to emit claude-started event: {e}");
    }

    Ok(command)
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude_orchestrator(
    terminal_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    log::info!("Starting Claude for orchestrator in terminal: {terminal_id}");

    // First check if we have a valid project initialized
    let core = match get_schaltwerk_core().await {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get schaltwerk_core for orchestrator: {e}");
            // If we can't get a schaltwerk_core (no project), create a user-friendly error
            if e.contains("No active project") {
                return Err("No project is currently open. Please open a project folder first before starting the orchestrator.".to_string());
            }
            return Err(format!("Failed to initialize orchestrator: {e}"));
        }
    };
    let core = core.lock().await;
    let manager = core.session_manager();

    // Resolve binary paths at command level (with caching)
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();

        // Get resolved binary paths for all agents
        for agent in ["claude", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                }
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };

    let command = manager
        .start_claude_in_orchestrator_with_binary(&binary_paths)
        .map_err(|e| {
            log::error!("Failed to build orchestrator command: {e}");
            format!("Failed to start Claude in orchestrator: {e}")
        })?;

    log::info!("Claude command for orchestrator: {command}");
    let result = agent_launcher::launch_in_terminal(
        terminal_id.clone(),
        command.clone(),
        &core.db,
        &core.repo_path,
        cols,
        rows,
    )
    .await?;
    Ok(result)
}

#[tauri::command]
pub async fn schaltwerk_core_set_skip_permissions(enabled: bool) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .set_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_skip_permissions() -> Result<bool, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_orchestrator_skip_permissions(
    enabled: bool,
) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .set_orchestrator_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set orchestrator skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_orchestrator_skip_permissions() -> Result<bool, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .get_orchestrator_skip_permissions()
        .map_err(|e| format!("Failed to get orchestrator skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_session_agent_type(
    session_name: String,
    agent_type: String,
) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    // Update global agent type
    core.db
        .set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set global agent type: {e}"))?;

    // Get the session to find its ID
    let session = core
        .db
        .get_session_by_name(&core.repo_path, &session_name)
        .map_err(|e| format!("Failed to find session {session_name}: {e}"))?;

    // Get current skip permissions setting
    let skip_permissions = core
        .db
        .get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))?;

    // Update session's original settings to use the new agent type
    core.db
        .set_session_original_settings(&session.id, &agent_type, skip_permissions)
        .map_err(|e| format!("Failed to update session agent type: {e}"))?;

    log::info!(
        "Updated agent type to '{}' for session '{}' (id: {})",
        agent_type,
        session_name,
        session.id
    );

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_agent_type() -> Result<String, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .get_agent_type()
        .map_err(|e| format!("Failed to get agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_orchestrator_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .set_orchestrator_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set orchestrator agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_orchestrator_agent_type() -> Result<String, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .get_orchestrator_agent_type()
        .map_err(|e| format!("Failed to get orchestrator agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_font_sizes() -> Result<(i32, i32), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .get_font_sizes()
        .map_err(|e| format!("Failed to get font sizes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_font_sizes(
    terminal_font_size: i32,
    ui_font_size: i32,
) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;

    core.db
        .set_font_sizes(terminal_font_size, ui_font_size)
        .map_err(|e| format!("Failed to set font sizes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_mark_session_ready(
    app: tauri::AppHandle,
    name: String,
    auto_commit: bool,
) -> Result<bool, String> {
    log::info!("Marking session {name} as reviewed (auto_commit: {auto_commit})");

    // If auto_commit is false, check global auto-commit setting
    let effective_auto_commit = if auto_commit {
        true
    } else {
        // Check global auto-commit setting
        let settings_manager = crate::SETTINGS_MANAGER
            .get()
            .ok_or_else(|| "Settings manager not initialized".to_string())?;
        let manager = settings_manager.lock().await;
        manager.get_auto_commit_on_review()
    };

    log::info!("Effective auto_commit setting: {effective_auto_commit}");

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    let result = manager
        .mark_session_ready(&name, effective_auto_commit)
        .map_err(|e| format!("Failed to mark session as reviewed: {e}"))?;

    // Emit event to notify frontend of the change
    // Invalidate cache before emitting refreshed event
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after marking session ready");
        events::emit_sessions_refreshed(&app, &sessions);
    }

    Ok(result)
}

#[tauri::command]
pub async fn schaltwerk_core_has_uncommitted_changes(name: String) -> Result<bool, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    let session = manager
        .get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))?;

    schaltwerk::domains::git::has_uncommitted_changes(&session.worktree_path)
        .map_err(|e| format!("Failed to check uncommitted changes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_unmark_session_ready(
    app: tauri::AppHandle,
    name: String,
) -> Result<(), String> {
    log::info!("Unmarking session {name} as reviewed");

    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    manager
        .unmark_session_ready(&name)
        .map_err(|e| format!("Failed to unmark session as reviewed: {e}"))?;

    // Emit event to notify frontend of the change
    // Invalidate cache before emitting refreshed event
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after unmarking session ready");
        events::emit_sessions_refreshed(&app, &sessions);
    }

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_create_spec_session(
    app: tauri::AppHandle,
    name: String,
    spec_content: String,
    agent_type: Option<String>,
    skip_permissions: Option<bool>,
) -> Result<Session, String> {
    log::info!("Creating spec session: {name} with agent_type={agent_type:?}");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    let session = manager
        .create_spec_session_with_agent(
            &name,
            &spec_content,
            agent_type.as_deref(),
            skip_permissions,
        )
        .map_err(|e| format!("Failed to create spec session: {e}"))?;

    // Store session details for name generation
    let session_id = session.id.clone();
    let session_name = session.name.clone();
    let has_agent_type = agent_type.is_some();
    let has_content = !spec_content.trim().is_empty();
    let should_generate_name =
        has_agent_type && has_content && !is_versioned_session_name(&session_name);

    // Emit event with actual sessions list
    // Invalidate cache before emitting refreshed event
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after creating spec session");
        events::emit_sessions_refreshed(&app, &sessions);
    }

    // Drop the lock before spawning async task
    drop(core_lock);

    // Trigger name generation for specs created with agent type
    if should_generate_name {
        log::info!(
            "Spec session '{session_name}' created with agent type, spawning name generation"
        );
        let app_handle = app.clone();
        let agent_type_clone = agent_type.clone();
        let spec_content_clone = spec_content.clone();

        tokio::spawn(async move {
            // Get fresh session data
            let (repo_path, worktree_path, branch, db_clone) = {
                let core = match get_schaltwerk_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("Cannot get schaltwerk_core for spec name generation: {e}");
                        return;
                    }
                };
                let core = core.lock().await;
                let manager = core.session_manager();
                let session = match manager.get_session(&session_name) {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!("Cannot load spec session '{session_name}' for naming: {e}");
                        return;
                    }
                };

                (
                    session.repository_path.clone(),
                    session.worktree_path.clone(),
                    session.branch.clone(),
                    core.db.clone(),
                )
            };

            let agent = agent_type_clone.unwrap_or_else(|| "claude".to_string());
            let (mut env_vars, cli_args, binary_path) = get_agent_env_and_cli_args(&agent);

            if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
                for (key, value) in project_env_vars {
                    env_vars.push((key, value));
                }
            }

            log::info!("Starting name generation for spec session '{session_name}' with agent '{agent}'...");

            // Generate display name - use spec_content as the prompt
            let ctx = naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &branch,
                agent_type: &agent,
                initial_prompt: Some(&spec_content_clone), // Pass spec content as initial_prompt for name generation
                cli_args: if cli_args.is_empty() {
                    None
                } else {
                    Some(cli_args)
                },
                env_vars,
                binary_path,
            };

            match naming::generate_display_name_and_rename_branch(ctx).await {
                Ok(Some(display_name)) => {
                    log::info!(
                        "Generated display name '{display_name}' for spec session '{session_name}'"
                    );

                    // Update the display name in database
                    if let Err(e) = db_clone.update_session_display_name(&session_id, &display_name)
                    {
                        log::warn!(
                            "Failed to update display name for spec session '{session_name}': {e}"
                        );
                    } else {
                        // Clear the pending flag
                        let _ = db_clone.set_pending_name_generation(&session_id, false);

                        // Emit refresh event
                        let core = match get_schaltwerk_core().await {
                            Ok(c) => c,
                            Err(e) => {
                                log::warn!("Cannot get schaltwerk_core after spec renaming: {e}");
                                return;
                            }
                        };
                        let core = core.lock().await;
                        let manager = core.session_manager();
                        if let Ok(sessions) = manager.list_enriched_sessions() {
                            log::info!("Emitting sessions-refreshed after spec renaming");
                            if let Err(e) =
                                emit_event(&app_handle, SchaltEvent::SessionsRefreshed, &sessions)
                            {
                                log::warn!(
                                    "Could not emit sessions refreshed after spec renaming: {e}"
                                );
                            }
                        }
                    }
                }
                Ok(None) => {
                    log::info!("No display name generated for spec session '{session_name}'");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
                Err(e) => {
                    log::warn!(
                        "Failed to generate display name for spec session '{session_name}': {e}"
                    );
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
            }
        });
    }

    Ok(session)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schaltwerk_core_create_and_start_spec_session(
    app: tauri::AppHandle,
    name: String,
    spec_content: String,
    base_branch: Option<String>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    agent_type: Option<String>,
    skip_permissions: Option<bool>,
) -> Result<(), String> {
    log::info!("Creating and starting spec session: {name}");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .create_and_start_spec_session_with_config(
            &name,
            &spec_content,
            base_branch.as_deref(),
            version_group_id.as_deref(),
            version_number,
            agent_type.as_deref(),
            skip_permissions,
        )
        .map_err(|e| format!("Failed to create and start spec session: {e}"))?;

    // Emit event with actual sessions list
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after creating and starting spec session");
        events::emit_sessions_refreshed(&app, &sessions);
    }

    // Drop the lock
    drop(core_lock);

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_start_spec_session(
    app: tauri::AppHandle,
    name: String,
    base_branch: Option<String>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    agent_type: Option<String>,
    skip_permissions: Option<bool>,
) -> Result<(), String> {
    log::info!("Starting spec session: {name}");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .start_spec_session_with_config(
            &name,
            base_branch.as_deref(),
            version_group_id.as_deref(),
            version_number,
            agent_type.as_deref(),
            skip_permissions,
        )
        .map_err(|e| format!("Failed to start spec session: {e}"))?;

    // Emit selection event for consistent focus on the started session
    events::emit_selection_running(&app, &name);

    // Invalidate cache before emitting refreshed event
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after starting spec session");
        events::emit_sessions_refreshed(&app, &sessions);
    }

    // Check if AI renaming should be triggered for spec-derived sessions
    // First, get the session info to check if it has auto-generation potential
    let session = match manager.get_session(&name) {
        Ok(s) => s,
        Err(_) => {
            drop(core_lock);
            return Ok(());
        }
    };

    // Check if the session has content that could enable AI renaming
    // Skip if display name already exists (generated when spec was created)
    let has_display_name = session.display_name.is_some();
    if has_display_name {
        log::info!("Spec session '{name}' already has display name, skipping regeneration");
        drop(core_lock);
        return Ok(());
    }

    // For spec sessions, the content is in spec_content field, not initial_prompt
    let has_prompt_content = session
        .initial_prompt
        .as_ref()
        .map(|p| !p.trim().is_empty())
        .unwrap_or(false);
    let has_spec_content = session
        .spec_content
        .as_ref()
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    let should_trigger_renaming = has_prompt_content || has_spec_content;

    if should_trigger_renaming && !is_versioned_session_name(&name) {
        log::info!("Spec session '{name}' has content (prompt or spec), enabling AI renaming");

        // Set the pending_name_generation flag to enable AI renaming
        let db = core_lock.db.clone();
        if let Err(e) = db.set_pending_name_generation(&session.id, true) {
            log::warn!("Failed to set pending_name_generation for spec session '{name}': {e}");
        }
    }

    // Drop the lock
    drop(core_lock);

    // Trigger AI renaming for spec-started sessions with meaningful content
    if should_trigger_renaming && !is_versioned_session_name(&name) && !has_display_name {
        log::info!("Spec session '{name}' converted to running, spawning name generation agent");
        let session_name_clone = name.clone();
        let app_handle = app.clone();

        tokio::spawn(async move {
            let (session_info, db_clone) = {
                let core = match get_schaltwerk_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!(
                            "Cannot get schaltwerk_core for session '{session_name_clone}': {e}"
                        );
                        return;
                    }
                };
                let core = core.lock().await;
                let manager = core.session_manager();
                let session = match manager.get_session(&session_name_clone) {
                    Ok(s) => s,
                    Err(e) => {
                        log::warn!("Cannot load session '{session_name_clone}' for naming: {e}");
                        return;
                    }
                };
                log::info!(
                    "Session '{}' loaded: pending_name_generation={}, original_agent_type={:?}",
                    session_name_clone,
                    session.pending_name_generation,
                    session.original_agent_type
                );

                if !session.pending_name_generation {
                    log::info!("Session '{session_name_clone}' does not have pending_name_generation flag, skipping");
                    return;
                }
                let agent = session.original_agent_type.clone().unwrap_or_else(|| {
                    core.db
                        .get_agent_type()
                        .unwrap_or_else(|_| "claude".to_string())
                });

                log::info!("Using agent '{agent}' for name generation of spec-started session '{session_name_clone}'");

                // Use initial_prompt if available, otherwise use spec_content
                let prompt_content = session
                    .initial_prompt
                    .clone()
                    .or_else(|| session.spec_content.clone());

                (
                    (
                        session.id.clone(),
                        session.worktree_path.clone(),
                        session.repository_path.clone(),
                        session.branch.clone(),
                        agent,
                        prompt_content,
                    ),
                    core.db.clone(),
                )
            };

            let (session_id, worktree_path, repo_path, current_branch, agent, initial_prompt) =
                session_info;

            log::info!(
                "Starting name generation for spec-started session '{}' with prompt: {:?}",
                session_name_clone,
                initial_prompt.as_ref().map(|p| {
                    let max_len = 50;
                    if p.len() <= max_len {
                        p.as_str()
                    } else {
                        let mut end = max_len;
                        while !p.is_char_boundary(end) && end > 0 {
                            end -= 1;
                        }
                        &p[..end]
                    }
                })
            );

            // Build env vars and CLI args as used to start the session
            let (mut env_vars, cli_args, binary_path) =
                if let Some(settings_manager) = crate::SETTINGS_MANAGER.get() {
                    let manager = settings_manager.lock().await;
                    let env_vars = manager
                        .get_agent_env_vars(&agent)
                        .into_iter()
                        .collect::<Vec<(String, String)>>();
                    let cli_args = manager.get_agent_cli_args(&agent);
                    let binary_path = manager.get_effective_binary_path(&agent).ok();
                    (env_vars, cli_args, binary_path)
                } else {
                    (vec![], String::new(), None)
                };

            // Add project-specific environment variables
            if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
                for (key, value) in project_env_vars {
                    env_vars.push((key, value));
                }
            }

            let cli_args = if cli_args.is_empty() {
                None
            } else {
                Some(cli_args)
            };

            let ctx = schaltwerk::domains::agents::naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &current_branch,
                agent_type: &agent,
                initial_prompt: initial_prompt.as_deref(),
                cli_args,
                env_vars,
                binary_path,
            };
            match schaltwerk::domains::agents::naming::generate_display_name_and_rename_branch(ctx)
                .await
            {
                Ok(Some(display_name)) => {
                    log::info!("Successfully generated display name '{display_name}' for spec-started session '{session_name_clone}'");

                    let core = match get_schaltwerk_core().await {
                        Ok(c) => c,
                        Err(e) => {
                            log::warn!("Cannot get schaltwerk_core for sessions refresh: {e}");
                            return;
                        }
                    };
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    // Invalidate cache before emitting refreshed event
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        log::info!(
                            "Emitting sessions-refreshed event after spec-session name generation"
                        );
                        if let Err(e) =
                            emit_event(&app_handle, SchaltEvent::SessionsRefreshed, &sessions)
                        {
                            log::warn!("Could not emit sessions refreshed: {e}");
                        }
                    }
                }
                Ok(None) => {
                    log::warn!("Name generation returned None for spec-started session '{session_name_clone}'");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
                Err(e) => {
                    log::error!("Failed to generate display name for spec-started session '{session_name_clone}': {e}");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_update_session_state(
    name: String,
    state: String,
) -> Result<(), String> {
    log::info!("Updating session state: {name} -> {state}");

    let session_state = state
        .parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .update_session_state(&name, session_state)
        .map_err(|e| format!("Failed to update session state: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_update_spec_content(
    _app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
    log::info!("Updating spec content for session: {name}");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .update_spec_content(&name, &content)
        .map_err(|e| format!("Failed to update spec content: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_rename_draft_session(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    log::info!("Renaming spec session from '{old_name}' to '{new_name}'");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .rename_draft_session(&old_name, &new_name)
        .map_err(|e| format!("Failed to rename spec session: {e}"))?;

    // Emit sessions-refreshed event to update UI
    if let Ok(sessions) = manager.list_enriched_sessions() {
        events::emit_sessions_refreshed(&app, &sessions);
    }

    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_append_spec_content(
    name: String,
    content: String,
) -> Result<(), String> {
    log::info!("Appending to spec content for session: {name}");

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .append_spec_content(&name, &content)
        .map_err(|e| format!("Failed to append spec content: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions_by_state(state: String) -> Result<Vec<Session>, String> {
    log::info!("Listing sessions by state: {state}");

    let session_state = state
        .parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;

    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();

    manager
        .list_sessions_by_state(session_state)
        .map_err(|e| format!("Failed to list sessions by state: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_reset_orchestrator(terminal_id: String) -> Result<String, String> {
    log::info!("Resetting orchestrator for terminal: {terminal_id}");

    // Close the current terminal first
    let manager = get_terminal_manager().await?;
    if let Err(e) = manager.close_terminal(terminal_id.clone()).await {
        log::warn!("Failed to close terminal {terminal_id}: {e}");
        // Continue anyway, terminal might already be closed
    }

    // Start a FRESH orchestrator session (bypassing session discovery)
    schaltwerk_core_start_fresh_orchestrator(terminal_id).await
}

#[tauri::command]
pub async fn schaltwerk_core_start_fresh_orchestrator(
    terminal_id: String,
) -> Result<String, String> {
    log::info!("Starting FRESH Claude for orchestrator in terminal: {terminal_id}");

    // First check if we have a valid project initialized
    let core = match get_schaltwerk_core().await {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get schaltwerk_core for fresh orchestrator: {e}");
            // If we can't get a schaltwerk_core (no project), create a user-friendly error
            if e.contains("No active project") {
                return Err("No project is currently open. Please open a project folder first before starting the orchestrator.".to_string());
            }
            return Err(format!("Failed to initialize orchestrator: {e}"));
        }
    };
    let core = core.lock().await;
    let manager = core.session_manager();

    // Resolve binary paths at command level (with caching)
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();

        // Get resolved binary paths for all agents
        for agent in ["claude", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                }
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };

    // Build command for FRESH session (no session resume)
    let command = manager
        .start_claude_in_orchestrator_fresh_with_binary(&binary_paths)
        .map_err(|e| {
            log::error!("Failed to build fresh orchestrator command: {e}");
            format!("Failed to start fresh Claude in orchestrator: {e}")
        })?;

    log::info!("Fresh Claude command for orchestrator: {command}");

    // Delegate to shared launcher (no initial size for fresh)
    let result = agent_launcher::launch_in_terminal(
        terminal_id.clone(),
        command.clone(),
        &core.db,
        &core.repo_path,
        None,
        None,
    )
    .await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codex_flag_normalization_integration() {
        // Test the full pipeline as used in actual code
        let cli_args = "-model gpt-4 -p work -m claude";
        let mut args = shell_words::split(cli_args).unwrap();

        crate::commands::schaltwerk_core::schaltwerk_core_cli::fix_codex_single_dash_long_flags(
            &mut args,
        );
        crate::commands::schaltwerk_core::schaltwerk_core_cli::reorder_codex_model_after_profile(
            &mut args,
        );

        // After normalization:
        // 1. -model should become --model
        // 2. -p should stay as -p (short flag)
        // 3. -m should stay as -m (short flag)
        // 4. Profile flags should come before model flags

        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"-m".to_string()));

        let p_idx = args.iter().position(|x| x == "-p").unwrap();
        let model_idx = args.iter().position(|x| x == "--model").unwrap();
        let m_idx = args.iter().position(|x| x == "-m").unwrap();

        assert!(p_idx < model_idx);
        assert!(p_idx < m_idx);
    }

    #[test]
    fn test_sh_quote_string_basic() {
        assert_eq!(sh_quote_string(""), "''");
        assert_eq!(sh_quote_string("abc"), "'abc'");
        assert_eq!(sh_quote_string("a'b"), "'a'\\''b'");
        assert_eq!(sh_quote_string("a b"), "'a b'");
        assert!(sh_quote_string("--flag").starts_with("'--flag'"));
    }
}

// Internal implementation used by both the Tauri command and unit tests
pub async fn reset_session_worktree_impl(
    app: Option<tauri::AppHandle>,
    session_name: String,
) -> Result<(), String> {
    log::info!("Resetting session worktree to base for: {session_name}");
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();

    // Delegate to SessionManager (defensive checks live there)
    manager
        .reset_session_worktree(&session_name)
        .map_err(|e| format!("Failed to reset worktree: {e}"))?;

    // Emit sessions refreshed so UI updates its diffs/state when AppHandle is available
    if let Some(app_handle) = app {
        if let Ok(sessions) = manager.list_enriched_sessions() {
            events::emit_sessions_refreshed(&app_handle, &sessions);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_reset_session_worktree(
    app: tauri::AppHandle,
    session_name: String,
) -> Result<(), String> {
    reset_session_worktree_impl(Some(app), session_name).await
}

#[tauri::command]
pub async fn schaltwerk_core_discard_file_in_session(
    session_name: String,
    file_path: String,
) -> Result<(), String> {
    log::info!("Discarding file changes in session '{session_name}' for path: {file_path}");
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager
        .discard_file_in_session(&session_name, &file_path)
        .map_err(|e| format!("Failed to discard file changes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_discard_file_in_orchestrator(file_path: String) -> Result<(), String> {
    log::info!("Discarding file changes in orchestrator for path: {file_path}");
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    // Operate directly on the main repo workdir
    let repo_path = std::path::Path::new(&core.repo_path).to_path_buf();

    // Safety: disallow .schaltwerk paths
    if file_path.starts_with(".schaltwerk/") {
        return Err("Refusing to discard changes under .schaltwerk".to_string());
    }

    schaltwerk::domains::git::worktrees::discard_path_in_worktree(
        &repo_path,
        std::path::Path::new(&file_path),
    )
    .map_err(|e| format!("Failed to discard file changes: {e}"))
}

#[cfg(test)]
mod reset_tests {
    use super::*;

    #[tokio::test]
    async fn test_reset_session_worktree_requires_project() {
        // Without a project initialized, expect a readable error
        let result = reset_session_worktree_impl(None, "nope".to_string()).await;
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(
            msg.contains("No active project")
                || msg.contains("Failed to get schaltwerk core")
                || msg.contains("No project is currently open")
        );
    }
}

use schaltwerk::schaltwerk_core::types::{SessionState, EnrichedSession, Session, SortMode, FilterMode};
use schaltwerk::domains::sessions::db_sessions::SessionMethods;
use schaltwerk::schaltwerk_core::db_app_config::AppConfigMethods;
use schaltwerk::schaltwerk_core::db_project_config::ProjectConfigMethods;
use crate::{get_schaltwerk_core, get_terminal_manager, SETTINGS_MANAGER, parse_agent_command};
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};

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
        suffix.chars().all(|c| c.is_numeric())
    } else {
        false
    }
}

fn get_agent_env_and_cli_args(agent_type: &str) -> (Vec<(String, String)>, String) {
    if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = futures::executor::block_on(settings_manager.lock());
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    }
}

// Normalize user-provided CLI text copied from rich sources:
// - Replace Unicode dash-like characters with ASCII '-'
// - Replace various Unicode spaces (including NBSP) with ASCII ' '
fn normalize_cli_text(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            // Dashes
            '\u{2010}' /* HYPHEN */
            | '\u{2011}' /* NON-BREAKING HYPHEN */
            | '\u{2012}' /* FIGURE DASH */
            | '\u{2013}' /* EN DASH */
            | '\u{2014}' /* EM DASH */
            | '\u{2015}' /* HORIZONTAL BAR */
            | '\u{2212}' /* MINUS SIGN */ => '-',
            // Spaces
            '\u{00A0}' /* NBSP */
            | '\u{2000}'..='\u{200B}' /* En/Em/Thin spaces incl. ZWSP */
            | '\u{202F}' /* NNBSP */
            | '\u{205F}' /* MMSP */
            | '\u{3000}' /* IDEOGRAPHIC SPACE */ => ' ',
            _ => c,
        })
        .collect()
}

// For Codex, detect and extract a trailing prompt without
// accidentally consuming flag values (e.g., sandbox mode).
// Returns Some(prompt) if a prompt was extracted, otherwise None.
fn extract_codex_prompt_if_present(args: &mut Vec<String>) -> Option<String> {
    if args.is_empty() { return None; }
    // If last token is a flag itself, it's not a prompt
    if args.last().map(|s| s.starts_with('-')).unwrap_or(false) {
        return None;
    }
    // If the previous token is a flag that takes a value, the last token is that value,
    // not a prompt. Keep this list minimal but sufficient for our usage.
    if args.len() >= 2 {
        let prev = args[args.len() - 2].as_str();
        let flags_consuming_next = [
            "--sandbox",
            "--model", "-m",
            "--profile", "-p",
        ];
        if flags_consuming_next.contains(&prev) {
            return None;
        }
    }
    args.pop()
}

// Turn accidental single-dash long options into proper double-dash for Codex
// Only affects known long flags: model, profile. Keeps true short flags intact.
fn fix_codex_single_dash_long_flags(args: &mut [String]) {
    for a in args.iter_mut() {
        if a.starts_with("--") { continue; }
        if let Some(stripped) = a.strip_prefix('-') {
            // Keep short flags like -m, -p, -v
            if stripped.len() == 1 { continue; }
            // Check name part (before optional '=')
            let (name, value_opt) = match stripped.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (stripped, None),
            };
            if name == "model" || name == "profile" {
                if let Some(v) = value_opt {
                    *a = format!("--{name}={v}");
                } else {
                    *a = format!("--{name}");
                }
            }
        }
    }
}
// For Codex, ensure `--model`/`-m` appears after any `--profile`
fn reorder_codex_model_after_profile(args: &mut Vec<String>) {
    let mut without_model = Vec::with_capacity(args.len());
    let mut model_flags = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--model" || a == "-m" {
            // capture flag and its value if present
            model_flags.push(a.clone());
            if i + 1 < args.len() {
                model_flags.push(args[i + 1].clone());
                i += 2;
            } else {
                i += 1;
            }
        } else if a.starts_with("--model=") || a.starts_with("-m=") {
            model_flags.push(a.clone());
            i += 1;
        } else {
            without_model.push(a.clone());
            i += 1;
        }
    }
    without_model.extend(model_flags);
    *args = without_model;
}

#[cfg(test)]
mod codex_prompt_tests {
    use super::extract_codex_prompt_if_present;

    #[test]
    fn codex_no_prompt_when_just_sandbox_pair() {
        let mut args = vec!["--sandbox".to_string(), "workspace-write".to_string()];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write"]);
    }

    #[test]
    fn codex_extracts_prompt_when_present() {
        let mut args = vec!["--sandbox".to_string(), "workspace-write".to_string(), "do things".to_string()];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert_eq!(extracted.as_deref(), Some("do things"));
        assert_eq!(args, vec!["--sandbox", "workspace-write"]);
    }

    #[test]
    fn codex_does_not_consume_model_value_as_prompt() {
        let mut args = vec!["--sandbox".to_string(), "workspace-write".to_string(), "--model".to_string(), "o3".to_string()];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write", "--model", "o3"]);
    }

    #[test]
    fn codex_does_not_consume_profile_value_as_prompt() {
        let mut args = vec!["--sandbox".to_string(), "workspace-write".to_string(), "-p".to_string(), "dev".to_string()];
        let extracted = extract_codex_prompt_if_present(&mut args);
        assert!(extracted.is_none());
        assert_eq!(args, vec!["--sandbox", "workspace-write", "-p", "dev"]);
    }
}
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
        },
        Err(e) => {
            log::error!("Failed to list enriched sessions: {e}");
            Err(format!("Failed to get sessions: {e}"))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_archive_spec_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager.archive_spec_session(&name).map_err(|e| format!("Failed to archive spec: {e}"))?;

    // Emit events to refresh UI
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    let _ = emit_event(&app, SchaltEvent::ArchiveUpdated, &serde_json::json!({"repo": repo, "count": count}));
    let _ = emit_event(&app, SchaltEvent::SessionsRefreshed, &Vec::<EnrichedSession>::new());
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_archived_specs() -> Result<Vec<schaltwerk::schaltwerk_core::types::ArchivedSpec>, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager.list_archived_specs().map_err(|e| format!("Failed to list archived specs: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_restore_archived_spec(app: tauri::AppHandle, id: String, new_name: Option<String>) -> Result<schaltwerk::schaltwerk_core::types::Session, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    let session = manager
        .restore_archived_spec(&id, new_name.as_deref())
        .map_err(|e| format!("Failed to restore archived spec: {e}"))?;

    // Notify UI
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    let _ = emit_event(&app, SchaltEvent::ArchiveUpdated, &serde_json::json!({"repo": repo, "count": count}));
    let _ = emit_event(&app, SchaltEvent::SessionsRefreshed, &Vec::<EnrichedSession>::new());
    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_delete_archived_spec(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager.delete_archived_spec(&id).map_err(|e| format!("Failed to delete archived spec: {e}"))?;
    let repo = core.repo_path.to_string_lossy().to_string();
    let count = manager.list_archived_specs().map(|v| v.len()).unwrap_or(0);
    let _ = emit_event(&app, SchaltEvent::ArchiveUpdated, &serde_json::json!({"repo": repo, "count": count}));
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_archive_max_entries() -> Result<i32, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager.get_archive_max_entries().map_err(|e| format!("Failed to get archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_archive_max_entries(limit: i32) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    manager.set_archive_max_entries(limit).map_err(|e| format!("Failed to set archive limit: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_enriched_sessions_sorted(
    sort_mode: String,
    filter_mode: String,
) -> Result<Vec<EnrichedSession>, String> {
    log::debug!("Listing sorted enriched sessions: sort={sort_mode}, filter={filter_mode}");
    
    let sort_mode_str = sort_mode.clone();
    let filter_mode_str = filter_mode.clone();
    let sort_mode = sort_mode.parse::<SortMode>()
        .map_err(|e| format!("Invalid sort mode '{sort_mode_str}': {e}"))?;
    let filter_mode = filter_mode_str.parse::<FilterMode>()
        .map_err(|e| format!("Invalid filter mode '{filter_mode_str}': {e}"))?;
    
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.list_enriched_sessions_sorted(sort_mode, filter_mode) {
        Ok(sessions) => {
            log::debug!("Found {} sorted/filtered sessions", sessions.len());
            Ok(sessions)
        },
        Err(e) => {
            log::error!("Failed to list sorted enriched sessions: {e}");
            Err(format!("Failed to get sorted sessions: {e}"))
        }
    }
}

#[tauri::command]
pub async fn schaltwerk_core_create_session(app: tauri::AppHandle, name: String, prompt: Option<String>, base_branch: Option<String>, user_edited_name: Option<bool>) -> Result<Session, String> {
    let was_user_edited = user_edited_name.unwrap_or(false);
    // Consider it auto-generated if:
    // 1. It looks like a Docker-style name (adjective_noun format) AND wasn't user edited
    // 2. OR it wasn't user edited at all (even custom names should be renamed if not edited)
    let was_auto_generated = !was_user_edited;
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let session = manager.create_session_with_auto_flag(&name, prompt.as_deref(), base_branch.as_deref(), was_auto_generated)
        .map_err(|e| format!("Failed to create session: {e}"))?;

    let session_name_clone = session.name.clone();
    let app_handle = app.clone();
    
    #[derive(serde::Serialize, Clone)]
    struct SessionAddedPayload {
        session_name: String,
        branch: String,
        worktree_path: String,
        parent_branch: String,
    }
    let _ = emit_event(&app, SchaltEvent::SessionAdded, &SessionAddedPayload {
            session_name: session.name.clone(),
            branch: session.branch.clone(),
            worktree_path: session.worktree_path.to_string_lossy().to_string(),
            parent_branch: session.parent_branch.clone(),
        },
    );

    drop(core_lock);
    
    // Only trigger auto-rename for non-versioned Docker-style names
    // Versioned names (ending with _v1, _v2, etc.) will be handled by group rename
    if was_auto_generated && !is_versioned_session_name(&name) {
        log::info!("Session '{name}' was auto-generated (non-versioned), spawning name generation agent");
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            let (session_info, db_clone) = {
                let core = match get_schaltwerk_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("Cannot get schaltwerk_core for session '{session_name_clone}': {e}");
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
                log::info!("Session '{}' loaded: pending_name_generation={}, original_agent_type={:?}", 
                    session_name_clone, session.pending_name_generation, session.original_agent_type);
                
                if !session.pending_name_generation {
                    log::info!("Session '{session_name_clone}' does not have pending_name_generation flag, skipping");
                    return;
                }
                let agent = session.original_agent_type.clone()
                    .unwrap_or_else(|| core.db.get_agent_type().unwrap_or_else(|_| "claude".to_string()));
                
                log::info!("Using agent '{agent}' for name generation of session '{session_name_clone}'");
                
                (
                    (session.id.clone(), session.worktree_path.clone(), session.repository_path.clone(), session.branch.clone(), agent, session.initial_prompt.clone()),
                    core.db.clone()
                )
            };
            
            let (session_id, worktree_path, repo_path, current_branch, agent, initial_prompt) = session_info;
            
            log::info!("Starting name generation for session '{}' with prompt: {:?}", 
                session_name_clone, initial_prompt.as_ref().map(|p| {
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
                }));
            
            // Build env vars and CLI args as used to start the session
            let (mut env_vars, cli_args) = if let Some(settings_manager) = crate::SETTINGS_MANAGER.get() {
                let manager = settings_manager.lock().await;
                let env_vars = manager.get_agent_env_vars(&agent)
                    .into_iter()
                    .collect::<Vec<(String, String)>>();
                let cli_args = manager.get_agent_cli_args(&agent);
                (env_vars, cli_args)
            } else {
                (vec![], String::new())
            };

            // Add project-specific environment variables
            if let Ok(project_env_vars) = db_clone.get_project_environment_variables(&repo_path) {
                for (key, value) in project_env_vars { env_vars.push((key, value)); }
            }

            let ctx = schaltwerk::schaltwerk_core::naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &current_branch,
                agent_type: &agent,
                initial_prompt: initial_prompt.as_deref(),
                cli_args: Some(&cli_args),
                env_vars: &env_vars,
            };
            match schaltwerk::schaltwerk_core::naming::generate_display_name_and_rename_branch(ctx).await {
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
                        if let Err(e) = emit_event(&app_handle, SchaltEvent::SessionsRefreshed, &sessions) {
                            log::warn!("Could not emit sessions refreshed: {e}");
                        }
                    }
                }
                Ok(None) => { 
                    log::warn!("Name generation returned None for session '{session_name_clone}'");
                    let _ = db_clone.set_pending_name_generation(&session_id, false); 
                }
                Err(e) => {
                    log::error!("Failed to generate display name for session '{session_name_clone}': {e}");
                    let _ = db_clone.set_pending_name_generation(&session_id, false);
                }
            }
        });
    } else {
        log::info!("Session '{}' was_auto_generated={}, has_prompt={}, skipping name generation", 
            name, was_auto_generated, prompt.is_some());
    }

    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_rename_version_group(app: tauri::AppHandle, base_name: String, prompt: String, _base_branch: Option<String>) -> Result<(), String> {
    log::info!("=== RENAME VERSION GROUP CALLED ===");
    log::info!("Base name: '{base_name}'");
    
    // Get all sessions with this base name pattern
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    // Find all versions of this session
    let all_sessions = manager.list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))?;
    
    let version_sessions: Vec<Session> = all_sessions
        .into_iter()
        .filter(|s| matches_version_pattern(&s.name, &base_name))
        .collect();
    
    if version_sessions.is_empty() {
        log::warn!("No version sessions found for base name '{base_name}'");
        return Ok(());
    }
    
    log::info!("Found {} version sessions for base name '{base_name}'", version_sessions.len());
    
    // Get the first session's details for name generation
    let first_session = &version_sessions[0];
    let db = core_lock.db.clone();
    let worktree_path = first_session.worktree_path.clone();
    let repo_path = first_session.repository_path.clone();
    let current_branch = first_session.branch.clone();
    let agent_type = first_session.original_agent_type.clone()
        .unwrap_or_else(|| db.get_agent_type().unwrap_or_else(|_| "claude".to_string()));
    
    drop(core_lock);
    
    // Get environment variables for the agent
    let (mut env_vars, cli_args) = get_agent_env_and_cli_args(&agent_type);
    
    // Add project-specific environment variables
    if let Ok(project_env_vars) = db.get_project_environment_variables(&repo_path) {
        for (key, value) in project_env_vars { env_vars.push((key, value)); }
    }
    
    // Generate a display name once for the entire group
    let generated_name = match schaltwerk::schaltwerk_core::naming::generate_display_name(
        &db,
        &first_session.id,
        &worktree_path,
        &agent_type,
        Some(&prompt),
        Some(&cli_args),
        &env_vars,
    ).await {
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
    
    for session in version_sessions {
        // Extract version suffix
        let version_suffix = session.name.strip_prefix(&base_name).unwrap_or("");
        let new_session_name = format!("{generated_name}{version_suffix}");
        let new_branch_name = format!("schaltwerk/{new_session_name}");
        
        log::info!("Renaming session '{}' to '{new_session_name}'", session.name);
        
        // Update display name in database
        if let Err(e) = db.update_session_display_name(&session.id, &new_session_name) {
            log::error!("Failed to update display name for session '{}': {e}", session.name);
        }
        
        // Rename the git branch
        if current_branch != new_branch_name {
            match schaltwerk::domains::git::branches::rename_branch(&repo_path, &session.branch, &new_branch_name) {
                Ok(()) => {
                    log::info!("Renamed branch from '{}' to '{new_branch_name}'", session.branch);
                    
                    // Update worktree to use new branch
                    if let Err(e) = schaltwerk::domains::git::worktrees::update_worktree_branch(&session.worktree_path, &new_branch_name) {
                        log::error!("Failed to update worktree for new branch: {e}");
                    }
                    
                    // Update branch name in database
                    if let Err(e) = db.update_session_branch(&session.id, &new_branch_name) {
                        log::error!("Failed to update branch name in database: {e}");
                    }
                }
                Err(e) => {
                    log::warn!("Could not rename branch for session '{}': {e}", session.name);
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
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions() -> Result<Vec<Session>, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_session(name: String) -> Result<Session, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_session_agent_content(name: String) -> Result<(Option<String>, Option<String>), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.get_session_task_content(&name)
        .map_err(|e| format!("Failed to get session agent content: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_cancel_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
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

        if session.session_state == schaltwerk::schaltwerk_core::types::SessionState::Spec {
            // Archive spec sessions instead of deleting
            manager.archive_spec_session(&name).map_err(|e| format!("Failed to archive spec: {e}"))?;
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
        let _ = emit_event(&app, SchaltEvent::ArchiveUpdated, &serde_json::json!({"repo": repo_path_str, "count": archive_count_after_opt.unwrap_or(0)}));
        if let Ok(core) = get_schaltwerk_core().await {
            let core = core.lock().await;
            let manager = core.session_manager();
            if let Ok(sessions) = manager.list_enriched_sessions() {
                let _ = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions);
            }
        }

        if let Ok(terminal_manager) = get_terminal_manager().await {
            let ids = vec![
                format!("session-{}-top", name),
                format!("session-{}-bottom", name),
            ];
            for id in ids {
                if let Err(e) = terminal_manager.close_terminal(id.clone()).await {
                    log::debug!("Terminal {id} cleanup (spec-archive): {e}");
                }
            }
        }
        return Ok(());
    }
    
    // Emit a "cancelling" event instead of "removed"
    #[derive(serde::Serialize, Clone)]
    struct SessionCancellingPayload { session_name: String }
    let _ = emit_event(&app, SchaltEvent::SessionCancelling, &SessionCancellingPayload { session_name: name.clone() }
    );
    
    let app_for_refresh = app.clone();
    let name_for_bg = name.clone();
    tokio::spawn(async move {
        log::debug!("Cancel {name_for_bg}: Starting background work");
        
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
                struct SessionRemovedPayload { session_name: String }
                let _ = emit_event(&app_for_refresh, SchaltEvent::SessionRemoved, &SessionRemovedPayload { session_name: name_for_bg.clone() }
                );
                
                if let Ok(core) = get_schaltwerk_core().await {
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        let _ = emit_event(&app_for_refresh, SchaltEvent::SessionsRefreshed, &sessions);
                    }
                }
            },
            Err(e) => {
                log::error!("CRITICAL: Background cancel failed for {name_for_bg}: {e}");
                
                #[derive(serde::Serialize, Clone)]
                struct CancelErrorPayload { 
                    session_name: String,
                    error: String 
                }
                let _ = emit_event(&app_for_refresh, SchaltEvent::CancelError, &CancelErrorPayload { 
                        session_name: name_for_bg.clone(),
                        error: e.to_string()
                    }
                );
                
                if let Ok(core) = get_schaltwerk_core().await {
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        let _ = emit_event(&app_for_refresh, SchaltEvent::SessionsRefreshed, &sessions);
                    }
                }
            }
        }
        
        if let Ok(terminal_manager) = get_terminal_manager().await {
            let ids = vec![
                format!("session-{}-top", name_for_bg),
                format!("session-{}-bottom", name_for_bg),
            ];
            
            for id in ids {
                if let Err(e) = terminal_manager.close_terminal(id.clone()).await {
                    log::debug!("Terminal {id} cleanup: {e}");
                }
            }
        }
        
        log::info!("Cancel {name_for_bg}: All background work completed");
    });
    
    Ok(())
}


#[tauri::command]
pub async fn schaltwerk_core_convert_session_to_draft(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Converting session to spec: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.convert_session_to_draft(&name) {
        Ok(()) => {
            log::info!("Successfully converted session to spec: {name}");
            
            // Close associated terminals
            if let Ok(terminal_manager) = get_terminal_manager().await {
                // Sanitize session name to match frontend's terminal ID generation
                let sanitized_name = name.chars()
                    .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
                    .collect::<String>();
                let ids = vec![
                    format!("session-{}-top", sanitized_name),
                    format!("session-{}-bottom", sanitized_name),
                ];
                for id in ids {
                    if let Ok(true) = terminal_manager.terminal_exists(&id).await {
                        if let Err(e) = terminal_manager.close_terminal(id.clone()).await {
                            log::warn!("Failed to close terminal {id} on convert to spec: {e}");
                        }
                    }
                }
            }
            
            // Emit event to notify frontend of the change
            // Invalidate cache before emitting refreshed event
                        if let Ok(sessions) = manager.list_enriched_sessions() {
                let _ = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions);
            }
            
            Ok(())
        },
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
    
    manager.update_git_stats(&session_id)
        .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude(app: tauri::AppHandle, session_name: String, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
    schaltwerk_core_start_claude_with_restart(app, session_name, false, cols, rows).await
}

#[tauri::command]
pub async fn schaltwerk_core_start_claude_with_restart(app: tauri::AppHandle, session_name: String, force_restart: bool, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
    log::info!("Starting Claude for session: {session_name}");
    
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    // Resolve binary paths at command level (with caching)
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();
        
        // Get resolved binary paths for all agents
        for agent in ["claude", "cursor-agent", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                },
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };
    
    let command = manager.start_claude_in_session_with_restart_and_binary(&session_name, force_restart, &binary_paths)
        .map_err(|e| {
            log::error!("Failed to build Claude command for session {session_name}: {e}");
            format!("Failed to start Claude in session: {e}")
        })?;
    
    log::info!("Claude command for session {session_name}: {command}");
    
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Check if we have permission to access the working directory
    log::info!("Checking permissions for working directory: {cwd}");
    match std::fs::read_dir(&cwd) {
        Ok(_) => log::info!("Working directory access confirmed: {cwd}"),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            log::warn!("Permission denied for working directory: {cwd}");
            return Err(format!("Permission required for folder: {cwd}. Please grant access when prompted and then retry starting the agent."));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::warn!("Working directory not found: {cwd}");
            return Err(format!("Working directory not found: {cwd}"));
        }
        Err(e) => {
            log::error!("Error checking working directory access: {e}");
            return Err(format!("Error accessing working directory: {e}"));
        }
    }
    
    // Sanitize session name to match frontend's terminal ID generation
    let sanitized_session_name = session_name.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>();
    let terminal_id = format!("session-{sanitized_session_name}-top");
    let terminal_manager = get_terminal_manager().await?;
    
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    let agent_type = if agent_name == "claude" || agent_name.ends_with("/claude") {
        "claude"
    } else if agent_name == "cursor-agent" || agent_name.ends_with("/cursor-agent") {
        "cursor"
    } else if agent_name.contains("opencode") {
        "opencode"
    } else if agent_name.contains("gemini") {
        "gemini"
    } else if agent_name == "codex" || agent_name.ends_with("/codex") {
        "codex"
    } else {
        "claude"
    };
    
    let (mut env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    };
    
    // Add project-specific environment variables
    if let Ok(project_env_vars) = core.db.get_project_environment_variables(&core.repo_path) {
        let count = project_env_vars.len();
        for (key, value) in project_env_vars {
            env_vars.push((key, value));
        }
        log::info!("Added {count} project environment variables");
    }
    
    log::info!("Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'", env_vars.len());
    
    let _is_opencode = (agent_name == "opencode") || agent_name.ends_with("/opencode");
    
    let mut final_args = agent_args.clone();
    
    log::info!("ARGUMENT BUILDING for {agent_type}: initial agent_args={agent_args:?}, cli_args='{cli_args}'");
    
    if !cli_args.is_empty() {
        let cli_args_for_parse = normalize_cli_text(&cli_args);
        let mut additional_args = shell_words::split(&cli_args_for_parse)
            .unwrap_or_else(|_| vec![cli_args.clone()]);

        log::info!("Parsed CLI args: {additional_args:?}");

        if agent_type == "codex" {
            log::info!("Codex mode: keep --sandbox first, then CLI args");
            fix_codex_single_dash_long_flags(&mut additional_args);
            reorder_codex_model_after_profile(&mut additional_args);
            let mut new_args = final_args;
            new_args.extend(additional_args);
            final_args = new_args;
        } else {
            log::info!("Standard mode: appending CLI args after existing args");
            final_args.extend(additional_args);
        }
    }
    
    // Codex prompt ordering is now handled in the CLI args section above
    
    // Log the exact command that will be executed
    log::info!("FINAL COMMAND CONSTRUCTION for {agent_type}: command='{agent_name}', args={final_args:?}");
    
    // Create terminal with initial size if provided
    if let (Some(c), Some(r)) = (cols, rows) {
        use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
        terminal_manager.create_terminal_with_app_and_size(
            CreateTerminalWithAppAndSizeParams {
                id: terminal_id.clone(),
                cwd,
                command: agent_name.clone(),
                args: final_args,
                env: env_vars,
                cols: c,
                rows: r,
            }
        ).await?;
    } else {
        terminal_manager.create_terminal_with_app(
            terminal_id.clone(),
            cwd,
            agent_name.clone(),
            final_args,
            env_vars,
        ).await?;
    }
    
    // For OpenCode and other TUI applications, the frontend will handle
    // proper sizing based on the actual terminal container dimensions.
    // No hardcoded resize is needed anymore as we now support dynamic sizing.
    
    // For Gemini, we rely on the CLI's own interactive prompt flag.
    // Do not implement non-deterministic paste-based workarounds.
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    
    // Emit event to mark terminal as started globally
    #[derive(serde::Serialize)]
    #[derive(Clone)]
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
pub async fn schaltwerk_core_start_claude_orchestrator(terminal_id: String, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
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
        for agent in ["claude", "cursor-agent", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                },
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };
    
    let command = manager.start_claude_in_orchestrator_with_binary(&binary_paths)
        .map_err(|e| {
            log::error!("Failed to build orchestrator command: {e}");
            format!("Failed to start Claude in orchestrator: {e}")
        })?;
    
    log::info!("Claude command for orchestrator: {command}");
    
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Check if we have permission to access the working directory
    log::info!("Checking permissions for orchestrator working directory: {cwd}");
    match std::fs::read_dir(&cwd) {
        Ok(_) => log::info!("Orchestrator working directory access confirmed: {cwd}"),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            log::warn!("Permission denied for orchestrator working directory: {cwd}");
            return Err(format!("Permission required for folder: {cwd}. Please grant access when prompted and then retry starting the agent."));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::warn!("Orchestrator working directory not found: {cwd}");
            return Err(format!("Working directory not found: {cwd}"));
        }
        Err(e) => {
            log::error!("Error checking orchestrator working directory access: {e}");
            return Err(format!("Error accessing working directory: {e}"));
        }
    }
    
    let terminal_manager = get_terminal_manager().await?;
    
    if terminal_manager.terminal_exists(&terminal_id).await? {
        terminal_manager.close_terminal(terminal_id.clone()).await?;
    }
    
    let agent_type = if agent_name == "claude" || agent_name.ends_with("/claude") {
        "claude"
    } else if agent_name == "cursor-agent" || agent_name.ends_with("/cursor-agent") {
        "cursor"
    } else if agent_name.contains("opencode") {
        "opencode"
    } else if agent_name.contains("gemini") {
        "gemini"
    } else if agent_name == "codex" || agent_name.ends_with("/codex") {
        "codex"
    } else {
        "claude"
    };
    
    let (mut env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    };
    
    // Add project-specific environment variables
    if let Ok(project_env_vars) = core.db.get_project_environment_variables(&core.repo_path) {
        let count = project_env_vars.len();
        for (key, value) in project_env_vars {
            env_vars.push((key, value));
        }
        log::info!("Added {count} project environment variables");
    }
    
    log::info!("Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'", env_vars.len());
    
    let _is_opencode = agent_name == "opencode" || agent_name.ends_with("/opencode");
    
    // Build args for all agents consistently:
    // 1. Start with parsed args from command string (may include prompt for Claude/Cursor)
    // 2. Add any additional CLI args from settings
    let mut final_args = agent_args.clone();
    
    log::info!("ARGUMENT BUILDING for {agent_type}: initial agent_args={agent_args:?}, cli_args='{cli_args}'");
    
    // Add CLI arguments from settings for all agent types
    if !cli_args.is_empty() {
        // Normalize dashes and non-standard spaces for all agents
        let cli_args_for_parse = normalize_cli_text(&cli_args);
        let mut additional_args = shell_words::split(&cli_args_for_parse)
            .unwrap_or_else(|_| vec![cli_args.clone()]);

        log::info!("Parsed CLI args: {additional_args:?}");
        
        // For agents that include prompts in their command strings (Claude, Cursor),
        // the prompt is already in agent_args, so we append CLI args.
        // For agents that need CLI args before prompts (Codex), we prepend.
        // This ensures correct argument order for all agent types.
        if agent_type == "codex" {
            // Codex requires specific order: codex [OPTIONS] [PROMPT]
            // Extract any existing prompt first before adding CLI args
            let extracted_prompt = extract_codex_prompt_if_present(&mut final_args);
            if extracted_prompt.is_some() {
                log::info!("Extracted codex prompt for proper ordering");
            }
            
            log::info!("Codex mode: keep --sandbox first, then CLI args, then prompt at end");
            fix_codex_single_dash_long_flags(&mut additional_args);
            reorder_codex_model_after_profile(&mut additional_args);
            let mut new_args = final_args; // starts with ["--sandbox", mode] (minus extracted prompt)
            new_args.extend(additional_args);
            
            // Put prompt back at the very end
            if let Some(prompt) = extracted_prompt {
                new_args.push(prompt);
            }
            
            final_args = new_args;
        } else {
            // Other agents: Append CLI args after existing args
            log::info!("Standard mode: appending CLI args after existing args");
            final_args.extend(additional_args);
        }
    }
    
    // Create terminal with initial size if provided
    if let (Some(c), Some(r)) = (cols, rows) {
        use schaltwerk::domains::terminal::manager::CreateTerminalWithAppAndSizeParams;
        terminal_manager.create_terminal_with_app_and_size(
            CreateTerminalWithAppAndSizeParams {
                id: terminal_id.clone(),
                cwd,
                command: agent_name.clone(),
                args: final_args,
                env: env_vars,
                cols: c,
                rows: r,
            }
        ).await?;
    } else {
        terminal_manager.create_terminal_with_app(
            terminal_id.clone(),
            cwd,
            agent_name.clone(),
            final_args,
            env_vars,
        ).await?;
    }
    
    // For OpenCode and other TUI applications, the frontend will handle
    // proper sizing based on the actual terminal container dimensions.
    // No hardcoded resize is needed anymore as we now support dynamic sizing.
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    Ok(command)
}

#[tauri::command]
pub async fn schaltwerk_core_set_skip_permissions(enabled: bool) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.set_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_skip_permissions() -> Result<bool, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_session_agent_type(session_name: String, agent_type: String) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    // Update global agent type
    core.db.set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set global agent type: {e}"))?;
    
    // Get the session to find its ID
    let session = core.db.get_session_by_name(&core.repo_path, &session_name)
        .map_err(|e| format!("Failed to find session {session_name}: {e}"))?;
    
    // Get current skip permissions setting
    let skip_permissions = core.db.get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))?;
    
    // Update session's original settings to use the new agent type
    core.db.set_session_original_settings(&session.id, &agent_type, skip_permissions)
        .map_err(|e| format!("Failed to update session agent type: {e}"))?;
    
    log::info!("Updated agent type to '{}' for session '{}' (id: {})", agent_type, session_name, session.id);
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_get_agent_type() -> Result<String, String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.get_agent_type()
        .map_err(|e| format!("Failed to get agent type: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_get_font_sizes() -> Result<(i32, i32), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.get_font_sizes()
        .map_err(|e| format!("Failed to get font sizes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_set_font_sizes(terminal_font_size: i32, ui_font_size: i32) -> Result<(), String> {
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    
    core.db.set_font_sizes(terminal_font_size, ui_font_size)
        .map_err(|e| format!("Failed to set font sizes: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_mark_session_ready(app: tauri::AppHandle, name: String, auto_commit: bool) -> Result<bool, String> {
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
    
    let result = manager.mark_session_ready(&name, effective_auto_commit)
        .map_err(|e| format!("Failed to mark session as reviewed: {e}"))?;
    
    // Emit event to notify frontend of the change
    // Invalidate cache before emitting refreshed event
        if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after marking session ready");
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
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
pub async fn schaltwerk_core_unmark_session_ready(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Unmarking session {name} as reviewed");
    
    let core = get_schaltwerk_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.unmark_session_ready(&name)
        .map_err(|e| format!("Failed to unmark session as reviewed: {e}"))?;
    
    // Emit event to notify frontend of the change
    // Invalidate cache before emitting refreshed event
        if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after unmarking session ready");
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_create_spec_session(app: tauri::AppHandle, name: String, spec_content: String) -> Result<Session, String> {
    log::info!("Creating spec session: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let session = manager.create_spec_session(&name, &spec_content)
        .map_err(|e| format!("Failed to create spec session: {e}"))?;
    
    // Emit event with actual sessions list
    // Invalidate cache before emitting refreshed event
        if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after creating spec session");
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(session)
}

#[tauri::command]
pub async fn schaltwerk_core_create_and_start_spec_session(app: tauri::AppHandle, name: String, spec_content: String, base_branch: Option<String>) -> Result<(), String> {
    log::info!("Creating and starting spec session: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.create_and_start_spec_session(&name, &spec_content, base_branch.as_deref())
        .map_err(|e| format!("Failed to create and start spec session: {e}"))?;
    
    // Emit event with actual sessions list
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after creating and starting spec session");
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    // Drop the lock
    drop(core_lock);
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_start_spec_session(app: tauri::AppHandle, name: String, base_branch: Option<String>) -> Result<(), String> {
    log::info!("Starting spec session: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.start_spec_session(&name, base_branch.as_deref())
        .map_err(|e| format!("Failed to start spec session: {e}"))?;
    
    // Invalidate cache before emitting refreshed event
        if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after starting spec session");
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    // Drop the lock
    drop(core_lock);
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_update_session_state(name: String, state: String) -> Result<(), String> {
    log::info!("Updating session state: {name} -> {state}");
    
    let session_state = state.parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_session_state(&name, session_state)
        .map_err(|e| format!("Failed to update session state: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_update_spec_content(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    log::info!("Updating spec content for session: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_spec_content(&name, &content)
        .map_err(|e| format!("Failed to update spec content: {e}"))?;
    
    // Emit sessions-refreshed event to update UI
    if let Ok(sessions) = manager.list_enriched_sessions() {
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_rename_draft_session(app: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    log::info!("Renaming spec session from '{old_name}' to '{new_name}'");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.rename_draft_session(&old_name, &new_name)
        .map_err(|e| format!("Failed to rename spec session: {e}"))?;
    
    // Emit sessions-refreshed event to update UI
    if let Ok(sessions) = manager.list_enriched_sessions() {
        if let Err(e) = emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn schaltwerk_core_append_spec_content(name: String, content: String) -> Result<(), String> {
    log::info!("Appending to spec content for session: {name}");
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.append_spec_content(&name, &content)
        .map_err(|e| format!("Failed to append spec content: {e}"))
}

#[tauri::command]
pub async fn schaltwerk_core_list_sessions_by_state(state: String) -> Result<Vec<Session>, String> {
    log::info!("Listing sessions by state: {state}");
    
    let session_state = state.parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_schaltwerk_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.list_sessions_by_state(session_state)
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
    
    // Wait a brief moment to ensure cleanup
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    // Start a FRESH orchestrator session (bypassing session discovery)
    schaltwerk_core_start_fresh_orchestrator(terminal_id).await
}

#[tauri::command]
pub async fn schaltwerk_core_start_fresh_orchestrator(terminal_id: String) -> Result<String, String> {
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
        for agent in ["claude", "cursor-agent", "codex", "opencode", "gemini"] {
            match settings.get_effective_binary_path(agent) {
                Ok(path) => {
                    log::debug!("Cached binary path for {agent}: {path}");
                    paths.insert(agent.to_string(), path);
                },
                Err(e) => log::warn!("Failed to get cached binary path for {agent}: {e}"),
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };
    
    // Build command for FRESH session (no session resume)
    let command = manager.start_claude_in_orchestrator_fresh_with_binary(&binary_paths)
        .map_err(|e| {
            log::error!("Failed to build fresh orchestrator command: {e}");
            format!("Failed to start fresh Claude in orchestrator: {e}")
        })?;
    
    log::info!("Fresh Claude command for orchestrator: {command}");
    
    let (cwd, agent_name, agent_args) = parse_agent_command(&command)?;
    
    // Check if we have permission to access the working directory
    log::info!("Checking permissions for orchestrator working directory: {cwd}");
    match std::fs::read_dir(&cwd) {
        Ok(_) => {
            log::info!("Permissions verified for orchestrator directory: {cwd}");
        }
        Err(e) => {
            log::error!("Permission denied for orchestrator directory {cwd}: {e}");
            return Err(format!("Permission required for folder: {cwd}. Please grant folder access to continue."));
        }
    }
    
    let terminal_manager = get_terminal_manager().await?;
    
    let agent_type = if agent_name == "claude" || agent_name.ends_with("/claude") {
        "claude"
    } else if agent_name == "cursor-agent" || agent_name.ends_with("/cursor-agent") {
        "cursor"
    } else if agent_name.contains("opencode") {
        "opencode"
    } else if agent_name.contains("gemini") {
        "gemini"
    } else if agent_name == "codex" {
        "codex"
    } else {
        "claude"
    };
    
    let (mut env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    };
    
    // Add project-specific environment variables
    if let Ok(project_env_vars) = core.db.get_project_environment_variables(&core.repo_path) {
        let count = project_env_vars.len();
        if count > 0 {
            log::info!("Adding {count} project-specific environment variables to fresh orchestrator");
            for (key, value) in project_env_vars {
                env_vars.push((key, value));
            }
        }
    }
    
    let mut final_args = agent_args;
    if !cli_args.is_empty() {
        log::info!("Adding CLI args for {agent_type}: {cli_args}");
        final_args.extend(cli_args.split_whitespace().map(|s| s.to_string()));
    }
    
    let _is_opencode = agent_name.contains("opencode");
    
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        agent_name,
        final_args,
        env_vars,
    ).await?;
    
    // For OpenCode and other TUI applications, the frontend will handle
    // proper sizing based on the actual terminal container dimensions.
    // No hardcoded resize is needed anymore as we now support dynamic sizing.
    
    log::info!("Successfully started fresh Claude in orchestrator terminal: {terminal_id}");
    Ok(command)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_version_suffix() {
        // Valid version suffixes
        assert!(is_version_suffix("v1"));
        assert!(is_version_suffix("v2"));
        assert!(is_version_suffix("v10"));
        assert!(is_version_suffix("v123"));
        
        // Invalid version suffixes
        assert!(!is_version_suffix("v"));
        assert!(!is_version_suffix("v1a"));
        assert!(!is_version_suffix("1"));
        assert!(!is_version_suffix("version1"));
        assert!(!is_version_suffix("v_1"));
    }

    #[test]
    fn test_is_versioned_session_name() {
        // Valid versioned names
        assert!(is_versioned_session_name("peaceful_robinson_v1"));
        assert!(is_versioned_session_name("happy_tesla_v2"));
        assert!(is_versioned_session_name("angry_einstein_v10"));
        
        // Invalid versioned names
        assert!(!is_versioned_session_name("peaceful_robinson"));
        assert!(!is_versioned_session_name("single"));
        assert!(!is_versioned_session_name("peaceful_robinson_version1"));
        assert!(!is_versioned_session_name("too_many_parts_v1"));
    }

    #[test]
    fn test_matches_version_pattern() {
        // Valid matches
        assert!(matches_version_pattern("peaceful_robinson_v1", "peaceful_robinson"));
        assert!(matches_version_pattern("peaceful_robinson_v2", "peaceful_robinson"));
        assert!(matches_version_pattern("happy_tesla_v10", "happy_tesla"));
        
        // Invalid matches
        assert!(!matches_version_pattern("peaceful_robinson", "peaceful_robinson"));
        assert!(!matches_version_pattern("peaceful_robinson_v1", "happy_tesla"));
        assert!(!matches_version_pattern("peaceful_robinson_version1", "peaceful_robinson"));
        assert!(!matches_version_pattern("peaceful_robinson_v1a", "peaceful_robinson"));
    }
}

use tauri::Emitter;
use crate::para_core::{SessionState, EnrichedSession, Session};
use crate::para_core::db_sessions::SessionMethods;
use crate::para_core::db_app_config::AppConfigMethods;
use crate::{get_para_core, get_terminal_manager, SETTINGS_MANAGER, parse_agent_command};

#[tauri::command]
pub async fn para_core_list_enriched_sessions() -> Result<Vec<EnrichedSession>, String> {
    log::debug!("Listing enriched sessions from para_core");
    
    let core = get_para_core().await?;
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
pub async fn para_core_create_session(app: tauri::AppHandle, name: String, prompt: Option<String>, base_branch: Option<String>, user_edited_name: Option<bool>) -> Result<Session, String> {
    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;
    
    let core = get_para_core().await?;
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
    let _ = app.emit(
        "schaltwerk:session-added",
        SessionAddedPayload {
            session_name: session.name.clone(),
            branch: session.branch.clone(),
            worktree_path: session.worktree_path.to_string_lossy().to_string(),
            parent_branch: session.parent_branch.clone(),
        },
    );

    drop(core_lock);
    
    if was_auto_generated {
        log::info!("Session '{name}' was auto-generated, spawning name generation task");
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            let (session_info, db_clone) = {
                let core = match get_para_core().await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("Cannot get para_core for session '{session_name_clone}': {e}");
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
            
            let ctx = crate::para_core::naming::SessionRenameContext {
                db: &db_clone,
                session_id: &session_id,
                worktree_path: &worktree_path,
                repo_path: &repo_path,
                current_branch: &current_branch,
                agent_type: &agent,
                initial_prompt: initial_prompt.as_deref(),
            };
            match crate::para_core::naming::generate_display_name_and_rename_branch(ctx).await {
                Ok(Some(display_name)) => {
                    log::info!("Successfully generated display name '{display_name}' for session '{session_name_clone}'");
                    
                    let core = match get_para_core().await {
                        Ok(c) => c,
                        Err(e) => {
                            log::warn!("Cannot get para_core for sessions refresh: {e}");
                            return;
                        }
                    };
                    let core = core.lock().await;
                    let manager = core.session_manager();
                    if let Ok(sessions) = manager.list_enriched_sessions() {
                        log::info!("Emitting sessions-refreshed event after name generation");
                        if let Err(e) = app_handle.emit("schaltwerk:sessions-refreshed", &sessions) {
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
pub async fn para_core_list_sessions() -> Result<Vec<Session>, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.list_sessions()
        .map_err(|e| format!("Failed to list sessions: {e}"))
}

#[tauri::command]
pub async fn para_core_get_session(name: String) -> Result<Session, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.get_session(&name)
        .map_err(|e| format!("Failed to get session: {e}"))
}

#[tauri::command]
pub async fn para_core_cancel_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Starting cancel session: {name}");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.cancel_session(&name) {
        Ok(()) => {
            log::info!("Successfully canceled session: {name}");
            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload { session_name: String }
            let _ = app.emit(
                "schaltwerk:session-removed",
                SessionRemovedPayload { session_name: name.clone() },
            );
            if let Ok(manager) = get_terminal_manager().await {
                let ids = vec![
                    format!("session-{}-top", name),
                    format!("session-{}-bottom", name),
                    format!("session-{}-right", name),
                ];
                for id in ids {
                    if let Ok(true) = manager.terminal_exists(&id).await {
                        if let Err(e) = manager.close_terminal(id.clone()).await {
                            log::warn!("Failed to close terminal {id} on cancel: {e}");
                        }
                    }
                }
            }
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to cancel session {name}: {e}");
            Err(format!("Failed to cancel session: {e}"))
        }
    }
}

#[tauri::command]
pub async fn para_core_convert_session_to_draft(app: tauri::AppHandle, name: String) -> Result<(), String> {
    log::info!("Converting session to draft: {name}");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    match manager.convert_session_to_draft(&name) {
        Ok(()) => {
            log::info!("Successfully converted session to draft: {name}");
            
            // Close associated terminals
            if let Ok(terminal_manager) = get_terminal_manager().await {
                let ids = vec![
                    format!("session-{}-top", name),
                    format!("session-{}-bottom", name),
                    format!("session-{}-right", name),
                ];
                for id in ids {
                    if let Ok(true) = terminal_manager.terminal_exists(&id).await {
                        if let Err(e) = terminal_manager.close_terminal(id.clone()).await {
                            log::warn!("Failed to close terminal {id} on convert to draft: {e}");
                        }
                    }
                }
            }
            
            // Emit event to notify frontend of the change
            if let Ok(sessions) = manager.list_enriched_sessions() {
                let _ = app.emit("schaltwerk:sessions-refreshed", &sessions);
            }
            
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to convert session {name} to draft: {e}");
            Err(format!("Failed to convert session to draft: {e}"))
        }
    }
}

#[tauri::command]
pub async fn para_core_update_git_stats(session_id: String) -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.update_git_stats(&session_id)
        .map_err(|e| format!("Failed to update git stats: {e}"))
}

#[tauri::command]
pub async fn para_core_cleanup_orphaned_worktrees() -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.cleanup_orphaned_worktrees()
        .map_err(|e| format!("Failed to cleanup orphaned worktrees: {e}"))
}

#[tauri::command]
pub async fn para_core_start_claude(session_name: String) -> Result<String, String> {
    log::info!("Starting Claude for session: {session_name}");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let command = manager.start_claude_in_session(&session_name)
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
    
    let terminal_id = format!("session-{session_name}-top");
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
    } else if agent_name == "codex" {
        "codex"
    } else {
        "claude"
    };
    
    let (env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    };
    
    log::info!("Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'", env_vars.len());
    
    let is_opencode = agent_name == "opencode" || agent_name.ends_with("/opencode");
    
    let mut final_args = agent_args;
    if !cli_args.is_empty() {
        // Parse the CLI arguments string into individual arguments
        // This is a simple split on spaces, but respects quoted strings
        let additional_args = shell_words::split(&cli_args)
            .unwrap_or_else(|_| vec![cli_args.clone()]);
        final_args.extend(additional_args);
    }
    
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        agent_name.clone(),
        final_args,
        env_vars,
    ).await?;
    
    if is_opencode {
        let terminal_manager_clone = terminal_manager.clone();
        let terminal_id_clone = terminal_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone.clone(), 136, 48).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone.clone(), 136, 48).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone, 136, 48).await;
        });
    }
    
    let is_gemini = agent_name == "gemini" || agent_name.ends_with("/gemini");
    if is_gemini {
        if let Ok(session) = manager.get_session(&session_name) {
            if let Some(initial_prompt) = session.initial_prompt {
                if !initial_prompt.trim().is_empty() {
                    let terminal_manager_clone = terminal_manager.clone();
                    let terminal_id_clone = terminal_id.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                        let formatted_content = format!("{initial_prompt}\n");
                        if let Err(e) = terminal_manager_clone.write_terminal(
                            terminal_id_clone.clone(), 
                            formatted_content.as_bytes().to_vec()
                        ).await {
                            log::warn!("Failed to paste draft content to Gemini terminal {terminal_id_clone}: {e}");
                        } else {
                            log::info!("Successfully pasted draft content to Gemini terminal {terminal_id_clone}");
                        }
                    });
                }
            }
        }
    }
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    Ok(command)
}

#[tauri::command]
pub async fn para_core_start_claude_orchestrator(terminal_id: String) -> Result<String, String> {
    log::info!("Starting Claude for orchestrator in terminal: {terminal_id}");
    
    // First check if we have a valid project initialized
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get para_core for orchestrator: {e}");
            // If we can't get a para_core (no project), create a user-friendly error
            if e.contains("No active project") {
                return Err("No project is currently open. Please open a project folder first before starting the orchestrator.".to_string());
            }
            return Err(format!("Failed to initialize orchestrator: {e}"));
        }
    };
    let core = core.lock().await;
    let manager = core.session_manager();
    
    let command = manager.start_claude_in_orchestrator()
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
    } else if agent_name == "codex" {
        "codex"
    } else {
        "claude"
    };
    
    let (env_vars, cli_args) = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        let env_vars = manager.get_agent_env_vars(agent_type)
            .into_iter()
            .collect::<Vec<(String, String)>>();
        let cli_args = manager.get_agent_cli_args(agent_type);
        (env_vars, cli_args)
    } else {
        (vec![], String::new())
    };
    
    log::info!("Creating terminal with {agent_name} directly: {terminal_id} with {} env vars and CLI args: '{cli_args}'", env_vars.len());
    
    let is_opencode = agent_name == "opencode" || agent_name.ends_with("/opencode");
    
    let mut final_args = agent_args;
    if !cli_args.is_empty() {
        // Parse the CLI arguments string into individual arguments
        // This is a simple split on spaces, but respects quoted strings
        let additional_args = shell_words::split(&cli_args)
            .unwrap_or_else(|_| vec![cli_args.clone()]);
        final_args.extend(additional_args);
    }
    
    terminal_manager.create_terminal_with_app(
        terminal_id.clone(),
        cwd,
        agent_name.clone(),
        final_args,
        env_vars,
    ).await?;
    
    if is_opencode {
        let terminal_manager_clone = terminal_manager.clone();
        let terminal_id_clone = terminal_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone.clone(), 136, 48).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone.clone(), 136, 48).await;
            tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
            let _ = terminal_manager_clone.resize_terminal(terminal_id_clone, 136, 48).await;
        });
    }
    
    log::info!("Successfully started Claude in terminal: {terminal_id}");
    Ok(command)
}

#[tauri::command]
pub async fn para_core_set_skip_permissions(enabled: bool) -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.set_skip_permissions(enabled)
        .map_err(|e| format!("Failed to set skip permissions: {e}"))
}

#[tauri::command]
pub async fn para_core_get_skip_permissions() -> Result<bool, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.get_skip_permissions()
        .map_err(|e| format!("Failed to get skip permissions: {e}"))
}

#[tauri::command]
pub async fn para_core_set_agent_type(agent_type: String) -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.set_agent_type(&agent_type)
        .map_err(|e| format!("Failed to set agent type: {e}"))
}

#[tauri::command]
pub async fn para_core_get_agent_type() -> Result<String, String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.get_agent_type()
        .map_err(|e| format!("Failed to get agent type: {e}"))
}

#[tauri::command]
pub async fn para_core_get_font_sizes() -> Result<(i32, i32), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.get_font_sizes()
        .map_err(|e| format!("Failed to get font sizes: {e}"))
}

#[tauri::command]
pub async fn para_core_set_font_sizes(terminal_font_size: i32, ui_font_size: i32) -> Result<(), String> {
    let core = get_para_core().await?;
    let core = core.lock().await;
    
    core.db.set_font_sizes(terminal_font_size, ui_font_size)
        .map_err(|e| format!("Failed to set font sizes: {e}"))
}

#[tauri::command]
pub async fn para_core_mark_session_ready(name: String, auto_commit: bool) -> Result<bool, String> {
    log::info!("Marking session {name} as reviewed (auto_commit: {auto_commit})");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.mark_session_ready(&name, auto_commit)
        .map_err(|e| format!("Failed to mark session as reviewed: {e}"))
}

#[tauri::command]
pub async fn para_core_unmark_session_ready(name: String) -> Result<(), String> {
    log::info!("Unmarking session {name} as reviewed");
    
    let core = get_para_core().await?;
    let core = core.lock().await;
    let manager = core.session_manager();
    
    manager.unmark_session_ready(&name)
        .map_err(|e| format!("Failed to unmark session as reviewed: {e}"))
}

#[tauri::command]
pub async fn para_core_create_draft_session(app: tauri::AppHandle, name: String, draft_content: String) -> Result<Session, String> {
    log::info!("Creating draft session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let session = manager.create_draft_session(&name, &draft_content)
        .map_err(|e| format!("Failed to create draft session: {e}"))?;
    
    log::info!("Emitting sessions-refreshed event after creating draft session");
    if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &Vec::<EnrichedSession>::new()) {
        log::warn!("Could not emit sessions refreshed: {e}");
    }
    
    Ok(session)
}

#[tauri::command]
pub async fn para_core_start_draft_session(app: tauri::AppHandle, name: String, base_branch: Option<String>) -> Result<(), String> {
    log::info!("Starting draft session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.start_draft_session(&name, base_branch.as_deref())
        .map_err(|e| format!("Failed to start draft session: {e}"))?;
    
    if let Ok(sessions) = manager.list_enriched_sessions() {
        log::info!("Emitting sessions-refreshed event after starting draft session");
        if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &sessions) {
            log::warn!("Could not emit sessions refreshed: {e}");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn para_core_update_session_state(name: String, state: String) -> Result<(), String> {
    log::info!("Updating session state: {name} -> {state}");
    
    let session_state = state.parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_session_state(&name, session_state)
        .map_err(|e| format!("Failed to update session state: {e}"))
}

#[tauri::command]
pub async fn para_core_update_draft_content(name: String, content: String) -> Result<(), String> {
    log::info!("Updating draft content for session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.update_draft_content(&name, &content)
        .map_err(|e| format!("Failed to update draft content: {e}"))
}

#[tauri::command]
pub async fn para_core_append_draft_content(name: String, content: String) -> Result<(), String> {
    log::info!("Appending to draft content for session: {name}");
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.append_draft_content(&name, &content)
        .map_err(|e| format!("Failed to append draft content: {e}"))
}

#[tauri::command]
pub async fn para_core_list_sessions_by_state(state: String) -> Result<Vec<Session>, String> {
    log::info!("Listing sessions by state: {state}");
    
    let session_state = state.parse::<SessionState>()
        .map_err(|e| format!("Invalid session state: {e}"))?;
    
    let core = get_para_core().await?;
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    manager.list_sessions_by_state(session_state)
        .map_err(|e| format!("Failed to list sessions by state: {e}"))
}
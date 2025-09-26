#![deny(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]
#![deny(clippy::match_wild_err_arm)] // Deny catch-all error patterns without proper handling
#![deny(clippy::let_underscore_lock)] // Deny discarding locks which could be a silent error

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

// Binary-only modules (not part of lib)
mod cleanup;
mod cli;
mod commands;
mod diff_commands;
mod diff_engine;
mod file_utils;
mod macos_prefs;
mod mcp_api;
mod permissions;
mod project_manager;
mod projects;

use project_manager::ProjectManager;
use schaltwerk::infrastructure::config::SettingsManager;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::OnceCell;

// Import all commands
use commands::*;

#[tauri::command]
fn get_development_info() -> Result<serde_json::Value, String> {
    // Only return development info in debug builds
    if cfg!(debug_assertions) {
        // Get current git branch
        let branch_result = std::fs::canonicalize(std::env::current_dir().unwrap_or_default())
            .ok()
            .and_then(|cwd| git2::Repository::discover(cwd).ok())
            .and_then(|repo| {
                repo.head()
                    .ok()
                    .and_then(|h| h.shorthand().map(|s| s.to_string()))
            });

        let branch = branch_result.unwrap_or_default();

        Ok(serde_json::json!({
            "isDevelopment": true,
            "branch": branch
        }))
    } else {
        Ok(serde_json::json!({
            "isDevelopment": false,
            "branch": null
        }))
    }
}

fn open_global_app_config_db() -> Result<schaltwerk::schaltwerk_core::Database, String> {
    if let Ok(path) = std::env::var("SCHALTWERK_APP_CONFIG_DB_PATH") {
        let db_path = PathBuf::from(path);
        schaltwerk::schaltwerk_core::Database::new(Some(db_path))
            .map_err(|e| format!("Failed to open override app config database: {e}"))
    } else {
        schaltwerk::schaltwerk_core::Database::new(None)
            .map_err(|e| format!("Failed to open app config database: {e}"))
    }
}

#[tauri::command]
async fn get_default_open_app() -> Result<String, String> {
    match open_global_app_config_db() {
        Ok(db) => schaltwerk::open_apps::get_default_open_app_from_db(&db)
            .map_err(|e| format!("Failed to load default open app: {e}"))
            .or_else(|e| {
                log::warn!(
                    "Failed to load default open app from database: {e}. Falling back to Finder"
                );
                Ok("finder".into())
            }),
        Err(e) => {
            log::warn!("Failed to access app config database: {e}. Falling back to Finder");
            Ok("finder".into())
        }
    }
}

#[tauri::command]
async fn set_default_open_app(app_id: String) -> Result<(), String> {
    let db = open_global_app_config_db()?;
    schaltwerk::open_apps::set_default_open_app_in_db(&db, &app_id)
        .map_err(|e| format!("Failed to store default open app: {e}"))
}

pub static PROJECT_MANAGER: OnceCell<Arc<ProjectManager>> = OnceCell::const_new();
pub static SETTINGS_MANAGER: OnceCell<Arc<Mutex<SettingsManager>>> = OnceCell::const_new();
pub static FILE_WATCHER_MANAGER: OnceCell<Arc<schaltwerk::domains::workspace::FileWatcherManager>> =
    OnceCell::const_new();

pub async fn get_project_manager() -> Arc<ProjectManager> {
    PROJECT_MANAGER
        .get_or_init(|| async { Arc::new(ProjectManager::new()) })
        .await
        .clone()
}

pub async fn get_terminal_manager(
) -> Result<Arc<schaltwerk::domains::terminal::TerminalManager>, String> {
    let manager = get_project_manager().await;
    manager
        .current_terminal_manager()
        .await
        .map_err(|e| format!("Failed to get terminal manager: {e}"))
}

pub async fn get_schaltwerk_core(
) -> Result<Arc<tokio::sync::Mutex<schaltwerk::schaltwerk_core::SchaltwerkCore>>, String> {
    let manager = get_project_manager().await;
    manager.current_schaltwerk_core().await.map_err(|e| {
        log::error!("Failed to get para core: {e}");
        format!("Failed to get para core: {e}")
    })
}

pub async fn get_file_watcher_manager(
) -> Result<Arc<schaltwerk::domains::workspace::FileWatcherManager>, String> {
    FILE_WATCHER_MANAGER
        .get()
        .ok_or_else(|| "File watcher manager not initialized".to_string())
        .cloned()
}

#[tauri::command]
async fn start_file_watcher(session_name: String) -> Result<(), String> {
    let schaltwerk_core = get_schaltwerk_core().await?;
    let core = schaltwerk_core.lock().await;
    let session_manager = core.session_manager();

    let sessions = session_manager
        .list_enriched_sessions()
        .map_err(|e| format!("Failed to get sessions: {e}"))?;

    let session = sessions
        .into_iter()
        .find(|s| s.info.session_id == session_name)
        .ok_or_else(|| format!("Session '{session_name}' not found"))?;

    let watcher_manager = get_file_watcher_manager().await?;

    watcher_manager
        .start_watching_session(
            session_name,
            std::path::PathBuf::from(session.info.worktree_path),
            session.info.base_branch,
        )
        .await
}

#[tauri::command]
async fn stop_file_watcher(session_name: String) -> Result<(), String> {
    let watcher_manager = get_file_watcher_manager().await?;
    watcher_manager.stop_watching_session(&session_name).await
}

#[tauri::command]
async fn is_file_watcher_active(session_name: String) -> Result<bool, String> {
    let watcher_manager = get_file_watcher_manager().await?;
    Ok(watcher_manager.is_watching(&session_name).await)
}

#[tauri::command]
async fn get_active_file_watchers() -> Result<Vec<String>, String> {
    let watcher_manager = get_file_watcher_manager().await?;
    Ok(watcher_manager.get_active_watchers().await)
}

use http_body_util::BodyExt;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{body::Incoming as IncomingBody, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

async fn find_available_port(base_port: u16) -> u16 {
    // Try the base port first
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", base_port)).await {
        drop(listener);
        return base_port;
    }

    // Try a few common alternative ports (reduced from 6 to 3 for speed)
    let preferred_ports = [8548, 8549, 8550];
    for port in preferred_ports {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            drop(listener);
            return port;
        }
    }

    // Fallback to sequential search with smaller range (reduced from 20 to 5)
    for port in base_port + 1..base_port + 6 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            drop(listener);
            return port;
        }
    }

    base_port // Ultimate fallback
}

fn calculate_project_port(project_path: &str) -> u16 {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    let hash = hasher.finalize();

    // Use first 2 bytes of hash to generate a port in range 8547-8647
    let port_offset = ((hash[0] as u16) << 8 | hash[1] as u16) % 100;
    8547 + port_offset
}

async fn start_webhook_server(app: tauri::AppHandle) -> bool {
    async fn handle_webhook(
        app: tauri::AppHandle,
        req: Request<IncomingBody>,
    ) -> Result<Response<String>, hyper::Error> {
        let method = req.method();
        let path = req.uri().path();

        log::debug!("Webhook request: {method} {path}");

        match (method, path) {
            (&hyper::Method::POST, "/webhook/session-added") => {
                // Parse the JSON body
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();

                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received session-added webhook: {payload}");

                        // Extract session information and emit the event
                        if let Some(session_name) =
                            payload.get("session_name").and_then(|v| v.as_str())
                        {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionAddedPayload {
                                session_name: String,
                                branch: String,
                                worktree_path: String,
                                parent_branch: String,
                                created_at: String,
                                last_modified: Option<String>,
                            }

                            let session_payload = SessionAddedPayload {
                                session_name: session_name.to_string(),
                                branch: payload
                                    .get("branch")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                worktree_path: payload
                                    .get("worktree_path")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                parent_branch: payload
                                    .get("parent_branch")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                created_at: payload
                                    .get("created_at")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                last_modified: payload
                                    .get("last_modified")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            };

                            if let Err(e) =
                                emit_event(&app, SchaltEvent::SessionAdded, &session_payload)
                            {
                                log::error!("Failed to emit session-added event: {e}");
                            }
                        }
                    }
                }

                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/session-removed") => {
                // Parse the JSON body for session removal
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();

                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received session-removed webhook: {payload}");

                        if let Some(session_name) =
                            payload.get("session_name").and_then(|v| v.as_str())
                        {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionRemovedPayload {
                                session_name: String,
                            }

                            let session_payload = SessionRemovedPayload {
                                session_name: session_name.to_string(),
                            };

                            if let Err(e) =
                                emit_event(&app, SchaltEvent::SessionRemoved, &session_payload)
                            {
                                log::error!("Failed to emit session-removed event: {e}");
                            }
                        }
                    }
                }

                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/follow-up-message") => {
                // Parse the JSON body for follow-up message
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();

                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received follow-up-message webhook: {payload}");

                        if let (Some(session_name), Some(message)) = (
                            payload.get("session_name").and_then(|v| v.as_str()),
                            payload.get("message").and_then(|v| v.as_str()),
                        ) {
                            let timestamp = payload
                                .get("timestamp")
                                .and_then(|v| v.as_u64())
                                .unwrap_or_else(|| {
                                    std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_millis() as u64
                                });

                            // Move reviewed sessions back to running upon follow-up (only if reviewed)
                            if let Ok(core) = get_schaltwerk_core().await {
                                let core = core.lock().await;
                                let manager = core.session_manager();
                                match manager.unmark_reviewed_on_follow_up(session_name) {
                                    Ok(true) => {
                                        log::info!("Follow-up unmarked review state for '{session_name}', emitting SessionsRefreshed");
                                        if let Ok(sessions) = manager.list_enriched_sessions() {
                                            if let Err(e) = emit_event(
                                                &app,
                                                SchaltEvent::SessionsRefreshed,
                                                &sessions,
                                            ) {
                                                log::warn!("Failed to emit sessions-refreshed after follow-up: {e}");
                                            }
                                        }
                                    }
                                    Ok(false) => {
                                        log::debug!("Follow-up received for '{session_name}' with no review state to clear");
                                    }
                                    Err(e) => {
                                        log::warn!("Failed to process follow-up review state for '{session_name}': {e}");
                                    }
                                }
                            } else {
                                log::warn!("Could not access SchaltwerkCore to update session state on follow-up");
                            }

                            let terminal_id = format!("session-{session_name}-top");

                            if let Ok(manager) = get_terminal_manager().await {
                                match manager.terminal_exists(&terminal_id).await {
                                    Ok(true) => {
                                        if let Err(e) = manager
                                            .paste_and_submit_terminal(
                                                terminal_id.clone(),
                                                message.as_bytes().to_vec(),
                                            )
                                            .await
                                        {
                                            log::warn!("Failed to paste follow-up message to terminal {terminal_id}: {e}");
                                        } else {
                                            log::info!("Successfully pasted follow-up message to terminal {terminal_id}");
                                        }
                                    }
                                    Ok(false) => {
                                        log::warn!("Terminal {terminal_id} doesn't exist - cannot deliver message");
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "Failed to check if terminal {terminal_id} exists: {e}"
                                        );
                                    }
                                }
                            } else {
                                log::warn!("Could not get terminal manager for follow-up message");
                            }

                            #[derive(serde::Serialize, Clone)]
                            struct FollowUpMessagePayload {
                                session_name: String,
                                message: String,
                                timestamp: u64,
                                terminal_id: String,
                            }

                            let message_payload = FollowUpMessagePayload {
                                session_name: session_name.to_string(),
                                message: message.to_string(),
                                timestamp,
                                terminal_id,
                            };

                            if let Err(e) =
                                emit_event(&app, SchaltEvent::FollowUpMessage, &message_payload)
                            {
                                log::error!("Failed to emit follow-up-message event: {e}");
                            }
                        }
                    }
                }

                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/spec-created") => {
                // Parse the JSON body for spec creation notification
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();

                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received spec-created webhook: {payload}");

                        if let Some(draft_name) =
                            payload.get("session_name").and_then(|v| v.as_str())
                        {
                            log::info!("Spec created via MCP: {draft_name}");

                            // Emit sessions-refreshed event to trigger UI updates
                            // We emit with empty array since UI components will fetch what they need
                            // (specs via list_sessions_by_state, sessions via list_enriched_sessions)
                            log::info!("Emitting sessions-refreshed event after MCP spec creation");
                            if let Err(e) = emit_event(
                                &app,
                                SchaltEvent::SessionsRefreshed,
                                &Vec::<schaltwerk::schaltwerk_core::EnrichedSession>::new(),
                            ) {
                                log::error!("Failed to emit sessions-refreshed event: {e}");
                            }

                            // Don't emit Selection event - let the user stay focused on their current session
                            // The spec will appear in the sidebar but won't steal focus
                            log::info!("Spec created via MCP: {draft_name} - preserving current user focus");
                        } else {
                            log::warn!("Spec-created webhook payload missing 'name' field");
                        }
                    } else {
                        log::warn!("Failed to parse spec-created webhook JSON payload");
                    }
                } else {
                    log::warn!("Failed to convert spec-created webhook body to UTF-8");
                }

                Ok(Response::new("OK".to_string()))
            }
            // Delegate all MCP API endpoints to the api module
            (_, path) if path.starts_with("/api/") => mcp_api::handle_mcp_request(req, app).await,
            _ => {
                let mut response = Response::new("Not Found".to_string());
                *response.status_mut() = StatusCode::NOT_FOUND;
                Ok(response)
            }
        }
    }

    // Calculate project-specific port
    let project_manager = get_project_manager().await;
    let base_port = if let Some(active_project) = project_manager.current_project_path().await {
        let project_str = active_project.to_string_lossy();
        let calculated_port = calculate_project_port(&project_str);
        log::info!("Using project-specific base port {calculated_port} for project: {project_str}");
        calculated_port
    } else {
        log::info!("No active project, using default base port 8547");
        8547
    };

    // Find an available port starting from the base port
    let port = find_available_port(base_port).await;
    let addr = ("127.0.0.1", port);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::warn!("Failed to start webhook server on {addr:?}: {e}");
            return false;
        }
    };

    log::info!("Webhook server listening on http://{}:{}", addr.0, addr.1);

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::error!("Failed to accept webhook connection: {e}");
                continue;
            }
        };

        let io = TokioIo::new(stream);
        let app_clone = app.clone();

        tokio::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(
                    io,
                    service_fn(move |req| handle_webhook(app_clone.clone(), req)),
                )
                .await
            {
                log::error!("Error serving webhook connection: {err:?}");
            }
        });
    }
}

use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use tauri::Manager;

fn main() {
    // Initialize logging
    schaltwerk::infrastructure::logging::init_logging();
    log::info!("Schaltwerk starting...");

    // macOS: disable smart quotes/dashes/text substitutions app-wide
    macos_prefs::disable_smart_substitutions();
    // macOS smart substitutions: handled in frontend for now

    // Parse command line arguments using Clap (positional DIR)
    use clap::Parser;
    let cli = crate::cli::Cli::parse();

    // Determine effective directory: positional arg, SCHALTWERK_START_DIR env var, or current dir
    let dir_path = match cli.dir {
        Some(p) => p,
        None => {
            // Check for SCHALTWERK_START_DIR environment variable first (used by 'just run')
            if let Ok(start_dir) = std::env::var("SCHALTWERK_START_DIR") {
                log::info!("Using SCHALTWERK_START_DIR: {start_dir}");
                std::path::PathBuf::from(start_dir)
            } else {
                match std::env::current_dir() {
                    Ok(cwd) => cwd,
                    Err(e) => {
                        log::warn!("Failed to get current working directory: {e}");
                        std::path::PathBuf::from(".")
                    }
                }
            }
        }
    };
    log::info!("Startup directory: {}", dir_path.display());

    let dir_str = dir_path.to_string_lossy().to_string();

    // Always return the directory if it exists - git check will happen in background
    let initial_directory: Option<(String, Option<bool>)> = if dir_path.is_dir() {
        Some((dir_str.clone(), None)) // None means git status unknown, will be determined in background
    } else {
        log::warn!(
            "❌ Invalid directory path: {}, opening at home",
            dir_path.display()
        );
        None
    };

    // Create cleanup guard that will run on exit
    let _cleanup_guard = cleanup::TerminalCleanupGuard;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // Development info
            get_development_info,
            // Permission commands
            permissions::check_folder_access,
            permissions::trigger_folder_permission_request,
            permissions::ensure_folder_permission,
            // Terminal commands
            create_terminal,
            create_terminal_with_size,
            create_run_terminal,
            write_terminal,
            paste_and_submit_terminal,
            resize_terminal,
            close_terminal,
            terminal_exists,
            terminals_exist_bulk,
            get_terminal_buffer,
            get_terminal_activity_status,
            get_all_terminal_activity,
            register_session_terminals,
            suspend_session_terminals,
            resume_session_terminals,
            // Utility commands
            get_current_directory,
            open_in_vscode,
            path_exists,
            get_app_version,
            schaltwerk_core_log_frontend_message,
            // Clipboard
            #[cfg(target_os = "macos")] commands::clipboard::clipboard_write_text,
            // MCP commands
            start_mcp_server,
            // Para core commands
            schaltwerk_core_create_session,
            schaltwerk_core_rename_version_group,
            schaltwerk_core_list_sessions,
            schaltwerk_core_list_enriched_sessions,
            schaltwerk_core_list_enriched_sessions_sorted,
            schaltwerk_core_get_session,
            schaltwerk_core_get_session_agent_content,
            schaltwerk_core_cancel_session,
            schaltwerk_core_convert_session_to_draft,
            schaltwerk_core_update_git_stats,
            schaltwerk_core_cleanup_orphaned_worktrees,
            schaltwerk_core_start_claude,
            schaltwerk_core_start_claude_with_restart,
            schaltwerk_core_start_claude_orchestrator,
            schaltwerk_core_start_fresh_orchestrator,
            schaltwerk_core_reset_orchestrator,
            schaltwerk_core_reset_session_worktree,
            schaltwerk_core_discard_file_in_session,
            schaltwerk_core_discard_file_in_orchestrator,
            schaltwerk_core_set_skip_permissions,
            schaltwerk_core_get_skip_permissions,
            schaltwerk_core_set_orchestrator_skip_permissions,
            schaltwerk_core_get_orchestrator_skip_permissions,
            schaltwerk_core_get_merge_preview,
            schaltwerk_core_merge_session_to_main,
            schaltwerk_core_mark_session_ready,
            schaltwerk_core_has_uncommitted_changes,
            schaltwerk_core_unmark_session_ready,
            schaltwerk_core_set_agent_type,
            schaltwerk_core_set_session_agent_type,
            schaltwerk_core_get_agent_type,
            schaltwerk_core_set_orchestrator_agent_type,
            schaltwerk_core_get_orchestrator_agent_type,
            schaltwerk_core_get_font_sizes,
            schaltwerk_core_set_font_sizes,
            schaltwerk_core_create_spec_session,
            schaltwerk_core_create_and_start_spec_session,
            schaltwerk_core_start_spec_session,
            schaltwerk_core_update_session_state,
            schaltwerk_core_update_spec_content,
            schaltwerk_core_append_spec_content,
            schaltwerk_core_rename_draft_session,
            schaltwerk_core_list_sessions_by_state,
            schaltwerk_core_archive_spec_session,
            schaltwerk_core_list_archived_specs,
            schaltwerk_core_restore_archived_spec,
            schaltwerk_core_delete_archived_spec,
            schaltwerk_core_get_archive_max_entries,
            schaltwerk_core_set_archive_max_entries,
            schaltwerk_core_list_project_files,
            // Open apps commands
            get_default_open_app,
            set_default_open_app,
            schaltwerk::open_apps::list_available_open_apps,
            schaltwerk::open_apps::open_in_app,
            // Diff commands (from module)
            diff_commands::get_changed_files_from_main,
            diff_commands::get_orchestrator_working_changes,
            diff_commands::get_file_diff_from_main,
            diff_commands::get_current_branch_name,
            diff_commands::get_base_branch_name,
            diff_commands::get_commit_comparison_info,
            diff_commands::compute_unified_diff_backend,
            diff_commands::compute_split_diff_backend,
            diff_commands::get_git_history,
            diff_commands::get_commit_files,
            diff_commands::get_commit_file_contents,
            // Project commands
            get_recent_projects,
            add_recent_project,
            update_recent_project_timestamp,
            remove_recent_project,
            is_git_repository,
            directory_exists,
            create_new_project,
            initialize_project,
            get_project_default_branch,
            list_project_branches,
            repository_is_empty,
            get_active_project_path,
            close_project,
            // Settings commands
            get_project_default_base_branch,
            set_project_default_base_branch,
            get_agent_env_vars,
            set_agent_env_vars,
            get_agent_cli_args,
            set_agent_cli_args,
            get_terminal_ui_preferences,
            set_terminal_collapsed,
            set_terminal_divider_position,
            get_terminal_settings,
            set_terminal_settings,
            list_installed_fonts,
            get_diff_view_preferences,
            set_diff_view_preferences,
            get_session_preferences,
            set_session_preferences,
            get_auto_commit_on_review,
            set_auto_commit_on_review,
            get_keyboard_shortcuts,
            set_keyboard_shortcuts,
            get_project_settings,
            set_project_settings,
            get_project_selection,
            set_project_selection,
            get_project_sessions_settings,
            set_project_sessions_settings,
            get_project_environment_variables,
            set_project_environment_variables,
            get_project_action_buttons,
            set_project_action_buttons,
            reset_project_action_buttons_to_defaults,
            get_project_run_script,
            set_project_run_script,
            get_tutorial_completed,
            set_tutorial_completed,
            // Agent binary commands
            detect_agent_binaries,
            get_agent_binary_config,
            set_agent_binary_path,
            get_effective_agent_binary_path,
            get_all_agent_binary_configs,
            detect_all_agent_binaries,
            refresh_agent_binary_detection,
            // File watcher commands
            start_file_watcher,
            stop_file_watcher,
            is_file_watcher_active,
            get_active_file_watchers,
            // MCP configuration commands
            get_mcp_status,
            configure_mcp_for_project,
            remove_mcp_for_project,
            ensure_mcp_gitignored
        ])
        .setup(move |app| {
            // Get current git branch and update window title asynchronously
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let branch_name = tokio::task::spawn_blocking(|| {
                    std::fs::canonicalize(std::env::current_dir().unwrap_or_default()).ok()
                        .and_then(|cwd| git2::Repository::discover(cwd).ok())
                        .and_then(|repo| repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string())))
                }).await.ok().flatten();

                if let Some(window) = app_handle.get_webview_window("main") {
                    let title = if let Some(branch) = branch_name {
                        if !branch.is_empty() { format!("Schaltwerk - {branch}") } else { "Schaltwerk".to_string() }
                    } else { "Schaltwerk".to_string() };

                    if let Err(e) = window.set_title(&title) {
                        log::warn!("Failed to set window title: {e}");
                    } else {
                        log::info!("Window title set to: {title}");
                    }
                }
            });

            // Check git status and initialize project in background
            if let Some((dir, _)) = initial_directory.clone() {
                let dir_path = std::path::PathBuf::from(&dir);
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Check if it's a Git repository in background thread
                    let is_git = match git2::Repository::discover(&dir_path) {
                        Ok(_) => {
                            log::info!("✅ Detected Git repository: {}", dir_path.display());
                            true
                        }
                        Err(_) => {
                            log::info!("Directory {} is not a Git repository, will open at home screen", dir_path.display());
                            false
                        }
                    };

                    if is_git {
                        let manager = get_project_manager().await;
                        if let Err(e) = manager.switch_to_project(dir_path.clone()).await {
                            log::error!("Failed to set initial project: {e}");
                        } else {
                            log::info!("Initial project set to: {}", dir_path.display());
                            // Emit project-ready event to notify frontend
                            if let Err(e) = emit_event(&app_handle, SchaltEvent::ProjectReady, &dir_path.display().to_string()) {
                                log::error!("Failed to emit project-ready event: {e}");
                            }
                        }

                        // Emit event to open the Git repository
                        if let Err(e) = emit_event(&app_handle, SchaltEvent::OpenDirectory, &dir) {
                            log::error!("Failed to emit open-directory event: {e}");
                        }
                    } else {
                        // Emit event to open home screen (non-Git directory)
                        if let Err(e) = emit_event(&app_handle, SchaltEvent::OpenHome, &dir) {
                            log::error!("Failed to emit open-home event: {e}");
                        }
                    }
                });
            }


            // Initialize settings manager asynchronously
            let settings_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match SettingsManager::new(&settings_handle) {
                    Ok(manager) => {
                        let arc_mgr = Arc::new(Mutex::new(manager));
                        let _ = SETTINGS_MANAGER.set(arc_mgr.clone());
                        log::info!("Settings manager initialized successfully");

                        // Propagate terminal shell preferences to the domain layer
                        let (shell, args) = {
                            let mgr = arc_mgr.lock().await;
                            let term = mgr.get_terminal_settings();
                            let shell = term.shell.unwrap_or_else(|| {
                                std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
                            });
                            (shell, term.shell_args)
                        };
                        schaltwerk::domains::terminal::put_terminal_shell_override(shell, args);
                    }
                    Err(e) => {
                        log::error!("Failed to initialize settings manager: {e}");
                    }
                }
            });

            // Initialize file watcher manager
            let file_watcher_handle = app.handle().clone();
            let _ = FILE_WATCHER_MANAGER.set(Arc::new(schaltwerk::domains::workspace::FileWatcherManager::new(file_watcher_handle)));

            // Defer non-critical services to improve startup performance
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tokio::time::{sleep, Duration};

                // Small delay to let UI appear first
                sleep(Duration::from_millis(50)).await;

                // Start terminal monitoring


                // Start activity tracking
                let activity_handle = app_handle.clone();
                tokio::spawn(async move {
                    // Retry until a project is initialized, then start tracking once
                    loop {
                        match get_schaltwerk_core().await {
                            Ok(core) => {
                                let db = {
                                    let core_lock = core.lock().await;
                                    Arc::new(core_lock.db.clone())
                                };
                                schaltwerk::domains::sessions::activity::start_activity_tracking_with_app(db, activity_handle.clone());
                                break;
                            }
                            Err(e) => {
                                log::debug!("No active project for activity tracking: {e}");
                                sleep(Duration::from_secs(2)).await;
                            }
                        }
                    }
                });

                // Start webhook server for MCP notifications
                let webhook_handle = app_handle.clone();
                tokio::spawn(async move {
                    if !start_webhook_server(webhook_handle).await {
                        log::warn!("Webhook server failed to start - likely another instance is running");
                    }
                });
            });

            // MCP server is now managed by Claude Code via .mcp.json configuration
            // No need to start it from Schaltwerk

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Cleanup all project terminals when window is closed
                tauri::async_runtime::block_on(async {
                    let manager = get_project_manager().await;
                    manager.cleanup_all().await;
                });

                // Stop all file watchers
                tauri::async_runtime::block_on(async {
                    if let Ok(watcher_manager) = get_file_watcher_manager().await {
                        watcher_manager.stop_all_watchers().await;
                    }
                });

                // Stop MCP server if running
                if let Some(process_mutex) = commands::mcp::get_mcp_server_process().get() {
                    if let Ok(mut guard) = process_mutex.try_lock() {
                        if let Some(mut process) = guard.take() {
                            let _ = process.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn test_default_open_app_command_flow() {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let override_path = temp_dir.path().join("sessions.db");
        std::env::set_var(
            "SCHALTWERK_APP_CONFIG_DB_PATH",
            override_path.to_string_lossy().as_ref(),
        );

        let fallback = super::get_default_open_app()
            .await
            .expect("expected fallback default app");
        assert_eq!(fallback, "finder");

        super::set_default_open_app("vscode".into())
            .await
            .expect("failed to set default app");

        let updated = super::get_default_open_app()
            .await
            .expect("expected updated default app");
        assert_eq!(updated, "vscode");

        std::env::remove_var("SCHALTWERK_APP_CONFIG_DB_PATH");
    }
}

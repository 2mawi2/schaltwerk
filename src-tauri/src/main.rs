// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(dead_code)]
#![warn(unused_imports)]
#![warn(unused_variables)]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod cleanup;
mod diff_commands;
mod file_utils;
mod logging;
mod terminal;
mod para_core;
mod open_apps;
mod projects;
mod project_manager;
mod settings;
mod mcp_api;
mod commands;
mod permissions;

use std::sync::Arc;
use project_manager::ProjectManager;
use settings::SettingsManager;
use tokio::sync::OnceCell;
use std::collections::HashMap;
use tokio::sync::Mutex;

// Import all commands
use commands::*;

#[tauri::command]
fn get_development_info() -> Result<serde_json::Value, String> {
    // Only return development info in debug builds
    if cfg!(debug_assertions) {
        // Get current git branch
        let branch_result = std::process::Command::new("git")
            .arg("branch")
            .arg("--show-current")
            .output();
        
        let branch = match branch_result {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            }
            _ => String::new()
        };
        
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

pub static PROJECT_MANAGER: OnceCell<Arc<ProjectManager>> = OnceCell::const_new();
pub static SETTINGS_MANAGER: OnceCell<Arc<Mutex<SettingsManager>>> = OnceCell::const_new();

#[derive(Clone, Debug)]
pub struct QueuedMessage {
    pub message: String,
    pub message_type: String,
    pub timestamp: u64,
}

pub type MessageQueue = Arc<Mutex<HashMap<String, Vec<QueuedMessage>>>>;
pub static QUEUED_MESSAGES: OnceCell<MessageQueue> = OnceCell::const_new();

pub fn parse_agent_command(command: &str) -> Result<(String, String, Vec<String>), String> {
    // Command format: "cd /path/to/worktree && {claude|cursor-agent|<path>/opencode|opencode|gemini} [args]"
    let parts: Vec<&str> = command.split(" && ").collect();
    if parts.len() != 2 {
        return Err(format!("Invalid command format: {command}"));
    }
    
    // Extract working directory from cd command
    let cd_part = parts[0];
    if !cd_part.starts_with("cd ") {
        return Err(format!("Command doesn't start with 'cd': {command}"));
    }
    let cwd = cd_part[3..].to_string();
    
    // Parse agent command and arguments
    let agent_part = parts[1];
    // Extract the agent token (first whitespace-delimited token)
    let mut split = agent_part.splitn(2, ' ');
    let agent_token = split.next().unwrap_or("");
    let rest = split.next().unwrap_or("");

    // Normalize/validate the agent token
    let is_opencode = agent_token == "opencode" || agent_token.ends_with("/opencode");
    let is_gemini = agent_token == "gemini" || agent_token.ends_with("/gemini");
    let is_codex = agent_token == "codex" || agent_token.ends_with("/codex");
    let agent_name = if agent_token == "claude" {
        "claude"
    } else if agent_token == "cursor-agent" {
        "cursor-agent"
    } else if agent_token == "codex" {
        "codex"
    } else if is_opencode || is_gemini || is_codex {
        agent_token
    } else {
        return Err(format!("Second part doesn't start with 'claude', 'cursor-agent', 'opencode', 'gemini', or 'codex': {command}"));
    };

    // Split the rest into arguments, handling quoted strings
    let mut args = Vec::new();
    let mut current_arg = String::new();
    let mut in_quotes = false;
    let mut chars = rest.chars().peekable();
    
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                if !in_quotes && !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            ' ' if !in_quotes => {
                if !current_arg.is_empty() {
                    args.push(current_arg.clone());
                    current_arg.clear();
                }
            }
            '\\' if in_quotes => {
                // Handle escaped characters in quotes
                if let Some(next_ch) = chars.next() {
                    if next_ch == '"' {
                        current_arg.push('"');
                    } else {
                        current_arg.push('\\');
                        current_arg.push(next_ch);
                    }
                }
            }
            _ => {
                current_arg.push(ch);
            }
        }
    }
    
    // Add any remaining argument
    if !current_arg.is_empty() {
        args.push(current_arg);
    }
    
    Ok((cwd, agent_name.to_string(), args))
}

pub async fn get_project_manager() -> Arc<ProjectManager> {
    PROJECT_MANAGER.get_or_init(|| async {
        Arc::new(ProjectManager::new())
    }).await.clone()
}

pub async fn get_terminal_manager() -> Result<Arc<terminal::TerminalManager>, String> {
    let manager = get_project_manager().await;
    manager.current_terminal_manager().await
        .map_err(|e| format!("Failed to get terminal manager: {e}"))
}

pub async fn get_para_core() -> Result<Arc<tokio::sync::Mutex<para_core::SchaltwerkCore>>, String> {
    let manager = get_project_manager().await;
    manager.current_para_core().await
        .map_err(|e| {
            log::error!("Failed to get para core: {e}");
            format!("Failed to get para core: {e}")
        })
}

pub async fn get_message_queue() -> MessageQueue {
    QUEUED_MESSAGES.get_or_init(|| async {
        Arc::new(Mutex::new(HashMap::new()))
    }).await.clone()
}

async fn start_terminal_monitoring(app: tauri::AppHandle) {
    use tauri::Emitter;
    use tokio::time::{interval, Duration};
    use serde::Serialize;
    use std::collections::HashSet;
    
    #[derive(Serialize, Clone)]
    struct TerminalStuckNotification {
        terminal_id: String,
        session_id: Option<String>,
        elapsed_seconds: u64,
    }
    
    #[derive(Serialize, Clone)]
    struct TerminalUnstuckNotification {
        terminal_id: String,
        session_id: Option<String>,
    }
    
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(5)); // Check more frequently for better responsiveness
        let mut previously_stuck = HashSet::new();
        
        loop {
            interval.tick().await;
            
            let manager = match get_terminal_manager().await {
                Ok(m) => m,
                Err(_) => {
                    // Skip monitoring when no active project - this is normal during startup
                    continue;
                }
            };
            let stuck_terminals = manager.get_all_terminal_activity().await;
            let mut currently_stuck = HashSet::new();
            
            for (terminal_id, is_stuck, elapsed) in stuck_terminals {
                if is_stuck {
                    currently_stuck.insert(terminal_id.clone());
                    
                    // Only notify if this terminal wasn't previously stuck
                    if !previously_stuck.contains(&terminal_id) {
                        let session_id = if terminal_id.starts_with("session-") {
                            terminal_id.split('-').nth(1).map(|s| s.to_string())
                        } else {
                            None
                        };
                        
                        let notification = TerminalStuckNotification {
                            terminal_id: terminal_id.clone(),
                            session_id,
                            elapsed_seconds: elapsed,
                        };
                        
                        log::info!("Terminal {terminal_id} became idle after {elapsed} seconds");
                        
                        if let Err(e) = app.emit("schaltwerk:terminal-stuck", &notification) {
                            log::error!("Failed to emit terminal stuck notification: {e}");
                        }
                    }
                } else {
                    // Terminal is not stuck - check if it was previously stuck to emit unstuck event
                    if previously_stuck.contains(&terminal_id) {
                        let session_id = if terminal_id.starts_with("session-") {
                            terminal_id.split('-').nth(1).map(|s| s.to_string())
                        } else {
                            None
                        };
                        
                        let notification = TerminalUnstuckNotification {
                            terminal_id: terminal_id.clone(),
                            session_id,
                        };
                        
                        log::info!("Terminal {terminal_id} became active again");
                        
                        if let Err(e) = app.emit("schaltwerk:terminal-unstuck", &notification) {
                            log::error!("Failed to emit terminal unstuck notification: {e}");
                        }
                    }
                }
            }
            
            // Update the set of previously stuck terminals for next iteration
            previously_stuck = currently_stuck;
        }
    });
}

use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{body::Incoming as IncomingBody, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use http_body_util::BodyExt;

async fn start_webhook_server(app: tauri::AppHandle) {
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
                        if let Some(session_name) = payload.get("session_name").and_then(|v| v.as_str()) {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionAddedPayload {
                                session_name: String,
                                branch: String,
                                worktree_path: String,
                                parent_branch: String,
                            }
                            
                            let session_payload = SessionAddedPayload {
                                session_name: session_name.to_string(),
                                branch: payload.get("branch").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                worktree_path: payload.get("worktree_path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                parent_branch: payload.get("parent_branch").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:session-added", &session_payload) {
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
                        
                        if let Some(session_name) = payload.get("session_name").and_then(|v| v.as_str()) {
                            #[derive(serde::Serialize, Clone)]
                            struct SessionRemovedPayload {
                                session_name: String,
                            }
                            
                            let session_payload = SessionRemovedPayload {
                                session_name: session_name.to_string(),
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:session-removed", &session_payload) {
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
                            payload.get("message").and_then(|v| v.as_str())
                        ) {
                            let message_type = payload.get("message_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("user");
                            let timestamp = payload.get("timestamp")
                                .and_then(|v| v.as_u64())
                                .unwrap_or_else(|| std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap().as_millis() as u64);
                            
                            // Format the message for terminal display
                            let formatted_message = match message_type {
                                "system" => format!("\n📢 System: {message}\n"),
                                _ => format!("\n💬 Follow-up: {message}\n"),
                            };
                            
                            // Try to write to the session's top terminal (where agent is usually active)
                            let terminal_id = format!("session-{session_name}-top");
                            
                            if let Ok(manager) = get_terminal_manager().await {
                                match manager.terminal_exists(&terminal_id).await {
                                    Ok(true) => {
                                        // Terminal exists, write the message directly
                                        if let Err(e) = manager.write_terminal(terminal_id.clone(), formatted_message.as_bytes().to_vec()).await {
                                            log::warn!("Failed to write follow-up message to terminal {terminal_id}: {e}");
                                        } else {
                                            log::info!("Successfully delivered follow-up message to terminal {terminal_id}");
                                        }
                                    },
                                    Ok(false) => {
                                        // Terminal doesn't exist yet - queue the message for later delivery
                                        log::info!("Terminal {terminal_id} doesn't exist yet, queuing message");
                                        let queue = get_message_queue().await;
                                        let mut queue_lock = queue.lock().await;
                                        let queued_msg = QueuedMessage {
                                            message: message.to_string(),
                                            message_type: message_type.to_string(),
                                            timestamp,
                                        };
                                        queue_lock.entry(terminal_id.clone()).or_insert_with(Vec::new).push(queued_msg);
                                        log::info!("Queued message for terminal {terminal_id}: {message}");
                                    },
                                    Err(e) => {
                                        log::warn!("Failed to check if terminal {terminal_id} exists: {e}");
                                    }
                                }
                            } else {
                                log::warn!("Could not get terminal manager for follow-up message");
                            }
                            
                            // Always emit event for frontend notification
                            #[derive(serde::Serialize, Clone)]
                            struct FollowUpMessagePayload {
                                session_name: String,
                                message: String,
                                message_type: String,
                                timestamp: u64,
                                terminal_id: String,
                            }
                            
                            let message_payload = FollowUpMessagePayload {
                                session_name: session_name.to_string(),
                                message: message.to_string(),
                                message_type: message_type.to_string(),
                                timestamp,
                                terminal_id,
                            };
                            
                            if let Err(e) = app.emit("schaltwerk:follow-up-message", &message_payload) {
                                log::error!("Failed to emit follow-up-message event: {e}");
                            }
                        }
                    }
                }
                
                Ok(Response::new("OK".to_string()))
            }
            (&hyper::Method::POST, "/webhook/draft-created") => {
                // Parse the JSON body for draft creation notification
                let body = req.into_body();
                let body_bytes = body.collect().await?.to_bytes();
                
                if let Ok(body_str) = String::from_utf8(body_bytes.to_vec()) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body_str) {
                        log::info!("Received draft-created webhook: {payload}");
                        
                        if let Some(draft_name) = payload.get("session_name").and_then(|v| v.as_str()) {
                            log::info!("Draft created via MCP: {draft_name}");
                            
                            // Emit sessions-refreshed event to trigger UI updates
                            // We emit with empty array since UI components will fetch what they need
                            // (drafts via list_sessions_by_state, sessions via list_enriched_sessions)
                            log::info!("Emitting sessions-refreshed event after MCP draft creation");
                            if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &Vec::<para_core::EnrichedSession>::new()) {
                                log::error!("Failed to emit sessions-refreshed event: {e}");
                            }
                            
                            // Emit selection event to automatically open the draft
                            log::info!("Emitting selection event to open draft: {draft_name}");
                            let selection = serde_json::json!({
                                "kind": "session",
                                "payload": draft_name
                            });
                            if let Err(e) = app.emit("schaltwerk:selection", &selection) {
                                log::error!("Failed to emit selection event: {e}");
                            }
                        } else {
                            log::warn!("Draft-created webhook payload missing 'name' field");
                        }
                    } else {
                        log::warn!("Failed to parse draft-created webhook JSON payload");
                    }
                } else {
                    log::warn!("Failed to convert draft-created webhook body to UTF-8");
                }
                
                Ok(Response::new("OK".to_string()))
            }
            // Delegate all MCP API endpoints to the mcp_api module
            (_, path) if path.starts_with("/api/") => {
                mcp_api::handle_mcp_request(req, app).await
            }
            _ => {
                let mut response = Response::new("Not Found".to_string());
                *response.status_mut() = StatusCode::NOT_FOUND;
                Ok(response)
            }
        }
    }
    
    // Start the webhook server on a local port
    let addr = "127.0.0.1:8547";
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::warn!("Failed to start webhook server on {addr}: {e}");
            return;
        }
    };
    
    log::info!("Webhook server listening on http://{addr}");
    
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
        
        tokio::task::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle_webhook(app_clone.clone(), req)))
                .await
            {
                log::error!("Error serving webhook connection: {err:?}");
            }
        });
    }
}

use tauri::{Emitter, Manager};

fn main() {
    // Initialize logging
    logging::init_logging();
    log::info!("Para UI starting...");
    
    // Parse command line arguments for directory
    let args: Vec<String> = std::env::args().collect();
    log::info!("Application started with {} arguments", args.len());
    for (i, arg) in args.iter().enumerate() {
        log::info!("  Arg[{i}]: {arg}");
    }
    
    // Also log current working directory
    if let Ok(cwd) = std::env::current_dir() {
        log::info!("Current working directory: {}", cwd.display());
    } else {
        log::warn!("Failed to get current working directory");
    }
    
    let initial_directory = if args.len() > 1 {
        // Skip the first argument (program name) and get the directory
        let dir_path = &args[1];
        log::info!("Attempting to open directory from argument: {dir_path}");
        
        // Validate that it's a valid directory
        if std::path::Path::new(dir_path).is_dir() {
            log::info!("Directory exists: {dir_path}");
            
            // Check if it's a Git repository
            let git_check = std::process::Command::new("git")
                .arg("-C")
                .arg(dir_path)
                .arg("rev-parse")
                .arg("--git-dir")
                .output();
            
            match git_check {
                Ok(output) if output.status.success() => {
                    log::info!("✅ Opening Schaltwerk with Git repository: {dir_path}");
                    Some((dir_path.clone(), true))
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    log::warn!("Git check failed for {dir_path}: {stderr}");
                    log::warn!("Directory {dir_path} is not a Git repository, will open at home screen");
                    // Still pass the directory info but mark it as non-Git
                    Some((dir_path.clone(), false))
                }
                Err(e) => {
                    log::error!("Failed to run git command: {e}");
                    log::warn!("Could not verify if {dir_path} is a Git repository");
                    Some((dir_path.clone(), false))
                }
            }
        } else {
            log::warn!("❌ Invalid directory path: {dir_path}, opening at home");
            None
        }
    } else {
        log::info!("No directory argument provided, opening at home screen");
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
            write_terminal,
            resize_terminal,
            close_terminal,
            terminal_exists,
            terminals_exist_bulk,
            get_terminal_buffer,
            get_terminal_activity_status,
            get_all_terminal_activity,
            // Utility commands
            get_current_directory,
            open_in_vscode,
            // MCP commands
            start_mcp_server,
            // Para core commands
            para_core_create_session,
            para_core_list_sessions,
            para_core_list_enriched_sessions,
            para_core_get_session,
            para_core_get_session_task_content,
            para_core_cancel_session,
            para_core_convert_session_to_draft,
            para_core_update_git_stats,
            para_core_cleanup_orphaned_worktrees,
            para_core_start_claude,
            para_core_start_claude_orchestrator,
            para_core_set_skip_permissions,
            para_core_get_skip_permissions,
            para_core_mark_session_ready,
            para_core_has_uncommitted_changes,
            para_core_unmark_session_ready,
            para_core_set_agent_type,
            para_core_get_agent_type,
            para_core_get_font_sizes,
            para_core_set_font_sizes,
            para_core_create_draft_session,
            para_core_start_draft_session,
            para_core_update_session_state,
            para_core_update_draft_content,
            para_core_append_draft_content,
            para_core_list_sessions_by_state,
            // Open apps commands (from module)
            open_apps::get_default_open_app,
            open_apps::set_default_open_app,
            open_apps::list_available_open_apps,
            open_apps::open_in_app,
            // Diff commands (from module)
            diff_commands::get_changed_files_from_main,
            diff_commands::get_file_diff_from_main,
            diff_commands::get_current_branch_name,
            diff_commands::get_base_branch_name,
            diff_commands::get_commit_comparison_info,
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
            get_project_settings,
            set_project_settings,
            get_project_selection,
            set_project_selection,
            get_project_sessions_settings,
            set_project_sessions_settings,
            get_project_environment_variables,
            set_project_environment_variables
        ])
        .setup(move |app| {
            // Get current git branch and update window title
            let branch_result = std::process::Command::new("git")
                .arg("branch")
                .arg("--show-current")
                .output();
            
            if let Some(window) = app.get_webview_window("main") {
                let title = match branch_result {
                    Ok(output) if output.status.success() => {
                        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !branch.is_empty() {
                            format!("Schaltwerk - {branch}")
                        } else {
                            "Schaltwerk".to_string()
                        }
                    }
                    _ => "Schaltwerk".to_string()
                };
                
                if let Err(e) = window.set_title(&title) {
                    log::warn!("Failed to set window title: {e}");
                } else {
                    log::info!("Window title set to: {title}");
                }
            }
            
            // Pass initial directory to the frontend if provided
            if let Some((dir, is_git)) = initial_directory.clone() {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Wait a moment for the window to be ready
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    
                    // Emit different events based on whether it's a Git repo
                    if is_git {
                        // Emit event to open the Git repository
                        if let Err(e) = app_handle.emit("schaltwerk:open-directory", &dir) {
                            log::error!("Failed to emit open-directory event: {e}");
                        }
                    } else {
                        // Emit event to open home screen (non-Git directory)
                        if let Err(e) = app_handle.emit("schaltwerk:open-home", &dir) {
                            log::error!("Failed to emit open-home event: {e}");
                        }
                    }
                });
            }
            
            // Initialize settings manager
            let settings_handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                match SettingsManager::new(&settings_handle) {
                    Ok(manager) => {
                        let _ = SETTINGS_MANAGER.set(Arc::new(Mutex::new(manager)));
                    }
                    Err(e) => {
                        log::error!("Failed to initialize settings manager: {e}");
                    }
                }
            });
            
            // Start activity tracking for para_core sessions
            let app_handle = app.handle().clone();
            
            // Start terminal monitoring for stuck detection
            let monitor_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                start_terminal_monitoring(monitor_handle).await;
            });
            tauri::async_runtime::spawn(async move {
                use tokio::time::{sleep, Duration};
                // Retry until a project is initialized, then start tracking once
                loop {
                    match get_para_core().await {
                        Ok(core) => {
                            let db = {
                                let core_lock = core.lock().await;
                                Arc::new(core_lock.db.clone())
                            };
                            para_core::activity::start_activity_tracking_with_app(db, app_handle.clone());
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
            let webhook_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_webhook_server(webhook_handle).await;
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
    use super::*;

    #[test]
    fn test_parse_agent_command_claude_with_prompt() {
        let cmd = r#"cd /tmp/work && claude --dangerously-skip-permissions "do the thing""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "claude");
        assert_eq!(args, vec!["--dangerously-skip-permissions", "do the thing"]);
    }

    #[test]
    fn test_parse_agent_command_claude_resume() {
        let cmd = r#"cd /repo && claude -r "1234""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/repo");
        assert_eq!(agent, "claude");
        assert_eq!(args, vec!["-r", "1234"]);
    }

    #[test]
    fn test_parse_agent_command_cursor_with_force_and_prompt() {
        let cmd = r#"cd /a/b && cursor-agent -f "implement \"feature\"""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/a/b");
        assert_eq!(agent, "cursor-agent");
        assert_eq!(args, vec!["-f", "implement \"feature\""]);
    }

    #[test]
    fn test_parse_agent_command_invalid_format() {
        let cmd = "echo hi";
        let res = parse_agent_command(cmd);
        assert!(res.is_err());
    }

    #[test]
    fn test_parse_agent_command_opencode_with_prompt_absolute() {
        let cmd = r#"cd /tmp/work && /opt/bin/opencode --prompt "hello world""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "/opt/bin/opencode");
        assert_eq!(args, vec!["--prompt", "hello world"]);
    }

    #[test]
    fn test_parse_agent_command_opencode_with_prompt_path() {
        let cmd = r#"cd /tmp/work && opencode --prompt "hello world""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "opencode");
        assert_eq!(args, vec!["--prompt", "hello world"]);
    }

    #[test]
    fn test_parse_agent_command_opencode_continue_absolute() {
        let cmd = r#"cd /repo && /opt/bin/opencode --continue"#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/repo");
        assert_eq!(agent, "/opt/bin/opencode");
        assert_eq!(args, vec!["--continue"]);
    }

    #[test]
    fn test_parse_agent_command_gemini_with_prompt() {
        let cmd = r#"cd /tmp/work && gemini --yolo""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "gemini");
        assert_eq!(args, vec!["--yolo"]);
    }

    #[test]
    fn test_parse_agent_command_gemini_resume() {
        let cmd = r#"cd /repo && gemini"#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/repo");
        assert_eq!(agent, "gemini");
        assert_eq!(args, Vec::<String>::new());
    }

    #[test]
    fn test_parse_agent_command_gemini_absolute_path() {
        let cmd = r#"cd /tmp/work && /usr/local/bin/gemini"#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "/usr/local/bin/gemini");
        assert_eq!(args, Vec::<String>::new());
    }

    #[test]
    fn test_parse_agent_command_codex_with_sandbox() {
        let cmd = r#"cd /tmp/work && codex --sandbox workspace-write "test prompt""#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/tmp/work");
        assert_eq!(agent, "codex");
        assert_eq!(args, vec!["--sandbox", "workspace-write", "test prompt"]);
    }

    #[test]
    fn test_parse_agent_command_codex_danger_mode() {
        let cmd = r#"cd /repo && codex --sandbox danger-full-access"#;
        let (cwd, agent, args) = parse_agent_command(cmd).unwrap();
        assert_eq!(cwd, "/repo");
        assert_eq!(agent, "codex");
        assert_eq!(args, vec!["--sandbox", "danger-full-access"]);
    }

    // Tests removed: get_current_directory now uses active project instead of current working directory
}
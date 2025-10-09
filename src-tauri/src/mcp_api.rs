use http_body_util::BodyExt;
use hyper::{body::Incoming, Method, Request, Response, StatusCode};
use log::{error, info, warn};

use crate::commands::sessions_refresh::{request_sessions_refresh, SessionsRefreshReason};
use crate::{get_core_read, get_core_write};
use schaltwerk::domains::sessions::entity::Session;
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::schaltwerk_core::{SessionManager, SessionState};

pub async fn handle_mcp_request(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    match (&method, path.as_str()) {
        (&Method::POST, "/api/specs") => create_draft(req, app).await,
        (&Method::GET, "/api/specs") => list_drafts().await,
        (&Method::PATCH, path) if path.starts_with("/api/specs/") && !path.ends_with("/start") => {
            let name = extract_draft_name(path, "/api/specs/");
            update_spec_content(req, &name, app).await
        }
        (&Method::POST, path) if path.starts_with("/api/specs/") && path.ends_with("/start") => {
            let name = extract_draft_name_for_start(path);
            start_spec_session(req, &name, app).await
        }
        (&Method::DELETE, path) if path.starts_with("/api/specs/") => {
            let name = extract_draft_name(path, "/api/specs/");
            delete_draft(&name, app).await
        }
        (&Method::POST, "/api/sessions") => create_session(req, app).await,
        (&Method::GET, "/api/sessions") => list_sessions(req).await,
        (&Method::GET, path) if path.starts_with("/api/sessions/") => {
            let name = extract_session_name(path);
            get_session(&name).await
        }
        (&Method::DELETE, path) if path.starts_with("/api/sessions/") => {
            let name = extract_session_name(path);
            delete_session(&name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/mark-reviewed") =>
        {
            let name = extract_session_name_for_action(path, "/mark-reviewed");
            mark_session_reviewed(&name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/convert-to-spec") =>
        {
            let name = extract_session_name_for_action(path, "/convert-to-spec");
            convert_session_to_spec(&name, app).await
        }
        (&Method::GET, "/api/current-spec-mode-session") => {
            get_current_spec_mode_session(app).await
        }
        _ => Ok(not_found_response()),
    }
}

fn extract_draft_name(path: &str, prefix: &str) -> String {
    let name = &path[prefix.len()..];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_draft_name_for_start(path: &str) -> String {
    let prefix = "/api/specs/";
    let suffix = "/start";
    let name = &path[prefix.len()..path.len() - suffix.len()];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_session_name(path: &str) -> String {
    let prefix = "/api/sessions/";
    let name = &path[prefix.len()..];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_session_name_for_action(path: &str, action: &str) -> String {
    let prefix = "/api/sessions/";
    let suffix = action;
    let name = &path[prefix.len()..path.len() - suffix.len()];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn not_found_response() -> Response<String> {
    let mut response = Response::new("Not Found".to_string());
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

fn create_spec_session_with_notifications<F>(
    manager: &SessionManager,
    name: &str,
    content: &str,
    agent_type: Option<&str>,
    skip_permissions: Option<bool>,
    emit_sessions: F,
) -> anyhow::Result<Session>
where
    F: Fn() -> Result<(), tauri::Error>,
{
    let session =
        manager.create_spec_session_with_agent(name, content, agent_type, skip_permissions)?;
    if let Err(e) = emit_sessions() {
        warn!("Failed to emit SessionsRefreshed after creating spec '{name}': {e}");
    }
    Ok(session)
}

fn error_response(status: StatusCode, message: String) -> Response<String> {
    let mut response = Response::new(message);
    *response.status_mut() = status;
    response
}

fn json_response(status: StatusCode, json: String) -> Response<String> {
    let mut response = Response::new(json);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert("Content-Type", "application/json".parse().unwrap());
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;
    use schaltwerk::schaltwerk_core::Database;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn init_test_repo() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().expect("temp dir");
        let repo_path = tmp.path().to_path_buf();
        let repo = Repository::init(&repo_path).expect("init repo");

        // Configure git user for commits
        let mut config = repo.config().expect("config");
        config
            .set_str("user.email", "test@example.com")
            .expect("email");
        config.set_str("user.name", "Test User").expect("name");

        // Create initial commit so repo isn't empty
        std::fs::write(repo_path.join("README.md"), "# Test\n").expect("write readme");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("add path");
        index.write().expect("index write");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature = repo
            .signature()
            .unwrap_or_else(|_| git2::Signature::now("Test User", "test@example.com").unwrap());
        repo.commit(Some("HEAD"), &signature, &signature, "Initial", &tree, &[])
            .expect("commit");

        (tmp, repo_path)
    }

    fn create_manager(repo_path: &std::path::Path) -> SessionManager {
        let db_path = repo_path.join("test.db");
        let database = Database::new(Some(db_path)).expect("db");
        SessionManager::new(database, repo_path.to_path_buf())
    }

    #[test]
    fn create_spec_session_emits_sessions_refreshed_payload() {
        let (_tmp, repo_path) = init_test_repo();
        let manager = create_manager(&repo_path);
        let emitted = Arc::new(Mutex::new(false));
        let emitted_ids: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();
        let result = create_spec_session_with_notifications(
            &manager,
            "draft-one",
            "Initial spec content",
            None,
            None,
            move || {
                let mut flag = emitted_clone.lock().expect("lock");
                *flag = true;
                Ok(())
            },
        );

        let session = result.expect("spec creation");
        assert!(
            *emitted.lock().expect("lock"),
            "SessionsRefreshed emitter should be invoked"
        );
        let sessions_after = manager
            .list_enriched_sessions()
            .expect("sessions available after refresh");
        {
            let mut ids = emitted_ids.lock().expect("lock");
            ids.extend(sessions_after.iter().map(|s| s.info.session_id.clone()));
        }
        assert!(
            emitted_ids
                .lock()
                .expect("lock")
                .iter()
                .any(|id| id == &session.name),
            "emitted sessions should include the new spec"
        );
    }
}

async fn create_draft(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse spec creation request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'name' field".to_string(),
            ));
        }
    };
    let content = payload["content"].as_str().unwrap_or("");
    let agent_type = payload["agent_type"].as_str();
    let skip_permissions = payload["skip_permissions"].as_bool();

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };
    match create_spec_session_with_notifications(
        &manager,
        name,
        content,
        agent_type,
        skip_permissions,
        move || {
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            Ok(())
        },
    ) {
        Ok(session) => {
            info!("Created spec session via API: {name}");
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::CREATED, json))
        }
        Err(e) => {
            error!("Failed to create spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create spec: {e}"),
            ))
        }
    }
}

async fn list_drafts() -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_sessions_by_state(SessionState::Spec) {
        Ok(sessions) => {
            let json = serde_json::to_string(&sessions).unwrap_or_else(|e| {
                error!("Failed to serialize sessions: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to list spec sessions: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list specs: {e}"),
            ))
        }
    }
}

async fn update_spec_content(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse spec update request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let content = match payload["content"].as_str() {
        Some(c) => c,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'content' field".to_string(),
            ));
        }
    };

    let append = payload["append"].as_bool().unwrap_or(false);

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match if append {
        manager.append_spec_content(name, content)
    } else {
        manager.update_spec_content(name, content)
    } {
        Ok(()) => {
            info!(
                "Updated spec content via API: {name} (append={append}, content_len={})",
                content.len()
            );

            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            info!("MCP API: queued sessions refresh after spec update");

            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to update spec content: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update spec: {e}"),
            ))
        }
    }
}

async fn start_spec_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse start draft session request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let base_branch = payload["base_branch"].as_str().map(|s| s.to_string());
    let agent_type = payload["agent_type"].as_str();
    let skip_permissions = payload["skip_permissions"].as_bool();
    let version_group_id = payload["version_group_id"].as_str().map(|s| s.to_string());
    let version_number = payload["version_number"].as_i64().map(|n| n as i32);

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get schaltwerk core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Use the manager method that encapsulates all configuration and session starting logic
    match manager.start_spec_session_with_config(
        name,
        base_branch.as_deref(),
        version_group_id.as_deref(),
        version_number,
        agent_type,
        skip_permissions,
    ) {
        Ok(()) => {
            info!("Started spec session via API: {name}");
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to start spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to start spec: {e}"),
            ))
        }
    }
}

async fn delete_draft(name: &str, app: tauri::AppHandle) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.cancel_session(name) {
        Ok(()) => {
            info!("Deleted spec session via API: {name}");

            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload {
                session_name: String,
            }
            let _ = emit_event(
                &app,
                SchaltEvent::SessionRemoved,
                &SessionRemovedPayload {
                    session_name: name.to_string(),
                },
            );
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to delete spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to delete spec: {e}"),
            ))
        }
    }
}

async fn create_session(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse session creation request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'name' field".to_string(),
            ));
        }
    };
    let prompt = payload["prompt"].as_str().map(|s| s.to_string());
    let base_branch = payload["base_branch"].as_str().map(|s| s.to_string());
    let user_edited_name = payload["user_edited_name"].as_bool();

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;

    match manager.create_session_with_auto_flag(
        name,
        prompt.as_deref(),
        base_branch.as_deref(),
        was_auto_generated,
        None,
        None,
    ) {
        Ok(session) => {
            info!("Created session via API: {name}");
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);

            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });

            Ok(json_response(StatusCode::CREATED, json))
        }
        Err(e) => {
            error!("Failed to create session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create session: {e}"),
            ))
        }
    }
}

async fn list_sessions(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    // Parse query parameters
    let query = req.uri().query().unwrap_or("");
    let mut filter_state: Option<SessionState> = None;

    // Simple query parameter parsing for state filter
    if query.contains("state=reviewed") {
        filter_state = Some(SessionState::Reviewed);
    } else if query.contains("state=running") {
        filter_state = Some(SessionState::Running);
    } else if query.contains("state=spec") {
        filter_state = Some(SessionState::Spec);
    }

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_enriched_sessions() {
        Ok(mut sessions) => {
            // Apply filtering if requested
            if let Some(state) = filter_state {
                sessions.retain(|s| match state {
                    SessionState::Reviewed => s.info.ready_to_merge,
                    SessionState::Running => {
                        !s.info.ready_to_merge && s.info.session_state == SessionState::Running
                    }
                    SessionState::Spec => s.info.session_state == SessionState::Spec,
                });
            }

            let json = serde_json::to_string(&sessions).unwrap_or_else(|e| {
                error!("Failed to serialize sessions: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to list sessions: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list sessions: {e}"),
            ))
        }
    }
}

async fn get_session(name: &str) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.get_session(name) {
        Ok(session) => {
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to get session: {e}");
            Ok(error_response(
                StatusCode::NOT_FOUND,
                format!("Session not found: {e}"),
            ))
        }
    }
}

async fn delete_session(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.cancel_session(name) {
        Ok(()) => {
            info!("Deleted session via API: {name}");

            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload {
                session_name: String,
            }
            let _ = emit_event(
                &app,
                SchaltEvent::SessionRemoved,
                &SessionRemovedPayload {
                    session_name: name.to_string(),
                },
            );
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to cancel session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to cancel session: {e}"),
            ))
        }
    }
}

async fn mark_session_reviewed(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get schaltwerk core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Use the manager method that encapsulates all validation and business logic
    match manager.mark_session_as_reviewed(name) {
        Ok(()) => {
            info!("Marked session '{name}' as reviewed via API");
            request_sessions_refresh(&app, SessionsRefreshReason::MergeWorkflow);

            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to mark session '{name}' as reviewed: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to mark session as reviewed: {e}"),
            ))
        }
    }
}

async fn convert_session_to_spec(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get schaltwerk core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Use the manager method that encapsulates all validation and business logic
    match manager.convert_session_to_spec(name) {
        Ok(()) => {
            info!("Converted session '{name}' to spec via API");
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);

            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to convert session '{name}' to spec: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to convert session '{name}' to spec: {e}"),
            ))
        }
    }
}

async fn get_current_spec_mode_session(
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // For now, return not found since we don't have persistent state tracking
    // This could be enhanced later with proper state management
    Ok(error_response(StatusCode::NOT_FOUND, "Spec mode session tracking not yet implemented. Use schaltwerk_draft_update with explicit session name.".to_string()))
}

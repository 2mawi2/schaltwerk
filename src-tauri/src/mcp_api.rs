use hyper::{body::Incoming, Method, Request, Response, StatusCode};
use http_body_util::BodyExt;
use log::{info, error, warn};
use tauri::Emitter;

use crate::get_para_core;
use crate::para_core::SessionState;

pub async fn handle_mcp_request(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    
    match (&method, path.as_str()) {
        (&Method::POST, "/api/drafts") => create_draft(req).await,
        (&Method::GET, "/api/drafts") => list_drafts().await,
        (&Method::PATCH, path) if path.starts_with("/api/drafts/") && !path.ends_with("/start") => {
            let name = extract_draft_name(path, "/api/drafts/");
            update_draft_content(req, &name, app).await
        }
        (&Method::POST, path) if path.starts_with("/api/drafts/") && path.ends_with("/start") => {
            let name = extract_draft_name_for_start(path);
            start_draft_session(req, &name, app).await
        }
        (&Method::DELETE, path) if path.starts_with("/api/drafts/") => {
            let name = extract_draft_name(path, "/api/drafts/");
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
        _ => Ok(not_found_response()),
    }
}

fn extract_draft_name(path: &str, prefix: &str) -> String {
    let name = &path[prefix.len()..];
    urlencoding::decode(name).unwrap_or(std::borrow::Cow::Borrowed(name)).to_string()
}

fn extract_draft_name_for_start(path: &str) -> String {
    let prefix = "/api/drafts/";
    let suffix = "/start";
    let name = &path[prefix.len()..path.len() - suffix.len()];
    urlencoding::decode(name).unwrap_or(std::borrow::Cow::Borrowed(name)).to_string()
}

fn extract_session_name(path: &str) -> String {
    let prefix = "/api/sessions/";
    let name = &path[prefix.len()..];
    urlencoding::decode(name).unwrap_or(std::borrow::Cow::Borrowed(name)).to_string()
}

fn not_found_response() -> Response<String> {
    let mut response = Response::new("Not Found".to_string());
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

fn error_response(status: StatusCode, message: String) -> Response<String> {
    let mut response = Response::new(message);
    *response.status_mut() = status;
    response
}

fn json_response(status: StatusCode, json: String) -> Response<String> {
    let mut response = Response::new(json);
    *response.status_mut() = status;
    response.headers_mut().insert("Content-Type", "application/json".parse().unwrap());
    response
}

async fn create_draft(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse draft creation request: {e}");
            return Ok(error_response(StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")));
        }
    };
    
    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(StatusCode::BAD_REQUEST, "Missing 'name' field".to_string()));
        }
    };
    let content = payload["content"].as_str().unwrap_or("");
    
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.create_draft_session(name, content) {
        Ok(session) => {
            info!("Created draft session via API: {name}");
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::CREATED, json))
        },
        Err(e) => {
            error!("Failed to create draft session: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create draft: {e}")))
        }
    }
}

async fn list_drafts() -> Result<Response<String>, hyper::Error> {
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.list_sessions_by_state(SessionState::Draft) {
        Ok(sessions) => {
            let json = serde_json::to_string(&sessions).unwrap_or_else(|e| {
                error!("Failed to serialize sessions: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        },
        Err(e) => {
            error!("Failed to list draft sessions: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list drafts: {e}")))
        }
    }
}

async fn update_draft_content(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse draft update request: {e}");
            return Ok(error_response(StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")));
        }
    };
    
    let content = match payload["content"].as_str() {
        Some(c) => c,
        None => {
            return Ok(error_response(StatusCode::BAD_REQUEST, "Missing 'content' field".to_string()));
        }
    };
    
    let append = payload["append"].as_bool().unwrap_or(false);
    
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match if append {
        manager.append_draft_content(name, content)
    } else {
        manager.update_draft_content(name, content)
    } {
        Ok(()) => {
            info!("Updated draft content via API: {name}");
            
            // Emit events to update UI
            if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &Vec::<serde_json::Value>::new()) {
                error!("Failed to emit sessions-refreshed event: {e}");
            }
            
            Ok(Response::new("OK".to_string()))
        },
        Err(e) => {
            error!("Failed to update draft content: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update draft: {e}")))
        }
    }
}

async fn start_draft_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let base_branch = if let Ok(body) = req.into_body().collect().await {
        let body_bytes = body.to_bytes();
        if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            payload["base_branch"].as_str().map(|s| s.to_string())
        } else {
            None
        }
    } else {
        None
    };
    
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.start_draft_session(name, base_branch.as_deref()) {
        Ok(()) => {
            info!("Started draft session via API: {name}");
            
            if let Ok(sessions) = manager.list_enriched_sessions() {
                if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &sessions) {
                    warn!("Could not emit sessions refreshed: {e}");
                }
            }
            Ok(Response::new("OK".to_string()))
        },
        Err(e) => {
            error!("Failed to start draft session: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to start draft: {e}")))
        }
    }
}

async fn delete_draft(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.cancel_session(name) {
        Ok(()) => {
            info!("Deleted draft session via API: {name}");
            
            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload { session_name: String }
            let _ = app.emit(
                "schaltwerk:session-removed",
                SessionRemovedPayload { session_name: name.to_string() },
            );
            Ok(Response::new("OK".to_string()))
        },
        Err(e) => {
            error!("Failed to delete draft session: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete draft: {e}")))
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
            return Ok(error_response(StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")));
        }
    };
    
    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(StatusCode::BAD_REQUEST, "Missing 'name' field".to_string()));
        }
    };
    let prompt = payload["prompt"].as_str().map(|s| s.to_string());
    let base_branch = payload["base_branch"].as_str().map(|s| s.to_string());
    let user_edited_name = payload["user_edited_name"].as_bool();
    
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;
    
    match manager.create_session_with_auto_flag(name, prompt.as_deref(), base_branch.as_deref(), was_auto_generated) {
        Ok(session) => {
            info!("Created session via API: {name}");
            
            if let Ok(sessions) = manager.list_enriched_sessions() {
                if let Err(e) = app.emit("schaltwerk:sessions-refreshed", &sessions) {
                    warn!("Could not emit sessions refreshed: {e}");
                }
            }
            
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            
            Ok(json_response(StatusCode::CREATED, json))
        },
        Err(e) => {
            error!("Failed to create session: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create session: {e}")))
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
    } else if query.contains("state=draft") {
        filter_state = Some(SessionState::Draft);
    }
    
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.list_enriched_sessions() {
        Ok(mut sessions) => {
            // Apply filtering if requested
            if let Some(state) = filter_state {
                sessions.retain(|s| {
                    match state {
                        SessionState::Reviewed => s.info.ready_to_merge,
                        SessionState::Running => !s.info.ready_to_merge && s.info.session_state == SessionState::Running,
                        SessionState::Draft => s.info.session_state == SessionState::Draft,
                    }
                });
            }
            
            let json = serde_json::to_string(&sessions).unwrap_or_else(|e| {
                error!("Failed to serialize sessions: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        },
        Err(e) => {
            error!("Failed to list sessions: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list sessions: {e}")))
        }
    }
}

async fn get_session(name: &str) -> Result<Response<String>, hyper::Error> {
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.get_session(name) {
        Ok(session) => {
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        },
        Err(e) => {
            error!("Failed to get session: {e}");
            Ok(error_response(StatusCode::NOT_FOUND, format!("Session not found: {e}")))
        }
    }
}

async fn delete_session(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_para_core().await {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Internal error: {e}")));
        }
    };
    
    let core_lock = core.lock().await;
    let manager = core_lock.session_manager();
    
    match manager.cancel_session(name) {
        Ok(()) => {
            info!("Deleted session via API: {name}");
            
            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload { session_name: String }
            let _ = app.emit(
                "schaltwerk:session-removed",
                SessionRemovedPayload { session_name: name.to_string() },
            );
            Ok(Response::new("OK".to_string()))
        },
        Err(e) => {
            error!("Failed to cancel session: {e}");
            Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to cancel session: {e}")))
        }
    }
}
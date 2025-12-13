use http_body_util::BodyExt;
use hyper::{
    HeaderMap, Method, Request, Response, StatusCode,
    body::Incoming,
    header::{CONTENT_TYPE, HeaderValue},
};
use log::{error, info, warn};
use serde::Serialize;
use std::cell::RefCell;
use std::path::PathBuf;
use url::form_urlencoded;

use schaltwerk::domains::settings::setup_script::SetupScriptService;
use crate::commands::schaltwerk_core::{
    MergeCommandError, merge_session_with_events, schaltwerk_core_cancel_session,
};
use crate::commands::sessions_refresh::{SessionsRefreshReason, request_sessions_refresh};
use crate::mcp_api::diff_api::{DiffApiError, DiffChunkRequest, DiffScope, SummaryQuery};
use crate::{REQUEST_PROJECT_OVERRIDE, get_core_read, get_core_write};
use schaltwerk::domains::merge::MergeMode;
use schaltwerk::domains::sessions::entity::{Session, Spec};
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};
use schaltwerk::schaltwerk_core::db_project_config::ProjectConfigMethods;
use schaltwerk::schaltwerk_core::{SessionManager, SessionState};
use schaltwerk::services::{CreateSessionPrOptions, PrCommitMode, PrContent};

mod diff_api;

pub async fn handle_mcp_request(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // Preserve project affinity from MCP clients (terminals) using the header
    // injected by the MCP bridge. This prevents requests from being handled by
    // whichever project is currently active in the UI.
    let project_override = project_override_from_headers(req.headers());

    if let Some(path) = project_override {
        // Scope the request so get_core_read/get_core_write use the override
        return REQUEST_PROJECT_OVERRIDE
            .scope(RefCell::new(Some(path)), async move {
                handle_mcp_request_inner(req, app).await
            })
            .await;
    }

    handle_mcp_request_inner(req, app).await
}

async fn handle_mcp_request_inner(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    match (&method, path.as_str()) {
        (&Method::GET, "/api/diff/summary") => diff_summary(req).await,
        (&Method::GET, "/api/diff/file") => diff_chunk(req).await,
        (&Method::POST, "/api/specs") => create_draft(req, app).await,
        (&Method::GET, "/api/specs") => list_drafts().await,
        (&Method::GET, "/api/specs/summary") => list_spec_summaries().await,
        (&Method::GET, path) if path.starts_with("/api/specs/") && !path.ends_with("/start") => {
            let name = extract_draft_name(path, "/api/specs/");
            get_spec_content(&name).await
        }
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
        (&Method::GET, path) if path.starts_with("/api/sessions/") && path.ends_with("/spec") => {
            let name = extract_session_name_for_action(path, "/spec");
            get_session_spec(&name).await
        }
        (&Method::GET, "/api/sessions") => list_sessions(req).await,
        (&Method::GET, path) if path.starts_with("/api/sessions/") => {
            let name = extract_session_name(path);
            get_session(&name).await
        }
        (&Method::POST, path) if path.starts_with("/api/sessions/") && path.ends_with("/merge") => {
            let name = extract_session_name_for_action(path, "/merge");
            merge_session(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/pull-request") =>
        {
            let name = extract_session_name_for_action(path, "/pull-request");
            create_pull_request(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/prepare-pr") =>
        {
            let name = extract_session_name_for_action(path, "/prepare-pr");
            prepare_pull_request(req, &name, app).await
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
        (&Method::GET, "/api/project/setup-script") => get_project_setup_script(app).await,
        (&Method::PUT, "/api/project/setup-script") => set_project_setup_script(req, app).await,
        (&Method::GET, "/api/current-spec-mode-session") => {
            get_current_spec_mode_session(app).await
        }
        _ => Ok(not_found_response()),
    }
}

fn project_override_from_headers(headers: &HeaderMap) -> Option<PathBuf> {
    headers
        .get("X-Project-Path")
        .and_then(|v| v.to_str().ok())
        .map(PathBuf::from)
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
) -> anyhow::Result<Spec>
where
    F: Fn() -> Result<(), tauri::Error>,
{
    let _ = skip_permissions;
    let session = manager.create_spec_session_with_agent(
        name,
        content,
        agent_type,
        None,
        None,
    )?;
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
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn json_error_response(status: StatusCode, message: String) -> Response<String> {
    let body = serde_json::json!({ "error": message }).to_string();
    json_response(status, body)
}

async fn diff_summary(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    let query = req.uri().query().unwrap_or("");
    let mut session_param: Option<String> = None;
    let mut cursor_param: Option<String> = None;
    let mut page_size_param: Option<String> = None;

    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "session" => session_param = Some(value.into_owned()),
            "cursor" => cursor_param = Some(value.into_owned()),
            "page_size" => page_size_param = Some(value.into_owned()),
            _ => {}
        }
    }

    let page_size = match parse_optional_usize(page_size_param, "page_size") {
        Ok(value) => value,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let scope = match resolve_diff_scope(session_param.as_deref()).await {
        Ok(scope) => scope,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let summary = match diff_api::compute_diff_summary(
        &scope,
        SummaryQuery {
            cursor: cursor_param,
            page_size,
        },
    ) {
        Ok(summary) => summary,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&summary) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize diff summary: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn diff_chunk(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    let query = req.uri().query().unwrap_or("");
    let mut session_param: Option<String> = None;
    let mut cursor_param: Option<String> = None;
    let mut line_limit_param: Option<String> = None;
    let mut path_param: Option<String> = None;

    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "session" => session_param = Some(value.into_owned()),
            "cursor" => cursor_param = Some(value.into_owned()),
            "line_limit" => line_limit_param = Some(value.into_owned()),
            "path" => path_param = Some(value.into_owned()),
            _ => {}
        }
    }

    let path = match path_param {
        Some(path) if !path.trim().is_empty() => path,
        _ => {
            return Ok(json_error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "path query parameter is required".into(),
            ));
        }
    };

    let line_limit = match parse_optional_usize(line_limit_param, "line_limit") {
        Ok(value) => value,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let scope = match resolve_diff_scope(session_param.as_deref()).await {
        Ok(scope) => scope,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let chunk = match diff_api::compute_diff_chunk(
        &scope,
        &path,
        DiffChunkRequest {
            cursor: cursor_param,
            line_limit,
        },
    ) {
        Ok(chunk) => chunk,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&chunk) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize diff chunk: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn get_session_spec(name: &str) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let manager = core.session_manager();
    let session = match resolve_session_by_selector(&manager, name) {
        Ok(session) => session,
        Err(err) => return Ok(diff_error_response(err)),
    };
    drop(core);

    let spec = match diff_api::fetch_session_spec(&session) {
        Ok(spec) => spec,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&spec) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize session spec: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn resolve_diff_scope(session_param: Option<&str>) -> Result<DiffScope, DiffApiError> {
    let core = get_core_read()
        .await
        .map_err(|e| internal_diff_error(format!("Internal error: {e}")))?;

    let scope = if let Some(selector) = session_param {
        let manager = core.session_manager();
        let session = resolve_session_by_selector(&manager, selector)?;
        DiffScope::for_session(&session)?
    } else {
        DiffScope::for_orchestrator(core.repo_path.clone())?
    };

    Ok(scope)
}

fn resolve_session_by_selector(
    manager: &SessionManager,
    selector: &str,
) -> Result<Session, DiffApiError> {
    manager
        .get_session_by_id(selector)
        .or_else(|_| manager.get_session(selector))
        .map_err(|_| {
            DiffApiError::new(
                StatusCode::NOT_FOUND,
                format!("Session '{selector}' not found"),
            )
        })
}

fn diff_error_response(err: DiffApiError) -> Response<String> {
    json_error_response(err.status, err.message)
}

fn parse_optional_usize(value: Option<String>, field: &str) -> Result<Option<usize>, DiffApiError> {
    if let Some(raw) = value {
        if raw.trim().is_empty() {
            return Ok(None);
        }
        let parsed = raw.parse::<usize>().map_err(|_| {
            DiffApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("{field} must be a positive integer"),
            )
        })?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

fn internal_diff_error(message: String) -> DiffApiError {
    DiffApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn setup_script_payload(setup_script: &str) -> serde_json::Value {
    let has_setup_script = !setup_script.trim().is_empty();
    let normalized_script = if has_setup_script {
        setup_script.to_string()
    } else {
        String::new()
    };

    serde_json::json!({
        "setup_script": normalized_script,
        "has_setup_script": has_setup_script
    })
}

#[derive(Debug, Serialize, Clone)]
struct SetupScriptRequestPayload {
    setup_script: String,
    has_setup_script: bool,
    pending_confirmation: bool,
    project_path: String,
}

fn parse_setup_script_request(body: &[u8]) -> Result<String, (StatusCode, String)> {
    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")))?;

    let Some(script) = payload.get("setup_script").and_then(|v| v.as_str()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing 'setup_script' field".to_string(),
        ));
    };

    Ok(script.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use git2::Repository;
    use hyper::HeaderMap;
    use schaltwerk::schaltwerk_core::Database;
    use std::cell::RefCell;
    use std::path::Path;
    use std::path::PathBuf;
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

    fn make_spec_session(name: &str, content: Option<&str>) -> Spec {
        Spec {
            id: format!("spec-{name}"),
            name: name.to_string(),
            display_name: Some(format!("Display {name}")),
            epic_id: None,
            repository_path: PathBuf::from("/tmp/mock"),
            repository_name: "mock".to_string(),
            content: content.unwrap_or_default().to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
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

    #[test]
    fn spec_summary_from_session_surface_length_and_display_name() {
        let content = "# Spec\n\nDetails line";
        let session = make_spec_session("alpha", Some(content));
        let summary = SpecSummary::from_spec(&session);
        assert_eq!(summary.session_id, "alpha");
        assert_eq!(summary.display_name.as_deref(), Some("Display alpha"));
        assert_eq!(summary.content_length, content.chars().count());
        assert!(
            !summary.updated_at.is_empty(),
            "updated_at should be populated"
        );
    }

    #[test]
    fn spec_content_response_defaults_to_empty_when_missing() {
        let session = make_spec_session("beta", None);
        let response = SpecContentResponse::from_spec(&session);
        assert_eq!(response.session_id, "beta");
        assert_eq!(response.display_name.as_deref(), Some("Display beta"));
        assert_eq!(response.content, "");
        assert_eq!(response.content_length, 0);
    }

    #[test]
    fn project_override_header_is_parsed() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Project-Path", "/tmp/foo".parse().unwrap());

        let parsed = project_override_from_headers(&headers);

        assert_eq!(parsed, Some(PathBuf::from("/tmp/foo")));
    }

    #[test]
    fn project_override_header_absent_returns_none() {
        let headers = HeaderMap::new();

        let parsed = project_override_from_headers(&headers);

        assert!(parsed.is_none());
    }

    #[tokio::test]
    async fn request_project_override_scope_sets_and_clears() {
        let path = PathBuf::from("/tmp/scoped");

        let observed = REQUEST_PROJECT_OVERRIDE
            .scope(RefCell::new(Some(path.clone())), async move {
                REQUEST_PROJECT_OVERRIDE
                    .try_with(|cell| cell.borrow().clone())
                    .ok()
                    .flatten()
            })
            .await;

        assert_eq!(observed, Some(path));

        // Outside the scope the task-local should be unset
        let outside = REQUEST_PROJECT_OVERRIDE.try_with(|cell| cell.borrow().clone());
        assert!(outside.is_err());
    }

    #[test]
    fn setup_script_payload_marks_presence() {
        let payload = setup_script_payload("#!/bin/bash\necho hello");
        assert_eq!(payload["has_setup_script"], serde_json::json!(true));
        assert_eq!(
            payload["setup_script"],
            serde_json::json!("#!/bin/bash\necho hello")
        );

        let empty = setup_script_payload("   \n ");
        assert_eq!(empty["has_setup_script"], serde_json::json!(false));
        assert_eq!(empty["setup_script"], serde_json::json!(""));
    }

    #[test]
    fn parse_setup_script_request_requires_field() {
        let err = parse_setup_script_request(b"{}").expect_err("missing setup_script should error");
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn parse_setup_script_request_accepts_string() {
        let value = parse_setup_script_request(br#"{ "setup_script": "echo hi" }"#)
            .expect("valid script")
            .to_string();
        assert_eq!(value, "echo hi");
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

#[derive(Debug, Serialize, Clone)]
struct SpecSummaryResponse {
    specs: Vec<SpecSummary>,
}

#[derive(Debug, Serialize, Clone)]
struct SpecSummary {
    session_id: String,
    display_name: Option<String>,
    content_length: usize,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct SpecContentResponse {
    session_id: String,
    display_name: Option<String>,
    content: String,
    content_length: usize,
    updated_at: String,
}

impl SpecSummary {
    fn from_spec(spec: &Spec) -> Self {
        let content_length = spec.content.chars().count();
        Self {
            session_id: spec.name.clone(),
            display_name: spec.display_name.clone(),
            content_length,
            updated_at: spec.updated_at.to_rfc3339(),
        }
    }
}

impl SpecContentResponse {
    fn from_spec(spec: &Spec) -> Self {
        let content = spec.content.clone();
        let content_length = content.chars().count();
        Self {
            session_id: spec.name.clone(),
            display_name: spec.display_name.clone(),
            content,
            content_length,
            updated_at: spec.updated_at.to_rfc3339(),
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

    match manager.list_specs() {
        Ok(specs) => {
            let json = serde_json::to_string(&specs).unwrap_or_else(|e| {
                error!("Failed to serialize specs: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to list specs: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list specs: {e}"),
            ))
        }
    }
}

async fn list_spec_summaries() -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for spec summaries: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_specs() {
        Ok(mut specs_list) => {
            specs_list.sort_by(|a, b| a.name.cmp(&b.name));
            let specs: Vec<SpecSummary> = specs_list.iter().map(SpecSummary::from_spec).collect();
            let payload = SpecSummaryResponse { specs };
            match serde_json::to_string(&payload) {
                Ok(json) => Ok(json_response(StatusCode::OK, json)),
                Err(e) => {
                    error!("Failed to serialize spec summaries: {e}");
                    Ok(json_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to serialize spec summaries: {e}"),
                    ))
                }
            }
        }
        Err(e) => {
            error!("Failed to list spec summaries: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list specs: {e}"),
            ))
        }
    }
}

async fn get_spec_content(name: &str) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for spec content: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let spec = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(_) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Spec '{name}' not found"),
            ));
        }
    };

    let payload = SpecContentResponse::from_spec(&spec);
    match serde_json::to_string(&payload) {
        Ok(json) => Ok(json_response(StatusCode::OK, json)),
        Err(e) => {
            error!("Failed to serialize spec content response: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize spec content: {e}"),
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
        Ok(_session) => {
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
    let custom_branch = payload["custom_branch"].as_str().map(|s| s.to_string());
    let use_existing_branch = payload["use_existing_branch"].as_bool().unwrap_or(false);
    let user_edited_name = payload["user_edited_name"].as_bool();
    let agent_type = payload["agent_type"].as_str().map(|s| s.to_string());
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

    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;

    use schaltwerk::domains::sessions::service::SessionCreationParams;

    let params = SessionCreationParams {
        name,
        prompt: prompt.as_deref(),
        base_branch: base_branch.as_deref(),
        custom_branch: custom_branch.as_deref(),
        use_existing_branch,
        sync_with_origin: use_existing_branch,
        was_auto_generated,
        version_group_id: None,
        version_number: None,
        epic_id: None,
        agent_type: agent_type.as_deref(),
        skip_permissions,
    };

    match manager.create_session_with_agent(params) {
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
    } else if query.contains("state=processing") {
        filter_state = Some(SessionState::Processing);
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
                    SessionState::Processing => {
                        !s.info.ready_to_merge && s.info.session_state == SessionState::Processing
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct MergeSessionRequest {
    #[serde(default)]
    mode: Option<MergeMode>,
    #[serde(default)]
    commit_message: Option<String>,
    #[serde(default)]
    cancel_after_merge: bool,
}

#[derive(Debug, serde::Serialize)]
struct MergeSessionResponse {
    session_name: String,
    parent_branch: String,
    session_branch: String,
    mode: MergeMode,
    commit: String,
    cancel_requested: bool,
    cancel_queued: bool,
    cancel_error: Option<String>,
}

async fn merge_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // Validate session state up front to produce actionable errors
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before attempting a merge."
                            ),
                        ));
                    }
                    // Allow merge to proceed
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for merge: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Consume request body
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: MergeSessionRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let mode = payload.mode.unwrap_or(MergeMode::Squash);
    let outcome =
        match merge_session_with_events(&app, name, mode, payload.commit_message.clone()).await {
            Ok(outcome) => outcome,
            Err(MergeCommandError { message, conflict }) => {
                let status = if conflict {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::BAD_REQUEST
                };
                return Ok(error_response(status, message));
            }
        };

    let mut cancel_error = None;
    let mut cancel_queued = false;

    if payload.cancel_after_merge {
        match schaltwerk_core_cancel_session(app.clone(), name.to_string()).await {
            Ok(()) => {
                cancel_queued = true;
            }
            Err(e) => {
                cancel_error = Some(e.to_string());
            }
        }
    }

    let response = MergeSessionResponse {
        session_name: name.to_string(),
        parent_branch: outcome.parent_branch,
        session_branch: outcome.session_branch,
        mode: outcome.mode,
        commit: outcome.new_commit,
        cancel_requested: payload.cancel_after_merge,
        cancel_queued,
        cancel_error,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize merge response for '{name}': {e}");
        "{}".to_string()
    });

    // Use 200 status for successful merge, even if cancellation follow-up failed
    Ok(json_response(StatusCode::OK, json))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct PullRequestRequest {
    pr_title: String,
    #[serde(default)]
    pr_body: Option<String>,
    #[serde(default)]
    base_branch: Option<String>,
    #[serde(default)]
    pr_branch_name: Option<String>,
    #[serde(default)]
    commit_message: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    mode: Option<MergeMode>,
    #[serde(default)]
    cancel_after_pr: bool,
}

#[derive(Debug, serde::Serialize)]
struct PullRequestResponse {
    session_name: String,
    branch: String,
    url: String,
    cancel_requested: bool,
    cancel_queued: bool,
    cancel_error: Option<String>,
}

async fn create_pull_request(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let (worktree_path, session_branch, parent_branch) = match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before creating a PR."
                            ),
                        ));
                    }
                    (
                        session.worktree_path.clone(),
                        session.branch.clone(),
                        session.parent_branch.clone(),
                    )
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for PR: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PullRequestRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let repo_path = match REQUEST_PROJECT_OVERRIDE.try_with(|cell| cell.borrow().clone()) {
        Ok(Some(path)) => path,
        _ => {
            let manager = crate::get_project_manager().await;
            match manager.current_project().await {
                Ok(project) => project.path.clone(),
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::BAD_REQUEST,
                        format!("No active project: {e}"),
                    ));
                }
            }
        }
    };

    let mode = payload.mode.unwrap_or(MergeMode::Reapply);
    let pr_mode = match mode {
        MergeMode::Squash => PrCommitMode::Squash,
        MergeMode::Reapply => PrCommitMode::Reapply,
    };

    let pr_branch_name = payload
        .pr_branch_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(schaltwerk::domains::git::github_cli::sanitize_branch_name)
        .unwrap_or_else(|| session_branch.clone());

    let base_branch = payload
        .base_branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if parent_branch.trim().is_empty() {
                "main".to_string()
            } else {
                parent_branch.clone()
            }
        });

    let repository_config = match get_core_read().await {
        Ok(core) => core
            .database()
            .get_project_github_config(&repo_path)
            .map_err(|e| format!("Failed to load GitHub project config: {e}"))
            .ok()
            .flatten(),
        Err(_) => None,
    };

    let repository = payload
        .repository
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| repository_config.as_ref().map(|cfg| cfg.repository.clone()));

    let cli = schaltwerk::services::GitHubCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Ok(error_response(
            StatusCode::BAD_REQUEST,
            format!("GitHub CLI is not available: {err}"),
        ));
    }

    let pr_result = match cli.create_session_pr(CreateSessionPrOptions {
        repo_path: &repo_path,
        session_worktree_path: &worktree_path,
        session_slug: name,
        session_branch: &session_branch,
        base_branch: &base_branch,
        pr_branch_name: &pr_branch_name,
        content: PrContent::Explicit {
            title: &payload.pr_title,
            body: payload.pr_body.as_deref().unwrap_or(""),
        },
        commit_message: payload.commit_message.as_deref(),
        repository: repository.as_deref(),
        mode: pr_mode,
    }) {
        Ok(res) => res,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Failed to create pull request: {e}"),
            ));
        }
    };

    let mut cancel_error = None;
    let mut cancel_queued = false;

    if payload.cancel_after_pr {
        match schaltwerk_core_cancel_session(app.clone(), name.to_string()).await {
            Ok(()) => cancel_queued = true,
            Err(e) => cancel_error = Some(e.to_string()),
        }
    }

    let response = PullRequestResponse {
        session_name: name.to_string(),
        branch: pr_result.branch,
        url: pr_result.url,
        cancel_requested: payload.cancel_after_pr,
        cancel_queued,
        cancel_error,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize PR response for '{name}': {e}");
        "{}".to_string()
    });

    Ok(json_response(StatusCode::OK, json))
}

#[derive(Debug, serde::Deserialize)]
struct PreparePrRequest {
    pr_title: Option<String>,
    pr_body: Option<String>,
    base_branch: Option<String>,
    pr_branch_name: Option<String>,
    #[serde(default)]
    mode: Option<MergeMode>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPrModalPayload {
    session_name: String,
    pr_title: Option<String>,
    pr_body: Option<String>,
    base_branch: Option<String>,
    pr_branch_name: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct PreparePrResponse {
    session_name: String,
    modal_triggered: bool,
}

async fn prepare_pull_request(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before creating a PR."
                            ),
                        ));
                    }
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for prepare PR: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PreparePrRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let mode_str = payload.mode.map(|m| match m {
        MergeMode::Squash => "squash".to_string(),
        MergeMode::Reapply => "reapply".to_string(),
    });

    let event_payload = OpenPrModalPayload {
        session_name: name.to_string(),
        pr_title: payload.pr_title,
        pr_body: payload.pr_body,
        base_branch: payload.base_branch,
        pr_branch_name: payload.pr_branch_name,
        mode: mode_str,
    };

    if let Err(e) = emit_event(&app, SchaltEvent::OpenPrModal, &event_payload) {
        error!("Failed to emit OpenPrModal event: {e}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to trigger PR modal: {e}"),
        ));
    }

    info!("Triggered PR modal for session '{name}'");

    let response = PreparePrResponse {
        session_name: name.to_string(),
        modal_triggered: true,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize prepare PR response for '{name}': {e}");
        "{}".to_string()
    });

    Ok(json_response(StatusCode::OK, json))
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
        Ok(new_spec_name) => {
            info!("Converted session '{name}' to spec via API");
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);

            Ok(Response::new(new_spec_name))
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

async fn get_project_setup_script(
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for setup script: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();
    let setup_scripts = SetupScriptService::new(db, repo_path);

    match setup_scripts.get() {
        Ok(script) => {
            let payload = setup_script_payload(script.as_deref().unwrap_or_default());
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Err(e) => {
            error!("Failed to get project setup script: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project setup script: {e}"),
            ))
        }
    }
}

async fn set_project_setup_script(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();

    let setup_script = match parse_setup_script_request(&body_bytes) {
        Ok(script) => script,
        Err((status, message)) => return Ok(json_error_response(status, message)),
    };

    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for setup script update: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let repo_path = core.repo_path.clone();
    let payload = SetupScriptRequestPayload {
        setup_script: setup_script.clone(),
        has_setup_script: !setup_script.trim().is_empty(),
        pending_confirmation: true,
        project_path: repo_path.to_string_lossy().to_string(),
    };

    if let Err(e) = emit_event(&app, SchaltEvent::SetupScriptRequested, &payload) {
        error!("Failed to emit setup script request event: {e}");
        return Ok(json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to notify UI for setup script confirmation".to_string(),
        ));
    }

    let response_payload = setup_script_payload(&setup_script);
    Ok(json_response(StatusCode::ACCEPTED, response_payload.to_string()))
}

async fn get_current_spec_mode_session(
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // For now, return not found since we don't have persistent state tracking
    // This could be enhanced later with proper state management
    Ok(error_response(StatusCode::NOT_FOUND, "Spec mode session tracking not yet implemented. Use schaltwerk_draft_update with explicit session name.".to_string()))
}

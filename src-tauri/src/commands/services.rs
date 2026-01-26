//! Tauri commands for managing running services.
//!
//! These commands enable the frontend to track and manage services (ports/processes)
//! started from within schaltwerk terminals.

use crate::get_services_registry;
use schaltwerk::domains::services::{RegisterServiceRequest, RunningService, ServiceStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Response for list operations
#[derive(Debug, Serialize)]
pub struct ServicesListResponse {
    pub services: Vec<RunningService>,
}

/// Request to register a service from the frontend
#[derive(Debug, Deserialize)]
pub struct RegisterServiceRequestPayload {
    pub name: String,
    pub port: u16,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub terminal_id: Option<String>,
    #[serde(default)]
    pub session_name: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

impl From<RegisterServiceRequestPayload> for RegisterServiceRequest {
    fn from(payload: RegisterServiceRequestPayload) -> Self {
        RegisterServiceRequest {
            name: payload.name,
            port: payload.port,
            url: payload.url,
            terminal_id: payload.terminal_id,
            session_name: payload.session_name,
            pid: payload.pid,
            metadata: payload.metadata,
        }
    }
}

/// Register a new running service
#[tauri::command]
pub async fn register_running_service(
    request: RegisterServiceRequestPayload,
) -> Result<RunningService, String> {
    let registry = get_services_registry().await;
    Ok(registry.register(request.into()).await)
}

/// Unregister a service by its ID
#[tauri::command]
pub async fn unregister_running_service(id: String) -> Result<Option<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.unregister(&id).await)
}

/// Unregister all services on a specific port
#[tauri::command]
pub async fn unregister_running_service_by_port(port: u16) -> Result<Vec<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.unregister_by_port(port).await)
}

/// Unregister all services associated with a terminal
#[tauri::command]
pub async fn unregister_running_services_by_terminal(
    terminal_id: String,
) -> Result<Vec<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.unregister_by_terminal(&terminal_id).await)
}

/// Unregister all services associated with a session
#[tauri::command]
pub async fn unregister_running_services_by_session(
    session_name: String,
) -> Result<Vec<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.unregister_by_session(&session_name).await)
}

/// List all running services
#[tauri::command]
pub async fn list_running_services() -> Result<ServicesListResponse, String> {
    let registry = get_services_registry().await;
    let services = registry.list().await;
    Ok(ServicesListResponse { services })
}

/// List services for a specific session
#[tauri::command]
pub async fn list_running_services_by_session(
    session_name: String,
) -> Result<ServicesListResponse, String> {
    let registry = get_services_registry().await;
    let services = registry.list_by_session(&session_name).await;
    Ok(ServicesListResponse { services })
}

/// Get a service by ID
#[tauri::command]
pub async fn get_running_service(id: String) -> Result<Option<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.get(&id).await)
}

/// Get a service by port
#[tauri::command]
pub async fn get_running_service_by_port(port: u16) -> Result<Option<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.get_by_port(port).await)
}

/// Update service status
#[tauri::command]
pub async fn update_running_service_status(
    id: String,
    status: ServiceStatus,
) -> Result<Option<RunningService>, String> {
    let registry = get_services_registry().await;
    Ok(registry.update_status(&id, status).await)
}

/// Clear all services (typically called on project close)
#[tauri::command]
pub async fn clear_running_services() -> Result<(), String> {
    let registry = get_services_registry().await;
    registry.clear().await;
    Ok(())
}

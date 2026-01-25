//! Running services tracking for the project dashboard.
//!
//! This module provides tracking of processes and services (ports) started
//! from within schaltwerk terminals, enabling a dashboard view of what's running.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Information about a running service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningService {
    /// Unique identifier for this service entry
    pub id: String,
    /// Display name (e.g., "Next.js Dev Server", "Vite")
    pub name: String,
    /// Port number the service is listening on
    pub port: u16,
    /// Full URL to access the service (e.g., "http://localhost:3000")
    pub url: String,
    /// Terminal ID where the service was started
    pub terminal_id: Option<String>,
    /// Session name associated with this service
    pub session_name: Option<String>,
    /// Unix timestamp when the service was registered
    pub started_at: u64,
    /// Optional process ID
    pub pid: Option<u32>,
    /// Service status
    pub status: ServiceStatus,
    /// Additional metadata (e.g., framework, command)
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Running,
    Starting,
    Stopped,
    Unknown,
}

impl Default for ServiceStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Request to register a new running service
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterServiceRequest {
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

/// Registry for tracking running services across the application
pub struct RunningServicesRegistry {
    services: Arc<RwLock<HashMap<String, RunningService>>>,
}

impl Default for RunningServicesRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl RunningServicesRegistry {
    pub fn new() -> Self {
        Self {
            services: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new running service
    pub async fn register(&self, request: RegisterServiceRequest) -> RunningService {
        let id = format!("svc-{}-{}", request.port, uuid::Uuid::new_v4().simple());
        let url = request
            .url
            .unwrap_or_else(|| format!("http://localhost:{}", request.port));

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        let service = RunningService {
            id: id.clone(),
            name: request.name,
            port: request.port,
            url,
            terminal_id: request.terminal_id,
            session_name: request.session_name,
            started_at: now,
            pid: request.pid,
            status: ServiceStatus::Running,
            metadata: request.metadata,
        };

        let mut services = self.services.write().await;
        services.insert(id, service.clone());

        log::info!(
            "Registered service: {} on port {} (id: {})",
            service.name,
            service.port,
            service.id
        );

        service
    }

    /// Remove a service by ID
    pub async fn unregister(&self, id: &str) -> Option<RunningService> {
        let mut services = self.services.write().await;
        let removed = services.remove(id);

        if let Some(ref svc) = removed {
            log::info!("Unregistered service: {} (id: {})", svc.name, svc.id);
        }

        removed
    }

    /// Remove a service by port number
    pub async fn unregister_by_port(&self, port: u16) -> Vec<RunningService> {
        let mut services = self.services.write().await;
        let mut removed = Vec::new();

        services.retain(|_, svc| {
            if svc.port == port {
                removed.push(svc.clone());
                false
            } else {
                true
            }
        });

        for svc in &removed {
            log::info!(
                "Unregistered service by port: {} on port {} (id: {})",
                svc.name,
                svc.port,
                svc.id
            );
        }

        removed
    }

    /// Remove all services associated with a terminal
    pub async fn unregister_by_terminal(&self, terminal_id: &str) -> Vec<RunningService> {
        let mut services = self.services.write().await;
        let mut removed = Vec::new();

        services.retain(|_, svc| {
            if svc.terminal_id.as_deref() == Some(terminal_id) {
                removed.push(svc.clone());
                false
            } else {
                true
            }
        });

        for svc in &removed {
            log::info!(
                "Unregistered service by terminal: {} (terminal: {})",
                svc.name,
                terminal_id
            );
        }

        removed
    }

    /// Remove all services associated with a session
    pub async fn unregister_by_session(&self, session_name: &str) -> Vec<RunningService> {
        let mut services = self.services.write().await;
        let mut removed = Vec::new();

        services.retain(|_, svc| {
            if svc.session_name.as_deref() == Some(session_name) {
                removed.push(svc.clone());
                false
            } else {
                true
            }
        });

        for svc in &removed {
            log::info!(
                "Unregistered service by session: {} (session: {})",
                svc.name,
                session_name
            );
        }

        removed
    }

    /// Get all running services
    pub async fn list(&self) -> Vec<RunningService> {
        let services = self.services.read().await;
        services.values().cloned().collect()
    }

    /// Get services for a specific session
    pub async fn list_by_session(&self, session_name: &str) -> Vec<RunningService> {
        let services = self.services.read().await;
        services
            .values()
            .filter(|svc| svc.session_name.as_deref() == Some(session_name))
            .cloned()
            .collect()
    }

    /// Get a service by ID
    pub async fn get(&self, id: &str) -> Option<RunningService> {
        let services = self.services.read().await;
        services.get(id).cloned()
    }

    /// Get a service by port
    pub async fn get_by_port(&self, port: u16) -> Option<RunningService> {
        let services = self.services.read().await;
        services.values().find(|svc| svc.port == port).cloned()
    }

    /// Update service status
    pub async fn update_status(&self, id: &str, status: ServiceStatus) -> Option<RunningService> {
        let mut services = self.services.write().await;
        if let Some(svc) = services.get_mut(id) {
            svc.status = status;
            Some(svc.clone())
        } else {
            None
        }
    }

    /// Clear all services (e.g., on project close)
    pub async fn clear(&self) {
        let mut services = self.services.write().await;
        let count = services.len();
        services.clear();
        log::info!("Cleared {} services from registry", count);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_register_and_list_services() {
        let registry = RunningServicesRegistry::new();

        let svc1 = registry
            .register(RegisterServiceRequest {
                name: "Next.js".to_string(),
                port: 3000,
                url: None,
                terminal_id: Some("term-1".to_string()),
                session_name: Some("feature-x".to_string()),
                pid: Some(12345),
                metadata: HashMap::new(),
            })
            .await;

        let svc2 = registry
            .register(RegisterServiceRequest {
                name: "API Server".to_string(),
                port: 8080,
                url: Some("http://localhost:8080/api".to_string()),
                terminal_id: Some("term-2".to_string()),
                session_name: Some("feature-x".to_string()),
                pid: None,
                metadata: HashMap::new(),
            })
            .await;

        let all = registry.list().await;
        assert_eq!(all.len(), 2);

        let by_session = registry.list_by_session("feature-x").await;
        assert_eq!(by_session.len(), 2);

        let by_port = registry.get_by_port(3000).await;
        assert!(by_port.is_some());
        assert_eq!(by_port.unwrap().name, "Next.js");

        // Unregister by terminal
        let removed = registry.unregister_by_terminal("term-1").await;
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].id, svc1.id);

        let remaining = registry.list().await;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, svc2.id);
    }

    #[tokio::test]
    async fn test_update_status() {
        let registry = RunningServicesRegistry::new();

        let svc = registry
            .register(RegisterServiceRequest {
                name: "Test".to_string(),
                port: 5000,
                url: None,
                terminal_id: None,
                session_name: None,
                pid: None,
                metadata: HashMap::new(),
            })
            .await;

        assert_eq!(svc.status, ServiceStatus::Running);

        let updated = registry
            .update_status(&svc.id, ServiceStatus::Stopped)
            .await;
        assert!(updated.is_some());
        assert_eq!(updated.unwrap().status, ServiceStatus::Stopped);
    }
}

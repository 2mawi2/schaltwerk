use crate::events::{emit_event, SchaltEvent};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};
use tokio::sync::{Mutex, OnceCell};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    Updated,
    UpToDate,
    Error,
    Busy,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateInitiator {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateErrorKind {
    Network,
    Permission,
    Signature,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResultPayload {
    pub status: UpdateStatus,
    pub initiated_by: UpdateInitiator,
    pub current_version: String,
    pub new_version: Option<String>,
    pub notes: Option<String>,
    pub error_kind: Option<UpdateErrorKind>,
    pub error_message: Option<String>,
}

impl UpdateResultPayload {
    fn busy(current_version: String, initiated_by: UpdateInitiator) -> Self {
        Self {
            status: UpdateStatus::Busy,
            initiated_by,
            current_version,
            new_version: None,
            notes: None,
            error_kind: None,
            error_message: None,
        }
    }

    fn up_to_date(current_version: String, initiated_by: UpdateInitiator) -> Self {
        Self {
            status: UpdateStatus::UpToDate,
            initiated_by,
            current_version,
            new_version: None,
            notes: None,
            error_kind: None,
            error_message: None,
        }
    }

    fn updated(
        current_version: String,
        new_version: String,
        notes: Option<String>,
        initiated_by: UpdateInitiator,
    ) -> Self {
        Self {
            status: UpdateStatus::Updated,
            initiated_by,
            current_version,
            new_version: Some(new_version),
            notes,
            error_kind: None,
            error_message: None,
        }
    }

    fn error(
        current_version: String,
        initiated_by: UpdateInitiator,
        kind: UpdateErrorKind,
        message: String,
    ) -> Self {
        Self {
            status: UpdateStatus::Error,
            initiated_by,
            current_version,
            new_version: None,
            notes: None,
            error_kind: Some(kind),
            error_message: Some(message),
        }
    }
}

static UPDATE_MUTEX: OnceCell<Arc<Mutex<()>>> = OnceCell::const_new();

async fn acquire_lock() -> Arc<Mutex<()>> {
    UPDATE_MUTEX
        .get_or_init(|| async { Arc::new(Mutex::new(())) })
        .await
        .clone()
}

fn classify_error(error: &UpdaterError) -> UpdateErrorKind {
    match error {
        UpdaterError::Network(_) | UpdaterError::Reqwest(_) => UpdateErrorKind::Network,
        UpdaterError::Io(io_err) if io_err.kind() == std::io::ErrorKind::PermissionDenied => {
            UpdateErrorKind::Permission
        }
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            UpdateErrorKind::Signature
        }
        _ => UpdateErrorKind::Unknown,
    }
}

pub fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

pub async fn check_for_updates(
    app: &AppHandle,
    initiated_by: UpdateInitiator,
) -> UpdateResultPayload {
    let version = current_version(app);
    let lock = acquire_lock().await;

    let guard = match lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            let payload = UpdateResultPayload::busy(version, initiated_by);
            if initiated_by == UpdateInitiator::Manual {
                let _ = emit_event(app, SchaltEvent::AppUpdateResult, &payload);
            }
            return payload;
        }
    };

    let result = perform_update_check(app, initiated_by, version.clone()).await;
    drop(guard);

    if !(initiated_by == UpdateInitiator::Auto && result.status == UpdateStatus::UpToDate) {
        let _ = emit_event(app, SchaltEvent::AppUpdateResult, &result);
    }

    result
}

async fn perform_update_check(
    app: &AppHandle,
    initiated_by: UpdateInitiator,
    current_version: String,
) -> UpdateResultPayload {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            error!("Failed to instantiate updater: {err}");
            return UpdateResultPayload::error(
                current_version,
                initiated_by,
                UpdateErrorKind::Unknown,
                err.to_string(),
            );
        }
    };

    let configured_endpoints: Option<Vec<String>> = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|cfg| cfg.get("endpoints"))
        .and_then(|value| serde_json::from_value::<Vec<String>>(value.clone()).ok());

    log::debug!(
        "Starting updater check (initiated_by={:?}) with configured endpoints: {:?}",
        initiated_by, configured_endpoints
    );

    match updater.check().await {
        Ok(Some(update)) => {
            let target_version = update.version.clone();
            let notes = update.body.clone();

            info!(
                "Update available: current={} -> target={} (initiator={:?})",
                update.current_version, target_version, initiated_by
            );

            let install_result = update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|err| {
                    error!(
                        "Failed to download/install update to {target_version}: {err}"
                    );
                    err
                });

            match install_result {
                Ok(()) => {
                    info!("Update {target_version} installed successfully");
                    UpdateResultPayload::updated(
                        current_version,
                        target_version,
                        notes,
                        initiated_by,
                    )
                }
                Err(err) => {
                    let kind = classify_error(&err);
                    UpdateResultPayload::error(current_version, initiated_by, kind, err.to_string())
                }
            }
        }
        Ok(None) => {
            debug!("No updates available (initiator={initiated_by:?})");
            UpdateResultPayload::up_to_date(current_version, initiated_by)
        }
        Err(err) => {
            warn!(
                "Updater check failed after querying endpoints {:?}: {err}",
                configured_endpoints
            );
            let kind = classify_error(&err);
            UpdateResultPayload::error(current_version, initiated_by, kind, err.to_string())
        }
    }
}

pub async fn run_auto_update(app: &AppHandle, enabled: bool) {
    if !enabled {
        debug!("Auto update disabled by user preference");
        return;
    }

    let payload = check_for_updates(app, UpdateInitiator::Auto).await;
    if payload.status == UpdateStatus::Error {
        warn!(
            "Auto update failed (kind={kind:?}): {message:?}",
            kind = payload.error_kind,
            message = payload.error_message
        );
    }
}

pub async fn run_manual_update(app: &AppHandle) -> UpdateResultPayload {
    check_for_updates(app, UpdateInitiator::Manual).await
}

use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::{
    commands::session_lookup_cache::{current_repo_cache_key, global_session_lookup_cache},
    get_schaltwerk_core,
};
use schaltwerk::domains::sessions::EnrichedSession;
use schaltwerk::infrastructure::events::{emit_event, SchaltEvent};

const DEFAULT_COOLDOWN: Duration = Duration::from_millis(125);
const MIN_INTERVAL_BETWEEN_SNAPSHOTS: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Default)]
pub enum SessionsRefreshReason {
    #[default]
    Unknown,
    SessionLifecycle,
    GitUpdate,
    AgentActivity,
    MergeWorkflow,
    SpecSync,
}

impl SessionsRefreshReason {
    fn as_str(&self) -> &'static str {
        match self {
            SessionsRefreshReason::Unknown => "unknown",
            SessionsRefreshReason::SessionLifecycle => "session-lifecycle",
            SessionsRefreshReason::GitUpdate => "git-update",
            SessionsRefreshReason::AgentActivity => "agent-activity",
            SessionsRefreshReason::MergeWorkflow => "merge-workflow",
            SessionsRefreshReason::SpecSync => "spec-sync",
        }
    }
}

#[derive(Debug, Default)]
struct HubState {
    in_flight: bool,
    dirty: bool,
    last_reason: SessionsRefreshReason,
    last_emit: Option<Instant>,
}

struct RefreshHub {
    state: Mutex<HubState>,
}

static REFRESH_HUB: Lazy<RefreshHub> = Lazy::new(|| RefreshHub {
    state: Mutex::new(HubState::default()),
});

impl RefreshHub {
    fn shared() -> &'static RefreshHub {
        &REFRESH_HUB
    }

    pub fn request(app: &AppHandle, reason: SessionsRefreshReason) {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            RefreshHub::shared().enqueue(app_handle, reason).await;
        });
    }

    async fn enqueue(&self, app: AppHandle, reason: SessionsRefreshReason) {
        let mut state = self.state.lock().await;
        if state.in_flight {
            state.dirty = true;
            state.last_reason = reason;
            log::trace!(
                "[SessionsRefreshHub] Coalescing refresh request (reason={}) while in-flight",
                reason.as_str()
            );
            return;
        }

        state.in_flight = true;
        state.last_reason = reason;
        let last_emit = state.last_emit;
        drop(state);

        let initial_delay = last_emit
            .map(|last| {
                let elapsed = Instant::now().saturating_duration_since(last);
                if elapsed >= MIN_INTERVAL_BETWEEN_SNAPSHOTS {
                    DEFAULT_COOLDOWN
                } else {
                    let remaining = MIN_INTERVAL_BETWEEN_SNAPSHOTS - elapsed;
                    DEFAULT_COOLDOWN.max(remaining)
                }
            })
            .unwrap_or(DEFAULT_COOLDOWN);

        self.spawn_refresh(app, reason, initial_delay);
    }

    fn spawn_refresh(&self, app: AppHandle, reason: SessionsRefreshReason, delay: Duration) {
        let hub = RefreshHub::shared();
        tauri::async_runtime::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }

            if let Err(error) = hub.perform_refresh(app.clone()).await {
                log::warn!(
                    "[SessionsRefreshHub] Failed to emit SessionsRefreshed (reason={}): {}",
                    reason.as_str(),
                    error
                );
            }

            let now = Instant::now();
            let mut state = hub.state.lock().await;
            let previous_emit = state.last_emit;
            state.last_emit = Some(now);

            if state.dirty {
                let next_reason = state.last_reason;
                state.dirty = false;

                let elapsed = previous_emit
                    .map(|last| now.saturating_duration_since(last))
                    .unwrap_or(MIN_INTERVAL_BETWEEN_SNAPSHOTS);

                let min_delay = if elapsed >= MIN_INTERVAL_BETWEEN_SNAPSHOTS {
                    DEFAULT_COOLDOWN
                } else {
                    let remaining = MIN_INTERVAL_BETWEEN_SNAPSHOTS - elapsed;
                    DEFAULT_COOLDOWN.max(remaining)
                };

                state.in_flight = true;
                drop(state);

                hub.spawn_refresh(app, next_reason, min_delay);
            } else {
                state.in_flight = false;
            }
        });
    }

    async fn perform_refresh(&self, app: AppHandle) -> Result<()> {
        let (repo_key, sessions) = self.snapshot().await?;
        global_session_lookup_cache()
            .hydrate_repo(&repo_key, &sessions)
            .await;
        emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions)?;
        Ok(())
    }

    async fn snapshot(&self) -> Result<(String, Vec<EnrichedSession>)> {
        let core = get_schaltwerk_core().await.map_err(|e| anyhow!(e))?;
        let manager = {
            let guard = core.lock().await;
            guard.session_manager()
        };
        let sessions = manager.list_enriched_sessions()?;
        let repo_key = current_repo_cache_key().await.map_err(|e| anyhow!(e))?;
        Ok((repo_key, sessions))
    }
}

pub fn request_sessions_refresh(app: &AppHandle, reason: SessionsRefreshReason) {
    RefreshHub::request(app, reason);
}

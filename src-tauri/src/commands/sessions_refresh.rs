use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::{
    commands::session_lookup_cache::{current_repo_cache_key, global_session_lookup_cache},
    get_core_read,
};
use schaltwerk::domains::sessions::EnrichedSession;
use schaltwerk::infrastructure::events::{SchaltEvent, emit_event};

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

static REFRESH_HUB: LazyLock<RefreshHub> = LazyLock::new(|| RefreshHub {
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
        let manager = {
            let core = get_core_read().await.map_err(|e| anyhow!(e))?;
            core.session_manager()
        };
        let sessions = manager.list_enriched_sessions()?;
        let repo_key = current_repo_cache_key().await.map_err(|e| anyhow!(e))?;
        Ok((repo_key, sessions))
    }
}

pub fn request_sessions_refresh(app: &AppHandle, reason: SessionsRefreshReason) {
    RefreshHub::request(app, reason);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sessions_refresh_reason_as_str_unknown() {
        let reason = SessionsRefreshReason::Unknown;
        assert_eq!(reason.as_str(), "unknown");
    }

    #[test]
    fn test_sessions_refresh_reason_as_str_session_lifecycle() {
        let reason = SessionsRefreshReason::SessionLifecycle;
        assert_eq!(reason.as_str(), "session-lifecycle");
    }

    #[test]
    fn test_sessions_refresh_reason_as_str_git_update() {
        let reason = SessionsRefreshReason::GitUpdate;
        assert_eq!(reason.as_str(), "git-update");
    }

    #[test]
    fn test_sessions_refresh_reason_as_str_agent_activity() {
        let reason = SessionsRefreshReason::AgentActivity;
        assert_eq!(reason.as_str(), "agent-activity");
    }

    #[test]
    fn test_sessions_refresh_reason_as_str_merge_workflow() {
        let reason = SessionsRefreshReason::MergeWorkflow;
        assert_eq!(reason.as_str(), "merge-workflow");
    }

    #[test]
    fn test_sessions_refresh_reason_as_str_spec_sync() {
        let reason = SessionsRefreshReason::SpecSync;
        assert_eq!(reason.as_str(), "spec-sync");
    }

    #[test]
    fn test_sessions_refresh_reason_default() {
        let reason: SessionsRefreshReason = Default::default();
        assert_eq!(reason.as_str(), "unknown");
    }

    #[test]
    fn test_hub_state_default() {
        let state = HubState::default();
        assert!(!state.in_flight);
        assert!(!state.dirty);
        assert_eq!(state.last_reason.as_str(), "unknown");
        assert_eq!(state.last_emit, None);
    }

    #[tokio::test]
    async fn test_hub_state_in_flight_initial_state() {
        let state = HubState {
            in_flight: false,
            dirty: false,
            last_reason: SessionsRefreshReason::Unknown,
            last_emit: None,
        };
        assert!(!state.in_flight);
        assert!(!state.dirty);
    }

    #[tokio::test]
    async fn test_hub_state_with_in_flight_true() {
        let state = HubState {
            in_flight: true,
            dirty: false,
            last_reason: SessionsRefreshReason::SessionLifecycle,
            last_emit: None,
        };
        assert!(state.in_flight);
        assert!(!state.dirty);
        assert_eq!(state.last_reason.as_str(), "session-lifecycle");
    }

    #[tokio::test]
    async fn test_hub_state_with_dirty_and_reason() {
        let state = HubState {
            in_flight: true,
            dirty: true,
            last_reason: SessionsRefreshReason::GitUpdate,
            last_emit: None,
        };
        assert!(state.in_flight);
        assert!(state.dirty);
        assert_eq!(state.last_reason.as_str(), "git-update");
    }

    #[tokio::test]
    async fn test_hub_state_with_last_emit() {
        let now = Instant::now();
        let state = HubState {
            in_flight: false,
            dirty: false,
            last_reason: SessionsRefreshReason::Unknown,
            last_emit: Some(now),
        };
        assert_eq!(state.last_emit, Some(now));
    }

    #[tokio::test]
    async fn test_hub_state_mutable_transitions() {
        let mut state = HubState::default();

        assert!(!state.in_flight);
        state.in_flight = true;
        assert!(state.in_flight);

        assert!(!state.dirty);
        state.dirty = true;
        assert!(state.dirty);

        state.last_reason = SessionsRefreshReason::AgentActivity;
        assert_eq!(state.last_reason.as_str(), "agent-activity");

        let now = Instant::now();
        state.last_emit = Some(now);
        assert_eq!(state.last_emit, Some(now));
    }

    #[tokio::test]
    async fn test_hub_state_coalesce_scenario() {
        let mut state = HubState {
            in_flight: true,
            dirty: false,
            last_reason: SessionsRefreshReason::Unknown,
            last_emit: None,
        };

        state.dirty = true;
        state.last_reason = SessionsRefreshReason::GitUpdate;

        assert!(state.in_flight);
        assert!(state.dirty);
        assert_eq!(state.last_reason.as_str(), "git-update");
    }

    #[tokio::test]
    async fn test_hub_state_multiple_coalesces() {
        let mut state = HubState {
            in_flight: true,
            dirty: false,
            last_reason: SessionsRefreshReason::Unknown,
            last_emit: None,
        };

        state.dirty = true;
        state.last_reason = SessionsRefreshReason::SessionLifecycle;
        assert_eq!(state.last_reason.as_str(), "session-lifecycle");

        state.dirty = true;
        state.last_reason = SessionsRefreshReason::MergeWorkflow;
        assert_eq!(
            state.last_reason.as_str(),
            "merge-workflow",
            "Last coalesced reason should be merge-workflow"
        );
    }

    #[tokio::test]
    async fn test_hub_state_refresh_completion() {
        let now = Instant::now();
        let mut state = HubState {
            in_flight: true,
            dirty: true,
            last_reason: SessionsRefreshReason::SpecSync,
            last_emit: Some(now),
        };

        state.dirty = false;
        state.in_flight = false;

        assert!(!state.in_flight);
        assert!(!state.dirty);
        assert_eq!(state.last_emit, Some(now));
        assert_eq!(state.last_reason.as_str(), "spec-sync");
    }

    #[test]
    fn test_constants_are_correct() {
        assert_eq!(DEFAULT_COOLDOWN, Duration::from_millis(125));
        assert_eq!(MIN_INTERVAL_BETWEEN_SNAPSHOTS, Duration::from_millis(250));
    }

    #[test]
    fn test_cooldown_is_less_than_min_interval() {
        assert!(DEFAULT_COOLDOWN < MIN_INTERVAL_BETWEEN_SNAPSHOTS);
    }

    #[test]
    fn test_min_interval_duration_calculation_recent() {
        let elapsed = Duration::from_millis(50);
        let remaining = MIN_INTERVAL_BETWEEN_SNAPSHOTS - elapsed;
        let delay = DEFAULT_COOLDOWN.max(remaining);

        assert!(delay >= DEFAULT_COOLDOWN);
        assert!(delay >= remaining);
    }

    #[test]
    fn test_min_interval_duration_calculation_old() {
        let elapsed = Duration::from_millis(300);
        let should_use_cooldown = elapsed >= MIN_INTERVAL_BETWEEN_SNAPSHOTS;
        assert!(should_use_cooldown);
    }

    #[test]
    fn test_refresh_reason_variants_cover_all_cases() {
        let reasons = [
            SessionsRefreshReason::Unknown,
            SessionsRefreshReason::SessionLifecycle,
            SessionsRefreshReason::GitUpdate,
            SessionsRefreshReason::AgentActivity,
            SessionsRefreshReason::MergeWorkflow,
            SessionsRefreshReason::SpecSync,
        ];

        for reason in &reasons {
            let s = reason.as_str();
            assert!(!s.is_empty(), "Reason string should not be empty");
        }
    }

    #[test]
    fn test_refresh_reason_strings_are_unique() {
        let reasons = [
            SessionsRefreshReason::Unknown,
            SessionsRefreshReason::SessionLifecycle,
            SessionsRefreshReason::GitUpdate,
            SessionsRefreshReason::AgentActivity,
            SessionsRefreshReason::MergeWorkflow,
            SessionsRefreshReason::SpecSync,
        ];

        let strings: Vec<&str> = reasons.iter().map(|r| r.as_str()).collect();
        let unique_count = strings
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len();
        assert_eq!(unique_count, 6, "All reason strings should be unique");
    }
}

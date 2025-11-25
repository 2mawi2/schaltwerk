use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use crate::errors::SchaltError;
use crate::infrastructure::events::{SchaltEvent, emit_event};
use log::{debug, error, info, warn};
use once_cell::sync::OnceCell;
use tauri::Manager;
use tokio::sync::Mutex;

use super::platform::{PlatformAdapter, default_adapter};
use super::security::{ProcessInspector, SecurityConfig, SecurityContext};
use super::types::{GlobalState, InhibitorState, ProcessInfo};

#[cfg(test)]
type AppRuntime = tauri::test::MockRuntime;
#[cfg(not(test))]
type AppRuntime = tauri::Wry;

// Global singleton so terminal domain can report activity without tight coupling
static GLOBAL_KEEP_AWAKE: OnceCell<Arc<GlobalInhibitorService>> = OnceCell::new();

pub fn set_global_keep_awake_service(service: Arc<GlobalInhibitorService>) {
    let _ = GLOBAL_KEEP_AWAKE.set(service);
}

pub fn get_global_keep_awake_service() -> Option<Arc<GlobalInhibitorService>> {
    GLOBAL_KEEP_AWAKE.get().cloned()
}

#[derive(Clone)]
struct SystemProcessInspector;

impl ProcessInspector for SystemProcessInspector {
    fn is_running(&self, pid: u32) -> Result<bool, SchaltError> {
        let res = nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None);
        match res {
            Ok(_) => Ok(true),
            Err(nix::errno::Errno::ESRCH) => Ok(false),
            Err(e) => Err(SchaltError::IoError {
                operation: "kill-check".into(),
                path: pid.to_string(),
                message: e.to_string(),
            }),
        }
    }

    fn cmdline(&self, pid: u32) -> Result<String, SchaltError> {
        #[cfg(target_os = "linux")]
        {
            let path = format!("/proc/{pid}/cmdline");
            let content = fs::read_to_string(&path).map_err(|e| SchaltError::IoError {
                operation: "read_cmdline".into(),
                path,
                message: e.to_string(),
            })?;
            Ok(content.replace('\0', " ").trim().to_string())
        }

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;

            let output = Command::new("ps")
                .args(["-p", &pid.to_string(), "-o", "command="])
                .output()
                .map_err(|e| SchaltError::IoError {
                    operation: "ps_cmdline".into(),
                    path: pid.to_string(),
                    message: e.to_string(),
                })?;
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }

        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            Ok(String::new())
        }
    }

    fn kill_term(&self, pid: u32) -> Result<(), SchaltError> {
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        )
        .map_err(|e| SchaltError::IoError {
            operation: "sigterm".into(),
            path: pid.to_string(),
            message: e.to_string(),
        })
    }

    fn kill_kill(&self, pid: u32) -> Result<(), SchaltError> {
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGKILL,
        )
        .map_err(|e| SchaltError::IoError {
            operation: "sigkill".into(),
            path: pid.to_string(),
            message: e.to_string(),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    enabled: bool,
}

struct KeepAwakeStore {
    path: PathBuf,
}

impl KeepAwakeStore {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Result<bool, SchaltError> {
        if !self.path.exists() {
            return Ok(false);
        }

        let raw = fs::read_to_string(&self.path).map_err(|e| SchaltError::IoError {
            operation: "read_power_settings".into(),
            path: self.path.display().to_string(),
            message: e.to_string(),
        })?;

        match serde_json::from_str::<PersistedSettings>(&raw) {
            Ok(parsed) => Ok(parsed.enabled),
            Err(e) => {
                warn!("Failed to parse power settings, using defaults: {e}");
                Ok(false)
            }
        }
    }

    fn save(&self, enabled: bool) -> Result<(), SchaltError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| SchaltError::IoError {
                operation: "create_power_settings_dir".into(),
                path: parent.display().to_string(),
                message: e.to_string(),
            })?;
        }

        let payload = PersistedSettings { enabled };
        let body = serde_json::to_string_pretty(&payload).map_err(|e| SchaltError::IoError {
            operation: "serialize_power_settings".into(),
            path: self.path.display().to_string(),
            message: e.to_string(),
        })?;

        fs::write(&self.path, body).map_err(|e| SchaltError::IoError {
            operation: "write_power_settings".into(),
            path: self.path.display().to_string(),
            message: e.to_string(),
        })
    }
}

pub struct GlobalInhibitorService {
    state: Arc<Mutex<InhibitorState>>,
    security: SecurityContext,
    platform: Box<dyn PlatformAdapter>,
    app_handle: tauri::AppHandle<AppRuntime>,
    store: KeepAwakeStore,
    process_inspector: Arc<dyn ProcessInspector>,
}

impl GlobalInhibitorService {
    #[cfg(test)]
    pub fn new_for_tests(
        app_handle: tauri::AppHandle<AppRuntime>,
        security: SecurityContext,
        platform: Box<dyn PlatformAdapter>,
        store_path: PathBuf,
        process_inspector: Arc<dyn ProcessInspector>,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Arc::new(Mutex::new(InhibitorState::default())),
            security,
            platform,
            app_handle,
            store: KeepAwakeStore::new(store_path),
            process_inspector,
        })
    }

    pub fn initialize(app_handle: tauri::AppHandle<AppRuntime>) -> Result<Arc<Self>, SchaltError> {
        let cache_dir = app_handle
            .path()
            .app_cache_dir()
            .map_err(|e| SchaltError::IoError {
                operation: "cache_dir".into(),
                path: "cache".into(),
                message: e.to_string(),
            })?
            .join("schaltwerk");
        fs::create_dir_all(&cache_dir).map_err(|e| SchaltError::IoError {
            operation: "create_cache_dir".into(),
            path: cache_dir.display().to_string(),
            message: e.to_string(),
        })?;

        let pid_file = cache_dir.join("keep-awake.pid");

        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|e| SchaltError::IoError {
                operation: "config_dir".into(),
                path: "config".into(),
                message: e.to_string(),
            })?;
        fs::create_dir_all(&config_dir).map_err(|e| SchaltError::IoError {
            operation: "create_config_dir".into(),
            path: config_dir.display().to_string(),
            message: e.to_string(),
        })?;

        let store_path = config_dir.join("power_settings.json");
        let store = KeepAwakeStore::new(store_path);

        let process_inspector: Arc<dyn ProcessInspector> = Arc::new(SystemProcessInspector);
        let security = SecurityContext::new(
            SecurityConfig::with_pid_file(pid_file),
            Arc::clone(&process_inspector),
        );

        // Defensive cleanup of orphaned inhibitor if any
        security.cleanup_on_startup()?;

        let platform = default_adapter().map_err(|e| {
            error!("Failed to create platform adapter for keep-awake: {e}");
            e
        })?;

        let enabled = store.load()?;

        let state = InhibitorState {
            user_enabled: enabled,
            active_sessions: HashSet::new(),
            running_sessions: HashSet::new(),
            running_by_project: std::collections::HashMap::new(),
            process_info: None,
            child: None,
            last_watchdog_check: Instant::now(),
            idle_deadline: None,
            last_emitted_state: None,
        };

        let service = Arc::new(Self {
            state: Arc::new(Mutex::new(state)),
            security,
            platform: Box::new(platform),
            app_handle,
            store,
            process_inspector,
        });

        // Start watchdog loop
        let svc_clone = Arc::clone(&service);
        tauri::async_runtime::spawn(async move {
            svc_clone.watchdog_loop().await;
        });

        Ok(service)
    }

    pub async fn handle_session_activity(
        &self,
        session_id: String,
        is_idle: bool,
    ) -> Result<GlobalState, SchaltError> {
        let mut guard = self.state.lock().await;

        debug!(
            "[keep-awake] activity event: session={} idle={} before: running={} active={}",
            session_id,
            is_idle,
            guard.running_sessions.len(),
            guard.active_sessions.len()
        );

        if !is_idle {
            // Any activity implies the session is running
            guard.running_sessions.insert(session_id.clone());
        }

        if guard.running_sessions.contains(&session_id) {
            if is_idle {
                guard.active_sessions.remove(&session_id);
                if guard.active_sessions.is_empty() {
                    guard.idle_deadline = Some(Instant::now());
                }
            } else {
                guard.active_sessions.insert(session_id);
                guard.idle_deadline = None;
            }
        } else {
            guard.active_sessions.remove(&session_id);
        }

        let next = self.evaluate_state(&mut guard).await?;
        let active_count = guard.active_sessions.len();
        let should_emit = self.mark_state_if_changed(&mut guard, &next);
        drop(guard);
        if should_emit {
            self.emit_state(next.clone(), active_count);
        }
        Ok(next)
    }

    pub async fn enable_global(&self) -> Result<GlobalState, SchaltError> {
        let mut guard = self.state.lock().await;
        if guard.user_enabled {
            let state = self.current_state(&guard);
            return Ok(state);
        }
        guard.user_enabled = true;
        self.store.save(true)?;
        let next = self.evaluate_state(&mut guard).await?;
        let active_count = guard.active_sessions.len();
        let should_emit = self.mark_state_if_changed(&mut guard, &next);
        drop(guard);
        if should_emit {
            self.emit_state(next.clone(), active_count);
        }
        Ok(next)
    }

    pub async fn disable_global(&self) -> Result<GlobalState, SchaltError> {
        let mut guard = self.state.lock().await;
        guard.user_enabled = false;
        guard.idle_deadline = None;
        self.stop_inhibitor_locked(&mut guard).await?;
        if let Ok(Some(pid)) = self.platform.find_existing_inhibitor() {
            warn!("Disabling keep-awake: terminating stray inhibitor pid={pid}");
            let _ = self.security.kill_process_gracefully(pid);
            let _ = self.security.delete_pid_file();
        }
        self.store.save(false)?;
        let next = GlobalState::Disabled;
        let active_count = guard.active_sessions.len();
        let should_emit = self.mark_state_if_changed(&mut guard, &next);
        drop(guard);
        if should_emit {
            self.emit_state(next.clone(), active_count);
        }
        Ok(next)
    }

    pub async fn get_state(&self) -> GlobalState {
        let guard = self.state.lock().await;
        self.current_state(&guard)
    }

    pub async fn broadcast_state(&self) -> GlobalState {
        let mut guard = self.state.lock().await;
        let state = self.current_state(&guard);
        let active = guard.active_sessions.len();
        let should_emit = self.mark_state_if_changed(&mut guard, &state);
        drop(guard);
        if should_emit {
            self.emit_state(state.clone(), active);
        }
        state
    }

    /// Sync the service with the latest set of running sessions across all projects.
    /// Removes any stale active sessions that are no longer running and re-evaluates state.
    pub async fn sync_running_sessions(
        &self,
        project_path: String,
        running_sessions: HashSet<String>,
    ) -> Result<GlobalState, SchaltError> {
        let mut guard = self.state.lock().await;
        debug!(
            "[keep-awake] syncing running sessions: project={} incoming={} previous_running={} previous_active={}",
            project_path,
            running_sessions.len(),
            guard.running_sessions.len(),
            guard.active_sessions.len()
        );
        guard
            .running_by_project
            .insert(project_path.clone(), running_sessions);

        // rebuild union
        let union: Vec<String> = guard
            .running_by_project
            .values()
            .flat_map(|set| set.iter().cloned())
            .collect();
        guard.running_sessions.clear();
        guard.running_sessions.extend(union);

        let running_snapshot = guard.running_sessions.clone();
        guard
            .active_sessions
            .retain(|id| running_snapshot.contains(id));
        if guard.running_sessions.is_empty() {
            guard.idle_deadline = None;
            guard.running_by_project.retain(|_, set| !set.is_empty());
        }

        let next = self.evaluate_state(&mut guard).await?;
        let active_count = guard.active_sessions.len();
        let should_emit = self.mark_state_if_changed(&mut guard, &next);
        drop(guard);
        if should_emit {
            self.emit_state(next.clone(), active_count);
        }
        Ok(next)
    }

    async fn evaluate_state(&self, state: &mut InhibitorState) -> Result<GlobalState, SchaltError> {
        if !state.user_enabled {
            self.stop_inhibitor_locked(state).await?;
            return Ok(GlobalState::Disabled);
        }

        if state.running_sessions.is_empty() {
            state.active_sessions.clear();
            state.idle_deadline = None;
            self.stop_inhibitor_locked(state).await?;
            debug!(
                "[keep-awake] decision=auto_paused reason=no_running_sessions active={} idle_deadline={:?} projects={}",
                state.active_sessions.len(),
                state.idle_deadline,
                state.running_by_project.len()
            );
            return Ok(GlobalState::AutoPaused);
        }

        let now = Instant::now();

        if !state.active_sessions.is_empty() {
            state.idle_deadline = None;
            if state.process_info.is_none() {
                self.spawn_inhibitor_locked(state).await?;
            }
            debug!(
                "[keep-awake] decision=active reason=has_active running={} active={}",
                state.running_sessions.len(),
                state.active_sessions.len()
            );
            return Ok(GlobalState::Active);
        }

        if let Some(deadline) = state.idle_deadline {
            if now >= deadline {
                self.stop_inhibitor_locked(state).await?;
                state.idle_deadline = None;
                debug!(
                    "[keep-awake] decision=auto_paused reason=idle_deadline elapsed running={} active={}",
                    state.running_sessions.len(),
                    state.active_sessions.len()
                );
                return Ok(GlobalState::AutoPaused);
            }
        } else {
            debug!(
                "[keep-awake] decision=auto_paused reason=no_active_no_process running={} active={}",
                state.running_sessions.len(),
                state.active_sessions.len()
            );
            return Ok(GlobalState::AutoPaused);
        }

        if state.process_info.is_some() {
            Ok(GlobalState::Active)
        } else {
            Ok(GlobalState::AutoPaused)
        }
    }

    async fn spawn_inhibitor_locked(&self, state: &mut InhibitorState) -> Result<(), SchaltError> {
        if state.process_info.is_some() {
            return Ok(());
        }

        // Clean any recorded duplicate via pid file
        if let Some(existing) = self.security.read_pid_file()? {
            if self.process_inspector.is_running(existing.pid)? {
                info!(
                    "Killing existing inhibitor pid {} before spawning new",
                    existing.pid
                );
                self.security.kill_process_gracefully(existing.pid)?;
            }
            self.security.delete_pid_file()?;
        }

        if let Some(pid) = self.platform.find_existing_inhibitor()? {
            warn!("Found possible existing inhibitor process {pid}, terminating it");
            self.security.kill_process_gracefully(pid)?;
        }

        let mut cmd = self.platform.build_command()?;
        let command_line = format!("{cmd:?}");

        let child = cmd.spawn().map_err(|e| SchaltError::IoError {
            operation: "spawn_inhibitor".into(),
            path: command_line.clone(),
            message: e.to_string(),
        })?;
        let pid = child.id();
        self.security.write_pid_file(pid, &command_line)?;

        state.process_info = Some(ProcessInfo {
            pid,
            command_line: command_line.clone(),
            spawned_at: SystemTime::now(),
        });
        state.child = Some(child);
        info!("Spawned keep-awake inhibitor pid={pid}");
        Ok(())
    }

    async fn stop_inhibitor_locked(&self, state: &mut InhibitorState) -> Result<(), SchaltError> {
        if let Some(info) = state.process_info.take() {
            info!("Stopping inhibitor pid={}", info.pid);
            self.security.kill_process_gracefully(info.pid)?;
            self.security.delete_pid_file()?;
            if let Some(mut child) = state.child.take() {
                let _ = child.try_wait();
            }
        }
        Ok(())
    }

    fn current_state(&self, state: &InhibitorState) -> GlobalState {
        if !state.user_enabled {
            return GlobalState::Disabled;
        }
        if state.running_sessions.is_empty() {
            return GlobalState::AutoPaused;
        }
        if state.process_info.is_some() {
            if state.active_sessions.is_empty() {
                return GlobalState::AutoPaused;
            }
            return GlobalState::Active;
        }
        GlobalState::AutoPaused
    }

    async fn watchdog_loop(self: Arc<Self>) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            if let Err(e) = self.watchdog_check().await {
                warn!("Keep-awake watchdog error: {e}");
            }
        }
    }

    async fn watchdog_check(&self) -> Result<(), SchaltError> {
        let mut guard = self.state.lock().await;
        let now = Instant::now();
        if now.duration_since(guard.last_watchdog_check) < Duration::from_secs(25) {
            return Ok(());
        }
        guard.last_watchdog_check = now;

        if guard.running_sessions.is_empty() {
            guard.active_sessions.clear();
            guard.idle_deadline = None;
            guard.running_by_project.retain(|_, set| !set.is_empty());
            if guard.process_info.is_some() {
                self.stop_inhibitor_locked(&mut guard).await?;
            }
            let next = if guard.user_enabled {
                GlobalState::AutoPaused
            } else {
                GlobalState::Disabled
            };
            let should_emit = self.mark_state_if_changed(&mut guard, &next);
            drop(guard);
            if should_emit {
                self.emit_state(next, 0);
            }
            return Ok(());
        }

        if guard.process_info.is_some()
            && guard.active_sessions.is_empty()
            && guard
                .idle_deadline
                .is_some_and(|deadline| now >= deadline)
        {
            self.stop_inhibitor_locked(&mut guard).await?;
            let next = GlobalState::AutoPaused;
            let should_emit = self.mark_state_if_changed(&mut guard, &next);
            drop(guard);
            if should_emit {
                self.emit_state(next, 0);
            }
            return Ok(());
        }

        if let Some(info) = &guard.process_info {
            let running = self.process_inspector.is_running(info.pid)?;
            if !running {
                warn!("Inhibitor pid {} not running; clearing state", info.pid);
                guard.process_info = None;
                guard.child = None;
                self.security.delete_pid_file()?;

                let next = if guard.user_enabled && !guard.active_sessions.is_empty() {
                    self.spawn_inhibitor_locked(&mut guard).await?;
                    GlobalState::Active
                } else if guard.user_enabled {
                    GlobalState::AutoPaused
                } else {
                    GlobalState::Disabled
                };
                let active_count = guard.active_sessions.len();
                let should_emit = self.mark_state_if_changed(&mut guard, &next);
                drop(guard);
                if should_emit {
                    self.emit_state(next, active_count);
                }
                return Ok(());
            } else {
                let actual = self.process_inspector.cmdline(info.pid)?;
                if !actual.contains("caffeinate") && !actual.contains("systemd-inhibit") {
                    warn!("PID {} reused by other process: {}", info.pid, actual);
                    guard.process_info = None;
                    guard.child = None;
                    self.security.delete_pid_file()?;
                    let next = if guard.user_enabled {
                        if guard.active_sessions.is_empty() {
                            GlobalState::AutoPaused
                        } else {
                            GlobalState::Active
                        }
                    } else {
                        GlobalState::Disabled
                    };
                    let active_count = guard.active_sessions.len();
                    let should_emit = self.mark_state_if_changed(&mut guard, &next);
                    drop(guard);
                    if should_emit {
                        self.emit_state(next, active_count);
                    }
                    return Ok(());
                }
            }
        } else if guard.user_enabled && !guard.active_sessions.is_empty() {
            self.spawn_inhibitor_locked(&mut guard).await?;
        }

        Ok(())
    }

    #[cfg(test)]
    pub async fn force_watchdog_check(&self) -> Result<(), SchaltError> {
        {
            let mut guard = self.state.lock().await;
            guard.last_watchdog_check = Instant::now() - Duration::from_secs(30);
        }
        self.watchdog_check().await
    }

    fn mark_state_if_changed(&self, guard: &mut InhibitorState, next: &GlobalState) -> bool {
        let should_emit = guard
            .last_emitted_state
            .as_ref()
            .map(|prev| prev != next)
            .unwrap_or(true);
        if should_emit {
            guard.last_emitted_state = Some(next.clone());
        }
        should_emit
    }

    fn emit_state(&self, state: GlobalState, active_count: usize) {
        let payload = serde_json::json!({
            "state": state,
            "activeCount": active_count,
        });
        if let Err(e) = emit_event(
            &self.app_handle,
            SchaltEvent::GlobalKeepAwakeStateChanged,
            &payload,
        ) {
            debug!("Failed to emit keep-awake state event: {e}");
        }
    }
}

impl Drop for GlobalInhibitorService {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.state.try_lock() {
            if let Some(info) = guard.process_info.take() {
                let _ = self.security.kill_process_gracefully(info.pid);
            }
            let _ = self.security.delete_pid_file();
            guard.child = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;
    use serial_test::serial;
    use std::collections::HashSet;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use tempfile::TempDir;

    #[derive(Clone)]
    struct FakeInspector {
        running: Arc<AtomicBool>,
        term_calls: Arc<AtomicUsize>,
        kill_calls: Arc<AtomicUsize>,
        cmdline: Arc<StdMutex<String>>,
    }

    impl FakeInspector {
        fn new(cmdline: &str) -> Self {
            Self {
                running: Arc::new(AtomicBool::new(false)),
                term_calls: Arc::new(AtomicUsize::new(0)),
                kill_calls: Arc::new(AtomicUsize::new(0)),
                cmdline: Arc::new(StdMutex::new(cmdline.to_string())),
            }
        }

        fn set_running(&self, value: bool) {
            self.running.store(value, Ordering::SeqCst);
        }

        fn term_calls(&self) -> usize {
            self.term_calls.load(Ordering::SeqCst)
        }
    }

    impl ProcessInspector for FakeInspector {
        fn is_running(&self, _pid: u32) -> Result<bool, SchaltError> {
            Ok(self.running.load(Ordering::SeqCst))
        }

        fn cmdline(&self, _pid: u32) -> Result<String, SchaltError> {
            Ok(self.cmdline.lock().unwrap().clone())
        }

        fn kill_term(&self, _pid: u32) -> Result<(), SchaltError> {
            self.term_calls.fetch_add(1, Ordering::SeqCst);
            self.running.store(false, Ordering::SeqCst);
            Ok(())
        }

        fn kill_kill(&self, _pid: u32) -> Result<(), SchaltError> {
            self.kill_calls.fetch_add(1, Ordering::SeqCst);
            self.running.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    #[derive(Clone)]
    struct FakePlatform {
        inspector: Arc<FakeInspector>,
        spawns: Arc<AtomicUsize>,
        existing: Arc<StdMutex<Option<u32>>>,
    }

    impl FakePlatform {
        fn new(inspector: Arc<FakeInspector>) -> Self {
            Self {
                inspector,
                spawns: Arc::new(AtomicUsize::new(0)),
                existing: Arc::new(StdMutex::new(None)),
            }
        }

        fn set_existing(&self, pid: Option<u32>) {
            *self.existing.lock().unwrap() = pid;
        }

        fn spawn_count(&self) -> usize {
            self.spawns.load(Ordering::SeqCst)
        }
    }

    impl PlatformAdapter for FakePlatform {
        fn build_command(&self) -> Result<Command, SchaltError> {
            self.spawns.fetch_add(1, Ordering::SeqCst);
            self.inspector.set_running(true);
            Ok(Command::new("true"))
        }

        fn find_existing_inhibitor(&self) -> Result<Option<u32>, SchaltError> {
            Ok(*self.existing.lock().unwrap())
        }
    }

    fn build_service(
        tmp: &TempDir,
        inspector: Arc<FakeInspector>,
        platform: Arc<FakePlatform>,
    ) -> Arc<GlobalInhibitorService> {
        let app = tauri::test::mock_app();
        let security = SecurityContext::new(
            SecurityConfig::with_pid_file(tmp.path().join("keep-awake.pid")),
            inspector.clone(),
        );
        GlobalInhibitorService::new_for_tests(
            app.handle().clone(),
            security,
            Box::new((*platform).clone()),
            tmp.path().join("power_settings.json"),
            inspector.clone(),
        )
    }

    #[tokio::test]
    #[serial]
    async fn idle_transitions_to_auto_pause_and_stops_inhibitor() {
        let tmp = TempDir::new().unwrap();
        let inspector = Arc::new(FakeInspector::new("caffeinate -d # schaltwerk-keep-awake"));
        let platform = Arc::new(FakePlatform::new(inspector.clone()));
        let service = build_service(&tmp, inspector.clone(), platform.clone());

        service.enable_global().await.unwrap();

        service
            .handle_session_activity("s1".to_string(), false)
            .await
            .unwrap();
        service
            .handle_session_activity("s1".to_string(), true)
            .await
            .unwrap();
        let state = service
            .handle_session_activity("s1".to_string(), true)
            .await
            .unwrap();

        assert_eq!(state, GlobalState::AutoPaused);
        assert_eq!(service.get_state().await, GlobalState::AutoPaused);
        assert_eq!(inspector.term_calls(), 1);
        assert_eq!(platform.spawn_count(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn duplicate_inhibitor_is_killed_before_spawn() {
        let tmp = TempDir::new().unwrap();
        let inspector = Arc::new(FakeInspector::new("caffeinate -d # schaltwerk-keep-awake"));
        let platform = Arc::new(FakePlatform::new(inspector.clone()));
        platform.set_existing(Some(999));
        inspector.set_running(true);
        let service = build_service(&tmp, inspector.clone(), platform.clone());

        service.enable_global().await.unwrap();
        service
            .handle_session_activity("s1".to_string(), false)
            .await
            .unwrap();

        assert_eq!(platform.spawn_count(), 1);
        assert_eq!(inspector.term_calls(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn watchdog_respawns_after_process_dies() {
        let tmp = TempDir::new().unwrap();
        let inspector = Arc::new(FakeInspector::new("caffeinate -d # schaltwerk-keep-awake"));
        let platform = Arc::new(FakePlatform::new(inspector.clone()));
        let service = build_service(&tmp, inspector.clone(), platform.clone());

        service.enable_global().await.unwrap();
        service
            .handle_session_activity("s1".to_string(), false)
            .await
            .unwrap();

        let before = platform.spawn_count();
        inspector.set_running(false);

        service.force_watchdog_check().await.unwrap();

        assert!(
            platform.spawn_count() > before,
            "watchdog should respawn inhibitor"
        );
        assert_eq!(service.get_state().await, GlobalState::Active);
    }

    #[tokio::test]
    #[serial]
    async fn enabling_with_no_active_sessions_does_not_spawn() {
        let tmp = TempDir::new().unwrap();
        let inspector = Arc::new(FakeInspector::new("caffeinate -d # schaltwerk-keep-awake"));
        let platform = Arc::new(FakePlatform::new(inspector.clone()));
        let service = build_service(&tmp, inspector.clone(), platform.clone());

        let state = service.enable_global().await.unwrap();
        assert_eq!(state, GlobalState::AutoPaused);
        assert_eq!(platform.spawn_count(), 0);

        // First activity should spawn
        let state = service
            .handle_session_activity("s1".into(), false)
            .await
            .unwrap();
        assert_eq!(state, GlobalState::Active);
        assert_eq!(platform.spawn_count(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn sync_running_sessions_prunes_and_stops_when_none_running() {
        let tmp = TempDir::new().unwrap();
        let inspector = Arc::new(FakeInspector::new("systemd-inhibit --what=sleep:idle --who=Schaltwerk-KeepAwake --why=\"AI agent sessions active (schaltwerk-keep-awake)\" sleep infinity"));
        let platform = Arc::new(FakePlatform::new(inspector.clone()));
        let service = build_service(&tmp, inspector.clone(), platform.clone());

        service.enable_global().await.unwrap();
        service
            .handle_session_activity("s1".to_string(), false)
            .await
            .unwrap();
        assert_eq!(platform.spawn_count(), 1);
        inspector.set_running(true);

        let state = service
            .sync_running_sessions("project-a".to_string(), HashSet::new())
            .await
            .unwrap();

        assert_eq!(state, GlobalState::AutoPaused);
        assert_eq!(inspector.term_calls(), 1);
        assert_eq!(service.get_state().await, GlobalState::AutoPaused);
    }
}

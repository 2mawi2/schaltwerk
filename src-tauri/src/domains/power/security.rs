use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::errors::SchaltError;

pub const DEFAULT_SIGNATURE: &str = "schaltwerk-keep-awake";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PidFileData {
    pub pid: u32,
    pub command_line: String,
    pub created_at: SystemTime,
}

#[derive(Debug, Clone)]
pub struct SecurityConfig {
    pub pid_file_path: PathBuf,
    pub signature: String,
}

impl SecurityConfig {
    pub fn with_pid_file(path: PathBuf) -> Self {
        Self {
            pid_file_path: path,
            signature: DEFAULT_SIGNATURE.to_string(),
        }
    }
}

pub trait ProcessInspector: Send + Sync {
    fn is_running(&self, pid: u32) -> Result<bool, SchaltError>;
    fn cmdline(&self, pid: u32) -> Result<String, SchaltError>;
    fn kill_term(&self, pid: u32) -> Result<(), SchaltError>;
    fn kill_kill(&self, pid: u32) -> Result<(), SchaltError>;
}

pub struct SecurityContext {
    pub config: SecurityConfig,
    inspector: Arc<dyn ProcessInspector>,
}

impl SecurityContext {
    pub fn new(config: SecurityConfig, inspector: Arc<dyn ProcessInspector>) -> Self {
        Self { config, inspector }
    }

    pub fn write_pid_file(&self, pid: u32, command_line: &str) -> Result<(), SchaltError> {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        let content = format!("pid={pid}\ncreated_at={created_at}\ncmdline={command_line}\n");
        if let Some(parent) = self.config.pid_file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| SchaltError::IoError {
                operation: "create_pid_dir".into(),
                path: parent.display().to_string(),
                message: e.to_string(),
            })?;
        }
        fs::write(&self.config.pid_file_path, content).map_err(|e| SchaltError::IoError {
            operation: "write_pid_file".into(),
            path: self.config.pid_file_path.display().to_string(),
            message: e.to_string(),
        })?;
        Ok(())
    }

    pub fn read_pid_file(&self) -> Result<Option<PidFileData>, SchaltError> {
        if !self.config.pid_file_path.exists() {
            return Ok(None);
        }

        let content =
            fs::read_to_string(&self.config.pid_file_path).map_err(|e| SchaltError::IoError {
                operation: "read_pid_file".into(),
                path: self.config.pid_file_path.display().to_string(),
                message: e.to_string(),
            })?;
        parse_pid_file(&content)
    }

    pub fn delete_pid_file(&self) -> Result<(), SchaltError> {
        if self.config.pid_file_path.exists() {
            fs::remove_file(&self.config.pid_file_path).map_err(|e| SchaltError::IoError {
                operation: "remove_pid_file".into(),
                path: self.config.pid_file_path.display().to_string(),
                message: e.to_string(),
            })?;
        }
        Ok(())
    }

    /// Cleanup orphaned inhibitor on startup. Kills process if it looks like our inhibitor (signature or known binaries) or is dead.
    pub fn cleanup_on_startup(&self) -> Result<(), SchaltError> {
        let Some(data) = self.read_pid_file()? else {
            return Ok(());
        };

        match self.inspector.is_running(data.pid)? {
            false => {
                self.delete_pid_file()?;
                return Ok(());
            }
            true => {
                let cmdline = self.inspector.cmdline(data.pid)?;
                let looks_like_inhibitor = cmdline.contains("caffeinate")
                    || cmdline.contains("systemd-inhibit")
                    || cmdline.contains(&self.config.signature);

                if cmdline.contains(&self.config.signature) || looks_like_inhibitor {
                    self.kill_process_gracefully(data.pid)?;
                    self.delete_pid_file()?;
                } else {
                    // Leave the pid file to warn future runs; log for visibility
                    log::warn!(
                        "PID file points to running process {} with cmdline {:?} that is not recognized as inhibitor; pid file left in place",
                        data.pid,
                        cmdline
                    );
                }
            }
        }

        Ok(())
    }

    pub fn kill_process_gracefully(&self, pid: u32) -> Result<(), SchaltError> {
        self.inspector.kill_term(pid)?;

        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(1) {
            if !self.inspector.is_running(pid)? {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        self.inspector.kill_kill(pid)?;
        Ok(())
    }
}

fn parse_pid_file(raw: &str) -> Result<Option<PidFileData>, SchaltError> {
    let mut pid: Option<u32> = None;
    let mut created_at: Option<SystemTime> = None;
    let mut cmdline: Option<String> = None;

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("pid=") {
            pid = rest.trim().parse::<u32>().ok();
        } else if let Some(rest) = line.strip_prefix("created_at=") {
            if let Ok(ms) = rest.trim().parse::<u128>() {
                created_at = UNIX_EPOCH.checked_add(Duration::from_millis(ms as u64));
            }
        } else if let Some(rest) = line.strip_prefix("cmdline=") {
            cmdline = Some(rest.to_string());
        }
    }

    match (pid, created_at, cmdline) {
        (Some(pid), Some(created_at), Some(cmdline)) => Ok(Some(PidFileData {
            pid,
            command_line: cmdline,
            created_at,
        })),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tempfile::TempDir;

    #[derive(Clone, Default)]
    struct FakeInspector {
        running: Arc<AtomicBool>,
        term_called: Arc<AtomicBool>,
        kill_called: Arc<AtomicBool>,
        cmdline: Arc<std::sync::Mutex<String>>,
    }

    impl ProcessInspector for FakeInspector {
        fn is_running(&self, _pid: u32) -> Result<bool, SchaltError> {
            Ok(self.running.load(Ordering::SeqCst))
        }

        fn cmdline(&self, _pid: u32) -> Result<String, SchaltError> {
            Ok(self.cmdline.lock().unwrap().clone())
        }

        fn kill_term(&self, _pid: u32) -> Result<(), SchaltError> {
            self.term_called.store(true, Ordering::SeqCst);
            self.running.store(false, Ordering::SeqCst);
            Ok(())
        }

        fn kill_kill(&self, _pid: u32) -> Result<(), SchaltError> {
            self.kill_called.store(true, Ordering::SeqCst);
            self.running.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    fn build_ctx(tmp: &TempDir) -> (SecurityContext, FakeInspector) {
        let pid_path = tmp.path().join("keep-awake.pid");
        let inspector = FakeInspector::default();
        let ctx = SecurityContext::new(
            SecurityConfig::with_pid_file(pid_path),
            Arc::new(inspector.clone()),
        );
        (ctx, inspector)
    }

    #[test]
    fn pid_file_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let (ctx, _inspector) = build_ctx(&tmp);

        ctx.write_pid_file(1234, "caffeinate -d # schaltwerk-keep-awake")
            .unwrap();

        let data = ctx.read_pid_file().unwrap().expect("pid file should exist");
        assert_eq!(data.pid, 1234);
        assert!(data.command_line.contains("caffeinate"));
    }

    #[test]
    fn cleanup_removes_dead_process_pid_file() {
        let tmp = TempDir::new().unwrap();
        let (ctx, inspector) = build_ctx(&tmp);
        inspector.running.store(false, Ordering::SeqCst);
        *inspector.cmdline.lock().unwrap() = "caffeinate -d # schaltwerk-keep-awake".into();

        ctx.write_pid_file(42, "caffeinate -d # schaltwerk-keep-awake")
            .unwrap();
        ctx.cleanup_on_startup().unwrap();

        assert!(!ctx.config.pid_file_path.exists());
        assert!(!inspector.term_called.load(Ordering::SeqCst));
    }

    #[test]
    fn cleanup_kills_orphan_with_signature() {
        let tmp = TempDir::new().unwrap();
        let (ctx, inspector) = build_ctx(&tmp);
        inspector.running.store(true, Ordering::SeqCst);
        *inspector.cmdline.lock().unwrap() = "caffeinate -d # schaltwerk-keep-awake".into();

        ctx.write_pid_file(77, "caffeinate -d # schaltwerk-keep-awake")
            .unwrap();
        ctx.cleanup_on_startup().unwrap();

        assert!(inspector.term_called.load(Ordering::SeqCst));
        assert!(!ctx.config.pid_file_path.exists());
    }

    #[test]
    fn cleanup_skips_unrelated_process() {
        let tmp = TempDir::new().unwrap();
        let (ctx, inspector) = build_ctx(&tmp);
        inspector.running.store(true, Ordering::SeqCst);
        *inspector.cmdline.lock().unwrap() = "bash".into();

        ctx.write_pid_file(99, "caffeinate -d # schaltwerk-keep-awake")
            .unwrap();
        ctx.cleanup_on_startup().unwrap();

        assert!(!inspector.term_called.load(Ordering::SeqCst));
        // PID file remains to warn subsequent startups
        assert!(ctx.config.pid_file_path.exists());
    }
}

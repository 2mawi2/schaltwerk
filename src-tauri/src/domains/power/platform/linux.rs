use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use crate::errors::SchaltError;

use super::PlatformAdapter;

const WHO: &str = "Schaltwerk-KeepAwake";
const WHY: &str = "AI agent sessions active (schaltwerk-keep-awake)";

pub struct LinuxAdapter {
    inhibit_path: PathBuf,
}

impl LinuxAdapter {
    pub fn new() -> Result<Self, SchaltError> {
        let path = which::which("systemd-inhibit").map_err(|e| SchaltError::ConfigError {
            key: "systemd-inhibit".into(),
            message: format!("systemd-inhibit not found in PATH: {e}"),
        })?;

        Ok(Self { inhibit_path: path })
    }
}

impl PlatformAdapter for LinuxAdapter {
    fn build_command(&self) -> Result<Command, SchaltError> {
        let mut cmd = Command::new(&self.inhibit_path);

        cmd.arg("--what=sleep:idle")
            .arg(format!("--who={WHO}"))
            .arg(format!("--why={WHY}"))
            .arg("sleep")
            .arg("infinity");

        unsafe {
            cmd.pre_exec(|| {
                // Ensure inhibitor dies with the parent whenever possible
                #[cfg(target_os = "linux")]
                {
                    libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                }
                Ok(())
            });
        }

        Ok(cmd)
    }

    fn find_existing_inhibitor(&self) -> Result<Option<u32>, SchaltError> {
        let output = Command::new("pgrep")
            .arg("-f")
            .arg("systemd-inhibit.*Schaltwerk-KeepAwake")
            .output()
            .map_err(|e| SchaltError::IoError {
                operation: "pgrep".into(),
                path: "system".into(),
                message: e.to_string(),
            })?;

        if !output.status.success() || output.stdout.is_empty() {
            return Ok(None);
        }

        let pid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(pid) = pid_str.parse::<u32>() {
            Ok(Some(pid))
        } else {
            Ok(None)
        }
    }
}

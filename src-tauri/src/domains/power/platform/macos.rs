use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use crate::errors::SchaltError;

use super::PlatformAdapter;

pub struct MacOsAdapter {
    caffeinate_path: PathBuf,
}

impl MacOsAdapter {
    pub fn new() -> Result<Self, SchaltError> {
        let path = which::which("caffeinate").map_err(|e| SchaltError::ConfigError {
            key: "caffeinate".into(),
            message: format!("caffeinate not found in PATH: {e}"),
        })?;

        Ok(Self {
            caffeinate_path: path,
        })
    }
}

impl PlatformAdapter for MacOsAdapter {
    fn build_command(&self) -> Result<Command, SchaltError> {
        let mut cmd = Command::new(&self.caffeinate_path);
        cmd.arg("-d") // prevent display sleep
            .arg("-i") // prevent idle sleep
            .arg("-s") // prevent system sleep
            .arg("-u") // declare user active
            .arg("-w")
            .arg(std::process::id().to_string());

        // Place process in its own group so SIGHUP can propagate
        cmd.process_group(0);

        Ok(cmd)
    }

    fn find_existing_inhibitor(&self) -> Result<Option<u32>, SchaltError> {
        let output = Command::new("pgrep")
            .arg("-f")
            .arg("caffeinate .* -d -i -s -u")
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

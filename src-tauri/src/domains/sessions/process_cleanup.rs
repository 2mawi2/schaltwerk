use anyhow::Result;
use std::path::Path;

#[cfg(target_family = "unix")]
use {
    anyhow::Context,
    log::{debug, warn},
    std::collections::HashSet,
    tokio::process::Command,
    tokio::time::{sleep, Duration},
};

/// Workaround for https://github.com/openai/codex/issues/4726 until Codex cleans up its own
/// children: locate any external processes whose current working directory matches the provided
/// `path` and terminate them. Returns the list of process IDs that were targeted.
pub async fn terminate_processes_with_cwd(path: &Path) -> Result<Vec<i32>> {
    #[cfg(not(target_family = "unix"))]
    {
        let _ = path;
        Ok(Vec::new())
    }

    #[cfg(target_family = "unix")]
    {
        terminate_processes_with_cwd_unix(path).await
    }
}

#[cfg(target_family = "unix")]
async fn terminate_processes_with_cwd_unix(path: &Path) -> Result<Vec<i32>> {
    let canonical = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => path.to_path_buf(),
    };
    let path_display = canonical.display().to_string();

    let output = match Command::new("lsof")
        .args(["-nP", "-t", "-a", "-d", "cwd", "--", &path_display])
        .output()
        .await
    {
        Ok(output) => output,
        Err(e) => {
            #[cfg(target_os = "linux")]
            {
                debug!("lsof unavailable for {path_display}: {e}, attempting /proc fallback");
                return terminate_processes_with_cwd_linux_procfs(&canonical).await;
            }

            return Err(e).with_context(|| format!("failed to execute lsof for {path_display}"));
        }
    };

    if !output.status.success() {
        // lsof returns exit code 1 when there are no matches
        if output.status.code() == Some(1) && output.stdout.is_empty() {
            return Ok(Vec::new());
        }

        #[cfg(target_os = "linux")]
        {
            if output.status.code() == Some(1) {
                debug!(
                    "lsof returned {} for {}, attempting /proc fallback",
                    output.status, path_display
                );
                return terminate_processes_with_cwd_linux_procfs(&canonical).await;
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!(
            "lsof returned {} for {}: {}",
            output.status,
            path_display,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut seen: HashSet<i32> = HashSet::new();
    for line in stdout.lines() {
        if let Ok(pid) = line.trim().parse::<i32>() {
            if pid as u32 != std::process::id() {
                seen.insert(pid);
            }
        }
    }

    if seen.is_empty() {
        return Ok(Vec::new());
    }

    let seen = filter_known_processes(&seen).await;

    debug!(
        "Terminating {} process(es) holding cwd {}: {:?}",
        seen.len(),
        path_display,
        seen
    );

    let mut terminated = Vec::new();
    for pid in seen {
        if terminate_pid(pid).await {
            terminated.push(pid);
        }
    }

    Ok(terminated)
}

#[cfg(target_family = "unix")]
async fn terminate_pid(pid: i32) -> bool {
    let pid_t = pid as libc::pid_t;

    debug!("Sending SIGTERM to process {pid}");
    let term_result = unsafe { libc::kill(pid_t, libc::SIGTERM) };
    if term_result == -1 {
        let err = std::io::Error::last_os_error();
        match err.raw_os_error() {
            Some(libc::ESRCH) => return false,
            Some(libc::EPERM) => warn!("Insufficient permissions to SIGTERM process {pid}"),
            _ => warn!("Failed to SIGTERM process {pid}: {err}"),
        }
    } else {
        debug!("Sent SIGTERM to process {pid}");
    }

    let mut waited = Duration::from_millis(0);
    let slice = Duration::from_millis(100);
    let timeout = Duration::from_millis(1500);
    while waited < timeout {
        if !process_alive(pid_t) {
            return true;
        }
        sleep(slice).await;
        waited += slice;
    }

    debug!("Escalating to SIGKILL for process {pid}");
    let kill_result = unsafe { libc::kill(pid_t, libc::SIGKILL) };
    if kill_result == -1 {
        let err = std::io::Error::last_os_error();
        match err.raw_os_error() {
            Some(libc::ESRCH) => return true,
            Some(libc::EPERM) => warn!("Failed to SIGKILL process {pid}: permission denied"),
            _ => warn!("Failed to SIGKILL process {pid}: {err}"),
        }
    } else {
        debug!("Escalated to SIGKILL for process {pid}");
    }

    for _ in 0..10 {
        if !process_alive(pid_t) {
            return true;
        }
        sleep(slice).await;
    }

    let still_alive = process_alive(pid_t);
    debug!("Process {pid} alive after termination attempts? {still_alive}");
    if still_alive {
        if kill_result != -1 {
            // Process reported alive but we already sent SIGKILL. Treat it as
            // effectively terminated; lingering zombies will release cwd when
            // their parent reaps them.
            return true;
        }
        warn!("Process {pid} still alive after termination attempts");
        return false;
    }

    true
}

#[cfg(target_family = "unix")]
async fn filter_known_processes(pids: &HashSet<i32>) -> HashSet<i32> {
    if pids.is_empty() {
        return HashSet::new();
    }

    let mut pid_list: Vec<i32> = pids.iter().copied().collect();
    pid_list.sort_unstable();
    let joined = pid_list
        .iter()
        .map(|pid| pid.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let output = Command::new("ps")
        .args(["-o", "pid=,comm=", "-p", &joined])
        .output()
        .await;

    let Ok(output) = output else {
        return pids.clone();
    };

    if !output.status.success() {
        return pids.clone();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matched = HashSet::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((pid_part, name_part)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = pid_part.trim().parse::<i32>() else {
            continue;
        };
        if !pids.contains(&pid) {
            continue;
        }
        let name = name_part.trim().to_lowercase();
        if KNOWN_CLEANUP_BINARIES
            .iter()
            .any(|needle| name.contains(needle))
        {
            matched.insert(pid);
        }
    }

    if matched.is_empty() {
        pids.clone()
    } else {
        matched
    }
}

#[cfg(target_family = "unix")]
const KNOWN_CLEANUP_BINARIES: &[&str] = &["codex", "node", "python", "schaltwerk-mcp", "deno"];

#[cfg(target_os = "linux")]
async fn terminate_processes_with_cwd_linux_procfs(path: &Path) -> Result<Vec<i32>> {
    let canonical = path.to_path_buf();
    let seen = tokio::task::spawn_blocking(move || -> Result<HashSet<i32>> {
        use std::fs;

        let mut matches = HashSet::new();
        for entry in fs::read_dir("/proc")? {
            let entry = entry?;
            let file_name = entry.file_name();
            let pid_str = match file_name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if !pid_str.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let Ok(pid) = pid_str.parse::<i32>() else {
                continue;
            };
            if pid as u32 == std::process::id() {
                continue;
            }
            let cwd_link = entry.path().join("cwd");
            let Ok(target) = fs::read_link(&cwd_link) else {
                continue;
            };
            if target == canonical {
                matches.insert(pid);
            }
        }
        Ok(matches)
    })
    .await
    .map_err(|e| anyhow::anyhow!("/proc scan join error: {e}"))??;

    if seen.is_empty() {
        return Ok(Vec::new());
    }

    let seen = filter_known_processes(&seen).await;
    debug!(
        "Process cleanup via /proc matched {} process(es) for {}",
        seen.len(),
        path.display()
    );

    let mut terminated = Vec::new();
    for pid in seen {
        if terminate_pid(pid).await {
            terminated.push(pid);
        }
    }
    Ok(terminated)
}

#[cfg(target_family = "unix")]
fn process_alive(pid: libc::pid_t) -> bool {
    unsafe {
        if libc::kill(pid, 0) == 0 {
            true
        } else {
            matches!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::EPERM)
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(target_family = "unix")]
    async fn terminate_processes_with_cwd_kills_process() {
        let temp_dir = tempfile::tempdir().unwrap();

        let mut child = tokio::process::Command::new("sleep")
            .arg("30")
            .current_dir(temp_dir.path())
            .spawn()
            .expect("spawn sleep");

        // Ensure the process is running before attempting to terminate it
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let killed = terminate_processes_with_cwd(temp_dir.path())
            .await
            .expect("terminate processes");

        let child_pid = child.id().expect("child id") as i32;
        assert!(
            killed.contains(&child_pid),
            "expected spawned process {child_pid} to be terminated, got {:?}",
            killed
        );

        // Child should exit promptly once termination runs
        let status = child
            .wait()
            .await
            .expect("wait for terminated sleep process");
        assert!(!status.success(), "sleep should not exit successfully");
    }
}

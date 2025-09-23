#![deny(dead_code)]

/// Write plain text to the system clipboard using `pbcopy` (macOS)
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn pbcopy: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed to write to pbcopy stdin: {e}"))?;
    } else {
        return Err("Failed to access pbcopy stdin".to_string());
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for pbcopy: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("pbcopy exited with status: {status}"))
    }
}

/// Clipboard write not supported on this platform
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn clipboard_write_text(_text: String) -> Result<(), String> {
    Err("Clipboard write not supported on this platform".to_string())
}

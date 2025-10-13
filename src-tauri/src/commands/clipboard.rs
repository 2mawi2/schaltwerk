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

/// Read plain text from the system clipboard using `pbpaste` (macOS)
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clipboard_read_text() -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("Failed to spawn pbpaste: {e}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout)
            .map_err(|e| format!("Clipboard content is not valid UTF-8: {e}"))
    } else {
        Err(format!("pbpaste exited with status: {}", output.status))
    }
}

/// Write plain text to the system clipboard using arboard (Linux)
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to initialize clipboard: {e}"))?;

    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {e}"))
}

/// Read plain text from the system clipboard using arboard (Linux)
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn clipboard_read_text() -> Result<String, String> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to initialize clipboard: {e}"))?;

    clipboard
        .get_text()
        .map_err(|e| format!("Failed to read from clipboard: {e}"))
}



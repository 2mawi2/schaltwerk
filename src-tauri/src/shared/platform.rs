#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
pub fn resolve_windows_executable(path: &str) -> String {
    let path_lower = path.to_lowercase();
    if path_lower.ends_with(".exe")
        || path_lower.ends_with(".cmd")
        || path_lower.ends_with(".bat")
        || path_lower.ends_with(".com")
    {
        return path.to_string();
    }

    for ext in &[".cmd", ".exe", ".bat"] {
        let with_ext = format!("{}{}", path, ext);
        if PathBuf::from(&with_ext).exists() {
            log::info!("Resolved Windows executable: {} -> {}", path, with_ext);
            return with_ext;
        }
    }

    log::warn!(
        "No Windows executable found for '{}', using as-is (may fail with error 193)",
        path
    );
    path.to_string()
}

#[cfg(not(windows))]
pub fn resolve_windows_executable(path: &str) -> String {
    path.to_string()
}

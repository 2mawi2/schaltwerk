use std::io;
use std::path::{Path, PathBuf};

/// Canonicalize a path, stripping the Windows extended path prefix (\\?\) if present.
/// On Windows, std::fs::canonicalize returns paths with this prefix, which can cause
/// issues with some APIs (like portable-pty's CreateProcessW and other Windows APIs).
pub fn safe_canonicalize(path: &Path) -> io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    Ok(strip_extended_path_prefix(canonical))
}

/// Strip the Windows extended path prefix (\\?\) from a path.
/// This prefix is added by std::fs::canonicalize on Windows and can cause
/// issues with some APIs.
#[cfg(windows)]
pub fn strip_extended_path_prefix(path: PathBuf) -> PathBuf {
    let path_str = path.to_string_lossy();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

#[cfg(not(windows))]
pub fn strip_extended_path_prefix(path: PathBuf) -> PathBuf {
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn test_strip_extended_path_prefix_windows() {
        let path = PathBuf::from(r"\\?\C:\Users\test\project");
        let result = strip_extended_path_prefix(path);
        assert_eq!(result, PathBuf::from(r"C:\Users\test\project"));
    }

    #[test]
    #[cfg(windows)]
    fn test_strip_extended_path_prefix_no_prefix() {
        let path = PathBuf::from(r"C:\Users\test\project");
        let result = strip_extended_path_prefix(path);
        assert_eq!(result, PathBuf::from(r"C:\Users\test\project"));
    }

    #[test]
    fn test_strip_extended_path_prefix_unix_style() {
        let path = PathBuf::from("/home/user/project");
        let result = strip_extended_path_prefix(path.clone());
        assert_eq!(result, path);
    }
}

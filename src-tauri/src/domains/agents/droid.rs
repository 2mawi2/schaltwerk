use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[cfg(target_family = "unix")]
use std::os::unix::fs::PermissionsExt;

const SHIM_RELATIVE_PATH: &str = ".schaltwerk/droid/shims";
const SHIM_BINARY_NAME: &str = "code";
const SHIM_CONTENT: &str = r#"#!/bin/bash
set -euo pipefail

# Pretend the Factory VS Code extension is already installed so the CLI
# doesn't attempt to spawn the real `code` binary. Returning success keeps
# the droid CLI happy without launching VS Code.
if [[ "${1:-}" == "--list-extensions" ]]; then
  echo "factory.factory-vscode-extension"
  exit 0
fi

if [[ "${1:-}" == "--install-extension" ]]; then
  exit 0
fi

exit 0
"#;

fn shim_directory(worktree_path: &Path) -> PathBuf {
    worktree_path.join(SHIM_RELATIVE_PATH)
}

pub fn ensure_vscode_cli_shim(
    worktree_path: &Path,
    system_path: &str,
) -> io::Result<Option<String>> {
    let shim_dir = shim_directory(worktree_path);
    fs::create_dir_all(&shim_dir)?;

    let shim_path = shim_dir.join(SHIM_BINARY_NAME);
    write_if_different(&shim_path, SHIM_CONTENT)?;

    #[cfg(target_family = "unix")]
    {
        let metadata = fs::metadata(&shim_path)?;
        let mut permissions = metadata.permissions();
        // Make sure the shim is executable by default.
        if permissions.mode() & 0o755 != 0o755 {
            permissions.set_mode(0o755);
            fs::set_permissions(&shim_path, permissions)?;
        }
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = shim_path; // Nothing extra to do on non-Unix platforms.
    }

    let shim_dir_string = shim_dir.to_string_lossy().into_owned();
    let new_path = if system_path.is_empty() {
        shim_dir_string.clone()
    } else {
        let separator = if cfg!(windows) { ';' } else { ':' };
        format!("{shim_dir_string}{separator}{system_path}")
    };

    Ok(Some(new_path))
}

fn write_if_different(path: &Path, contents: &str) -> io::Result<()> {
    if path.exists() {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == contents {
                return Ok(());
            }
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = fs::File::create(path)?;
    file.write_all(contents.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_shim_and_returns_updated_path() {
        let temp = tempdir().unwrap();
        let worktree = temp.path();
        let original_path = "/bin";

        let result = ensure_vscode_cli_shim(worktree, original_path).unwrap();
        let new_path = result.expect("expected path override");

        let expected_prefix = shim_directory(worktree).to_string_lossy().into_owned();
        let separator = if cfg!(windows) { ';' } else { ':' };
        let expected = format!("{}{}{}", expected_prefix, separator, original_path);
        assert_eq!(new_path, expected);

        let shim_binary = shim_directory(worktree).join(SHIM_BINARY_NAME);
        assert!(shim_binary.exists(), "shim binary should exist");
    }
}

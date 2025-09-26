use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static FILE_CACHE: Lazy<Mutex<HashMap<PathBuf, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn cache_key(repo_path: &Path) -> PathBuf {
    repo_path
        .canonicalize()
        .unwrap_or_else(|_| repo_path.to_path_buf())
}

/// Execute `git ls-files` to collect the tracked file list. Internal helper exposed for tests.
pub fn list_project_files(repo_path: &Path) -> Result<Vec<String>> {
    if !repo_path.exists() {
        return Err(anyhow!(
            "Cannot list project files: repository path '{}' does not exist",
            repo_path.display()
        ));
    }

    let output = Command::new("git")
        .args(["ls-files"])
        .current_dir(repo_path)
        .output()
        .with_context(|| {
            format!(
                "Failed to execute git ls-files in '{}'",
                repo_path.display()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "git ls-files failed in '{}': {}",
            repo_path.display(),
            stderr.trim()
        ));
    }

    let stdout =
        String::from_utf8(output.stdout).context("git ls-files output contained invalid UTF-8")?;

    let mut files: Vec<String> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect();

    files.sort();
    Ok(files)
}

/// Return cached tracked file list for the repository, refreshing on demand.
pub fn get_project_files(repo_path: &Path, force_refresh: bool) -> Result<Vec<String>> {
    Ok(get_project_files_with_status(repo_path, force_refresh)?.0)
}

/// Remove any cached entry for the provided repository path.
pub fn invalidate_project_file_cache(repo_path: &Path) {
    let key = cache_key(repo_path);
    FILE_CACHE
        .lock()
        .expect("file cache mutex poisoned")
        .remove(&key);
}

/// Returns the tracked files and a flag indicating whether the cache was refreshed.
pub fn get_project_files_with_status(
    repo_path: &Path,
    force_refresh: bool,
) -> Result<(Vec<String>, bool)> {
    let key = cache_key(repo_path);

    if !force_refresh {
        if let Some(cached) = {
            let guard = FILE_CACHE.lock().expect("file cache mutex poisoned");
            guard.get(&key).cloned()
        } {
            return Ok((cached, false));
        }
    }

    let files = refresh_project_files(repo_path)?;
    Ok((files, true))
}

/// Force a cache refresh by re-querying git for the tracked files.
pub fn refresh_project_files(repo_path: &Path) -> Result<Vec<String>> {
    let key = cache_key(repo_path);
    let files = list_project_files(repo_path)?;
    FILE_CACHE
        .lock()
        .expect("file cache mutex poisoned")
        .insert(key, files.clone());
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::{get_project_files, invalidate_project_file_cache, list_project_files};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(args: &[&str], cwd: &Path) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("failed to run git");
        assert!(status.success(), "git command failed: {:?}", args);
    }

    #[test]
    fn lists_tracked_files_in_sorted_order() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let repo_path = temp_dir.path();
        invalidate_project_file_cache(repo_path);

        git(&["init"], repo_path);
        git(&["config", "user.name", "Test"], repo_path);
        git(&["config", "user.email", "test@example.com"], repo_path);

        fs::create_dir_all(repo_path.join("src/components")).unwrap();
        fs::write(repo_path.join("README.md"), "# Test\n").unwrap();
        fs::write(repo_path.join("src/lib.rs"), "fn main() {}\n").unwrap();
        fs::write(repo_path.join("src/components/index.ts"), "export {}\n").unwrap();

        git(&["add", "."], repo_path);
        git(&["commit", "-m", "init"], repo_path);

        let files = list_project_files(repo_path).expect("list_project_files should succeed");
        assert_eq!(
            files,
            vec![
                "README.md".to_string(),
                "src/components/index.ts".to_string(),
                "src/lib.rs".to_string()
            ]
        );
    }

    #[test]
    fn skips_gitignored_files() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let repo_path = temp_dir.path();
        invalidate_project_file_cache(repo_path);

        git(&["init"], repo_path);
        git(&["config", "user.name", "Test"], repo_path);
        git(&["config", "user.email", "test@example.com"], repo_path);

        fs::write(repo_path.join(".gitignore"), "*.log\n").unwrap();
        fs::write(repo_path.join("keep.txt"), "keep").unwrap();
        fs::write(repo_path.join("notes.log"), "ignore").unwrap();

        git(&["add", "keep.txt", ".gitignore"], repo_path);
        git(&["commit", "-m", "init"], repo_path);

        let files = list_project_files(repo_path).expect("list_project_files should succeed");
        assert_eq!(
            files,
            vec![".gitignore".to_string(), "keep.txt".to_string()]
        );
    }

    #[test]
    fn cache_returns_previous_results_until_refreshed() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let repo_path = temp_dir.path();
        invalidate_project_file_cache(repo_path);

        git(&["init"], repo_path);
        git(&["config", "user.name", "Test"], repo_path);
        git(&["config", "user.email", "test@example.com"], repo_path);

        fs::write(repo_path.join("one.txt"), "one").unwrap();
        git(&["add", "one.txt"], repo_path);
        git(&["commit", "-m", "init"], repo_path);

        let initial = get_project_files(repo_path, false).expect("initial file list");
        assert_eq!(initial, vec!["one.txt".to_string()]);

        fs::write(repo_path.join("two.txt"), "two").unwrap();
        git(&["add", "two.txt"], repo_path);
        git(&["commit", "-m", "add two"], repo_path);

        let cached = get_project_files(repo_path, false).expect("cached list");
        assert_eq!(cached, vec!["one.txt".to_string()]);

        let refreshed = get_project_files(repo_path, true).expect("refreshed list");
        assert_eq!(
            refreshed,
            vec!["one.txt".to_string(), "two.txt".to_string()]
        );
    }
}

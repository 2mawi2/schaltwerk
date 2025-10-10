use std::ffi::OsStr;
use std::path::Path;

use walkdir::WalkDir;

pub fn compute_worktree_size_bytes(worktree_path: &Path) -> Option<u64> {
    if !worktree_path.exists() {
        return None;
    }

    fn should_descend(entry: &walkdir::DirEntry) -> bool {
        !(entry.file_type().is_dir() && entry.file_name() == OsStr::new(".git"))
    }

    let mut total = 0u64;

    for entry in WalkDir::new(worktree_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_descend)
    {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                log::warn!(
                    "Skipping entry while calculating worktree size for {}: {err}",
                    worktree_path.display()
                );
                continue;
            }
        };

        if entry.file_type().is_dir() {
            continue;
        }

        match entry.metadata() {
            Ok(metadata) => {
                total = total.saturating_add(metadata.len());
            }
            Err(err) => {
                log::warn!(
                    "Failed to read metadata for {}: {err}",
                    entry.path().display()
                );
            }
        }
    }

    Some(total)
}

#[cfg(test)]
mod tests {
    use super::compute_worktree_size_bytes;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn returns_none_for_missing_path() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("not-a-worktree");
        assert!(compute_worktree_size_bytes(&missing).is_none());
    }

    #[test]
    fn sums_files_and_ignores_git_directory() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src").join("main.rs"), vec![0u8; 2048]).unwrap();
        fs::write(root.join("README.md"), vec![0u8; 1024]).unwrap();

        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(git_dir.join("config"), vec![0u8; 4096]).unwrap();

        let size = compute_worktree_size_bytes(root).unwrap();
        assert_eq!(size, 2048 + 1024);
    }
}

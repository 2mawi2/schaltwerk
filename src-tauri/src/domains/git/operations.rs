use anyhow::{anyhow, Result};
use git2::{IndexAddOption, Repository, StatusOptions};
use std::path::Path;

#[inline]
fn is_internal_tooling_path(path: &str) -> bool {
    path == ".schaltwerk" || path.starts_with(".schaltwerk/")
}

pub fn has_uncommitted_changes(worktree_path: &Path) -> Result<bool> {
    let repo = Repository::open(worktree_path)?;

    // Include untracked files; recurse into untracked dirs
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    // Filter out schaltwerk internal artifacts within the worktree
    const MAX_SAMPLE: usize = 3;
    let mut offending: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            if is_internal_tooling_path(path) {
                continue;
            }
            offending.push(path.to_string());
        } else {
            offending.push("<unknown>".to_string());
        }
        if offending.len() >= MAX_SAMPLE {
            break;
        }
    }
    let any = !offending.is_empty();
    log::debug!(
        "has_uncommitted_changes: path={} total_status_entries={} offending_sample={:?}",
        worktree_path.display(),
        statuses.len(),
        offending
    );
    Ok(any)
}

pub fn uncommitted_sample_paths(worktree_path: &Path, limit: usize) -> Result<Vec<String>> {
    let repo = Repository::open(worktree_path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut out = Vec::new();
    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            if is_internal_tooling_path(path) {
                continue;
            }
            out.push(path.to_string());
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

pub fn commit_all_changes(worktree_path: &Path, message: &str) -> Result<()> {
    let repo = Repository::open(worktree_path)?;

    // Get the index
    let mut index = repo.index()?;

    // Add all changes to the index
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;

    // Also handle removed files
    index.update_all(["*"].iter(), None)?;

    // Write the index
    index.write()?;
    let tree_id = index.write_tree()?;

    // Check if there are actually changes to commit
    let tree = repo.find_tree(tree_id)?;
    let parent_commit = match repo.head() {
        Ok(head) => {
            let oid = head.target().ok_or_else(|| anyhow!("HEAD has no target"))?;
            Some(repo.find_commit(oid)?)
        }
        Err(_) => None, // No HEAD yet (first commit)
    };

    // If we have a parent, check if the tree is the same (nothing to commit)
    if let Some(ref parent) = parent_commit {
        if parent.tree_id() == tree_id {
            // Nothing to commit
            return Ok(());
        }
    }

    // Get the signature from git config
    let signature = repo.signature()
        .map_err(|e| anyhow!("Failed to get signature from git config: {}. Please configure git user.name and user.email", e))?;

    // Create the commit
    let parent_commits = if let Some(ref parent) = parent_commit {
        vec![parent]
    } else {
        vec![]
    };

    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parent_commits,
    )?;

    Ok(())
}

pub fn is_valid_session_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 100 {
        return false;
    }

    name.chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_is_valid_session_name() {
        // Valid names
        assert!(is_valid_session_name("valid-name"));
        assert!(is_valid_session_name("valid_name"));
        assert!(is_valid_session_name("valid123"));
        assert!(is_valid_session_name("a"));
        assert!(is_valid_session_name("test-session_123"));

        // Invalid names
        assert!(!is_valid_session_name("")); // empty
        assert!(!is_valid_session_name("name with spaces"));
        assert!(!is_valid_session_name("name/with/slashes"));
        assert!(!is_valid_session_name("name.with.dots"));
        assert!(!is_valid_session_name("name@with#special"));

        // Length check (101 chars should be invalid)
        let long_name = "a".repeat(101);
        assert!(!is_valid_session_name(&long_name));

        // Length check (100 chars should be valid)
        let max_name = "a".repeat(100);
        assert!(is_valid_session_name(&max_name));
    }

    #[test]
    fn test_has_uncommitted_changes_clean_repo() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Create initial commit
        let sig =
            Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");

        // Test - should have no changes
        let result = has_uncommitted_changes(temp_dir.path()).expect("Should check status");
        assert!(!result, "Clean repo should have no uncommitted changes");
    }

    #[test]
    fn test_has_uncommitted_changes_with_untracked() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Create initial commit
        let sig =
            Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");

        // Create an untracked file
        fs::write(temp_dir.path().join("untracked.txt"), "content").expect("Failed to write file");

        // Test - should have changes
        let result = has_uncommitted_changes(temp_dir.path()).expect("Should check status");
        assert!(
            result,
            "Should detect untracked files as uncommitted changes"
        );
    }

    #[test]
    fn test_has_uncommitted_changes_ignores_schaltwerk_internal() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        // Create internal file only
        std::fs::create_dir_all(temp_dir.path().join(".schaltwerk")).unwrap();
        let mut f = std::fs::File::create(temp_dir.path().join(".schaltwerk/temp.txt")).unwrap();
        writeln!(f, "internal").unwrap();

        // Should be considered clean (internal-only changes ignored)
        let result = has_uncommitted_changes(temp_dir.path()).unwrap();
        assert!(!result, "Internal .schaltwerk changes must be ignored");
    }

    #[test]
    fn test_has_uncommitted_changes_with_staged() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Create initial commit
        let sig =
            Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        fs::write(temp_dir.path().join("file.txt"), "initial").expect("Failed to write file");

        let mut index = repo.index().expect("Failed to get index");
        index
            .add_path(std::path::Path::new("file.txt"))
            .expect("Failed to add file");
        index.write().expect("Failed to write index");

        let tree_id = index.write_tree().expect("Failed to write tree");
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");

        // Modify file and stage it
        fs::write(temp_dir.path().join("file.txt"), "modified").expect("Failed to write file");
        let mut index = repo.index().expect("Failed to get index");
        index
            .add_path(std::path::Path::new("file.txt"))
            .expect("Failed to add file");
        index.write().expect("Failed to write index");

        // Test - should have changes
        let result = has_uncommitted_changes(temp_dir.path()).expect("Should check status");
        assert!(
            result,
            "Should detect staged changes as uncommitted changes"
        );
    }

    #[test]
    fn test_commit_all_changes() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Configure git user for the test repo
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_str("user.name", "Test User")
            .expect("Failed to set user.name");
        config
            .set_str("user.email", "test@example.com")
            .expect("Failed to set user.email");

        // Create initial commit
        let sig =
            Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");

        // Create new files
        fs::write(temp_dir.path().join("file1.txt"), "content1").expect("Failed to write file");
        fs::write(temp_dir.path().join("file2.txt"), "content2").expect("Failed to write file");

        // Commit all changes
        commit_all_changes(temp_dir.path(), "Test commit message")
            .expect("Should commit all changes");

        // Verify no uncommitted changes remain
        let has_changes = has_uncommitted_changes(temp_dir.path()).expect("Should check status");
        assert!(
            !has_changes,
            "Should have no uncommitted changes after commit"
        );

        // Verify the commit message
        let repo = Repository::open(temp_dir.path()).expect("Failed to open repo");
        let head = repo.head().expect("Failed to get HEAD");
        let oid = head.target().expect("HEAD should have target");
        let commit = repo.find_commit(oid).expect("Failed to find commit");
        assert_eq!(commit.message().unwrap(), "Test commit message");
    }

    #[test]
    fn test_commit_all_changes_no_changes() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Configure git user for the test repo
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_str("user.name", "Test User")
            .expect("Failed to set user.name");
        config
            .set_str("user.email", "test@example.com")
            .expect("Failed to set user.email");

        // Create initial commit
        let sig =
            Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        let initial_commit = repo
            .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");

        // Try to commit when there are no changes
        commit_all_changes(temp_dir.path(), "Should not create this commit")
            .expect("Should handle no-changes case gracefully");

        // Verify HEAD hasn't moved
        let repo = Repository::open(temp_dir.path()).expect("Failed to open repo");
        let head = repo.head().expect("Failed to get HEAD");
        let oid = head.target().expect("HEAD should have target");
        assert_eq!(
            oid, initial_commit,
            "HEAD should not have moved when there were no changes"
        );
    }

    #[test]
    fn test_commit_all_changes_first_commit() {
        // Create a temporary git repository with no commits
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");

        // Configure git user for the test repo
        let mut config = repo.config().expect("Failed to get config");
        config
            .set_str("user.name", "Test User")
            .expect("Failed to set user.name");
        config
            .set_str("user.email", "test@example.com")
            .expect("Failed to set user.email");

        // Create a file
        fs::write(temp_dir.path().join("README.md"), "# Test Project")
            .expect("Failed to write file");

        // Commit - should handle first commit case
        commit_all_changes(temp_dir.path(), "First commit").expect("Should create first commit");

        // Verify commit was created
        let repo = Repository::open(temp_dir.path()).expect("Failed to open repo");
        let head = repo.head().expect("Failed to get HEAD");
        let oid = head.target().expect("HEAD should have target");
        let commit = repo.find_commit(oid).expect("Failed to find commit");
        assert_eq!(commit.message().unwrap(), "First commit");
        assert_eq!(
            commit.parent_count(),
            0,
            "First commit should have no parents"
        );
    }
}

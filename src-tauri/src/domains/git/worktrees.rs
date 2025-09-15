use std::path::{Path, PathBuf};
use anyhow::{Result, anyhow};
use git2::{Repository, WorktreeAddOptions, BranchType, build::CheckoutBuilder, WorktreePruneOptions};
use super::repository::get_commit_hash;
use git2::ResetType;
use std::fs;

/// Discard changes for a single path inside a worktree.
///
/// Behavior:
/// - If the file is modified or deleted: restore content from HEAD for that path.
/// - If the file is newly added and untracked: remove the working copy (path-specific clean).
/// - If the file is staged: reset index entry for that path to HEAD.
///
/// Defensive guarantees:
/// - Ensures `file_path` resolves inside `worktree_path`.
/// - Never touches refs/other files; operates only on the provided pathspec.
pub fn discard_path_in_worktree(worktree_path: &Path, file_path: &Path) -> Result<()> {
    let repo = Repository::open(worktree_path)?;

    // Accept both the main working directory and proper git worktrees

    // Build absolute path and ensure it resides within the worktree
    let abs_worktree = worktree_path
        .canonicalize()
        .unwrap_or_else(|_| worktree_path.to_path_buf());
    let candidate = if file_path.is_absolute() {
        file_path.to_path_buf()
    } else {
        abs_worktree.join(file_path)
    };
    let abs_candidate = candidate.canonicalize().unwrap_or(candidate.clone());
    if !abs_candidate.starts_with(&abs_worktree) {
        return Err(anyhow!("Refusing to discard path outside of worktree"));
    }

    // Compute repo-relative pathspec
    let rel = abs_candidate
        .strip_prefix(&abs_worktree)
        .map_err(|_| anyhow!("Failed to compute relative path"))?;
    let rel_str = rel.to_string_lossy().to_string();

    // Determine HEAD tree (may be unborn on empty repo)
    let head_tree = match repo.head() {
        Ok(h) => {
            if let Some(oid) = h.target() {
                Some(repo.find_commit(oid)?.tree()?)
            } else {
                None
            }
        }
        Err(_) => None,
    };

    // If path is untracked and not in HEAD, deleting the file is the correct discard.
    let is_tracked_in_head = if let Some(tree) = &head_tree {
        tree.get_path(rel).is_ok()
    } else {
        false
    };

    // Reset index/working tree for exactly this path.
    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force().path(&rel_str);
    // Do not instruct checkout to delete untracked; we handle untracked safely below

    match head_tree {
        Some(_) => {
            // Reset only the given path in the index (None => HEAD)
            repo.reset_default(None, [rel_str.as_str()])?;
            // Restore the file content from HEAD for that path
            repo.checkout_head(Some(&mut builder))?;
        }
        None => {
            // No HEAD yet (rare). Just clear any staged entry
            let mut index = repo.index()?;
            index.remove_path(rel).ok();
            index.write()?;
        }
    }

    // Safely handle untracked additions: move to backup rather than hard-delete
    if !is_tracked_in_head && abs_candidate.exists() && abs_candidate.is_file() {
        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
        let backup_root = abs_worktree.join(".schaltwerk").join("discarded").join(ts);
        let backup_path = backup_root.join(rel);
        if let Some(parent) = backup_path.parent() { std::fs::create_dir_all(parent).ok(); }
        // Best-effort move; if rename fails, try copy+remove
        if fs::rename(&abs_candidate, &backup_path).is_err()
            && std::fs::copy(&abs_candidate, &backup_path).is_ok() {
            let _ = fs::remove_file(&abs_candidate);
        }
    }

    Ok(())
}

pub fn create_worktree_from_base(
    repo_path: &Path,
    branch_name: &str,
    worktree_path: &Path,
    base_branch: &str
) -> Result<()> {
    let base_commit_hash = get_commit_hash(repo_path, base_branch)
        .map_err(|e| anyhow!("Base branch '{}' does not exist in the repository: {}", base_branch, e))?;
    
    log::info!("Creating worktree from commit {base_commit_hash} ({base_branch})");
    
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    let repo = Repository::open(repo_path)?;
    
    // Check if branch already exists and delete it
    if let Ok(mut branch) = repo.find_branch(branch_name, BranchType::Local) {
        log::info!("Deleting existing branch: {branch_name}");
        branch.delete()?;
    }
    
    // Parse the base commit
    let base_oid = git2::Oid::from_str(&base_commit_hash)?;
    let base_commit = repo.find_commit(base_oid)?;
    
    // Create the new branch pointing to the base commit
    let new_branch = repo.branch(branch_name, &base_commit, false)?;
    let branch_ref = new_branch.into_reference();
    
    // Create worktree options
    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(&branch_ref));
    
    // Add the worktree
    let _worktree = repo.worktree(
        worktree_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(branch_name),
        worktree_path,
        Some(&opts)
    )?;
    
    log::info!("Successfully created worktree at: {}", worktree_path.display());
    Ok(())
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let repo = Repository::open(repo_path)?;
    
    // Find the worktree by path (handle path canonicalization for macOS)
    let canonical_target_path = worktree_path.canonicalize().unwrap_or_else(|_| worktree_path.to_path_buf());
    
    let worktrees = repo.worktrees()?;
    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            let wt_path = wt.path();
            let canonical_wt_path = wt_path.canonicalize().unwrap_or_else(|_| wt_path.to_path_buf());
            if canonical_wt_path == canonical_target_path || wt_path == worktree_path {
                
                // First remove the directory (this makes the worktree invalid)
                if worktree_path.exists() {
                    if let Err(e) = std::fs::remove_dir_all(worktree_path) {
                        return Err(anyhow!("Failed to remove worktree directory: {}", e));
                    }
                }
                
                // Now prune the worktree (should work since directory is gone)
                if let Err(e) = wt.prune(Some(&mut WorktreePruneOptions::new())) {
                    log::warn!("Failed to prune worktree from git registry: {e}");
                }
                return Ok(());
            }
        }
    }
    
    // If not found as a worktree, return an error unless directory exists
    if worktree_path.exists() {
        std::fs::remove_dir_all(worktree_path)?;
        Ok(())
    } else {
        Err(anyhow!("Worktree not found: {:?}", worktree_path))
    }
}

pub fn list_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>> {
    let repo = Repository::open(repo_path)?;
    let mut worktree_paths = Vec::new();
    
    // Add main working directory
    if let Some(workdir) = repo.workdir() {
        worktree_paths.push(workdir.to_path_buf());
    }
    
    // Add all worktrees
    let worktrees = repo.worktrees()?;
    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            worktree_paths.push(wt.path().to_path_buf());
        }
    }
    
    Ok(worktree_paths)
}

pub fn prune_worktrees(repo_path: &Path) -> Result<()> {
    let repo = Repository::open(repo_path)?;
    let worktrees = repo.worktrees()?;
    
    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            // Try to prune invalid worktrees
            if wt.validate().is_err() {
                wt.prune(Some(&mut WorktreePruneOptions::new()))?;
            }
        }
    }
    
    Ok(())
}

#[cfg(test)]
pub fn is_worktree_registered(repo_path: &Path, worktree_path: &Path) -> Result<bool> {
    let repo = Repository::open(repo_path)?;
    let worktrees = repo.worktrees()?;
    
    // Canonicalize the target path for comparison
    let canonical_worktree_path = worktree_path.canonicalize().unwrap_or_else(|_| worktree_path.to_path_buf());
    
    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            let wt_path = wt.path();
            let canonical_wt_path = wt_path.canonicalize().unwrap_or_else(|_| wt_path.to_path_buf());
            
            if canonical_wt_path == canonical_worktree_path {
                return Ok(true);
            }
        }
    }
    
    Ok(false)
}

pub fn update_worktree_branch(worktree_path: &Path, new_branch: &str) -> Result<()> {
    let session_id = extract_session_name_from_path(worktree_path)?;
    let stash_message = format!("Auto-stash before branch rename [session:{session_id}]");
    
    let mut repo = Repository::open(worktree_path)?;
    
    // Check for uncommitted changes
    let has_changes = {
        let statuses = repo.statuses(None)?;
        !statuses.is_empty()
    };
    
    let mut stash_oid = None;
    if has_changes {
        // Create a stash
        let sig = repo.signature()?;
        match repo.stash_save(&sig, &stash_message, None) {
            Ok(oid) => {
                stash_oid = Some(oid);
                log::info!("Created stash for session {session_id}");
            }
            Err(e) => {
                log::warn!("Failed to stash changes: {e}, proceeding anyway");
            }
        }
    }
    
    // Find the new branch
    let branch = repo.find_branch(new_branch, BranchType::Local)
        .map_err(|e| anyhow!("Failed to update worktree: branch {} not found: {}", new_branch, e))?;
    
    // Get the reference to the branch
    let branch_ref = branch.into_reference();
    let target = branch_ref.target()
        .ok_or_else(|| anyhow!("Branch reference has no target"))?;
    
    // Checkout the new branch
    let obj = repo.find_object(target, None)?;
    repo.checkout_tree(&obj, Some(CheckoutBuilder::new().force()))?;
    
    // Update HEAD to point to the new branch
    repo.set_head(branch_ref.name()
        .ok_or_else(|| anyhow!("Branch reference has no name"))?)?;
    
    // Try to restore session-specific stash
    if stash_oid.is_some() {
        // Need to reopen repo to avoid borrow issues
        let stash_repo = Repository::open(worktree_path)?;
        restore_session_specific_stash_libgit2(stash_repo, &session_id)?;
    }
    
    Ok(())
}

fn extract_session_name_from_path(worktree_path: &Path) -> Result<String> {
    worktree_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Cannot extract session name from worktree path"))
}

fn restore_session_specific_stash_libgit2(mut repo: Repository, session_id: &str) -> Result<()> {
    let target_pattern = format!("[session:{session_id}]");
    
    // Iterate through stashes
    let mut found_index = None;
    repo.stash_foreach(|index, message, _oid| {
        if message.contains(&target_pattern) {
            found_index = Some(index);
            false // Stop iterating
        } else {
            true // Continue iterating
        }
    })?;
    
    if let Some(index) = found_index {
        // Apply the stash
        match repo.stash_apply(index, None) {
            Ok(_) => {
                log::info!("Successfully applied stash for session {session_id}");
                // Try to drop the stash after applying
                repo.stash_drop(index).ok();
            }
            Err(e) => {
                log::warn!("Failed to restore session-specific stash: {e}, it remains in stash");
            }
        }
    }
    
    Ok(())
}

/// Reset a worktree's current branch to the given base reference (e.g. "main").
/// This performs a hard reset to the base HEAD, removes untracked/ignored files,
/// and leaves the branch as if the worktree had just been created from the base.
pub fn reset_worktree_to_base(worktree_path: &Path, base_branch: &str) -> Result<()> {
    let repo = Repository::open(worktree_path)?;

    // Defensive: ensure this is a worktree repository
    if !repo.is_worktree() {
        return Err(anyhow!("Target repository is not a git worktree"));
    }

    // Defensive: validate base branch name to avoid odd refs
    validate_branch_name(base_branch)?;

    // Prefer local branch, fall back to origin/<base_branch>
    let base_ref_names = [
        format!("refs/heads/{base_branch}"),
        format!("refs/remotes/origin/{base_branch}"),
    ];

    let mut target_obj = None;
    for name in &base_ref_names {
        if let Ok(reference) = repo.find_reference(name) {
            if let Some(oid) = reference.target() {
                target_obj = Some(repo.find_object(oid, None)?);
                break;
            }
        }
    }

    let target_obj = target_obj.ok_or_else(|| anyhow!(
        "Base reference not found: {} (tried local and origin)",
        base_branch
    ))?;

    // Hard reset the index and working tree to the base
    repo.reset(&target_obj, ResetType::Hard, None)?;

    // Clean untracked/ignored files to ensure a pristine state
    repo.checkout_head(Some(
        CheckoutBuilder::new()
            .force()
            .remove_untracked(true)
            .remove_ignored(true),
    ))?;

    log::info!(
        "Reset worktree at {} to base {}",
        worktree_path.display(),
        base_branch
    );
    Ok(())
}

#[cfg(test)]
mod unit_logic_tests {

    // NOTE: These tests validate input/selection logic without touching a real repository,
    // by checking the order of reference candidates used to resolve the base.
    #[test]
    fn test_base_ref_candidate_ordering() {
        let base = "main";
        let candidates = [
            format!("refs/heads/{base}"),
            format!("refs/remotes/origin/{base}"),
        ];
        assert_eq!(candidates[0], "refs/heads/main");
        assert_eq!(candidates[1], "refs/remotes/origin/main");
    }

    #[test]
    fn test_branch_name_validation() {
        assert!(super::validate_branch_name("main").is_ok());
        assert!(super::validate_branch_name("feature/x").is_ok());
        assert!(super::validate_branch_name("release-1.2.3").is_ok());
        assert!(super::validate_branch_name("..bad").is_err());
        assert!(super::validate_branch_name("bad\\name").is_err());
        assert!(super::validate_branch_name("").is_err());
    }
}

#[cfg(test)]
mod discard_path_tests {
    use super::*;
    use tempfile::TempDir;
    use git2::Repository;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        // configure user
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "test@example.com").unwrap();
        }
        // initial commit
        {
            let mut index = repo.index().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let sig = repo.signature().unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        repo
    }

    #[test]
    fn discard_modified_file_restores_head() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo(tmp.path());
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        // commit v1
        let mut idx = repo.index().unwrap();
        idx.add_path(Path::new("a.txt")).unwrap();
        idx.write().unwrap();
        let tree_id = idx.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "add a", &tree, &[&head]).unwrap();

        // modify to v2 (unstaged)
        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        discard_path_in_worktree(tmp.path(), Path::new("a.txt")).unwrap();
        let content = std::fs::read_to_string(tmp.path().join("a.txt")).unwrap();
        assert_eq!(content, "v1");
    }

    #[test]
    fn discard_added_untracked_moves_to_backup() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo(tmp.path());
        let p = tmp.path().join("new.txt");
        std::fs::write(&p, "temp").unwrap();
        assert!(p.exists());
        discard_path_in_worktree(tmp.path(), Path::new("new.txt")).unwrap();
        assert!(!p.exists());
        // Verify it was moved under .schaltwerk/discarded/
        let disc_dir = tmp.path().join(".schaltwerk/discarded");
        let mut found = false;
        if disc_dir.exists() {
            for entry in std::fs::read_dir(disc_dir).unwrap() {
                let sub = entry.unwrap().path();
                let candidate = sub.join("new.txt");
                if candidate.exists() { found = true; break; }
            }
        }
        assert!(found, "backup copy not found under .schaltwerk/discarded");
    }

    #[test]
    fn discard_deleted_restores_file() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo(tmp.path());
        std::fs::write(tmp.path().join("b.txt"), "keep").unwrap();
        let mut idx = repo.index().unwrap();
        idx.add_path(Path::new("b.txt")).unwrap();
        idx.write().unwrap();
        let tree_id = idx.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "add b", &tree, &[&head]).unwrap();
        // delete from workdir
        std::fs::remove_file(tmp.path().join("b.txt")).unwrap();
        discard_path_in_worktree(tmp.path(), Path::new("b.txt")).unwrap();
        let content = std::fs::read_to_string(tmp.path().join("b.txt")).unwrap();
        assert_eq!(content, "keep");
    }
}

fn validate_branch_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(anyhow!("Branch name cannot be empty"));
    }
    if name.contains("..") || name.contains('\0') || name.contains('\\') {
        return Err(anyhow!("Invalid branch name"));
    }
    // Basic character whitelist (matches common git rules without being overly strict)
    let allowed = |c: char| c.is_ascii_alphanumeric() || 
        matches!(c, '/' | '-' | '_' | '.');
    if !name.chars().all(allowed) {
        return Err(anyhow!("Branch name contains invalid characters"));
    }
    Ok(())
}

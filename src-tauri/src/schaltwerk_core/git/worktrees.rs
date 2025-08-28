use std::path::{Path, PathBuf};
use anyhow::{Result, anyhow};
use git2::{Repository, WorktreeAddOptions, BranchType, build::CheckoutBuilder, WorktreePruneOptions};
use crate::schaltwerk_core::git::repository::get_commit_hash;

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
    
    // Find the worktree by path
    let worktrees = repo.worktrees()?;
    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.path() == worktree_path {
                // Prune the worktree (force removal)
                if let Err(e) = wt.prune(Some(&mut WorktreePruneOptions::new())) {
                    log::warn!("Failed to prune worktree: {e}");
                    // Try to remove the directory manually if prune fails
                    if worktree_path.exists() {
                        std::fs::remove_dir_all(worktree_path).ok();
                    }
                }
                return Ok(());
            }
        }
    }
    
    // If not found as a worktree, just try to remove the directory
    if worktree_path.exists() {
        std::fs::remove_dir_all(worktree_path).ok();
    }
    
    Ok(())
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
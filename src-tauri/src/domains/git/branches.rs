use super::repository::{get_unborn_head_branch, repository_has_commits};
use anyhow::{anyhow, Result};
use git2::{BranchType, Repository};
use std::path::Path;

pub fn list_branches(repo_path: &Path) -> Result<Vec<String>> {
    log::info!("Listing branches for repo: {}", repo_path.display());

    let has_commits = repository_has_commits(repo_path).unwrap_or(false);

    if !has_commits {
        log::info!("Repository has no commits, checking for unborn HEAD");
        if let Ok(unborn_branch) = get_unborn_head_branch(repo_path) {
            log::info!("Returning unborn HEAD branch: {unborn_branch}");
            return Ok(vec![unborn_branch]);
        }
        log::warn!("Repository has no commits and no unborn HEAD detected");
        return Ok(Vec::new());
    }

    let repo = Repository::open(repo_path)?;
    let mut branch_names = Vec::new();

    // Get local branches
    let local_branches = repo.branches(Some(BranchType::Local))?;
    for (branch, _) in local_branches.flatten() {
        if let Some(name) = branch.name()? {
            branch_names.push(name.to_string());
        }
    }

    // Get remote branches and convert them to local branch names
    let remote_branches = repo.branches(Some(BranchType::Remote))?;
    for (branch, _) in remote_branches.flatten() {
        if let Some(name) = branch.name()? {
            // Strip origin/ prefix to get the branch name
            if let Some(branch_name) = name.strip_prefix("origin/") {
                if branch_name != "HEAD" {
                    branch_names.push(branch_name.to_string());
                }
            }
        }
    }

    branch_names.sort();
    branch_names.dedup();

    log::debug!("Found {} branches", branch_names.len());
    Ok(branch_names)
}

pub fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<()> {
    let repo = Repository::open(repo_path)?;

    // Find the branch
    let mut branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|e| anyhow!("Failed to delete branch {branch_name}: {e}"))?;

    // Delete the branch (force delete)
    branch
        .delete()
        .map_err(|e| anyhow!("Failed to delete branch {branch_name}: {e}"))?;

    Ok(())
}

pub fn branch_exists(repo_path: &Path, branch_name: &str) -> Result<bool> {
    let repo = Repository::open(repo_path)?;

    // Try to find the branch
    let result = match repo.find_branch(branch_name, BranchType::Local) {
        Ok(_) => Ok(true),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(false),
        // Treat corrupted branches as non-existent
        Err(e)
            if e.code() == git2::ErrorCode::InvalidSpec
                || e.code() == git2::ErrorCode::GenericError =>
        {
            Ok(false)
        }
        Err(e) => Err(anyhow!("Error checking branch existence: {e}")),
    };
    result
}

pub fn rename_branch(repo_path: &Path, old_branch: &str, new_branch: &str) -> Result<()> {
    if !branch_exists(repo_path, old_branch)? {
        return Err(anyhow!("Branch '{old_branch}' does not exist"));
    }

    if branch_exists(repo_path, new_branch)? {
        return Err(anyhow!("Branch '{new_branch}' already exists"));
    }

    let repo = Repository::open(repo_path)?;

    // Find the branch to rename
    let mut branch = repo
        .find_branch(old_branch, BranchType::Local)
        .map_err(|e| anyhow!("Failed to find branch {old_branch}: {e}"))?;

    // Rename the branch (force=false to prevent overwriting)
    branch
        .rename(new_branch, false)
        .map_err(|e| anyhow!("Failed to rename branch: {e}"))?;

    Ok(())
}

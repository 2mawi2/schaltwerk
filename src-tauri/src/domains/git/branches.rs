use super::repository::{get_current_branch, get_unborn_head_branch, repository_has_commits};
use anyhow::{Context, Result, anyhow};
use git2::build::CheckoutBuilder;
use git2::{BranchType, Repository};
use std::collections::HashSet;
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
        if let Some(name) = branch.name()?
            // Strip origin/ prefix to get the branch name
            && let Some(branch_name) = name.strip_prefix("origin/")
            && branch_name != "HEAD"
        {
            branch_names.push(branch_name.to_string());
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
    match repo.find_branch(branch_name, BranchType::Local) {
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
    }
}

pub fn ensure_branch_at_head(repo_path: &Path, branch_name: &str) -> Result<()> {
    let repo = Repository::open(repo_path)?;

    let current_branch = get_current_branch(repo_path).unwrap_or_else(|_| "HEAD".to_string());

    if repo.find_branch(branch_name, BranchType::Local).is_ok() {
        log::info!("Branch '{branch_name}' already exists, checking out");
        checkout_branch(&repo, branch_name)?;
        return Ok(());
    }

    if current_branch != "HEAD"
        && let Ok(mut existing) = repo.find_branch(&current_branch, BranchType::Local)
    {
        log::info!("Renaming current branch '{current_branch}' to requested base '{branch_name}'");
        existing.rename(branch_name, false).map_err(|e| {
            anyhow!("Failed to rename branch '{current_branch}' to '{branch_name}': {e}")
        })?;
        checkout_branch(&repo, branch_name)?;
        return Ok(());
    }

    let head_obj = repo
        .revparse_single("HEAD")
        .map_err(|e| anyhow!("Cannot resolve HEAD commit to create branch '{branch_name}': {e}"))?;
    let head_commit = head_obj
        .peel_to_commit()
        .map_err(|e| anyhow!("HEAD is not pointing to a commit: {e}"))?;

    repo.branch(branch_name, &head_commit, false)
        .map_err(|e| anyhow!("Failed to create branch '{branch_name}': {e}"))?;
    checkout_branch(&repo, branch_name)?;

    log::info!("Bootstrapped branch '{branch_name}' from initial HEAD commit");
    Ok(())
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

fn checkout_branch(repo: &Repository, branch_name: &str) -> Result<()> {
    repo.set_head(&format!("refs/heads/{branch_name}"))
        .map_err(|e| anyhow!("Failed to update HEAD to '{branch_name}': {e}"))?;

    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))
        .map_err(|e| anyhow!("Failed to checkout branch '{branch_name}': {e}"))?;

    Ok(())
}

pub fn normalize_branch_to_local(repo: &Repository, raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Branch name cannot be empty"));
    }

    let remote_names: HashSet<String> = repo
        .remotes()
        .map(|remotes| {
            remotes
                .iter()
                .filter_map(|name| name.map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let spec = BranchSpec::from_input(trimmed, &remote_names);
    let local = spec.local.trim();
    if local.is_empty() {
        return Err(anyhow!(
            "Branch '{raw}' does not identify a valid local name"
        ));
    }

    if repo.find_branch(local, BranchType::Local).is_ok() {
        return Ok(local.to_string());
    }

    if spec
        .remote
        .is_some_and(|remote| materialize_from_remote(repo, local, remote).is_ok())
    {
        return Ok(local.to_string());
    }

    for remote in &remote_names {
        if materialize_from_remote(repo, local, remote).is_ok() {
            return Ok(local.to_string());
        }
    }

    Err(anyhow!(
        "Local branch '{local}' missing and no remote reference found while normalizing '{raw}'"
    ))
}

struct BranchSpec<'a> {
    local: &'a str,
    remote: Option<&'a str>,
}

impl<'a> BranchSpec<'a> {
    fn from_input(input: &'a str, remotes: &HashSet<String>) -> Self {
        if let Some(stripped) = input.strip_prefix("refs/heads/") {
            return BranchSpec {
                local: stripped,
                remote: None,
            };
        }

        if let Some(rest) = input.strip_prefix("refs/remotes/") {
            if let Some((remote, local)) = split_remote_spec(rest) {
                return BranchSpec {
                    local,
                    remote: Some(remote),
                };
            }
            return BranchSpec {
                local: rest,
                remote: None,
            };
        }

        if let Some(rest) = input.strip_prefix("remotes/") {
            if let Some((remote, local)) = split_remote_spec(rest) {
                return BranchSpec {
                    local,
                    remote: Some(remote),
                };
            }
            return BranchSpec {
                local: rest,
                remote: None,
            };
        }

        if let Some((candidate_remote, local)) = split_remote_spec(input)
            && remotes.contains(candidate_remote)
        {
            return BranchSpec {
                local,
                remote: Some(candidate_remote),
            };
        }

        BranchSpec {
            local: input,
            remote: None,
        }
    }
}

fn split_remote_spec(input: &str) -> Option<(&str, &str)> {
    let (head, tail) = input.split_once('/')?;
    if head.is_empty() || tail.is_empty() {
        None
    } else {
        Some((head, tail))
    }
}

fn materialize_from_remote(repo: &Repository, local: &str, remote: &str) -> Result<()> {
    let reference_name = format!("refs/remotes/{remote}/{local}");
    let reference = repo
        .find_reference(&reference_name)
        .with_context(|| format!("Remote reference '{reference_name}' missing"))?;
    let target = reference
        .target()
        .ok_or_else(|| anyhow!("Remote reference '{reference_name}' has no target"))?;
    let commit = repo.find_commit(target).with_context(|| {
        format!("Remote reference '{reference_name}' target {target} is not a commit")
    })?;

    repo.branch(local, &commit, false).with_context(|| {
        format!("Failed to create local branch '{local}' from '{reference_name}'")
    })?;
    Ok(())
}

/// Safely sync a local branch with its remote counterpart using fast-forward only.
///
/// IMPORTANT: This function should only be used for branches where the remote is the
/// authoritative source of truth (e.g., PR branches from GitHub). It will:
/// - Fast-forward local if behind remote (safe)
/// - Skip sync with warning if local is ahead (preserves local commits)
/// - Skip sync with warning if branches have diverged (preserves local commits)
///
/// This function NEVER performs force updates or resets that could lose commits.
/// For local development branches where users may have unpushed work, do NOT call this.
pub fn safe_sync_branch_with_origin(repo_path: &Path, branch_name: &str) -> Result<()> {
    log::info!("Safely syncing branch '{branch_name}' with origin (fast-forward only)");

    std::process::Command::new("git")
        .args(["fetch", "origin", branch_name])
        .current_dir(repo_path)
        .output()
        .with_context(|| format!("Failed to run git fetch for branch '{branch_name}'"))?;

    let repo = Repository::open(repo_path)?;
    let remote_ref = format!("refs/remotes/origin/{branch_name}");

    let remote_oid = repo
        .find_reference(&remote_ref)
        .ok()
        .and_then(|r| r.target());

    let local_branch = repo.find_branch(branch_name, BranchType::Local).ok();

    match (local_branch, remote_oid) {
        (None, Some(remote_oid)) => {
            let commit = repo.find_commit(remote_oid)?;
            log::info!("Creating local branch '{branch_name}' from origin/{branch_name}");
            repo.branch(branch_name, &commit, false)?;
        }
        (Some(branch), Some(remote_oid)) => {
            let local_oid = branch
                .get()
                .target()
                .ok_or_else(|| anyhow!("Local branch has no target"))?;

            if local_oid == remote_oid {
                log::info!("Branch '{branch_name}' is already up-to-date with origin");
                return Ok(());
            }

            let local_is_ancestor = repo.graph_descendant_of(remote_oid, local_oid)?;
            let remote_is_ancestor = repo.graph_descendant_of(local_oid, remote_oid)?;

            if local_is_ancestor && !remote_is_ancestor {
                log::info!("Fast-forwarding '{branch_name}' to origin/{branch_name}");
                let refname = branch
                    .get()
                    .name()
                    .ok_or_else(|| anyhow!("Branch has no ref name"))?;
                repo.reference(refname, remote_oid, true, "safe sync with origin (fast-forward)")?;
            } else if remote_is_ancestor && !local_is_ancestor {
                log::warn!(
                    "Branch '{branch_name}' is ahead of origin - skipping sync to preserve local commits"
                );
            } else {
                log::warn!(
                    "Branch '{branch_name}' has diverged from origin - skipping sync to preserve local commits"
                );
            }
        }
        (Some(_), None) => {
            log::info!("Local branch '{branch_name}' exists but no remote tracking branch found");
        }
        (None, None) => {
            return Err(anyhow!(
                "Branch '{branch_name}' does not exist locally or on origin"
            ));
        }
    }

    Ok(())
}

pub struct RemoteBranchStatus {
    pub exists_on_remote: bool,
    pub conflict_warning: Option<String>,
}

/// Checks if a branch exists on the remote and whether it has different commits.
/// Returns status indicating if branch exists and any conflict warning.
pub fn check_remote_branch_status(repo_path: &Path, branch_name: &str) -> RemoteBranchStatus {
    let not_found = RemoteBranchStatus {
        exists_on_remote: false,
        conflict_warning: None,
    };

    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("Failed to open repository: {e}");
            return not_found;
        }
    };

    let local_commit = match repo.find_branch(branch_name, BranchType::Local) {
        Ok(branch) => match branch.get().peel_to_commit() {
            Ok(commit) => commit.id().to_string(),
            Err(e) => {
                log::debug!("Failed to get local commit for branch '{branch_name}': {e}");
                return not_found;
            }
        },
        Err(_) => return not_found,
    };

    let output = match std::process::Command::new("git")
        .args(["ls-remote", "origin", branch_name])
        .current_dir(repo_path)
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            log::debug!("Failed to run git ls-remote: {e}");
            return not_found;
        }
    };

    if !output.status.success() {
        return not_found;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let remote_commit = stdout.split_whitespace().next();

    match remote_commit {
        Some(remote) if !remote.is_empty() => {
            let has_conflict = !local_commit.starts_with(remote) && !remote.starts_with(&local_commit);
            RemoteBranchStatus {
                exists_on_remote: true,
                conflict_warning: if has_conflict {
                    Some(format!(
                        "[rejected] Branch '{branch_name}' already exists on remote with different commits (non-fast-forward). A PR may already exist for this branch."
                    ))
                } else {
                    None
                },
            }
        }
        _ => not_found,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn ensure_branch_at_head_renames_current_branch_when_missing() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        let init = Command::new("git")
            .args(["init", "--initial-branch=master"])
            .current_dir(repo_path)
            .output()
            .unwrap();
        assert!(
            init.status.success(),
            "git init failed: {}",
            String::from_utf8_lossy(&init.stderr)
        );
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "bootstrap"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        ensure_branch_at_head(repo_path, "main").expect("should bootstrap base branch");

        assert!(
            branch_exists(repo_path, "main").unwrap(),
            "expected main branch to be created"
        );
        assert!(
            !branch_exists(repo_path, "master").unwrap(),
            "master branch should be renamed away"
        );

        let repo = Repository::open(repo_path).unwrap();
        let head = repo.head().unwrap();
        assert_eq!(head.shorthand(), Some("main"));
    }
}

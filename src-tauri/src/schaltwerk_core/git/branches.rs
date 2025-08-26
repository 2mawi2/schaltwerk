use std::path::Path;
use std::process::Command;
use anyhow::{Result, anyhow};
use crate::schaltwerk_core::git::repository::{repository_has_commits, get_unborn_head_branch};

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
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-a", "--format=%(refname:short)"
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to list branches: {}", stderr));
    }
    
    let branches_str = String::from_utf8_lossy(&output.stdout);
    let mut branches: Vec<String> = branches_str
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            if let Some(branch) = line.strip_prefix("origin/") {
                branch.to_string()
            } else {
                line.to_string()
            }
        })
        .collect();
    
    branches.sort();
    branches.dedup();
    
    branches.retain(|b| !b.contains("HEAD"));
    
    log::debug!("Found {} branches", branches.len());
    Ok(branches)
}

pub fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<()> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-D", branch_name
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to delete branch {}: {}", branch_name, stderr));
    }
    
    Ok(())
}

pub fn branch_exists(repo_path: &Path, branch_name: &str) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch_name}")
        ])
        .output();
    
    match output {
        Ok(result) => Ok(result.status.success()),
        Err(_) => Ok(false)
    }
}

pub fn rename_branch(repo_path: &Path, old_branch: &str, new_branch: &str) -> Result<()> {
    if !branch_exists(repo_path, old_branch)? {
        return Err(anyhow!("Branch '{old_branch}' does not exist"));
    }
    
    if branch_exists(repo_path, new_branch)? {
        return Err(anyhow!("Branch '{new_branch}' already exists"));
    }
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-m", old_branch, new_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to rename branch: {stderr}"));
    }
    
    Ok(())
}

pub fn archive_branch(repo_path: &Path, branch_name: &str, session_name: &str) -> Result<String> {
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let archived_branch = format!("para/archived/{timestamp}/{session_name}");
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "-m", branch_name, &archived_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to archive branch {}: {}", branch_name, stderr));
    }
    
    Ok(archived_branch)
}
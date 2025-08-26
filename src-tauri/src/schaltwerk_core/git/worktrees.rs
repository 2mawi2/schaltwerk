use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Result, anyhow};
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
    
    let branch_check = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "show-ref", "--verify", "--quiet", &format!("refs/heads/{branch_name}")
        ])
        .output()?;
    
    if branch_check.status.success() {
        log::info!("Deleting existing branch: {branch_name}");
        let _ = Command::new("git")
            .args([
                "-C", repo_path.to_str().unwrap(),
                "branch", "-D", branch_name
            ])
            .output()?;
    }
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "add", "-b", branch_name,
            worktree_path.to_str().unwrap(),
            &base_commit_hash
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!(
            "Failed to create worktree: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    
    log::info!("Successfully created worktree at: {}", worktree_path.display());
    Ok(())
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "remove", worktree_path.to_str().unwrap(), "--force"
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("is not a working tree") || stderr.contains("not a working tree") {
            return Ok(());
        }
        return Err(anyhow!("Failed to remove worktree: {}", stderr));
    }
    
    Ok(())
}

pub fn list_worktrees(repo_path: &Path) -> Result<Vec<PathBuf>> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "list", "--porcelain"
        ])
        .output()?;
    
    if !output.status.success() {
        return Ok(Vec::new());
    }
    
    let mut worktrees = Vec::new();
    let lines = String::from_utf8_lossy(&output.stdout);
    
    for line in lines.lines() {
        if line.starts_with("worktree ") {
            let path = line.strip_prefix("worktree ").unwrap();
            worktrees.push(PathBuf::from(path));
        }
    }
    
    Ok(worktrees)
}

pub fn prune_worktrees(repo_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "prune"
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to prune worktrees: {}", stderr));
    }
    
    Ok(())
}

#[allow(dead_code)]
pub fn is_worktree_registered(repo_path: &Path, worktree_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "worktree", "list", "--porcelain"
        ])
        .output()?;
    
    if !output.status.success() {
        return Ok(false);
    }
    
    let worktree_list = String::from_utf8_lossy(&output.stdout);
    let is_registered = worktree_list
        .lines()
        .any(|line| {
            line.starts_with("worktree ") && 
            line.contains(&worktree_path.to_string_lossy().to_string())
        });
    
    Ok(is_registered)
}

pub fn update_worktree_branch(worktree_path: &Path, new_branch: &str) -> Result<()> {
    let session_id = extract_session_name_from_path(worktree_path)?;
    let stash_message = format!("Auto-stash before branch rename [session:{session_id}]");
    
    if has_uncommitted_changes(worktree_path)? {
        let stash_output = Command::new("git")
            .args([
                "-C", worktree_path.to_str().unwrap(),
                "stash", "push", "-m", &stash_message
            ])
            .output()?;
        
        if !stash_output.status.success() {
            log::warn!("Failed to stash changes, proceeding anyway");
        }
    }
    
    let output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "switch", new_branch
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to update worktree to new branch: {stderr}"));
    }
    
    restore_session_specific_stash(worktree_path, &session_id)?;
    
    Ok(())
}

fn extract_session_name_from_path(worktree_path: &Path) -> Result<String> {
    worktree_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Cannot extract session name from worktree path"))
}

fn restore_session_specific_stash(worktree_path: &Path, session_id: &str) -> Result<()> {
    let stash_list_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "stash", "list", "--format=%H %s"
        ])
        .output()?;
    
    if !stash_list_output.status.success() {
        return Ok(());
    }
    
    let stash_list = String::from_utf8_lossy(&stash_list_output.stdout);
    let target_pattern = format!("[session:{session_id}]");
    
    for (index, line) in stash_list.lines().enumerate() {
        if line.contains(&target_pattern) {
            let pop_output = Command::new("git")
                .args([
                    "-C", worktree_path.to_str().unwrap(),
                    "stash", "pop", &format!("stash@{{{index}}}")
                ])
                .output()?;
            
            if !pop_output.status.success() {
                log::warn!("Failed to restore session-specific stash, it remains in stash");
            } else {
                log::info!("Successfully restored stash for session {session_id}");
            }
            break;
        }
    }
    
    Ok(())
}

fn has_uncommitted_changes(worktree_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    Ok(!output.stdout.is_empty())
}
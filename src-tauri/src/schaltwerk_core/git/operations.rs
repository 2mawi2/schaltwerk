use std::path::Path;
use std::process::Command;
use anyhow::{Result, anyhow};

pub fn has_uncommitted_changes(worktree_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "status", "--porcelain"
        ])
        .output()?;
    
    Ok(!output.stdout.is_empty())
}

pub fn commit_all_changes(worktree_path: &Path, message: &str) -> Result<()> {
    let add_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "add", "-A"
        ])
        .output()?;
    
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(anyhow!("Failed to stage changes: {}", stderr));
    }
    
    let commit_output = Command::new("git")
        .args([
            "-C", worktree_path.to_str().unwrap(),
            "commit", "-m", message
        ])
        .output()?;
    
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if stderr.contains("nothing to commit") {
            return Ok(());
        }
        return Err(anyhow!("Failed to commit changes: {}", stderr));
    }
    
    Ok(())
}

pub fn is_valid_session_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 100 {
        return false;
    }
    
    name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}
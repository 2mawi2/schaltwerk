use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Result, anyhow};
use std::fs;

pub const INITIAL_COMMIT_MESSAGE: &str = "Initial commit";

pub fn discover_repository() -> Result<PathBuf> {
    if let Ok(repo_env) = std::env::var("PARA_REPO_PATH") {
        if !repo_env.trim().is_empty() {
            let output = Command::new("git")
                .args(["-C", &repo_env, "rev-parse", "--show-toplevel"])
                .output()?;
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(PathBuf::from(path));
            }
        }
    }

    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Not in a git repository. Please run Schaltwerk from within a git repository."));
    }
    
    let path = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    
    Ok(PathBuf::from(path))
}

pub fn get_current_branch(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", "--abbrev-ref", "HEAD"
        ])
        .output()?;
    
    if !output.status.success() {
        return Err(anyhow!("Failed to get current branch"));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn get_unborn_head_branch(repo_path: &Path) -> Result<String> {
    log::debug!("Checking for unborn HEAD in repository: {}", repo_path.display());
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "symbolic-ref", "HEAD"
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::debug!("Failed to get symbolic ref HEAD: {stderr}");
        return Err(anyhow!("Failed to get symbolic ref HEAD: {}", stderr));
    }
    
    let full_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::debug!("Found HEAD symbolic ref: {full_ref}");
    
    if let Some(branch) = full_ref.strip_prefix("refs/heads/") {
        log::info!("Detected unborn HEAD branch: {branch}");
        Ok(branch.to_string())
    } else {
        Err(anyhow!("HEAD symbolic ref is not a branch: {}", full_ref))
    }
}

pub fn repository_has_commits(repo_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-list", "-n", "1", "--all"
        ])
        .output()?;
    
    Ok(output.status.success() && !output.stdout.is_empty())
}

pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    log::info!("Getting default branch for repo: {}", repo_path.display());
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "symbolic-ref", "refs/remotes/origin/HEAD"
        ])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let full_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
            log::debug!("Found remote origin HEAD: {full_ref}");
            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                log::info!("Using default branch from remote: {branch}");
                return Ok(branch.to_string());
            }
        } else {
            log::debug!("Remote origin HEAD not set, trying to set it up");
            let setup_output = Command::new("git")
                .args([
                    "-C", repo_path.to_str().unwrap(),
                    "remote", "set-head", "origin", "--auto"
                ])
                .output();
            
            if let Ok(setup_output) = setup_output {
                if setup_output.status.success() {
                    log::info!("Successfully set up remote HEAD, retrying");
                    if let Ok(retry_output) = Command::new("git")
                        .args([
                            "-C", repo_path.to_str().unwrap(),
                            "symbolic-ref", "refs/remotes/origin/HEAD"
                        ])
                        .output() 
                    {
                        if retry_output.status.success() {
                            let full_ref = String::from_utf8_lossy(&retry_output.stdout).trim().to_string();
                            if let Some(branch) = full_ref.strip_prefix("refs/remotes/origin/") {
                                log::info!("Using default branch from remote after setup: {branch}");
                                return Ok(branch.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    
    if let Ok(current) = get_current_branch(repo_path) {
        log::info!("Using current branch as default: {current}");
        return Ok(current);
    }
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "branch", "--list", "--format=%(refname:short)"
        ])
        .output()?;
    
    if output.status.success() {
        let branches = String::from_utf8_lossy(&output.stdout);
        let branch_names: Vec<&str> = branches.lines().collect();
        log::debug!("Available branches: {branch_names:?}");
        
        if !branch_names.is_empty() {
            if let Some(first_branch) = branch_names.first() {
                log::info!("Using first available branch: {first_branch}");
                return Ok(first_branch.to_string());
            }
        }
    }
    
    if let Ok(unborn_branch) = get_unborn_head_branch(repo_path) {
        log::info!("Repository has no commits, using unborn HEAD branch: {unborn_branch}");
        return Ok(unborn_branch);
    }
    
    log::error!("No branches found and unable to detect unborn HEAD in repository: {}", repo_path.display());
    Err(anyhow!("No branches found in repository"))
}

pub fn get_commit_hash(repo_path: &Path, branch_or_ref: &str) -> Result<String> {
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "rev-parse", branch_or_ref
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to get commit hash for '{}': {}", branch_or_ref, stderr));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn init_repository(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    
    let output = Command::new("git")
        .arg("init")
        .current_dir(path)
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Git init failed: {}", stderr));
    }
    
    Ok(())
}

pub fn create_initial_commit(repo_path: &Path) -> Result<()> {
    log::info!("Creating initial empty commit in repository: {}", repo_path.display());
    
    let output = Command::new("git")
        .args([
            "-C", repo_path.to_str().unwrap(),
            "commit", "--allow-empty", "-m", INITIAL_COMMIT_MESSAGE
        ])
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Failed to create initial commit: {}", stderr));
    }
    
    log::info!("Successfully created initial commit");
    Ok(())
}
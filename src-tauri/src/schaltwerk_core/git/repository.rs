use std::path::{Path, PathBuf};
use anyhow::{Result, anyhow};
use git2::Repository;
use std::fs;

pub const INITIAL_COMMIT_MESSAGE: &str = "Initial commit";

fn discover_repository_from_env() -> Option<PathBuf> {
    let repo_env = std::env::var("PARA_REPO_PATH").ok()?;
    if repo_env.trim().is_empty() {
        return None;
    }
    
    let repo_path = PathBuf::from(&repo_env);
    
    // Try opening directly as a repository
    if let Ok(repo) = Repository::open(&repo_path) {
        return Some(repo.workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or(repo_path));
    }
    
    // Try discovering from the provided path
    if let Ok(repo) = Repository::discover(&repo_path) {
        if let Some(workdir) = repo.workdir() {
            return Some(workdir.to_path_buf());
        }
    }
    
    None
}

fn discover_repository_from_cwd() -> Result<PathBuf> {
    let current_dir = std::env::current_dir()?;
    let repo = Repository::discover(&current_dir)
        .map_err(|_| anyhow!("Not in a git repository. Please run Schaltwerk from within a git repository."))?;
    
    repo.workdir()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| anyhow!("Could not determine repository working directory"))
}

pub fn discover_repository() -> Result<PathBuf> {
    // First try environment variable
    if let Some(path) = discover_repository_from_env() {
        return Ok(path);
    }
    
    // Fall back to current directory discovery
    discover_repository_from_cwd()
}

pub fn get_current_branch(repo_path: &Path) -> Result<String> {
    let repo = Repository::open(repo_path)?;
    
    let head = repo.head()?;
    
    if let Some(name) = head.shorthand() {
        Ok(name.to_string())
    } else {
        // Fallback to full reference name
        let reference = head.name()
            .ok_or_else(|| anyhow!("Could not get branch name"))?;
        
        // Strip refs/heads/ prefix if present
        if let Some(branch) = reference.strip_prefix("refs/heads/") {
            Ok(branch.to_string())
        } else {
            Ok(reference.to_string())
        }
    }
}

pub fn get_unborn_head_branch(repo_path: &Path) -> Result<String> {
    log::debug!("Checking for unborn HEAD in repository: {}", repo_path.display());
    
    let repo = Repository::open(repo_path)?;
    
    // Check if repo is empty (unborn HEAD)
    if repo.is_empty()? {
        // For an unborn HEAD, we need to read the symbolic ref directly
        match repo.find_reference("HEAD") {
            Ok(head_ref) => {
                if let Some(target) = head_ref.symbolic_target() {
                    log::debug!("Found HEAD symbolic ref: {target}");
                    
                    if let Some(branch) = target.strip_prefix("refs/heads/") {
                        log::info!("Detected unborn HEAD branch: {branch}");
                        return Ok(branch.to_string());
                    }
                }
            }
            Err(e) => {
                log::debug!("Failed to get HEAD reference: {e}");
            }
        }
    }
    
    // If not unborn, try regular branch detection
    get_current_branch(repo_path)
}

pub fn repository_has_commits(repo_path: &Path) -> Result<bool> {
    let repo = Repository::open(repo_path)?;
    
    // Check if repository is empty (no commits)
    Ok(!repo.is_empty()?)
}

pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    log::info!("Getting default branch for repo: {}", repo_path.display());
    
    let repo = Repository::open(repo_path)?;
    
    // Try to find the origin remote's HEAD
    if let Ok(_remote) = repo.find_remote("origin") {
        // Try to find refs/remotes/origin/HEAD
        if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
            if let Some(target) = reference.symbolic_target() {
                log::debug!("Found remote origin HEAD: {target}");
                if let Some(branch) = target.strip_prefix("refs/remotes/origin/") {
                    log::info!("Using default branch from remote: {branch}");
                    return Ok(branch.to_string());
                }
            }
        }
        
        // If origin/HEAD is not set, we could try to fetch it but that requires network
        // For now, we'll try other methods
        log::debug!("Remote origin HEAD not set");
    }
    
    if let Ok(current) = get_current_branch(repo_path) {
        log::info!("Using current branch as default: {current}");
        return Ok(current);
    }
    
    // List all branches and pick the first one
    let branches = repo.branches(Some(git2::BranchType::Local))?;
    for (branch, _) in branches.flatten() {
        if let Some(name) = branch.name()? {
            log::info!("Using first available branch: {name}");
            return Ok(name.to_string());
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
    let repo = Repository::open(repo_path)?;
    
    // Try to parse the reference
    let obj = repo.revparse_single(branch_or_ref)
        .map_err(|e| anyhow!("Failed to get commit hash for '{}': {}", branch_or_ref, e))?;
    
    // Get the commit's OID
    let oid = obj.id();
    
    Ok(oid.to_string())
}

pub fn init_repository(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    
    log::info!("Initializing git repository at: {}", path.display());
    
    let _repo = Repository::init(path)
        .map_err(|e| anyhow!("Git init failed: {}", e))?;
    
    Ok(())
}

pub fn create_initial_commit(repo_path: &Path) -> Result<()> {
    log::info!("Creating initial empty commit in repository: {}", repo_path.display());
    
    let repo = Repository::open(repo_path)?;
    
    // Get the default signature from git config
    let sig = repo.signature()
        .map_err(|e| anyhow!("Failed to get signature from git config: {}. Please configure git user.name and user.email", e))?;
    
    // Create an empty tree for the initial commit
    let tree_id = {
        let mut index = repo.index()?;
        index.write_tree()?
    };
    let tree = repo.find_tree(tree_id)?;
    
    // Create the initial commit
    let _commit_id = repo.commit(
        Some("HEAD"),  // Update HEAD to point to this commit
        &sig,           // Author
        &sig,           // Committer
        INITIAL_COMMIT_MESSAGE,
        &tree,
        &[],            // No parent commits
    ).map_err(|e| anyhow!("Failed to create initial commit: {}", e))?;
    
    log::info!("Successfully created initial commit");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use git2::Signature;
    
    #[test]
    fn test_discover_repository_from_env() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Set environment variable
        std::env::set_var("PARA_REPO_PATH", temp_dir.path());
        
        // Test discovery
        let result = discover_repository_from_env();
        
        // Clean up
        std::env::remove_var("PARA_REPO_PATH");
        
        assert!(result.is_some(), "Should discover repository from env");
        if let Some(result_path) = result {
            // Use canonicalize to resolve symlinks for comparison
            if let (Ok(canonical_result), Ok(canonical_expected)) = 
                (result_path.canonicalize(), temp_dir.path().canonicalize()) {
                assert_eq!(canonical_result, canonical_expected);
            }
        }
    }
    
    #[test]
    fn test_discover_repository_from_env_empty() {
        // Set empty environment variable
        std::env::set_var("PARA_REPO_PATH", "");
        
        // Test discovery
        let result = discover_repository_from_env();
        
        // Clean up
        std::env::remove_var("PARA_REPO_PATH");
        
        assert!(result.is_none());
    }
    
    #[test]
    fn test_discover_repository_from_env_invalid() {
        // Set invalid path
        std::env::set_var("PARA_REPO_PATH", "/nonexistent/path");
        
        // Test discovery
        let result = discover_repository_from_env();
        
        // Clean up
        std::env::remove_var("PARA_REPO_PATH");
        
        assert!(result.is_none());
    }
    
    #[test]
    fn test_get_current_branch() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        let commit_id = repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Test default branch (should be the default branch name)
        let branch_name = get_current_branch(temp_dir.path()).expect("Should get branch name");
        // The branch name depends on git config, could be "main" or "master"
        assert!(!branch_name.is_empty());
        
        // Create and checkout a new branch
        let commit = repo.find_commit(commit_id).expect("Failed to find commit");
        repo.branch("test-branch", &commit, false).expect("Failed to create branch");
        repo.set_head("refs/heads/test-branch").expect("Failed to set HEAD");
        
        // Test new branch
        let branch_name = get_current_branch(temp_dir.path()).expect("Should get branch name");
        assert_eq!(branch_name, "test-branch");
    }
    
    #[test]
    fn test_get_current_branch_detached_head() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        let commit_id = repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Create detached HEAD
        repo.set_head_detached(commit_id).expect("Failed to detach HEAD");
        
        // Test - should return "HEAD" for detached state
        let result = get_current_branch(temp_dir.path()).expect("Should handle detached HEAD");
        assert_eq!(result, "HEAD");
    }
    
    #[test]
    fn test_get_unborn_head_branch() {
        // Create a temporary git repository with no commits
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Test - should return the default branch name
        let branch_name = get_unborn_head_branch(temp_dir.path())
            .expect("Should get unborn HEAD branch");
        
        // The default branch name depends on git config, could be "main" or "master"
        assert!(!branch_name.is_empty());
        assert!(branch_name == "main" || branch_name == "master");
    }
    
    #[test]
    fn test_get_unborn_head_branch_with_commits() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Test - should still work even with commits
        let branch_name = get_unborn_head_branch(temp_dir.path())
            .expect("Should get current branch");
        assert!(!branch_name.is_empty());
    }
    
    #[test]
    fn test_repository_has_commits() {
        // Create a temporary git repository with no commits
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Test - should have no commits
        let has_commits = repository_has_commits(temp_dir.path())
            .expect("Should check for commits");
        assert!(!has_commits);
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Test - should have commits now
        let has_commits = repository_has_commits(temp_dir.path())
            .expect("Should check for commits");
        assert!(has_commits);
    }
    
    #[test]
    fn test_get_default_branch() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Test - should return current branch
        let default_branch = get_default_branch(temp_dir.path())
            .expect("Should get default branch");
        assert!(!default_branch.is_empty());
    }
    
    #[test]
    fn test_init_repository() {
        // Create a temporary directory
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo_path = temp_dir.path().join("new_repo");
        
        // Initialize repository
        init_repository(&repo_path).expect("Should initialize repository");
        
        // Verify repository was created
        assert!(repo_path.exists());
        assert!(repo_path.join(".git").exists());
        
        // Verify it's a valid repository
        Repository::open(&repo_path).expect("Should be a valid repository");
    }
    
    #[test]
    fn test_create_initial_commit() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Configure git user for the test repo
        let mut config = repo.config().expect("Failed to get config");
        config.set_str("user.name", "Test User").expect("Failed to set user.name");
        config.set_str("user.email", "test@example.com").expect("Failed to set user.email");
        
        // Create initial commit
        create_initial_commit(temp_dir.path()).expect("Should create initial commit");
        
        // Verify commit was created
        let repo = Repository::open(temp_dir.path()).expect("Failed to open repo");
        let head = repo.head().expect("Failed to get HEAD");
        let oid = head.target().expect("HEAD should have target");
        let commit = repo.find_commit(oid).expect("Failed to find commit");
        
        assert_eq!(commit.message().unwrap(), INITIAL_COMMIT_MESSAGE);
        assert_eq!(commit.parent_count(), 0);
    }
    
    #[test]
    fn test_get_commit_hash() {
        // Create a temporary git repository
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let repo = Repository::init(temp_dir.path()).expect("Failed to init repo");
        
        // Create initial commit
        let sig = Signature::now("Test User", "test@example.com").expect("Failed to create signature");
        let tree_id = {
            let mut index = repo.index().expect("Failed to get index");
            index.write_tree().expect("Failed to write tree")
        };
        let tree = repo.find_tree(tree_id).expect("Failed to find tree");
        let commit_id = repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .expect("Failed to create initial commit");
        
        // Create a branch
        let commit = repo.find_commit(commit_id).expect("Failed to find commit");
        repo.branch("test-branch", &commit, false).expect("Failed to create branch");
        
        // Test with HEAD
        let hash = get_commit_hash(temp_dir.path(), "HEAD")
            .expect("Should get HEAD hash");
        assert_eq!(hash, commit_id.to_string());
        
        // Test with branch name
        let hash = get_commit_hash(temp_dir.path(), "test-branch")
            .expect("Should get branch hash");
        assert_eq!(hash, commit_id.to_string());
        
        // Test with short hash
        let short_hash = &commit_id.to_string()[..7];
        let hash = get_commit_hash(temp_dir.path(), short_hash)
            .expect("Should get hash from short hash");
        assert_eq!(hash, commit_id.to_string());
    }
}
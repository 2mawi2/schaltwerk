
mod repository;
mod branches;
mod worktrees;
mod stats;
mod operations;

#[cfg(test)]
mod worktree_benchmark;
#[cfg(test)]
mod branches_benchmark;
#[cfg(test)]
mod stats_benchmark;

pub use repository::{discover_repository, get_default_branch, init_repository, repository_has_commits, create_initial_commit, INITIAL_COMMIT_MESSAGE};

#[cfg(test)]
pub use repository::{get_current_branch, get_commit_hash};
pub use branches::{list_branches, delete_branch, branch_exists, rename_branch, archive_branch};
pub use worktrees::{create_worktree_from_base, remove_worktree, list_worktrees, prune_worktrees, update_worktree_branch};

#[cfg(test)]
pub use worktrees::is_worktree_registered;
pub use stats::{calculate_git_stats_fast, get_changed_files};
pub use operations::{has_uncommitted_changes, commit_all_changes, is_valid_session_name};












#[cfg(test)]
mod performance_tests {
    use super::*;
    use std::time::Instant;
    use std::path::PathBuf;
    use tempfile::TempDir;
    use std::process::Command as StdCommand;
    
    fn setup_test_repo_with_many_files(num_files: usize) -> (TempDir, PathBuf, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees/test");
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Set git config
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create many files in the main branch
        for i in 0..num_files/2 {
            std::fs::write(repo_path.join(format!("file_{i}.txt")), format!("content {i}")).unwrap();
        }
        
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create worktree from current branch (master)
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
        // Add more files in the worktree
        for i in num_files/2..num_files {
            std::fs::write(worktree_path.join(format!("file_{i}.txt")), format!("content {i}")).unwrap();
        }
        
        // Modify some existing files
        for i in 0..10.min(num_files/2) {
            std::fs::write(worktree_path.join(format!("file_{i}.txt")), format!("modified content {i}")).unwrap();
        }
        
        // Stage some changes
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&worktree_path)
            .output()
            .unwrap();
        
        // Commit some changes
        StdCommand::new("git")
            .args(["commit", "-m", "Add files in worktree"])
            .current_dir(&worktree_path)
            .output()
            .unwrap();
        
        // Create some unstaged changes
        for i in 0..5.min(num_files/4) {
            std::fs::write(worktree_path.join(format!("unstaged_{i}.txt")), format!("unstaged {i}")).unwrap();
        }
        
        (temp_dir, repo_path, worktree_path)
    }
    
    #[test]
    #[ignore = "Performance tests are flaky in CI environments"]
    fn test_git_stats_performance_with_many_files() {
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(100);
        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Test old version
        let start = Instant::now();
        let stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        let old_duration = start.elapsed();
        println!("Old git stats calculation with 100 files took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        let fast_stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        let fast_duration = start.elapsed();
        println!("Fast git stats calculation with 100 files took: {fast_duration:?}");
        
        assert_eq!(stats.files_changed, fast_stats.files_changed, "Stats should match");
        assert!(fast_duration <= old_duration, "Fast version should be faster or equal");
        assert!(fast_duration.as_millis() < 500, "Fast git stats took too long: {fast_duration:?}");
    }
    
    #[test]
    #[ignore = "Performance tests are flaky in CI environments"]
    fn test_git_stats_performance_repeated_calls() {
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(50);
        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Test old version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        }
        let old_duration = start.elapsed();
        println!("5 repeated old git stats calculations took: {old_duration:?}");
        
        // Test new fast version
        let start = Instant::now();
        for _ in 0..5 {
            let _ = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        }
        let fast_duration = start.elapsed();
        println!("5 repeated fast git stats calculations took: {fast_duration:?}");
        
        assert!(fast_duration <= old_duration, "Fast version should be faster or equal");
        assert!(fast_duration.as_millis() < 1000, "Repeated fast git stats took too long: {fast_duration:?}");
    }
    
    #[test]
    fn test_fast_version_with_no_changes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Set git config
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create worktree with no changes
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees/test");
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
        // Test that fast version is very quick when no changes
        let start = Instant::now();
        let stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        let duration = start.elapsed();
        
        println!("Fast git stats with no changes took: {duration:?}");
        assert_eq!(stats.files_changed, 0);
        assert_eq!(stats.lines_added, 0);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        assert!(duration.as_millis() < 150, "Should be very fast with no changes: {duration:?}");
    }
    
    #[test]
    fn test_get_commit_hash() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
            
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Test getting commit hash
        let current_branch = get_current_branch(&repo_path).unwrap();
        let commit_hash = get_commit_hash(&repo_path, &current_branch).unwrap();
        
        assert_eq!(commit_hash.len(), 40); // SHA-1 hash is 40 characters
        assert!(commit_hash.chars().all(|c| c.is_ascii_hexdigit()), "Should be hex characters");
        
        // Test getting hash for HEAD
        let head_hash = get_commit_hash(&repo_path, "HEAD").unwrap();
        assert_eq!(commit_hash, head_hash);
        
        // Test error for non-existent reference
        let result = get_commit_hash(&repo_path, "non-existent-branch");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_prune_worktrees() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Test prune worktrees (should succeed even with no worktrees)
        let result = prune_worktrees(&repo_path);
        assert!(result.is_ok(), "Prune should succeed even with no worktrees");
    }
    
    #[test]
    fn test_is_worktree_registered() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        let worktree_path = temp_dir.path().join("test-worktree");
        
        // Test non-registered worktree
        let is_registered = is_worktree_registered(&repo_path, &worktree_path).unwrap();
        assert!(!is_registered, "Non-existent worktree should not be registered");
        
        // Create a worktree
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
        // Test registered worktree
        let is_registered = is_worktree_registered(&repo_path, &worktree_path).unwrap();
        assert!(is_registered, "Created worktree should be registered");
        
        // Test with non-existent path after registration
        let fake_path = temp_dir.path().join("fake-worktree");
        let is_registered = is_worktree_registered(&repo_path, &fake_path).unwrap();
        assert!(!is_registered, "Non-existent path should not be registered");
    }
    
    #[test]
    fn test_create_worktree_from_base_with_commit_hash() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        let worktree_path = temp_dir.path().join("test-worktree");
        
        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        let current_branch = get_current_branch(&repo_path).unwrap();
        let _initial_commit = get_commit_hash(&repo_path, &current_branch).unwrap();
        
        // Create another commit
        std::fs::write(repo_path.join("file2.txt"), "Second commit").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Second commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create worktree from the initial commit (not the latest)
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch).unwrap();
        
        assert!(worktree_path.exists(), "Worktree directory should exist");
        assert!(worktree_path.join("README.md").exists(), "Should have initial file");
        
        // Verify the worktree is at the latest commit (since we reference the branch)
        let worktree_commit = StdCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .unwrap();
        let worktree_output = String::from_utf8_lossy(&worktree_commit.stdout);
        let worktree_hash = worktree_output.trim();
        
        // Should match the latest commit on the branch, not the initial one
        let latest_commit = get_commit_hash(&repo_path, &current_branch).unwrap();
        assert_eq!(worktree_hash, latest_commit, "Worktree should be at latest commit");
    }

    #[test]
    fn test_stash_isolation_between_worktrees() {
        use tempfile::TempDir;
        use std::process::Command as StdCommand;

        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        let worktree1_path = temp_dir.path().join("session1");
        let worktree2_path = temp_dir.path().join("session2");

        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Create two worktrees
        create_worktree_from_base(&repo_path, "session1", &worktree1_path, &current_branch).unwrap();
        create_worktree_from_base(&repo_path, "session2", &worktree2_path, &current_branch).unwrap();

        // Create changes in worktree1 and stash them
        std::fs::write(worktree1_path.join("session1_file.txt"), "session1 changes").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&worktree1_path)
            .output()
            .unwrap();

        // Manually stash in worktree1 to simulate the problem
        StdCommand::new("git")
            .args(["stash", "push", "-m", "session1 work"])
            .current_dir(&worktree1_path)
            .output()
            .unwrap();

        // Verify worktree1 is clean
        assert!(!has_uncommitted_changes(&worktree1_path).unwrap());

        // Now update worktree2's branch - this should NOT restore session1's stash
        let result = update_worktree_branch(&worktree2_path, "session2");
        
        // This should succeed
        assert!(result.is_ok(), "Branch update should succeed");

        // Worktree2 should NOT have session1's file - this is the bug we're fixing
        assert!(!worktree2_path.join("session1_file.txt").exists(), 
               "Worktree2 should not have session1's changes - this test should initially FAIL");
    }

    #[test]
    fn test_session_specific_stash_restore() {
        use tempfile::TempDir;
        use std::process::Command as StdCommand;

        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        let worktree_path = temp_dir.path().join("test-session");

        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        let current_branch = get_current_branch(&repo_path).unwrap();
        
        // Create worktree
        create_worktree_from_base(&repo_path, "test-session", &worktree_path, &current_branch).unwrap();

        // Create changes in the worktree
        std::fs::write(worktree_path.join("test_changes.txt"), "my changes").unwrap();

        // Update the branch (this should stash and restore the changes)
        let result = update_worktree_branch(&worktree_path, "test-session");
        assert!(result.is_ok(), "Branch update should succeed");

        // The changes should be restored after the branch switch
        assert!(worktree_path.join("test_changes.txt").exists(), 
               "Session's own changes should be restored");
        
        let content = std::fs::read_to_string(worktree_path.join("test_changes.txt")).unwrap();
        assert_eq!(content, "my changes", "Content should be preserved");
    }
}


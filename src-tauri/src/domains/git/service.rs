// Re-export all the functions from the git domain modules
pub use super::repository::{
    INITIAL_COMMIT_MESSAGE, create_initial_commit, discover_repository, get_default_branch,
    init_repository, repository_has_commits,
};

pub use super::branches::{
    branch_exists, delete_branch, ensure_branch_at_head, list_branches, rename_branch,
};
#[cfg(test)]
pub use super::repository::{get_commit_hash, get_current_branch};
pub use super::worktrees::{
    create_worktree_from_base, list_worktrees, prune_worktrees, remove_worktree,
    update_worktree_branch,
};

pub use super::history::{
    CommitFileChange, HistoryProviderSnapshot, get_commit_file_changes, get_git_history,
    get_git_history_with_head,
};
pub use super::operations::{
    commit_all_changes, has_conflicts, has_uncommitted_changes, is_valid_branch_name,
    is_valid_session_name,
};
pub use super::stats::{calculate_git_stats_fast, get_changed_files};
#[cfg(test)]
pub use super::worktrees::is_worktree_registered;

#[cfg(test)]
mod performance_tests {
    use super::*;
    use crate::domains::git::stats::{
        clear_stats_cache, get_git_stats_cache_hits, get_git_stats_call_count,
        reset_git_stats_cache_hits, reset_git_stats_call_count, track_git_stats_on_current_thread,
    };
    use std::path::PathBuf;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

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
        for i in 0..num_files / 2 {
            std::fs::write(
                repo_path.join(format!("file_{i}.txt")),
                format!("content {i}"),
            )
            .unwrap();
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
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch)
            .unwrap();

        // Add more files in the worktree
        for i in num_files / 2..num_files {
            std::fs::write(
                worktree_path.join(format!("file_{i}.txt")),
                format!("content {i}"),
            )
            .unwrap();
        }

        // Modify some existing files
        for i in 0..10.min(num_files / 2) {
            std::fs::write(
                worktree_path.join(format!("file_{i}.txt")),
                format!("modified content {i}"),
            )
            .unwrap();
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
        for i in 0..5.min(num_files / 4) {
            std::fs::write(
                worktree_path.join(format!("unstaged_{i}.txt")),
                format!("unstaged {i}"),
            )
            .unwrap();
        }

        (temp_dir, repo_path, worktree_path)
    }

    #[test]
    fn test_git_stats_handles_many_files_without_flaking() {
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(100);
        let current_branch = get_current_branch(&repo_path).unwrap();

        let stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();

        assert!(
            stats.files_changed >= 50,
            "expected at least 50 files changed, got {}",
            stats.files_changed
        );
        assert!(
            stats.lines_added >= 50,
            "expected at least 50 lines added, got {}",
            stats.lines_added
        );
        assert!(
            stats.has_uncommitted,
            "expected git stats to flag uncommitted changes"
        );
    }

    #[test]
    fn test_git_stats_avoids_recomputing_when_inputs_unchanged() {
        let (_temp, repo_path, worktree_path) = setup_test_repo_with_many_files(50);
        let current_branch = get_current_branch(&repo_path).unwrap();

        clear_stats_cache();
        reset_git_stats_call_count();
        reset_git_stats_cache_hits();
        let _scope = track_git_stats_on_current_thread();

        let first = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        assert_eq!(
            get_git_stats_call_count(),
            1,
            "first call should perform exactly one computation"
        );
        assert_eq!(
            get_git_stats_cache_hits(),
            0,
            "cache should be empty before the first call"
        );

        let second = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        assert_eq!(
            get_git_stats_call_count(),
            2,
            "second invocation should be tracked even when cached"
        );
        assert_eq!(
            get_git_stats_cache_hits(),
            1,
            "second call should be served from cache"
        );
        assert_eq!(first.files_changed, second.files_changed);
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
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch)
            .unwrap();

        clear_stats_cache();
        reset_git_stats_call_count();
        reset_git_stats_cache_hits();
        let _scope = track_git_stats_on_current_thread();

        // Test that fast version returns zeroed stats
        let stats = calculate_git_stats_fast(&worktree_path, &current_branch).unwrap();
        assert_eq!(stats.files_changed, 0);
        assert_eq!(stats.lines_added, 0);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        assert_eq!(
            get_git_stats_call_count(),
            1,
            "expected a single stats computation for clean worktrees"
        );
        assert_eq!(
            get_git_stats_cache_hits(),
            0,
            "no cache hits expected on the first invocation"
        );
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
        assert!(
            commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
            "Should be hex characters"
        );

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
        assert!(
            result.is_ok(),
            "Prune should succeed even with no worktrees"
        );
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
        assert!(
            !is_registered,
            "Non-existent worktree should not be registered"
        );

        // Create a worktree
        let current_branch = get_current_branch(&repo_path).unwrap();
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch)
            .unwrap();

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
        create_worktree_from_base(&repo_path, "test-branch", &worktree_path, &current_branch)
            .unwrap();

        assert!(worktree_path.exists(), "Worktree directory should exist");
        assert!(
            worktree_path.join("README.md").exists(),
            "Should have initial file"
        );

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
        assert_eq!(
            worktree_hash, latest_commit,
            "Worktree should be at latest commit"
        );
    }

    #[test]
    fn test_stash_isolation_between_worktrees() {
        use std::process::Command as StdCommand;
        use tempfile::TempDir;

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
        create_worktree_from_base(&repo_path, "session1", &worktree1_path, &current_branch)
            .unwrap();
        create_worktree_from_base(&repo_path, "session2", &worktree2_path, &current_branch)
            .unwrap();

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
        assert!(
            !worktree2_path.join("session1_file.txt").exists(),
            "Worktree2 should not have session1's changes - this test should initially FAIL"
        );
    }

    #[test]
    fn test_session_specific_stash_restore() {
        use std::process::Command as StdCommand;
        use tempfile::TempDir;

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
        create_worktree_from_base(&repo_path, "test-session", &worktree_path, &current_branch)
            .unwrap();

        // Create changes in the worktree
        std::fs::write(worktree_path.join("test_changes.txt"), "my changes").unwrap();

        // Update the branch (this should stash and restore the changes)
        let result = update_worktree_branch(&worktree_path, "test-session");
        assert!(result.is_ok(), "Branch update should succeed");

        // The changes should be restored after the branch switch
        assert!(
            worktree_path.join("test_changes.txt").exists(),
            "Session's own changes should be restored"
        );

        let content = std::fs::read_to_string(worktree_path.join("test_changes.txt")).unwrap();
        assert_eq!(content, "my changes", "Content should be preserved");
    }
}

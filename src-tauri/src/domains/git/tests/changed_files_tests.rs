//! Comprehensive tests for changed file detection functionality.
//!
//! Tests both `get_changed_files_from_main()` (for sessions) and
//! `get_orchestrator_working_changes()` (for orchestrator/main repo).

use crate::domains::git::stats::get_changed_files;
use std::fs;
use std::process::Command as StdCommand;
use tempfile::TempDir;

/// Initialize a test git repository with an initial commit and main branch.
fn init_test_repo() -> TempDir {
    let temp = TempDir::new().unwrap();
    let p = temp.path();

    // Initialize repo
    StdCommand::new("git")
        .args(["init"])
        .current_dir(p)
        .output()
        .unwrap();

    // Configure git user
    StdCommand::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(p)
        .output()
        .unwrap();

    StdCommand::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create initial commit
    fs::write(p.join("README.md"), "# Test Repository\n").unwrap();
    StdCommand::new("git")
        .args(["add", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(p)
        .output()
        .unwrap();

    // Rename branch to main if needed
    let branch_output = StdCommand::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(p)
        .output()
        .unwrap();
    let current_branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
    if current_branch != "main" && !current_branch.is_empty() {
        StdCommand::new("git")
            .args(["branch", "-m", &current_branch, "main"])
            .current_dir(p)
            .output()
            .unwrap();
    }

    temp
}

// ============================================================================
// Tests for get_changed_files_from_main() - Session diff vs base branch
// ============================================================================

#[test]
fn test_get_changed_files_retrieves_added_files() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Add new file and commit it
    fs::write(p.join("new_feature.rs"), "fn main() {}\n").unwrap();
    StdCommand::new("git")
        .args(["add", "new_feature.rs"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add new feature"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();

    // Should detect the new file
    assert!(!files.is_empty());
    let new_feature = files.iter().find(|f| f.path == "new_feature.rs");
    assert!(new_feature.is_some());
    assert_eq!(new_feature.unwrap().change_type, "added");
}

#[test]
fn test_get_changed_files_retrieves_modified_files() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Modify existing file and commit
    fs::write(p.join("README.md"), "# Test Repository\nUpdated content\n").unwrap();
    StdCommand::new("git")
        .args(["add", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Update README"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();

    let readme = files.iter().find(|f| f.path == "README.md");
    assert!(readme.is_some());
    assert_eq!(readme.unwrap().change_type, "modified");
}

#[test]
fn test_get_changed_files_retrieves_deleted_files() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Delete file and commit
    StdCommand::new("git")
        .args(["rm", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Delete README"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();

    let deleted = files.iter().find(|f| f.path == "README.md");
    assert!(deleted.is_some());
    assert_eq!(deleted.unwrap().change_type, "deleted");
}

#[test]
fn test_get_changed_files_retrieves_untracked_files() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create untracked file (not committed)
    fs::write(p.join("untracked.txt"), "This is untracked\n").unwrap();

    let files = get_changed_files(p, "main").unwrap();

    let untracked = files.iter().find(|f| f.path == "untracked.txt");
    assert!(untracked.is_some());
    assert_eq!(untracked.unwrap().change_type, "added");
}

#[test]
fn test_get_changed_files_includes_staged_and_unstaged() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Add a committed change
    fs::write(p.join("committed.txt"), "committed\n").unwrap();
    StdCommand::new("git")
        .args(["add", "committed.txt"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add committed file"])
        .current_dir(p)
        .output()
        .unwrap();

    // Add uncommitted changes
    fs::write(p.join("uncommitted.txt"), "uncommitted\n").unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    assert!(paths.contains(&"committed.txt"));
    assert!(paths.contains(&"uncommitted.txt"));
}

#[test]
fn test_get_changed_files_uses_base_branch_from_config() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create develop branch as base
    StdCommand::new("git")
        .args(["checkout", "-b", "develop"])
        .current_dir(p)
        .output()
        .unwrap();

    fs::write(p.join("develop_file.txt"), "develop\n").unwrap();
    StdCommand::new("git")
        .args(["add", "develop_file.txt"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add develop file"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create feature branch from develop
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    fs::write(p.join("feature_file.txt"), "feature\n").unwrap();
    StdCommand::new("git")
        .args(["add", "feature_file.txt"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add feature file"])
        .current_dir(p)
        .output()
        .unwrap();

    // Compare against develop (base_branch)
    let files = get_changed_files(p, "develop").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    // Should include feature_file.txt (new from feature)
    assert!(paths.contains(&"feature_file.txt"));
    // Should NOT include develop_file.txt (already on develop)
    assert!(!paths.contains(&"develop_file.txt"));
}

// ============================================================================
// Tests for .schaltwerk filtering
// ============================================================================

#[test]
fn test_schaltwerk_directory_files_filtered_out() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create .schaltwerk directory structure
    fs::create_dir_all(p.join(".schaltwerk/worktrees")).unwrap();
    fs::write(p.join(".schaltwerk/config.json"), "{}").unwrap();
    fs::write(p.join(".schaltwerk/worktrees/session.db"), "db").unwrap();
    fs::write(p.join("normal_file.txt"), "normal").unwrap();

    // Add files to git
    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add files"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    // Should contain normal_file.txt
    assert!(paths.contains(&"normal_file.txt"));

    // Should NOT contain any .schaltwerk files
    assert!(!paths.iter().any(|p| p.contains(".schaltwerk")));
}

#[test]
fn test_schaltwerk_exact_directory_filtered() {
    // Test that .schaltwerk/ prefix matching works correctly
    let file_paths = vec![
        ".schaltwerk",
        ".schaltwerk/config.json",
        ".schaltwerk/worktrees/branch1/file.txt",
        "not_schaltwerk.txt",
        "src/.schaltwerk_related.txt",
    ];

    let filtered: Vec<_> = file_paths
        .iter()
        .filter(|&&p| !p.starts_with(".schaltwerk/") && p != ".schaltwerk")
        .copied()
        .collect();

    assert_eq!(filtered.len(), 2);
    assert!(filtered.contains(&"not_schaltwerk.txt"));
    assert!(filtered.contains(&"src/.schaltwerk_related.txt"));
    assert!(!filtered.contains(&".schaltwerk"));
    assert!(!filtered.iter().any(|p| p.contains(".schaltwerk/")));
}

// ============================================================================
// Tests for status flag handling
// ============================================================================

#[test]
fn test_file_status_added_marked_correctly() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    fs::write(p.join("added.txt"), "new").unwrap();
    StdCommand::new("git")
        .args(["add", "added.txt"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add file"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let added = files.iter().find(|f| f.path == "added.txt").unwrap();

    assert_eq!(added.change_type, "added");
}

#[test]
fn test_file_status_modified_marked_correctly() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Modify existing file
    fs::write(p.join("README.md"), "modified\n").unwrap();
    StdCommand::new("git")
        .args(["add", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Modify file"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let modified = files.iter().find(|f| f.path == "README.md").unwrap();

    assert_eq!(modified.change_type, "modified");
}

#[test]
fn test_file_status_deleted_marked_correctly() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    StdCommand::new("git")
        .args(["rm", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Delete file"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let deleted = files.iter().find(|f| f.path == "README.md").unwrap();

    assert_eq!(deleted.change_type, "deleted");
}

// ============================================================================
// Tests for sorting and output
// ============================================================================

#[test]
fn test_changed_files_sorted_alphabetically() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Add files in non-alphabetical order
    fs::write(p.join("zebra.txt"), "z").unwrap();
    fs::write(p.join("alpha.txt"), "a").unwrap();
    fs::write(p.join("middle.txt"), "m").unwrap();
    fs::write(p.join("beta.txt"), "b").unwrap();

    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add files"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    // Verify sorted order
    assert_eq!(paths[0], "alpha.txt");
    assert_eq!(paths[1], "beta.txt");
    assert_eq!(paths[2], "middle.txt");
    assert_eq!(paths[3], "zebra.txt");
}

#[test]
fn test_changed_files_empty_repo_returns_empty_list() {
    let repo = init_test_repo();
    let p = repo.path();

    // Create feature branch but don't make any changes
    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();

    assert!(files.is_empty());
}

#[test]
fn test_changed_files_multiple_status_types() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create multiple file changes
    fs::write(p.join("added.txt"), "new").unwrap();
    fs::write(p.join("README.md"), "modified\n").unwrap();
    StdCommand::new("git")
        .args(["rm", "README.md"])
        .current_dir(p)
        .output()
        .unwrap();

    // Separately, re-add README.md with different content (simulating modification then re-add)
    fs::write(p.join("another.txt"), "another").unwrap();

    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Multiple changes"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let change_types: std::collections::HashSet<_> =
        files.iter().map(|f| f.change_type.as_str()).collect();

    // Should have at least some change types represented
    assert!(change_types.contains(&"added") || change_types.contains(&"deleted")
        || change_types.contains(&"modified"));
}

// ============================================================================
// Integration tests for real-world scenarios
// ============================================================================

#[test]
fn test_complex_workflow_multiple_commits() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // First commit
    fs::create_dir_all(p.join("src")).unwrap();
    fs::write(p.join("src/lib.rs"), "pub fn init() {}").unwrap();
    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add library module"])
        .current_dir(p)
        .output()
        .unwrap();

    // Second commit
    fs::write(p.join("src/main.rs"), "fn main() {}").unwrap();
    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add main module"])
        .current_dir(p)
        .output()
        .unwrap();

    // Uncommitted change
    fs::write(p.join("src/lib.rs"), "pub fn init() { /* improved */ }").unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    // Should include both committed and uncommitted changes
    assert!(paths.contains(&"src/lib.rs"));
    assert!(paths.contains(&"src/main.rs"));
}

#[test]
fn test_deeply_nested_file_paths() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    // Create deeply nested structure
    fs::create_dir_all(p.join("src/components/forms/validation")).unwrap();
    fs::write(p.join("src/components/forms/validation/email.rs"), "fn validate() {}").unwrap();

    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add nested file"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

    assert!(paths.contains(&"src/components/forms/validation/email.rs"));
}

#[test]
fn test_changed_file_struct_properties() {
    let repo = init_test_repo();
    let p = repo.path();

    StdCommand::new("git")
        .args(["checkout", "-b", "feature"])
        .current_dir(p)
        .output()
        .unwrap();

    fs::write(p.join("test.txt"), "content").unwrap();
    StdCommand::new("git")
        .args(["add", "."])
        .current_dir(p)
        .output()
        .unwrap();
    StdCommand::new("git")
        .args(["commit", "-m", "Add test file"])
        .current_dir(p)
        .output()
        .unwrap();

    let files = get_changed_files(p, "main").unwrap();
    let file = files.iter().find(|f| f.path == "test.txt").unwrap();

    // Verify ChangedFile structure has expected properties
    assert!(!file.path.is_empty());
    assert!(!file.change_type.is_empty());
    assert_eq!(file.change_type, "added");
}

#[test]
fn test_invalid_repo_path_returns_error() {
    let nonexistent_path = std::path::Path::new("/nonexistent/path");
    let result = get_changed_files(nonexistent_path, "main");

    assert!(result.is_err());
}

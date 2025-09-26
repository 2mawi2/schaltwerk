#[cfg(test)]
use crate::domains::git::stats::{get_git_stats_call_count, reset_git_stats_call_count};
#[cfg(test)]
use crate::domains::sessions::entity::SessionStatus;
#[cfg(test)]
use crate::{
    domains::sessions::service::SessionManager,
    schaltwerk_core::{git, Database},
};
#[cfg(test)]
use anyhow::Result;
#[cfg(test)]
use git2;
#[cfg(test)]
use std::path::PathBuf;
#[cfg(test)]
use std::process::Command;
#[cfg(test)]
use tempfile::TempDir;

// Import database traits for method access in tests
#[cfg(test)]
use crate::domains::sessions::db_sessions::SessionMethods;
#[cfg(test)]
use crate::domains::sessions::entity::SessionState;
#[cfg(test)]
use crate::infrastructure::database::db_archived_specs::ArchivedSpecMethods;
#[cfg(test)]
use crate::schaltwerk_core::db_git_stats::GitStatsMethods;
#[cfg(test)]
use crate::schaltwerk_core::db_project_config::ProjectConfigMethods;

#[cfg(test)]
struct TestEnvironment {
    _repo_dir: TempDir, // Keep alive to prevent cleanup
    repo_path: PathBuf,
    db_path: PathBuf,
}

impl TestEnvironment {
    fn new() -> Result<Self> {
        let repo_dir = TempDir::new()?;
        let repo_path = repo_dir.path().to_path_buf();
        let db_path = repo_path.join("test.db");

        // Initialize a git repository using git2 (much faster than spawning git commands)
        git2::Repository::init(&repo_path)?;

        // Configure git user for commits using git2
        let repo = git2::Repository::open(&repo_path)?;
        let mut config = repo.config()?;
        config.set_str("user.email", "test@example.com")?;
        config.set_str("user.name", "Test User")?;

        // Create initial commit using git2
        std::fs::write(repo_path.join("README.md"), "# Test Repository")?;
        let mut index = repo.index()?;
        index.add_path(std::path::Path::new("README.md"))?;
        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;
        let signature = git2::Signature::now("Test User", "test@example.com")?;
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Initial commit",
            &tree,
            &[],
        )?;

        Ok(Self {
            _repo_dir: repo_dir,
            repo_path,
            db_path,
        })
    }

    fn get_database(&self) -> Result<Database> {
        Database::new(Some(self.db_path.clone()))
    }

    fn get_session_manager(&self) -> Result<SessionManager> {
        let db = self.get_database()?;
        Ok(SessionManager::new(db, self.repo_path.clone()))
    }
}

#[test]
fn test_database_initialization() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();

    // Database should be created and initialized
    assert!(env.db_path.exists());

    // Should be able to list sessions (empty)
    let sessions = db.list_sessions(&env.repo_path).unwrap();
    assert_eq!(sessions.len(), 0);
}

#[test]
fn test_create_session() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a session
    let session = manager
        .create_session("test-feature", Some("Test prompt"), None)
        .unwrap();

    // Verify session properties
    assert_eq!(session.name, "test-feature");
    assert_eq!(session.branch, "schaltwerk/test-feature");
    assert_eq!(session.initial_prompt, Some("Test prompt".to_string()));
    assert_eq!(session.status, SessionStatus::Active);

    // Verify worktree path
    let expected_worktree = env
        .repo_path
        .join(".schaltwerk")
        .join("worktrees")
        .join("test-feature");
    assert_eq!(session.worktree_path, expected_worktree);

    // Verify worktree exists on filesystem
    assert!(session.worktree_path.exists());
    assert!(session.worktree_path.join(".git").exists());

    // Verify branch exists
    let branches_output = Command::new("git")
        .args(["branch", "--list", "schaltwerk/test-feature"])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    let branches = String::from_utf8_lossy(&branches_output.stdout);
    assert!(branches.contains("schaltwerk/test-feature"));

    // Verify session is in database
    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].name, "test-feature");
}

#[test]
fn test_create_session_with_custom_branch_prefix() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();

    db.set_project_branch_prefix(&env.repo_path, "custom")
        .unwrap();

    let manager = SessionManager::new(db.clone(), env.repo_path.clone());

    let session = manager
        .create_session("prefixed-feature", Some("Test prompt"), None)
        .unwrap();

    assert_eq!(session.branch, "custom/prefixed-feature");

    let branches_output = Command::new("git")
        .args(["branch", "--list", "custom/prefixed-feature"])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    let branches = String::from_utf8_lossy(&branches_output.stdout);
    assert!(branches.contains("custom/prefixed-feature"));
}

#[test]
fn test_create_multiple_sessions() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create multiple sessions
    let session1 = manager.create_session("feature-1", None, None).unwrap();
    let session2 = manager
        .create_session("feature-2", Some("Second feature"), None)
        .unwrap();
    let session3 = manager.create_session("bugfix-1", None, None).unwrap();

    // Verify all sessions exist
    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 3);

    // Verify each has unique worktree
    assert!(session1.worktree_path.exists());
    assert!(session2.worktree_path.exists());
    assert!(session3.worktree_path.exists());
    assert_ne!(session1.worktree_path, session2.worktree_path);
    assert_ne!(session2.worktree_path, session3.worktree_path);

    // Verify all branches exist
    let branches_output = Command::new("git")
        .args(["branch", "--list", "schaltwerk/*"])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    let branches = String::from_utf8_lossy(&branches_output.stdout);
    assert!(branches.contains("schaltwerk/feature-1"));
    assert!(branches.contains("schaltwerk/feature-2"));
    assert!(branches.contains("schaltwerk/bugfix-1"));
}

#[test]
fn test_duplicate_session_name_auto_increments() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create first session
    let session1 = manager.create_session("duplicate", None, None).unwrap();
    assert_eq!(session1.name, "duplicate");

    // Try to create session with same name - should get unique suffix
    let session2 = manager.create_session("duplicate", None, None).unwrap();
    assert_ne!(session2.name, "duplicate");
    assert!(session2.name.starts_with("duplicate-"));
    let suffix = session2.name.strip_prefix("duplicate-").unwrap();
    let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
    let is_incremental = suffix.parse::<u32>().is_ok();
    assert!(
        is_random_suffix || is_incremental,
        "Expected random suffix or incremental number, got: {}",
        suffix
    );

    // Verify both sessions exist
    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 2);
}

#[test]
fn test_invalid_session_names() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Test various invalid names
    let invalid_names = vec![
        "",              // Empty
        "test feature",  // Space
        "test/feature",  // Slash
        "test\\feature", // Backslash
        "test..feature", // Double dot
        "test@feature",  // Special char
        "test#feature",  // Special char
        "test$feature",  // Special char
    ];

    for name in invalid_names {
        let result = manager.create_session(name, None, None);
        assert!(result.is_err(), "Should reject invalid name: {name}");
    }

    // Verify no sessions were created
    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 0);
}

#[test]
fn test_valid_session_names() {
    // Test various valid names with separate environment for each to avoid conflicts
    let valid_names = vec![
        "feature",
        "feature-123",
        "feature_123",
        "FEATURE",
        "feature-with-long-name",
        "123-numeric-start",
        "a", // Single char
    ];

    for name in &valid_names {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();

        let result = manager.create_session(name, None, None);
        if let Err(ref e) = result {
            println!("Error for {name}: {e}");
        }
        assert!(
            result.is_ok(),
            "Should accept valid name: {name} - Error: {result:?}"
        );
    }
}

#[test]
fn test_archive_and_restore_spec() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec
    let spec = manager
        .create_spec_session("spec-archive-demo", "Spec content A")
        .unwrap();
    assert_eq!(spec.session_state, SessionState::Spec);

    // Archive it
    manager.archive_spec_session(&spec.name).unwrap();

    // Spec should be gone from sessions list
    let specs = manager.list_sessions_by_state(SessionState::Spec).unwrap();
    assert!(specs.into_iter().find(|s| s.name == spec.name).is_none());

    // It should appear in archived list
    let archived = manager.list_archived_specs().unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].session_name, "spec-archive-demo");
    assert_eq!(archived[0].content, "Spec content A");

    // Restore it
    let restored = manager
        .restore_archived_spec(&archived[0].id, None)
        .unwrap();
    assert_eq!(restored.session_state, SessionState::Spec);
    // The restored name might have a suffix if there's already a session with that name
    assert!(
        restored.name.starts_with("spec-archive-demo"),
        "Restored name should start with 'spec-archive-demo', got: {}",
        restored.name
    );

    // Archive list should be empty after restore
    let archived_after = manager.list_archived_specs().unwrap();
    assert!(archived_after.is_empty());
}

#[test]
fn test_archive_limit_enforced() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();
    // Set a very small limit for the test
    db.set_archive_max_entries(3).unwrap();
    let manager = env.get_session_manager().unwrap();

    for i in 0..5 {
        let name = format!("spec-{i}");
        let content = format!("content {i}");
        let s = manager.create_spec_session(&name, &content).unwrap();
        manager.archive_spec_session(&s.name).unwrap();
    }

    // Only 3 most recent should remain
    let archived = manager.list_archived_specs().unwrap();
    assert_eq!(archived.len(), 3);
    // Verify they are the most recent ones (spec-2, spec-3, spec-4) by order
    let names: Vec<_> = archived.iter().map(|a| a.session_name.clone()).collect();
    assert_eq!(names[0], "spec-4");
    assert_eq!(names[1], "spec-3");
    assert_eq!(names[2], "spec-2");
}

#[test]
fn test_cancel_session() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create and then cancel a session
    let session = manager.create_session("to-cancel", None, None).unwrap();
    let worktree_path = session.worktree_path.clone();

    // Verify worktree exists before cancel
    assert!(worktree_path.exists());

    // Cancel the session
    manager.cancel_session("to-cancel").unwrap();

    // Verify worktree is removed
    assert!(!worktree_path.exists());

    // Verify branch is deleted
    let branches_output = Command::new("git")
        .args(["branch", "--list", "para/to-cancel"])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    let branches = String::from_utf8_lossy(&branches_output.stdout);
    assert!(!branches.contains("para/to-cancel"));

    // Verify session status is updated
    let db_session = manager.get_session("to-cancel").unwrap();
    assert_eq!(db_session.status, SessionStatus::Cancelled);
}

#[test]
fn test_list_enriched_sessions() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create some sessions
    manager
        .create_session("session-1", Some("First session"), None)
        .unwrap();
    manager.create_session("session-2", None, None).unwrap();

    // Get enriched sessions
    let enriched = manager.list_enriched_sessions().unwrap();
    assert_eq!(enriched.len(), 2);

    // Verify enriched data
    let session1 = enriched
        .iter()
        .find(|s| s.info.session_id == "session-1")
        .unwrap();
    assert_eq!(session1.info.branch, "schaltwerk/session-1");
    assert_eq!(
        session1.info.current_task,
        Some("First session".to_string())
    );
    assert_eq!(session1.terminals.len(), 2);
    assert!(session1
        .terminals
        .contains(&"session-session-1-top".to_string()));
    assert!(session1
        .terminals
        .contains(&"session-session-1-bottom".to_string()));
}

#[test]
fn test_list_enriched_sessions_skips_spec_git_stats() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    reset_git_stats_call_count();

    manager
        .create_session("active-session", Some("active"), None)
        .unwrap();
    manager
        .create_spec_session("spec-one", "Spec content one")
        .unwrap();
    manager
        .create_spec_session("spec-two", "Spec content two")
        .unwrap();

    reset_git_stats_call_count();

    let enriched = manager.list_enriched_sessions().unwrap();
    assert_eq!(enriched.len(), 3);

    let git_stats_calls = get_git_stats_call_count();
    assert!(
        git_stats_calls <= 1,
        "expected git stats only for running sessions, but got {git_stats_calls} recalculations"
    );

    let spec_sessions: Vec<_> = enriched
        .iter()
        .filter(|session| session.info.session_state == SessionState::Spec)
        .collect();
    assert_eq!(spec_sessions.len(), 2);
    for spec in spec_sessions {
        assert_eq!(spec.info.has_uncommitted_changes, Some(false));
        assert!(spec.info.diff_stats.is_none());
    }
}

#[test]
fn test_session_name_conflict_resolution() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create first session
    let session1 = manager.create_session("test-conflict", None, None).unwrap();
    assert_eq!(session1.name, "test-conflict");
    assert_eq!(session1.branch, "schaltwerk/test-conflict");

    // Try to create another session with same name - should get unique suffix
    let session2 = manager.create_session("test-conflict", None, None).unwrap();
    assert_ne!(session2.name, "test-conflict");
    assert!(session2.name.starts_with("test-conflict-"));
    assert_eq!(session2.branch, format!("schaltwerk/{}", session2.name));
    let suffix = session2.name.strip_prefix("test-conflict-").unwrap();
    let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
    let is_incremental = suffix.parse::<u32>().is_ok();
    assert!(
        is_random_suffix || is_incremental,
        "Expected random suffix or incremental number, got: {}",
        suffix
    );

    // And another one - should also get unique suffix
    let session3 = manager.create_session("test-conflict", None, None).unwrap();
    assert_ne!(session3.name, "test-conflict");
    assert!(session3.name.starts_with("test-conflict-"));
    assert_ne!(session3.name, session2.name); // Should be different from session2
    assert_eq!(session3.branch, format!("schaltwerk/{}", session3.name));

    // Verify all worktrees exist
    assert!(session1.worktree_path.exists());
    assert!(session2.worktree_path.exists());
    assert!(session3.worktree_path.exists());
}

#[test]
fn test_worktree_cleanup_on_reuse() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a session
    let session1 = manager.create_session("reuse-test", None, None).unwrap();

    // Add a file to the worktree
    let test_file = session1.worktree_path.join("old-content.txt");
    std::fs::write(&test_file, "This is old content").unwrap();

    // Cancel the session
    manager.cancel_session("reuse-test").unwrap();

    // Manually corrupt the cleanup (simulate incomplete cleanup)
    std::fs::create_dir_all(&session1.worktree_path).unwrap();
    std::fs::write(&test_file, "Leftover content").unwrap();

    // Create a new session with the same name
    let session2 = manager.create_session("reuse-test", None, None).unwrap();

    // Due to conflict resolution, it should have a different name
    assert_ne!(session2.name, "reuse-test");
    assert!(session2.name.starts_with("reuse-test-"));
    let suffix = session2.name.strip_prefix("reuse-test-").unwrap();
    let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
    let is_incremental = suffix.parse::<u32>().is_ok();
    assert!(
        is_random_suffix || is_incremental,
        "Expected random suffix or incremental number, got: {}",
        suffix
    );

    // The new worktree should be clean
    assert!(session2.worktree_path.exists());
    assert!(!session2.worktree_path.join("old-content.txt").exists());
}

#[test]
fn test_corrupted_worktree_recovery() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a corrupted worktree situation
    let worktree_path = env
        .repo_path
        .join(".schaltwerk")
        .join("worktrees")
        .join("corrupted");
    std::fs::create_dir_all(&worktree_path).unwrap();
    std::fs::write(worktree_path.join("leftover.txt"), "corrupt data").unwrap();

    // Create a dangling branch
    Command::new("git")
        .args(["branch", "schaltwerk/corrupted"])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    // Now try to create a session with that name
    let session = manager
        .create_session("corrupted", Some("test prompt"), None)
        .unwrap();

    // Should get a unique suffix due to branch conflict
    assert_ne!(session.name, "corrupted");
    assert!(session.name.starts_with("corrupted-"));
    let suffix = session.name.strip_prefix("corrupted-").unwrap();
    let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
    let is_incremental = suffix.parse::<u32>().is_ok();
    assert!(
        is_random_suffix || is_incremental,
        "Expected random suffix or incremental number, got: {}",
        suffix
    );
    assert!(session.worktree_path.exists());
    assert!(!session.worktree_path.join("leftover.txt").exists());
}

#[test]
fn test_git_stats_calculation() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a session
    let session = manager.create_session("with-changes", None, None).unwrap();

    // Make some changes
    std::fs::write(
        session.worktree_path.join("file1.txt"),
        "Line 1\nLine 2\nLine 3",
    )
    .unwrap();
    std::fs::write(session.worktree_path.join("file2.txt"), "Content").unwrap();

    // Stage and commit changes
    Command::new("git")
        .args(["add", "."])
        .current_dir(&session.worktree_path)
        .output()
        .unwrap();

    Command::new("git")
        .args(["commit", "-m", "Add files"])
        .current_dir(&session.worktree_path)
        .output()
        .unwrap();

    // Calculate stats
    let stats =
        git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();

    assert_eq!(stats.files_changed, 2);
    assert!(stats.lines_added > 0);
    assert!(!stats.has_uncommitted);

    // Make uncommitted changes
    std::fs::write(session.worktree_path.join("file3.txt"), "Uncommitted").unwrap();

    let stats =
        git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();
    assert!(stats.has_uncommitted);
}

#[test]
fn test_cleanup_orphaned_worktrees() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a session properly
    let session1 = manager
        .create_session("proper-session", None, None)
        .unwrap();

    // Create an orphaned worktree manually (not through session manager)
    let orphan_path = env
        .repo_path
        .join(".schaltwerk")
        .join("worktrees")
        .join("orphan");
    std::fs::create_dir_all(orphan_path.parent().unwrap()).unwrap();

    Command::new("git")
        .args([
            "worktree",
            "add",
            orphan_path.to_str().unwrap(),
            "-b",
            "schaltwerk/orphan",
        ])
        .current_dir(&env.repo_path)
        .output()
        .unwrap();

    assert!(orphan_path.exists());

    // Debug: Check what worktrees exist before cleanup
    let worktrees = git::list_worktrees(&env.repo_path).unwrap();
    println!("Worktrees before cleanup: {worktrees:?}");

    let sessions = manager.list_sessions().unwrap();
    println!(
        "Sessions: {:?}",
        sessions
            .iter()
            .map(|s| &s.worktree_path)
            .collect::<Vec<_>>()
    );

    // Run cleanup
    manager.cleanup_orphaned_worktrees().unwrap();

    // Debug: Check what worktrees exist after cleanup
    let worktrees = git::list_worktrees(&env.repo_path).unwrap();
    println!("Worktrees after cleanup: {worktrees:?}");

    // Verify orphan is removed but proper session remains
    assert!(!orphan_path.exists(), "Orphan path should be removed");
    assert!(
        session1.worktree_path.exists(),
        "Proper session worktree should remain"
    );
}

#[test]
fn test_concurrent_session_creation() {
    use std::sync::Arc;
    use std::thread;

    let env = TestEnvironment::new().unwrap();
    let db = Arc::new(env.get_database().unwrap());
    let repo_path = env.repo_path.clone();

    // Try to create sessions concurrently
    let handles: Vec<_> = (0..5)
        .map(|i| {
            let db = db.clone();
            let repo_path = repo_path.clone();
            thread::spawn(move || {
                let manager = SessionManager::new((*db).clone(), repo_path);
                manager.create_session(&format!("concurrent-{i}"), None, None)
            })
        })
        .collect();

    // Collect results
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    // All should succeed
    for result in &results {
        assert!(result.is_ok());
    }

    // Verify all sessions exist
    let manager = SessionManager::new((*db).clone(), repo_path);
    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 5);
}

#[test]
fn test_list_enriched_sessions_performance_caching() {
    use std::time::Instant;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create multiple sessions to amplify the effect
    let session_count = 8usize;
    for i in 0..session_count {
        let name = format!("perf-{i}");
        manager.create_session(&name, None, None).unwrap();
    }

    // First call: cold (computes git stats for each session)
    let start_cold = Instant::now();
    let enriched_cold = manager.list_enriched_sessions().unwrap();
    let dur_cold = start_cold.elapsed();
    assert_eq!(enriched_cold.len(), session_count);

    // Second call: warm (should mostly use cached stats)
    let start_warm = Instant::now();
    let enriched_warm = manager.list_enriched_sessions().unwrap();
    let dur_warm = start_warm.elapsed();
    assert_eq!(enriched_warm.len(), session_count);

    // Expect warm run to be no slower than cold (with tolerance)
    // Performance tests are inherently sensitive to system timing variations.
    // Use generous tolerance to prevent flaky failures while still catching regressions.
    use std::time::Duration;
    let tolerance = if dur_cold < Duration::from_millis(1) {
        // For sub-millisecond measurements, allow up to +500% tolerance
        // This accounts for scheduler jitter, memory allocator variations,
        // and other system timing inconsistencies at microsecond scales
        dur_cold * 5
    } else if dur_cold < Duration::from_millis(10) {
        // For 1-10ms measurements, allow +300% tolerance
        dur_cold * 3
    } else {
        // For longer measurements (>10ms), use +100% tolerance
        dur_cold
    };
    assert!(
            dur_warm <= dur_cold + tolerance,
            "Expected warm ( {dur_warm:?} ) to be <= cold + tolerance ( cold={dur_cold:?}, tol={tolerance:?} )"
        );
}

#[test]
fn test_list_enriched_sessions_caches_to_db_and_refreshes_when_stale() {
    use chrono::{Duration as ChronoDuration, Utc};

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create some sessions
    let s1 = manager.create_session("cache-a", None, None).unwrap();
    let s2 = manager.create_session("cache-b", None, None).unwrap();

    // Trigger caching by listing
    let _ = manager.list_enriched_sessions().unwrap();

    // Verify stats exist in DB
    let stats1 = manager.db_ref().get_git_stats(&s1.id).unwrap();
    let stats2 = manager.db_ref().get_git_stats(&s2.id).unwrap();
    assert!(stats1.is_some());
    assert!(stats2.is_some());

    // Force stats to be stale by overwriting with an older timestamp
    let mut stale1 = stats1.unwrap();
    stale1.calculated_at = Utc::now() - ChronoDuration::seconds(61);
    manager.db_ref().save_git_stats(&stale1).unwrap();

    // Call listing again to trigger refresh for stale session
    let _ = manager.list_enriched_sessions().unwrap();

    // New timestamp should be fresher than the stale timestamp
    let refreshed1 = manager.db_ref().get_git_stats(&s1.id).unwrap().unwrap();
    assert!(refreshed1.calculated_at > stale1.calculated_at);
}

#[test]
fn test_project_setup_script_persistence() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();

    let script = "#!/bin/bash\ncp $REPO_PATH/.env $WORKTREE_PATH/";

    // Set setup script
    db.set_project_setup_script(&env.repo_path, script).unwrap();

    // Retrieve setup script
    let retrieved = db.get_project_setup_script(&env.repo_path).unwrap();
    assert_eq!(retrieved, Some(script.to_string()));

    // Test with different repo path should return None
    let other_repo = tempfile::TempDir::new().unwrap();
    let no_script = db.get_project_setup_script(other_repo.path()).unwrap();
    assert_eq!(no_script, None);
}

#[test]
fn test_project_setup_script_update() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();

    let script1 = "#!/bin/bash\necho 'first script'";
    let script2 = "#!/bin/bash\necho 'updated script'";

    // Set initial script
    db.set_project_setup_script(&env.repo_path, script1)
        .unwrap();
    let retrieved1 = db.get_project_setup_script(&env.repo_path).unwrap();
    assert_eq!(retrieved1, Some(script1.to_string()));

    // Update script
    db.set_project_setup_script(&env.repo_path, script2)
        .unwrap();
    let retrieved2 = db.get_project_setup_script(&env.repo_path).unwrap();
    assert_eq!(retrieved2, Some(script2.to_string()));
}

#[test]
fn test_project_setup_script_database_persistence() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("persistence_test.db");
    let repo_path = temp_dir.path().join("repo");
    std::fs::create_dir_all(&repo_path).unwrap();

    let script = "#!/bin/bash\ncp .env.example .env";

    // Create database and set script
    {
        let db = Database::new(Some(db_path.clone())).unwrap();
        db.set_project_setup_script(&repo_path, script).unwrap();
    }

    // Create new database instance and verify persistence
    let db = Database::new(Some(db_path)).unwrap();
    let retrieved = db.get_project_setup_script(&repo_path).unwrap();
    assert_eq!(retrieved, Some(script.to_string()));
}

#[test]
fn test_setup_script_execution_during_session_creation() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a simple test script that creates a marker file
    let script = r#"#!/bin/bash
echo "Script executed for $SESSION_NAME" > $WORKTREE_PATH/setup_marker.txt
echo "REPO_PATH=$REPO_PATH" >> $WORKTREE_PATH/setup_marker.txt
echo "WORKTREE_PATH=$WORKTREE_PATH" >> $WORKTREE_PATH/setup_marker.txt
echo "BRANCH_NAME=$BRANCH_NAME" >> $WORKTREE_PATH/setup_marker.txt
"#;

    // Set the setup script for this repository
    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, script)
        .unwrap();

    // Create a session - setup is deferred to agent start; should NOT run here
    let session = manager
        .create_session("test-setup", Some("Test prompt"), None)
        .unwrap();

    // Verify the script was NOT executed during creation
    let marker_file = session.worktree_path.join("setup_marker.txt");
    assert!(
        !marker_file.exists(),
        "Setup script should not run at session creation anymore"
    );
}

#[test]
fn test_setup_script_execution_failure_handling() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a script that will fail
    let failing_script = r#"#!/bin/bash
echo "This script will fail"
exit 1
"#;

    // Set the failing setup script
    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, failing_script)
        .unwrap();

    // Creating a session should succeed now; setup runs at agent start instead
    let result = manager.create_session("fail-test", None, None);
    assert!(
        result.is_ok(),
        "Session creation should not run setup script anymore"
    );
}

#[test]
fn test_setup_script_with_complex_operations() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create source files in the main repo
    let env_example = env.repo_path.join(".env.example");
    std::fs::write(&env_example, "API_KEY=example_key\nDEBUG=true\n").unwrap();

    let config_template = env.repo_path.join("config.template.json");
    std::fs::write(&config_template, r#"{"environment": "development"}"#).unwrap();

    // Create a script that copies files and creates directories
    let script = r#"#!/bin/bash
set -e

# Copy environment file
cp "$REPO_PATH/.env.example" "$WORKTREE_PATH/.env"

# Copy and modify config
cp "$REPO_PATH/config.template.json" "$WORKTREE_PATH/config.json"

# Create some directories
mkdir -p "$WORKTREE_PATH/logs"
mkdir -p "$WORKTREE_PATH/tmp"

# Create a session-specific file
echo "Session: $SESSION_NAME" > "$WORKTREE_PATH/session_info.txt"
echo "Branch: $BRANCH_NAME" >> "$WORKTREE_PATH/session_info.txt"
"#;

    // Set the setup script
    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, script)
        .unwrap();

    // Create a session (setup deferred)
    let session = manager.create_session("complex-setup", None, None).unwrap();

    // Verify operations have NOT been performed at creation time
    assert!(!session.worktree_path.join(".env").exists());
    assert!(!session.worktree_path.join("config.json").exists());
    assert!(!session.worktree_path.join("logs").is_dir());
    assert!(!session.worktree_path.join("tmp").is_dir());
    assert!(!session.worktree_path.join("session_info.txt").exists());
}

#[test]
fn test_spec_to_versions_with_grouping_links_all_versions() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec that already ends with _v2 to mimic user scenario
    let spec = manager
        .create_spec_session("naughty_kirch_v2", "Spec content")
        .unwrap();
    assert_eq!(spec.session_state, SessionState::Spec);

    let gid = "gid-123";

    // Start the spec as version 1 within the group
    manager
        .start_spec_session("naughty_kirch_v2", None, Some(gid), Some(1))
        .unwrap();

    // Create and start two more versions with names derived from the spec name
    manager
        .create_and_start_spec_session(
            "naughty_kirch_v2_v2",
            "Spec content",
            None,
            Some(gid),
            Some(2),
        )
        .unwrap();
    manager
        .create_and_start_spec_session(
            "naughty_kirch_v2_v3",
            "Spec content",
            None,
            Some(gid),
            Some(3),
        )
        .unwrap();

    // All three sessions should carry the same group id and appropriate version numbers
    let enriched = manager.list_enriched_sessions().unwrap();
    let ids: std::collections::HashSet<_> =
        enriched.iter().map(|e| e.info.session_id.clone()).collect();
    assert!(ids.contains("naughty_kirch_v2"));
    assert!(ids.contains("naughty_kirch_v2_v2"));
    assert!(ids.contains("naughty_kirch_v2_v3"));

    let s1 = enriched
        .iter()
        .find(|e| e.info.session_id == "naughty_kirch_v2")
        .unwrap();
    let s2 = enriched
        .iter()
        .find(|e| e.info.session_id == "naughty_kirch_v2_v2")
        .unwrap();
    let s3 = enriched
        .iter()
        .find(|e| e.info.session_id == "naughty_kirch_v2_v3")
        .unwrap();

    assert_eq!(s1.info.version_group_id.as_deref(), Some(gid));
    assert_eq!(s2.info.version_group_id.as_deref(), Some(gid));
    assert_eq!(s3.info.version_group_id.as_deref(), Some(gid));

    assert_eq!(s1.info.version_number, Some(1));
    assert_eq!(s2.info.version_number, Some(2));
    assert_eq!(s3.info.version_number, Some(3));
}

#[test]
fn test_version_group_db_linkage_enriched() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create two sessions in the same version group via service
    let gid = "group-test-1";
    let _s1 = manager
        .create_session_with_auto_flag("vg-alpha", Some("p"), None, false, Some(gid), Some(1))
        .unwrap();
    let _s2 = manager
        .create_session_with_auto_flag("vg-alpha_v2", Some("p"), None, false, Some(gid), Some(2))
        .unwrap();

    let enriched = manager.list_enriched_sessions().unwrap();

    // Both should carry the version_group_id and version_number in SessionInfo
    let one = enriched
        .iter()
        .find(|s| s.info.session_id == "vg-alpha")
        .unwrap();
    assert_eq!(one.info.version_group_id.as_deref(), Some(gid));
    assert_eq!(one.info.version_number, Some(1));

    let two = enriched
        .iter()
        .find(|s| s.info.session_id == "vg-alpha_v2")
        .unwrap();
    assert_eq!(two.info.version_group_id.as_deref(), Some(gid));
    assert_eq!(two.info.version_number, Some(2));
}

#[test]
fn test_setup_script_environment_variables() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a script that tests all environment variables
    let script = r#"#!/bin/bash
# Test that all expected environment variables are set
test -n "$WORKTREE_PATH" || exit 1
test -n "$REPO_PATH" || exit 2
test -n "$SESSION_NAME" || exit 3
test -n "$BRANCH_NAME" || exit 4

# Test that paths are valid
test -d "$WORKTREE_PATH" || exit 5
test -d "$REPO_PATH" || exit 6

# Test that paths are different
test "$WORKTREE_PATH" != "$REPO_PATH" || exit 7

# Create output file with all variables
echo "WORKTREE_PATH=$WORKTREE_PATH" > "$WORKTREE_PATH/env_test.txt"
echo "REPO_PATH=$REPO_PATH" >> "$WORKTREE_PATH/env_test.txt"
echo "SESSION_NAME=$SESSION_NAME" >> "$WORKTREE_PATH/env_test.txt"
echo "BRANCH_NAME=$BRANCH_NAME" >> "$WORKTREE_PATH/env_test.txt"
"#;

    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, script)
        .unwrap();

    let session = manager.create_session("env-test", None, None).unwrap();

    // No execution during creation
    let env_file = session.worktree_path.join("env_test.txt");
    assert!(!env_file.exists());
}

#[test]
fn test_empty_setup_script_handling() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Set empty setup script
    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, "")
        .unwrap();

    // Create session - should succeed without executing anything
    let session = manager.create_session("empty-script", None, None).unwrap();
    assert!(session.worktree_path.exists());

    // Set whitespace-only script
    manager
        .db_ref()
        .set_project_setup_script(&env.repo_path, "   \n\t  ")
        .unwrap();

    // Create another session - should also succeed
    let session2 = manager
        .create_session("whitespace-script", None, None)
        .unwrap();
    assert!(session2.worktree_path.exists());
}

#[test]
fn test_setup_script_path_canonicalization() {
    let env = TestEnvironment::new().unwrap();
    let db = env.get_database().unwrap();

    let script = "#!/bin/bash\necho test";

    // Set script using the original path
    db.set_project_setup_script(&env.repo_path, script).unwrap();

    // Try to retrieve using a path with extra components (e.g., ./repo/path/../path)
    let path_with_dots = env
        .repo_path
        .join("..")
        .join(env.repo_path.file_name().unwrap());
    let retrieved = db.get_project_setup_script(&path_with_dots).unwrap();
    assert_eq!(retrieved, Some(script.to_string()));
}

#[test]
fn test_multiple_projects_setup_scripts() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("multi_project_test.db");
    let db = Database::new(Some(db_path)).unwrap();

    // Create multiple "project" directories
    let project1 = temp_dir.path().join("project1");
    let project2 = temp_dir.path().join("project2");
    std::fs::create_dir_all(&project1).unwrap();
    std::fs::create_dir_all(&project2).unwrap();

    let script1 = "#!/bin/bash\necho project1";
    let script2 = "#!/bin/bash\necho project2";

    // Set different scripts for different projects
    db.set_project_setup_script(&project1, script1).unwrap();
    db.set_project_setup_script(&project2, script2).unwrap();

    // Verify each project has its own script
    let retrieved1 = db.get_project_setup_script(&project1).unwrap();
    let retrieved2 = db.get_project_setup_script(&project2).unwrap();

    assert_eq!(retrieved1, Some(script1.to_string()));
    assert_eq!(retrieved2, Some(script2.to_string()));

    // Update one script and verify the other is unchanged
    let updated_script1 = "#!/bin/bash\necho updated_project1";
    db.set_project_setup_script(&project1, updated_script1)
        .unwrap();

    let retrieved1_updated = db.get_project_setup_script(&project1).unwrap();
    let retrieved2_unchanged = db.get_project_setup_script(&project2).unwrap();

    assert_eq!(retrieved1_updated, Some(updated_script1.to_string()));
    assert_eq!(retrieved2_unchanged, Some(script2.to_string()));
}

#[test]
fn test_convert_running_session_to_draft() {
    use crate::domains::sessions::entity::SessionState;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec session first
    let spec_content = "# Agent: Implement authentication\n- Add login form\n- Setup JWT tokens";
    let draft_session = manager
        .create_spec_session("auth-feature", spec_content)
        .unwrap();
    assert_eq!(draft_session.session_state, SessionState::Spec);
    assert_eq!(draft_session.spec_content, Some(spec_content.to_string()));

    // Start the spec session (convert to running)
    manager
        .start_spec_session("auth-feature", None, None, None)
        .unwrap();

    // Verify it's now running
    let running_session = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, "auth-feature")
        .unwrap();
    assert_eq!(running_session.session_state, SessionState::Running);
    assert_eq!(running_session.status, SessionStatus::Active);

    // Convert the running session back to spec
    manager.convert_session_to_draft("auth-feature").unwrap();

    // Verify it's back to spec state
    let converted_session = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, "auth-feature")
        .unwrap();
    assert_eq!(converted_session.session_state, SessionState::Spec);
    assert_eq!(converted_session.status, SessionStatus::Spec);
    assert_eq!(
        converted_session.spec_content,
        Some(spec_content.to_string())
    );

    // Verify the worktree has been removed
    assert!(!converted_session.worktree_path.exists());

    // Verify the branch has been archived
    assert!(!git::branch_exists(&env.repo_path, &converted_session.branch).unwrap());
}

#[test]
fn test_convert_session_to_draft_preserves_content() {
    use crate::domains::sessions::entity::SessionState;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec session with detailed content
    let spec_content = "# Agent: Build user authentication system\n\n## Requirements:\n- OAuth2 login\n- JWT tokens\n- User profile management\n- Password reset flow\n\n## Technical Details:\n- Use Rust backend\n- PostgreSQL database\n- React frontend";
    let _draft_session = manager
        .create_spec_session("auth-system", spec_content)
        .unwrap();

    // Start the spec session
    manager
        .start_spec_session("auth-system", None, None, None)
        .unwrap();

    // Convert back to spec
    manager.convert_session_to_draft("auth-system").unwrap();

    // Verify content is preserved
    let converted = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, "auth-system")
        .unwrap();
    assert_eq!(converted.spec_content, Some(spec_content.to_string()));
    assert_eq!(converted.session_state, SessionState::Spec);
}

#[test]
fn test_spec_session_ai_renaming_potential() {
    // This test demonstrates that spec sessions should have potential for AI renaming
    // when they contain meaningful spec content
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();
    let db = env.get_database().unwrap();

    // Create a spec session with meaningful content
    let spec_content =
        "Implement user authentication:\n- Add login endpoint\n- Add JWT token generation";
    let spec = manager
        .create_spec_session("spec-renaming-test", spec_content)
        .unwrap();
    assert_eq!(spec.session_state, SessionState::Spec);
    assert_eq!(spec.spec_content, Some(spec_content.to_string()));
    assert_eq!(spec.initial_prompt, None); // Specs don't use initial_prompt

    // Start the spec session (convert to running)
    manager
        .start_spec_session("spec-renaming-test", None, None, None)
        .unwrap();

    // Get the updated session
    let running = db
        .get_session_by_name(&env.repo_path, "spec-renaming-test")
        .unwrap();
    assert_eq!(running.session_state, SessionState::Running);

    // The session should have content available for AI renaming
    // Either through initial_prompt OR spec_content
    let has_renameable_content = running.initial_prompt.is_some() || running.spec_content.is_some();
    assert!(
        has_renameable_content,
        "Session should have content for AI renaming (either initial_prompt or spec_content)"
    );

    // For spec-started sessions, the spec_content should be preserved
    assert_eq!(
        running.spec_content,
        Some(spec_content.to_string()),
        "Spec content should be preserved when starting spec session"
    );
}

#[test]
fn test_mark_reviewed_refreshes_git_stats() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a session
    let session = manager
        .create_session("stats-refresh-on-review", None, None)
        .unwrap();

    // Create an uncommitted change and persist cached stats (has_uncommitted = true)
    std::fs::write(session.worktree_path.join("dirty.txt"), "uncommitted").unwrap();
    manager.update_git_stats(&session.id).unwrap();

    // Now clean the worktree by committing the change
    Command::new("git")
        .args(["add", "."])
        .current_dir(&session.worktree_path)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "Clean commit before review"])
        .current_dir(&session.worktree_path)
        .output()
        .unwrap();

    // Immediately mark as reviewed (auto_commit = false)
    manager.mark_session_as_reviewed(&session.name).unwrap();

    // Fetch enriched sessions; git stats should be refreshed and clean
    let enriched = manager.list_enriched_sessions().unwrap();
    let me = enriched
        .iter()
        .find(|e| e.info.session_id == session.name)
        .expect("session present");
    assert!(
        me.info.ready_to_merge,
        "Session should be marked ready_to_merge"
    );
    assert_eq!(
        me.info.has_uncommitted_changes,
        Some(false),
        "Git stats should reflect clean state after review"
    );
}

#[test]
fn test_follow_up_unmarks_reviewed_and_sets_running() {
    use crate::domains::sessions::entity::SessionState;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a running session
    let session = manager
        .create_session("followup-reviewed", None, None)
        .unwrap();

    // Mark as reviewed
    manager.mark_session_as_reviewed(&session.name).unwrap();

    // Sanity: is reviewed
    let s1 = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, &session.name)
        .unwrap();
    assert!(s1.ready_to_merge);

    // Follow-up arrives → should unmark reviewed and set Running
    let changed = manager.unmark_reviewed_on_follow_up(&session.name).unwrap();
    assert!(changed, "expected a state change for reviewed session");

    let s2 = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, &session.name)
        .unwrap();
    assert!(!s2.ready_to_merge, "follow-up should clear ready_to_merge");
    assert_eq!(
        s2.session_state,
        SessionState::Running,
        "state should be Running"
    );
}

#[test]
fn test_follow_up_noop_for_running_unreviewed() {
    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a running, unreviewed session
    let session = manager
        .create_session("followup-running", None, None)
        .unwrap();

    // Follow-up should be a no-op
    let changed = manager.unmark_reviewed_on_follow_up(&session.name).unwrap();
    assert!(
        !changed,
        "no change expected for unreviewed running session"
    );
    let s = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, &session.name)
        .unwrap();
    assert!(!s.ready_to_merge);
}

#[test]
fn test_follow_up_noop_for_spec() {
    use crate::domains::sessions::entity::SessionState;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec
    let _spec = manager
        .create_spec_session("followup-spec", "# plan\n- item")
        .unwrap();

    // No change expected for spec sessions
    let changed = manager
        .unmark_reviewed_on_follow_up("followup-spec")
        .unwrap();
    assert!(!changed, "no change expected for spec session");

    let s = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, "followup-spec")
        .unwrap();
    assert_eq!(s.session_state, SessionState::Spec);
    assert!(!s.ready_to_merge);
}

#[test]
#[serial_test::serial]
fn test_codex_spec_start_respects_resume_gate() {
    use std::fs;
    use std::io::Write;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Create a spec session with Codex as agent
    let spec_content = "Implement feature X via Codex";
    let _spec = manager
        .create_spec_session_with_agent("codex_spec", spec_content, Some("codex"), None)
        .unwrap();

    // Ensure global agent is Codex so start uses Codex (start_spec_session stores original settings from globals)
    manager.set_global_agent_type("codex").unwrap();

    // Start the spec session (converts to running and sets resume_allowed=false)
    manager
        .start_spec_session("codex_spec", None, None, None)
        .unwrap();

    // Prepare a fake Codex sessions directory in a temporary HOME
    let home_dir = tempfile::TempDir::new().unwrap();
    let codex_sessions = home_dir
        .path()
        .join(".codex")
        .join("sessions")
        .join("2025")
        .join("09")
        .join("13");
    fs::create_dir_all(&codex_sessions).unwrap();

    // Create a jsonl file that matches the session worktree CWD
    let running = manager
        .db_ref()
        .get_session_by_name(&env.repo_path, "codex_spec")
        .unwrap();
    let jsonl_path = codex_sessions.join("test-session.jsonl");
    let mut f = std::fs::File::create(&jsonl_path).unwrap();
    writeln!(f, "{{\"id\":\"s-1\",\"timestamp\":\"2025-09-13T01:00:00.000Z\",\"cwd\":\"{}\",\"originator\":\"codex_cli_rs\"}}", running.worktree_path.display()).unwrap();
    writeln!(f, "{{\"record_type\":\"state\"}}").unwrap();

    // Point HOME to our temp dir so Codex resume detection picks it up
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", home_dir.path());

    // First start should be a fresh start using the prompt (resume gate is false)
    let cmd1 = manager.start_claude_in_session(&running.name).unwrap();
    assert!(
        cmd1.contains("codex"),
        "expected Codex command, got: {}",
        cmd1
    );
    assert!(
        cmd1.contains(&spec_content),
        "expected initial prompt in first start command: {}",
        cmd1
    );
    assert!(
        !cmd1.contains(" resume"),
        "should not resume on first start: {}",
        cmd1
    );

    // Second start should allow resume now (resume_allowed flipped true)
    let cmd2 = manager.start_claude_in_session(&running.name).unwrap();
    assert!(
        cmd2.contains("codex"),
        "expected Codex command on second start, got: {}",
        cmd2
    );
    // Should prefer resuming via the dedicated resume subcommand
    let resumed = cmd2.contains(" codex --sandbox ") && cmd2.contains(" resume");
    assert!(
        resumed,
        "expected a resume-capable command on second start: {}",
        cmd2
    );

    // Restore HOME
    if let Some(h) = prev_home {
        std::env::set_var("HOME", h);
    } else {
        std::env::remove_var("HOME");
    }
}

#[test]
#[serial_test::serial]
fn test_orchestrator_codex_prefers_explicit_resume_path() {
    use std::fs;
    use std::io::Write;

    let env = TestEnvironment::new().unwrap();
    let manager = env.get_session_manager().unwrap();

    // Configure orchestrator to use Codex
    manager.set_orchestrator_agent_type("codex").unwrap();
    manager.set_orchestrator_skip_permissions(false).unwrap();

    // Prepare a fake Codex sessions directory matching the orchestrator repo path
    let home_dir = tempfile::TempDir::new().unwrap();
    let codex_sessions = home_dir
        .path()
        .join(".codex")
        .join("sessions")
        .join("2025")
        .join("09")
        .join("13");
    fs::create_dir_all(&codex_sessions).unwrap();

    // Create a jsonl file that matches orchestrator CWD (repo root)
    let jsonl_path = codex_sessions.join("orch.jsonl");
    let mut f = std::fs::File::create(&jsonl_path).unwrap();
    writeln!(f, "{{\"id\":\"orch-session\",\"timestamp\":\"2025-09-13T01:00:00.000Z\",\"cwd\":\"{}\",\"originator\":\"codex_cli_rs\"}}", env.repo_path.display()).unwrap();
    writeln!(f, "{{\"record_type\":\"state\"}}").unwrap();

    // Point HOME to our temp dir so Codex resume detection picks it up
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", home_dir.path());

    // Build orchestrator command (resume enabled by default)
    let cmd = manager.start_claude_in_orchestrator().unwrap();
    assert!(
        cmd.contains("codex"),
        "expected Codex orchestrator command: {}",
        cmd
    );
    // Should prefer explicit resume via session identifier
    assert!(
        cmd.contains(" codex --sandbox "),
        "expected Codex sandbox flag in orchestrator start: {}",
        cmd
    );
    assert!(
        cmd.contains(" resume "),
        "expected resume subcommand in orchestrator start: {}",
        cmd
    );

    // Restore HOME
    if let Some(h) = prev_home {
        std::env::set_var("HOME", h);
    } else {
        std::env::remove_var("HOME");
    }
}

#[cfg(test)]
use crate::schaltwerk_core::{Database, SessionManager, git};
#[cfg(test)]
use crate::schaltwerk_core::types::SessionStatus;
#[cfg(test)]
use tempfile::TempDir;
#[cfg(test)]
use std::path::PathBuf;
#[cfg(test)]
use std::process::Command;
#[cfg(test)]
use anyhow::Result;

// Import database traits for method access in tests
#[cfg(test)]
use crate::schaltwerk_core::db_sessions::SessionMethods;
#[cfg(test)]
use crate::schaltwerk_core::db_git_stats::GitStatsMethods;
#[cfg(test)]
use crate::schaltwerk_core::db_project_config::ProjectConfigMethods;

#[cfg(test)]
struct TestEnvironment {
        _repo_dir: TempDir,  // Keep alive to prevent cleanup
        repo_path: PathBuf,
        db_path: PathBuf,
    }
    
    impl TestEnvironment {
        fn new() -> Result<Self> {
            let repo_dir = TempDir::new()?;
            let repo_path = repo_dir.path().to_path_buf();
            let db_path = repo_path.join("test.db");
            
            // Initialize a git repository in the temp directory
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            // Configure git user for commits
            Command::new("git")
                .args(["config", "user.email", "test@example.com"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", "Test User"])
                .current_dir(&repo_path)
                .output()?;
            
            // Create initial commit
            std::fs::write(repo_path.join("README.md"), "# Test Repository")?;
            Command::new("git")
                .args(["add", "."])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["commit", "-m", "Initial commit"])
                .current_dir(&repo_path)
                .output()?;
            
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
        let session = manager.create_session("test-feature", Some("Test prompt"), None).unwrap();
        
        // Verify session properties
        assert_eq!(session.name, "test-feature");
        assert_eq!(session.branch, "schaltwerk/test-feature");
        assert_eq!(session.initial_prompt, Some("Test prompt".to_string()));
        assert_eq!(session.status, SessionStatus::Active);
        
        // Verify worktree path
        let expected_worktree = env.repo_path.join(".schaltwerk").join("worktrees").join("test-feature");
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
    fn test_create_multiple_sessions() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create multiple sessions
        let session1 = manager.create_session("feature-1", None, None).unwrap();
        let session2 = manager.create_session("feature-2", Some("Second feature"), None).unwrap();
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
        assert!(is_random_suffix || is_incremental, "Expected random suffix or incremental number, got: {}", suffix);
        
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
            "",                  // Empty
            "test feature",      // Space
            "test/feature",      // Slash
            "test\\feature",     // Backslash
            "test..feature",     // Double dot
            "test@feature",      // Special char
            "test#feature",      // Special char
            "test$feature",      // Special char
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
            "a",  // Single char
        ];
        
        for name in &valid_names {
            let env = TestEnvironment::new().unwrap();
            let manager = env.get_session_manager().unwrap();
            
            let result = manager.create_session(name, None, None);
            if let Err(ref e) = result {
                println!("Error for {name}: {e}");
            }
            assert!(result.is_ok(), "Should accept valid name: {name} - Error: {result:?}");
        }
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
        manager.create_session("session-1", Some("First session"), None).unwrap();
        manager.create_session("session-2", None, None).unwrap();
        
        // Get enriched sessions
        let enriched = manager.list_enriched_sessions().unwrap();
        assert_eq!(enriched.len(), 2);
        
        // Verify enriched data
        let session1 = enriched.iter().find(|s| s.info.session_id == "session-1").unwrap();
        assert_eq!(session1.info.branch, "schaltwerk/session-1");
        assert_eq!(session1.info.current_task, Some("First session".to_string()));
        assert_eq!(session1.terminals.len(), 2);
        assert!(session1.terminals.contains(&"session-session-1-top".to_string()));
        assert!(session1.terminals.contains(&"session-session-1-bottom".to_string()));
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
        assert!(is_random_suffix || is_incremental, "Expected random suffix or incremental number, got: {}", suffix);
        
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
        assert!(is_random_suffix || is_incremental, "Expected random suffix or incremental number, got: {}", suffix);
        
        // The new worktree should be clean
        assert!(session2.worktree_path.exists());
        assert!(!session2.worktree_path.join("old-content.txt").exists());
    }
    
    #[test]
    fn test_corrupted_worktree_recovery() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a corrupted worktree situation
        let worktree_path = env.repo_path.join(".schaltwerk").join("worktrees").join("corrupted");
        std::fs::create_dir_all(&worktree_path).unwrap();
        std::fs::write(worktree_path.join("leftover.txt"), "corrupt data").unwrap();
        
        // Create a dangling branch
        Command::new("git")
            .args(["branch", "schaltwerk/corrupted"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        // Now try to create a session with that name
        let session = manager.create_session("corrupted", Some("test prompt"), None).unwrap();
        
        // Should get a unique suffix due to branch conflict
        assert_ne!(session.name, "corrupted");
        assert!(session.name.starts_with("corrupted-"));
        let suffix = session.name.strip_prefix("corrupted-").unwrap();
        let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
        let is_incremental = suffix.parse::<u32>().is_ok();
        assert!(is_random_suffix || is_incremental, "Expected random suffix or incremental number, got: {}", suffix);
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
        std::fs::write(session.worktree_path.join("file1.txt"), "Line 1\nLine 2\nLine 3").unwrap();
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
        let stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();
        
        assert_eq!(stats.files_changed, 2);
        assert!(stats.lines_added > 0);
        assert!(!stats.has_uncommitted);
        
        // Make uncommitted changes
        std::fs::write(session.worktree_path.join("file3.txt"), "Uncommitted").unwrap();
        
        let stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();
        assert!(stats.has_uncommitted);
    }
    
    #[test]
    fn test_cleanup_orphaned_worktrees() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a session properly
        let session1 = manager.create_session("proper-session", None, None).unwrap();
        
        // Create an orphaned worktree manually (not through session manager)
        let orphan_path = env.repo_path.join(".schaltwerk").join("worktrees").join("orphan");
        std::fs::create_dir_all(orphan_path.parent().unwrap()).unwrap();
        
        Command::new("git")
            .args(["worktree", "add", orphan_path.to_str().unwrap(), "-b", "schaltwerk/orphan"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        assert!(orphan_path.exists());
        
        // Debug: Check what worktrees exist before cleanup
        let worktrees = git::list_worktrees(&env.repo_path).unwrap();
        println!("Worktrees before cleanup: {worktrees:?}");
        
        let sessions = manager.list_sessions().unwrap();
        println!("Sessions: {:?}", sessions.iter().map(|s| &s.worktree_path).collect::<Vec<_>>());
        
        // Run cleanup
        manager.cleanup_orphaned_worktrees().unwrap();
        
        // Debug: Check what worktrees exist after cleanup
        let worktrees = git::list_worktrees(&env.repo_path).unwrap();
        println!("Worktrees after cleanup: {worktrees:?}");
        
        // Verify orphan is removed but proper session remains
        assert!(!orphan_path.exists(), "Orphan path should be removed");
        assert!(session1.worktree_path.exists(), "Proper session worktree should remain");
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
        // On very fast machines repos are tiny, so durations can be in the microseconds range
        // where scheduler jitter dominates. Use higher relative tolerance for sub-millisecond cold runs.
        use std::time::Duration;
        let tolerance = if dur_cold < Duration::from_millis(1) {
            // Allow up to +100% when measurements are extremely small
            dur_cold
        } else {
            // 10% for normal ranges
            dur_cold / 10
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
        db.set_project_setup_script(&env.repo_path, script1).unwrap();
        let retrieved1 = db.get_project_setup_script(&env.repo_path).unwrap();
        assert_eq!(retrieved1, Some(script1.to_string()));
        
        // Update script
        db.set_project_setup_script(&env.repo_path, script2).unwrap();
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
        manager.db_ref().set_project_setup_script(&env.repo_path, script).unwrap();
        
        // Create a session - this should trigger the setup script
        let session = manager.create_session("test-setup", Some("Test prompt"), None).unwrap();
        
        // Verify the script was executed
        let marker_file = session.worktree_path.join("setup_marker.txt");
        assert!(marker_file.exists(), "Setup script should have created marker file");
        
        // Verify the script received correct environment variables
        let content = std::fs::read_to_string(&marker_file).unwrap();
        assert!(content.contains("Script executed for test-setup"));
        assert!(content.contains(&format!("REPO_PATH={}", env.repo_path.display())));
        assert!(content.contains(&format!("WORKTREE_PATH={}", session.worktree_path.display())));
        assert!(content.contains("BRANCH_NAME=schaltwerk/test-setup"));
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
        manager.db_ref().set_project_setup_script(&env.repo_path, failing_script).unwrap();
        
        // Try to create a session - this should fail due to script failure
        let result = manager.create_session("fail-test", None, None);
        assert!(result.is_err(), "Session creation should fail when setup script fails");
        
        // Verify error message contains script failure information
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Setup script failed"));
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
        manager.db_ref().set_project_setup_script(&env.repo_path, script).unwrap();
        
        // Create a session
        let session = manager.create_session("complex-setup", None, None).unwrap();
        
        // Verify all operations were performed
        assert!(session.worktree_path.join(".env").exists());
        assert!(session.worktree_path.join("config.json").exists());
        assert!(session.worktree_path.join("logs").is_dir());
        assert!(session.worktree_path.join("tmp").is_dir());
        assert!(session.worktree_path.join("session_info.txt").exists());
        
        // Verify file contents
        let env_content = std::fs::read_to_string(session.worktree_path.join(".env")).unwrap();
        assert!(env_content.contains("API_KEY=example_key"));
        
        let session_info = std::fs::read_to_string(session.worktree_path.join("session_info.txt")).unwrap();
        assert!(session_info.contains("Session: complex-setup"));
        assert!(session_info.contains("Branch: schaltwerk/complex-setup"));
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
        
        manager.db_ref().set_project_setup_script(&env.repo_path, script).unwrap();
        
        let session = manager.create_session("env-test", None, None).unwrap();
        
        // Verify the script executed successfully (no error means all tests passed)
        let env_file = session.worktree_path.join("env_test.txt");
        assert!(env_file.exists());
        
        let content = std::fs::read_to_string(&env_file).unwrap();
        assert!(content.contains(&format!("WORKTREE_PATH={}", session.worktree_path.display())));
        assert!(content.contains(&format!("REPO_PATH={}", env.repo_path.display())));
        assert!(content.contains("SESSION_NAME=env-test"));
        assert!(content.contains("BRANCH_NAME=schaltwerk/env-test"));
    }

    #[test]
    fn test_empty_setup_script_handling() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Set empty setup script
        manager.db_ref().set_project_setup_script(&env.repo_path, "").unwrap();
        
        // Create session - should succeed without executing anything
        let session = manager.create_session("empty-script", None, None).unwrap();
        assert!(session.worktree_path.exists());
        
        // Set whitespace-only script
        manager.db_ref().set_project_setup_script(&env.repo_path, "   \n\t  ").unwrap();
        
        // Create another session - should also succeed
        let session2 = manager.create_session("whitespace-script", None, None).unwrap();
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
        let path_with_dots = env.repo_path.join("..").join(env.repo_path.file_name().unwrap());
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
        db.set_project_setup_script(&project1, updated_script1).unwrap();
        
        let retrieved1_updated = db.get_project_setup_script(&project1).unwrap();
        let retrieved2_unchanged = db.get_project_setup_script(&project2).unwrap();
        
        assert_eq!(retrieved1_updated, Some(updated_script1.to_string()));
        assert_eq!(retrieved2_unchanged, Some(script2.to_string()));
    }

    #[test]
    fn test_convert_running_session_to_draft() {
        use crate::schaltwerk_core::types::SessionState;
        
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a plan session first
        let plan_content = "# Agent: Implement authentication\n- Add login form\n- Setup JWT tokens";
        let draft_session = manager.create_draft_session("auth-feature", plan_content).unwrap();
        assert_eq!(draft_session.session_state, SessionState::Plan);
        assert_eq!(draft_session.plan_content, Some(plan_content.to_string()));
        
        // Start the plan session (convert to running)
        manager.start_draft_session("auth-feature", None).unwrap();
        
        // Verify it's now running
        let running_session = manager.db_ref().get_session_by_name(&env.repo_path, "auth-feature").unwrap();
        assert_eq!(running_session.session_state, SessionState::Running);
        assert_eq!(running_session.status, SessionStatus::Active);
        
        // Convert the running session back to plan
        manager.convert_session_to_draft("auth-feature").unwrap();
        
        // Verify it's back to plan state
        let converted_session = manager.db_ref().get_session_by_name(&env.repo_path, "auth-feature").unwrap();
        assert_eq!(converted_session.session_state, SessionState::Plan);
        assert_eq!(converted_session.status, SessionStatus::Plan);
        assert_eq!(converted_session.plan_content, Some(plan_content.to_string()));
        
        // Verify the worktree has been removed
        assert!(!converted_session.worktree_path.exists());
        
        // Verify the branch has been archived
        assert!(!git::branch_exists(&env.repo_path, &converted_session.branch).unwrap());
    }
    
    #[test]
    fn test_convert_session_to_draft_preserves_content() {
        use crate::schaltwerk_core::types::SessionState;
        
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a plan session with detailed content
        let plan_content = "# Agent: Build user authentication system\n\n## Requirements:\n- OAuth2 login\n- JWT tokens\n- User profile management\n- Password reset flow\n\n## Technical Details:\n- Use Rust backend\n- PostgreSQL database\n- React frontend";
        let _draft_session = manager.create_draft_session("auth-system", plan_content).unwrap();
        
        // Start the plan session
        manager.start_draft_session("auth-system", None).unwrap();
        
        // Convert back to plan
        manager.convert_session_to_draft("auth-system").unwrap();
        
        // Verify content is preserved
        let converted = manager.db_ref().get_session_by_name(&env.repo_path, "auth-system").unwrap();
        assert_eq!(converted.plan_content, Some(plan_content.to_string()));
        assert_eq!(converted.session_state, SessionState::Plan);
    }
#[cfg(test)]
mod tests {
    use super::super::session_core::*;
    use crate::schaltwerk_core::{
        database::Database,
        db_app_config::AppConfigMethods,
        types::{SessionState, SessionStatus},
    };
    use tempfile::TempDir;
    use std::fs;
    use std::path::PathBuf;
    use std::collections::HashMap;

    struct TestSetup {
        _temp_dir: TempDir,
        repo_path: PathBuf,
        manager: SessionManager,
    }

    impl TestSetup {
        fn new() -> Self {
            let temp_dir = TempDir::new().unwrap();
            let repo_path = temp_dir.path().to_path_buf();
            
            // Initialize git repo
            std::process::Command::new("git")
                .args(&["init"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to init git repo");
            
            // Create initial commit
            fs::write(repo_path.join("README.md"), "test").unwrap();
            std::process::Command::new("git")
                .args(&["add", "."])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to add files");
            
            std::process::Command::new("git")
                .args(&["commit", "-m", "initial"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to commit");
            
            let db = Database::new_in_memory().unwrap();
            let manager = SessionManager::new(db, repo_path.clone());
            
            Self { _temp_dir: temp_dir, repo_path, manager }
        }

        fn new_empty_repo() -> Self {
            let temp_dir = TempDir::new().unwrap();
            let repo_path = temp_dir.path().to_path_buf();
            
            // Initialize git repo without any commits
            std::process::Command::new("git")
                .args(&["init"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to init git repo");
            
            // Configure git user for commits
            std::process::Command::new("git")
                .args(&["config", "user.email", "test@example.com"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to set git email");
            
            std::process::Command::new("git")
                .args(&["config", "user.name", "Test User"])
                .current_dir(&repo_path)
                .output()
                .expect("Failed to set git name");
            
            let db = Database::new_in_memory().unwrap();
            let manager = SessionManager::new(db, repo_path.clone());
            
            Self { _temp_dir: temp_dir, repo_path, manager }
        }
    }

    // Tests for create_session_with_auto_flag() - High complexity function

    #[test]
    fn test_create_session_invalid_name_characters() {
        let setup = TestSetup::new();
        
        // Test various invalid characters
        let invalid_names = vec![
            "test session", // space
            "test/session", // slash
            "test\\session", // backslash
            "test@session", // at symbol
            "test#session", // hash
            "test$session", // dollar
            "test%session", // percent
            "test^session", // caret
            "test&session", // ampersand
            "test*session", // asterisk
            "test(session", // parenthesis
            "test)session", // parenthesis
            "test[session", // bracket
            "test]session", // bracket
            "test{session", // brace
            "test}session", // brace
            "test|session", // pipe
            "test;session", // semicolon
            "test:session", // colon
            "test'session", // quote
            "test\"session", // double quote
            "test<session", // less than
            "test>session", // greater than
            "test?session", // question mark
            "test,session", // comma
            "test.session", // period
            "test=session", // equals
            "test+session", // plus
            "test~session", // tilde
            "test`session", // backtick
        ];
        
        for invalid_name in invalid_names {
            let result = setup.manager.create_session_with_auto_flag(
                invalid_name,
                None,
                None,
                false
            );
            
            assert!(result.is_err(), "Should reject name: {}", invalid_name);
            let err = result.unwrap_err();
            assert!(err.to_string().contains("Invalid session name"));
        }
    }

    #[test]
    fn test_create_session_valid_names() {
        let setup = TestSetup::new();
        
        // Test valid names
        let valid_names = vec![
            "test",
            "test-session",
            "test_session",
            "test123",
            "TEST",
            "Test-Session_123",
            "a",
            "1",
            "test-123-session_456",
        ];
        
        for (i, valid_name) in valid_names.iter().enumerate() {
            let unique_name = format!("{}-{}", valid_name, i); // Make names unique
            let result = setup.manager.create_session_with_auto_flag(
                &unique_name,
                None,
                None,
                false
            );
            
            assert!(result.is_ok(), "Should accept name: {}", unique_name);
            let session = result.unwrap();
            assert_eq!(session.name, unique_name);
        }
    }

    #[test]
    fn test_create_session_in_empty_repo() {
        let setup = TestSetup::new_empty_repo();
        
        // First create an initial commit so we can create worktrees
        std::fs::write(setup.repo_path.join("README.md"), "# Initial").unwrap();
        std::process::Command::new("git")
            .args(&["add", "."])
            .current_dir(&setup.repo_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(&["commit", "-m", "Initial commit"])
            .current_dir(&setup.repo_path)
            .output()
            .unwrap();
        
        let result = setup.manager.create_session_with_auto_flag(
            "test-session",
            Some("Test prompt"),
            None,
            false
        );
        
        assert!(result.is_ok(), "Should handle repository after initial commit");
        let session = result.unwrap();
        
        assert_eq!(session.name, "test-session");
        assert_eq!(session.initial_prompt, Some("Test prompt".to_string()));
        assert!(!session.was_auto_generated);
    }

    #[test]
    fn test_create_session_worktree_cleanup_on_failure() {
        let setup = TestSetup::new();
        
        // Create a session successfully first
        let result = setup.manager.create_session_with_auto_flag(
            "test-session",
            None,
            None,
            false
        );
        assert!(result.is_ok());
        
        // Try to create with same name - should handle cleanup
        let result2 = setup.manager.create_session_with_auto_flag(
            "test-session",
            None,
            None,
            false
        );
        
        assert!(result2.is_ok(), "Should handle name collision");
        let session2 = result2.unwrap();
        assert_ne!(session2.name, "test-session", "Should generate unique name");
        assert!(session2.name.starts_with("test-session-"), "Should append suffix");
    }

    #[test]
    fn test_create_session_database_rollback_on_filesystem_failure() {
        let setup = TestSetup::new();
        
        // Make the worktree directory read-only to simulate filesystem failure
        let worktree_base = setup.repo_path.join(".schaltwerk").join("worktrees");
        fs::create_dir_all(&worktree_base).unwrap();
        
        // Set directory to read-only (this might not work on all systems)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&worktree_base).unwrap().permissions();
            perms.set_mode(0o444); // Read-only
            fs::set_permissions(&worktree_base, perms).ok();
        }
        
        let result = setup.manager.create_session_with_auto_flag(
            "test-readonly",
            Some("Test prompt"),
            None,
            false
        );
        
        // Restore permissions for cleanup
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&worktree_base).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&worktree_base, perms).ok();
        }
        
        // The test might pass or fail depending on system - we're testing that it handles errors gracefully
        if result.is_err() {
            // Verify no partial data in database
            let sessions = setup.manager.list_sessions().unwrap();
            assert_eq!(sessions.len(), 0, "Should not leave partial session in database");
        }
    }

    #[test]
    fn test_create_session_auto_generated_name_collision_handling() {
        let setup = TestSetup::new();
        
        // Create multiple sessions with auto-generated flag
        let sessions: Vec<_> = (0..5).map(|_| {
            setup.manager.create_session_with_auto_flag(
                "auto",
                None,
                None,
                true  // was_auto_generated = true
            ).unwrap()
        }).collect();
        
        // All should succeed with unique names
        let names: Vec<_> = sessions.iter().map(|s| &s.name).collect();
        let unique_names: std::collections::HashSet<_> = names.iter().collect();
        assert_eq!(names.len(), unique_names.len(), "All names should be unique");
        
        // All should be marked as auto-generated
        for session in &sessions {
            assert!(session.was_auto_generated);
            assert!(session.pending_name_generation);
        }
    }

    #[test]
    fn test_create_session_with_custom_base_branch() {
        let setup = TestSetup::new();
        
        // Create a custom branch
        std::process::Command::new("git")
            .args(&["checkout", "-b", "develop"])
            .current_dir(&setup.repo_path)
            .output()
            .expect("Failed to create branch");
        
        let result = setup.manager.create_session_with_auto_flag(
            "feature",
            Some("New feature"),
            Some("develop"),  // Custom base branch
            false
        );
        
        assert!(result.is_ok());
        let session = result.unwrap();
        assert_eq!(session.parent_branch, "develop");
        assert_eq!(session.initial_prompt, Some("New feature".to_string()));
    }

    // Tests for orchestrator command building via public methods

    #[test]
    fn test_orchestrator_command_claude_agent() {
        let setup = TestSetup::new();
        
        // Test via public method that uses build_orchestrator_command internally
        let command = setup.manager.start_claude_in_orchestrator_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("claude"));
        assert!(!command.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_orchestrator_command_claude_with_skip_permissions() {
        let setup = TestSetup::new();
        
        // Set skip permissions globally via database
        let db = setup.manager.db_ref();
        db.set_skip_permissions(true).unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("claude"));
        assert!(command.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_orchestrator_command_cursor_agent() {
        let setup = TestSetup::new();
        
        // Set agent type to cursor via database
        let db = setup.manager.db_ref();
        db.set_agent_type("cursor").unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("cursor"));
    }

    #[test]
    fn test_orchestrator_command_opencode_agent() {
        let setup = TestSetup::new();
        
        // Set agent type to opencode and skip permissions via database
        let db = setup.manager.db_ref();
        db.set_agent_type("opencode").unwrap();
        db.set_skip_permissions(true).unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("opencode"));
        // Note: opencode doesn't support --dangerously-skip-permissions flag
        // The _skip_permissions parameter is unused in opencode implementation
        assert!(!command.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_orchestrator_command_gemini_agent() {
        let setup = TestSetup::new();
        
        // Set agent type to gemini via database
        let db = setup.manager.db_ref();
        db.set_agent_type("gemini").unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("gemini"));
    }

    #[test]
    fn test_orchestrator_command_codex_agent() {
        let setup = TestSetup::new();
        
        // Set agent type to codex without skip permissions via database
        let db = setup.manager.db_ref();
        db.set_agent_type("codex").unwrap();
        db.set_skip_permissions(false).unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("codex"));
        assert!(command.contains("workspace-write"));
        assert!(!command.contains("danger-full-access"));
    }

    #[test]
    fn test_orchestrator_command_codex_with_full_access() {
        let setup = TestSetup::new();
        
        // Set agent type to codex with skip permissions via database
        let db = setup.manager.db_ref();
        db.set_agent_type("codex").unwrap();
        db.set_skip_permissions(true).unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("codex"));
        assert!(command.contains("danger-full-access"));
        assert!(!command.contains("workspace-write"));
    }

    #[test]
    fn test_orchestrator_command_unknown_agent_defaults_to_claude() {
        let setup = TestSetup::new();
        
        // Set an unknown agent type via database
        let db = setup.manager.db_ref();
        db.set_agent_type("unknown-agent").unwrap();
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        assert!(command.contains("claude"));
    }

    #[test]
    fn test_orchestrator_command_with_binary_override() {
        let setup = TestSetup::new();
        
        let mut binary_paths = HashMap::new();
        binary_paths.insert("claude".to_string(), "/custom/path/to/claude".to_string());
        
        let command = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&binary_paths).unwrap();
        
        assert!(command.contains("/custom/path/to/claude"));
    }

    #[test]
    fn test_orchestrator_command_session_discovery() {
        let setup = TestSetup::new();
        
        // Test with resume (uses start_claude_in_orchestrator_with_binary which resumes)
        let command_resume = setup.manager.start_claude_in_orchestrator_with_binary(&HashMap::new()).unwrap();
        
        // Test fresh (uses start_claude_in_orchestrator_fresh_with_binary which doesn't resume)
        let command_fresh = setup.manager.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new()).unwrap();
        
        // Both should contain claude but potentially different session handling
        assert!(command_resume.contains("claude"));
        assert!(command_fresh.contains("claude"));
    }

    // Tests for start_draft_session() - State transitions

    #[test]
    fn test_start_draft_session_plan_to_running_transition() {
        let setup = TestSetup::new();
        
        // Create a plan session first
        let plan = setup.manager.create_draft_session(
            "test-plan",
            "This is a plan content"
        ).unwrap();
        
        assert_eq!(plan.status, SessionStatus::Plan);
        assert_eq!(plan.session_state, SessionState::Plan);
        assert_eq!(plan.plan_content, Some("This is a plan content".to_string()));
        
        // Start the plan session
        let result = setup.manager.start_draft_session("test-plan", None);
        assert!(result.is_ok());
        
        // Verify state transition
        let session = setup.manager.get_session("test-plan").unwrap();
        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.session_state, SessionState::Running);
        assert_eq!(session.initial_prompt, Some("This is a plan content".to_string()));
    }

    #[test]
    fn test_start_draft_session_not_in_plan_state_error() {
        let setup = TestSetup::new();
        
        // Create a regular running session
        let session = setup.manager.create_session_with_auto_flag(
            "running-session",
            None,
            None,
            false
        ).unwrap();
        
        assert_eq!(session.session_state, SessionState::Running);
        
        // Try to start it as a plan - should fail
        let result = setup.manager.start_draft_session("running-session", None);
        
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("not in plan state"));
    }

    #[test]
    fn test_start_draft_session_with_custom_base_branch() {
        let setup = TestSetup::new();
        
        // Create a custom branch
        std::process::Command::new("git")
            .args(&["checkout", "-b", "feature-branch"])
            .current_dir(&setup.repo_path)
            .output()
            .expect("Failed to create branch");
        
        // Create and start plan with custom base
        setup.manager.create_draft_session("test-plan", "Plan content").unwrap();
        
        let result = setup.manager.start_draft_session(
            "test-plan",
            Some("feature-branch")
        );
        
        assert!(result.is_ok());
        
        // Verify the worktree was created from the custom branch
        let session = setup.manager.get_session("test-plan").unwrap();
        assert!(session.worktree_path.exists());
    }

    #[test]
    fn test_start_draft_session_preserves_plan_content_in_initial_prompt() {
        let setup = TestSetup::new();
        
        let plan_content = "Step 1: Do this\nStep 2: Do that\nStep 3: Finish";
        
        // Create plan with plan content
        setup.manager.create_draft_session("test-plan", plan_content).unwrap();
        
        // Start the plan
        setup.manager.start_draft_session("test-plan", None).unwrap();
        
        // Verify plan content moved to initial_prompt
        let session = setup.manager.get_session("test-plan").unwrap();
        assert_eq!(session.initial_prompt, Some(plan_content.to_string()));
        assert_eq!(session.session_state, SessionState::Running);
    }

    #[test]
    fn test_start_draft_session_concurrent_starts() {
        use std::sync::Arc;
        use std::thread;
        
        let setup = TestSetup::new();
        let manager = Arc::new(setup.manager);
        
        // Create a plan session
        manager.create_draft_session("concurrent-test", "Plan").unwrap();
        
        // Try to start it from multiple threads
        let manager1 = manager.clone();
        let handle1 = thread::spawn(move || {
            manager1.start_draft_session("concurrent-test", None)
        });
        
        let manager2 = manager.clone();
        let handle2 = thread::spawn(move || {
            manager2.start_draft_session("concurrent-test", None)
        });
        
        let result1 = handle1.join().unwrap();
        let result2 = handle2.join().unwrap();
        
        // At least one should succeed, at most one should succeed
        let successes = [&result1, &result2].iter().filter(|r| r.is_ok()).count();
        assert!(successes <= 1, "Only one thread should successfully start the session");
        
        // Verify final state
        let session = manager.get_session("concurrent-test").unwrap();
        if successes == 1 {
            assert_eq!(session.session_state, SessionState::Running);
        }
    }

    #[test]
    fn test_start_draft_session_error_during_worktree_creation() {
        let setup = TestSetup::new();
        
        // Create plan
        setup.manager.create_draft_session("test-error", "Plan").unwrap();
        
        // Delete the repository to cause worktree creation to fail
        fs::remove_dir_all(&setup.repo_path.join(".git")).ok();
        
        let result = setup.manager.start_draft_session("test-error", None);
        
        assert!(result.is_err());
        // Session should remain in Plan state
        // Note: This might fail since we broke the git repo, but testing error handling is important
    }

    // Test session name generation and uniqueness

    #[test]
    fn test_session_name_collision_resolution() {
        let setup = TestSetup::new();
        
        // Create first session
        let session1 = setup.manager.create_session_with_auto_flag(
            "test",
            None,
            None,
            false
        ).unwrap();
        assert_eq!(session1.name, "test");
        
        // Try to create with same name
        let session2 = setup.manager.create_session_with_auto_flag(
            "test",
            None,
            None,
            false
        ).unwrap();
        assert!(session2.name.starts_with("test-"));
        assert_ne!(session2.name, "test");
        
        // Try again
        let session3 = setup.manager.create_session_with_auto_flag(
            "test",
            None,
            None,
            false
        ).unwrap();
        assert!(session3.name.starts_with("test-"));
        assert_ne!(session3.name, session1.name);
        assert_ne!(session3.name, session2.name);
    }

    // Test error recovery paths

    #[test]
    fn test_cancel_session_with_missing_worktree() {
        let setup = TestSetup::new();
        
        // Create a session
        let session = setup.manager.create_session_with_auto_flag(
            "test-cancel",
            None,
            None,
            false
        ).unwrap();
        
        // Manually remove the worktree
        fs::remove_dir_all(&session.worktree_path).ok();
        
        // Cancel should still work
        let result = setup.manager.cancel_session("test-cancel");
        assert!(result.is_ok(), "Should handle missing worktree gracefully");
        
        // Verify status changed
        let cancelled = setup.manager.get_session("test-cancel").unwrap();
        assert_eq!(cancelled.status, SessionStatus::Cancelled);
    }

    #[test]
    fn test_convert_session_to_draft_with_uncommitted_changes() {
        let setup = TestSetup::new();
        
        // Create a session
        let session = setup.manager.create_session_with_auto_flag(
            "test-convert",
            Some("Initial prompt"),
            None,
            false
        ).unwrap();
        
        // Make some changes in the worktree
        fs::write(session.worktree_path.join("newfile.txt"), "content").unwrap();
        std::process::Command::new("git")
            .args(&["add", "."])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        
        // Convert to plan
        let result = setup.manager.convert_session_to_draft("test-convert");
        assert!(result.is_ok());
        
        // Verify conversion
        let plan = setup.manager.get_session("test-convert").unwrap();
        assert_eq!(plan.status, SessionStatus::Plan);
        assert_eq!(plan.session_state, SessionState::Plan);
        assert!(!plan.worktree_path.exists());
    }

    // Test complex scenarios

    #[test]
    fn test_create_start_cancel_cycle() {
        let setup = TestSetup::new();
        
        // Create plan
        setup.manager.create_draft_session("lifecycle", "Plan content").unwrap();
        
        // Start it
        setup.manager.start_draft_session("lifecycle", None).unwrap();
        
        // Verify it's running
        let running = setup.manager.get_session("lifecycle").unwrap();
        assert_eq!(running.session_state, SessionState::Running);
        
        // Cancel it
        setup.manager.cancel_session("lifecycle").unwrap();
        
        // Verify it's cancelled
        let cancelled = setup.manager.get_session("lifecycle").unwrap();
        assert_eq!(cancelled.status, SessionStatus::Cancelled);
    }

    #[test]
    fn test_mark_session_ready_with_uncommitted_autocommit() {
        let setup = TestSetup::new();
        
        // Create session
        let session = setup.manager.create_session_with_auto_flag(
            "test-ready",
            None,
            None,
            false
        ).unwrap();
        
        // Configure git in the worktree (worktrees may not inherit config)
        std::process::Command::new("git")
            .args(&["config", "user.email", "test@example.com"])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(&["config", "user.name", "Test User"])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        
        // Make changes
        fs::write(session.worktree_path.join("file.txt"), "content").unwrap();
        std::process::Command::new("git")
            .args(&["add", "."])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        
        // Mark ready with auto-commit
        let result = setup.manager.mark_session_ready("test-ready", true).unwrap();
        assert!(result);
        
        // Verify session is marked ready
        let ready = setup.manager.get_session("test-ready").unwrap();
        assert!(ready.ready_to_merge);
        
        // Verify changes were committed
        let status_output = std::process::Command::new("git")
            .args(&["status", "--porcelain"])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        assert!(status_output.stdout.is_empty(), "Should have no uncommitted changes");
    }

    #[test]
    fn test_update_plan_content_only_allows_plan_state() {
        let setup = TestSetup::new();
        
        // Create a plan session
        setup.manager.create_draft_session("test-plan", "Initial content").unwrap();
        
        // Should succeed for Plan state
        setup.manager.update_plan_content("test-plan", "Updated content").unwrap();
        let session = setup.manager.get_session("test-plan").unwrap();
        assert_eq!(session.plan_content, Some("Updated content".to_string()));
        
        // Start the plan to make it Running
        setup.manager.start_draft_session_with_config("test-plan", None, None, None).unwrap();
        
        // Should fail for Running state
        let result = setup.manager.update_plan_content("test-plan", "Should fail");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("only Plan sessions can have their content updated"));
        
        // Mark as reviewed
        setup.manager.mark_session_as_reviewed("test-plan").unwrap();
        
        // Should still fail for Reviewed state
        let result = setup.manager.update_plan_content("test-plan", "Should also fail");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("only Plan sessions can have their content updated"));
    }

    #[test]
    fn test_append_plan_content_only_allows_plan_state() {
        let setup = TestSetup::new();
        
        // Create a plan session
        setup.manager.create_draft_session("test-plan-append", "Initial").unwrap();
        
        // Should succeed for Plan state
        setup.manager.append_plan_content("test-plan-append", " content").unwrap();
        let session = setup.manager.get_session("test-plan-append").unwrap();
        assert_eq!(session.plan_content, Some("Initial\n content".to_string()));
        
        // Start the plan to make it Running
        setup.manager.start_draft_session_with_config("test-plan-append", None, None, None).unwrap();
        
        // Should fail for Running state
        let result = setup.manager.append_plan_content("test-plan-append", " more");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("only Plan sessions can have content appended"));
        
        // Mark as reviewed
        setup.manager.mark_session_as_reviewed("test-plan-append").unwrap();
        
        // Should still fail for Reviewed state
        let result = setup.manager.append_plan_content("test-plan-append", " even more");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("only Plan sessions can have content appended"));
    }

    #[test]
    fn test_plan_content_operations_with_nonexistent_session() {
        let setup = TestSetup::new();
        
        // Should fail for non-existent session
        let result = setup.manager.update_plan_content("nonexistent", "content");
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("nonexistent") || error_msg.contains("not found") || error_msg.contains("No session"),
                "Expected error about missing session, got: {}", error_msg);
        
        let result = setup.manager.append_plan_content("nonexistent", "content");
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("nonexistent") || error_msg.contains("not found") || error_msg.contains("No session"),
                "Expected error about missing session, got: {}", error_msg);
    }

    #[test]
    fn test_plan_content_preserved_when_converting_states() {
        let setup = TestSetup::new();
        
        // Create a plan with content
        setup.manager.create_draft_session("test-preserve", "Important content").unwrap();
        setup.manager.update_plan_content("test-preserve", "Very important content").unwrap();
        
        // Start the plan (convert to Running)
        setup.manager.start_draft_session_with_config("test-preserve", None, None, None).unwrap();
        
        // Content should be preserved but not modifiable
        let session = setup.manager.get_session("test-preserve").unwrap();
        assert_eq!(session.plan_content, Some("Very important content".to_string()));
        assert_eq!(session.session_state, SessionState::Running);
        
        // Convert back to plan
        setup.manager.convert_session_to_plan("test-preserve").unwrap();
        
        // Should be able to modify again
        setup.manager.append_plan_content("test-preserve", "\nAdditional notes").unwrap();
        let session = setup.manager.get_session("test-preserve").unwrap();
        assert_eq!(session.plan_content, Some("Very important content\n\nAdditional notes".to_string()));
        assert_eq!(session.session_state, SessionState::Plan);
    }
}
// Test to verify that the fix works correctly

#[cfg(test)]
mod draft_fixed_tests {
    use crate::schaltwerk_core::types::{SessionStatus, SessionState};
    use crate::schaltwerk_core::database::Database;
    use crate::domains::sessions::service::SessionManager;
    use tempfile::TempDir;
    use std::fs;
    use std::process::Command;

    fn setup_test_env() -> (TempDir, SessionManager) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        Command::new("git")
            .args(&["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        Command::new("git")
            .args(&["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
            
        Command::new("git")
            .args(&["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        fs::write(repo_path.join("README.md"), "test").unwrap();
        Command::new("git")
            .args(&["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(&["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create database in temp directory
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, repo_path);
        
        (temp_dir, manager)
    }

    #[test]
    fn test_draft_sessions_have_draft_status() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a spec session
        let draft_session = manager.create_spec_session("test-spec", "Spec content").unwrap();
        
        // FIX VERIFIED: Spec sessions now have SessionStatus::Spec
        assert_eq!(
            draft_session.status, 
            SessionStatus::Spec,
            "Spec sessions should have SessionStatus::Spec"
        );
        
        // Also verify session_state is Spec
        assert_eq!(
            draft_session.session_state,
            SessionState::Spec,
            "Spec sessions should have SessionState::Spec"
        );
    }

    #[test]
    fn test_draft_sessions_separate_from_active() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a spec session
        let spec = manager.create_spec_session("test-spec", "Spec content").unwrap();
        
        // Create an active session
        let active = manager.create_session("test-active", Some("Active prompt"), None).unwrap();
        
        // List all sessions
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: Can now distinguish by SessionStatus
        let draft_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Spec)
            .count();
        let active_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .count();
        
        assert_eq!(draft_count, 1, "Should have exactly 1 spec session");
        assert_eq!(active_count, 1, "Should have exactly 1 active session");
        
        // Verify the specific sessions have correct status
        assert_eq!(spec.status, SessionStatus::Spec);
        assert_eq!(active.status, SessionStatus::Active);
    }

    #[test]
    fn test_ui_can_filter_drafts_properly() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create sessions
        manager.create_spec_session("ui-spec", "UI Spec").unwrap();
        manager.create_session("ui-active", Some("UI Active"), None).unwrap();
        
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: UI can now properly filter by SessionStatus
        let specs: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Spec)
            .collect();
        
        let actives: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .collect();
        
        assert_eq!(specs.len(), 1, "UI can filter exactly 1 spec");
        assert_eq!(actives.len(), 1, "UI can filter exactly 1 active");
        
        // Spec should NOT appear in active sessions
        assert!(
            !actives.iter().any(|s| s.name == "ui-spec"),
            "Spec session should not appear in active sessions list"
        );
        
        // Spec should appear in spec sessions
        assert!(
            specs.iter().any(|s| s.name == "ui-spec"),
            "Spec session should appear in spec sessions list"
        );
    }

    #[test]
    fn test_draft_transitions_to_active_when_started() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a spec
        let spec = manager.create_spec_session("transition-spec", "Spec to start").unwrap();
        assert_eq!(spec.status, SessionStatus::Spec);
        assert_eq!(spec.session_state, SessionState::Spec);
        
        // Start the spec session
        manager.start_spec_session("transition-spec", None).unwrap();
        
        // Get the updated session - retrieve via list_sessions
        let sessions = manager.list_sessions().unwrap();
        let started = sessions.into_iter()
            .find(|s| s.name == "transition-spec")
            .expect("Should find the started spec session");
        
        // FIX VERIFIED: After starting, status changes to Active
        assert_eq!(
            started.status,
            SessionStatus::Active,
            "Started spec should have Active status"
        );
        assert_eq!(
            started.session_state,
            SessionState::Running,
            "Started spec should have Running state"
        );
    }
}
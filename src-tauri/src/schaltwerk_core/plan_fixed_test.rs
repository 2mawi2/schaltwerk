// Test to verify that the fix works correctly

#[cfg(test)]
mod draft_fixed_tests {
    use crate::schaltwerk_core::types::{SessionStatus, SessionState};
    use crate::schaltwerk_core::database::Database;
    use crate::schaltwerk_core::session::SessionManager;
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
        
        // Create a plan session
        let draft_session = manager.create_draft_session("test-plan", "Plan content").unwrap();
        
        // FIX VERIFIED: Plan sessions now have SessionStatus::Plan
        assert_eq!(
            draft_session.status, 
            SessionStatus::Plan,
            "Plan sessions should have SessionStatus::Plan"
        );
        
        // Also verify session_state is Plan
        assert_eq!(
            draft_session.session_state,
            SessionState::Plan,
            "Plan sessions should have SessionState::Plan"
        );
    }

    #[test]
    fn test_draft_sessions_separate_from_active() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a plan session
        let plan = manager.create_draft_session("test-plan", "Plan content").unwrap();
        
        // Create an active session
        let active = manager.create_session("test-active", Some("Active prompt"), None).unwrap();
        
        // List all sessions
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: Can now distinguish by SessionStatus
        let draft_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Plan)
            .count();
        let active_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .count();
        
        assert_eq!(draft_count, 1, "Should have exactly 1 plan session");
        assert_eq!(active_count, 1, "Should have exactly 1 active session");
        
        // Verify the specific sessions have correct status
        assert_eq!(plan.status, SessionStatus::Plan);
        assert_eq!(active.status, SessionStatus::Active);
    }

    #[test]
    fn test_ui_can_filter_drafts_properly() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create sessions
        manager.create_draft_session("ui-plan", "UI Plan").unwrap();
        manager.create_session("ui-active", Some("UI Active"), None).unwrap();
        
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: UI can now properly filter by SessionStatus
        let plans: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Plan)
            .collect();
        
        let actives: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .collect();
        
        assert_eq!(plans.len(), 1, "UI can filter exactly 1 plan");
        assert_eq!(actives.len(), 1, "UI can filter exactly 1 active");
        
        // Plan should NOT appear in active sessions
        assert!(
            !actives.iter().any(|s| s.name == "ui-plan"),
            "Plan session should not appear in active sessions list"
        );
        
        // Plan should appear in plan sessions
        assert!(
            plans.iter().any(|s| s.name == "ui-plan"),
            "Plan session should appear in plan sessions list"
        );
    }

    #[test]
    fn test_draft_transitions_to_active_when_started() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a plan
        let plan = manager.create_draft_session("transition-plan", "Plan to start").unwrap();
        assert_eq!(plan.status, SessionStatus::Plan);
        assert_eq!(plan.session_state, SessionState::Plan);
        
        // Start the plan session
        manager.start_draft_session("transition-plan", None).unwrap();
        
        // Get the updated session - retrieve via list_sessions
        let sessions = manager.list_sessions().unwrap();
        let started = sessions.into_iter()
            .find(|s| s.name == "transition-plan")
            .expect("Should find the started plan session");
        
        // FIX VERIFIED: After starting, status changes to Active
        assert_eq!(
            started.status,
            SessionStatus::Active,
            "Started plan should have Active status"
        );
        assert_eq!(
            started.session_state,
            SessionState::Running,
            "Started plan should have Running state"
        );
    }
}
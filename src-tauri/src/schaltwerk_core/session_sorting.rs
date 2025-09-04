#[cfg(test)]
mod session_sorting_tests {
    use crate::schaltwerk_core::{Database, SessionManager};
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::schaltwerk_core::types::{Session, SessionStatus, SessionState, SortMode, FilterMode};
    use chrono::{Utc, Duration};
    use tempfile::TempDir;
    use std::path::PathBuf;

    fn create_test_session_with_repo(
        name: &str,
        status: SessionStatus,
        state: SessionState,
        ready_to_merge: bool,
        created_offset_minutes: i64,
        last_activity_offset_minutes: Option<i64>,
        repo_path: &PathBuf,
    ) -> Session {
        let now = Utc::now();
        Session {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            display_name: Some(format!("Display {}", name)),
            repository_path: repo_path.clone(),
            repository_name: "test-repo".to_string(),
            branch: format!("branch-{}", name),
            parent_branch: "main".to_string(),
            worktree_path: repo_path.join(format!("worktree-{}", name)),
            status,
            created_at: now - Duration::minutes(created_offset_minutes),
            updated_at: now,
            last_activity: last_activity_offset_minutes.map(|offset| now - Duration::minutes(offset)),
            initial_prompt: Some(format!("Test agent for {}", name)),
            ready_to_merge,
            original_agent_type: Some("claude".to_string()),
            original_skip_permissions: Some(false),
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: if state == SessionState::Spec { 
                Some(format!("Spec content for {}", name)) 
            } else { 
                None 
            },
            session_state: state,
        }
    }

    fn setup_test_sessions() -> (TempDir, SessionManager, Vec<Session>) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        
        // Initialize database schema
        crate::schaltwerk_core::db_schema::initialize_schema(&db).unwrap();
        
        let manager = SessionManager::new(db.clone(), temp_dir.path().to_path_buf());

        // Create test sessions with different states and timestamps - using the actual repo path
        let repo_path = temp_dir.path().to_path_buf();
        let sessions = vec![
            // Spec sessions
            create_test_session_with_repo("spec-alpha", SessionStatus::Spec, SessionState::Spec, false, 60, None, &repo_path),
            create_test_session_with_repo("spec-beta", SessionStatus::Spec, SessionState::Spec, false, 30, None, &repo_path),
            
            // Running sessions (different last activity)
            create_test_session_with_repo("running-charlie", SessionStatus::Active, SessionState::Running, false, 90, Some(5), &repo_path),
            create_test_session_with_repo("running-delta", SessionStatus::Active, SessionState::Running, false, 45, Some(10), &repo_path),
            create_test_session_with_repo("running-echo", SessionStatus::Active, SessionState::Running, false, 20, Some(15), &repo_path),
            
            // Reviewed sessions
            create_test_session_with_repo("reviewed-foxtrot", SessionStatus::Active, SessionState::Running, true, 120, Some(2), &repo_path),
            create_test_session_with_repo("reviewed-golf", SessionStatus::Active, SessionState::Running, true, 75, Some(8), &repo_path),
        ];

        // Create sessions in database
        for session in &sessions {
            db.create_session(session).unwrap();
        }

        (temp_dir, manager, sessions)
    }

    #[tokio::test]
    async fn test_sort_by_name() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let sorted_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name, 
            FilterMode::All
        ).unwrap();

        // Check that sessions are sorted alphabetically by name (case-insensitive)
        let session_names: Vec<&str> = sorted_sessions.iter()
            .filter(|s| !s.info.ready_to_merge) // Exclude reviewed sessions (they come at the end)
            .map(|s| s.info.session_id.as_str())
            .collect();
            
        assert_eq!(session_names, vec!["spec-alpha", "spec-beta", "running-charlie", "running-delta", "running-echo"]);
        
        // Check that reviewed sessions are at the end and also sorted by name
        let reviewed_names: Vec<&str> = sorted_sessions.iter()
            .filter(|s| s.info.ready_to_merge)
            .map(|s| s.info.session_id.as_str())
            .collect();
            
        assert_eq!(reviewed_names, vec!["reviewed-foxtrot", "reviewed-golf"]);
    }

    #[tokio::test]
    async fn test_sort_by_created() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let sorted_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Created, 
            FilterMode::All
        ).unwrap();

        // Check that non-reviewed sessions are sorted by creation time (newest first)
        let session_names: Vec<&str> = sorted_sessions.iter()
            .filter(|s| !s.info.ready_to_merge)
            .map(|s| s.info.session_id.as_str())
            .collect();
            
        // Expected order: running-echo (20min ago), spec-beta (30min ago), running-delta (45min ago), spec-alpha (60min ago), running-charlie (90min ago)
        assert_eq!(session_names, vec!["running-echo", "spec-beta", "running-delta", "spec-alpha", "running-charlie"]);
        
        // Reviewed sessions should still be at the end, sorted by name
        let reviewed_names: Vec<&str> = sorted_sessions.iter()
            .filter(|s| s.info.ready_to_merge)
            .map(|s| s.info.session_id.as_str())
            .collect();
            
        assert_eq!(reviewed_names, vec!["reviewed-foxtrot", "reviewed-golf"]);
    }

    #[tokio::test]
    async fn test_sort_by_last_edited() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let sorted_sessions = manager.list_enriched_sessions_sorted(
            SortMode::LastEdited, 
            FilterMode::All
        ).unwrap();

        // Check that sessions are sorted by last activity (most recent first)
        let session_names: Vec<&str> = sorted_sessions.iter()
            .filter(|s| !s.info.ready_to_merge)
            .map(|s| s.info.session_id.as_str())
            .collect();
            
        // Expected order by last activity: running-charlie (5min ago), running-delta (10min ago), running-echo (15min ago), then specs by created time
        assert_eq!(session_names, vec!["running-charlie", "running-delta", "running-echo", "spec-beta", "spec-alpha"]);
    }

    #[tokio::test] 
    async fn test_filter_draft_sessions() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let filtered_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name,
            FilterMode::Spec
        ).unwrap();

        // Should only have spec sessions
        assert_eq!(filtered_sessions.len(), 2);
        let session_names: Vec<&str> = filtered_sessions.iter()
            .map(|s| s.info.session_id.as_str())
            .collect();
        assert_eq!(session_names, vec!["spec-alpha", "spec-beta"]);
        
        // All sessions should have spec state
        for session in &filtered_sessions {
            assert_eq!(session.info.session_state, SessionState::Spec);
        }
    }

    #[tokio::test]
    async fn test_filter_running_sessions() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let filtered_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name,
            FilterMode::Running
        ).unwrap();

        // Should only have running (not spec, not reviewed) sessions
        assert_eq!(filtered_sessions.len(), 3);
        let session_names: Vec<&str> = filtered_sessions.iter()
            .map(|s| s.info.session_id.as_str())
            .collect();
        assert_eq!(session_names, vec!["running-charlie", "running-delta", "running-echo"]);
        
        // All sessions should not be specs and not ready for merge
        for session in &filtered_sessions {
            assert_ne!(session.info.session_state, SessionState::Spec);
            assert!(!session.info.ready_to_merge);
        }
    }

    #[tokio::test]
    async fn test_filter_reviewed_sessions() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        let filtered_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name,
            FilterMode::Reviewed
        ).unwrap();

        // Should only have reviewed sessions
        assert_eq!(filtered_sessions.len(), 2);
        let session_names: Vec<&str> = filtered_sessions.iter()
            .map(|s| s.info.session_id.as_str())
            .collect();
        assert_eq!(session_names, vec!["reviewed-foxtrot", "reviewed-golf"]);
        
        // All sessions should be ready to merge
        for session in &filtered_sessions {
            assert!(session.info.ready_to_merge);
        }
    }

    #[tokio::test]
    async fn test_no_cache_consistency() {
        let (temp_dir, manager, _sessions) = setup_test_sessions();
        
        // Get initial sessions
        let initial_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name,
            FilterMode::All
        ).unwrap();
        let initial_count = initial_sessions.len();

        // Create a new session
        let new_session = create_test_session_with_repo("new-session", SessionStatus::Active, SessionState::Running, false, 1, Some(1), &temp_dir.path().to_path_buf());
        manager.db_ref().create_session(&new_session).unwrap();
        
        // Should immediately reflect the new session (no cache)
        let updated_sessions = manager.list_enriched_sessions_sorted(
            SortMode::Name,
            FilterMode::All
        ).unwrap();
        
        assert_eq!(updated_sessions.len(), initial_count + 1);
        
        // Should find the new session
        assert!(updated_sessions.iter().any(|s| s.info.session_id == "new-session"));
    }

    #[tokio::test]
    async fn test_combined_sort_and_filter() {
        let (_temp_dir, manager, _sessions) = setup_test_sessions();
        
        // Test spec sessions sorted by creation time
        let draft_by_created = manager.list_enriched_sessions_sorted(
            SortMode::Created,
            FilterMode::Spec
        ).unwrap();
        
        assert_eq!(draft_by_created.len(), 2);
        // Should be sorted newest first: spec-beta (30min ago), spec-alpha (60min ago)
        let names: Vec<&str> = draft_by_created.iter().map(|s| s.info.session_id.as_str()).collect();
        assert_eq!(names, vec!["spec-beta", "spec-alpha"]);
    }
}
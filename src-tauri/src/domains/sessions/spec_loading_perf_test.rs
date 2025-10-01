#[cfg(test)]
mod spec_loading_performance_tests {
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use crate::infrastructure::database::Database;
    use std::path::PathBuf;
    use std::time::Instant;
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir, Vec<String>) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let repo_path = PathBuf::from("/test/repo");

        let mut session_names = Vec::new();

        for i in 0..50 {
            let spec_content = format!("# Spec {}\n\nThis is a test specification with some content that would typically be stored in the database. It contains multiple lines and some reasonable amount of text to simulate real-world usage.\n\n## Details\n- Item 1\n- Item 2\n- Item 3\n\nMore content here to make it realistic.", i);

            let state = match i % 3 {
                0 => SessionState::Spec,
                1 => SessionState::Running,
                _ => SessionState::Reviewed,
            };

            let name = format!("test_session_{}", i);
            session_names.push(name.clone());

            let session = Session {
                id: format!("id_{}", i),
                name: name.clone(),
                display_name: Some(format!("Test Session {}", i)),
                version_group_id: None,
                version_number: None,
                repository_path: repo_path.clone(),
                repository_name: "test_repo".to_string(),
                branch: format!("branch_{}", i),
                parent_branch: "main".to_string(),
                worktree_path: PathBuf::from(format!("/test/worktree_{}", i)),
                status: SessionStatus::Active,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                last_activity: Some(chrono::Utc::now()),
                initial_prompt: Some(format!("Initial prompt {}", i)),
                ready_to_merge: false,
                original_agent_type: None,
                original_skip_permissions: None,
                pending_name_generation: false,
                was_auto_generated: false,
                spec_content: Some(spec_content),
                session_state: state,
                resume_allowed: true,
            };

            db.create_session(&session).unwrap();
        }

        (db, temp_dir, session_names)
    }

    #[test]
    fn benchmark_spec_loading_baseline() {
        let (db, _temp_dir, session_names) = setup_test_db();
        let repo_path = PathBuf::from("/test/repo");

        let start = Instant::now();
        for _ in 0..10 {
            for name in &session_names {
                let _ = db.get_session_task_content(&repo_path, name).unwrap();
            }
        }
        let duration = start.elapsed();

        let operations = 10 * session_names.len();
        let avg_micros = duration.as_micros() / operations as u128;

        println!(
            "\n=== BASELINE SPEC LOADING PERFORMANCE ===\nTotal operations: {}\nTotal time: {:?}\nAverage per operation: {}µs\n",
            operations, duration, avg_micros
        );

        assert!(
            avg_micros < 1000,
            "Baseline spec loading should be under 1ms per operation, got {}µs",
            avg_micros
        );
    }

    #[test]
    fn benchmark_spec_loading_with_cache() {
        use crate::domains::sessions::repository::SessionDbManager;

        let (db, _temp_dir, session_names) = setup_test_db();
        let repo_path = PathBuf::from("/test/repo");

        let manager = SessionDbManager::new(db, repo_path.clone());

        for name in &session_names {
            let _ = manager.get_session_task_content(name).unwrap();
        }

        let start = Instant::now();
        for _ in 0..100 {
            for name in &session_names {
                let _ = manager.get_session_task_content(name).unwrap();
            }
        }
        let duration = start.elapsed();

        let operations = 100 * session_names.len();
        let avg_micros = duration.as_micros() / operations as u128;

        println!(
            "\n=== CACHED SPEC LOADING PERFORMANCE ===\nTotal operations: {}\nTotal time: {:?}\nAverage per operation: {}µs\nSpeedup: ~{}x (baseline: 10µs)\n",
            operations, duration, avg_micros, 10 / avg_micros.max(1)
        );

        assert!(
            avg_micros <= 5,
            "Cached spec loading should be 5µs or under per operation (at least 2x faster than baseline), got {}µs",
            avg_micros
        );
    }
}

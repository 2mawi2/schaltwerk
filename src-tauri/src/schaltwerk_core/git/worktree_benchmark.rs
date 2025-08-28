#[cfg(test)]
mod benchmarks {
    use super::super::worktrees::*;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;
    use anyhow::Result;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::sync::atomic::{AtomicU32, Ordering};

    static WT_REPO_COUNTER: AtomicU32 = AtomicU32::new(0);
    static WT_TEST_MUTEX: Mutex<()> = Mutex::new(());

    struct TestRepo {
        _temp_dir: TempDir,
        repo_path: PathBuf,
        #[allow(dead_code)]
        repo_id: u32,
    }

    impl TestRepo {
        fn new() -> Result<Self> {
            let repo_id = WT_REPO_COUNTER.fetch_add(1, Ordering::SeqCst);
            let temp_dir = TempDir::with_prefix(&format!("git-wt-test-{}-", repo_id))?;
            let repo_path = temp_dir.path().to_path_buf();
            
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.email", &format!("test-wt-{}@example.com", repo_id)])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", &format!("Test WT User {}", repo_id)])
                .current_dir(&repo_path)
                .output()?;
            
            fs::write(repo_path.join("README.md"), "Initial commit")?;
            Command::new("git")
                .args(["add", "."])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["commit", "-m", "Initial commit"])
                .current_dir(&repo_path)
                .output()?;
            
            let current_branch_output = Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&repo_path)
                .output()?;
            
            if current_branch_output.status.success() {
                let current_branch = String::from_utf8_lossy(&current_branch_output.stdout).trim().to_string();
                if current_branch != "main" && !current_branch.is_empty() {
                    Command::new("git")
                        .args(["branch", "-m", &current_branch, "main"])
                        .current_dir(&repo_path)
                        .output()?;
                }
            }
            
            Ok(Self { 
                _temp_dir: temp_dir,
                repo_path,
                repo_id,
            })
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = Command::new("git")
                .args(["gc", "--prune=now"])
                .current_dir(&self.repo_path)
                .output();
        }
    }

    #[test]
    fn test_benchmark_create_worktree_from_base() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("test-worktree");
        
        create_worktree_from_base(&repo.repo_path, "test-branch", &worktree_path, "main")?;
        
        assert!(worktree_path.exists());
        assert!(worktree_path.join("README.md").exists());
        
        let branch_output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&worktree_path)
            .output()?;
        
        let binding = String::from_utf8_lossy(&branch_output.stdout);
        let branch_name = binding.trim();
        assert_eq!(branch_name, "test-branch");
        
        Ok(())
    }

    #[test]
    fn test_benchmark_create_multiple_worktrees() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        
        for i in 1..=3 {
            let worktree_path = repo._temp_dir.path().join(format!("worktree-{}", i));
            create_worktree_from_base(&repo.repo_path, &format!("branch-{}", i), &worktree_path, "main")?;
            assert!(worktree_path.exists());
        }
        
        let worktrees = list_worktrees(&repo.repo_path)?;
        assert!(worktrees.len() >= 3);
        
        Ok(())
    }

    #[test]
    fn test_benchmark_remove_worktree() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("to-remove");
        
        create_worktree_from_base(&repo.repo_path, "remove-me", &worktree_path, "main")?;
        assert!(worktree_path.exists());
        
        remove_worktree(&repo.repo_path, &worktree_path)?;
        assert!(!worktree_path.exists());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_list_worktrees() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let initial_worktrees = list_worktrees(&repo.repo_path)?;
        let initial_count = initial_worktrees.len();
        
        let worktree_path = repo._temp_dir.path().join("list-test");
        create_worktree_from_base(&repo.repo_path, "list-branch", &worktree_path, "main")?;
        
        let worktrees = list_worktrees(&repo.repo_path)?;
        assert!(worktrees.len() > initial_count);
        
        let found = worktrees.iter().any(|w| *w == worktree_path);
        assert!(found, "Created worktree should be in the list");
        
        Ok(())
    }

    #[test]
    fn test_benchmark_prune_worktrees() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        
        let result = prune_worktrees(&repo.repo_path);
        assert!(result.is_ok());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_update_worktree_branch() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("update-test");
        
        create_worktree_from_base(&repo.repo_path, "update-branch", &worktree_path, "main")?;
        
        fs::write(worktree_path.join("test-file.txt"), "test content")?;
        
        let result = update_worktree_branch(&worktree_path, "update-branch");
        assert!(result.is_ok());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_is_worktree_registered() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("registered-test");
        
        assert!(!is_worktree_registered(&repo.repo_path, &worktree_path)?);
        
        create_worktree_from_base(&repo.repo_path, "registered-branch", &worktree_path, "main")?;
        
        assert!(is_worktree_registered(&repo.repo_path, &worktree_path)?);
        
        Ok(())
    }

    #[test]
    fn test_benchmark_worktree_with_complex_branch_names() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        
        let complex_names = vec![
            "feature/user-auth",
            "hotfix/critical-bug-123",
            "release/v1.2.3",
        ];
        
        for (i, branch_name) in complex_names.iter().enumerate() {
            let worktree_path = repo._temp_dir.path().join(format!("complex-{}", i));
            create_worktree_from_base(&repo.repo_path, branch_name, &worktree_path, "main")?;
            
            let branch_output = Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&worktree_path)
                .output()?;
            
            let binding = String::from_utf8_lossy(&branch_output.stdout);
            let actual_branch = binding.trim();
            assert_eq!(actual_branch, *branch_name);
        }
        
        Ok(())
    }

    #[test]
    fn test_benchmark_concurrent_worktree_operations() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = Arc::new(TestRepo::new()?);
        let success_count = Arc::new(Mutex::new(0));
        
        let handles: Vec<_> = (0..3)
            .map(|i| {
                let repo = Arc::clone(&repo);
                let success_count = Arc::clone(&success_count);
                
                thread::spawn(move || {
                    let worktree_path = repo._temp_dir.path().join(format!("concurrent-{}", i));
                    let branch_name = format!("concurrent-branch-{}", i);
                    
                    if create_worktree_from_base(&repo.repo_path, &branch_name, &worktree_path, "main").is_ok() {
                        *success_count.lock().unwrap() += 1;
                    }
                })
            })
            .collect();
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let successes = *success_count.lock().unwrap();
        assert!(successes >= 1, "At least one concurrent operation should succeed");
        
        Ok(())
    }

    #[test]
    fn test_benchmark_worktree_with_uncommitted_changes() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("uncommitted-test");
        
        create_worktree_from_base(&repo.repo_path, "uncommitted-branch", &worktree_path, "main")?;
        
        fs::write(worktree_path.join("uncommitted.txt"), "uncommitted changes")?;
        
        let result = update_worktree_branch(&worktree_path, "uncommitted-branch");
        assert!(result.is_ok());
        
        assert!(worktree_path.join("uncommitted.txt").exists());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_worktree_stress_many_files() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("stress-test");
        
        create_worktree_from_base(&repo.repo_path, "stress-branch", &worktree_path, "main")?;
        
        for i in 0..50 {
            fs::write(
                worktree_path.join(format!("file_{}.txt", i)),
                format!("Content for file {}", i),
            )?;
        }
        
        Command::new("git")
            .args(["add", "."])
            .current_dir(&worktree_path)
            .output()?;
        
        Command::new("git")
            .args(["commit", "-m", "Add many files"])
            .current_dir(&worktree_path)
            .output()?;
        
        let result = update_worktree_branch(&worktree_path, "stress-branch");
        assert!(result.is_ok());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_worktree_cleanup_on_removal() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        let worktree_path = repo._temp_dir.path().join("cleanup-test");
        
        create_worktree_from_base(&repo.repo_path, "cleanup-branch", &worktree_path, "main")?;
        
        fs::write(worktree_path.join("cleanup-file.txt"), "cleanup content")?;
        
        let initial_worktrees = list_worktrees(&repo.repo_path)?;
        let initial_count = initial_worktrees.len();
        
        remove_worktree(&repo.repo_path, &worktree_path)?;
        
        let final_worktrees = list_worktrees(&repo.repo_path)?;
        assert!(final_worktrees.len() < initial_count);
        
        assert!(!worktree_path.exists());
        
        Ok(())
    }

    #[test]
    fn test_benchmark_worktree_edge_cases() -> Result<()> {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        
        let repo = TestRepo::new()?;
        
        let nonexistent_path = repo._temp_dir.path().join("nonexistent");
        let result = is_worktree_registered(&repo.repo_path, &nonexistent_path);
        assert!(result.is_ok());
        assert!(!result.unwrap());
        
        let result = remove_worktree(&repo.repo_path, &nonexistent_path);
        assert!(result.is_err());
        
        Ok(())
    }
}
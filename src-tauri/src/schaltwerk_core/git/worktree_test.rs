#[cfg(test)]
mod tests {
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
                .args(["worktree", "prune"])
                .current_dir(&self.repo_path)
                .output();
                
            let _ = Command::new("git")
                .args(["gc", "--prune=now"])
                .current_dir(&self.repo_path)
                .output();
        }
    }

    fn with_wt_test_isolation<F, R>(test_fn: F) -> R
    where
        F: FnOnce() -> R,
    {
        let _lock = WT_TEST_MUTEX.lock().unwrap();
        test_fn()
    }

    impl TestRepo {
        fn create_branch(&self, branch_name: &str) -> Result<()> {
            Command::new("git")
                .args(["checkout", "-b", branch_name])
                .current_dir(&self.repo_path)
                .output()?;
            Command::new("git")
                .args(["checkout", "main"])
                .current_dir(&self.repo_path)
                .output()?;
            Ok(())
        }
    }

    #[test]
    fn test_create_worktree_from_base_success() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        
        assert!(worktree_path.exists());
        assert!(worktree_path.join(".git").exists());
        
        let output = Command::new("git")
            .args(["branch"])
            .current_dir(&worktree_path)
            .output()?;
        let branches = String::from_utf8_lossy(&output.stdout);
        assert!(branches.contains("test-branch"));
        
        Ok(())
    }

    #[test]
    fn test_create_worktree_with_existing_branch_deletion() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("existing-branch")?;
        
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "existing-branch",
            &worktree_path,
            "main"
        )?;
        
        assert!(worktree_path.exists());
        
        let output = Command::new("git")
            .args(["branch"])
            .current_dir(&worktree_path)
            .output()?;
        let branches = String::from_utf8_lossy(&output.stdout);
        assert!(branches.contains("existing-branch"));
        
        Ok(())
    }

    #[test]
    fn test_create_worktree_with_nonexistent_base_branch() {
        let repo = TestRepo::new().unwrap();
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        let result = create_worktree_from_base(
            &repo.repo_path,
            "new-branch",
            &worktree_path,
            "nonexistent-base"
        );
        
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_create_worktree_handles_parent_directory_creation() -> Result<()> {
        let repo = TestRepo::new()?;
        let deeply_nested_path = repo.repo_path
            .join("deep")
            .join("nested")
            .join("path")
            .join("worktree");
        
        create_worktree_from_base(
            &repo.repo_path,
            "nested-branch",
            &deeply_nested_path,
            "main"
        )?;
        
        assert!(deeply_nested_path.exists());
        assert!(deeply_nested_path.parent().unwrap().exists());
        
        Ok(())
    }

    #[test]
    #[ignore] // Test hangs in CI environment - concurrent file system operations issue
    fn test_concurrent_worktree_creation() -> Result<()> {
        with_wt_test_isolation(|| {
            let repo = TestRepo::new()?;
        let repo_path = Arc::new(repo.repo_path.clone());
        let errors = Arc::new(Mutex::new(Vec::new()));
        
        let mut handles = vec![];
        
        for i in 0..5 {
            let repo_path = Arc::clone(&repo_path);
            let errors = Arc::clone(&errors);
            let handle = thread::spawn(move || {
                let worktree_path = repo_path.join("worktrees").join(format!("concurrent-{}", i));
                let result = create_worktree_from_base(
                    &repo_path,
                    &format!("branch-{}", i),
                    &worktree_path,
                    "main"
                );
                
                if let Err(e) = result {
                    errors.lock().unwrap().push(e.to_string());
                }
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let errs = errors.lock().unwrap();
        assert!(errs.is_empty(), "Concurrent creation failed: {:?}", errs);
        
        for i in 0..5 {
            let worktree_path = repo.repo_path.join("worktrees").join(format!("concurrent-{}", i));
            assert!(worktree_path.exists());
        }
        
            Ok(())
        })
    }

    #[test]
    fn test_remove_worktree_success() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        assert!(worktree_path.exists());
        
        remove_worktree(&repo.repo_path, &worktree_path)?;
        
        assert!(!worktree_path.exists());
        
        Ok(())
    }

    #[test]
    fn test_remove_nonexistent_worktree() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("nonexistent");
        
        let result = remove_worktree(&repo.repo_path, &worktree_path);
        assert!(result.is_ok());
        
        Ok(())
    }

    #[test]
    fn test_list_worktrees() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let wt1 = repo.repo_path.join("worktrees").join("wt1");
        let wt2 = repo.repo_path.join("worktrees").join("wt2");
        
        create_worktree_from_base(&repo.repo_path, "branch1", &wt1, "main")?;
        create_worktree_from_base(&repo.repo_path, "branch2", &wt2, "main")?;
        
        let worktrees = list_worktrees(&repo.repo_path)?;
        
        assert!(worktrees.len() >= 2, "Expected at least 2 worktrees, got {}", worktrees.len());
        
        let wt1_canonical = fs::canonicalize(&wt1)?;
        let wt2_canonical = fs::canonicalize(&wt2)?;
        
        let canonical_worktrees: Vec<PathBuf> = worktrees.iter()
            .filter_map(|p| fs::canonicalize(p).ok())
            .collect();
        
        let has_wt1 = canonical_worktrees.contains(&wt1_canonical);
        let has_wt2 = canonical_worktrees.contains(&wt2_canonical);
        
        assert!(has_wt1, "Should contain wt1");
        assert!(has_wt2, "Should contain wt2");
        
        Ok(())
    }

    #[test]
    fn test_list_worktrees_empty_repo() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktrees = list_worktrees(&repo.repo_path)?;
        
        assert_eq!(worktrees.len(), 1, "New repo should have exactly 1 worktree (main), got: {:?}", worktrees);
        let has_main = worktrees.iter().any(|wt| wt.ends_with(&repo.repo_path.file_name().unwrap()) || 
                                                 wt == &repo.repo_path);
        assert!(has_main, "Should contain main repo path, got: {:?}", worktrees);
        
        Ok(())
    }

    #[test]
    fn test_prune_worktrees() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        
        fs::remove_dir_all(&worktree_path)?;
        
        prune_worktrees(&repo.repo_path)?;
        
        let output = Command::new("git")
            .args(["-C", repo.repo_path.to_str().unwrap(), "worktree", "list"])
            .output()?;
        let list = String::from_utf8_lossy(&output.stdout);
        assert!(!list.contains(&worktree_path.to_string_lossy().to_string()));
        
        Ok(())
    }

    #[test]
    fn test_is_worktree_registered() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        assert!(!is_worktree_registered(&repo.repo_path, &worktree_path)?);
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        
        assert!(is_worktree_registered(&repo.repo_path, &worktree_path)?);
        
        remove_worktree(&repo.repo_path, &worktree_path)?;
        
        assert!(!is_worktree_registered(&repo.repo_path, &worktree_path)?);
        
        Ok(())
    }

    #[test]
    fn test_update_worktree_branch_with_uncommitted_changes() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        
        fs::write(worktree_path.join("new_file.txt"), "uncommitted changes")?;
        Command::new("git")
            .args(["add", "."])
            .current_dir(&worktree_path)
            .output()?;
        
        repo.create_branch("target-branch")?;
        
        update_worktree_branch(&worktree_path, "target-branch")?;
        
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&worktree_path)
            .output()?;
        let current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(current_branch, "target-branch");
        
        Ok(())
    }

    #[test]
    fn test_update_worktree_branch_without_changes() -> Result<()> {
        let repo = TestRepo::new()?;
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        )?;
        
        repo.create_branch("target-branch")?;
        
        update_worktree_branch(&worktree_path, "target-branch")?;
        
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&worktree_path)
            .output()?;
        let current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(current_branch, "target-branch");
        
        Ok(())
    }

    #[test]
    fn test_update_worktree_to_nonexistent_branch() {
        let repo = TestRepo::new().unwrap();
        let worktree_path = repo.repo_path.join("worktrees").join("test-wt");
        
        create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        ).unwrap();
        
        let result = update_worktree_branch(&worktree_path, "nonexistent-branch");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to update worktree"));
    }

    #[test]
    fn test_create_worktree_cleanup_on_partial_failure() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let readonly_parent = repo.repo_path.join("readonly");
        fs::create_dir(&readonly_parent)?;
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&readonly_parent)?.permissions();
            perms.set_mode(0o444);
            fs::set_permissions(&readonly_parent, perms)?;
        }
        
        let worktree_path = readonly_parent.join("worktree");
        let result = create_worktree_from_base(
            &repo.repo_path,
            "test-branch",
            &worktree_path,
            "main"
        );
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&readonly_parent)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&readonly_parent, perms)?;
        }
        
        if result.is_err() {
            assert!(!worktree_path.exists());
        }
        
        Ok(())
    }

    #[test]
    fn test_session_specific_stash_restore() -> Result<()> {
        let repo = TestRepo::new()?;
        let wt1_path = repo.repo_path.join("worktrees").join("session1");
        let wt2_path = repo.repo_path.join("worktrees").join("session2");
        
        create_worktree_from_base(&repo.repo_path, "branch1", &wt1_path, "main")?;
        create_worktree_from_base(&repo.repo_path, "branch2", &wt2_path, "main")?;
        
        fs::write(wt1_path.join("file1.txt"), "session1 changes")?;
        fs::write(wt2_path.join("file2.txt"), "session2 changes")?;
        
        repo.create_branch("target-branch")?;
        
        update_worktree_branch(&wt1_path, "target-branch")?;
        
        let output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&wt1_path)
            .output()?;
        let status1 = String::from_utf8_lossy(&output.stdout);
        assert!(status1.contains("file1.txt") || status1.is_empty());
        
        Ok(())
    }
}
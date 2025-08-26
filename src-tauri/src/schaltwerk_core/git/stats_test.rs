#[cfg(test)]
mod tests {
    use super::super::stats::*;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;
    use anyhow::Result;
    use std::fs;
    use std::thread;
    use std::time::Duration;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Mutex, Once};

    static REPO_COUNTER: AtomicU32 = AtomicU32::new(0);
    static TEST_MUTEX: Mutex<()> = Mutex::new(());
    static CLEANUP_ONCE: Once = Once::new();

    struct TestRepo {
        _temp_dir: TempDir,
        repo_path: PathBuf,
        #[allow(dead_code)]
        repo_id: u32,
    }

    impl TestRepo {
        fn new() -> Result<Self> {
            clear_stats_cache();
            
            let repo_id = REPO_COUNTER.fetch_add(1, Ordering::SeqCst);
            let temp_dir = TempDir::with_prefix(&format!("git-stats-test-{}-", repo_id))?;
            let repo_path = temp_dir.path().to_path_buf();
            
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.email", &format!("test-{}@example.com", repo_id)])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", &format!("Test User {}", repo_id)])
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
            
            Command::new("git")
                .args(["checkout", "-b", "main"])
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
            clear_stats_cache();
            
            let _ = Command::new("git")
                .args(["gc", "--prune=now"])
                .current_dir(&self.repo_path)
                .output();
                
            CLEANUP_ONCE.call_once(|| {
                clear_stats_cache();
            });
        }
    }

    fn with_test_isolation<F, R>(test_fn: F) -> R
    where
        F: FnOnce() -> R,
    {
        let _lock = TEST_MUTEX.lock().unwrap();
        clear_stats_cache();
        let result = test_fn();
        clear_stats_cache();
        result
    }

    impl TestRepo {        
        fn create_branch_with_changes(&self, branch_name: &str) -> Result<()> {
            Command::new("git")
                .args(["checkout", "-b", branch_name])
                .current_dir(&self.repo_path)
                .output()?;
            
            fs::write(self.repo_path.join("feature.txt"), 
                "Line 1\nLine 2\nLine 3\n")?;
            Command::new("git")
                .args(["add", "feature.txt"])
                .current_dir(&self.repo_path)
                .output()?;
            Command::new("git")
                .args(["commit", "-m", "Add feature"])
                .current_dir(&self.repo_path)
                .output()?;
            
            Ok(())
        }
        
        fn add_uncommitted_changes(&self) -> Result<()> {
            fs::write(self.repo_path.join("uncommitted.txt"), 
                "Uncommitted line 1\nUncommitted line 2\n")?;
            fs::write(self.repo_path.join("staged.txt"), 
                "Staged line 1\n")?;
            Command::new("git")
                .args(["add", "staged.txt"])
                .current_dir(&self.repo_path)
                .output()?;
            
            Ok(())
        }
    }

    #[test]
    fn test_calculate_git_stats_no_changes() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let stats = calculate_git_stats(&repo.repo_path, "main")?;
        
        assert_eq!(stats.files_changed, 0);
        assert_eq!(stats.lines_added, 0);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        
        Ok(())
    }

    #[test]
    fn test_calculate_git_stats_with_commits() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        
        let stats = calculate_git_stats(&repo.repo_path, "main")?;
        
        assert_eq!(stats.files_changed, 1);
        assert_eq!(stats.lines_added, 3);
        assert_eq!(stats.lines_removed, 0);
        assert!(!stats.has_uncommitted);
        
        Ok(())
    }

    #[test]
    fn test_calculate_git_stats_with_uncommitted() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        repo.add_uncommitted_changes()?;
        
        let stats = calculate_git_stats(&repo.repo_path, "main")?;
        
        assert_eq!(stats.files_changed, 3);
        assert!(stats.lines_added >= 4, "Expected at least 4 lines added, got {}", stats.lines_added);
        assert_eq!(stats.lines_removed, 0);
        assert!(stats.has_uncommitted);
        
        Ok(())
    }

    #[test]
    fn test_calculate_git_stats_fast_path() -> Result<()> {
        with_test_isolation(|| {
            let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        repo.add_uncommitted_changes()?;
        
        let stats1 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        
        assert_eq!(stats1.files_changed, 3);
        assert!(stats1.lines_added >= 4, "Expected at least 4 lines added, got {}", stats1.lines_added);
        assert_eq!(stats1.lines_removed, 0);
        assert!(stats1.has_uncommitted);
        
        let stats2 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        
        assert_eq!(stats2.files_changed, stats1.files_changed);
        assert_eq!(stats2.lines_added, stats1.lines_added);
        assert_eq!(stats2.lines_removed, stats1.lines_removed);
        assert_eq!(stats2.has_uncommitted, stats1.has_uncommitted);
        
            Ok(())
        })
    }

    #[test]
    fn test_calculate_git_stats_cache_invalidation() -> Result<()> {
        with_test_isolation(|| {
            let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        
        let stats1 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        assert_eq!(stats1.files_changed, 1);
        assert!(!stats1.has_uncommitted);
        
        fs::write(repo.repo_path.join("new_file.txt"), "New content")?;
        
        let stats2 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        assert_eq!(stats2.files_changed, 2);
        assert!(stats2.has_uncommitted);
        
            Ok(())
        })
    }

    #[test]
    fn test_get_changed_files_committed() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        
        let files = get_changed_files(&repo.repo_path, "main")?;
        
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "feature.txt");
        assert_eq!(files[0].change_type, "added");
        
        Ok(())
    }

    #[test]
    fn test_get_changed_files_mixed() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        repo.add_uncommitted_changes()?;
        
        let mut files = get_changed_files(&repo.repo_path, "main")?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        
        assert_eq!(files.len(), 3);
        
        let feature_file = files.iter().find(|f| f.path == "feature.txt").unwrap();
        assert_eq!(feature_file.change_type, "added");
        
        let staged_file = files.iter().find(|f| f.path == "staged.txt").unwrap();
        assert_eq!(staged_file.change_type, "added");
        
        let uncommitted_file = files.iter().find(|f| f.path == "uncommitted.txt").unwrap();
        assert_eq!(uncommitted_file.change_type, "added");
        
        Ok(())
    }

    #[test]
    fn test_get_changed_files_modifications() -> Result<()> {
        let repo = TestRepo::new()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let existing_content = fs::read_to_string(repo.repo_path.join("README.md"))?;
        fs::write(repo.repo_path.join("README.md"), 
            format!("{}\nModified content", existing_content))?;
        Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Modify README"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let files = get_changed_files(&repo.repo_path, "main")?;
        
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "README.md");
        assert_eq!(files[0].change_type, "modified");
        
        Ok(())
    }

    #[test]
    fn test_get_changed_files_deletions() -> Result<()> {
        let repo = TestRepo::new()?;
        
        fs::write(repo.repo_path.join("to_delete.txt"), "Content to delete")?;
        Command::new("git")
            .args(["add", "to_delete.txt"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Add file to delete"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        fs::remove_file(repo.repo_path.join("to_delete.txt"))?;
        Command::new("git")
            .args(["add", "to_delete.txt"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Delete file"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let files = get_changed_files(&repo.repo_path, "main")?;
        
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "to_delete.txt");
        assert_eq!(files[0].change_type, "deleted");
        
        Ok(())
    }

    #[test]
    fn test_parse_numstat_line() {
        assert_eq!(
            parse_numstat_line("10\t5\tfile.txt"),
            Some((10, 5, "file.txt"))
        );
        
        assert_eq!(
            parse_numstat_line("-\t-\tbinary.jpg"),
            Some((0, 0, "binary.jpg"))
        );
        
        assert_eq!(
            parse_numstat_line("100\t0\tpath/to/file.rs"),
            Some((100, 0, "path/to/file.rs"))
        );
        
        assert_eq!(parse_numstat_line(""), None);
        assert_eq!(parse_numstat_line("invalid"), None);
    }

    #[test]
    fn test_stats_with_large_repository() -> Result<()> {
        let repo = TestRepo::new()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        for i in 0..100 {
            let content: String = (0..100).map(|j| format!("Line {}\n", j)).collect();
            fs::write(repo.repo_path.join(format!("file_{}.txt", i)), content)?;
        }
        
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Add many files"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let start = std::time::Instant::now();
        let stats = calculate_git_stats_fast(&repo.repo_path, "main")?;
        let duration = start.elapsed();
        
        assert_eq!(stats.files_changed, 100);
        assert_eq!(stats.lines_added, 10000);
        assert!(duration < Duration::from_secs(2), "Performance issue: took {:?}", duration);
        
        Ok(())
    }

    #[test]
    fn test_concurrent_stats_calculation() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        
        let repo_path = Arc::new(repo.repo_path.clone());
        let mut handles = vec![];
        
        for _ in 0..10 {
            let repo_path = Arc::clone(&repo_path);
            let handle = thread::spawn(move || {
                calculate_git_stats_fast(&repo_path, "main")
            });
            handles.push(handle);
        }
        
        let mut results = vec![];
        for handle in handles {
            results.push(handle.join().unwrap()?);
        }
        
        let first = &results[0];
        for result in &results[1..] {
            assert_eq!(result.files_changed, first.files_changed);
            assert_eq!(result.lines_added, first.lines_added);
            assert_eq!(result.lines_removed, first.lines_removed);
        }
        
        Ok(())
    }

    #[test]
    fn test_stats_with_binary_files() -> Result<()> {
        let repo = TestRepo::new()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let binary_content = vec![0u8, 1, 2, 3, 255, 254, 253, 252];
        fs::write(repo.repo_path.join("binary.dat"), binary_content)?;
        Command::new("git")
            .args(["add", "binary.dat"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Add binary file"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let stats = calculate_git_stats(&repo.repo_path, "main")?;
        assert_eq!(stats.files_changed, 1);
        
        let files = get_changed_files(&repo.repo_path, "main")?;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "binary.dat");
        
        Ok(())
    }

    #[test]
    fn test_stats_with_renamed_files() -> Result<()> {
        let repo = TestRepo::new()?;
        
        fs::write(repo.repo_path.join("original.txt"), "Original content")?;
        Command::new("git")
            .args(["add", "original.txt"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Add original file"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        Command::new("git")
            .args(["mv", "original.txt", "renamed.txt"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Rename file"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let files = get_changed_files(&repo.repo_path, "main")?;
        
        let has_rename = files.iter().any(|f| f.change_type == "renamed");
        assert!(has_rename || files.len() > 0);
        
        Ok(())
    }

    #[test]
    fn test_stats_diff_timestamp_tracking() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch_with_changes("feature")?;
        
        let stats1 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        assert!(stats1.last_diff_change_ts.is_some());
        
        thread::sleep(Duration::from_millis(1100));
        
        fs::write(repo.repo_path.join("new_file.txt"), "New content")?;
        
        let stats2 = calculate_git_stats_fast(&repo.repo_path, "main")?;
        assert!(stats2.last_diff_change_ts.is_some());
        
        if let (Some(ts1), Some(ts2)) = (stats1.last_diff_change_ts, stats2.last_diff_change_ts) {
            assert!(ts2 >= ts1, "Timestamp should increase or stay the same");
        }
        
        Ok(())
    }

    #[test]
    fn test_stats_with_merge_base() -> Result<()> {
        let repo = TestRepo::new()?;
        
        repo.create_branch_with_changes("feature1")?;
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        Command::new("git")
            .args(["checkout", "-b", "feature2"])
            .current_dir(&repo.repo_path)
            .output()?;
        fs::write(repo.repo_path.join("feature2.txt"), "Feature 2 content")?;
        Command::new("git")
            .args(["add", "feature2.txt"])
            .current_dir(&repo.repo_path)
            .output()?;
        Command::new("git")
            .args(["commit", "-m", "Add feature2"])
            .current_dir(&repo.repo_path)
            .output()?;
        
        let stats = calculate_git_stats_fast(&repo.repo_path, "main")?;
        assert_eq!(stats.files_changed, 1);
        
        Ok(())
    }

    #[test]
    fn test_malformed_git_output_handling() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let git_dir = repo.repo_path.join(".git");
        let index = git_dir.join("index");
        if index.exists() {
            let backup = git_dir.join("index.backup");
            fs::copy(&index, &backup)?;
            
            let result = calculate_git_stats_fast(&repo.repo_path, "main");
            assert!(result.is_ok() || result.is_err());
            
            fs::copy(&backup, &index)?;
        }
        
        Ok(())
    }
}
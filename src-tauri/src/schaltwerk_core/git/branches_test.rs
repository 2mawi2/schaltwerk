#[cfg(test)]
mod tests {
    use super::super::branches::*;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;
    use anyhow::Result;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;
    use std::sync::atomic::{AtomicU32, Ordering};

    static BR_REPO_COUNTER: AtomicU32 = AtomicU32::new(0);

    struct TestRepo {
        _temp_dir: TempDir,
        repo_path: PathBuf,
        #[allow(dead_code)]
        repo_id: u32,
    }

    impl TestRepo {
        fn new() -> Result<Self> {
            let repo_id = BR_REPO_COUNTER.fetch_add(1, Ordering::SeqCst);
            let temp_dir = TempDir::with_prefix(&format!("git-br-test-{}-", repo_id))?;
            let repo_path = temp_dir.path().to_path_buf();
            
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.email", &format!("test-br-{}@example.com", repo_id)])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", &format!("Test BR User {}", repo_id)])
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
            
            // Rename default branch to main for consistency
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
        
        fn new_without_commits() -> Result<Self> {
            let repo_id = BR_REPO_COUNTER.fetch_add(1, Ordering::SeqCst);
            let temp_dir = TempDir::with_prefix(&format!("git-br-nocommit-test-{}-", repo_id))?;
            let repo_path = temp_dir.path().to_path_buf();
            
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.email", &format!("test-br-{}@example.com", repo_id)])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", &format!("Test BR User {}", repo_id)])
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
                .args(["gc", "--prune=now"])
                .current_dir(&self.repo_path)
                .output();
        }
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
        
        fn create_remote_branch(&self, branch_name: &str) -> Result<()> {
            let remote_dir = self.repo_path.join("remote");
            fs::create_dir(&remote_dir)?;
            
            Command::new("git")
                .args(["init", "--bare"])
                .current_dir(&remote_dir)
                .output()?;
            
            Command::new("git")
                .args(["remote", "add", "origin", remote_dir.to_str().unwrap()])
                .current_dir(&self.repo_path)
                .output()?;
            
            Command::new("git")
                .args(["checkout", "-b", branch_name])
                .current_dir(&self.repo_path)
                .output()?;
            
            fs::write(self.repo_path.join("remote_file.txt"), "remote content")?;
            Command::new("git")
                .args(["add", "."])
                .current_dir(&self.repo_path)
                .output()?;
            Command::new("git")
                .args(["commit", "-m", "Remote branch commit"])
                .current_dir(&self.repo_path)
                .output()?;
            
            Command::new("git")
                .args(["push", "origin", branch_name])
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
    fn test_list_branches_with_commits() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("feature-branch")?;
        repo.create_branch("bugfix-branch")?;
        
        let branches = list_branches(&repo.repo_path)?;
        
        assert!(branches.contains(&"main".to_string()));
        assert!(branches.contains(&"feature-branch".to_string()));
        assert!(branches.contains(&"bugfix-branch".to_string()));
        assert_eq!(branches.len(), 3);
        
        Ok(())
    }

    #[test]
    fn test_list_branches_without_commits() -> Result<()> {
        let repo = TestRepo::new_without_commits()?;
        
        let branches = list_branches(&repo.repo_path)?;
        
        // In an empty repo with no commits, the branch list could be empty
        // or contain the default branch name depending on git version
        assert!(branches.is_empty() || 
                branches.contains(&"main".to_string()) || 
                branches.contains(&"master".to_string()));
        
        if !branches.is_empty() {
            assert_eq!(branches.len(), 1);
        }
        
        Ok(())
    }

    #[test]
    fn test_list_branches_with_remote() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("local-branch")?;
        repo.create_remote_branch("remote-branch")?;
        
        let branches = list_branches(&repo.repo_path)?;
        
        assert!(branches.contains(&"main".to_string()));
        assert!(branches.contains(&"local-branch".to_string()));
        assert!(branches.contains(&"remote-branch".to_string()));
        assert!(!branches.iter().any(|b| b.contains("origin/")));
        assert!(!branches.iter().any(|b| b.contains("HEAD")));
        
        Ok(())
    }

    #[test]
    fn test_list_branches_sorted_and_deduplicated() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("zebra")?;
        repo.create_branch("alpha")?;
        repo.create_branch("beta")?;
        
        let branches = list_branches(&repo.repo_path)?;
        
        let mut expected = branches.clone();
        expected.sort();
        expected.dedup();
        assert_eq!(branches, expected);
        
        assert!(branches.iter().position(|b| b == "alpha").unwrap() 
            < branches.iter().position(|b| b == "beta").unwrap());
        assert!(branches.iter().position(|b| b == "beta").unwrap() 
            < branches.iter().position(|b| b == "zebra").unwrap());
        
        Ok(())
    }

    #[test]
    fn test_delete_branch_success() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("to-delete")?;
        
        assert!(branch_exists(&repo.repo_path, "to-delete")?);
        
        delete_branch(&repo.repo_path, "to-delete")?;
        
        assert!(!branch_exists(&repo.repo_path, "to-delete")?);
        
        Ok(())
    }

    #[test]
    fn test_delete_nonexistent_branch() {
        let repo = TestRepo::new().unwrap();
        
        let result = delete_branch(&repo.repo_path, "nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to delete branch"));
    }

    #[test]
    fn test_branch_exists() -> Result<()> {
        let repo = TestRepo::new()?;
        
        assert!(branch_exists(&repo.repo_path, "main")?);
        assert!(!branch_exists(&repo.repo_path, "nonexistent")?);
        
        repo.create_branch("new-branch")?;
        assert!(branch_exists(&repo.repo_path, "new-branch")?);
        
        Ok(())
    }

    #[test]
    fn test_rename_branch_success() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("old-name")?;
        
        assert!(branch_exists(&repo.repo_path, "old-name")?);
        assert!(!branch_exists(&repo.repo_path, "new-name")?);
        
        rename_branch(&repo.repo_path, "old-name", "new-name")?;
        
        assert!(!branch_exists(&repo.repo_path, "old-name")?);
        assert!(branch_exists(&repo.repo_path, "new-name")?);
        
        Ok(())
    }

    #[test]
    fn test_rename_nonexistent_branch() {
        let repo = TestRepo::new().unwrap();
        
        let result = rename_branch(&repo.repo_path, "nonexistent", "new-name");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_rename_to_existing_branch() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("branch1")?;
        repo.create_branch("branch2")?;
        
        let result = rename_branch(&repo.repo_path, "branch1", "branch2");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("already exists"));
        
        Ok(())
    }

    #[test]
    fn test_archive_branch_success() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("to-archive")?;
        
        assert!(branch_exists(&repo.repo_path, "to-archive")?);
        
        let archived_name = archive_branch(&repo.repo_path, "to-archive", "session1")?;
        
        assert!(!branch_exists(&repo.repo_path, "to-archive")?);
        assert!(branch_exists(&repo.repo_path, &archived_name)?);
        assert!(archived_name.starts_with("schaltwerk/archived/"));
        assert!(archived_name.ends_with("/session1"));
        // Unix timestamp should be numeric (at least 10 digits for modern timestamps)
        let timestamp_part = archived_name.strip_prefix("schaltwerk/archived/")
            .and_then(|s| s.split('/').next())
            .expect("Should contain timestamp");
        assert!(timestamp_part.parse::<u64>().is_ok(), "Timestamp should be numeric");
        assert!(timestamp_part.len() >= 10, "Timestamp should be at least 10 digits");
        
        Ok(())
    }

    #[test]
    fn test_archive_branch_with_timestamp() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("branch1")?;
        repo.create_branch("branch2")?;
        
        let archived1 = archive_branch(&repo.repo_path, "branch1", "session1")?;
        
        thread::sleep(Duration::from_millis(1100));
        
        let archived2 = archive_branch(&repo.repo_path, "branch2", "session2")?;
        
        assert_ne!(archived1, archived2);
        assert!(archived1 < archived2);
        
        Ok(())
    }

    #[test]
    fn test_archive_nonexistent_branch() {
        let repo = TestRepo::new().unwrap();
        
        let result = archive_branch(&repo.repo_path, "nonexistent", "session1");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to archive branch"));
    }

    #[test]
    fn test_concurrent_branch_operations() -> Result<()> {
        let repo = TestRepo::new()?;
        let repo_path = Arc::new(repo.repo_path.clone());
        let success_count = Arc::new(Mutex::new(0));
        
        for i in 0..3 {
            repo.create_branch(&format!("concurrent-{}", i))?;
        }
        
        let mut handles = vec![];
        
        for i in 0..3 {
            let repo_path = Arc::clone(&repo_path);
            let success_count = Arc::clone(&success_count);
            
            let handle = thread::spawn(move || {
                thread::sleep(Duration::from_millis(i * 50));
                
                let old_name = format!("concurrent-{}", i);
                let new_name = format!("renamed-{}", i);
                
                if rename_branch(&repo_path, &old_name, &new_name).is_ok() {
                    *success_count.lock().unwrap() += 1;
                }
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let successes = *success_count.lock().unwrap();
        assert!(successes >= 1, "At least one concurrent operation should succeed");
        
        Ok(())
    }

    #[test]
    fn test_branch_name_collision_detection() -> Result<()> {
        let repo = TestRepo::new()?;
        repo.create_branch("branch1")?;
        repo.create_branch("branch2")?;
        
        let archived1 = archive_branch(&repo.repo_path, "branch1", "samename")?;
        assert!(archived1.contains("samename"));
        assert!(branch_exists(&repo.repo_path, &archived1)?);
        
        repo.create_branch("branch3")?;
        let short_name = archived1.split('/').last().unwrap();
        let result = rename_branch(&repo.repo_path, "branch3", short_name);
        
        if result.is_ok() {
            assert!(branch_exists(&repo.repo_path, short_name)?);
            assert!(!branch_exists(&repo.repo_path, "branch3")?);
        }
        
        Ok(())
    }

    #[test]
    fn test_repository_corruption_recovery() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let git_dir = repo.repo_path.join(".git");
        let refs_dir = git_dir.join("refs").join("heads");
        fs::write(refs_dir.join("corrupted"), "invalid-hash")?;
        
        let result = branch_exists(&repo.repo_path, "corrupted");
        assert!(result.is_ok());
        assert!(!result.unwrap());
        
        let branches = list_branches(&repo.repo_path);
        assert!(branches.is_ok());
        
        Ok(())
    }

    #[test]
    fn test_special_characters_in_branch_names() -> Result<()> {
        let repo = TestRepo::new()?;
        
        let valid_special_names = vec![
            "feature/test-123",
            "bugfix-#456",
            "release_v1.0.0",
        ];
        
        for name in valid_special_names {
            repo.create_branch(name)?;
            assert!(branch_exists(&repo.repo_path, name)?);
            delete_branch(&repo.repo_path, name)?;
        }
        
        Ok(())
    }
}
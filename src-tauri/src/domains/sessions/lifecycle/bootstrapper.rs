use crate::domains::git::service as git;
use crate::domains::sessions::utils::SessionUtils;
use anyhow::{Context, Result, anyhow};
use log::{info, warn};
use std::path::{Path, PathBuf};

pub struct WorktreeBootstrapper<'a> {
    repo_path: &'a Path,
    utils: &'a SessionUtils,
}

pub struct BootstrapConfig<'a> {
    pub session_name: &'a str,
    pub branch_name: &'a str,
    pub worktree_path: &'a Path,
    pub parent_branch: &'a str,
    pub custom_branch: Option<&'a str>,
    pub should_copy_claude_locals: bool,
}

pub struct BootstrapResult {
    pub branch: String,
    pub worktree_path: PathBuf,
    pub parent_branch: String,
}

impl<'a> WorktreeBootstrapper<'a> {
    pub fn new(repo_path: &'a Path, utils: &'a SessionUtils) -> Self {
        Self { repo_path, utils }
    }

    pub fn bootstrap_worktree(&self, config: BootstrapConfig<'a>) -> Result<BootstrapResult> {
        info!(
            "Bootstrapping worktree for session '{}' with branch '{}'",
            config.session_name, config.branch_name
        );

        self.utils.cleanup_existing_worktree(config.worktree_path)?;

        let final_branch = if let Some(custom) = config.custom_branch {
            self.resolve_custom_branch(custom)?
        } else {
            config.branch_name.to_string()
        };

        self.create_worktree_directory(&config, &final_branch)?;

        self.verify_worktree(config.worktree_path)?;

        if config.should_copy_claude_locals {
            self.copy_claude_locals(config.worktree_path);
        }

        info!(
            "Successfully bootstrapped worktree at: {}",
            config.worktree_path.display()
        );

        Ok(BootstrapResult {
            branch: final_branch,
            worktree_path: config.worktree_path.to_path_buf(),
            parent_branch: config.parent_branch.to_string(),
        })
    }

    pub fn resolve_parent_branch(&self, requested: Option<&str>) -> Result<String> {
        if let Some(branch) = requested {
            let trimmed = branch.trim();
            if trimmed.is_empty() {
                warn!("Explicit base branch was empty, falling back to branch detection");
            } else {
                info!("Using explicit base branch '{trimmed}' for session setup");
                return Ok(trimmed.to_string());
            }
        }

        match crate::domains::git::repository::get_current_branch(self.repo_path) {
            Ok(current) => {
                info!("Using current branch '{current}' as parent branch");
                Ok(current)
            }
            Err(_) => {
                let default = git::get_default_branch(self.repo_path)?;
                info!("Using default branch '{default}' as parent branch");
                Ok(default)
            }
        }
    }

    fn resolve_custom_branch(&self, custom_branch: &str) -> Result<String> {
        if !git::is_valid_branch_name(custom_branch) {
            return Err(anyhow!(
                "Invalid branch name: branch names must be valid git references"
            ));
        }

        let branch_exists = git::branch_exists(self.repo_path, custom_branch)?;
        if branch_exists {
            let suffix = SessionUtils::generate_random_suffix(2);
            let unique_branch = format!("{custom_branch}-{suffix}");
            info!("Custom branch '{custom_branch}' exists, using '{unique_branch}' instead");
            Ok(unique_branch)
        } else {
            info!("Using custom branch '{custom_branch}'");
            Ok(custom_branch.to_string())
        }
    }

    fn create_worktree_directory(
        &self,
        config: &BootstrapConfig,
        final_branch: &str,
    ) -> Result<()> {
        git::create_worktree_from_base(
            self.repo_path,
            final_branch,
            config.worktree_path,
            config.parent_branch,
        )
        .with_context(|| {
            format!(
                "Failed to create worktree at {} for branch '{}'",
                config.worktree_path.display(),
                final_branch
            )
        })
    }

    fn verify_worktree(&self, worktree_path: &Path) -> Result<()> {
        if !worktree_path.exists() {
            return Err(anyhow!(
                "Worktree directory was not created: {}",
                worktree_path.display()
            ));
        }

        if !worktree_path.join(".git").exists() {
            warn!(
                "Worktree at {} exists but .git is missing",
                worktree_path.display()
            );
        }

        Ok(())
    }

    fn copy_claude_locals(&self, worktree_path: &Path) {
        let mut copy_plan: Vec<(std::path::PathBuf, std::path::PathBuf)> = Vec::new();

        if let Ok(entries) = std::fs::read_dir(self.repo_path) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let name_lower = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if name_lower.contains("claude.local") || name_lower.contains("local.claude") {
                    let dest = worktree_path.join(entry.file_name());
                    copy_plan.push((path, dest));
                }
            }
        }

        let claude_dir = self.repo_path.join(".claude");
        if claude_dir.is_dir()
            && let Ok(entries) = std::fs::read_dir(&claude_dir)
        {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name_lower = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if !name_lower.contains(".local.") {
                    continue;
                }
                let dest = worktree_path.join(".claude").join(entry.file_name());
                copy_plan.push((path, dest));
            }
        }

        for (source, dest) in copy_plan {
            if dest.exists() {
                info!(
                    "Skipping Claude local override copy; destination already exists: {}",
                    dest.display()
                );
                continue;
            }

            if let Some(parent) = dest.parent()
                && let Err(e) = std::fs::create_dir_all(parent)
            {
                warn!("Failed to create directory for Claude local override: {e}");
                continue;
            }

            match std::fs::copy(&source, &dest) {
                Ok(_) => info!("Copied Claude local override: {}", dest.display()),
                Err(e) => warn!("Failed to copy Claude local override: {e}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::cache::SessionCacheManager;
    use crate::domains::sessions::repository::SessionDbManager;
    use crate::infrastructure::database::Database;
    use serial_test::serial;
    use std::process::Command;
    use tempfile::TempDir;

    fn setup_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();

        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        (temp_dir, repo_path)
    }

    #[test]
    #[serial]
    fn test_bootstrap_worktree_creates_directory() {
        let (_temp, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let worktree_path = repo_path.join(".schaltwerk/worktrees/test-session");
        let config = BootstrapConfig {
            session_name: "test-session",
            branch_name: "schaltwerk/test-session",
            worktree_path: &worktree_path,
            parent_branch: "master",
            custom_branch: None,
            should_copy_claude_locals: false,
        };

        let result = bootstrapper.bootstrap_worktree(config).unwrap();
        assert_eq!(result.branch, "schaltwerk/test-session");
        assert!(worktree_path.exists());
        assert!(worktree_path.join(".git").exists());
    }

    #[test]
    #[serial]
    fn test_custom_branch_with_conflict_generates_unique_name() {
        let (_temp, repo_path) = setup_test_repo();

        Command::new("git")
            .args(["branch", "custom-branch"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let worktree_path = repo_path.join(".schaltwerk/worktrees/test-session");
        let config = BootstrapConfig {
            session_name: "test-session",
            branch_name: "custom-branch",
            worktree_path: &worktree_path,
            parent_branch: "master",
            custom_branch: Some("custom-branch"),
            should_copy_claude_locals: false,
        };

        let result = bootstrapper.bootstrap_worktree(config).unwrap();
        assert!(result.branch.starts_with("custom-branch-"));
        assert_ne!(result.branch, "custom-branch");
    }

    #[test]
    #[serial]
    fn test_resolve_parent_branch_uses_explicit() {
        let (_temp, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let result = bootstrapper.resolve_parent_branch(Some("main")).unwrap();
        assert_eq!(result, "main");
    }

    #[test]
    #[serial]
    fn test_resolve_parent_branch_falls_back_to_current() {
        let (_temp, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let result = bootstrapper.resolve_parent_branch(None).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    #[serial]
    fn test_copy_claude_locals_when_exists() {
        let (_temp, repo_path) = setup_test_repo();
        std::fs::write(
            repo_path.join("CLAUDE.local.md"),
            "# Claude Local Instructions",
        )
        .unwrap();

        let claude_dir = repo_path.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.local.json"),
            "{\"key\":\"value\"}",
        )
        .unwrap();

        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let worktree_path = repo_path.join(".schaltwerk/worktrees/test-session");
        let config = BootstrapConfig {
            session_name: "test-session",
            branch_name: "schaltwerk/test-session",
            worktree_path: &worktree_path,
            parent_branch: "master",
            custom_branch: None,
            should_copy_claude_locals: true,
        };

        bootstrapper.bootstrap_worktree(config).unwrap();

        let copied_root_file = worktree_path.join("CLAUDE.local.md");
        assert!(copied_root_file.exists());
        let root_content = std::fs::read_to_string(copied_root_file).unwrap();
        assert_eq!(root_content, "# Claude Local Instructions");

        let copied_settings = worktree_path.join(".claude").join("settings.local.json");
        assert!(copied_settings.exists());
        let settings_content = std::fs::read_to_string(copied_settings).unwrap();
        assert_eq!(settings_content, "{\"key\":\"value\"}");
    }

    #[test]
    #[serial]
    fn test_verify_worktree_fails_if_not_created() {
        let (_temp, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager, db_manager);
        let bootstrapper = WorktreeBootstrapper::new(&repo_path, &utils);

        let nonexistent = repo_path.join("nonexistent");
        let result = bootstrapper.verify_worktree(&nonexistent);
        assert!(result.is_err());
    }
}

use std::path::{Path, PathBuf};
use anyhow::{Result, anyhow};
use uuid::Uuid;
use rand::Rng;
use crate::para_core::{
    git,
    types::{EnrichedSession, SortMode, FilterMode, SessionState},
    session_cache::SessionCacheManager,
    session_db::SessionDbManager,
};

pub struct SessionUtils {
    repo_path: PathBuf,
    cache_manager: SessionCacheManager,
    db_manager: SessionDbManager,
}

impl SessionUtils {
    pub fn new(repo_path: PathBuf, cache_manager: SessionCacheManager, db_manager: SessionDbManager) -> Self {
        Self {
            repo_path,
            cache_manager,
            db_manager,
        }
    }

    pub fn generate_random_suffix(len: usize) -> String {
        let mut rng = rand::rng();
        (0..len)
            .map(|_| rng.random_range(b'a'..=b'z') as char)
            .collect()
    }

    pub fn generate_session_id() -> String {
        Uuid::new_v4().to_string()
    }

    pub fn get_repo_name(&self) -> Result<String> {
        self.repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Failed to get repository name from path"))
    }

    pub fn check_name_availability(&self, name: &str) -> Result<bool> {
        let _branch = format!("schaltwerk/{name}");
        let worktree_path = self.repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(name);

        let worktree_exists = worktree_path.exists();
        let session_exists = self.db_manager.session_exists(name);
        let reserved_exists = self.cache_manager.is_reserved(name);

        Ok(!worktree_exists && !session_exists && !reserved_exists)
    }

    pub fn find_unique_session_paths(&self, base_name: &str) -> Result<(String, String, PathBuf)> {
        if self.check_name_availability(base_name)? {
            let branch = format!("schaltwerk/{base_name}");
            let worktree_path = self.repo_path
                .join(".schaltwerk")
                .join("worktrees")
                .join(base_name);
            
            self.cache_manager.reserve_name(base_name);
            return Ok((base_name.to_string(), branch, worktree_path));
        }

        for _attempt in 0..10 {
            let suffix = Self::generate_random_suffix(2);
            let candidate = format!("{base_name}-{suffix}");
            
            if self.check_name_availability(&candidate)? {
                let branch = format!("schaltwerk/{candidate}");
                let worktree_path = self.repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);
                
                self.cache_manager.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }

        for i in 1..=100 {
            let candidate = format!("{base_name}-{i}");
            
            if self.check_name_availability(&candidate)? {
                let branch = format!("schaltwerk/{candidate}");
                let worktree_path = self.repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);
                
                self.cache_manager.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }

        Err(anyhow!("Unable to find a unique session name after 110 attempts"))
    }

    pub fn cleanup_existing_worktree(&self, worktree_path: &Path) -> Result<()> {
        log::info!("Cleaning up existing worktree: {}", worktree_path.display());
        
        git::prune_worktrees(&self.repo_path)?;
        
        if worktree_path.exists() {
            log::warn!("Worktree directory still exists after pruning: {}", worktree_path.display());
            
            if let Ok(git_dir) = worktree_path.join(".git").canonicalize() {
                if git_dir.is_file() {
                    log::info!("Removing git worktree reference at: {}", worktree_path.display());
                    git::remove_worktree(&self.repo_path, worktree_path)?;
                }
            }
            
            if worktree_path.exists() {
                log::info!("Removing remaining worktree directory: {}", worktree_path.display());
                std::fs::remove_dir_all(worktree_path)?;
            }
        }
        
        Ok(())
    }

    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        let worktrees = git::list_worktrees(&self.repo_path)?;
        
        for worktree_path in worktrees {
            if !worktree_path.to_string_lossy().contains("/.schaltwerk/worktrees/") {
                continue;
            }
            
            // Canonicalize paths to handle symlinks (like /var -> /private/var on macOS)
            let canonical_worktree = worktree_path.canonicalize()
                .unwrap_or_else(|_| worktree_path.clone());
            
            let sessions = self.db_manager.list_sessions()?;
            let exists = sessions.iter().any(|s| {
                let canonical_session = s.worktree_path.canonicalize()
                    .unwrap_or_else(|_| s.worktree_path.clone());
                canonical_session == canonical_worktree
            });
            
            if !exists {
                log::info!("Removing orphaned worktree: {}", worktree_path.display());
                let _ = git::remove_worktree(&self.repo_path, &worktree_path);
                if worktree_path.exists() {
                    let _ = std::fs::remove_dir_all(&worktree_path);
                }
            }
        }
        
        Ok(())
    }

    pub fn execute_setup_script(&self, script: &str, session_name: &str, branch_name: &str, worktree_path: &Path) -> Result<()> {
        use std::process::Command;
        
        log::info!("Executing setup script for session {session_name}");
        
        // Create a temporary script file
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join(format!("para_setup_{session_name}.sh"));
        std::fs::write(&script_path, script)?;
        
        // Make the script executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms)?;
        }
        
        // Set up environment variables
        let mut cmd = Command::new(if cfg!(windows) { "cmd" } else { "sh" });
        
        if cfg!(windows) {
            cmd.args(["/C", &script_path.to_string_lossy()]);
        } else {
            cmd.arg(&script_path);
        }
        
        let output = cmd
            .current_dir(worktree_path)
            .env("WORKTREE_PATH", worktree_path)
            .env("REPO_PATH", &self.repo_path)
            .env("SESSION_NAME", session_name)
            .env("BRANCH_NAME", branch_name)
            .output()?;
        
        // Clean up the temporary script file
        let _ = std::fs::remove_file(&script_path);
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("Setup script failed: {}", stderr));
        }
        
        log::info!("Setup script completed successfully for session {session_name}");
        Ok(())
    }

    pub fn apply_session_filter(&self, sessions: Vec<EnrichedSession>, filter_mode: &FilterMode) -> Vec<EnrichedSession> {
        match filter_mode {
            FilterMode::All => sessions,
            FilterMode::Draft => sessions.into_iter().filter(|s| s.info.session_state == SessionState::Draft).collect(),
            FilterMode::Running => sessions.into_iter().filter(|s| {
                s.info.session_state != SessionState::Draft && !s.info.ready_to_merge
            }).collect(),
            FilterMode::Reviewed => sessions.into_iter().filter(|s| s.info.ready_to_merge).collect(),
        }
    }

    pub fn apply_session_sort(&self, sessions: Vec<EnrichedSession>, sort_mode: &SortMode) -> Vec<EnrichedSession> {
        let mut reviewed: Vec<EnrichedSession> = sessions.iter().filter(|s| s.info.ready_to_merge).cloned().collect();
        let mut unreviewed: Vec<EnrichedSession> = sessions.iter().filter(|s| !s.info.ready_to_merge).cloned().collect();

        self.sort_sessions_by_mode(&mut unreviewed, sort_mode);
        self.sort_sessions_by_mode(&mut reviewed, &SortMode::Name);

        let mut result = unreviewed;
        result.extend(reviewed);
        result
    }

    pub fn sort_sessions_by_mode(&self, sessions: &mut [EnrichedSession], sort_mode: &SortMode) {
        match sort_mode {
            SortMode::Name => {
                sessions.sort_by(|a, b| {
                    a.info.session_id.to_lowercase().cmp(&b.info.session_id.to_lowercase())
                });
            }
            SortMode::Created => {
                sessions.sort_by(|a, b| {
                    match (a.info.created_at, b.info.created_at) {
                        (Some(a_time), Some(b_time)) => b_time.cmp(&a_time),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.info.session_id.cmp(&b.info.session_id),
                    }
                });
            }
            SortMode::LastEdited => {
                sessions.sort_by(|a, b| {
                    let a_time = a.info.last_modified.or(a.info.created_at);
                    let b_time = b.info.last_modified.or(b.info.created_at);
                    match (a_time, b_time) {
                        (Some(a_time), Some(b_time)) => b_time.cmp(&a_time),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.info.session_id.cmp(&b.info.session_id),
                    }
                });
            }
        }
    }

    #[allow(dead_code)]
    pub fn validate_session_name(name: &str) -> bool {
        if name.is_empty() || name.len() > 100 {
            return false;
        }
        
        let first_char = name.chars().next().unwrap();
        if !first_char.is_ascii_alphanumeric() && first_char != '_' {
            return false;
        }
        
        name.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
        })
    }

    pub fn get_effective_binary_path_with_override(&self, agent_name: &str, binary_path_override: Option<&str>) -> String {
        if let Some(override_path) = binary_path_override {
            log::debug!("Using provided binary path for {agent_name}: {override_path}");
            return override_path.to_string();
        }
        
        if cfg!(not(test)) {
            log::info!("Binary resolution not implemented yet, using agent name as fallback: {agent_name}");
        }
        
        log::debug!("Using agent name as fallback for {agent_name}");
        agent_name.to_string()
    }
}
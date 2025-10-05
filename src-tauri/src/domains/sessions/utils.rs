use crate::{
    domains::git::service as git,
    domains::sessions::cache::SessionCacheManager,
    domains::sessions::entity::{EnrichedSession, FilterMode, SessionState, SortMode},
    domains::sessions::repository::SessionDbManager,
    domains::terminal::{build_login_shell_invocation, sh_quote_string},
    schaltwerk_core::db_project_config::{ProjectConfigMethods, DEFAULT_BRANCH_PREFIX},
};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct SessionUtils {
    repo_path: PathBuf,
    cache_manager: SessionCacheManager,
    db_manager: SessionDbManager,
}

impl SessionUtils {
    fn branch_prefix(&self) -> String {
        self.db_manager
            .db
            .get_project_branch_prefix(&self.repo_path)
            .unwrap_or_else(|err| {
                log::warn!("Falling back to default branch prefix due to error: {err}");
                DEFAULT_BRANCH_PREFIX.to_string()
            })
    }

    fn check_name_availability_with_prefix(&self, name: &str, branch_prefix: &str) -> Result<bool> {
        let branch = format!("{branch_prefix}/{name}");
        let worktree_path = self
            .repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(name);

        let worktree_exists = worktree_path.exists();
        let session_exists = self.db_manager.session_exists(name);
        let reserved_exists = self.cache_manager.is_reserved(name);
        let branch_exists = git::branch_exists(&self.repo_path, &branch)?;

        Ok(!worktree_exists && !session_exists && !reserved_exists && !branch_exists)
    }

    pub fn new(
        repo_path: PathBuf,
        cache_manager: SessionCacheManager,
        db_manager: SessionDbManager,
    ) -> Self {
        Self {
            repo_path,
            cache_manager,
            db_manager,
        }
    }

    pub fn generate_random_suffix(len: usize) -> String {
        let mut bytes = vec![0u8; len];
        getrandom::getrandom(&mut bytes).unwrap_or_else(|_| {
            log::warn!("Failed to get random bytes, using fallback");
        });
        bytes.iter().map(|&b| (b'a' + (b % 26)) as char).collect()
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
        let branch_prefix = self.branch_prefix();
        self.check_name_availability_with_prefix(name, &branch_prefix)
    }

    pub fn find_unique_session_paths(&self, base_name: &str) -> Result<(String, String, PathBuf)> {
        let branch_prefix = self.branch_prefix();

        if self.check_name_availability_with_prefix(base_name, &branch_prefix)? {
            let branch = format!("{branch_prefix}/{base_name}");
            let worktree_path = self
                .repo_path
                .join(".schaltwerk")
                .join("worktrees")
                .join(base_name);

            self.cache_manager.reserve_name(base_name);
            return Ok((base_name.to_string(), branch, worktree_path));
        }

        for _attempt in 0..10 {
            let suffix = Self::generate_random_suffix(2);
            let candidate = format!("{base_name}-{suffix}");

            if self.check_name_availability_with_prefix(&candidate, &branch_prefix)? {
                let branch = format!("{branch_prefix}/{candidate}");
                let worktree_path = self
                    .repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);

                self.cache_manager.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }

        for i in 1..=100 {
            let candidate = format!("{base_name}-{i}");

            if self.check_name_availability_with_prefix(&candidate, &branch_prefix)? {
                let branch = format!("{branch_prefix}/{candidate}");
                let worktree_path = self
                    .repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);

                self.cache_manager.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }

        Err(anyhow!(
            "Unable to find a unique session name after 110 attempts"
        ))
    }

    pub fn cleanup_existing_worktree(&self, worktree_path: &Path) -> Result<()> {
        log::info!("Cleaning up existing worktree: {}", worktree_path.display());

        git::prune_worktrees(&self.repo_path)?;

        if worktree_path.exists() {
            log::warn!(
                "Worktree directory still exists after pruning: {}",
                worktree_path.display()
            );

            if let Ok(git_dir) = worktree_path.join(".git").canonicalize() {
                if git_dir.is_file() {
                    log::info!(
                        "Removing git worktree reference at: {}",
                        worktree_path.display()
                    );
                    git::remove_worktree(&self.repo_path, worktree_path)?;
                }
            }

            if worktree_path.exists() {
                log::info!(
                    "Removing remaining worktree directory: {}",
                    worktree_path.display()
                );
                std::fs::remove_dir_all(worktree_path)?;
            }
        }

        Ok(())
    }

    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        let worktrees = git::list_worktrees(&self.repo_path)?;

        for worktree_path in worktrees {
            if !worktree_path
                .to_string_lossy()
                .contains("/.schaltwerk/worktrees/")
            {
                continue;
            }

            // Canonicalize paths to handle symlinks (like /var -> /private/var on macOS)
            let canonical_worktree = worktree_path
                .canonicalize()
                .unwrap_or_else(|_| worktree_path.clone());

            let sessions = self.db_manager.list_sessions()?;
            // IMPORTANT: Only check against sessions that should have worktrees
            // Spec sessions should NOT have worktree directories, so we exclude them
            let sessions_with_worktrees: Vec<_> = sessions
                .into_iter()
                .filter(|s| s.session_state != SessionState::Spec)
                .collect();

            let exists = sessions_with_worktrees.iter().any(|s| {
                let canonical_session = s
                    .worktree_path
                    .canonicalize()
                    .unwrap_or_else(|_| s.worktree_path.clone());
                canonical_session == canonical_worktree
            });

            if !exists {
                log::info!(
                    "Removing orphaned worktree: {} (no matching non-spec session found)",
                    worktree_path.display()
                );
                let _ = git::remove_worktree(&self.repo_path, &worktree_path);
                if worktree_path.exists() {
                    log::debug!(
                        "Forcefully removing worktree directory: {}",
                        worktree_path.display()
                    );
                    let _ = std::fs::remove_dir_all(&worktree_path);
                }
            }
        }

        Ok(())
    }

    pub fn execute_setup_script(
        &self,
        script: &str,
        session_name: &str,
        branch_name: &str,
        worktree_path: &Path,
    ) -> Result<()> {
        use std::process::Command;

        log::info!("Executing setup script for session {session_name}");

        // Create a temporary script file with unique name to avoid conflicts
        let temp_dir = std::env::temp_dir();
        let process_id = std::process::id();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let script_path = temp_dir.join(format!(
            "para_setup_{session_name}_{process_id}_{timestamp}.sh"
        ));
        std::fs::write(&script_path, script)?;

        // Make the script executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms)?;
        }

        let command_string = format!("sh {}", sh_quote_string(&script_path.display().to_string()));
        let shell_invocation = build_login_shell_invocation(&command_string);

        let mut cmd = Command::new(&shell_invocation.program);
        cmd.args(&shell_invocation.args);

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
            return Err(anyhow!("Setup script failed: {stderr}"));
        }

        log::info!("Setup script completed successfully for session {session_name}");
        Ok(())
    }

    pub fn apply_session_filter(
        &self,
        sessions: Vec<EnrichedSession>,
        filter_mode: &FilterMode,
    ) -> Vec<EnrichedSession> {
        match filter_mode {
            FilterMode::All => sessions,
            FilterMode::Spec => sessions
                .into_iter()
                .filter(|s| s.info.session_state == SessionState::Spec)
                .collect(),
            FilterMode::Running => sessions
                .into_iter()
                .filter(|s| s.info.session_state != SessionState::Spec && !s.info.ready_to_merge)
                .collect(),
            FilterMode::Reviewed => sessions
                .into_iter()
                .filter(|s| s.info.ready_to_merge)
                .collect(),
        }
    }

    pub fn apply_session_sort(
        &self,
        sessions: Vec<EnrichedSession>,
        sort_mode: &SortMode,
    ) -> Vec<EnrichedSession> {
        let mut reviewed: Vec<EnrichedSession> = sessions
            .iter()
            .filter(|s| s.info.ready_to_merge)
            .cloned()
            .collect();
        let mut unreviewed: Vec<EnrichedSession> = sessions
            .iter()
            .filter(|s| !s.info.ready_to_merge)
            .cloned()
            .collect();

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
                    // First sort by session state priority (Spec > Running)
                    let a_priority = match a.info.session_state {
                        SessionState::Spec => 0,
                        SessionState::Running => 1,
                        SessionState::Reviewed => 2,
                    };
                    let b_priority = match b.info.session_state {
                        SessionState::Spec => 0,
                        SessionState::Running => 1,
                        SessionState::Reviewed => 2,
                    };

                    match a_priority.cmp(&b_priority) {
                        std::cmp::Ordering::Equal => {
                            // If same priority, sort by name
                            a.info
                                .session_id
                                .to_lowercase()
                                .cmp(&b.info.session_id.to_lowercase())
                        }
                        ordering => ordering,
                    }
                });
            }
            SortMode::Created => {
                sessions.sort_by(|a, b| match (a.info.created_at, b.info.created_at) {
                    (Some(a_time), Some(b_time)) => b_time.cmp(&a_time),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a.info.session_id.cmp(&b.info.session_id),
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

    pub fn validate_session_name(name: &str) -> bool {
        if name.is_empty() || name.len() > 100 {
            return false;
        }

        let first_char = name.chars().next().unwrap();
        if !first_char.is_ascii_alphanumeric() && first_char != '_' {
            return false;
        }

        name.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    }

    pub fn get_effective_binary_path_with_override(
        &self,
        agent_name: &str,
        binary_path_override: Option<&str>,
    ) -> String {
        if let Some(override_path) = binary_path_override {
            log::debug!("Using provided binary path for {agent_name}: {override_path}");
            return override_path.to_string();
        }

        log::debug!("No override provided for {agent_name}, will be resolved from settings at command level");
        agent_name.to_string()
    }
}

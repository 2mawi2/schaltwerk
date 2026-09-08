use crate::{
    domains::git::service as git,
    domains::sessions::cache::SessionCacheManager,
    domains::sessions::entity::{EnrichedSession, FilterMode, SessionState, SortMode},
    domains::sessions::repository::SessionDbManager,
    domains::terminal::{build_login_shell_invocation, sh_quote_string},
    infrastructure::database::{DEFAULT_BRANCH_PREFIX, ProjectConfigMethods},
    shared::format_branch_name,
};
use anyhow::{Result, anyhow};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub fn resolve_worktree_base(repo_path: &Path, worktree_base_directory: Option<&str>) -> PathBuf {
    match worktree_base_directory {
        Some(dir) if !dir.trim().is_empty() => {
            let path = Path::new(dir);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                repo_path.join(path)
            }
        }
        _ => repo_path.join(".schaltwerk").join("worktrees"),
    }
}

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

    fn custom_worktree_base_directory(&self) -> Result<Option<String>> {
        self.db_manager
            .db
            .get_project_worktree_base_directory(&self.repo_path)
    }

    fn worktree_base_path(&self, worktree_base_directory: Option<&str>) -> PathBuf {
        resolve_worktree_base(&self.repo_path, worktree_base_directory)
    }

    fn check_name_availability_with_prefix(
        &self,
        name: &str,
        branch_prefix: &str,
        worktree_base: &Path,
    ) -> Result<bool> {
        let branch = format_branch_name(branch_prefix, name);
        let worktree_path = worktree_base.join(name);

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
        if let Err(e) = getrandom::fill(&mut bytes) {
            log::warn!("Failed to get random bytes: {e}, using fallback");
        }
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
        let custom_base = self.custom_worktree_base_directory()?;
        let worktree_base = resolve_worktree_base(&self.repo_path, custom_base.as_deref());
        self.check_name_availability_with_prefix(name, &branch_prefix, &worktree_base)
    }

    pub fn find_unique_session_paths(
        &self,
        base_name: &str,
        worktree_base_directory: Option<&str>,
    ) -> Result<(String, String, PathBuf)> {
        let branch_prefix = self.branch_prefix();
        let worktree_base = self.worktree_base_path(worktree_base_directory);

        if self.check_name_availability_with_prefix(base_name, &branch_prefix, &worktree_base)? {
            let branch = format_branch_name(&branch_prefix, base_name);
            let worktree_path = worktree_base.join(base_name);

            self.cache_manager.reserve_name(base_name);
            return Ok((base_name.to_string(), branch, worktree_path));
        }

        for _attempt in 0..10 {
            let suffix = Self::generate_random_suffix(2);
            let candidate = format!("{base_name}-{suffix}");

            if self.check_name_availability_with_prefix(&candidate, &branch_prefix, &worktree_base)?
            {
                let branch = format_branch_name(&branch_prefix, &candidate);
                let worktree_path = worktree_base.join(&candidate);

                self.cache_manager.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }

        for i in 1..=100 {
            let candidate = format!("{base_name}-{i}");

            if self.check_name_availability_with_prefix(&candidate, &branch_prefix, &worktree_base)?
            {
                let branch = format_branch_name(&branch_prefix, &candidate);
                let worktree_path = worktree_base.join(&candidate);

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

            if let Ok(git_dir) = worktree_path.join(".git").canonicalize()
                && git_dir.is_file()
            {
                log::info!(
                    "Removing git worktree reference at: {}",
                    worktree_path.display()
                );
                git::remove_worktree(&self.repo_path, worktree_path)?;
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
        let sessions = self.db_manager.list_sessions()?;
        let sessions_with_worktrees: Vec<_> = sessions
            .into_iter()
            .filter(|s| s.session_state != SessionState::Spec)
            .collect();
        let canonical_session_worktrees: HashSet<PathBuf> = sessions_with_worktrees
            .iter()
            .map(|s| {
                s.worktree_path
                    .canonicalize()
                    .unwrap_or_else(|_| s.worktree_path.clone())
            })
            .collect();

        let managed_bases = self.managed_worktree_bases();

        for worktree_path in worktrees {
            if !Self::is_under_managed_base(&worktree_path, &managed_bases) {
                continue;
            }

            let canonical_worktree = worktree_path
                .canonicalize()
                .unwrap_or_else(|_| worktree_path.clone());

            let exists = canonical_session_worktrees.contains(&canonical_worktree);

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
                    self.fast_remove_dir_in_background(&worktree_path);
                }
            }
        }

        self.cleanup_trash_directories()?;

        Ok(())
    }

    fn managed_worktree_bases(&self) -> Vec<PathBuf> {
        let default_base = resolve_worktree_base(&self.repo_path, None);
        let custom_base = self.custom_worktree_base_directory().unwrap_or_else(|err| {
            log::warn!("Could not read custom worktree base for cleanup: {err}");
            None
        });
        let resolved_custom = custom_base
            .as_deref()
            .map(|dir| resolve_worktree_base(&self.repo_path, Some(dir)));

        let mut bases = vec![default_base];
        if let Some(custom) = resolved_custom.filter(|c| !bases.contains(c)) {
            bases.push(custom);
        }
        bases
    }

    fn is_under_managed_base(worktree_path: &Path, bases: &[PathBuf]) -> bool {
        let canonical_worktree = worktree_path
            .canonicalize()
            .unwrap_or_else(|_| worktree_path.to_path_buf());

        bases.iter().any(|base| {
            let canonical_base = base
                .canonicalize()
                .unwrap_or_else(|_| base.clone());
            canonical_worktree.starts_with(&canonical_base)
        })
    }

    fn fast_remove_dir_in_background(&self, path: &Path) {
        if !path.exists() {
            return;
        }

        let parent = path.parent().unwrap_or(path);
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let staged_name = format!(
            ".schaltwerk-trash-orphan-{}-{ts}",
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("worktree")
        );
        let staged_path = parent.join(staged_name);

        match fs::rename(path, &staged_path) {
            Ok(()) => {
                log::info!(
                    "Fast-moved orphaned worktree for cleanup: {} -> {}",
                    path.display(),
                    staged_path.display()
                );
                let staged_owned = staged_path.clone();
                std::thread::spawn(move || {
                    if let Err(e) = fs::remove_dir_all(&staged_owned) {
                        log::warn!(
                            "Background cleanup failed for {}: {e}",
                            staged_owned.display()
                        );
                    } else {
                        log::debug!(
                            "Background cleanup completed: {}",
                            staged_owned.display()
                        );
                    }
                });
            }
            Err(e) => {
                log::warn!(
                    "Fast rename failed ({}), scheduling background removal for {}",
                    e,
                    path.display()
                );
                let owned = path.to_path_buf();
                std::thread::spawn(move || {
                    if let Err(e) = fs::remove_dir_all(&owned) {
                        log::warn!(
                            "Background cleanup failed for {}: {e}",
                            owned.display()
                        );
                    } else {
                        log::debug!("Background cleanup completed: {}", owned.display());
                    }
                });
            }
        }
    }

    fn cleanup_trash_directories(&self) -> Result<()> {
        for base in &self.managed_worktree_bases() {
            self.cleanup_trash_in_directory(base)?;
        }
        Ok(())
    }

    fn cleanup_trash_in_directory(&self, worktrees_dir: &Path) -> Result<()> {
        let trash_dir = worktrees_dir.join(".schaltwerk-trash");

        if !trash_dir.exists() {
            return Ok(());
        }

        log::info!("Cleaning up trash directory: {}", trash_dir.display());

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let staged_dir = worktrees_dir.join(format!(".schaltwerk-trash-cleanup-{ts}"));

        match fs::rename(&trash_dir, &staged_dir) {
            Ok(()) => {
                log::info!(
                    "Fast-moved trash directory for background cleanup: {} -> {}",
                    trash_dir.display(),
                    staged_dir.display()
                );
                std::thread::spawn(move || {
                    if let Err(e) = fs::remove_dir_all(&staged_dir) {
                        log::warn!(
                            "Background trash cleanup failed for {}: {e}",
                            staged_dir.display()
                        );
                    } else {
                        log::debug!(
                            "Background trash cleanup completed: {}",
                            staged_dir.display()
                        );
                    }
                });
            }
            Err(e) => {
                log::warn!(
                    "Fast rename of trash directory failed ({}), scheduling background removal for {}",
                    e,
                    trash_dir.display()
                );
                let owned = trash_dir.to_path_buf();
                std::thread::spawn(move || {
                    if let Err(e) = fs::remove_dir_all(&owned) {
                        log::warn!(
                            "Background trash cleanup failed for {}: {e}",
                            owned.display()
                        );
                    } else {
                        log::debug!("Background trash cleanup completed: {}", owned.display());
                    }
                });
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

        // Ensure environment variables contain absolute paths
        let repo_path_abs = self
            .repo_path
            .canonicalize()
            .unwrap_or_else(|_| self.repo_path.clone());
        let worktree_path_abs = worktree_path
            .canonicalize()
            .unwrap_or_else(|_| worktree_path.to_path_buf());

        let output = cmd
            .current_dir(worktree_path)
            .env("WORKTREE_PATH", worktree_path_abs)
            .env("REPO_PATH", repo_path_abs)
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
                        SessionState::Processing | SessionState::Running => 1,
                        SessionState::Reviewed => 2,
                    };
                    let b_priority = match b.info.session_state {
                        SessionState::Spec => 0,
                        SessionState::Processing | SessionState::Running => 1,
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

        log::debug!(
            "No override provided for {agent_name}, will be resolved from settings at command level"
        );
        agent_name.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_worktree_base_default_when_none() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, None);
        assert_eq!(result, PathBuf::from("/repo/.schaltwerk/worktrees"));
    }

    #[test]
    fn resolve_worktree_base_default_when_empty() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, Some(""));
        assert_eq!(result, PathBuf::from("/repo/.schaltwerk/worktrees"));
    }

    #[test]
    fn resolve_worktree_base_default_when_whitespace() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, Some("   "));
        assert_eq!(result, PathBuf::from("/repo/.schaltwerk/worktrees"));
    }

    #[test]
    fn resolve_worktree_base_absolute_path() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, Some("/tmp/worktrees"));
        assert_eq!(result, PathBuf::from("/tmp/worktrees"));
    }

    #[test]
    fn resolve_worktree_base_relative_path() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, Some("../../worktrees"));
        assert_eq!(result, PathBuf::from("/repo/../../worktrees"));
    }

    #[test]
    fn resolve_worktree_base_relative_dot_path() {
        let repo = PathBuf::from("/repo");
        let result = resolve_worktree_base(&repo, Some("./custom-dir"));
        assert_eq!(result, PathBuf::from("/repo/./custom-dir"));
    }

    #[test]
    fn is_under_managed_base_matches_default() {
        let bases = vec![PathBuf::from("/repo/.schaltwerk/worktrees")];
        let worktree = PathBuf::from("/repo/.schaltwerk/worktrees/my-session");
        assert!(SessionUtils::is_under_managed_base(&worktree, &bases));
    }

    #[test]
    fn is_under_managed_base_matches_custom() {
        let bases = vec![
            PathBuf::from("/repo/.schaltwerk/worktrees"),
            PathBuf::from("/tmp/custom-worktrees"),
        ];
        let worktree = PathBuf::from("/tmp/custom-worktrees/my-session");
        assert!(SessionUtils::is_under_managed_base(&worktree, &bases));
    }

    #[test]
    fn is_under_managed_base_rejects_unrelated_path() {
        let bases = vec![PathBuf::from("/repo/.schaltwerk/worktrees")];
        let worktree = PathBuf::from("/other/project/worktrees/session");
        assert!(!SessionUtils::is_under_managed_base(&worktree, &bases));
    }

    #[test]
    fn is_under_managed_base_rejects_prefix_not_parent() {
        let bases = vec![PathBuf::from("/tmp/work")];
        let worktree = PathBuf::from("/tmp/workers/foo");
        assert!(!SessionUtils::is_under_managed_base(&worktree, &bases));
    }

    #[test]
    fn is_under_managed_base_rejects_substring_match() {
        let bases = vec![PathBuf::from("/bar/.schaltwerk/worktrees")];
        let worktree = PathBuf::from("/foo/bar/.schaltwerk/worktrees/session");
        assert!(!SessionUtils::is_under_managed_base(&worktree, &bases));
    }

    #[test]
    fn is_under_managed_base_empty_bases() {
        let bases: Vec<PathBuf> = vec![];
        let worktree = PathBuf::from("/repo/.schaltwerk/worktrees/session");
        assert!(!SessionUtils::is_under_managed_base(&worktree, &bases));
    }
}

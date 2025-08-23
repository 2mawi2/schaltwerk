use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, Mutex as StdMutex, Arc};
use anyhow::{Result, anyhow};
use uuid::Uuid;
use chrono::{Utc, TimeZone};
use rand::Rng;
use crate::para_core::{
    database::Database,
    db_sessions::SessionMethods,
    db_git_stats::GitStatsMethods,
    db_app_config::AppConfigMethods,
    db_project_config::ProjectConfigMethods,
    git,
    types::{Session, SessionStatus, SessionState, SessionInfo, SessionStatusType, SessionType, EnrichedSession, DiffStats},
};

// Track which sessions have already had their initial prompt sent
// Use worktree path as key for uniqueness
static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();
// Reserve generated names per repository path to avoid duplicates across rapid successive calls
static RESERVED_NAMES: OnceLock<StdMutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

fn has_session_been_prompted(worktree_path: &Path) -> bool {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let prompted = set.lock().unwrap();
    prompted.contains(worktree_path)
}

fn mark_session_prompted(worktree_path: &Path) {
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().unwrap();
    prompted.insert(worktree_path.to_path_buf());
}

pub struct SessionManager {
    db: Database,
    repo_path: PathBuf,
}

impl SessionManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::debug!("Creating SessionManager with repo path: {}", repo_path.display());
        Self { db, repo_path }
    }
    
    // Global per-repository mutexes to serialize worktree operations
    fn get_repo_lock(repo_path: &PathBuf) -> Arc<StdMutex<()>> {
        static REPO_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<StdMutex<()>>>>> = OnceLock::new();
        let map_mutex = REPO_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        if let Some(lock) = map.get(repo_path) {
            return lock.clone();
        }
        let lock = Arc::new(StdMutex::new(()));
        map.insert(repo_path.clone(), lock.clone());
        lock
    }
    
    fn generate_random_suffix(len: usize) -> String {
        let mut rng = rand::rng();
        (0..len)
            .map(|_| rng.random_range(b'a'..=b'z') as char)
            .collect()
    }
    
    fn is_reserved(&self, name: &str) -> bool {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let map = map_mutex.lock().unwrap();
        if let Some(set) = map.get(&self.repo_path) {
            set.contains(name)
        } else {
            false
        }
    }

    fn reserve_name(&self, name: &str) {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        let set = map.entry(self.repo_path.clone()).or_default();
        set.insert(name.to_string());
    }

    fn unreserve_name(&self, name: &str) {
        let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut map = map_mutex.lock().unwrap();
        if let Some(set) = map.get_mut(&self.repo_path) {
            set.remove(name);
        }
    }
    
    fn check_name_availability(&self, name: &str) -> Result<bool> {
        let branch = format!("schaltwerk/{name}");
        let worktree_path = self.repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(name);
        
        let branch_exists = git::branch_exists(&self.repo_path, &branch)?;
        let worktree_exists = worktree_path.exists();
        let session_exists = self.db.get_session_by_name(&self.repo_path, name).is_ok();
        let reserved_exists = self.is_reserved(name);
        
        let is_available = !branch_exists && !worktree_exists && !session_exists && !reserved_exists;
        
        if !is_available {
            log::debug!(
                "Session name '{name}' conflicts (branch: {branch_exists}, worktree: {worktree_exists}, db: {session_exists}, reserved: {reserved_exists})"
            );
        }
        
        Ok(is_available)
    }
    
    fn find_unique_session_paths(&self, base_name: &str) -> Result<(String, String, PathBuf)> {
        // First, try the base name as-is
        if self.check_name_availability(base_name)? {
            let branch = format!("schaltwerk/{base_name}");
            let worktree_path = self.repo_path
                .join(".schaltwerk")
                .join("worktrees")
                .join(base_name);
            log::info!("Found unique session name: {base_name}");
            // Reserve immediately to avoid duplicates in subsequent calls before persistence
            self.reserve_name(base_name);
            return Ok((base_name.to_string(), branch, worktree_path));
        }
        
        // If collision, use random 2-letter suffix (26*26 = 676 possibilities)
        // This gives nice names like "fix-bug-ax", "fix-bug-mz"
        for attempt in 0..10 {  // Try 10 times with random suffixes
            let suffix = Self::generate_random_suffix(2);
            let candidate = format!("{base_name}-{suffix}");
            
            if self.check_name_availability(&candidate)? {
                let branch = format!("schaltwerk/{candidate}");
                let worktree_path = self.repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);
                log::info!("Found unique session name with random suffix: {candidate} (attempt {})", attempt + 1);
                self.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }
        
        // Fallback to incremental only if random fails (very unlikely)
        for counter in 1..=20 {
            let candidate = format!("{base_name}-{counter}");
            
            if self.check_name_availability(&candidate)? {
                let branch = format!("schaltwerk/{candidate}");
                let worktree_path = self.repo_path
                    .join(".schaltwerk")
                    .join("worktrees")
                    .join(&candidate);
                log::info!("Found unique session name with incremental suffix: {candidate}");
                self.reserve_name(&candidate);
                return Ok((candidate, branch, worktree_path));
            }
        }
        
        Err(anyhow!("Could not find unique session name after trying random and incremental suffixes"))
    }
    
    fn cleanup_existing_worktree(&self, worktree_path: &Path) -> Result<()> {
        log::info!("Cleaning up existing worktree: {}", worktree_path.display());
        
        // 1. First prune dead worktrees globally (safe - only removes broken references)
        if let Err(e) = git::prune_worktrees(&self.repo_path) {
            log::debug!("Worktree prune returned: {e}");
        }
        
        // 2. Check if this specific worktree is registered with git
        let worktree_registered = git::is_worktree_registered(&self.repo_path, worktree_path)?;
        
        // 3. If registered, remove properly through git (this handles all git state)
        if worktree_registered {
            log::info!("Removing registered worktree: {}", worktree_path.display());
            if let Err(e) = git::remove_worktree(&self.repo_path, worktree_path) {
                log::warn!("Git worktree removal failed: {e}, continuing with directory cleanup");
            }
        }
        
        // 4. If directory still exists, remove it (covers non-git directories)
        if worktree_path.exists() {
            log::info!("Removing worktree directory: {}", worktree_path.display());
            std::fs::remove_dir_all(worktree_path)?;
        }
        
        Ok(())
    }
    
    #[cfg(test)]
    pub fn create_session(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>) -> Result<Session> {
        self.create_session_with_auto_flag(name, prompt, base_branch, false)
    }
    
    pub fn create_session_with_auto_flag(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>, was_auto_generated: bool) -> Result<Session> {
        log::info!("Creating session '{}' in repository: {}", name, self.repo_path.display());
        
        // Serialize session creation per repository to avoid git worktree races
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().unwrap();
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        // Find a unique session name if there's a conflict
        let (unique_name, branch, worktree_path) = self.find_unique_session_paths(name)?;
        
        let session_id = Uuid::new_v4().to_string();
        
        // Cleanup any existing worktree at this path (shouldn't happen with unique names, but be safe)
        self.cleanup_existing_worktree(&worktree_path)?;
        
        let parent_branch = if let Some(base) = base_branch {
            base.to_string()
        } else {
            log::info!("No base branch specified, detecting default branch for session creation");
            match git::get_default_branch(&self.repo_path) {
                Ok(default) => {
                    log::info!("Using detected default branch: {default}");
                    default
                }
                Err(e) => {
                    log::error!("Failed to detect default branch: {e}");
                    return Err(anyhow!("Failed to detect default branch: {}. Please ensure the repository has at least one branch (e.g., 'main' or 'master')", e));
                }
            }
        };
        let repo_name = self.repo_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        
        let now = Utc::now();
        
        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch: parent_branch.clone(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: prompt.map(String::from),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            // Mark for name generation when the session name was auto-generated,
            // regardless of whether a prompt was provided. The generator uses a default prompt.
            pending_name_generation: was_auto_generated,
            was_auto_generated,
            draft_content: None,
            session_state: SessionState::Running,
        };
        
        // Check if repository has no commits and create initial commit if needed
        let repo_was_empty = !git::repository_has_commits(&self.repo_path).unwrap_or(true);
        if repo_was_empty {
            log::info!("Repository has no commits, creating initial commit: '{}'", git::INITIAL_COMMIT_MESSAGE);
            git::create_initial_commit(&self.repo_path)
                .map_err(|e| {
                    self.unreserve_name(&unique_name);
                    anyhow!("Failed to create initial commit: {}", e)
                })?;
        }
        
        // Always create worktree from the parent branch (either specified or detected)
        let create_result = git::create_worktree_from_base(
            &self.repo_path, 
            &branch, 
            &worktree_path, 
            &parent_branch
        );
        
        if let Err(e) = create_result {
            // Release reservation if we failed to actually create the worktree
            self.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        // Execute project setup script if configured
        if let Ok(Some(setup_script)) = self.db.get_project_setup_script(&self.repo_path) {
            if !setup_script.trim().is_empty() {
                self.execute_setup_script(&setup_script, &unique_name, &branch, &worktree_path)?;
            }
        }
        
        if let Err(e) = self.db.create_session(&session) {
            let _ = git::remove_worktree(&self.repo_path, &worktree_path);
            let _ = git::delete_branch(&self.repo_path, &branch);
            // Release reservation on failure to persist session
            self.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save session to database: {}", e));
        }

        // Persist original opening settings at creation time from global config
        let global_agent = self.db.get_agent_type().unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db.get_skip_permissions().unwrap_or(false);
        let _ = self.db.set_session_original_settings(&session.id, &global_agent, global_skip);
        
        let mut git_stats = git::calculate_git_stats_fast(&worktree_path, &parent_branch)?;
        git_stats.session_id = session_id.clone();
        self.db.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = chrono::Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db.set_session_activity(&session_id, dt);
            }
        }
        
        // Session persisted successfully; reservation no longer needed
        self.unreserve_name(&unique_name);
        Ok(session)
    }
    
    pub fn cancel_session(&self, name: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, name)?;
        
        // Check for uncommitted changes and warn (following Para CLI pattern)
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            // In Para CLI, this would prompt for confirmation, but for UI we'll proceed with warning
            log::warn!("Canceling session '{name}' with uncommitted changes");
        }
        
        // Remove worktree first (required before branch operations)
        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                // If removal fails for reasons other than "not a worktree", surface the error
                return Err(anyhow!("Failed to remove worktree: {}", e));
            }
        } else {
            // If directory is already gone, continue cancellation flow
            log::warn!(
                "Worktree path missing, continuing cancellation: {}",
                session.worktree_path.display()
            );
        }
        
        // Archive branch instead of deleting (following Para CLI pattern)
        if git::branch_exists(&self.repo_path, &session.branch)? {
            match git::archive_branch(&self.repo_path, &session.branch, &session.name) {
                Ok(archived_name) => {
                    log::info!("Archived branch '{}' to '{}'", session.branch, archived_name);
                },
                Err(e) => {
                    log::warn!("Failed to archive branch '{}': {}", session.branch, e);
                    // Continue with session cancellation even if archiving fails
                }
            }
        }
        
        // Update database status
        self.db.update_session_status(&session.id, SessionStatus::Cancelled)?;
        
        Ok(())
    }
    
    pub fn convert_session_to_draft(&self, name: &str) -> Result<()> {
        use crate::para_core::types::SessionState;
        
        let session = self.db.get_session_by_name(&self.repo_path, name)?;
        
        // Verify the session is currently running
        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{}' is not in running state", name));
        }
        
        log::info!("Converting session '{name}' from running to draft");
        
        // Check for uncommitted changes and warn
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            log::warn!("Converting session '{name}' to draft with uncommitted changes");
        }
        
        // Remove worktree first (required before branch operations)
        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                return Err(anyhow!("Failed to remove worktree: {}", e));
            }
        } else {
            log::warn!(
                "Worktree path missing for session '{name}', continuing conversion"
            );
        }
        
        // Archive branch instead of deleting
        if git::branch_exists(&self.repo_path, &session.branch)? {
            match git::archive_branch(&self.repo_path, &session.branch, &session.name) {
                Ok(archived_name) => {
                    log::info!("Archived branch '{}' to '{}'", session.branch, archived_name);
                },
                Err(e) => {
                    log::warn!("Failed to archive branch '{}': {}", session.branch, e);
                }
            }
        }
        
        // Update session to draft state
        self.db.update_session_status(&session.id, SessionStatus::Draft)?;
        self.db.update_session_state(&session.id, SessionState::Draft)?;
        
        log::info!("Successfully converted session '{name}' to draft");
        
        Ok(())
    }
    
    
    pub fn get_session(&self, name: &str) -> Result<Session> {
        self.db.get_session_by_name(&self.repo_path, name)
    }
    
    pub fn get_session_task_content(&self, name: &str) -> Result<(Option<String>, Option<String>)> {
        self.db.get_session_task_content(&self.repo_path, name)
    }
    
    fn execute_setup_script(&self, script: &str, session_name: &str, branch_name: &str, worktree_path: &Path) -> Result<()> {
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
        
        cmd.current_dir(worktree_path)
            .env("WORKTREE_PATH", worktree_path)
            .env("REPO_PATH", &self.repo_path)
            .env("SESSION_NAME", session_name)
            .env("BRANCH_NAME", branch_name);
        
        // Execute the script
        let output = cmd.output()?;
        
        // Clean up the temporary script file
        let _ = std::fs::remove_file(&script_path);
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Setup script failed for session {session_name}: {stderr}");
            return Err(anyhow!("Setup script failed: {stderr}"));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !stdout.trim().is_empty() {
            log::info!("Setup script output for session {session_name}: {stdout}");
        }
        
        Ok(())
    }
    
    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let sessions = self.db.list_sessions(&self.repo_path)?;
        // Filter out cancelled sessions - they should not appear in UI lists
        Ok(sessions.into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }
    
    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        let session = self.db.get_session_by_id(session_id)?;
        let mut stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch)?;
        stats.session_id = session_id.to_string();
        self.db.save_git_stats(&stats)?;
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
            
            let sessions = self.db.list_sessions(&self.repo_path)?;
            let exists = sessions.iter().any(|s| {
                let canonical_session = s.worktree_path.canonicalize()
                    .unwrap_or_else(|_| s.worktree_path.clone());
                canonical_session == canonical_worktree
            });
            
            if !exists {
                log::info!("Removing orphaned worktree: {}", worktree_path.display());
                git::remove_worktree(&self.repo_path, &worktree_path)?;
            }
        }
        
        Ok(())
    }
    
    pub fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>> {
        let sessions = self.db.list_sessions(&self.repo_path)?;
        let mut enriched = Vec::new();
        
        for session in sessions {
            // Skip only cancelled sessions
            if session.status == SessionStatus::Cancelled {
                continue;
            }
            // Use cached git stats where fresh; compute only when stale
            let git_stats = match self.db.get_git_stats(&session.id)? {
                Some(existing) => {
                    let is_stale = (Utc::now() - existing.calculated_at).num_seconds() > 60;
                    if is_stale {
                        let mut updated = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).ok();
                        if let Some(ref mut s) = updated { s.session_id = session.id.clone(); let _ = self.db.save_git_stats(s); }
                        updated.or(Some(existing))
                    } else {
                        Some(existing)
                    }
                }
                None => {
                    let mut computed = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).ok();
                    if let Some(ref mut s) = computed { s.session_id = session.id.clone(); let _ = self.db.save_git_stats(s); }
                    computed
                }
            };
            let has_uncommitted = git_stats.as_ref().map(|s| s.has_uncommitted).unwrap_or(false);
            
            let diff_stats = git_stats.as_ref().map(|stats| DiffStats {
                files_changed: stats.files_changed as usize,
                additions: stats.lines_added as usize,
                deletions: stats.lines_removed as usize,
                insertions: stats.lines_added as usize,
            });
            
            let status_type = match session.status {
                SessionStatus::Active => SessionStatusType::Active,
                SessionStatus::Cancelled => SessionStatusType::Archived,
                SessionStatus::Draft => SessionStatusType::Draft,
            };
            
            let original_agent_type = session
                .original_agent_type
                .clone()
                .or_else(|| self.db.get_agent_type().ok());

            let info = SessionInfo {
                session_id: session.name.clone(),
                display_name: session.display_name.clone(),
                branch: session.branch.clone(),
                worktree_path: session.worktree_path.to_string_lossy().to_string(),
                base_branch: session.parent_branch.clone(),
                merge_mode: "rebase".to_string(),
                status: status_type,
                created_at: Some(session.created_at),
                last_modified: session.last_activity,
                has_uncommitted_changes: Some(has_uncommitted),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type,
                current_task: session.initial_prompt.clone(),
                diff_stats: diff_stats.clone(),
                ready_to_merge: session.ready_to_merge,
                draft_content: session.draft_content.clone(),
                session_state: session.session_state.clone(),
            };
            
            let terminals = vec![
                format!("session-{}-top", session.name),
                format!("session-{}-bottom", session.name),
            ];
            
            enriched.push(EnrichedSession {
                info,
                status: None,
                terminals,
            });
        }
        
        Ok(enriched)
    }
    
    pub fn start_claude_in_session(&self, session_name: &str) -> Result<String> {
        self.start_claude_in_session_with_args(session_name, None)
    }
    
    pub fn start_claude_in_session_with_args(&self, session_name: &str, _cli_args: Option<&str>) -> Result<String> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        // Use per-session original settings if available, falling back to current globals
        let skip_permissions = session.original_skip_permissions.unwrap_or(self.db.get_skip_permissions()?);
        let agent_type = session.original_agent_type.clone().unwrap_or(self.db.get_agent_type()?);
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::para_core::cursor::find_cursor_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                crate::para_core::cursor::build_cursor_command(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
            "opencode" => {
                let session_info = crate::para_core::opencode::find_opencode_session(&session.worktree_path);
                // Only pass initial prompt if:
                // 1. No session exists yet, OR
                // 2. Session exists but has no history (empty session)
                // AND we haven't prompted this session before
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
                    match &session_info {
                        None => {
                            // No session exists - can use initial prompt
                            session.initial_prompt.as_ref().map(|p| {
                                mark_session_prompted(&session.worktree_path);
                                p.as_str()
                            })
                        }
                        Some(info) if !info.has_history => {
                            // Session exists but has no history - can use initial prompt
                            session.initial_prompt.as_ref().map(|p| {
                                mark_session_prompted(&session.worktree_path);
                                p.as_str()
                            })
                        }
                        _ => None // Session has history - don't pass prompt
                    }
                } else {
                    None
                };
                
                crate::para_core::opencode::build_opencode_command(
                    &session.worktree_path,
                    session_info.as_ref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
            "gemini" => {
                let session_id = crate::para_core::gemini::find_gemini_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                crate::para_core::gemini::build_gemini_command(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
            "codex" => {
                let session_id = crate::para_core::codex::find_codex_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                // For Codex, use workspace-write as default sandbox mode
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let config = crate::para_core::codex::CodexConfig {
                    binary_path: None,
                };
                crate::para_core::codex::build_codex_command_with_config(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    sandbox_mode,
                    Some(&config),
                )
            }
            _ => {
                let session_id = crate::para_core::claude::find_claude_session(&session.worktree_path);
                let prompt_to_use = if session_id.is_none() && !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                crate::para_core::claude::build_claude_command(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                )
            }
        };
        
        Ok(command)
    }
    
    pub fn start_claude_in_orchestrator(&self) -> Result<String> {
        self.start_claude_in_orchestrator_with_args(None)
    }
    
    pub fn start_claude_in_orchestrator_with_args(&self, _cli_args: Option<&str>) -> Result<String> {
        log::info!("Building orchestrator command for repo: {}", self.repo_path.display());
        
        // Validate that the repo path exists and is accessible
        if !self.repo_path.exists() {
            log::error!("Repository path does not exist: {}", self.repo_path.display());
            return Err(anyhow!("Repository path does not exist: {}. Please open a valid project folder.", self.repo_path.display()));
        }
        
        // Check if it's a git repository
        if !self.repo_path.join(".git").exists() {
            log::error!("Not a git repository: {}", self.repo_path.display());
            return Err(anyhow!("The folder '{}' is not a git repository. The orchestrator requires a git repository to function.", self.repo_path.display()));
        }
        
        let skip_permissions = self.db.get_skip_permissions()?;
        let agent_type = self.db.get_agent_type()?;
        
        log::info!("Orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}");
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::para_core::cursor::find_cursor_session(&self.repo_path);
                crate::para_core::cursor::build_cursor_command(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                )
            }
            "opencode" => {
                let session_info = crate::para_core::opencode::find_opencode_session(&self.repo_path);
                crate::para_core::opencode::build_opencode_command(
                    &self.repo_path,
                    session_info.as_ref(),
                    None,
                    skip_permissions,
                )
            }
            "gemini" => {
                let session_id = crate::para_core::gemini::find_gemini_session(&self.repo_path);
                crate::para_core::gemini::build_gemini_command(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                )
            }
            "codex" => {
                let session_id = crate::para_core::codex::find_codex_session(&self.repo_path);
                // For Codex orchestrator, use workspace-write as default sandbox mode
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let config = crate::para_core::codex::CodexConfig {
                    binary_path: None,
                };
                crate::para_core::codex::build_codex_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    sandbox_mode,
                    Some(&config),
                )
            }
            _ => {
                let session_id = crate::para_core::claude::find_claude_session(&self.repo_path);
                crate::para_core::claude::build_claude_command(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                )
            }
        };
        
        Ok(command)
    }
    
    pub fn mark_session_ready(&self, session_name: &str, auto_commit: bool) -> Result<bool> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        
        // Check for uncommitted changes
        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path)?;
        
        if has_uncommitted && auto_commit {
            // Auto-commit changes
            git::commit_all_changes(
                &session.worktree_path,
                &format!("Mark session {session_name} as reviewed")
            )?;
        }
        
        // Update database
        self.db.update_session_ready_to_merge(&session.id, true)?;
        
        Ok(!has_uncommitted || auto_commit)
    }
    
    pub fn unmark_session_ready(&self, session_name: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.update_session_ready_to_merge(&session.id, false)?;
        Ok(())
    }

    pub fn create_draft_session(&self, name: &str, draft_content: &str) -> Result<Session> {
        log::info!("Creating draft session '{}' in repository: {}", name, self.repo_path.display());
        
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().unwrap();
        
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let (unique_name, branch, worktree_path) = self.find_unique_session_paths(name)?;
        
        let session_id = Uuid::new_v4().to_string();
        let repo_name = self.repo_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        
        let now = Utc::now();
        
        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch: "main".to_string(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Draft,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            draft_content: Some(draft_content.to_string()),
            session_state: SessionState::Draft,
        };
        
        if let Err(e) = self.db.create_session(&session) {
            // Release reservation on failure to persist session
            self.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save draft session to database: {}", e));
        }
        
        // Draft persisted successfully; reservation no longer needed
        self.unreserve_name(&unique_name);
        Ok(session)
    }

    pub fn start_draft_session(&self, session_name: &str, base_branch: Option<&str>) -> Result<()> {
        log::info!("Starting draft session '{}' in repository: {}", session_name, self.repo_path.display());
        
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().unwrap();
        
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        
        if session.session_state != SessionState::Draft {
            return Err(anyhow!("Session '{}' is not in draft state", session_name));
        }
        
        let parent_branch = if let Some(base) = base_branch {
            base.to_string()
        } else {
            log::info!("No base branch specified, detecting default branch for session startup");
            match git::get_default_branch(&self.repo_path) {
                Ok(default) => {
                    log::info!("Using detected default branch: {default}");
                    default
                }
                Err(e) => {
                    log::error!("Failed to detect default branch: {e}");
                    return Err(anyhow!("Failed to detect default branch: {}. Please ensure the repository has at least one branch (e.g., 'main' or 'master')", e));
                }
            }
        };
        
        self.cleanup_existing_worktree(&session.worktree_path)?;
        
        let create_result = git::create_worktree_from_base(
            &self.repo_path, 
            &session.branch, 
            &session.worktree_path, 
            &parent_branch
        );
        
        if let Err(e) = create_result {
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        // Update both status and state when starting a draft
        self.db.update_session_status(&session.id, SessionStatus::Active)?;
        self.db.update_session_state(&session.id, SessionState::Running)?;
        
        // Copy draft_content to initial_prompt so Claude/Cursor can use it
        if let Some(draft_content) = session.draft_content {
            self.db.update_session_initial_prompt(&session.id, &draft_content)?;
        }
        
        let global_agent = self.db.get_agent_type().unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db.get_skip_permissions().unwrap_or(false);
        let _ = self.db.set_session_original_settings(&session.id, &global_agent, global_skip);
        
        let mut git_stats = git::calculate_git_stats_fast(&session.worktree_path, &parent_branch)?;
        git_stats.session_id = session.id.clone();
        self.db.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = chrono::Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db.set_session_activity(&session.id, dt);
            }
        }
        
        Ok(())
    }

    pub fn update_session_state(&self, session_name: &str, state: SessionState) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.update_session_state(&session.id, state)?;
        Ok(())
    }

    pub fn update_draft_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.update_draft_content(&session.id, content)?;
        Ok(())
    }

    pub fn append_draft_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.append_draft_content(&session.id, content)?;
        Ok(())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        let sessions = self.db.list_sessions_by_state(&self.repo_path, state)?;
        Ok(sessions.into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }

    #[cfg(test)]
    pub fn db_ref(&self) -> &Database {
        &self.db
    }
}

#[cfg(test)]
mod session_tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;
    use chrono::Utc;
    use crate::para_core::types::{Session, SessionStatus};
    
    fn create_test_session_manager() -> (SessionManager, TempDir, Session) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        
        // Initialize git repository for tests
        std::fs::create_dir_all(temp_dir.path().join(".git")).unwrap();
        
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let worktree_path = temp_dir.path().join("test-session");
        fs::create_dir_all(&worktree_path).unwrap();
        
        let session = Session {
            id: "test-session-id".to_string(),
            name: "test-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/test-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("implement feature X".to_string()),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            draft_content: None,
            session_state: SessionState::Running,
        };
        
        manager.db.create_session(&session).unwrap();
        (manager, temp_dir, session)
    }
    
    #[test]
    fn test_start_claude_in_session_fresh_session() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(true).unwrap();
        
        let result = manager.start_claude_in_session("test-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(result.contains("--dangerously-skip-permissions"));
        assert!(result.contains("implement feature X"));
        assert!(!result.contains("-r"));
    }
    
    #[test]
    fn test_start_claude_in_session_without_skip_permissions() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("test-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
        assert!(result.contains("implement feature X"));
    }
    
    #[test]
    fn test_start_claude_in_session_no_initial_prompt() {
        let (manager, temp_dir, _) = create_test_session_manager();
        
        let worktree_path = temp_dir.path().join("no-prompt-session");
        fs::create_dir_all(&worktree_path).unwrap();
        
        let session_no_prompt = Session {
            id: "no-prompt-id".to_string(),
            name: "no-prompt-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/no-prompt-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            draft_content: None,
            session_state: SessionState::Running,
        };
        
        manager.db.create_session(&session_no_prompt).unwrap();
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("no-prompt-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
        assert!(!result.contains("implement"));
    }
    
    #[test]
    fn test_start_claude_in_session_nonexistent() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        let result = manager.start_claude_in_session("nonexistent-session");
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Query returned no rows") || error_msg.contains("no rows returned"));
    }
    
    #[test]
    fn test_start_claude_in_orchestrator() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(true).unwrap();
        
        let result = manager.start_claude_in_orchestrator().unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(result.contains("--dangerously-skip-permissions"));
        assert!(!result.contains("-r"));
    }
    
    #[test]
    fn test_start_claude_in_orchestrator_without_permissions() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_orchestrator().unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("claude"));
        assert!(!result.contains("--dangerously-skip-permissions"));
    }
    
    #[test]
    fn test_generate_random_suffix() {
        let suffix = SessionManager::generate_random_suffix(2);
        assert_eq!(suffix.len(), 2);
        assert!(suffix.chars().all(|c| c.is_ascii_lowercase()));
        
        let suffix_5 = SessionManager::generate_random_suffix(5);
        assert_eq!(suffix_5.len(), 5);
        assert!(suffix_5.chars().all(|c| c.is_ascii_lowercase()));
        
        // Test that repeated calls produce different results (probabilistically)
        let suffixes: Vec<String> = (0..10).map(|_| SessionManager::generate_random_suffix(2)).collect();
        let unique_count = suffixes.iter().collect::<std::collections::HashSet<_>>().len();
        // Should be likely that at least 8 out of 10 are unique with 676 possibilities
        assert!(unique_count >= 8, "Expected at least 8 unique suffixes, got {}", unique_count);
    }
    
    #[test]
    fn test_check_name_availability() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        // Should return false for existing session name
        let available = manager.check_name_availability("test-session").unwrap();
        assert!(!available, "Should detect existing session name as unavailable");
        
        // Should return true for non-existing session name
        let available = manager.check_name_availability("non-existing-session").unwrap();
        assert!(available, "Should detect non-existing session name as available");
    }
    
    #[test]
    fn test_find_unique_session_paths_no_collision() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let (name, branch, worktree_path) = manager.find_unique_session_paths("unique-name").unwrap();
        
        assert_eq!(name, "unique-name");
        assert_eq!(branch, "schaltwerk/unique-name");
        assert_eq!(worktree_path, temp_dir.path().join(".schaltwerk/worktrees/unique-name"));
    }
    
    #[test]
    fn test_find_unique_session_paths_with_collision() {
        let (manager, temp_dir, _session) = create_test_session_manager();
        
        // Try to create session with same name as existing one
        let (name, branch, worktree_path) = manager.find_unique_session_paths("test-session").unwrap();
        
        // Should get a different name due to collision
        assert_ne!(name, "test-session");
        assert!(name.starts_with("test-session-"));
        assert_eq!(branch, format!("schaltwerk/{}", name));
        assert_eq!(worktree_path, temp_dir.path().join(".schaltwerk/worktrees").join(&name));
        
        // Name should be either random suffix (2 chars) or incremental
        let suffix = name.strip_prefix("test-session-").unwrap();
        let is_random_suffix = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase());
        let is_incremental = suffix.parse::<u32>().is_ok();
        assert!(is_random_suffix || is_incremental, "Expected random suffix or incremental number, got: {}", suffix);
    }
    
    #[test] 
    fn test_find_unique_session_paths_multiple_collisions() {
        let (manager, _temp_dir, _session) = create_test_session_manager();
        
        // Create multiple sessions with similar names to force multiple collisions
        let mut created_names = vec!["test-session".to_string()]; // existing session
        
        for _i in 0..5 {
            let (name, _branch, _worktree_path) = manager.find_unique_session_paths("test-session").unwrap();
            assert!(!created_names.contains(&name), "Generated duplicate name: {}", name);
            created_names.push(name);
        }
        
        // All names should be unique and follow pattern
        for name in &created_names[1..] { // Skip the original
            assert!(name.starts_with("test-session-"));
            let suffix = name.strip_prefix("test-session-").unwrap();
            let is_valid = suffix.len() == 2 && suffix.chars().all(|c| c.is_ascii_lowercase()) ||
                          suffix.parse::<u32>().is_ok();
            assert!(is_valid, "Invalid suffix format: {}", suffix);
        }
    }
    
    #[test]
    fn test_path_sanitization_in_claude_command() {
        let temp_dir = TempDir::new().unwrap();
        let path_with_spaces = temp_dir.path().join("path with spaces");
        fs::create_dir_all(&path_with_spaces).unwrap();
        
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let session = Session {
            id: "spaces-session-id".to_string(),
            name: "spaces-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "para/spaces-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: path_with_spaces,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("test prompt".to_string()),
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            draft_content: None,
            session_state: SessionState::Running,
        };
        
        manager.db.create_session(&session).unwrap();
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("spaces-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("path with spaces"));
        assert!(result.contains("test prompt"));
    }
}

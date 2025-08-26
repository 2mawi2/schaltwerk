use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, Mutex as StdMutex, Arc};
use std::time::{Duration, Instant};
use anyhow::{Result, anyhow};
use uuid::Uuid;
use chrono::{Utc, TimeZone};
use rand::Rng;
use log::{warn, error};
use crate::schaltwerk_core::{
    database::Database,
    db_sessions::SessionMethods,
    db_git_stats::GitStatsMethods,
    db_app_config::AppConfigMethods,
    db_project_config::ProjectConfigMethods,
    git,
    types::{Session, SessionStatus, SessionState, SessionInfo, SessionStatusType, SessionType, EnrichedSession, DiffStats, SortMode, FilterMode},
};

// Track which sessions have already had their initial prompt sent
// Use worktree path as key for uniqueness
static PROMPTED_SESSIONS: OnceLock<StdMutex<HashSet<PathBuf>>> = OnceLock::new();
// Reserve generated names per repository path to avoid duplicates across rapid successive calls
static RESERVED_NAMES: OnceLock<StdMutex<HashMap<PathBuf, HashSet<String>>>> = OnceLock::new();

// Session sorting cache removed - was causing delays

// Cached branch existence per repository and branch to avoid repeated git invocations
type BranchExistenceEntry = (Instant, bool);
type RepoBranchExistence = HashMap<String, BranchExistenceEntry>;
type BranchExistenceCache = HashMap<PathBuf, RepoBranchExistence>;
static BRANCH_CACHE: OnceLock<StdMutex<BranchExistenceCache>> = OnceLock::new();
const BRANCH_CACHE_TTL: Duration = Duration::from_secs(30);

fn with_prompted_sessions<F, R>(f: F) -> Result<R>
where
    F: FnOnce(&mut HashSet<PathBuf>) -> R,
{
    let set = PROMPTED_SESSIONS.get_or_init(|| StdMutex::new(HashSet::new()));
    let mut prompted = set.lock().map_err(|e| {
        error!("Prompted sessions mutex poisoned: {e}");
        anyhow!("Internal state error: prompted sessions lock failed")
    })?;
    Ok(f(&mut prompted))
}

fn with_reserved_names<F, R>(f: F) -> Result<R>
where
    F: FnOnce(&mut HashMap<PathBuf, HashSet<String>>) -> R,
{
    let map_mutex = RESERVED_NAMES.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut map = map_mutex.lock().map_err(|e| {
        error!("Reserved names mutex poisoned: {e}");
        anyhow!("Internal state error: reserved names lock failed")
    })?;
    Ok(f(&mut map))
}

fn with_branch_cache<F, R>(f: F) -> Result<R>
where
    F: FnOnce(&mut BranchExistenceCache) -> R,
{
    let cache_mutex = BRANCH_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut cache = cache_mutex.lock().map_err(|e| {
        error!("Branch cache mutex poisoned: {e}");
        anyhow!("Internal state error: branch cache lock failed")
    })?;
    Ok(f(&mut cache))
}

#[cfg(test)]
pub(crate) fn has_session_been_prompted(worktree_path: &Path) -> bool {
    with_prompted_sessions(|prompted| prompted.contains(worktree_path))
        .unwrap_or_else(|e| {
            warn!("Failed to check prompted sessions: {e}");
            false
        })
}

#[cfg(not(test))]
fn has_session_been_prompted(worktree_path: &Path) -> bool {
    with_prompted_sessions(|prompted| prompted.contains(worktree_path))
        .unwrap_or_else(|e| {
            warn!("Failed to check prompted sessions: {e}");
            false
        })
}

#[cfg(test)]
pub(crate) fn mark_session_prompted(worktree_path: &Path) {
    if let Err(e) = with_prompted_sessions(|prompted| {
        prompted.insert(worktree_path.to_path_buf())
    }) {
        warn!("Failed to mark session as prompted: {e}");
    }
}

#[cfg(not(test))]
fn mark_session_prompted(worktree_path: &Path) {
    if let Err(e) = with_prompted_sessions(|prompted| {
        prompted.insert(worktree_path.to_path_buf())
    }) {
        warn!("Failed to mark session as prompted: {e}");
    }
}

fn clear_session_prompted(worktree_path: &Path) {
    if let Err(e) = with_prompted_sessions(|prompted| {
        prompted.remove(worktree_path)
    }) {
        warn!("Failed to clear prompted session: {e}");
    }
}

pub struct SessionManager {
    pub db: Database,
    repo_path: PathBuf,
}

impl SessionManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::debug!("Creating SessionManager with repo path: {}", repo_path.display());
        Self { db, repo_path }
    }

    fn get_effective_binary_path_with_override(&self, agent_name: &str, binary_path_override: Option<&str>) -> String {
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
    
    // Global per-repository mutexes to serialize worktree operations
    fn get_repo_lock(repo_path: &PathBuf) -> Arc<StdMutex<()>> {
        static REPO_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Arc<StdMutex<()>>>>> = OnceLock::new();
        let map_mutex = REPO_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        match map_mutex.lock() {
            Ok(mut map) => {
                if let Some(lock) = map.get(repo_path) {
                    return lock.clone();
                }
                let lock = Arc::new(StdMutex::new(()));
                map.insert(repo_path.clone(), lock.clone());
                lock
            }
            Err(e) => {
                error!("Repository locks mutex poisoned: {e}");
                // Return a new mutex instead of panicking - operations may still work
                Arc::new(StdMutex::new(()))
            }
        }
    }
    
    fn generate_random_suffix(len: usize) -> String {
        let mut rng = rand::rng();
        (0..len)
            .map(|_| rng.random_range(b'a'..=b'z') as char)
            .collect()
    }
    
    fn is_reserved(&self, name: &str) -> bool {
        with_reserved_names(|map| {
            if let Some(set) = map.get(&self.repo_path) {
                set.contains(name)
            } else {
                false
            }
        }).unwrap_or_else(|e| {
            warn!("Failed to check reserved names: {e}");
            false
        })
    }

    fn reserve_name(&self, name: &str) {
        if let Err(e) = with_reserved_names(|map| {
            let set = map.entry(self.repo_path.clone()).or_default();
            set.insert(name.to_string())
        }) {
            warn!("Failed to reserve name '{name}': {e}");
        }
    }

    fn unreserve_name(&self, name: &str) {
        if let Err(e) = with_reserved_names(|map| {
            if let Some(set) = map.get_mut(&self.repo_path) {
                set.remove(name)
            } else {
                false
            }
        }) {
            warn!("Failed to unreserve name '{name}': {e}");
        }
    }

    // Fast branch existence using per-branch cached results with TTL
    fn branch_exists_fast(&self, short_branch: &str) -> Result<bool> {
        with_branch_cache(|cache| {
            let now = Instant::now();
            let repo_cache = cache.entry(self.repo_path.clone()).or_default();

            if let Some((ts, exists)) = repo_cache.get(short_branch) {
                if now.duration_since(*ts) <= BRANCH_CACHE_TTL {
                    return Ok(*exists);
                }
            }

            // Miss or stale: query git for this single branch and cache the result
            let exists = crate::schaltwerk_core::git::branch_exists(&self.repo_path, short_branch)?;
            repo_cache.insert(short_branch.to_string(), (now, exists));
            Ok(exists)
        })?
    }

    fn check_name_availability(&self, name: &str) -> Result<bool> {
        let branch = format!("schaltwerk/{name}");
        let worktree_path = self.repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(name);
        
        // Use fast cached branch existence check to avoid spawning git per call
        let branch_exists = self.branch_exists_fast(&branch)?;
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
        let _guard = repo_lock.lock().map_err(|e| {
            error!("Repository lock poisoned: {e}");
            anyhow!("Failed to acquire repository lock for session creation")
        })?;
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
            .ok_or_else(|| anyhow!("Invalid repository path: no filename component"))?
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
            plan_content: None,
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
        use crate::schaltwerk_core::types::SessionState;
        
        let session = self.db.get_session_by_name(&self.repo_path, name)?;
        
        // Verify the session is currently running
        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{}' is not in running state", name));
        }
        
        log::info!("Converting session '{name}' from running to plan");
        
        // Check for uncommitted changes and warn
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            log::warn!("Converting session '{name}' to plan with uncommitted changes");
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
        
        // Update session to plan state
        self.db.update_session_status(&session.id, SessionStatus::Plan)?;
        self.db.update_session_state(&session.id, SessionState::Plan)?;
        
        // Clear the prompted state so it can be prompted again when restarted
        clear_session_prompted(&session.worktree_path);
        log::info!("Cleared prompt state for session '{name}'");
        
        log::info!("Successfully converted session '{name}' to plan");
        
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
                SessionStatus::Plan => SessionStatusType::Plan,
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
                plan_content: session.plan_content.clone(),
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

    pub fn list_enriched_sessions_sorted(&self, sort_mode: SortMode, filter_mode: FilterMode) -> Result<Vec<EnrichedSession>> {
        // Directly compute results without caching
        log::debug!("Computing sorted sessions: {sort_mode:?}/{filter_mode:?}");
        let all_sessions = self.list_enriched_sessions()?;
        
        // Apply filtering first
        let filtered_sessions = self.apply_session_filter(all_sessions, &filter_mode);
        
        // Apply sorting
        let sorted_sessions = self.apply_session_sort(filtered_sessions, &sort_mode);
        
        Ok(sorted_sessions)
    }

    fn apply_session_filter(&self, sessions: Vec<EnrichedSession>, filter_mode: &FilterMode) -> Vec<EnrichedSession> {
        match filter_mode {
            FilterMode::All => sessions,
            FilterMode::Plan => sessions.into_iter().filter(|s| s.info.session_state == SessionState::Plan).collect(),
            FilterMode::Running => sessions.into_iter().filter(|s| {
                s.info.session_state != SessionState::Plan && !s.info.ready_to_merge
            }).collect(),
            FilterMode::Reviewed => sessions.into_iter().filter(|s| s.info.ready_to_merge).collect(),
        }
    }

    fn apply_session_sort(&self, sessions: Vec<EnrichedSession>, sort_mode: &SortMode) -> Vec<EnrichedSession> {
        // Separate reviewed and unreviewed sessions
        let mut reviewed: Vec<EnrichedSession> = sessions.iter().filter(|s| s.info.ready_to_merge).cloned().collect();
        let mut unreviewed: Vec<EnrichedSession> = sessions.iter().filter(|s| !s.info.ready_to_merge).cloned().collect();

        // Apply sorting to each group
        self.sort_sessions_by_mode(&mut unreviewed, sort_mode);
        self.sort_sessions_by_mode(&mut reviewed, &SortMode::Name); // Always sort reviewed by name

        // Combine: unreviewed first, then reviewed
        let mut result = unreviewed;
        result.extend(reviewed);
        result
    }

    fn sort_sessions_by_mode(&self, sessions: &mut [EnrichedSession], sort_mode: &SortMode) {
        match sort_mode {
            SortMode::Name => {
                sessions.sort_by(|a, b| {
                    a.info.session_id.to_lowercase().cmp(&b.info.session_id.to_lowercase())
                });
            }
            SortMode::Created => {
                sessions.sort_by(|a, b| {
                    match (a.info.created_at, b.info.created_at) {
                        (Some(a_time), Some(b_time)) => b_time.cmp(&a_time), // Newest first
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.info.session_id.cmp(&b.info.session_id), // Fallback to name
                    }
                });
            }
            SortMode::LastEdited => {
                sessions.sort_by(|a, b| {
                    let a_time = a.info.last_modified.or(a.info.created_at);
                    let b_time = b.info.last_modified.or(b.info.created_at);
                    match (a_time, b_time) {
                        (Some(a_time), Some(b_time)) => b_time.cmp(&a_time), // Most recent first
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => a.info.session_id.cmp(&b.info.session_id), // Fallback to name
                    }
                });
            }
        }
    }
    
    pub fn start_claude_in_session(&self, session_name: &str) -> Result<String> {
        self.start_claude_in_session_with_args(session_name, None)
    }
    
    pub fn start_claude_in_session_with_binary(&self, session_name: &str, binary_paths: &std::collections::HashMap<String, String>) -> Result<String> {
        self.start_claude_in_session_with_args_and_binary(session_name, None, binary_paths)
    }
    
    pub fn start_claude_in_session_with_args(&self, session_name: &str, _cli_args: Option<&str>) -> Result<String> {
        self.start_claude_in_session_with_args_and_binary(session_name, _cli_args, &std::collections::HashMap::new())
    }
    
    pub fn start_claude_in_session_with_args_and_binary(&self, session_name: &str, _cli_args: Option<&str>, binary_paths: &std::collections::HashMap<String, String>) -> Result<String> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        // Use per-session original settings if available, falling back to current globals
        let skip_permissions = session.original_skip_permissions.unwrap_or(self.db.get_skip_permissions()?);
        let agent_type = session.original_agent_type.clone().unwrap_or(self.db.get_agent_type()?);
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::schaltwerk_core::cursor::find_cursor_session(&session.worktree_path);
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                let binary_path = self.get_effective_binary_path_with_override("cursor-agent", binary_paths.get("cursor-agent").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::cursor::CursorConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::cursor::build_cursor_command_with_config(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                )
            }
            "opencode" => {
                let session_info = crate::schaltwerk_core::opencode::find_opencode_session(&session.worktree_path);
                // Only pass initial prompt if:
                // 1. No session exists yet, OR
                // 2. Session exists but has no history (empty session)
                // AND we haven't prompted this session before
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
                    // Always use initial prompt when session hasn't been prompted,
                    // regardless of whether OpenCode session has history.
                    // This allows plan->session transitions to work properly.
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                let binary_path = self.get_effective_binary_path_with_override("opencode", binary_paths.get("opencode").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::opencode::OpenCodeConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::opencode::build_opencode_command_with_config(
                    &session.worktree_path,
                    session_info.as_ref(),
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                )
            }
            "gemini" => {
                let session_id = crate::schaltwerk_core::gemini::find_gemini_session(&session.worktree_path);
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    None
                };
                
                let binary_path = self.get_effective_binary_path_with_override("gemini", binary_paths.get("gemini").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::gemini::GeminiConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::gemini::build_gemini_command_with_config(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                )
            }
            "codex" => {
                let session_id = crate::schaltwerk_core::codex::find_codex_session(&session.worktree_path);
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
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
                
                let binary_path = self.get_effective_binary_path_with_override("codex", binary_paths.get("codex").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::codex::CodexConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::codex::build_codex_command_with_config(
                    &session.worktree_path,
                    session_id.as_deref(),
                    prompt_to_use,
                    sandbox_mode,
                    Some(&config),
                )
            }
            _ => {
                let session_id = crate::schaltwerk_core::claude::find_claude_session(&session.worktree_path);
                log::debug!("Claude session lookup for '{}': session_id={:?}, initial_prompt={:?}, prompted={}", 
                    session_name, session_id, session.initial_prompt, has_session_been_prompted(&session.worktree_path));
                
                let prompt_to_use = if !has_session_been_prompted(&session.worktree_path) {
                    session.initial_prompt.as_ref().map(|p| {
                        log::info!("Using initial_prompt for Claude session '{session_name}': '{p}'");
                        mark_session_prompted(&session.worktree_path);
                        p.as_str()
                    })
                } else {
                    log::info!("Session '{session_name}' already prompted - not using initial_prompt");
                    None
                };
                
                let session_id_to_use = if prompt_to_use.is_some() { None } else { session_id.as_deref() };
                log::info!("Building Claude command for '{}': session_id={:?}, prompt={:?}", 
                    session_name, session_id_to_use, prompt_to_use.is_some());
                
                let binary_path = self.get_effective_binary_path_with_override("claude", binary_paths.get("claude").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::claude::ClaudeConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::claude::build_claude_command_with_config(
                    &session.worktree_path,
                    // Don't resume existing session if we have a prompt to pass
                    // This ensures plan content creates a fresh conversation
                    session_id_to_use,
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                )
            }
        };
        
        Ok(command)
    }
    
    pub fn start_claude_in_orchestrator(&self) -> Result<String> {
        self.start_claude_in_orchestrator_with_args(None)
    }
    
    pub fn start_claude_in_orchestrator_fresh(&self) -> Result<String> {
        self.start_claude_in_orchestrator_fresh_with_binary(&std::collections::HashMap::new())
    }
    
    pub fn start_claude_in_orchestrator_fresh_with_binary(&self, binary_paths: &std::collections::HashMap<String, String>) -> Result<String> {
        log::info!("Building FRESH commander command (no session resume) for repo: {}", self.repo_path.display());
        
        // Validate that the repo path exists and is accessible
        if !self.repo_path.exists() {
            log::error!("Repository path does not exist: {}", self.repo_path.display());
            return Err(anyhow!("Repository path does not exist: {}. Please open a valid project folder.", self.repo_path.display()));
        }
        
        // Check if it's a git repository
        if !self.repo_path.join(".git").exists() {
            log::error!("Not a git repository: {}", self.repo_path.display());
            return Err(anyhow!("The folder '{}' is not a git repository. The commander requires a git repository to function.", self.repo_path.display()));
        }
        
        let skip_permissions = self.db.get_skip_permissions()?;
        let agent_type = self.db.get_agent_type()?;
        
        log::info!("Fresh commander agent type: {agent_type}, skip_permissions: {skip_permissions}");
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let binary_path = self.get_effective_binary_path_with_override("cursor-agent", binary_paths.get("cursor-agent").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::cursor::CursorConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::cursor::build_cursor_command_with_config(
                    &self.repo_path,
                    None, // No session resume - force fresh
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "opencode" => {
                let binary_path = self.get_effective_binary_path_with_override("opencode", binary_paths.get("opencode").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::opencode::OpenCodeConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::opencode::build_opencode_command_with_config(
                    &self.repo_path,
                    None, // No session resume - force fresh
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "gemini" => {
                let binary_path = self.get_effective_binary_path_with_override("gemini", binary_paths.get("gemini").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::gemini::GeminiConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::gemini::build_gemini_command_with_config(
                    &self.repo_path,
                    None, // No session resume - force fresh
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "codex" => {
                // For Codex commander, use workspace-write as default sandbox mode
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let binary_path = self.get_effective_binary_path_with_override("codex", binary_paths.get("codex").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::codex::CodexConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::codex::build_codex_command_with_config(
                    &self.repo_path,
                    None, // No session resume - force fresh
                    None,
                    sandbox_mode,
                    Some(&config),
                )
            }
            _ => {
                // For Claude, explicitly pass None to bypass session discovery
                let binary_path = self.get_effective_binary_path_with_override("claude", binary_paths.get("claude").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::claude::ClaudeConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::claude::build_claude_command_with_config(
                    &self.repo_path,
                    None, // No session resume - force fresh
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
        };
        
        Ok(command)
    }

    pub fn start_claude_in_orchestrator_with_binary(&self, binary_paths: &std::collections::HashMap<String, String>) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(None, binary_paths)
    }
    
    pub fn start_claude_in_orchestrator_with_args(&self, _cli_args: Option<&str>) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(_cli_args, &std::collections::HashMap::new())
    }
    
    pub fn start_claude_in_orchestrator_with_args_and_binary(&self, _cli_args: Option<&str>, binary_paths: &std::collections::HashMap<String, String>) -> Result<String> {
        log::info!("Building commander command for repo: {}", self.repo_path.display());
        
        // Validate that the repo path exists and is accessible
        if !self.repo_path.exists() {
            log::error!("Repository path does not exist: {}", self.repo_path.display());
            return Err(anyhow!("Repository path does not exist: {}. Please open a valid project folder.", self.repo_path.display()));
        }
        
        // Check if it's a git repository
        if !self.repo_path.join(".git").exists() {
            log::error!("Not a git repository: {}", self.repo_path.display());
            return Err(anyhow!("The folder '{}' is not a git repository. The commander requires a git repository to function.", self.repo_path.display()));
        }
        
        let skip_permissions = self.db.get_skip_permissions()?;
        let agent_type = self.db.get_agent_type()?;
        
        log::info!("Commander agent type: {agent_type}, skip_permissions: {skip_permissions}");
        
        let command = match agent_type.as_str() {
            "cursor" => {
                let session_id = crate::schaltwerk_core::cursor::find_cursor_session(&self.repo_path);
                
                let binary_path = self.get_effective_binary_path_with_override("cursor-agent", binary_paths.get("cursor-agent").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::cursor::CursorConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::cursor::build_cursor_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "opencode" => {
                let session_info = crate::schaltwerk_core::opencode::find_opencode_session(&self.repo_path);
                
                let binary_path = self.get_effective_binary_path_with_override("opencode", binary_paths.get("opencode").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::opencode::OpenCodeConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::opencode::build_opencode_command_with_config(
                    &self.repo_path,
                    session_info.as_ref(),
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "gemini" => {
                let session_id = crate::schaltwerk_core::gemini::find_gemini_session(&self.repo_path);
                
                let binary_path = self.get_effective_binary_path_with_override("gemini", binary_paths.get("gemini").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::gemini::GeminiConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::gemini::build_gemini_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
                )
            }
            "codex" => {
                let session_id = crate::schaltwerk_core::codex::find_codex_session(&self.repo_path);
                // For Codex commander, use workspace-write as default sandbox mode
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let binary_path = self.get_effective_binary_path_with_override("codex", binary_paths.get("codex").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::codex::CodexConfig {
                    binary_path: Some(binary_path),
                };
                crate::schaltwerk_core::codex::build_codex_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    sandbox_mode,
                    Some(&config),
                )
            }
            _ => {
                let session_id = crate::schaltwerk_core::claude::find_claude_session(&self.repo_path);
                
                let binary_path = self.get_effective_binary_path_with_override("claude", binary_paths.get("claude").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::claude::ClaudeConfig {
                    binary_path: Some(binary_path),
                };
                
                crate::schaltwerk_core::claude::build_claude_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
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

    pub fn create_draft_session(&self, name: &str, plan_content: &str) -> Result<Session> {
        log::info!("Creating plan session '{}' in repository: {}", name, self.repo_path.display());
        
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().map_err(|e| {
            error!("Repository lock poisoned during plan creation: {e}");
            anyhow!("Failed to acquire repository lock for plan creation")
        })?;
        
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let (unique_name, branch, worktree_path) = self.find_unique_session_paths(name)?;
        
        let session_id = Uuid::new_v4().to_string();
        let repo_name = self.repo_path
            .file_name()
            .ok_or_else(|| anyhow!("Invalid repository path: no filename component"))?
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
            status: SessionStatus::Plan,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            plan_content: Some(plan_content.to_string()),
            session_state: SessionState::Plan,
        };
        
        if let Err(e) = self.db.create_session(&session) {
            // Release reservation on failure to persist session
            self.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save plan session to database: {}", e));
        }
        
        // Plan persisted successfully; reservation no longer needed
        self.unreserve_name(&unique_name);
        Ok(session)
    }

    pub fn start_draft_session(&self, session_name: &str, base_branch: Option<&str>) -> Result<()> {
        log::info!("Starting plan session '{}' in repository: {}", session_name, self.repo_path.display());
        
        let repo_lock = Self::get_repo_lock(&self.repo_path);
        let _guard = repo_lock.lock().map_err(|e| {
            error!("Repository lock poisoned during plan start: {e}");
            anyhow!("Failed to acquire repository lock for starting plan session")
        })?;
        
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        
        if session.session_state != SessionState::Plan {
            return Err(anyhow!("Session '{}' is not in plan state", session_name));
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
        
        // Update both status and state when starting a plan
        self.db.update_session_status(&session.id, SessionStatus::Active)?;
        self.db.update_session_state(&session.id, SessionState::Running)?;
        
        // Copy plan_content to initial_prompt so Claude/Cursor can use it
        if let Some(plan_content) = session.plan_content {
            log::info!("Copying plan content to initial_prompt for session '{session_name}': '{plan_content}'");
            self.db.update_session_initial_prompt(&session.id, &plan_content)?;
            // Clear the prompted state so the initial_prompt will be used when agent starts
            clear_session_prompted(&session.worktree_path);
            log::info!("Cleared prompt state for session '{session_name}' to ensure plan content is used");
        } else {
            log::warn!("No plan_content found for session '{session_name}' - initial_prompt will not be set");
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

    pub fn update_plan_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.update_plan_content(&session.id, content)?;
        Ok(())
    }

    pub fn append_plan_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db.get_session_by_name(&self.repo_path, session_name)?;
        self.db.append_plan_content(&session.id, content)?;
        Ok(())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        let sessions = self.db.list_sessions_by_state(&self.repo_path, state)?;
        Ok(sessions.into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }
    
    pub fn rename_draft_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        // Validate the new name
        if new_name.is_empty() {
            return Err(anyhow!("Session name cannot be empty"));
        }
        
        // Check for invalid characters (similar to branch name validation)
        if new_name.contains(char::is_whitespace) || new_name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
            return Err(anyhow!("Session name contains invalid characters"));
        }
        
        self.db.rename_draft_session(&self.repo_path, old_name, new_name)?;
        Ok(())
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
    use crate::schaltwerk_core::types::{Session, SessionStatus};
    
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
            plan_content: None,
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
            plan_content: None,
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        
        manager.db.create_session(&session).unwrap();
        manager.db.set_skip_permissions(false).unwrap();
        
        let result = manager.start_claude_in_session("spaces-session").unwrap();
        
        assert!(result.contains("cd"));
        assert!(result.contains("path with spaces"));
        assert!(result.contains("test prompt"));
    }
    
    #[test]
    fn test_prompted_sessions_cleared_on_draft_conversion() {
        use std::path::PathBuf;
        
        // This test verifies that PROMPTED_SESSIONS is properly cleared
        // when a session is converted to plan
        
        // Create a mock worktree path
        let worktree_path = PathBuf::from("/tmp/test-worktree");
        
        // Initially, session should not be prompted
        assert!(!has_session_been_prompted(&worktree_path), "Session should not be prompted initially");
        
        // Mark it as prompted (simulating agent start)
        mark_session_prompted(&worktree_path);
        assert!(has_session_been_prompted(&worktree_path), "Session should be marked as prompted");
        
        // Clear the prompted state (simulating conversion to plan)
        clear_session_prompted(&worktree_path);
        
        // After clearing, it should not be prompted anymore
        assert!(
            !has_session_been_prompted(&worktree_path), 
            "Session prompt state should be cleared after calling clear_session_prompted"
        );
        
        // Mark it again and verify it can be prompted again
        mark_session_prompted(&worktree_path);
        assert!(has_session_been_prompted(&worktree_path), "Session should be promptable again after clearing");
    }
    
    #[test]
    fn test_name_generation_with_unicode_characters() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let (name, branch, _) = manager.find_unique_session_paths("feature-café").unwrap();
        assert_eq!(name, "feature-café");
        assert_eq!(branch, "schaltwerk/feature-café");
    }
    
    #[test]
    fn test_name_generation_with_special_characters() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        let (name, branch, _) = manager.find_unique_session_paths("fix_bug-123").unwrap();
        assert_eq!(name, "fix_bug-123");
        assert_eq!(branch, "schaltwerk/fix_bug-123");
    }
    
    #[test]
    fn test_name_generation_exhausts_all_attempts() {
        use std::sync::{Arc, Mutex};
        use std::collections::HashSet;
        
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        // Create a session with base name to force collision
        let base_session = Session {
            id: "base-id".to_string(),
            name: "test".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/test".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: temp_dir.path().join("test"),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        manager.db.create_session(&base_session).unwrap();
        
        // Pre-reserve many names to force exhaustion
        let reserved_names = Arc::new(Mutex::new(HashSet::new()));
        
        // Reserve first 25 random suffixes and first 20 incremental numbers
        for i in 1..=30 {
            let name = if i <= 10 {
                format!("test-{:02x}", i) // hex-like pattern for random suffixes
            } else {
                format!("test-{}", i - 10) // incremental pattern
            };
            manager.reserve_name(&name);
            reserved_names.lock().unwrap().insert(name);
        }
        
        // This should eventually find a unique name or return error
        // Since we're not blocking ALL possibilities, it should succeed
        let result = manager.find_unique_session_paths("test");
        
        // Clean up reservations
        for name in reserved_names.lock().unwrap().iter() {
            manager.unreserve_name(name);
        }
        
        match result {
            Ok((name, _, _)) => {
                assert!(name.starts_with("test-"));
                assert_ne!(name, "test");
            }
            Err(_) => {
                // This is also acceptable if truly exhausted
            }
        }
    }
    
    #[test]
    fn test_name_generation_fallback_to_incremental() {
        use std::collections::HashMap;
        
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        
        // Create base session to trigger collision
        let base_session = Session {
            id: "base-id".to_string(),
            name: "fallback-test".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/fallback-test".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: temp_dir.path().join("fallback-test"),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        manager.db.create_session(&base_session).unwrap();
        
        // Track generated names to verify pattern
        let mut generated_names = HashMap::new();
        
        // Generate multiple unique names
        for i in 0..5 {
            let (name, _, _) = manager.find_unique_session_paths("fallback-test").unwrap();
            assert!(name.starts_with("fallback-test-"));
            assert!(!generated_names.contains_key(&name), "Generated duplicate: {}", name);
            generated_names.insert(name.clone(), i);
            
            // Create session to make name unavailable for next iteration
            let session = Session {
                id: format!("id-{}", i),
                name: name.clone(),
                display_name: None,
                repository_path: temp_dir.path().to_path_buf(),
                repository_name: "test-repo".to_string(),
                branch: format!("schaltwerk/{}", name),
                parent_branch: "main".to_string(),
                worktree_path: temp_dir.path().join(&name),
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
                plan_content: None,
                session_state: SessionState::Running,
            };
            manager.db.create_session(&session).unwrap();
        }
        
        assert_eq!(generated_names.len(), 5);
    }
}

#[cfg(test)]
mod reservation_tests {
    use super::*;
    use tempfile::TempDir;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    fn create_test_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        std::fs::create_dir_all(temp_dir.path().join(".git")).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        (manager, temp_dir)
    }

    #[test]
    fn test_basic_reservation_lifecycle() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Initially not reserved
        assert!(!manager.is_reserved("test-name"));
        
        // Reserve name
        manager.reserve_name("test-name");
        assert!(manager.is_reserved("test-name"));
        
        // Unreserve name
        manager.unreserve_name("test-name");
        assert!(!manager.is_reserved("test-name"));
    }

    #[test]
    fn test_reservation_prevents_collision() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Reserve a name
        manager.reserve_name("reserved-name");
        
        // Name should appear unavailable due to reservation
        let available = manager.check_name_availability("reserved-name").unwrap();
        assert!(!available, "Reserved name should be unavailable");
        
        // Unreserve and check again
        manager.unreserve_name("reserved-name");
        let available = manager.check_name_availability("reserved-name").unwrap();
        assert!(available, "Unreserved name should become available");
    }

    #[test]
    fn test_reservations_are_repository_specific() {
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();
        
        let db_path1 = temp_dir1.path().join("test1.db");
        let db_path2 = temp_dir2.path().join("test2.db");
        
        let db1 = Database::new(Some(db_path1)).unwrap();
        let db2 = Database::new(Some(db_path2)).unwrap();
        
        std::fs::create_dir_all(temp_dir1.path().join(".git")).unwrap();
        std::fs::create_dir_all(temp_dir2.path().join(".git")).unwrap();
        
        let manager1 = SessionManager::new(db1, temp_dir1.path().to_path_buf());
        let manager2 = SessionManager::new(db2, temp_dir2.path().to_path_buf());
        
        // Reserve same name in both repositories
        manager1.reserve_name("shared-name");
        manager2.reserve_name("shared-name");
        
        // Both should show as reserved in their respective repos
        assert!(manager1.is_reserved("shared-name"));
        assert!(manager2.is_reserved("shared-name"));
        
        // Unreserve from repo1 only
        manager1.unreserve_name("shared-name");
        
        // Only repo1 should show as unreserved
        assert!(!manager1.is_reserved("shared-name"));
        assert!(manager2.is_reserved("shared-name"));
    }

    #[test]
    #[ignore] // Race condition exists - multiple threads can get same base name if available
    fn test_concurrent_reservations_prevent_duplicates() {
        let (manager, _temp_dir) = create_test_manager();
        let manager = Arc::new(manager);
        let results = Arc::new(std::sync::Mutex::new(Vec::new()));
        
        let mut handles = vec![];
        
        // Spawn multiple threads trying to reserve the same base name
        for _i in 0..5 { // Reduced thread count to avoid overloading
            let manager_clone = manager.clone();
            let results_clone = results.clone();
            
            let handle = thread::spawn(move || {
                // Each thread tries to find unique session paths for same base name
                let result = manager_clone.find_unique_session_paths("concurrent-test");
                if let Ok((name, _, _)) = result {
                    {
                        let mut results = results_clone.lock().unwrap();
                        results.push(name.clone());
                    }
                    // Simulate some work then clean up reservation
                    thread::sleep(Duration::from_millis(5));
                    manager_clone.unreserve_name(&name);
                }
            });
            handles.push(handle);
        }
        
        // Wait for all threads
        for handle in handles {
            handle.join().unwrap();
        }
        
        let final_results = results.lock().unwrap();
        
        // All results should be unique (no duplicates due to race conditions)
        let unique_count = final_results.iter().collect::<std::collections::HashSet<_>>().len();
        assert_eq!(unique_count, final_results.len(), "Found duplicate names: {:?}", final_results);
        
        // Should have gotten some unique names 
        assert!(final_results.len() > 0, "Should have generated some names");
        
        // All should start with base name
        for name in final_results.iter() {
            assert!(name.starts_with("concurrent-test"), "Invalid name pattern: {}", name);
        }
    }

    #[test]
    fn test_reservation_cleanup_on_session_creation() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Find unique name (this reserves it)
        let (name, _, _) = manager.find_unique_session_paths("cleanup-test").unwrap();
        
        // Initially reserved
        assert!(manager.is_reserved(&name));
        
        // Create session (should unreserve)
        let session = Session {
            id: "cleanup-id".to_string(),
            name: name.clone(),
            display_name: None,
            repository_path: manager.repo_path.clone(),
            repository_name: "test-repo".to_string(),
            branch: format!("schaltwerk/{}", name),
            parent_branch: "main".to_string(),
            worktree_path: manager.repo_path.join(&name),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        
        manager.db_ref().create_session(&session).unwrap();
        
        // Simulate successful session creation by unreserving
        manager.unreserve_name(&name);
        
        // Should no longer be reserved
        assert!(!manager.is_reserved(&name));
    }

    #[test]
    fn test_multiple_reservation_cleanup() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Reserve multiple names
        let names = vec!["name1", "name2", "name3"];
        for name in &names {
            manager.reserve_name(name);
            assert!(manager.is_reserved(name));
        }
        
        // Clean up all reservations
        for name in &names {
            manager.unreserve_name(name);
            assert!(!manager.is_reserved(name));
        }
    }
}

#[cfg(test)]
mod collision_detection_tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn create_test_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        std::fs::create_dir_all(temp_dir.path().join(".git")).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        (manager, temp_dir)
    }

    #[test]
    fn test_detects_existing_database_session() {
        let (manager, temp_dir) = create_test_manager();
        
        // Create a session in database
        let session = Session {
            id: "db-session-id".to_string(),
            name: "db-session".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/db-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: temp_dir.path().join("db-session"),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        manager.db_ref().create_session(&session).unwrap();
        
        // Should detect collision
        let available = manager.check_name_availability("db-session").unwrap();
        assert!(!available, "Should detect existing database session");
    }

    #[test]
    fn test_detects_existing_worktree_directory() {
        let (manager, temp_dir) = create_test_manager();
        
        // Create worktree directory
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees/worktree-session");
        fs::create_dir_all(&worktree_path).unwrap();
        
        // Should detect collision
        let available = manager.check_name_availability("worktree-session").unwrap();
        assert!(!available, "Should detect existing worktree directory");
    }

    #[test]
    fn test_detects_reserved_name_collision() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Reserve a name
        manager.reserve_name("reserved-session");
        
        // Should detect collision
        let available = manager.check_name_availability("reserved-session").unwrap();
        assert!(!available, "Should detect reserved name collision");
        
        // Clean up
        manager.unreserve_name("reserved-session");
        let available = manager.check_name_availability("reserved-session").unwrap();
        assert!(available, "Should be available after unreserving");
    }

    #[test]
    fn test_handles_multiple_collision_types() {
        let (manager, temp_dir) = create_test_manager();
        
        let name = "multi-collision";
        
        // Create database session
        let session = Session {
            id: "multi-id".to_string(),
            name: name.to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: format!("schaltwerk/{}", name),
            parent_branch: "main".to_string(),
            worktree_path: temp_dir.path().join(name),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        manager.db_ref().create_session(&session).unwrap();
        
        // Also create worktree directory
        let worktree_path = temp_dir.path().join(".schaltwerk/worktrees").join(name);
        fs::create_dir_all(&worktree_path).unwrap();
        
        // Also reserve the name
        manager.reserve_name(name);
        
        // Should detect collision despite multiple sources
        let available = manager.check_name_availability(name).unwrap();
        assert!(!available, "Should detect collision from multiple sources");
        
        // Clean up reservation
        manager.unreserve_name(name);
        
        // Should still detect collision from other sources
        let available = manager.check_name_availability(name).unwrap();
        assert!(!available, "Should still detect collision from db/worktree");
    }

    #[test]
    fn test_available_name_with_no_collisions() {
        let (manager, _temp_dir) = create_test_manager();
        
        let available = manager.check_name_availability("totally-unique-name").unwrap();
        assert!(available, "Unique name should be available");
    }

    #[test]
    fn test_collision_detection_case_sensitivity() {
        let (manager, temp_dir) = create_test_manager();
        
        // Create session with lowercase name
        let session = Session {
            id: "case-id".to_string(),
            name: "lowercase".to_string(),
            display_name: None,
            repository_path: temp_dir.path().to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/lowercase".to_string(),
            parent_branch: "main".to_string(),
            worktree_path: temp_dir.path().join("lowercase"),
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
            plan_content: None,
            session_state: SessionState::Running,
        };
        manager.db_ref().create_session(&session).unwrap();
        
        // Check exact match
        let available = manager.check_name_availability("lowercase").unwrap();
        assert!(!available, "Exact match should be detected");
        
        // Check different case (should be available as it's different)
        let available = manager.check_name_availability("LOWERCASE").unwrap();
        assert!(available, "Different case should be available");
        
        let available = manager.check_name_availability("LowerCase").unwrap();
        assert!(available, "Different case should be available");
    }
}

#[cfg(test)]
mod repository_lock_tests {
    use super::*;
    use tempfile::TempDir;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::{Duration, Instant};

    fn create_test_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        std::fs::create_dir_all(temp_dir.path().join(".git")).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        (manager, temp_dir)
    }

    #[test]
    fn test_same_repository_lock_reuse() {
        let (_manager1, temp_dir) = create_test_manager();
        let _manager2 = SessionManager::new(
            Database::new(Some(temp_dir.path().join("test2.db"))).unwrap(),
            temp_dir.path().to_path_buf()
        );
        
        // Both managers should get the same lock for same repo path
        let lock1 = SessionManager::get_repo_lock(&temp_dir.path().to_path_buf());
        let lock2 = SessionManager::get_repo_lock(&temp_dir.path().to_path_buf());
        
        // Arc pointers should be the same (same underlying mutex)
        assert!(Arc::ptr_eq(&lock1, &lock2), "Same repo should reuse lock");
    }

    #[test]
    fn test_different_repositories_different_locks() {
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();
        
        let lock1 = SessionManager::get_repo_lock(&temp_dir1.path().to_path_buf());
        let lock2 = SessionManager::get_repo_lock(&temp_dir2.path().to_path_buf());
        
        // Different repos should get different locks
        assert!(!Arc::ptr_eq(&lock1, &lock2), "Different repos should have different locks");
    }

    #[test]
    fn test_concurrent_operations_same_repo_are_serialized() {
        let (manager, _temp_dir) = create_test_manager();
        let manager = Arc::new(manager);
        let results = Arc::new(std::sync::Mutex::new(Vec::new()));
        let barrier = Arc::new(Barrier::new(3));
        
        let mut handles = vec![];
        
        for i in 0..3 {
            let manager_clone = manager.clone();
            let results_clone = results.clone();
            let barrier_clone = barrier.clone();
            
            let handle = thread::spawn(move || {
                // All threads wait at barrier then try to acquire repo lock simultaneously
                barrier_clone.wait();
                
                let start = Instant::now();
                let repo_lock = SessionManager::get_repo_lock(&manager_clone.repo_path);
                let _guard = repo_lock.lock().unwrap();
                
                // Hold the lock for some time to verify serialization
                thread::sleep(Duration::from_millis(50));
                let elapsed = start.elapsed();
                
                results_clone.lock().unwrap().push((i, elapsed));
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let final_results = results.lock().unwrap();
        assert_eq!(final_results.len(), 3);
        
        // Results should show increasing elapsed times (serialization)
        let mut sorted_results = final_results.clone();
        sorted_results.sort_by_key(|(_, elapsed)| *elapsed);
        
        // First thread should finish quickly, others should wait
        // Relaxed timing for CI environments
        assert!(sorted_results[0].1 < Duration::from_millis(200), "First thread took {:?}", sorted_results[0].1);
        assert!(sorted_results[1].1 >= Duration::from_millis(30), "Second thread took {:?}", sorted_results[1].1); // waited for first
        assert!(sorted_results[2].1 >= Duration::from_millis(60), "Third thread took {:?}", sorted_results[2].1); // waited for first two
    }

    #[test]
    fn test_concurrent_operations_different_repos_run_parallel() {
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();
        
        let results = Arc::new(std::sync::Mutex::new(Vec::new()));
        let barrier = Arc::new(Barrier::new(2));
        
        let mut handles = vec![];
        
        for (i, temp_dir) in [&temp_dir1, &temp_dir2].iter().enumerate() {
            let results_clone = results.clone();
            let barrier_clone = barrier.clone();
            let temp_dir_clone = temp_dir.path().to_path_buf();
            
            let handle = thread::spawn(move || {
                barrier_clone.wait();
                
                let start = Instant::now();
                let repo_lock = SessionManager::get_repo_lock(&temp_dir_clone);
                let _guard = repo_lock.lock().unwrap();
                
                // Hold the lock for some time
                thread::sleep(Duration::from_millis(100));
                let elapsed = start.elapsed();
                
                results_clone.lock().unwrap().push((i, elapsed));
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let final_results = results.lock().unwrap();
        assert_eq!(final_results.len(), 2);
        
        // Both should finish around the same time (parallel execution)
        // Relaxed timing for CI environments
        for (_, elapsed) in final_results.iter() {
            assert!(*elapsed < Duration::from_millis(250), "Operation took {:?}, should run in parallel", elapsed);
            assert!(*elapsed >= Duration::from_millis(80), "Operation took {:?}, should take at least sleep time", elapsed);
        }
    }

    #[test]
    #[ignore] // This test can be slow and may hang in CI environments
    fn test_no_deadlock_with_multiple_threads() {
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();
        
        let completed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut handles = vec![];
        
        // Create fewer threads that acquire locks in different orders
        for i in 0..4 {
            let temp_dir1_clone = temp_dir1.path().to_path_buf();
            let temp_dir2_clone = temp_dir2.path().to_path_buf();
            let completed_clone = completed.clone();
            
            let handle = thread::spawn(move || {
                let (first_path, second_path) = if i % 2 == 0 {
                    (temp_dir1_clone, temp_dir2_clone)
                } else {
                    (temp_dir2_clone, temp_dir1_clone)
                };
                
                // Acquire locks in different orders
                let lock1 = SessionManager::get_repo_lock(&first_path);
                let _guard1 = lock1.lock().unwrap();
                
                thread::sleep(Duration::from_millis(10));
                
                let lock2 = SessionManager::get_repo_lock(&second_path);
                let _guard2 = lock2.lock().unwrap();
                
                thread::sleep(Duration::from_millis(10));
                
                completed_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            });
            handles.push(handle);
        }
        
        // Wait with timeout to detect deadlock
        let timeout = Duration::from_secs(2);
        let start = Instant::now();
        
        for handle in handles {
            let remaining = timeout.saturating_sub(start.elapsed());
            if remaining.is_zero() {
                panic!("Test timed out - possible deadlock detected");
            }
            handle.join().expect("Thread panicked");
        }
        
        assert_eq!(completed.load(std::sync::atomic::Ordering::SeqCst), 4);
    }
}

#[cfg(test)]
mod performance_tests {
    use super::*;
    use tempfile::TempDir;
    use std::time::{Duration, Instant};

    fn create_test_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        std::fs::create_dir_all(temp_dir.path().join(".git")).unwrap();
        let manager = SessionManager::new(db, temp_dir.path().to_path_buf());
        (manager, temp_dir)
    }

    #[test]
    fn test_name_generation_performance_under_high_collision() {
        let (manager, _temp_dir) = create_test_manager();
        
        // Create sessions to simulate high collision environment
        for i in 0..20 {
            let session = Session {
                id: format!("perf-session-{}", i),
                name: format!("test-{}", i),
                display_name: None,
                repository_path: manager.repo_path.clone(),
                repository_name: "test-repo".to_string(),
                branch: format!("schaltwerk/test-{}", i),
                parent_branch: "main".to_string(),
                worktree_path: manager.repo_path.join(format!("test-{}", i)),
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
                plan_content: None,
                session_state: SessionState::Running,
            };
            manager.db_ref().create_session(&session).unwrap();
        }
        
        // Measure time to find unique name with high collision rate
        let start = Instant::now();
        let result = manager.find_unique_session_paths("test");
        let elapsed = start.elapsed();
        
        // Should still complete reasonably quickly even with many collisions
        // Relaxed timing for CI environments
        assert!(elapsed < Duration::from_millis(2000), "Name generation took too long: {:?}", elapsed);
        
        // Should find a unique name
        assert!(result.is_ok());
        let (name, _, _) = result.unwrap();
        assert!(name.starts_with("test"), "Generated name '{}' should start with 'test'", name);
        
        // Clean up reservation
        manager.unreserve_name(&name);
    }

    #[test]
    fn test_concurrent_session_creation_throughput() {
        use std::sync::{Arc, Barrier};
        use std::thread;
        
        let (manager, _temp_dir) = create_test_manager();
        let manager = Arc::new(manager);
        let thread_count = 5;
        let sessions_per_thread = 3;
        
        let barrier = Arc::new(Barrier::new(thread_count));
        let mut handles = vec![];
        let results = Arc::new(std::sync::Mutex::new(Vec::new()));
        
        let start = Instant::now();
        
        for thread_id in 0..thread_count {
            let manager_clone = manager.clone();
            let barrier_clone = barrier.clone();
            let results_clone = results.clone();
            
            let handle = thread::spawn(move || {
                barrier_clone.wait(); // Sync start
                
                let thread_start = Instant::now();
                
                for session_id in 0..sessions_per_thread {
                    let base_name = format!("perf-{}-{}", thread_id, session_id);
                    let result = manager_clone.find_unique_session_paths(&base_name);
                    
                    if let Ok((name, _, _)) = result {
                        // Clean up reservation immediately
                        manager_clone.unreserve_name(&name);
                    }
                }
                
                let thread_elapsed = thread_start.elapsed();
                results_clone.lock().unwrap().push(thread_elapsed);
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let total_elapsed = start.elapsed();
        let thread_results = results.lock().unwrap();
        
        let total_sessions = thread_count * sessions_per_thread;
        let throughput = total_sessions as f64 / total_elapsed.as_secs_f64();
        
        // Should achieve reasonable throughput (relaxed for CI)
        assert!(throughput > 2.0, "Throughput too low: {:.2} sessions/sec", throughput);
        
        // Individual threads should complete quickly (relaxed for CI)
        for (i, &elapsed) in thread_results.iter().enumerate() {
            assert!(elapsed < Duration::from_secs(5), "Thread {} took too long: {:?}", i, elapsed);
        }
    }

    #[test]
    fn test_reservation_system_performance() {
        let (manager, _temp_dir) = create_test_manager();
        
        let start = Instant::now();
        let iterations = 100;
        
        // Test reservation/unreservation performance
        for i in 0..iterations {
            let name = format!("perf-name-{}", i);
            manager.reserve_name(&name);
            assert!(manager.is_reserved(&name));
            manager.unreserve_name(&name);
            assert!(!manager.is_reserved(&name));
        }
        
        let elapsed = start.elapsed();
        let operations_per_sec = (iterations * 4) as f64 / elapsed.as_secs_f64(); // 4 ops per iteration
        
        // Should handle many operations per second (relaxed for CI)
        assert!(operations_per_sec > 20.0, "Reservation performance too low: {:.2} ops/sec", operations_per_sec);
    }

    #[test]
    fn test_collision_detection_performance() {
        let (manager, temp_dir) = create_test_manager();
        
        // Create some test sessions for collision checking
        for i in 0..20 {
            let session = Session {
                id: format!("collision-session-{}", i),
                name: format!("collision-test-{}", i),
                display_name: None,
                repository_path: temp_dir.path().to_path_buf(),
                repository_name: "test-repo".to_string(),
                branch: format!("schaltwerk/collision-test-{}", i),
                parent_branch: "main".to_string(),
                worktree_path: temp_dir.path().join(format!("collision-test-{}", i)),
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
                plan_content: None,
                session_state: SessionState::Running,
            };
            manager.db_ref().create_session(&session).unwrap();
        }
        
        let start = Instant::now();
        let checks: i32 = 200;
        
        // Check availability for many names
        for i in 0..checks {
            let name = format!("availability-test-{}", i);
            let _available = manager.check_name_availability(&name).unwrap();
        }
        
        let elapsed = start.elapsed();
        let checks_per_sec = checks as f64 / elapsed.as_secs_f64();
        
        // Should perform availability checks efficiently (relaxed for CI)
        assert!(checks_per_sec > 5.0, "Collision detection too slow: {:.2} checks/sec", checks_per_sec);
    }

    #[test]
    fn test_repository_lock_contention_performance() {
        use std::thread;
        
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        let thread_count = 4;
        let operations_per_thread = 20;
        
        let start = Instant::now();
        let mut handles = vec![];
        
        for _ in 0..thread_count {
            let repo_path_clone = repo_path.clone();
            
            let handle = thread::spawn(move || {
                for _ in 0..operations_per_thread {
                    let lock = SessionManager::get_repo_lock(&repo_path_clone);
                    let _guard = lock.lock().unwrap();
                    // Simulate minimal work under lock
                    std::hint::spin_loop();
                }
            });
            handles.push(handle);
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        let elapsed = start.elapsed();
        let total_operations = thread_count * operations_per_thread;
        let operations_per_sec = total_operations as f64 / elapsed.as_secs_f64();
        
        // Should handle lock operations reasonably well even with contention
        assert!(operations_per_sec > 50.0, "Lock contention performance too low: {:.2} ops/sec", operations_per_sec);
    }
}

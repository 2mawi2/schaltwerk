use std::path::PathBuf;
use std::collections::HashMap;
use anyhow::{Result, anyhow};
use chrono::{Utc, TimeZone};
use log::{info, warn};
use crate::schaltwerk_core::{
    database::Database,
    git,
    types::{Session, SessionStatus, SessionState, SessionInfo, SessionStatusType, SessionType, EnrichedSession, DiffStats, SortMode, FilterMode},
    session_db::SessionDbManager,
    session_cache::{SessionCacheManager, clear_session_prompted_non_test},
    session_utils::SessionUtils,
};

pub struct SessionManager {
    db_manager: SessionDbManager,
    cache_manager: SessionCacheManager,
    utils: SessionUtils,
    repo_path: PathBuf,
}

impl SessionManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::debug!("Creating SessionManager with repo path: {}", repo_path.display());
        
        let db_manager = SessionDbManager::new(db.clone(), repo_path.clone());
        let cache_manager = SessionCacheManager::new(repo_path.clone());
        let utils = SessionUtils::new(repo_path.clone(), cache_manager.clone(), db_manager.clone());
        
        Self { 
            db_manager,
            cache_manager,
            utils,
            repo_path,
        }
    }

    #[cfg(test)]
    pub fn create_session(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>) -> Result<Session> {
        self.create_session_with_auto_flag(name, prompt, base_branch, false)
    }

    pub fn create_session_with_auto_flag(&self, name: &str, prompt: Option<&str>, base_branch: Option<&str>, was_auto_generated: bool) -> Result<Session> {
        log::info!("Creating session '{}' in repository: {}", name, self.repo_path.display());
        
        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();
        
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let (unique_name, branch, worktree_path) = self.utils.find_unique_session_paths(name)?;
        let session_id = SessionUtils::generate_session_id();
        self.utils.cleanup_existing_worktree(&worktree_path)?;
        
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
        
        let repo_name = self.utils.get_repo_name()?;
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
            pending_name_generation: was_auto_generated,
            was_auto_generated,
            plan_content: None,
            session_state: SessionState::Running,
        };
        
        let repo_was_empty = !git::repository_has_commits(&self.repo_path).unwrap_or(true);
        if repo_was_empty {
            log::info!("Repository has no commits, creating initial commit: '{}'", git::INITIAL_COMMIT_MESSAGE);
            git::create_initial_commit(&self.repo_path)
                .map_err(|e| {
                    self.cache_manager.unreserve_name(&unique_name);
                    anyhow!("Failed to create initial commit: {}", e)
                })?;
        }
        
        let create_result = git::create_worktree_from_base(
            &self.repo_path, 
            &branch, 
            &worktree_path, 
            &parent_branch
        );
        
        if let Err(e) = create_result {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        if let Ok(Some(setup_script)) = self.db_manager.get_project_setup_script() {
            if !setup_script.trim().is_empty() {
                self.utils.execute_setup_script(&setup_script, &unique_name, &branch, &worktree_path)?;
            }
        }
        
        if let Err(e) = self.db_manager.create_session(&session) {
            let _ = git::remove_worktree(&self.repo_path, &worktree_path);
            let _ = git::delete_branch(&self.repo_path, &branch);
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save session to database: {}", e));
        }

        let global_agent = self.db_manager.get_agent_type().unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db_manager.get_skip_permissions().unwrap_or(false);
        let _ = self.db_manager.set_session_original_settings(&session.id, &global_agent, global_skip);
        
        let mut git_stats = git::calculate_git_stats_fast(&worktree_path, &parent_branch)?;
        git_stats.session_id = session_id.clone();
        self.db_manager.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db_manager.set_session_activity(&session_id, dt);
            }
        }
        
        self.cache_manager.unreserve_name(&unique_name);
        log::info!("Successfully created session '{name}'");
        Ok(session)
    }

    pub fn cancel_session(&self, name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(name)?;
        log::debug!("Cancel {name}: Retrieved session");
        
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            log::warn!("Canceling session '{name}' with uncommitted changes");
        }
        
        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                return Err(anyhow!("Failed to remove worktree: {}", e));
            }
            log::debug!("Cancel {name}: Removed worktree");
        } else {
            log::warn!(
                "Worktree path missing, continuing cancellation: {}",
                session.worktree_path.display()
            );
        }
        
        if git::branch_exists(&self.repo_path, &session.branch)? {
            match git::archive_branch(&self.repo_path, &session.branch, &session.name) {
                Ok(archived_name) => {
                    log::info!("Archived branch '{}' to '{}'", session.branch, archived_name);
                },
                Err(e) => {
                    log::warn!("Failed to archive branch '{}': {}", session.branch, e);
                }
            }
        } else {
            log::debug!("Cancel {name}: Branch doesn't exist, skipping archive");
        }
        
        self.db_manager.update_session_status(&session.id, SessionStatus::Cancelled)?;
        log::info!("Cancel {name}: Session cancelled successfully");
        Ok(())
    }
    
    /// Fast asynchronous session cancellation with parallel operations
    pub async fn fast_cancel_session(&self, name: &str) -> Result<()> {
        use tokio::process::Command;
        
        let session = self.db_manager.get_session_by_name(name)?;
        log::info!("Fast cancel {name}: Starting optimized cancellation");
        
        // Check uncommitted changes early (non-blocking)
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            log::warn!("Fast canceling session '{name}' with uncommitted changes");
        }
        
        // Start parallel operations
        let worktree_future = if session.worktree_path.exists() {
            let repo_path = self.repo_path.clone();
            let worktree_path = session.worktree_path.clone();
            Some(tokio::spawn(async move {
                let output = Command::new("git")
                    .arg("worktree")
                    .arg("remove")
                    .arg("-f")
                    .arg(&worktree_path)
                    .current_dir(&repo_path)
                    .output()
                    .await;
                
                match output {
                    Ok(out) if out.status.success() => Ok(()),
                    Ok(out) => {
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        if stderr.contains("is not a working tree") {
                            Ok(())
                        } else {
                            Err(anyhow::anyhow!("Failed to remove worktree: {}", stderr))
                        }
                    }
                    Err(e) => Err(anyhow::anyhow!("Command failed: {}", e))
                }
            }))
        } else {
            None
        };
        
        let branch_future = if git::branch_exists(&self.repo_path, &session.branch)? {
            let repo_path = self.repo_path.clone();
            let branch = session.branch.clone();
            let session_name = session.name.clone();
            
            Some(tokio::spawn(async move {
                let archive_name = format!("archive/{}-{}", 
                    session_name, 
                    chrono::Utc::now().format("%Y%m%d-%H%M%S")
                );
                
                // Create tag and delete branch in parallel
                let tag_future = Command::new("git")
                    .args(["tag", "-f", &archive_name, &branch])
                    .current_dir(&repo_path)
                    .output();
                
                let delete_future = Command::new("git")
                    .args(["branch", "-D", &branch])
                    .current_dir(&repo_path)
                    .output();
                
                let (tag_result, delete_result) = tokio::join!(tag_future, delete_future);
                
                match (tag_result, delete_result) {
                    (Ok(_), Ok(_)) => {
                        log::info!("Archived branch '{branch}' to '{archive_name}'");
                        Ok::<(), anyhow::Error>(())
                    }
                    (Err(e), _) | (_, Err(e)) => {
                        log::warn!("Branch operation partially failed: {e}");
                        Ok::<(), anyhow::Error>(()) // Continue anyway
                    }
                }
            }))
        } else {
            log::debug!("Fast cancel {name}: Branch doesn't exist, skipping archive");
            None
        };
        
        // Wait for parallel operations
        if let Some(worktree_handle) = worktree_future {
            if let Err(e) = worktree_handle.await {
                log::warn!("Fast cancel {name}: Worktree task error: {e}");
            }
        }
        
        if let Some(branch_handle) = branch_future {
            if let Err(e) = branch_handle.await {
                log::warn!("Fast cancel {name}: Branch task error: {e}");
            }
        }
        
        // Update database status
        self.db_manager.update_session_status(&session.id, SessionStatus::Cancelled)?;
        log::info!("Fast cancel {name}: Successfully completed");
        
        Ok(())
    }


    pub fn convert_session_to_draft(&self, name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(name)?;
        
        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{}' is not in running state", name));
        }
        
        log::info!("Converting session '{name}' from running to plan");
        
        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };
        
        if has_uncommitted {
            log::warn!("Converting session '{name}' to plan with uncommitted changes");
        }
        
        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                return Err(anyhow!("Failed to remove worktree when converting to plan: {}", e));
            }
        }
        
        if git::branch_exists(&self.repo_path, &session.branch)? {
            if let Err(e) = git::delete_branch(&self.repo_path, &session.branch) {
                log::warn!("Failed to delete branch '{}': {}", session.branch, e);
            }
        }
        
        self.db_manager.update_session_status(&session.id, SessionStatus::Plan)?;
        self.db_manager.update_session_state(&session.id, SessionState::Plan)?;
        
        clear_session_prompted_non_test(&session.worktree_path);
        
        Ok(())
    }

    pub fn get_session(&self, name: &str) -> Result<Session> {
        self.db_manager.get_session_by_name(name)
    }

    pub fn get_session_task_content(&self, name: &str) -> Result<(Option<String>, Option<String>)> {
        self.db_manager.get_session_task_content(name)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        self.db_manager.list_sessions()
    }

    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        self.db_manager.update_git_stats(session_id)
    }

    pub fn cleanup_orphaned_worktrees(&self) -> Result<()> {
        self.utils.cleanup_orphaned_worktrees()
    }

    pub fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>> {
        let sessions = self.db_manager.list_sessions()?;
        let mut enriched = Vec::new();
        
        for session in sessions {
            if session.status == SessionStatus::Cancelled {
                continue;
            }
            
            let git_stats = self.db_manager.get_enriched_git_stats(&session)?;
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
                .or_else(|| self.db_manager.get_agent_type().ok());

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
        log::debug!("Computing sorted sessions: {sort_mode:?}/{filter_mode:?}");
        let all_sessions = self.list_enriched_sessions()?;
        
        let filtered_sessions = self.utils.apply_session_filter(all_sessions, &filter_mode);
        let sorted_sessions = self.utils.apply_session_sort(filtered_sessions, &sort_mode);
        
        Ok(sorted_sessions)
    }

    pub fn start_claude_in_session(&self, session_name: &str) -> Result<String> {
        self.start_claude_in_session_with_args(session_name, None)
    }
    
    pub fn start_claude_in_session_with_binary(&self, session_name: &str, binary_paths: &HashMap<String, String>) -> Result<String> {
        self.start_claude_in_session_with_args_and_binary(session_name, None, binary_paths)
    }
    
    pub fn start_claude_in_session_with_args(&self, session_name: &str, _cli_args: Option<&str>) -> Result<String> {
        self.start_claude_in_session_with_args_and_binary(session_name, _cli_args, &HashMap::new())
    }
    
    pub fn start_claude_in_session_with_args_and_binary(&self, session_name: &str, _cli_args: Option<&str>, binary_paths: &HashMap<String, String>) -> Result<String> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        let skip_permissions = session.original_skip_permissions.unwrap_or(self.db_manager.get_skip_permissions()?);
        let agent_type = session.original_agent_type.clone().unwrap_or(self.db_manager.get_agent_type()?);
        
        match agent_type.as_str() {
            "cursor" => {
                // Always start fresh - no session discovery for new sessions
                self.cache_manager.mark_session_prompted(&session.worktree_path);
                let prompt_to_use = session.initial_prompt.as_deref();
                
                let binary_path = self.utils.get_effective_binary_path_with_override("cursor-agent", binary_paths.get("cursor-agent").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::cursor::CursorConfig {
                    binary_path: Some(binary_path),
                };
                
                Ok(crate::schaltwerk_core::cursor::build_cursor_command_with_config(
                    &session.worktree_path,
                    None, // No session ID - always start fresh
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "opencode" => {
                // Always start fresh - no session discovery for new sessions
                self.cache_manager.mark_session_prompted(&session.worktree_path);
                let prompt_to_use = session.initial_prompt.as_deref();
                
                let binary_path = self.utils.get_effective_binary_path_with_override("opencode", binary_paths.get("opencode").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::opencode::OpenCodeConfig {
                    binary_path: Some(binary_path),
                };
                
                Ok(crate::schaltwerk_core::opencode::build_opencode_command_with_config(
                    &session.worktree_path,
                    None, // No session info - always start fresh
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "gemini" => {
                // Always start fresh - no session discovery for new sessions
                self.cache_manager.mark_session_prompted(&session.worktree_path);
                let prompt_to_use = session.initial_prompt.as_deref();
                
                let binary_path = self.utils.get_effective_binary_path_with_override("gemini", binary_paths.get("gemini").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::gemini::GeminiConfig {
                    binary_path: Some(binary_path),
                };
                
                Ok(crate::schaltwerk_core::gemini::build_gemini_command_with_config(
                    &session.worktree_path,
                    None, // No session ID - always start fresh
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "codex" => {
                // Always start fresh - no session discovery for new sessions
                self.cache_manager.mark_session_prompted(&session.worktree_path);
                let prompt_to_use = session.initial_prompt.as_deref();
                
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let binary_path = self.utils.get_effective_binary_path_with_override("codex", binary_paths.get("codex").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::codex::CodexConfig {
                    binary_path: Some(binary_path),
                };
                Ok(crate::schaltwerk_core::codex::build_codex_command_with_config(
                    &session.worktree_path,
                    None, // No session ID - always start fresh
                    prompt_to_use,
                    sandbox_mode,
                    Some(&config),
                ))
            }
            _ => {
                // Always start fresh - no session discovery for new sessions
                log::info!("Starting fresh Claude session '{}' with initial_prompt={:?}", 
                    session_name, session.initial_prompt);
                self.cache_manager.mark_session_prompted(&session.worktree_path);
                let prompt_to_use = session.initial_prompt.as_deref();
                
                let binary_path = self.utils.get_effective_binary_path_with_override("claude", binary_paths.get("claude").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::claude::ClaudeConfig {
                    binary_path: Some(binary_path),
                };
                
                Ok(crate::schaltwerk_core::claude::build_claude_command_with_config(
                    &session.worktree_path,
                    None, // No session ID - always start fresh
                    prompt_to_use,
                    skip_permissions,
                    Some(&config),
                ))
            }
        }
    }
    pub fn start_claude_in_orchestrator(&self) -> Result<String> {
        self.start_claude_in_orchestrator_with_args(None)
    }
    
    pub fn start_claude_in_orchestrator_fresh(&self) -> Result<String> {
        self.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new())
    }
    
    pub fn start_claude_in_orchestrator_fresh_with_binary(&self, binary_paths: &HashMap<String, String>) -> Result<String> {
        log::info!("Building FRESH orchestrator command (no session resume) for repo: {}", self.repo_path.display());
        
        if !self.repo_path.exists() {
            log::error!("Repository path does not exist: {}", self.repo_path.display());
            return Err(anyhow!("Repository path does not exist: {}. Please open a valid project folder.", self.repo_path.display()));
        }
        
        if !self.repo_path.join(".git").exists() {
            log::error!("Not a git repository: {}", self.repo_path.display());
            return Err(anyhow!("The folder '{}' is not a git repository. The orchestrator requires a git repository to function.", self.repo_path.display()));
        }
        
        let skip_permissions = self.db_manager.get_skip_permissions()?;
        let agent_type = self.db_manager.get_agent_type()?;
        
        log::info!("Fresh orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}");
        
        self.build_orchestrator_command(&agent_type, skip_permissions, binary_paths, false)
    }

    pub fn start_claude_in_orchestrator_with_binary(&self, binary_paths: &HashMap<String, String>) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(None, binary_paths)
    }
    
    pub fn start_claude_in_orchestrator_with_args(&self, _cli_args: Option<&str>) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(_cli_args, &HashMap::new())
    }
    
    pub fn start_claude_in_orchestrator_with_args_and_binary(&self, _cli_args: Option<&str>, binary_paths: &HashMap<String, String>) -> Result<String> {
        log::info!("Building orchestrator command for repo: {}", self.repo_path.display());
        
        if !self.repo_path.exists() {
            return Err(anyhow!("Repository path does not exist: {}", self.repo_path.display()));
        }
        
        if !self.repo_path.join(".git").exists() {
            return Err(anyhow!("Not a git repository: {}", self.repo_path.display()));
        }
        
        let skip_permissions = self.db_manager.get_skip_permissions()?;
        let agent_type = self.db_manager.get_agent_type()?;
        
        log::info!("Orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}");
        
        self.build_orchestrator_command(&agent_type, skip_permissions, binary_paths, true)
    }

    fn build_orchestrator_command(&self, agent_type: &str, skip_permissions: bool, binary_paths: &HashMap<String, String>, resume_session: bool) -> Result<String> {
        match agent_type {
            "cursor" => {
                let binary_path = self.utils.get_effective_binary_path_with_override("cursor-agent", binary_paths.get("cursor-agent").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::cursor::CursorConfig {
                    binary_path: Some(binary_path),
                };
                
                let session_id = if resume_session {
                    crate::schaltwerk_core::cursor::find_cursor_session(&self.repo_path)
                } else {
                    None
                };
                
                Ok(crate::schaltwerk_core::cursor::build_cursor_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "opencode" => {
                let binary_path = self.utils.get_effective_binary_path_with_override("opencode", binary_paths.get("opencode").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::opencode::OpenCodeConfig {
                    binary_path: Some(binary_path),
                };
                
                let session_info = if resume_session {
                    crate::schaltwerk_core::opencode::find_opencode_session(&self.repo_path)
                } else {
                    None
                };
                
                Ok(crate::schaltwerk_core::opencode::build_opencode_command_with_config(
                    &self.repo_path,
                    session_info.as_ref(),
                    None,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "gemini" => {
                let binary_path = self.utils.get_effective_binary_path_with_override("gemini", binary_paths.get("gemini").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::gemini::GeminiConfig {
                    binary_path: Some(binary_path),
                };
                
                let session_id = if resume_session {
                    crate::schaltwerk_core::gemini::find_gemini_session(&self.repo_path)
                } else {
                    None
                };
                
                Ok(crate::schaltwerk_core::gemini::build_gemini_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
                ))
            }
            "codex" => {
                let sandbox_mode = if skip_permissions {
                    "danger-full-access"
                } else {
                    "workspace-write"
                };
                
                let binary_path = self.utils.get_effective_binary_path_with_override("codex", binary_paths.get("codex").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::codex::CodexConfig {
                    binary_path: Some(binary_path),
                };
                
                let session_id = if resume_session {
                    crate::schaltwerk_core::codex::find_codex_session(&self.repo_path)
                } else {
                    None
                };
                
                Ok(crate::schaltwerk_core::codex::build_codex_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    sandbox_mode,
                    Some(&config),
                ))
            }
            _ => {
                let binary_path = self.utils.get_effective_binary_path_with_override("claude", binary_paths.get("claude").map(|s| s.as_str()));
                let config = crate::schaltwerk_core::claude::ClaudeConfig {
                    binary_path: Some(binary_path),
                };
                
                let session_id = if resume_session {
                    crate::schaltwerk_core::claude::find_claude_session(&self.repo_path)
                } else {
                    None
                };
                
                Ok(crate::schaltwerk_core::claude::build_claude_command_with_config(
                    &self.repo_path,
                    session_id.as_deref(),
                    None,
                    skip_permissions,
                    Some(&config),
                ))
            }
        }
    }

    pub fn mark_session_as_reviewed(&self, session_name: &str) -> Result<()> {
        // Get session and validate state
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Validate that the session is in a valid state for marking as reviewed
        if session.session_state == SessionState::Plan {
            return Err(anyhow!("Cannot mark plan session '{}' as reviewed. Start the plan first with schaltwerk_draft_start.", session_name));
        }

        if session.ready_to_merge {
            return Err(anyhow!("Session '{}' is already marked as reviewed", session_name));
        }

        // Use existing mark_session_ready logic (with auto_commit=false)
        self.mark_session_ready(session_name, false)?;
        Ok(())
    }

    pub fn convert_session_to_plan(&self, session_name: &str) -> Result<()> {
        // Get session and validate state
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Validate that the session is in a valid state for conversion
        if session.session_state == SessionState::Plan {
            return Err(anyhow!("Session '{}' is already a plan", session_name));
        }

        // Use existing convert_session_to_draft logic
        self.convert_session_to_draft(session_name)?;
        Ok(())
    }

    pub fn start_draft_session_with_config(&self, session_name: &str, base_branch: Option<&str>, agent_type: Option<&str>, skip_permissions: Option<bool>) -> Result<()> {
        // Set global agent type if provided
        if let Some(agent_type) = agent_type {
            if let Err(e) = self.set_global_agent_type(agent_type) {
                warn!("Failed to set global agent type to '{agent_type}': {e}");
            } else {
                info!("Set global agent type to '{agent_type}' for session '{session_name}'");
            }
        }

        // Set global skip permissions if provided
        if let Some(skip_permissions) = skip_permissions {
            if let Err(e) = self.set_global_skip_permissions(skip_permissions) {
                warn!("Failed to set global skip permissions to '{skip_permissions}': {e}");
            } else {
                info!("Set global skip permissions to '{skip_permissions}' for session '{session_name}'");
            }
        }

        // Start the draft session
        self.start_draft_session(session_name, base_branch)?;
        Ok(())
    }

    pub fn mark_session_ready(&self, session_name: &str, auto_commit: bool) -> Result<bool> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        
        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path)?;
        
        if has_uncommitted && auto_commit {
            git::commit_all_changes(
                &session.worktree_path,
                &format!("Mark session {session_name} as reviewed")
            )?;
        }
        
        self.db_manager.update_session_ready_to_merge(&session.id, true)?;
        
        Ok(!has_uncommitted || auto_commit)
    }
    
    pub fn unmark_session_ready(&self, session_name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager.update_session_ready_to_merge(&session.id, false)?;
        Ok(())
    }

    pub fn create_draft_session(&self, name: &str, plan_content: &str) -> Result<Session> {
        log::info!("Creating plan session '{}' in repository: {}", name, self.repo_path.display());
        
        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();
        
        if !git::is_valid_session_name(name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        let (unique_name, branch, worktree_path) = self.utils.find_unique_session_paths(name)?;
        
        let session_id = SessionUtils::generate_session_id();
        let repo_name = self.utils.get_repo_name()?;
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
        
        if let Err(e) = self.db_manager.create_session(&session) {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save plan session to database: {}", e));
        }
        
        self.cache_manager.unreserve_name(&unique_name);
        Ok(session)
    }

    pub fn start_draft_session(&self, session_name: &str, base_branch: Option<&str>) -> Result<()> {
        log::info!("Starting plan session '{}' in repository: {}", session_name, self.repo_path.display());
        
        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();
        
        let session = self.db_manager.get_session_by_name(session_name)?;
        
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
        
        self.utils.cleanup_existing_worktree(&session.worktree_path)?;
        
        let create_result = git::create_worktree_from_base(
            &self.repo_path, 
            &session.branch, 
            &session.worktree_path, 
            &parent_branch
        );
        
        if let Err(e) = create_result {
            return Err(anyhow!("Failed to create worktree: {}", e));
        }
        
        if let Ok(Some(setup_script)) = self.db_manager.get_project_setup_script() {
            if !setup_script.trim().is_empty() {
                self.utils.execute_setup_script(&setup_script, &session.name, &session.branch, &session.worktree_path)?;
            }
        }
        
        self.db_manager.update_session_status(&session.id, SessionStatus::Active)?;
        self.db_manager.update_session_state(&session.id, SessionState::Running)?;
        
        if let Some(plan_content) = session.plan_content {
            log::info!("Copying plan content to initial_prompt for session '{session_name}': '{plan_content}'");
            self.db_manager.update_session_initial_prompt(&session.id, &plan_content)?;
            clear_session_prompted_non_test(&session.worktree_path);
            log::info!("Cleared prompt state for session '{session_name}' to ensure plan content is used");
        } else {
            log::warn!("No plan_content found for session '{session_name}' - initial_prompt will not be set");
        }
        
        let global_agent = self.db_manager.get_agent_type().unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db_manager.get_skip_permissions().unwrap_or(false);
        let _ = self.db_manager.set_session_original_settings(&session.id, &global_agent, global_skip);
        
        let mut git_stats = git::calculate_git_stats_fast(&session.worktree_path, &parent_branch)?;
        git_stats.session_id = session.id.clone();
        self.db_manager.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db_manager.set_session_activity(&session.id, dt);
            }
        }
        
        Ok(())
    }

    pub fn update_session_state(&self, session_name: &str, state: SessionState) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager.update_session_state(&session.id, state)?;
        Ok(())
    }

    pub fn set_global_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db_manager.set_agent_type(agent_type)
    }

    pub fn set_global_skip_permissions(&self, skip: bool) -> Result<()> {
        self.db_manager.set_skip_permissions(skip)
    }



    pub fn update_plan_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager.update_plan_content(&session.id, content)?;
        Ok(())
    }

    pub fn append_plan_content(&self, session_name: &str, content: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager.append_plan_content(&session.id, content)?;
        Ok(())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        self.db_manager.list_sessions_by_state(state)
    }

    pub fn rename_draft_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        if !git::is_valid_session_name(new_name) {
            return Err(anyhow!("Invalid session name: use only letters, numbers, hyphens, and underscores"));
        }
        
        self.db_manager.rename_draft_session(old_name, new_name)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn db_ref(&self) -> &crate::schaltwerk_core::database::Database {
        &self.db_manager.db
    }
}


use anyhow::{anyhow, Result};
use chrono::{TimeZone, Utc};
use log::{info, warn};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub struct SessionCreationParams<'a> {
    pub name: &'a str,
    pub prompt: Option<&'a str>,
    pub base_branch: Option<&'a str>,
    pub was_auto_generated: bool,
    pub version_group_id: Option<&'a str>,
    pub version_number: Option<i32>,
    pub agent_type: Option<&'a str>,
    pub skip_permissions: Option<bool>,
}

const SESSION_READY_COMMIT_MESSAGE: &str = "Complete development work for {}";
use crate::{
    domains::git::service as git,
    domains::sessions::cache::{clear_session_prompted_non_test, SessionCacheManager},
    domains::sessions::entity::ArchivedSpec,
    domains::sessions::entity::{
        DiffStats, EnrichedSession, FilterMode, Session, SessionInfo, SessionState, SessionStatus,
        SessionStatusType, SessionType, SortMode,
    },
    domains::sessions::repository::SessionDbManager,
    domains::sessions::utils::SessionUtils,
    infrastructure::database::db_archived_specs::ArchivedSpecMethods as _,
    schaltwerk_core::database::Database,
};
use uuid::Uuid;

#[cfg(test)]
mod service_unified_tests {
    use super::*;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use crate::schaltwerk_core::database::Database;
    use chrono::Utc;
    use std::collections::HashMap;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn create_test_session_manager() -> (SessionManager, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(Some(temp_dir.path().join("test.db"))).unwrap();
        let repo_path = temp_dir.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();

        let manager = SessionManager::new(db, repo_path);
        (manager, temp_dir)
    }

    fn create_test_session(temp_dir: &TempDir, agent_type: &str, session_suffix: &str) -> Session {
        let repo_path = temp_dir.path().join("repo");
        let session_name = format!("test-session-{}-{}", agent_type, session_suffix);
        let worktree_path = temp_dir.path().join("worktrees").join(&session_name);
        std::fs::create_dir_all(&worktree_path).unwrap();

        Session {
            id: Uuid::new_v4().to_string(),
            name: session_name.clone(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            repository_path: repo_path,
            repository_name: "test-repo".to_string(),
            branch: "schaltwerk/test-session".to_string(),
            parent_branch: "main".to_string(),
            worktree_path,
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("test prompt".to_string()),
            ready_to_merge: false,
            original_agent_type: Some(agent_type.to_string()),
            original_skip_permissions: Some(true),
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_resume_gating_after_spec_then_first_start_is_fresh() {
        let (manager, temp_dir) = create_test_session_manager();
        // Arrange temp HOME to simulate Claude history existing
        let home_dir = tempfile::tempdir().unwrap();
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_dir.path());

        // Make the repo a valid git repo with an initial commit
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(temp_dir.path().join("repo"))
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(temp_dir.path().join("repo"))
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(temp_dir.path().join("repo"))
            .output()
            .unwrap();
        std::fs::write(temp_dir.path().join("repo").join("README.md"), "Initial").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(temp_dir.path().join("repo"))
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(temp_dir.path().join("repo"))
            .output()
            .unwrap();

        // Create a spec session, then start it (Spec -> Running; gates resume)
        let spec_name = "spec-gating";
        manager
            .create_spec_session(spec_name, "Build feature A")
            .unwrap();
        manager
            .start_spec_session(spec_name, None, None, None)
            .unwrap();

        // Simulate Claude session files existing for this worktree so resume would normally happen
        let session = manager.db_manager.get_session_by_name(spec_name).unwrap();
        // Use the same sanitizer as Claude for projects dir name via public fast finder side-effect
        let projects_root = home_dir.path().join(".claude").join("projects");
        let sanitized = {
            // reconstruct sanitized by calling finder on the path and inferring the dir it checks
            // Since sanitize_path_for_claude is private, mimic behavior: replace '/', '.', '_' with '-'
            session
                .worktree_path
                .to_string_lossy()
                .replace(['/', '.', '_'], "-")
        };
        let projects = projects_root.join(sanitized);
        std::fs::create_dir_all(&projects).unwrap();
        std::fs::write(projects.join("resume-session-id.jsonl"), b"dummy").unwrap();

        // First start should be FRESH (no --continue / no -r)
        let cmd1 = manager
            .start_claude_in_session_with_restart_and_binary(spec_name, false, &HashMap::new())
            .unwrap();
        assert!(cmd1.contains(" claude"));
        assert!(!cmd1.contains("--continue"));
        assert!(!cmd1.contains(" -r "));

        // Second start should allow resume now (resume_allowed flipped true)
        let cmd2 = manager
            .start_claude_in_session_with_restart_and_binary(spec_name, false, &HashMap::new())
            .unwrap();
        assert!(
            cmd2.contains(" -r resume-session-id"),
            "Expected resume via explicit -r <session> on second start"
        );

        // Cleanup HOME
        if let Some(h) = prev_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    fn test_unified_registry_produces_same_commands_as_old_match() {
        let (manager, temp_dir) = create_test_session_manager();
        let registry = crate::domains::agents::unified::AgentRegistry::new();

        // Test each supported agent type
        for (i, agent_type) in ["claude", "codex", "gemini", "opencode"].iter().enumerate() {
            let session = create_test_session(&temp_dir, agent_type, &i.to_string());

            // Create session in database
            manager.db_manager.create_session(&session).unwrap();

            // Get the unified command using the new registry approach
            let binary_paths = HashMap::new();
            let result = manager.start_claude_in_session_with_restart_and_binary(
                &session.name,
                false,
                &binary_paths,
            );

            // Should succeed for all supported agents
            assert!(result.is_ok(), "Agent {} should be supported", agent_type);

            let command = result.unwrap();

            // Verify command contains expected elements
            assert!(command.contains(&format!("cd {}", session.worktree_path.display())));

            // Get the agent from registry and verify it matches
            if let Some(agent) = registry.get(agent_type) {
                let _registry_command = agent.build_command(
                    &session.worktree_path,
                    None,
                    session.initial_prompt.as_deref(),
                    session.original_skip_permissions.unwrap_or(false),
                    None,
                );

                // The service command should match what the registry produces
                // (accounting for potential binary path differences)
                assert!(
                    command.contains(agent.binary_name())
                        || command.contains(agent.default_binary()),
                    "Command for {} should contain correct binary name",
                    agent_type
                );
            }
        }
    }

    #[test]
    fn test_codex_sandbox_mode_handling_preserved() {
        let (manager, temp_dir) = create_test_session_manager();

        // Test with skip_permissions = true
        let mut session = create_test_session(&temp_dir, "codex", "danger");
        session.original_skip_permissions = Some(true);
        manager.db_manager.create_session(&session).unwrap();

        let binary_paths = HashMap::new();
        let result = manager.start_claude_in_session_with_restart_and_binary(
            &session.name,
            false,
            &binary_paths,
        );

        assert!(result.is_ok());
        let command = result.unwrap();
        assert!(command.contains("--sandbox danger-full-access"));

        // Test with skip_permissions = false
        session.id = Uuid::new_v4().to_string();
        session.name = "test-session-safe".to_string();
        session.original_skip_permissions = Some(false);
        manager.db_manager.create_session(&session).unwrap();

        let result = manager.start_claude_in_session_with_restart_and_binary(
            &session.name,
            false,
            &binary_paths,
        );

        assert!(result.is_ok());
        let command = result.unwrap();
        assert!(command.contains("--sandbox workspace-write"));
    }

    #[test]
    #[serial_test::serial]
    fn test_start_spec_with_config_uses_codex_and_prompt_without_resume() {
        use std::process::Command;
        let (manager, temp_dir) = create_test_session_manager();

        // Initialize a git repo with an initial commit so default branch detection works
        let repo = temp_dir.path().join("repo");
        Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("README.md"), "Initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .output()
            .unwrap();

        // Create a spec first (previously created draft)
        let spec_name = "codex_spec_config";
        let spec_content = "Implement feature Z with Codex";
        manager
            .create_spec_session(spec_name, spec_content)
            .unwrap();

        manager
            .start_spec_session_with_config(spec_name, None, None, None, Some("codex"), Some(true))
            .unwrap();

        // Fetch running session to start agent
        let running = manager.db_manager.get_session_by_name(spec_name).unwrap();

        // Build the start command (unified start handles correct agent based on original settings)
        let cmd = manager
            .start_claude_in_session(&running.name)
            .expect("expected start command");

        // Verify Codex is used with the correct sandbox and prompt, and no resume flags on first start
        assert!(
            cmd.contains(" codex ") || cmd.ends_with(" codex"),
            "expected Codex binary in command: {cmd}"
        );
        assert!(
            cmd.contains("--sandbox danger-full-access"),
            "expected danger sandbox when skip_permissions=true: {cmd}"
        );
        assert!(
            cmd.contains(spec_content),
            "expected spec content to be used as initial prompt: {cmd}"
        );
        assert!(
            !(cmd.contains(" codex --sandbox ") && cmd.contains(" resume")),
            "should not resume on first start after spec: {cmd}"
        );

        // Prepare a fake Codex sessions directory so resume detection finds a matching session
        let home_dir = tempfile::TempDir::new().unwrap();
        let codex_sessions = home_dir
            .path()
            .join(".codex")
            .join("sessions")
            .join("2025")
            .join("09")
            .join("13");
        std::fs::create_dir_all(&codex_sessions).unwrap();
        let jsonl_path = codex_sessions.join("test-session.jsonl");
        use std::io::Write;
        let mut f = std::fs::File::create(&jsonl_path).unwrap();
        writeln!(
            f,
            "{{\"id\":\"s-1\",\"timestamp\":\"2025-09-13T01:00:00.000Z\",\"cwd\":\"{}\",\"originator\":\"codex_cli_rs\"}}",
            running.worktree_path.display()
        )
        .unwrap();
        writeln!(f, "{{\"record_type\":\"state\"}}").unwrap();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_dir.path());

        // Second start should allow resume now (gate flips after fresh start and session file exists)
        let cmd2 = manager.start_claude_in_session(&running.name).unwrap();
        let resumed = cmd2.contains(" codex --sandbox ") && cmd2.contains(" resume");
        assert!(
            resumed,
            "expected resume-capable command on second start: {cmd2}"
        );

        // Restore HOME
        if let Some(h) = prev_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
    }

    #[test]
    #[serial_test::serial]
    fn test_start_spec_with_config_preserves_version_group_metadata() {
        use std::process::Command;
        let (manager, temp_dir) = create_test_session_manager();

        let repo = temp_dir.path().join("repo");
        Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("README.md"), "Initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .output()
            .unwrap();

        let spec_name = "codex_spec_group";
        manager
            .create_spec_session(spec_name, "Spec content")
            .unwrap();

        let group_id = "version-group-123";

        manager
            .start_spec_session_with_config(
                spec_name,
                None,
                Some(group_id),
                Some(1),
                Some("codex"),
                Some(false),
            )
            .unwrap();

        let running = manager.db_manager.get_session_by_name(spec_name).unwrap();
        assert_eq!(running.version_group_id.as_deref(), Some(group_id));
        assert_eq!(running.version_number, Some(1));
    }

    #[test]
    fn test_unsupported_agent_error_handling() {
        let (manager, temp_dir) = create_test_session_manager();
        let session = create_test_session(&temp_dir, "unsupported-agent", "0");

        manager.db_manager.create_session(&session).unwrap();

        let binary_paths = HashMap::new();
        let result = manager.start_claude_in_session_with_restart_and_binary(
            &session.name,
            false,
            &binary_paths,
        );

        // Should return an error with supported agent types listed
        assert!(result.is_err());
        let error = result.unwrap_err().to_string();
        assert!(error.contains("Unsupported agent type: unsupported-agent"));
        assert!(error.contains("claude"));
        assert!(error.contains("codex"));
        assert!(error.contains("gemini"));
        assert!(error.contains("opencode"));
    }

    #[test]
    fn create_claude_session_copies_local_overrides() {
        let (manager, temp_dir) = create_test_session_manager();
        let repo_root = temp_dir.path().join("repo");

        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::fs::write(repo_root.join("README.md"), "Initial").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_root)
            .output()
            .unwrap();

        // Prepare local Claude overrides in the project root
        std::fs::write(repo_root.join("CLAUDE.local.md"), "root-local-memory").unwrap();
        let claude_dir = repo_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.local.json"),
            "{\"key\":\"value\"}",
        )
        .unwrap();

        let params = SessionCreationParams {
            name: "copy-local",
            prompt: None,
            base_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: Some("claude"),
            skip_permissions: Some(true),
        };

        let session = manager
            .create_session_with_agent(params)
            .expect("session creation should succeed");

        let worktree = &session.worktree_path;
        let root_local = worktree.join("CLAUDE.local.md");
        assert!(root_local.exists(), "expected CLAUDE.local.md to be copied");
        assert_eq!(
            std::fs::read_to_string(&root_local).unwrap(),
            "root-local-memory"
        );

        let copied_settings = worktree.join(".claude").join("settings.local.json");
        assert!(
            copied_settings.exists(),
            "expected settings.local.json to be copied"
        );
        assert_eq!(
            std::fs::read_to_string(copied_settings).unwrap(),
            "{\"key\":\"value\"}"
        );
    }

    #[test]
    fn non_claude_session_does_not_copy_local_overrides() {
        let (manager, temp_dir) = create_test_session_manager();
        let repo_root = temp_dir.path().join("repo");

        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::fs::write(repo_root.join("README.md"), "Initial").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_root)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_root)
            .output()
            .unwrap();

        std::fs::write(repo_root.join("CLAUDE.local.md"), "should-not-copy").unwrap();
        let claude_dir = repo_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(claude_dir.join("settings.local.json"), "{\"copy\":false}").unwrap();

        let params = SessionCreationParams {
            name: "opencode-session",
            prompt: None,
            base_branch: None,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            agent_type: Some("opencode"),
            skip_permissions: Some(false),
        };

        let session = manager
            .create_session_with_agent(params)
            .expect("session creation should succeed");

        let worktree = &session.worktree_path;
        assert!(
            !worktree.join("CLAUDE.local.md").exists(),
            "non-Claude sessions should not copy CLAUDE.local.md"
        );
        assert!(
            !worktree.join(".claude").exists(),
            "non-Claude sessions should not copy .claude overrides"
        );
    }

    #[test]
    fn spec_sessions_reset_running_state_on_fetch() {
        let (manager, temp_dir) = create_test_session_manager();
        let session = create_test_session(&temp_dir, "claude", "normalize");
        manager.db_manager.create_session(&session).unwrap();

        manager
            .db_manager
            .update_session_status(&session.id, SessionStatus::Spec)
            .unwrap();

        let fetched = manager
            .db_manager
            .get_session_by_name(&session.name)
            .unwrap();

        assert_eq!(SessionStatus::Spec, fetched.status);
        assert_eq!(
            SessionState::Spec,
            fetched.session_state,
            "Spec sessions must not remain in running state"
        );

        let running_sessions = manager
            .db_manager
            .list_sessions_by_state(SessionState::Running)
            .unwrap();
        assert!(
            !running_sessions.iter().any(|s| s.id == session.id),
            "Spec session should not be returned when listing running sessions after normalization"
        );
    }
}

pub struct SessionManager {
    db_manager: SessionDbManager,
    cache_manager: SessionCacheManager,
    utils: SessionUtils,
    repo_path: PathBuf,
}

impl SessionManager {
    fn resolve_parent_branch(&self, requested: Option<&str>) -> Result<String> {
        if let Some(branch) = requested {
            log::info!("Using explicit base branch '{branch}' for session setup");
            return Ok(branch.to_string());
        }

        match crate::domains::git::repository::get_current_branch(&self.repo_path) {
            Ok(current) => {
                log::info!("Detected current HEAD branch '{current}' for session setup");
                Ok(current)
            }
            Err(head_err) => {
                log::warn!(
                    "Failed to detect current HEAD branch for session setup: {head_err}. Falling back to default branch detection."
                );
                crate::domains::git::get_default_branch(&self.repo_path).map_err(|default_err| {
                    anyhow!(
                        "Failed to determine base branch: could not detect HEAD ({head_err}) or default branch ({default_err})"
                    )
                })
            }
        }
    }

    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        log::debug!(
            "Creating SessionManager with repo path: {}",
            repo_path.display()
        );

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
    pub fn create_session(
        &self,
        name: &str,
        prompt: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<Session> {
        self.create_session_with_auto_flag(name, prompt, base_branch, false, None, None)
    }

    pub fn create_session_with_auto_flag(
        &self,
        name: &str,
        prompt: Option<&str>,
        base_branch: Option<&str>,
        was_auto_generated: bool,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<Session> {
        let params = SessionCreationParams {
            name,
            prompt,
            base_branch,
            was_auto_generated,
            version_group_id,
            version_number,
            agent_type: None,
            skip_permissions: None,
        };
        self.create_session_with_agent(params)
    }

    pub fn create_session_with_agent(&self, params: SessionCreationParams) -> Result<Session> {
        log::info!(
            "Creating session '{}' in repository: {}",
            params.name,
            self.repo_path.display()
        );

        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();

        if !git::is_valid_session_name(params.name) {
            return Err(anyhow!(
                "Invalid session name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        let (unique_name, branch, worktree_path) =
            self.utils.find_unique_session_paths(params.name)?;
        let session_id = SessionUtils::generate_session_id();
        self.utils.cleanup_existing_worktree(&worktree_path)?;

        let parent_branch = match self.resolve_parent_branch(params.base_branch) {
            Ok(branch) => branch,
            Err(err) => {
                self.cache_manager.unreserve_name(&unique_name);
                return Err(err);
            }
        };

        let repo_name = self.utils.get_repo_name()?;
        let now = Utc::now();

        let default_agent_type = self
            .db_manager
            .get_agent_type()
            .unwrap_or_else(|_| "claude".to_string());
        let should_copy_claude_locals = params
            .agent_type
            .map(|agent| agent.eq_ignore_ascii_case("claude"))
            .unwrap_or_else(|| default_agent_type.eq_ignore_ascii_case("claude"));

        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None,
            version_group_id: params.version_group_id.map(|s| s.to_string()),
            version_number: params.version_number,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch: parent_branch.clone(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: params.prompt.map(String::from),
            ready_to_merge: false,
            original_agent_type: params.agent_type.map(|s| s.to_string()),
            original_skip_permissions: params.skip_permissions,
            pending_name_generation: params.was_auto_generated,
            was_auto_generated: params.was_auto_generated,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
        };

        let repo_was_empty = !git::repository_has_commits(&self.repo_path).unwrap_or(true);
        if repo_was_empty {
            log::info!(
                "Repository has no commits, creating initial commit: '{}'",
                git::INITIAL_COMMIT_MESSAGE
            );
            git::create_initial_commit(&self.repo_path).map_err(|e| {
                self.cache_manager.unreserve_name(&unique_name);
                anyhow!("Failed to create initial commit: {e}")
            })?;
        }

        let create_result = git::create_worktree_from_base(
            &self.repo_path,
            &branch,
            &worktree_path,
            &parent_branch,
        );

        if let Err(e) = create_result {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to create worktree: {e}"));
        }

        // Verify the worktree was created successfully and is valid
        if !worktree_path.exists() {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!(
                "Worktree directory was not created: {}",
                worktree_path.display()
            ));
        }

        let git_dir = worktree_path.join(".git");
        if !git_dir.exists() {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!(
                "Worktree git directory is missing: {}",
                git_dir.display()
            ));
        }

        log::info!("Worktree verified and ready: {}", worktree_path.display());

        if should_copy_claude_locals {
            if let Err(err) = self.copy_claude_local_files(&worktree_path) {
                warn!("Failed to copy Claude local overrides for session '{unique_name}': {err}");
            }
        }

        // IMPORTANT: Do not execute project setup script here.
        // We stream the setup script output directly in the session's top terminal
        // right before the agent starts (see schaltwerk_core_start_claude). This
        // keeps session creation fast and provides visible progress to the user.

        if let Err(e) = self.db_manager.create_session(&session) {
            let _ = git::remove_worktree(&self.repo_path, &worktree_path);
            let _ = git::delete_branch(&self.repo_path, &branch);
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save session to database: {e}"));
        }
        let global_agent = default_agent_type;
        let global_skip = self.db_manager.get_skip_permissions().unwrap_or(false);
        let _ =
            self.db_manager
                .set_session_original_settings(&session.id, &global_agent, global_skip);

        let mut git_stats = git::calculate_git_stats_fast(&worktree_path, &parent_branch)?;
        git_stats.session_id = session_id.clone();
        self.db_manager.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db_manager.set_session_activity(&session_id, dt);
            }
        }

        self.cache_manager.unreserve_name(&unique_name);
        log::info!("Successfully created session '{unique_name}'");
        Ok(session)
    }

    fn copy_claude_local_files(&self, worktree_path: &Path) -> Result<()> {
        let mut copy_plan: Vec<(PathBuf, PathBuf)> = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.repo_path) {
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
        if claude_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&claude_dir) {
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
        }

        for (source, dest) in copy_plan {
            if dest.exists() {
                info!(
                    "Skipping Claude local override copy; destination already exists: {}",
                    dest.display()
                );
                continue;
            }

            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }

            fs::copy(&source, &dest)?;
            info!(
                "Copied Claude local override from {} to {}",
                source.display(),
                dest.display()
            );
        }

        Ok(())
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
                return Err(anyhow!("Failed to remove worktree: {e}"));
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
                    log::info!(
                        "Archived branch '{}' to '{}'",
                        session.branch,
                        archived_name
                    );
                }
                Err(e) => {
                    log::warn!("Failed to archive branch '{}': {}", session.branch, e);
                }
            }
        } else {
            log::debug!("Cancel {name}: Branch doesn't exist, skipping archive");
        }

        self.db_manager
            .update_session_status(&session.id, SessionStatus::Cancelled)?;
        // Gate resume until the next fresh start
        let _ = self
            .db_manager
            .set_session_resume_allowed(&session.id, false);
        log::info!("Cancel {name}: Session cancelled successfully");
        Ok(())
    }

    /// Fast asynchronous session cancellation with parallel operations
    pub async fn fast_cancel_session(&self, name: &str) -> Result<()> {
        use git2::{BranchType, Repository, WorktreePruneOptions};

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
                let res = tokio::task::spawn_blocking(move || {
                    let repo = Repository::open(&repo_path)?;
                    let worktrees = repo.worktrees()?;
                    for wt_name in worktrees.iter().flatten() {
                        if let Ok(wt) = repo.find_worktree(wt_name) {
                            if wt.path() == worktree_path {
                                // Prune the worktree (force removal)
                                let _ = wt.prune(Some(&mut WorktreePruneOptions::new()));
                                break;
                            }
                        }
                    }
                    // Also try to remove directory if still exists
                    if worktree_path.exists() {
                        let _ = std::fs::remove_dir_all(&worktree_path);
                    }
                    Ok::<(), anyhow::Error>(())
                })
                .await;
                match res {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(e),
                    Err(e) => Err(anyhow::anyhow!("Task join error: {e}")),
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
                let res = tokio::task::spawn_blocking(move || {
                    let repo = Repository::open(&repo_path)?;
                    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                    let archive_name = format!("archive/{session_name}-{ts}");

                    // Create lightweight tag pointing to branch tip if branch exists
                    if let Ok(mut br) = repo.find_branch(&branch, BranchType::Local) {
                        if let Some(target) = br.get().target() {
                            let _ = repo.tag_lightweight(
                                &archive_name,
                                &repo.find_object(target, None)?,
                                false,
                            );
                            // Delete the branch
                            br.delete().ok();
                            log::info!("Archived branch '{branch}' to '{archive_name}'");
                        }
                    }
                    Ok::<(), anyhow::Error>(())
                })
                .await;
                match res {
                    Ok(Ok(())) => Ok::<(), anyhow::Error>(()),
                    Ok(Err(e)) => {
                        log::warn!("Branch operation error: {e}");
                        Ok::<(), anyhow::Error>(())
                    }
                    Err(e) => {
                        log::warn!("Task join error: {e}");
                        Ok::<(), anyhow::Error>(())
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
        self.db_manager
            .update_session_status(&session.id, SessionStatus::Cancelled)?;
        // Gate resume until the next fresh start
        let _ = self
            .db_manager
            .set_session_resume_allowed(&session.id, false);
        log::info!("Fast cancel {name}: Successfully completed");

        Ok(())
    }

    pub fn convert_session_to_draft(&self, name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(name)?;

        if session.session_state != SessionState::Running {
            return Err(anyhow!("Session '{name}' is not in running state"));
        }

        log::info!("Converting session '{name}' from running to spec");

        let has_uncommitted = if session.worktree_path.exists() {
            git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
        } else {
            false
        };

        if has_uncommitted {
            log::warn!("Converting session '{name}' to spec with uncommitted changes");
        }

        if session.worktree_path.exists() {
            if let Err(e) = git::remove_worktree(&self.repo_path, &session.worktree_path) {
                log::warn!("Failed to remove worktree when converting to spec (will continue anyway): {e}. This may be due to active processes or file locks in the worktree directory.");
                // Continue with conversion even if worktree removal fails - the important part
                // is updating the session state in the database. The orphaned directory
                // can be cleaned up later via cleanup_orphaned_worktrees()
            }
        }

        if git::branch_exists(&self.repo_path, &session.branch)? {
            if let Err(e) = git::delete_branch(&self.repo_path, &session.branch) {
                log::warn!("Failed to delete branch '{}': {}", session.branch, e);
            }
        }

        self.db_manager
            .update_session_status(&session.id, SessionStatus::Spec)?;
        self.db_manager
            .update_session_state(&session.id, SessionState::Spec)?;
        // Gate resume until first start after conversion
        let _ = self
            .db_manager
            .set_session_resume_allowed(&session.id, false);

        // Reset run state fields when converting to spec
        self.db_manager
            .update_session_ready_to_merge(&session.id, false)?;
        self.db_manager.clear_session_run_state(&session.id)?;

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
        let start_time = std::time::Instant::now();
        let sessions = self.db_manager.list_sessions()?;
        let db_time = start_time.elapsed();
        log::info!(
            "list_enriched_sessions: Found {} total sessions in database ({}ms)",
            sessions.len(),
            db_time.as_millis()
        );

        let mut enriched = Vec::new();
        let mut git_stats_total_time = std::time::Duration::ZERO;
        let mut worktree_check_time = std::time::Duration::ZERO;
        let mut session_count = 0;

        for session in sessions {
            if session.status == SessionStatus::Cancelled {
                continue;
            }

            session_count += 1;
            let session_start = std::time::Instant::now();

            let is_spec_session = session.session_state == SessionState::Spec;
            if !is_spec_session {
                log::debug!(
                    "Processing session '{}': status={:?}, session_state={:?}",
                    session.name,
                    session.status,
                    session.session_state
                );
            }

            // Check if worktree exists for non-spec sessions
            let worktree_check_start = std::time::Instant::now();
            let worktree_exists = session.worktree_path.exists();
            worktree_check_time += worktree_check_start.elapsed();

            // For spec sessions, we don't need worktrees to exist
            // For running sessions, skip if worktree is missing (unless in test mode)
            if !is_spec_session && !worktree_exists && !cfg!(test) {
                log::warn!(
                    "Skipping session '{}' - worktree missing: {}",
                    session.name,
                    session.worktree_path.display()
                );
                continue;
            }

            let git_stats_start = std::time::Instant::now();
            let git_stats = if is_spec_session {
                None
            } else {
                self.db_manager.get_enriched_git_stats(&session)?
            };
            let git_stats_elapsed = git_stats_start.elapsed();
            git_stats_total_time += git_stats_elapsed;

            if git_stats_elapsed.as_millis() > 100 {
                log::warn!(
                    "Slow git stats for session '{}': {}ms",
                    session.name,
                    git_stats_elapsed.as_millis()
                );
            }
            let has_uncommitted = if worktree_exists {
                git_stats
                    .as_ref()
                    .map(|s| s.has_uncommitted)
                    .unwrap_or(false)
            } else {
                false
            };

            let has_conflicts = if worktree_exists {
                match git::has_conflicts(&session.worktree_path) {
                    Ok(value) => value,
                    Err(err) => {
                        log::warn!(
                            "Conflict detection failed for session '{}': {err}",
                            session.name
                        );
                        false
                    }
                }
            } else {
                false
            };

            let diff_stats = git_stats.as_ref().map(|stats| DiffStats {
                files_changed: stats.files_changed as usize,
                additions: stats.lines_added as usize,
                deletions: stats.lines_removed as usize,
                insertions: stats.lines_added as usize,
            });

            let status_type = if !worktree_exists && !is_spec_session {
                SessionStatusType::Missing
            } else {
                match session.status {
                    SessionStatus::Active => {
                        if has_uncommitted {
                            SessionStatusType::Dirty
                        } else {
                            SessionStatusType::Active
                        }
                    }
                    SessionStatus::Cancelled => SessionStatusType::Archived,
                    SessionStatus::Spec => SessionStatusType::Spec,
                }
            };

            let original_agent_type = session
                .original_agent_type
                .clone()
                .or_else(|| self.db_manager.get_agent_type().ok());

            let info = SessionInfo {
                session_id: session.name.clone(),
                display_name: session.display_name.clone(),
                version_group_id: session.version_group_id.clone(),
                version_number: session.version_number,
                branch: session.branch.clone(),
                worktree_path: session.worktree_path.to_string_lossy().to_string(),
                base_branch: session.parent_branch.clone(),
                status: status_type,
                created_at: Some(session.created_at),
                last_modified: session.last_activity,
                has_uncommitted_changes: Some(has_uncommitted),
                has_conflicts: Some(has_conflicts),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type,
                current_task: session.initial_prompt.clone(),
                diff_stats: diff_stats.clone(),
                ready_to_merge: session.ready_to_merge,
                spec_content: session.spec_content.clone(),
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

            let session_elapsed = session_start.elapsed();
            if session_elapsed.as_millis() > 50 {
                log::debug!(
                    "Session '{}' processing took {}ms",
                    session.name,
                    session_elapsed.as_millis()
                );
            }
        }

        let total_elapsed = start_time.elapsed();
        log::info!("list_enriched_sessions: Returning {} enriched sessions (total: {}ms, db: {}ms, git_stats: {}ms, worktree_checks: {}ms, avg per session: {}ms)",
            enriched.len(),
            total_elapsed.as_millis(),
            db_time.as_millis(),
            git_stats_total_time.as_millis(),
            worktree_check_time.as_millis(),
            if session_count > 0 { total_elapsed.as_millis() / session_count as u128 } else { 0 }
        );

        if total_elapsed.as_millis() > 500 {
            log::warn!(
                "PERFORMANCE WARNING: list_enriched_sessions took {}ms - consider optimizing",
                total_elapsed.as_millis()
            );
        }

        Ok(enriched)
    }

    pub fn list_enriched_sessions_sorted(
        &self,
        sort_mode: SortMode,
        filter_mode: FilterMode,
    ) -> Result<Vec<EnrichedSession>> {
        log::debug!("Computing sorted sessions: {sort_mode:?}/{filter_mode:?}");
        let all_sessions = self.list_enriched_sessions()?;

        let filtered_sessions = self.utils.apply_session_filter(all_sessions, &filter_mode);
        let sorted_sessions = self.utils.apply_session_sort(filtered_sessions, &sort_mode);

        Ok(sorted_sessions)
    }

    pub fn start_claude_in_session(&self, session_name: &str) -> Result<String> {
        self.start_claude_in_session_with_restart(session_name, false)
    }

    pub fn start_claude_in_session_with_restart(
        &self,
        session_name: &str,
        force_restart: bool,
    ) -> Result<String> {
        self.start_claude_in_session_with_restart_and_binary(
            session_name,
            force_restart,
            &HashMap::new(),
        )
    }

    pub fn start_claude_in_session_with_binary(
        &self,
        session_name: &str,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        self.start_claude_in_session_with_restart_and_binary(session_name, false, binary_paths)
    }

    pub fn start_claude_in_session_with_args(
        &self,
        session_name: &str,
        _cli_args: Option<&str>,
    ) -> Result<String> {
        self.start_claude_in_session_with_args_and_binary(session_name, _cli_args, &HashMap::new())
    }

    pub fn start_claude_in_session_with_args_and_binary(
        &self,
        session_name: &str,
        _cli_args: Option<&str>,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        self.start_claude_in_session_with_restart_and_binary(session_name, false, binary_paths)
    }

    pub fn start_claude_in_session_with_restart_and_binary(
        &self,
        session_name: &str,
        force_restart: bool,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        let skip_permissions = session
            .original_skip_permissions
            .unwrap_or(self.db_manager.get_skip_permissions()?);
        let agent_type = session
            .original_agent_type
            .clone()
            .unwrap_or(self.db_manager.get_agent_type()?);

        let registry = crate::domains::agents::unified::AgentRegistry::new();

        // Special handling for Claude's session resumption logic
        if agent_type == "claude" {
            log::info!(
                "Session manager: Starting Claude agent for session '{}' in worktree: {}",
                session_name,
                session.worktree_path.display()
            );
            log::info!(
                "Session manager: force_restart={}, session.initial_prompt={:?}",
                force_restart,
                session.initial_prompt
            );

            // Check DB gating first: if resume not allowed, we must start fresh regardless of disk state
            let resume_allowed = session.resume_allowed;
            // Check for existing Claude session files (fast-path) only if resume is allowed
            let resumable_session_id = if resume_allowed {
                crate::domains::agents::claude::find_resumable_claude_session_fast(
                    &session.worktree_path,
                )
            } else {
                None
            };
            log::info!("Session manager: find_resumable_claude_session_fast returned: {resumable_session_id:?}");

            // Determine session_id and prompt based on force_restart and existing session
            let (session_id_to_use, prompt_to_use, did_start_fresh) = if force_restart {
                // Explicit restart - always use initial prompt, no session resumption
                log::info!("Session manager: Force restarting Claude session '{}' with initial_prompt={:?}", session_name, session.initial_prompt);
                (None, session.initial_prompt.as_deref(), true)
            } else if let Some(session_id) = resumable_session_id {
                // Session exists with actual conversation content and not forcing restart - resume with session ID
                log::info!("Session manager: Resuming existing Claude session '{}' with session_id='{}' in worktree: {}", session_name, session_id, session.worktree_path.display());
                (Some(session_id), None, false)
            } else {
                // No resumable session - use initial prompt for first start or empty sessions
                log::info!(
                    "Session manager: Starting fresh Claude session '{}' with initial_prompt={:?}",
                    session_name,
                    session.initial_prompt
                );
                (None, session.initial_prompt.as_deref(), true)
            };

            log::info!("Session manager: Final decision - session_id_to_use={session_id_to_use:?}, prompt_to_use={prompt_to_use:?}");

            // Only mark session as prompted if we're actually using the prompt
            if prompt_to_use.is_some() {
                self.cache_manager
                    .mark_session_prompted(&session.worktree_path);
            }

            // If we started fresh and resume had been disallowed, flip resume_allowed back to true for future resumes
            if did_start_fresh && !resume_allowed {
                let _ = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true);
            }

            if let Some(agent) = registry.get("claude") {
                let binary_path = self.utils.get_effective_binary_path_with_override(
                    "claude",
                    binary_paths.get("claude").map(|s| s.as_str()),
                );
                return Ok(agent.build_command(
                    &session.worktree_path,
                    session_id_to_use.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                    Some(&binary_path),
                ));
            }
        }

        // Special handling for Codex's session resumption logic
        if agent_type == "codex" {
            log::info!(
                "Session manager: Starting Codex agent for session '{}' in worktree: {}",
                session_name,
                session.worktree_path.display()
            );
            log::info!(
                "Session manager: force_restart={}, session.initial_prompt={:?}",
                force_restart,
                session.initial_prompt
            );

            // Gate resume after Spec/Convert-to-spec until the first fresh start completes
            let resume_allowed = session.resume_allowed;
            // Check for existing Codex session to determine if we should resume or start fresh
            let resume_path = if resume_allowed {
                crate::domains::agents::codex::find_codex_resume_path(&session.worktree_path)
            } else {
                None
            };
            let resumable_session_id = if resume_allowed {
                crate::domains::agents::codex::find_codex_session_fast(&session.worktree_path)
            } else {
                None
            };
            log::info!("Session manager: resume_allowed={resume_allowed}, find_codex_resume_path returned: {:?}", resume_path.as_ref().map(|p| p.display().to_string()));
            log::info!(
                "Session manager: find_codex_session_fast returned: {resumable_session_id:?}"
            );

            // Determine session_id and prompt based on force_restart and existing session
            let resume_session_id_from_path = resume_path
                .as_ref()
                .and_then(|p| crate::domains::agents::codex::extract_session_id_from_path(p));

            let (session_id_to_use, prompt_to_use, did_start_fresh) = if force_restart {
                // Explicit restart - always use initial prompt, no session resumption
                log::info!(
                    "Session manager: Force restarting Codex session '{}' with initial_prompt={:?}",
                    session_name,
                    session.initial_prompt
                );
                (None, session.initial_prompt.as_deref(), true)
            } else if let (Some(path), Some(session_id)) =
                (resume_path.as_ref(), resume_session_id_from_path.clone())
            {
                log::info!(
                    "Session manager: Resuming Codex session via session id '{session_id}' (source path: {path_display})",
                    path_display = path.display()
                );
                (Some(session_id), None, false)
            } else if let Some(path) = resume_path.as_ref() {
                log::warn!(
                    "Session manager: Failed to extract session id from Codex log: {path_display}",
                    path_display = path.display()
                );
                if let Some(session_id) = resumable_session_id.clone() {
                    log::info!(
                        "Session manager: Falling back to sentinel resume strategy: {session_id}"
                    );
                    (Some(session_id), None, false)
                } else {
                    (None, session.initial_prompt.as_deref(), true)
                }
            } else if let Some(session_id) = resumable_session_id {
                // Fallback: Session sentinel exists - either --continue or --resume picker
                log::info!(
                    "Session manager: Resuming existing Codex session '{session_name}' with sentinel='{session_id}' in worktree: {worktree_path}",
                    worktree_path = session.worktree_path.display()
                );
                (Some(session_id), None, false)
            } else {
                // No resumable session - use initial prompt for first start
                log::info!(
                    "Session manager: Starting fresh Codex session '{session_name}' with initial_prompt={initial_prompt:?}",
                    initial_prompt = session.initial_prompt
                );
                (None, session.initial_prompt.as_deref(), true)
            };

            log::info!("Session manager: Final decision - session_id_to_use={session_id_to_use:?}, prompt_to_use={prompt_to_use:?}");

            // Only mark session as prompted if we're actually using the prompt
            if prompt_to_use.is_some() {
                self.cache_manager
                    .mark_session_prompted(&session.worktree_path);
            }

            // If we started fresh and resume had been disallowed, flip resume_allowed back to true for future resumes
            if did_start_fresh && !resume_allowed {
                let _ = self
                    .db_manager
                    .set_session_resume_allowed(&session.id, true);
            }

            if let Some(agent) = registry.get("codex") {
                let binary_path = self.utils.get_effective_binary_path_with_override(
                    "codex",
                    binary_paths.get("codex").map(|s| s.as_str()),
                );
                return Ok(agent.build_command(
                    &session.worktree_path,
                    session_id_to_use.as_deref(),
                    prompt_to_use,
                    skip_permissions,
                    Some(&binary_path),
                ));
            }
        }

        // For all other agents, use the registry directly
        if let Some(agent) = registry.get(&agent_type) {
            // Always start fresh - no session discovery for new sessions
            self.cache_manager
                .mark_session_prompted(&session.worktree_path);
            let prompt_to_use = session.initial_prompt.as_deref();

            let binary_path = self.utils.get_effective_binary_path_with_override(
                &agent_type,
                binary_paths.get(&agent_type).map(|s| s.as_str()),
            );

            Ok(agent.build_command(
                &session.worktree_path,
                None, // No session ID - always start fresh
                prompt_to_use,
                skip_permissions,
                Some(&binary_path),
            ))
        } else {
            log::error!("Unknown agent type '{agent_type}' for session '{session_name}'");
            let supported = registry.supported_agents().join(", ");
            Err(anyhow!(
                "Unsupported agent type: {agent_type}. Supported types are: {supported}"
            ))
        }
    }

    pub fn start_claude_in_orchestrator(&self) -> Result<String> {
        self.start_claude_in_orchestrator_with_args(None)
    }

    pub fn start_claude_in_orchestrator_fresh(&self) -> Result<String> {
        self.start_claude_in_orchestrator_fresh_with_binary(&HashMap::new())
    }

    pub fn start_claude_in_orchestrator_fresh_with_binary(
        &self,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        log::info!(
            "Building FRESH orchestrator command (no session resume) for repo: {}",
            self.repo_path.display()
        );

        if !self.repo_path.exists() {
            log::error!(
                "Repository path does not exist: {}",
                self.repo_path.display()
            );
            return Err(anyhow!(
                "Repository path does not exist: {}. Please open a valid project folder.",
                self.repo_path.display()
            ));
        }

        if !self.repo_path.join(".git").exists() {
            log::error!("Not a git repository: {}", self.repo_path.display());
            return Err(anyhow!("The folder '{}' is not a git repository. The orchestrator requires a git repository to function.", self.repo_path.display()));
        }

        let skip_permissions = self.db_manager.get_orchestrator_skip_permissions()?;
        let agent_type = self.db_manager.get_orchestrator_agent_type()?;

        log::info!(
            "Fresh orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}"
        );

        self.build_orchestrator_command(&agent_type, skip_permissions, binary_paths, false)
    }

    pub fn start_claude_in_orchestrator_with_binary(
        &self,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(None, binary_paths)
    }

    pub fn start_claude_in_orchestrator_with_args(
        &self,
        _cli_args: Option<&str>,
    ) -> Result<String> {
        self.start_claude_in_orchestrator_with_args_and_binary(_cli_args, &HashMap::new())
    }

    pub fn start_claude_in_orchestrator_with_args_and_binary(
        &self,
        _cli_args: Option<&str>,
        binary_paths: &HashMap<String, String>,
    ) -> Result<String> {
        log::info!(
            "Building orchestrator command for repo: {}",
            self.repo_path.display()
        );

        if !self.repo_path.exists() {
            return Err(anyhow!(
                "Repository path does not exist: {}",
                self.repo_path.display()
            ));
        }

        if !self.repo_path.join(".git").exists() {
            return Err(anyhow!(
                "Not a git repository: {}",
                self.repo_path.display()
            ));
        }

        let skip_permissions = self.db_manager.get_orchestrator_skip_permissions()?;
        let agent_type = self.db_manager.get_orchestrator_agent_type()?;

        log::info!("Orchestrator agent type: {agent_type}, skip_permissions: {skip_permissions}");

        self.build_orchestrator_command(&agent_type, skip_permissions, binary_paths, true)
    }

    fn build_orchestrator_command(
        &self,
        agent_type: &str,
        skip_permissions: bool,
        binary_paths: &HashMap<String, String>,
        resume_session: bool,
    ) -> Result<String> {
        let registry = crate::domains::agents::unified::AgentRegistry::new();

        // Special handling for Claude orchestrator resumes (deterministic session lookup)
        if agent_type == "claude" {
            let binary_path = self.utils.get_effective_binary_path_with_override(
                "claude",
                binary_paths.get("claude").map(|s| s.as_str()),
            );
            if let Some(agent) = registry.get("claude") {
                // Check if we have any existing orchestrator sessions to resume
                // The orchestrator runs in the main repo path, so we check for sessions there
                let session_id_to_use = if resume_session {
                    match crate::domains::agents::claude::find_resumable_claude_session_fast(
                        &self.repo_path,
                    ) {
                        Some(session_id) => {
                            log::info!(
                                "Orchestrator: Resuming Claude orchestrator session '{session_id}'",
                            );
                            Some(session_id)
                        }
                        None => {
                            log::info!("Orchestrator: No existing Claude orchestrator sessions found in main repo, starting fresh");
                            None
                        }
                    }
                } else {
                    None
                };

                let command = agent.build_command(
                    &self.repo_path,
                    session_id_to_use.as_deref(),
                    None,
                    skip_permissions,
                    Some(&binary_path),
                );

                return Ok(command);
            }
        }

        // For all other agents, use the registry
        if let Some(agent) = registry.get(agent_type) {
            let binary_path = self.utils.get_effective_binary_path_with_override(
                agent_type,
                binary_paths.get(agent_type).map(|s| s.as_str()),
            );

            let session_id = if resume_session {
                agent.find_session(&self.repo_path)
            } else {
                None
            };

            Ok(agent.build_command(
                &self.repo_path,
                session_id.as_deref(),
                None,
                skip_permissions,
                Some(&binary_path),
            ))
        } else {
            log::error!("Unknown agent type '{agent_type}' for orchestrator");
            let supported = registry.supported_agents().join(", ");
            Err(anyhow!(
                "Unsupported agent type: {agent_type}. Supported types are: {supported}"
            ))
        }
    }

    pub fn mark_session_as_reviewed(&self, session_name: &str) -> Result<()> {
        // Get session and validate state
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Validate that the session is in a valid state for marking as reviewed
        if session.session_state == SessionState::Spec {
            return Err(anyhow!("Cannot mark spec session '{session_name}' as reviewed. Start the spec first with schaltwerk_draft_start."));
        }

        if session.ready_to_merge {
            return Err(anyhow!(
                "Session '{session_name}' is already marked as reviewed"
            ));
        }

        // Use existing mark_session_ready logic (with auto_commit=false)
        self.mark_session_ready(session_name, false)?;
        Ok(())
    }

    pub fn convert_session_to_spec(&self, session_name: &str) -> Result<()> {
        // Get session and validate state
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Validate that the session is in a valid state for conversion
        if session.session_state == SessionState::Spec {
            return Err(anyhow!("Session '{session_name}' is already a spec"));
        }

        // Use existing convert_session_to_draft logic
        self.convert_session_to_draft(session_name)?;
        Ok(())
    }

    pub fn start_spec_session_with_config(
        &self,
        session_name: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
        agent_type: Option<&str>,
        skip_permissions: Option<bool>,
    ) -> Result<()> {
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
        self.start_spec_session(session_name, base_branch, version_group_id, version_number)?;
        Ok(())
    }

    pub fn mark_session_ready(&self, session_name: &str, auto_commit: bool) -> Result<bool> {
        let session = self.db_manager.get_session_by_name(session_name)?;

        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path)?;

        if has_uncommitted && auto_commit {
            git::commit_all_changes(
                &session.worktree_path,
                &SESSION_READY_COMMIT_MESSAGE.replace("{}", session_name),
            )?;
        }

        // Mark as ready to merge in DB
        self.db_manager
            .update_session_ready_to_merge(&session.id, true)?;

        // Always refresh git stats immediately so UI reflects the latest state.
        // This avoids relying on the 60s cache window in get_enriched_git_stats()
        // and fixes cases where a prior cached value showed uncommitted changes
        // even though the session is now reviewed and clean.
        // Note: Safe to run whether or not auto-commit happened above.
        if let Err(e) = self.db_manager.update_git_stats(&session.id) {
            // Do not fail the overall action if stats update fails; log and continue
            log::warn!("mark_session_ready: failed to refresh git stats for '{session_name}': {e}");
        }

        Ok(!has_uncommitted || auto_commit)
    }

    pub fn unmark_session_ready(&self, session_name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(session_name)?;
        self.db_manager
            .update_session_ready_to_merge(&session.id, false)?;
        Ok(())
    }

    // When a follow-up message arrives for a reviewed session, it should move back to running.
    // Only act if the session is actually marked reviewed (ready_to_merge = true).
    // Returns true if a change was applied, false if no-op (not reviewed/spec/missing flags).
    pub fn unmark_reviewed_on_follow_up(&self, session_name: &str) -> Result<bool> {
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Do nothing for specs (cannot receive follow-ups into terminals)
        if session.session_state == SessionState::Spec {
            return Ok(false);
        }

        if session.ready_to_merge {
            // Clear review flag and ensure state is Running for UI consistency
            self.db_manager
                .update_session_ready_to_merge(&session.id, false)?;
            self.db_manager
                .update_session_state(&session.id, SessionState::Running)?;

            // Touch last_activity to surface recency deterministically
            let _ = self
                .db_manager
                .set_session_activity(&session.id, chrono::Utc::now());
            return Ok(true);
        }

        Ok(false)
    }

    pub fn create_spec_session(&self, name: &str, spec_content: &str) -> Result<Session> {
        self.create_spec_session_with_agent(name, spec_content, None, None)
    }

    pub fn create_spec_session_with_agent(
        &self,
        name: &str,
        spec_content: &str,
        agent_type: Option<&str>,
        skip_permissions: Option<bool>,
    ) -> Result<Session> {
        log::info!(
            "Creating spec session '{}' with agent_type={:?} in repository: {}",
            name,
            agent_type,
            self.repo_path.display()
        );

        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();

        if !git::is_valid_session_name(name) {
            return Err(anyhow!(
                "Invalid session name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        let (unique_name, branch, worktree_path) = self.utils.find_unique_session_paths(name)?;

        let session_id = SessionUtils::generate_session_id();
        let repo_name = self.utils.get_repo_name()?;
        let now = Utc::now();

        // Set pending_name_generation flag if we have agent type and content
        let pending_name_generation = agent_type.is_some() && !spec_content.trim().is_empty();

        let parent_branch = match self.resolve_parent_branch(None) {
            Ok(branch) => branch,
            Err(err) => {
                self.cache_manager.unreserve_name(&unique_name);
                return Err(err);
            }
        };

        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None, // Will be generated later when the spec is started
            version_group_id: None,
            version_number: None,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch,
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Spec,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None, // Spec sessions don't use initial_prompt
            ready_to_merge: false,
            original_agent_type: agent_type.map(|s| s.to_string()),
            original_skip_permissions: skip_permissions,
            pending_name_generation,
            was_auto_generated: false,
            spec_content: Some(spec_content.to_string()),
            session_state: SessionState::Spec,
            resume_allowed: true,
        };

        self.db_manager.create_session(&session)?;

        Ok(session)
    }

    pub fn create_and_start_spec_session(
        &self,
        name: &str,
        spec_content: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        log::info!(
            "Creating and starting spec session '{}' in repository: {}",
            name,
            self.repo_path.display()
        );

        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();

        if !git::is_valid_session_name(name) {
            return Err(anyhow!(
                "Invalid session name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        let (unique_name, branch, worktree_path) = self.utils.find_unique_session_paths(name)?;

        let session_id = SessionUtils::generate_session_id();
        let repo_name = self.utils.get_repo_name()?;
        let now = Utc::now();

        let parent_branch = match self.resolve_parent_branch(base_branch) {
            Ok(branch) => branch,
            Err(err) => {
                self.cache_manager.unreserve_name(&unique_name);
                return Err(err);
            }
        };

        let session = Session {
            id: session_id.clone(),
            name: unique_name.clone(),
            display_name: None,
            version_group_id: version_group_id.map(|s| s.to_string()),
            version_number,
            repository_path: self.repo_path.clone(),
            repository_name: repo_name,
            branch: branch.clone(),
            parent_branch: parent_branch.clone(),
            worktree_path: worktree_path.clone(),
            status: SessionStatus::Spec,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: Some(spec_content.to_string()),
            session_state: SessionState::Spec,
            resume_allowed: true,
        };

        if let Err(e) = self.db_manager.create_session(&session) {
            self.cache_manager.unreserve_name(&unique_name);
            return Err(anyhow!("Failed to save spec session to database: {e}"));
        }

        self.cache_manager.unreserve_name(&unique_name);

        self.utils.cleanup_existing_worktree(&worktree_path)?;

        let create_result = git::create_worktree_from_base(
            &self.repo_path,
            &branch,
            &worktree_path,
            &parent_branch,
        );

        if let Err(e) = create_result {
            return Err(anyhow!("Failed to create worktree: {e}"));
        }

        // Verify the worktree was created successfully and is valid
        if !worktree_path.exists() {
            return Err(anyhow!(
                "Worktree directory was not created: {}",
                worktree_path.display()
            ));
        }

        let git_dir = worktree_path.join(".git");
        if !git_dir.exists() {
            return Err(anyhow!(
                "Worktree git directory is missing: {}",
                git_dir.display()
            ));
        }

        log::info!("Worktree verified and ready: {}", worktree_path.display());

        if let Ok(Some(setup_script)) = self.db_manager.get_project_setup_script() {
            if !setup_script.trim().is_empty() {
                self.utils.execute_setup_script(
                    &setup_script,
                    &unique_name,
                    &branch,
                    &worktree_path,
                )?;
            }
        }

        self.db_manager
            .update_session_status(&session_id, SessionStatus::Active)?;
        self.db_manager
            .update_session_state(&session_id, SessionState::Running)?;

        log::info!(
            "Copying spec content to initial_prompt for session '{unique_name}': '{spec_content}'"
        );
        self.db_manager
            .update_session_initial_prompt(&session_id, spec_content)?;
        clear_session_prompted_non_test(&worktree_path);
        log::info!(
            "Cleared prompt state for session '{unique_name}' to ensure spec content is used"
        );

        let global_agent = self
            .db_manager
            .get_agent_type()
            .unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db_manager.get_skip_permissions().unwrap_or(false);
        let _ =
            self.db_manager
                .set_session_original_settings(&session_id, &global_agent, global_skip);

        let mut git_stats = git::calculate_git_stats_fast(&worktree_path, &parent_branch)?;
        git_stats.session_id = session_id.clone();
        self.db_manager.save_git_stats(&git_stats)?;
        if let Some(ts) = git_stats.last_diff_change_ts {
            if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
                let _ = self.db_manager.set_session_activity(&session_id, dt);
            }
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_and_start_spec_session_with_config(
        &self,
        name: &str,
        spec_content: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
        agent_type: Option<&str>,
        skip_permissions: Option<bool>,
    ) -> Result<()> {
        // Reuse the existing flow to create and start
        self.create_and_start_spec_session(
            name,
            spec_content,
            base_branch,
            version_group_id,
            version_number,
        )?;

        // Override original settings if provided, otherwise keep globals already stored
        if agent_type.is_some() || skip_permissions.is_some() {
            let session = self.db_manager.get_session_by_name(name)?;
            let agent = agent_type.map(|s| s.to_string()).unwrap_or_else(|| {
                self.db_manager
                    .get_agent_type()
                    .unwrap_or_else(|_| "claude".to_string())
            });
            let skip = skip_permissions
                .unwrap_or_else(|| self.db_manager.get_skip_permissions().unwrap_or(false));
            let _ = self
                .db_manager
                .set_session_original_settings(&session.id, &agent, skip);
            log::info!(
                "create_and_start_spec_session_with_config: set original settings for '{name}' to agent='{agent}', skip_permissions={skip}"
            );
        }

        Ok(())
    }

    pub fn start_spec_session(
        &self,
        session_name: &str,
        base_branch: Option<&str>,
        version_group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        log::info!(
            "Starting spec session '{}' in repository: {}",
            session_name,
            self.repo_path.display()
        );

        let repo_lock = self.cache_manager.get_repo_lock();
        let _guard = repo_lock.lock().unwrap();

        let session = self.db_manager.get_session_by_name(session_name)?;
        // If version grouping info provided, set it on this spec before starting
        if version_group_id.is_some() || version_number.is_some() {
            let _ = self.db_manager.set_session_version_info(
                &session.id,
                version_group_id,
                version_number,
            );
        }

        if session.session_state != SessionState::Spec {
            return Err(anyhow!("Session '{session_name}' is not in spec state"));
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
                    return Err(anyhow!("Failed to detect default branch: {e}. Please ensure the repository has at least one branch (e.g., 'main' or 'master')"));
                }
            }
        };

        self.utils
            .cleanup_existing_worktree(&session.worktree_path)?;

        let create_result = git::create_worktree_from_base(
            &self.repo_path,
            &session.branch,
            &session.worktree_path,
            &parent_branch,
        );

        if let Err(e) = create_result {
            return Err(anyhow!("Failed to create worktree: {e}"));
        }

        // Verify the worktree was created successfully and is valid
        if !session.worktree_path.exists() {
            return Err(anyhow!(
                "Worktree directory was not created: {}",
                session.worktree_path.display()
            ));
        }

        let git_dir = session.worktree_path.join(".git");
        if !git_dir.exists() {
            return Err(anyhow!(
                "Worktree git directory is missing: {}",
                git_dir.display()
            ));
        }

        log::info!(
            "Worktree verified and ready: {}",
            session.worktree_path.display()
        );

        if let Ok(Some(setup_script)) = self.db_manager.get_project_setup_script() {
            if !setup_script.trim().is_empty() {
                self.utils.execute_setup_script(
                    &setup_script,
                    &session.name,
                    &session.branch,
                    &session.worktree_path,
                )?;
            }
        }

        self.db_manager
            .update_session_status(&session.id, SessionStatus::Active)?;
        self.db_manager
            .update_session_state(&session.id, SessionState::Running)?;
        // Ensure we gate resume on first agent start after spec start
        let _ = self
            .db_manager
            .set_session_resume_allowed(&session.id, false);

        if let Some(spec_content) = session.spec_content {
            log::info!("Copying spec content to initial_prompt for session '{session_name}': '{spec_content}'");
            self.db_manager
                .update_session_initial_prompt(&session.id, &spec_content)?;
            clear_session_prompted_non_test(&session.worktree_path);
            log::info!(
                "Cleared prompt state for session '{session_name}' to ensure spec content is used"
            );
        } else {
            log::warn!("No spec_content found for session '{session_name}' - initial_prompt will not be set");
        }

        let global_agent = self
            .db_manager
            .get_agent_type()
            .unwrap_or_else(|_| "claude".to_string());
        let global_skip = self.db_manager.get_skip_permissions().unwrap_or(false);
        let _ =
            self.db_manager
                .set_session_original_settings(&session.id, &global_agent, global_skip);

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

    pub fn set_orchestrator_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db_manager.set_orchestrator_agent_type(agent_type)
    }

    pub fn set_orchestrator_skip_permissions(&self, skip: bool) -> Result<()> {
        self.db_manager.set_orchestrator_skip_permissions(skip)
    }

    pub fn update_spec_content(&self, session_name: &str, content: &str) -> Result<()> {
        info!(
            "SessionCore: Updating spec content for session '{}', content length: {}",
            session_name,
            content.len()
        );
        let session = self.db_manager.get_session_by_name(session_name)?;
        info!(
            "SessionCore: Found session with id: {}, state: {:?}",
            session.id, session.session_state
        );

        // Only allow updating content for sessions in Spec state
        if session.session_state != SessionState::Spec {
            return Err(anyhow::anyhow!(
                "Cannot update content for session '{}': only Spec sessions can have their content updated. Current state: {:?}",
                session_name,
                session.session_state
            ));
        }

        self.db_manager.update_spec_content(&session.id, content)?;
        info!("SessionCore: Successfully updated spec content in database for session '{session_name}'");
        Ok(())
    }

    pub fn append_spec_content(&self, session_name: &str, content: &str) -> Result<()> {
        info!(
            "SessionCore: Appending spec content for session '{}', additional content length: {}",
            session_name,
            content.len()
        );
        let session = self.db_manager.get_session_by_name(session_name)?;

        // Only allow appending content for sessions in Spec state
        if session.session_state != SessionState::Spec {
            return Err(anyhow::anyhow!(
                "Cannot append content to session '{}': only Spec sessions can have content appended. Current state: {:?}",
                session_name,
                session.session_state
            ));
        }

        self.db_manager.append_spec_content(&session.id, content)?;
        info!("SessionCore: Successfully appended spec content in database for session '{session_name}'");
        Ok(())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        self.db_manager.list_sessions_by_state(state)
    }

    pub fn rename_draft_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        if !git::is_valid_session_name(new_name) {
            return Err(anyhow!(
                "Invalid session name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        self.db_manager.rename_draft_session(old_name, new_name)?;
        Ok(())
    }

    pub fn archive_spec_session(&self, name: &str) -> Result<()> {
        // Only archive Spec sessions
        let session = self.db_manager.get_session_by_name(name)?;
        if session.session_state != SessionState::Spec {
            return Err(anyhow!("Can only archive spec sessions"));
        }

        let content = session
            .spec_content
            .or(session.initial_prompt)
            .unwrap_or_default();

        let archived = ArchivedSpec {
            id: Uuid::new_v4().to_string(),
            session_name: session.name.clone(),
            repository_path: self.repo_path.clone(),
            repository_name: session.repository_name.clone(),
            content,
            archived_at: Utc::now(),
        };

        // Insert into archive, then delete the session
        self.db_manager.db.insert_archived_spec(&archived)?;

        // Physically remove spec session from DB to declutter
        {
            let conn = self.db_manager.db.conn.lock().unwrap();
            use rusqlite::params;
            conn.execute("DELETE FROM sessions WHERE id = ?1", params![session.id])?;
        }

        // Enforce archive limit for this repository
        self.db_manager.db.enforce_archive_limit(&self.repo_path)?;

        log::info!("Archived spec session '{name}' and removed from active sessions");
        Ok(())
    }

    pub fn list_archived_specs(&self) -> Result<Vec<ArchivedSpec>> {
        self.db_manager.db.list_archived_specs(&self.repo_path)
    }

    pub fn restore_archived_spec(
        &self,
        archived_id: &str,
        new_name: Option<&str>,
    ) -> Result<Session> {
        // Load archived entry
        let archived = {
            let specs = self.db_manager.db.list_archived_specs(&self.repo_path)?;
            specs
                .into_iter()
                .find(|s| s.id == archived_id)
                .ok_or_else(|| anyhow!("Archived spec not found"))?
        };

        // Create new spec session
        let desired = new_name.unwrap_or(&archived.session_name);
        let spec = self.create_spec_session(desired, &archived.content)?;

        // Remove archive entry
        self.db_manager.db.delete_archived_spec(archived_id)?;

        Ok(spec)
    }

    pub fn delete_archived_spec(&self, archived_id: &str) -> Result<()> {
        self.db_manager.db.delete_archived_spec(archived_id)
    }

    pub fn get_archive_max_entries(&self) -> Result<i32> {
        self.db_manager.db.get_archive_max_entries()
    }

    pub fn set_archive_max_entries(&self, limit: i32) -> Result<()> {
        self.db_manager.db.set_archive_max_entries(limit)
    }

    pub fn archive_prompt_for_session(&self, name: &str) -> Result<()> {
        // Archive prompt/spec content for any session state (without deleting the session here)
        let session = self.db_manager.get_session_by_name(name)?;
        let content = session
            .spec_content
            .or(session.initial_prompt)
            .unwrap_or_default();

        if content.trim().is_empty() {
            // Nothing to archive
            return Ok(());
        }

        let archived = ArchivedSpec {
            id: Uuid::new_v4().to_string(),
            session_name: session.name.clone(),
            repository_path: self.repo_path.clone(),
            repository_name: session.repository_name.clone(),
            content,
            archived_at: Utc::now(),
        };

        self.db_manager.db.insert_archived_spec(&archived)?;
        self.db_manager.db.enforce_archive_limit(&self.repo_path)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn db_ref(&self) -> &crate::schaltwerk_core::database::Database {
        &self.db_manager.db
    }

    // Reset a session's worktree to the base branch in a defensive manner.
    // Verifies the worktree belongs to this project and that HEAD matches the session branch.
    pub fn reset_session_worktree(&self, name: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(name)?;

        // Ensure worktree path is inside this repository for safety
        if !session.worktree_path.starts_with(&self.repo_path) {
            return Err(anyhow!("Invalid worktree path for this project"));
        }

        // Open the worktree repo and confirm it's a worktree and on the session branch
        let repo = git2::Repository::open(&session.worktree_path)
            .map_err(|e| anyhow!("Failed to open worktree repository: {e}"))?;

        if !repo.is_worktree() {
            return Err(anyhow!("Target repository is not a git worktree"));
        }

        // Confirm HEAD matches the session branch to avoid resetting the wrong branch
        let head = repo
            .head()
            .map_err(|e| anyhow!("Failed to read HEAD: {e}"))?;
        let expected_ref = format!("refs/heads/{}", session.branch);
        if head.name() != Some(expected_ref.as_str()) {
            return Err(anyhow!(
                "HEAD does not point to the session branch (expected {}, got {:?})",
                expected_ref,
                head.name()
            ));
        }

        // Delegate to git domain code (already constrained to this repo)
        crate::domains::git::worktrees::reset_worktree_to_base(
            &session.worktree_path,
            &session.parent_branch,
        )
    }

    /// Discard changes for a single file in a session's worktree (defensive checks included).
    pub fn discard_file_in_session(&self, name: &str, rel_file_path: &str) -> Result<()> {
        let session = self.db_manager.get_session_by_name(name)?;

        if !session.worktree_path.starts_with(&self.repo_path) {
            return Err(anyhow!("Invalid worktree path for this project"));
        }

        // Open repo; prefer safety but don't hard-fail on head anomalies to avoid blocking user flow
        let repo = git2::Repository::open(&session.worktree_path)
            .map_err(|e| anyhow!("Failed to open worktree repository: {e}"))?;
        if let Ok(head) = repo.head() {
            if let Some(name) = head.shorthand() {
                if name != session.branch {
                    log::warn!(
                        "Discard file: HEAD shorthand '{}' != session branch '{}' (continuing defensively)",
                        name, session.branch
                    );
                }
            }
        } else {
            log::warn!("Discard file: unable to read HEAD; continuing defensively");
        }

        // Prevent touching our internal control area
        if rel_file_path.starts_with(".schaltwerk/") {
            return Err(anyhow!("Refusing to discard changes under .schaltwerk"));
        }

        let path = std::path::Path::new(rel_file_path);
        crate::domains::git::worktrees::discard_path_in_worktree(&session.worktree_path, path)
    }
}
